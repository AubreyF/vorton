import { execFileSync } from "node:child_process";
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

function manifest(version: "0.1.0" | "0.1.1" | "0.2.0"): string {
  return join(
    repositoryRoot,
    "packages/cli/test-fixtures/releases",
    `${version}.json`,
  );
}

const hindsightImage =
  "ghcr.io/vectorize-io/hindsight@sha256:ac50c0d95a65c88545f46665dc432544bcc378cec89e03675786a1d9383feb2d";

const v2Images = {
  "deploy/api.fly.toml":
    "registry.invalid/aubos-fixture/control-plane@sha256:3333333333333333333333333333333333333333333333333333333333333333",
  "deploy/web.fly.toml":
    "registry.invalid/aubos-fixture/web@sha256:4444444444444444444444444444444444444444444444444444444444444444",
  "deploy/worker.fly.toml":
    "registry.invalid/aubos-fixture/worker@sha256:5555555555555555555555555555555555555555555555555555555555555555",
  "deploy/hindsight.fly.toml": hindsightImage,
} as const;

function buildImage(content: string): string {
  const match = /\[build]\s+image\s*=\s*"([^"]+)"/m.exec(content);
  if (!match) throw new Error("Missing fixture build image");
  return match[1]!;
}

function syntheticInstallationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aubos-synthetic-proof-"));
  generatedRoots.push(root);
  cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function blankInstallationRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aubos-blank-proof-"));
  generatedRoots.push(root);
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
      .map((path) => [path, readFileSync(join(root, path), "utf8")] as const)
      .map(([path, content]) => [
        path,
        path === "aubos.yaml"
          ? content.replace(/^(\s*version:\s*)[^\n#]+/m, "$1{{AUBOS_VERSION}}")
          : content,
      ]),
  );
}

