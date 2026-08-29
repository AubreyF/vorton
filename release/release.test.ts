import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  migrationHead,
  parseImageArgument,
  parseImageReceipt,
  sha256,
  validateReleaseManifest,
} from "./release-lib.js";

const repositories: string[] = [];

function command(repository: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

function write(repository: string, path: string, content: string): void {
  const destination = join(repository, path);
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, content);
}

function commit(repository: string, message: string): string {
  command(repository, ["add", "."]);
  command(repository, ["commit", "-m", message]);
  return command(repository, ["rev-parse", "HEAD"]);
}

function fixture(): { repository: string; sourceCommit: string } {
  const repository = mkdtempSync(join(tmpdir(), "aubos-release-test-"));
  repositories.push(repository);
  command(repository, ["init", "-q"]);
  command(repository, ["config", "user.name", "Release Test"]);
  command(repository, ["config", "user.email", "release-test@example.invalid"]);
  write(
    repository,
    "packages/cli/package.json",
    `${JSON.stringify({ version: "0.1.0" })}\n`,
  );
  write(
    repository,
    "supabase/migrations/20260828000100_kernel.sql",
    "select 1;\n",
  );
  write(
    repository,
    "supabase/migrations/20260828000300_executive.sql",
    "select 3;\n",
  );
  write(repository, "templates/releases/0.1.0/host/runtime.json", "{}\n");
  return { repository, sourceCommit: commit(repository, "source") };
}

function manifest(sourceCommit: string, digest = `sha256:${"a".repeat(64)}`) {
  return {
    schemaVersion: 1,
    status: "released",
    version: "0.1.0",
    sourceCommit,
    createdAt: "2026-08-28T12:00:00.000Z",
    cliVersion: "0.1.0",
    contracts: { host: 1, module: 1, worker: 1 },
    coreMigrationHead: "20260828000300_executive",
    images: {
      "control-plane": {
        reference: `ghcr.io/aubreyf/aubos-control-plane@${digest}`,
        digest,
      },
      worker: {
        reference: `ghcr.io/aubreyf/aubos-worker@${digest}`,
        digest,
      },
    },
    managedFiles: [
      {
        path: "host/runtime.json",
        template: "templates/releases/0.1.0/host/runtime.json",
        digest: sha256("{}\n"),
      },
    ],
  };
}

afterEach(() => {
  repositories.length = 0;
});

describe("immutable release contracts", () => {
  it("pins workflow dependencies and verifies private-repository image evidence", () => {
    const buildWorkflow = readFileSync(
      join(process.cwd(), ".github/workflows/build-release-images.yml"),
      "utf8",
    );
    const releaseWorkflow = readFileSync(
      join(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );
    const actions = [
      ...`${buildWorkflow}\n${releaseWorkflow}`.matchAll(/uses:\s+([^\s#]+)/g),
    ].map((match) => match[1]!);

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(/@[a-f0-9]{40}$/);
    }
    expect(buildWorkflow).toContain("org.opencontainers.image.revision");
    expect(buildWorkflow).toContain("provenance: mode=max");
    expect(buildWorkflow).toContain("sbom: true");
    expect(releaseWorkflow).toContain(".Image.config.Labels");
    expect(releaseWorkflow).toContain("{{json .Provenance}}");
    expect(releaseWorkflow).toContain("{{json .SBOM}}");
    expect(buildWorkflow).not.toContain("actions/attest@");
    expect(releaseWorkflow).not.toContain("actions/attest@");
  });

  it("accepts only explicit digest-pinned GHCR image inputs", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      parseImageArgument(
        `control-plane=ghcr.io/aubreyf/aubos-control-plane@${digest}`,
      ),
    ).toEqual({
      name: "control-plane",
      reference: `ghcr.io/aubreyf/aubos-control-plane@${digest}`,
      digest,
    });
    expect(() =>
      parseImageArgument(
        "control-plane=ghcr.io/aubreyf/aubos-control-plane:latest",
      ),
    ).toThrow(/pinned by sha256/);
  });

  it("binds the external image receipt to source and version", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const receipt = JSON.stringify({
      sourceCommit: "b".repeat(40),
      version: "0.1.0",
      images: {
        "control-plane": `ghcr.io/aubreyf/aubos-control-plane@${digest}`,
        worker: `ghcr.io/aubreyf/aubos-worker@${digest}`,
      },
    });
    expect(
      Object.keys(parseImageReceipt(receipt, "b".repeat(40), "0.1.0")).sort(),
    ).toEqual(["control-plane", "worker"]);
    expect(() => parseImageReceipt(receipt, "c".repeat(40), "0.1.0")).toThrow(
      /source commit/,
    );
  });

  it("derives the current migration head from the exact source commit", () => {
    const { repository, sourceCommit } = fixture();
    expect(migrationHead(repository, sourceCommit)).toBe(
      "20260828000300_executive",
    );
  });

  it("accepts a manifest-only release child bound to its source parent", () => {
    const { repository, sourceCommit } = fixture();
    const manifestPath = join(repository, "release/manifests/0.1.0.json");
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(manifest(sourceCommit), null, 2)}\n`,
    );
    const releaseCommit = commit(repository, "release: v0.1.0");

    expect(
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
        releaseCommit,
      }).version,
    ).toBe("0.1.0");
  });

  it("fails closed on migration, managed-file, and release-commit drift", () => {
    const { repository, sourceCommit } = fixture();
    const invalid = manifest(sourceCommit);
    invalid.coreMigrationHead = "20260828000100_kernel";
    invalid.managedFiles[0]!.digest = `sha256:${"b".repeat(64)}`;
    const manifestPath = join(repository, "release/manifests/0.1.0.json");
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(invalid, null, 2)}\n`,
    );
    write(repository, "unexpected.txt", "release commit drift\n");
    const releaseCommit = commit(repository, "invalid release");

    expect(() =>
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
        releaseCommit,
      }),
    ).toThrow(/migration head mismatch/i);

    invalid.coreMigrationHead = "20260828000300_executive";
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(invalid, null, 2)}\n`,
    );
    expect(() =>
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
      }),
    ).toThrow(/template digest mismatch/i);
  });

  it("rejects a release commit containing anything besides its manifest", () => {
    const { repository, sourceCommit } = fixture();
    const manifestPath = join(repository, "release/manifests/0.1.0.json");
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(manifest(sourceCommit), null, 2)}\n`,
    );
    write(repository, "unexpected.txt", "release commit drift\n");
    const releaseCommit = commit(repository, "release with extra file");

    expect(() =>
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
        releaseCommit,
      }),
    ).toThrow(/may change only/);
  });
});
