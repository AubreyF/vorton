import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyPlan,
  hashPlan,
  planInit,
  planUpgrade,
  rollbackPlan,
} from "./index.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const roots: string[] = [];

function syntheticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aubos-distribution-"));
  roots.push(root);
  return root;
}

function manifest(version: string): string {
  return join(
    repositoryRoot,
    "packages/cli/test-fixtures/releases",
    `${version}.json`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("installation distribution", () => {
  it("refuses candidate manifests outside the explicit fixture path", () => {
    const root = syntheticRoot();

    expect(() =>
      planInit({
        root,
        organization: "Release Guard",
        releaseManifestPath: manifest("0.1.0"),
        releaseRoot: repositoryRoot,
      }),
    ).toThrow(/is candidate, not released/);
  });

  it("produces a stable exact hash and applies idempotently without release inputs", () => {
    const root = syntheticRoot();
    const first = planInit({
      root,
      organization: "Moonbase Laboratory",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const second = planInit({
      root,
      organization: "Moonbase Laboratory",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });

    expect(second.hash).toBe(first.hash);
    expect(hashPlan(first.plan)).toBe(first.hash);

    // Apply consumes the embedded, hash-verified plan. It does not read a release
    // manifest or template and therefore cannot fetch a moving artifact.
    const result = applyPlan({ root, planHash: first.hash });
    expect(result.status).toBe("applied");
    expect(applyPlan({ root, planHash: first.hash }).status).toBe(
      "already-applied",
    );
    expect(readFileSync(join(root, "aubos.lock.json"), "utf8")).toContain(
      '"version": "0.1.0"',
    );
    expect(
      readFileSync(join(root, "host/aubos-runtime.json"), "utf8"),
    ).toContain('"workLeaseProtocol": 1');
  });

  it("detects a preimage collision before changing installation files", () => {
    const root = syntheticRoot();
    const planned = planInit({
      root,
      organization: "Collision Test",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    mkdirSync(join(root, "host"), { recursive: true });
    writeFileSync(join(root, "host/aubos-runtime.json"), "organization data\n");

    expect(() => applyPlan({ root, planHash: planned.hash })).toThrow(
      /Preimage conflict at host\/aubos-runtime\.json/,
    );
    expect(readFileSync(join(root, "host/aubos-runtime.json"), "utf8")).toBe(
      "organization data\n",
    );
    expect(existsSync(join(root, "aubos.yaml"))).toBe(false);
  });

  it("upgrades only managed files and rolls back exact unchanged postimages", () => {
    const root = syntheticRoot();
    const initialized = planInit({
      root,
      organization: "Rollback Observatory",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    const originalHost = readFileSync(
      join(root, "host/aubos-runtime.json"),
      "utf8",
    );
    const originalLock = readFileSync(join(root, "aubos.lock.json"), "utf8");
    const identityPath = join(root, "organization/identity.yaml");
    writeFileSync(
      identityPath,
      `${readFileSync(identityPath, "utf8")}# owner edit\n`,
    );
    expect(applyPlan({ root, planHash: initialized.hash }).status).toBe(
      "already-applied",
    );

    const upgraded = planUpgrade({
      root,
      releaseManifestPath: manifest("0.1.1"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: upgraded.hash });
    expect(
      readFileSync(join(root, "host/aubos-runtime.json"), "utf8"),
    ).toContain('"readinessPath": "/api/ready"');

    const rolledBack = rollbackPlan({ root, planHash: upgraded.hash });
    expect(rolledBack.restored.sort()).toEqual(
      ["aubos.lock.json", "host/aubos-runtime.json"].sort(),
    );
    expect(readFileSync(join(root, "host/aubos-runtime.json"), "utf8")).toBe(
      originalHost,
    );
    expect(readFileSync(join(root, "aubos.lock.json"), "utf8")).toBe(
      originalLock,
    );
    expect(readFileSync(identityPath, "utf8")).toContain("# owner edit");
  });

  it("refuses to adopt a preexisting managed path", () => {
    const root = syntheticRoot();
    mkdirSync(join(root, "host"), { recursive: true });
    writeFileSync(join(root, "host/aubos-runtime.json"), "owner file\n");

    expect(() =>
      planInit({
        root,
        organization: "Ownership Guard",
        releaseManifestPath: manifest("0.1.0"),
        releaseRoot: repositoryRoot,
        allowCandidate: true,
      }),
    ).toThrow(/Initial adoption collision/);
    expect(readFileSync(join(root, "host/aubos-runtime.json"), "utf8")).toBe(
      "owner file\n",
    );
  });

  it("refuses rollback when any managed postimage changed", () => {
    const root = syntheticRoot();
    const initialized = planInit({
      root,
      organization: "Postimage Guard",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    applyPlan({ root, planHash: initialized.hash });
    writeFileSync(join(root, "host/aubos-runtime.json"), "manual change\n");

    expect(() => rollbackPlan({ root, planHash: initialized.hash })).toThrow(
      /Rollback postimage conflict/,
    );
    expect(readFileSync(join(root, "host/aubos-runtime.json"), "utf8")).toBe(
      "manual change\n",
    );
  });

  it("rejects a plan whose bytes no longer match its requested hash", () => {
    const root = syntheticRoot();
    const planned = planInit({
      root,
      organization: "Hash Guard",
      releaseManifestPath: manifest("0.1.0"),
      releaseRoot: repositoryRoot,
      allowCandidate: true,
    });
    const stored = JSON.parse(readFileSync(planned.path, "utf8")) as {
      installation: { displayName: string };
    };
    stored.installation.displayName = "Tampered";
    writeFileSync(planned.path, JSON.stringify(stored));

    expect(() => applyPlan({ root, planHash: planned.hash })).toThrow(
      /Plan hash mismatch/,
    );
  });
});
