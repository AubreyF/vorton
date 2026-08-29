import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyPlan,
  canonicalJson,
  planInit,
  planUpgrade,
  rollbackPlan,
  sha256,
  validateInstallation,
} from "./index.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fixtureRoot = join(
  repositoryRoot,
  "packages/cli/test-fixtures/synthetic-organization",
);
const generatedRoots: string[] = [];

function manifest(version: "0.1.0" | "0.1.1"): string {
  return join(
    repositoryRoot,
    "packages/cli/test-fixtures/releases",
    `${version}.json`,
  );
}

function syntheticInstallationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aubos-synthetic-proof-"));
  generatedRoots.push(root);
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function filesUnder(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

function snapshotExistingFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    filesUnder(root).map((path) => [
      relative(root, path),
      readFileSync(path, "utf8"),
    ]),
  );
}

function snapshotOrganizationOwned(root: string): Record<string, string> {
  const lock = JSON.parse(
    readFileSync(join(root, "aubos.lock.json"), "utf8"),
  ) as { managedFiles: Record<string, string> };
  const managed = new Set(Object.keys(lock.managedFiles));
  return Object.fromEntries(
    filesUnder(root)
      .map((path) => relative(root, path))
      .filter(
        (path) =>
          path !== "aubos.lock.json" &&
          !path.startsWith(".aubos/") &&
          !managed.has(path),
      )
      .map((path) => [path, readFileSync(join(root, path), "utf8")]),
  );
}

afterEach(() => {
  for (const root of generatedRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("synthetic organization installation acceptance", () => {
  it("adopts an exact release and resumes an interrupted apply idempotently", () => {
    const root = syntheticInstallationRoot();
    const existingBefore = snapshotExistingFiles(root);
    const planned = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });

    const stored = JSON.parse(readFileSync(planned.path, "utf8")) as {
      planHash: string;
      actions: Array<{
        path: string;
        ownership: "aubos" | "organization";
        operation: "create" | "update" | "delete";
        preimage: string | null;
        postimage: string | null;
        preimageContent: string | null;
        content: string | null;
      }>;
    };
    const journalPath = join(root, `.aubos/journals/${planned.hash}.json`);
    mkdirSync(dirname(journalPath), { recursive: true });
    writeFileSync(
      journalPath,
      canonicalJson({
        schemaVersion: 1,
        planHash: planned.hash,
        status: "applying",
        actions: stored.actions.map((entry) => ({
          ...entry,
          state: "pending",
        })),
      }),
    );

    // Simulate termination after one atomic file write but before its journal
    // state was persisted. The retry recognizes the exact postimage.
    const interruptedAction = stored.actions[0]!;
    expect(interruptedAction.content).not.toBeNull();
    const interruptedPath = join(root, interruptedAction.path);
    mkdirSync(dirname(interruptedPath), { recursive: true });
    writeFileSync(interruptedPath, interruptedAction.content!);

    expect(applyPlan({ root, planHash: planned.hash }).status).toBe("applied");
    expect(applyPlan({ root, planHash: planned.hash }).status).toBe(
      "already-applied",
    );
    validateInstallation(root);
    expect(snapshotExistingFiles(root)).toMatchObject(existingBefore);
    expect(readFileSync(join(root, "aubos.lock.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );
  });

  it("refuses a tampered upgrade preimage before changing any managed file", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const hostPath = join(root, "host/aubos-runtime.json");
    const lockPath = join(root, "aubos.lock.json");
    const hostBefore = readFileSync(hostPath, "utf8");
    const lockBefore = readFileSync(lockPath, "utf8");
    writeFileSync(hostPath, `${hostBefore}\n# tampered preimage\n`);

    expect(() => applyPlan({ root, planHash: upgraded.hash })).toThrow(
      /Preimage conflict at host\/aubos-runtime\.json/,
    );
    expect(readFileSync(lockPath, "utf8")).toBe(lockBefore);
    expect(readFileSync(hostPath, "utf8")).toContain("tampered preimage");
  });

  it("upgrades one managed host file and narrowly rolls it back", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const organizationBefore = snapshotOrganizationOwned(root);
    const originalHost = readFileSync(
      join(root, "host/aubos-runtime.json"),
      "utf8",
    );
    const originalLock = readFileSync(join(root, "aubos.lock.json"), "utf8");

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    expect(upgraded.plan.fromVersion).toBe("0.1.0");
    expect(upgraded.plan.release.version).toBe("0.1.1");
    applyPlan({ root, planHash: upgraded.hash });
    expect(readFileSync(join(root, "aubos.lock.json"), "utf8")).toContain(
      '"lastUpgradeEdge": "0.1.0->0.1.1"',
    );
    expect(
      readFileSync(join(root, "host/aubos-runtime.json"), "utf8"),
    ).toContain('"readinessPath": "/api/ready"');
    expect(snapshotOrganizationOwned(root)).toEqual(organizationBefore);

    expect(rollbackPlan({ root, planHash: upgraded.hash })).toEqual({
      status: "rolled-back",
      restored: ["aubos.lock.json", "host/aubos-runtime.json"],
    });
    expect(readFileSync(join(root, "host/aubos-runtime.json"), "utf8")).toBe(
      originalHost,
    );
    expect(readFileSync(join(root, "aubos.lock.json"), "utf8")).toBe(
      originalLock,
    );
    expect(snapshotOrganizationOwned(root)).toEqual(organizationBefore);
  });

  it("refuses rollback after a managed postimage drifts", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: upgraded.hash });
    const hostPath = join(root, "host/aubos-runtime.json");
    writeFileSync(hostPath, "postimage drift\n");

    expect(() => rollbackPlan({ root, planHash: upgraded.hash })).toThrow(
      /Rollback postimage conflict at host\/aubos-runtime\.json/,
    );
    expect(readFileSync(hostPath, "utf8")).toBe("postimage drift\n");
  });

  it("contains no personal data or secret values", () => {
    const root = syntheticInstallationRoot();
    const planned = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: planned.hash });
    const combined = filesUnder(root)
      .map((path) => `${relative(root, path)}\n${readFileSync(path, "utf8")}`)
      .join("\n");

    expect(combined).not.toMatch(/@(?:gmail|icloud)\.com/i);
    expect(combined).not.toMatch(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}/);
    expect(combined).not.toMatch(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    );
    expect(combined).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    expect(existsSync(join(root, ".env"))).toBe(false);
    expect(combined).toContain("AUBOS_SUPABASE_URL");
    expect(combined).toContain("Moonbase Triage");
    expect(combined).toContain("mode: read-only");
  });
});