afterEach(() => {
  for (const root of generatedRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("synthetic organization installation acceptance", () => {
  it("renders a fresh schema-v2 installation with four immutable service images", () => {
    const root = blankInstallationRoot();
    const planned = planInit({
      root,
      organization: "Freed",
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: planned.hash });
    validateInstallation(root);

    for (const [path, expectedImage] of Object.entries(v2Images)) {
      const content = readFileSync(join(root, path), "utf8");
      expect(buildImage(content)).toBe(expectedImage);
      expect(content).not.toMatch(/^\s*dockerfile\s*=/m);
      expect(content).not.toContain("REPLACE_WITH_LOCKED_OCI_REFERENCE");
      expect(content).not.toMatch(/:(?:latest|main|stable)(?:\s|"|$)/);
    }
    expect(readFileSync(join(root, "deploy/api.fly.toml"), "utf8")).toContain(
      'app = "freed-api"',
    );
    expect(readFileSync(join(root, "deploy/web.fly.toml"), "utf8")).toContain(
      'app = "freed-web"',
    );
    expect(
      readFileSync(join(root, "deploy/hindsight.fly.toml"), "utf8"),
    ).toContain('HINDSIGHT_API_WORKER_ID = "freed-memory"');

    const validatorPath = join(
      root,
      "tests/acceptance/validate-installation.rb",
    );
    const historicalFormatting = readFileSync(validatorPath, "utf8").replace(
      '["control-plane","web","worker"]',
      "['control-plane', 'web', 'worker']",
    );
    writeFileSync(validatorPath, historicalFormatting);
    validateInstallation(root);
    writeFileSync(
      validatorPath,
      historicalFormatting.replace("'worker'", "'untrusted-role'"),
    );
    expect(() => validateInstallation(root)).toThrow(
      /Validator release contract drift/,
    );
  });

  it("upgrades schema v1 to v2 and rolls image fields back around organization edits", () => {
    const root = syntheticInstallationRoot();
    const initialized = planInit({
      root,
      organization: "Moonbase Lab",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const v011 = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: v011.hash });

    mkdirSync(join(root, "scripts"), { recursive: true });
    const taggedV011Validator = readFileSync(
      join(
        repositoryRoot,
        "packages/cli/test-fixtures/validators/v0.1.1.validate-installation.rb",
      ),
      "utf8",
    );
    writeFileSync(
      join(root, "scripts/validate-installation.rb"),
      taggedV011Validator,
    );
    validateInstallation(root);
    writeFileSync(
      join(root, "aubos.yaml"),
      readFileSync(join(root, "aubos.yaml"), "utf8").replace(
        "  modules:",
        "  # ORGANIZATION_DESIRED_MARKER\n  modules:",
      ),
    );

    const oldImages = {
      "deploy/api.fly.toml":
        "registry.invalid/aubos-fixture/control-plane@sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "deploy/web.fly.toml": v2Images["deploy/web.fly.toml"],
      "deploy/worker.fly.toml":
        "registry.invalid/aubos-fixture/worker@sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "deploy/hindsight.fly.toml": hindsightImage,
    } as const;
    for (const [path, image] of Object.entries(oldImages)) {
      const service = path.split("/").at(-1)!.replace(".fly.toml", "");
      writeFileSync(
        join(root, path),
        `# Organization settings\napp = "custom-${service}"\nprimary_region = "ord"\n\n[build]\n  image = "${image}"\n\n[env]\n  ORGANIZATION_MARKER = "preserve-me"\n  HINDSIGHT_API_WORKER_ID = "moonbase-lab-memory"\n`,
      );
    }
    const legacyDeployment = readFileSync(
      join(root, "deploy/fly.toml"),
      "utf8",
    );

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.2.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const deploymentActions = upgraded.plan.actions.filter(
      (entry) => entry.ownership === "aubos-image",
    );
    expect(deploymentActions.map((entry) => entry.path).sort()).toEqual([
      "deploy/api.fly.toml",
      "deploy/worker.fly.toml",
    ]);
    expect(
      upgraded.plan.actions
        .filter((entry) => entry.ownership === "aubos-validator")
        .map((entry) => entry.path),
    ).toEqual([
      "scripts/validate-installation.rb",
      "tests/acceptance/validate-installation.rb",
    ]);
    expect(
      upgraded.plan.actions
        .filter((entry) => entry.ownership === "aubos-version")
        .map((entry) => entry.path),
    ).toEqual(["aubos.yaml"]);
    applyPlan({ root, planHash: upgraded.hash });
    validateInstallation(root);
    expect(
      execFileSync(
        "ruby",
        [join(root, "tests/acceptance/validate-installation.rb")],
        { encoding: "utf8" },
      ),
    ).toContain("0.2.0 valid");
    expect(readFileSync(join(root, "aubos.yaml"), "utf8")).toContain(
      "ORGANIZATION_DESIRED_MARKER",
    );
    expect(readFileSync(join(root, "aubos.yaml"), "utf8")).toContain(
      "version: 0.2.0",
    );

    for (const [path, expectedImage] of Object.entries(v2Images)) {
      const content = readFileSync(join(root, path), "utf8");
      expect(buildImage(content)).toBe(expectedImage);
      expect(content).toContain('primary_region = "ord"');
      expect(content).toContain('ORGANIZATION_MARKER = "preserve-me"');
    }
    expect(readFileSync(join(root, "deploy/fly.toml"), "utf8")).toBe(
      legacyDeployment,
    );

    for (const path of ["deploy/api.fly.toml", "deploy/worker.fly.toml"]) {
      const absolute = join(root, path);
      writeFileSync(
        absolute,
        readFileSync(absolute, "utf8")
          .replace('app = "custom-', 'app = "renamed-')
          .replace('primary_region = "ord"', 'primary_region = "lhr"'),
      );
    }
    writeFileSync(
      join(root, "scripts/validate-installation.rb"),
      readFileSync(
        join(root, "scripts/validate-installation.rb"),
        "utf8",
      ).replace(
        "installed_tool_files =",
        "# LATER_ORGANIZATION_EDIT\ninstalled_tool_files =",
      ),
    );
    writeFileSync(
      join(root, "aubos.yaml"),
      readFileSync(join(root, "aubos.yaml"), "utf8").replace(
        "# ORGANIZATION_DESIRED_MARKER",
        "# ORGANIZATION_DESIRED_MARKER\n  # LATER_ORGANIZATION_EDIT",
      ),
    );
    expect(rollbackPlan({ root, planHash: upgraded.hash }).status).toBe(
      "rolled-back",
    );
    expect(
      buildImage(readFileSync(join(root, "deploy/api.fly.toml"), "utf8")),
    ).toBe(oldImages["deploy/api.fly.toml"]);
    expect(
      buildImage(readFileSync(join(root, "deploy/worker.fly.toml"), "utf8")),
    ).toBe(oldImages["deploy/worker.fly.toml"]);
    for (const path of ["deploy/api.fly.toml", "deploy/worker.fly.toml"]) {
      const content = readFileSync(join(root, path), "utf8");
      expect(content).toContain('app = "renamed-');
      expect(content).toContain('primary_region = "lhr"');
      expect(content).toContain('ORGANIZATION_MARKER = "preserve-me"');
    }
    expect(readFileSync(join(root, "deploy/fly.toml"), "utf8")).toBe(
      legacyDeployment,
    );
    const rolledBackDesired = readFileSync(join(root, "aubos.yaml"), "utf8");
    expect(rolledBackDesired).toContain("version: 0.1.1");
    expect(rolledBackDesired).toContain("LATER_ORGANIZATION_EDIT");
    const rolledBackValidator = readFileSync(
      join(root, "scripts/validate-installation.rb"),
      "utf8",
    );
    expect(rolledBackValidator).toBe(
      taggedV011Validator.replace(
        "installed_tool_files =",
        "# LATER_ORGANIZATION_EDIT\ninstalled_tool_files =",
      ),
    );
    expect(rolledBackValidator).toContain(
      'lock.fetch("coreMigrationHead").match?(/\\A[a-z0-9_]+\\z/)',
    );
    expect(rolledBackValidator).toContain('["control-plane", "worker"]');
    expect(rolledBackValidator).toContain("LATER_ORGANIZATION_EDIT");
    validateInstallation(root);
    writeFileSync(
      join(root, "scripts/validate-installation.rb"),
      rolledBackValidator.replace(
        'lock.fetch("coreMigrationHead").match?(/\\A[a-z0-9_]+\\z/)',
        'lock.fetch("coreMigrationHead").match?(/.*/)',
      ),
    );
    expect(() => validateInstallation(root)).toThrow(
      /Validator has an unrecognized release contract/,
    );
  });

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
    ).toContain('"readinessPath": "/readyz"');
    expect(snapshotOrganizationOwned(root)).toEqual(organizationBefore);

    expect(rollbackPlan({ root, planHash: upgraded.hash })).toEqual({
      status: "rolled-back",
      restored: ["aubos.lock.json", "host/aubos-runtime.json", "aubos.yaml"],
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
