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
import { stageContractArchive } from "./stage-contract-archive.js";

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
        reference: `ghcr.io/moonbase-labs/aubos-control-plane@${digest}`,
        digest,
      },
      worker: {
        reference: `ghcr.io/moonbase-labs/aubos-worker@${digest}`,
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

function schemaV2Manifest(
  sourceCommit: string,
  digest = `sha256:${"a".repeat(64)}`,
) {
  return {
    ...manifest(sourceCommit, digest),
    schemaVersion: 2,
    images: {
      ...manifest(sourceCommit, digest).images,
      web: {
        reference: `ghcr.io/moonbase-labs/aubos-web@${digest}`,
        digest,
      },
    },
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
    const ciWorkflow = readFileSync(
      join(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const releasePreflight = readFileSync(
      join(process.cwd(), "release/preflight-release.ts"),
      "utf8",
    );
    const manifestJsonSchema = JSON.parse(
      readFileSync(
        join(process.cwd(), "release/release-manifest.schema.json"),
        "utf8",
      ),
    ) as {
      properties: {
        schemaVersion: { enum: number[] };
        images: {
          additionalProperties: {
            properties: { reference: { pattern: string } };
          };
        };
        managedFiles: { minItems?: number };
      };
      allOf: Array<{
        if: {
          properties: {
            schemaVersion: { const: number };
            status: { const: string };
          };
        };
        then: {
          properties: {
            images: {
              required: string[];
              additionalProperties: {
                properties: { reference: { pattern: string } };
              };
            };
          };
        };
      }>;
    };
    const actions = [
      ...`${buildWorkflow}\n${releaseWorkflow}\n${ciWorkflow}`.matchAll(
        /uses:\s+([^\s#]+)/g,
      ),
    ].map((match) => match[1]!);

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toMatch(/@[a-f0-9]{40}$/);
    }
    expect(ciWorkflow).toMatch(
      /actions\/checkout@[a-f0-9]{40}[\s\S]*?fetch-depth:\s*0/,
    );
    expect(buildWorkflow).toContain("org.opencontainers.image.revision");
    expect(buildWorkflow).toContain("apps/web/Dockerfile");
    expect(buildWorkflow).toContain("aubos-web");
    expect(buildWorkflow).toContain("web.spdx.json");
    expect(buildWorkflow).toContain("provenance: mode=max");
    expect(buildWorkflow).toContain("sbom: true");
    expect(releaseWorkflow).toContain("workflow_dispatch:");
    expect(releaseWorkflow).toContain("image: postgres:16");
    expect(releaseWorkflow).toContain(
      "AUBOS_AUTHORITY_TEST_DATABASE_URL: postgresql://postgres:synthetic-admin-password-000000000001@127.0.0.1:5432/aubos_authority",
    );
    const postgresAuthorityGate = releaseWorkflow.indexOf(
      "run: npm run test:postgres-authority",
    );
    expect(postgresAuthorityGate).toBeGreaterThan(-1);
    expect(postgresAuthorityGate).toBeLessThan(
      releaseWorkflow.indexOf(
        "name: Publish or recover the exact GitHub Release",
      ),
    );
    expect(releaseWorkflow).toContain(
      'git show-ref --verify "refs/tags/$TAG_NAME"',
    );
    expect(releasePreflight).toContain(".Image.Config.Labels");
    expect(releasePreflight).toContain("{{json .Provenance}}");
    expect(releasePreflight).toContain("{{json .SBOM}}");
    expect(releaseWorkflow).toContain("stage-contract-archive.ts");
    expect(releaseWorkflow).toContain("--sort=name --mtime='@0'");
    expect(releaseWorkflow).toContain("--owner=0 --group=0 --numeric-owner");
    expect(releaseWorkflow).toContain(
      '--repository-owner "${{ github.repository_owner }}"',
    );
    expect(buildWorkflow).not.toContain("actions/attest@");
    expect(releaseWorkflow).not.toContain("actions/attest@");
    expect(manifestJsonSchema.properties.managedFiles.minItems).toBe(1);
    expect(manifestJsonSchema.properties.schemaVersion.enum).toEqual([1, 2]);
    expect(
      manifestJsonSchema.allOf.map((condition) => ({
        schemaVersion: condition.if.properties.schemaVersion.const,
        status: condition.if.properties.status.const,
        images: condition.then.properties.images.required,
      })),
    ).toEqual([
      {
        schemaVersion: 1,
        status: "released",
        images: ["control-plane", "worker"],
      },
      {
        schemaVersion: 2,
        status: "released",
        images: ["control-plane", "web", "worker"],
      },
    ]);
    const fixtureReference = `registry.invalid/aubos-fixture/control-plane@sha256:${"1".repeat(64)}`;
    expect(
      new RegExp(
        manifestJsonSchema.properties.images.additionalProperties.properties
          .reference.pattern,
      ).test(fixtureReference),
    ).toBe(true);
    expect(
      new RegExp(
        manifestJsonSchema.allOf[0]!.then.properties.images.additionalProperties
          .properties.reference.pattern,
      ).test(fixtureReference),
    ).toBe(false);
  });

  it("accepts only normalized digest-pinned OCI image inputs", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      parseImageArgument(
        `control-plane=ghcr.io/moonbase-labs/aubos-control-plane@${digest}`,
      ),
    ).toEqual({
      name: "control-plane",
      reference: `ghcr.io/moonbase-labs/aubos-control-plane@${digest}`,
      digest,
    });
    expect(() =>
      parseImageArgument(
        "control-plane=ghcr.io/moonbase-labs/aubos-control-plane:latest",
      ),
    ).toThrow(/pinned by sha256/);
  });

  it("runs the documented bootstrap plan from only an extracted contract archive", async () => {
    const root = mkdtempSync(join(tmpdir(), "aubos-contract-archive-test-"));
    const staged = join(root, "staged");
    const extracted = join(root, "extracted");
    const archive = join(root, "contracts.tgz");
    await stageContractArchive(staged);
    mkdirSync(extracted);

    execFileSync("tar", ["-czf", archive, "-C", staged, "."]);
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);
    expect(
      readFileSync(
        join(extracted, "packages/executive/roles/strategic-reviewer/SKILL.md"),
        "utf8",
      ),
    ).toContain("# Strategic reviewer");
    expect(
      readFileSync(
        join(extracted, "supabase/migrations/20260828000300_executive.sql"),
        "utf8",
      ),
    ).toContain("create table public.worker_runs");
    expect(
      readFileSync(
        join(
          extracted,
          "supabase/migrations/20260828000400_runtime_authority.sql",
        ),
        "utf8",
      ),
    ).toContain("aubos_private.runtime_context_keys");

    const canary = join(extracted, "bin/hindsight-canary.cjs");
    let canaryFailure = "";
    try {
      execFileSync("node", [canary], {
        cwd: extracted,
        env: { PATH: process.env.PATH },
        stdio: "pipe",
      });
    } catch (error) {
      canaryFailure = String((error as { stderr?: Buffer }).stderr ?? error);
    }
    expect(canaryFailure).toContain(
      "Hindsight release canary failed: AUBOS_HINDSIGHT_URL is required",
    );

    const cli = join(extracted, "bin/aubos.cjs");
    const installation = join(root, "installation");
    const extractionManifest = join(root, "extraction-release.json");
    mkdirSync(installation);
    const hostTemplate = "templates/releases/0.3.0/host/aubos-runtime.json";
    const extractionRelease = {
      schemaVersion: 2,
      status: "released",
      version: "0.3.0",
      sourceCommit: "c".repeat(40),
      createdAt: "2026-08-28T12:00:00.000Z",
      cliVersion: "0.3.0",
      contracts: { host: 1, module: 1, worker: 1 },
      coreMigrationHead: "20260828000400_runtime_authority",
      images: {
        "control-plane": {
          reference: `ghcr.io/moonbase-labs/aubos-control-plane@sha256:${"3".repeat(64)}`,
          digest: `sha256:${"3".repeat(64)}`,
        },
        web: {
          reference: `ghcr.io/moonbase-labs/aubos-web@sha256:${"4".repeat(64)}`,
          digest: `sha256:${"4".repeat(64)}`,
        },
        worker: {
          reference: `ghcr.io/moonbase-labs/aubos-worker@sha256:${"5".repeat(64)}`,
          digest: `sha256:${"5".repeat(64)}`,
        },
      },
      managedFiles: [
        {
          path: "host/aubos-runtime.json",
          template: hostTemplate,
          digest: sha256(readFileSync(join(extracted, hostTemplate))),
        },
      ],
    };
    writeFileSync(
      extractionManifest,
      `${JSON.stringify(extractionRelease, null, 2)}\n`,
    );
    const cliPlanOutput = execFileSync(
      "node",
      [
        cli,
        "init",
        "plan",
        "--organization",
        "Ion Lab",
        "--manifest",
        extractionManifest,
        "--artifact-root",
        extracted,
        "--root",
        installation,
      ],
      { cwd: extracted, encoding: "utf8" },
    );
    const cliPlanHash = cliPlanOutput.trim().split("\n")[0]!;
    expect(cliPlanHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    execFileSync(
      "node",
      [cli, "init", "apply", "--plan", cliPlanHash, "--root", installation],
      { cwd: extracted, stdio: "pipe" },
    );
    expect(
      execFileSync("node", [cli, "validate", "--root", installation], {
        cwd: extracted,
        encoding: "utf8",
      }),
    ).toBe("valid\n");
    expect(
      readFileSync(join(installation, "deploy/hindsight.fly.toml"), "utf8"),
    ).toContain('HINDSIGHT_API_WORKER_ID = "ion-lab-memory"');

    writeFileSync(
      extractionManifest,
      `${JSON.stringify(
        { ...extractionRelease, cliVersion: "9.9.9" },
        null,
        2,
      )}\n`,
    );
    let mismatch = "";
    try {
      execFileSync(
        "node",
        [
          cli,
          "upgrade",
          "plan",
          "--manifest",
          extractionManifest,
          "--artifact-root",
          extracted,
          "--root",
          installation,
        ],
        { cwd: extracted, stdio: "pipe" },
      );
    } catch (error) {
      mismatch = String((error as { stderr?: Buffer }).stderr ?? error);
    }
    expect(mismatch).toContain(
      "requires AubOS CLI 9.9.9, but the running CLI is 0.3.0",
    );

    execFileSync(
      "npm",
      ["ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
      { cwd: extracted, stdio: "pipe" },
    );
    const plan = JSON.parse(
      execFileSync("npm", ["run", "--silent", "bootstrap:plan"], {
        cwd: extracted,
        encoding: "utf8",
        env: {
          ...process.env,
          AUBOS_BOOTSTRAP_AUTH_USER_ID: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
          AUBOS_WORKER_PROVIDER: "openai-responses",
          AUBOS_WORKER_MODEL: "gpt-5.4",
          AUBOS_OPENAI_MODEL: "gpt-5.4",
        },
      }),
    ) as Record<string, unknown>;

    expect(plan).toMatchObject({
      operation: "bootstrap-organizational-installation",
      effects: "none",
      executiveBinding: {
        provider: "openai-responses",
        mode: "recommend",
      },
    });
  });

  it("binds the external image receipt to source and version", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const receipt = JSON.stringify({
      sourceCommit: "b".repeat(40),
      version: "0.1.0",
      images: {
        "control-plane": `ghcr.io/moonbase-labs/aubos-control-plane@${digest}`,
        web: `ghcr.io/moonbase-labs/aubos-web@${digest}`,
        worker: `ghcr.io/moonbase-labs/aubos-worker@${digest}`,
      },
    });
    expect(
      Object.keys(
        parseImageReceipt(receipt, "b".repeat(40), "0.1.0", "moonbase-labs"),
      ).sort(),
    ).toEqual(["control-plane", "web", "worker"]);
    expect(() =>
      parseImageReceipt(receipt, "c".repeat(40), "0.1.0", "moonbase-labs"),
    ).toThrow(/source commit/);
  });

  it("rejects image receipts from third-party GHCR repositories", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const receipt = JSON.stringify({
      sourceCommit: "b".repeat(40),
      version: "0.1.0",
      images: {
        "control-plane": `ghcr.io/attacker/not-control@${digest}`,
        web: `ghcr.io/attacker/not-web@${digest}`,
        worker: `ghcr.io/attacker/not-worker@${digest}`,
      },
    });

    expect(() =>
      parseImageReceipt(receipt, "b".repeat(40), "0.1.0", "moonbase-labs"),
    ).toThrow(/ghcr\.io\/moonbase-labs\/aubos-control-plane/);
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
        expectedRepositoryOwner: "moonbase-labs",
        releaseCommit,
      }).version,
    ).toBe("0.1.0");
  });

  it("requires the canonical web image in schema v2 releases", () => {
    const { repository, sourceCommit } = fixture();
    const manifestPath = join(repository, "release/manifests/0.1.0.json");
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(schemaV2Manifest(sourceCommit), null, 2)}\n`,
    );

    expect(
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
        expectedRepositoryOwner: "moonbase-labs",
      }).schemaVersion,
    ).toBe(2);

    const missingWeb = schemaV2Manifest(sourceCommit);
    delete (missingWeb.images as Partial<typeof missingWeb.images>).web;
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(missingWeb, null, 2)}\n`,
    );
    expect(() =>
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
        expectedRepositoryOwner: "moonbase-labs",
      }),
    ).toThrow(/control-plane, web, worker/);
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
        expectedRepositoryOwner: "moonbase-labs",
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
        expectedRepositoryOwner: "moonbase-labs",
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
        expectedRepositoryOwner: "moonbase-labs",
        releaseCommit,
      }),
    ).toThrow(/may change only/);
  });

  it("rejects released manifests that point image roles at third-party repositories", () => {
    const { repository, sourceCommit } = fixture();
    const invalid = manifest(sourceCommit);
    const digest = invalid.images["control-plane"].digest;
    invalid.images["control-plane"].reference =
      `ghcr.io/attacker/not-control@${digest}`;
    const manifestPath = join(repository, "release/manifests/0.1.0.json");
    write(
      repository,
      "release/manifests/0.1.0.json",
      `${JSON.stringify(invalid, null, 2)}\n`,
    );

    expect(() =>
      validateReleaseManifest({
        repositoryRoot: repository,
        manifestPath,
        expectedRepositoryOwner: "moonbase-labs",
      }),
    ).toThrow(/ghcr\.io\/moonbase-labs\/aubos-control-plane/);
  });
});
