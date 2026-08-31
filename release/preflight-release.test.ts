import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256 } from "./release-lib.js";
import { writeWorkspaceReleaseEvidenceFixture } from "./workspace-release-evidence.test-helpers.js";
import {
  normalizeSpdxDocument,
  normalizeSpdxFile,
  parseCliHindsightImageReference,
  parseHindsightImageReference,
  requireHindsightPlatforms,
  runReleasePreflight,
  type OciInspector,
} from "./preflight-release.js";

function command(repository: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

function releaseDiscoveryScript(workflow: string): string {
  const startMarker = "          # BEGIN bounded release discovery";
  const endMarker = "          # END bounded release discovery";
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new Error("bounded release discovery markers are required");
  }
  return workflow
    .slice(start + startMarker.length, end)
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
}

interface ReleaseDiscoveryRun {
  apiCount: number;
  createCount: number;
  matching: unknown[];
  sleepCalls: string[];
  succeeded: boolean;
}

function fileCount(path: string): number {
  return existsSync(path) ? Number(readFileSync(path, "utf8").trim()) : 0;
}

function runReleaseDiscovery(
  listings: readonly unknown[],
  options: { repository?: string; workflow?: string } = {},
): ReleaseDiscoveryRun {
  const repository =
    options.repository ?? mkdtempSync(join(tmpdir(), "vorton-discovery-test-"));
  const workflow =
    options.workflow ??
    readFileSync(join(process.cwd(), ".github/workflows/release.yml"), "utf8");
  const fakeBin = join(repository, "fake-bin");
  mkdirSync(fakeBin, { recursive: true });
  const listingsFile = join(repository, "fake-release-listings.jsonl");
  const apiCountFile = join(repository, "fake-api-count");
  const createCountFile = join(repository, "fake-create-count");
  const sleepLog = join(repository, "fake-sleep-log");
  writeFileSync(
    listingsFile,
    `${listings.map((listing) => JSON.stringify(listing)).join("\n")}\n`,
  );
  writeFileSync(
    join(fakeBin, "gh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "$1" = "api" ]; then',
      '  count=$(test -f "$FAKE_GH_API_COUNT" && cat "$FAKE_GH_API_COUNT" || printf 0)',
      "  count=$((count + 1))",
      '  printf "%s\\n" "$count" > "$FAKE_GH_API_COUNT"',
      '  sed -n "${count}p" "$FAKE_GH_LISTINGS"',
      'elif [ "$1" = "release" ] && [ "$2" = "create" ]; then',
      '  count=$(test -f "$FAKE_GH_CREATE_COUNT" && cat "$FAKE_GH_CREATE_COUNT" || printf 0)',
      "  count=$((count + 1))",
      '  printf "%s\\n" "$count" > "$FAKE_GH_CREATE_COUNT"',
      "else",
      '  printf "unexpected gh invocation: %s\\n" "$*" >&2',
      "  exit 99",
      "fi",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(fakeBin, "sleep"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "$1" >> "$FAKE_SLEEP_LOG"',
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeBin, "gh"), 0o755);
  chmodSync(join(fakeBin, "sleep"), 0o755);
  const script = join(repository, "run-release-discovery.sh");
  writeFileSync(
    script,
    `set -euo pipefail\n${releaseDiscoveryScript(workflow)}\n`,
  );

  let succeeded = true;
  try {
    execFileSync("bash", [script], {
      cwd: repository,
      env: {
        ...process.env,
        FAKE_GH_API_COUNT: apiCountFile,
        FAKE_GH_CREATE_COUNT: createCountFile,
        FAKE_GH_LISTINGS: listingsFile,
        FAKE_SLEEP_LOG: sleepLog,
        GITHUB_REPOSITORY: "moonbase-labs/vorton",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        TAG_NAME: "v0.3.0",
      },
      stdio: "pipe",
    });
  } catch {
    succeeded = false;
  }

  const matchingPath = join(repository, "matching-releases.json");
  return {
    apiCount: fileCount(apiCountFile),
    createCount: fileCount(createCountFile),
    matching: existsSync(matchingPath)
      ? (JSON.parse(readFileSync(matchingPath, "utf8")) as unknown[])
      : [],
    sleepCalls: existsSync(sleepLog)
      ? readFileSync(sleepLog, "utf8").trim().split("\n")
      : [],
    succeeded,
  };
}

function releaseFixture(
  cliDigest = "9",
  createdAt = "2026-08-29T12:00:00.000Z",
): {
  repository: string;
  releaseCommit: string;
  sourceCommit: string;
  producerGh: string;
} {
  const repository = mkdtempSync(join(tmpdir(), "vorton-preflight-test-"));
  command(repository, ["init", "-q"]);
  command(repository, ["config", "user.name", "Release Test"]);
  command(repository, ["config", "user.email", "release-test@example.invalid"]);
  write(
    repository,
    "packages/cli/package.json",
    `${JSON.stringify({ version: "1.2.3" })}\n`,
  );
  write(
    repository,
    "packages/cli/src/index.ts",
    `const HINDSIGHT_IMAGE =\n  "ghcr.io/vectorize-io/hindsight@sha256:${cliDigest.repeat(64)}";\n`,
  );
  write(
    repository,
    "supabase/migrations/20260829000100_test.sql",
    "select 1;\n",
  );
  write(repository, "templates/releases/1.2.3/host/runtime.json", "{}\n");
  write(
    repository,
    "deploy/fly/runtime/hindsight.fly.toml",
    `[build]\n  image = "ghcr.io/vectorize-io/hindsight@sha256:${"9".repeat(64)}"\n`,
  );
  const sourceCommit = commit(repository, "source");
  const workspace = writeWorkspaceReleaseEvidenceFixture({
    repository,
    version: "1.2.3",
    sourceCommit,
    migrationHead: "20260829000100_test",
  });
  const fakeBin = mkdtempSync(join(tmpdir(), "vorton-producer-bin-"));
  const artifact = mkdtempSync(join(tmpdir(), "vorton-producer-artifact-"));
  writeFileSync(
    join(artifact, "workspace-producer-attestation.json"),
    workspace.producerAttestation.indexBytes,
  );
  for (const [path, bytes] of workspace.producerAttestation.files) {
    const destination = join(artifact, path);
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, bytes);
  }
  writeFileSync(
    join(fakeBin, "gh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [ "$1" = "api" ] && [[ "$4" != *"/artifacts?"* ]]; then',
      `  printf '%s\\n' '${JSON.stringify({ id: 123, repository: { full_name: "AubreyF/vorton" }, path: ".github/workflows/workspace-isolation-proof.yml", head_sha: sourceCommit, conclusion: "success", html_url: "https://github.com/AubreyF/vorton/actions/runs/123" })}'`,
      'elif [ "$1" = "api" ]; then',
      `  printf '%s\\n' '${JSON.stringify({ total_count: 1, artifacts: [{ name: "vorton-workspace-isolation-evidence", expired: false, workflow_run: { id: 123, head_sha: sourceCommit } }] })}'`,
      'elif [ "$1" = "run" ] && [ "$2" = "download" ]; then',
      '  destination="${@: -1}"',
      `  cp -R '${artifact}/.' "$destination/"`,
      "else exit 99; fi",
      "",
    ].join("\n"),
  );
  const producerGh = join(fakeBin, "gh");
  chmodSync(producerGh, 0o755);
  process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
  const digest = `sha256:${"a".repeat(64)}`;
  write(
    repository,
    "release/manifests/1.2.3.json",
    `${JSON.stringify(
      {
        schemaVersion: 2,
        status: "released",
        version: "1.2.3",
        sourceCommit,
        createdAt,
        cliVersion: "1.2.3",
        contracts: {
          host: 1,
          module: 1,
          worker: 1,
          ...workspace.contracts,
        },
        coreMigrationHead: "20260829000100_test",
        evidence: workspace.evidence,
        images: Object.fromEntries(
          ["control-plane", "web", "worker"].map((name) => [
            name,
            {
              reference: `ghcr.io/moonbase-labs/vorton-${name}@${digest}`,
              digest,
            },
          ]),
        ),
        managedFiles: [
          {
            path: "host/runtime.json",
            template: "templates/releases/1.2.3/host/runtime.json",
            digest: sha256("{}\n"),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const releaseCommit = commit(repository, "prepare release");
  return { repository, releaseCommit, sourceCommit, producerGh };
}

function inspector(sourceCommit: string): OciInspector {
  return {
    format(_reference, template) {
      if (template.includes("Labels")) {
        return JSON.stringify({
          "org.opencontainers.image.revision": sourceCommit,
        });
      }
      if (
        template ===
          "{{with .Provenance.SLSA.builder}}{{json .}}{{else}}null{{end}}" ||
        template ===
          "{{with .Provenance.SLSA.buildType}}{{json .}}{{else}}null{{end}}"
      ) {
        return "null";
      }
      if (
        template ===
        "{{with .Provenance.SLSA.runDetails}}{{with .builder}}{{json .}}{{else}}null{{end}}{{else}}null{{end}}"
      ) {
        return JSON.stringify({ id: "synthetic-builder" });
      }
      if (
        template ===
        "{{with .Provenance.SLSA.buildDefinition}}{{with .buildType}}{{json .}}{{else}}null{{end}}{{else}}null{{end}}"
      ) {
        return JSON.stringify(
          "https://github.com/moby/buildkit/blob/master/docs/attestations/slsa-definitions.md",
        );
      }
      if (template === "{{.SBOM.SPDX.spdxVersion}}") {
        return "SPDX-2.3";
      }
      if (template === "{{.SBOM.SPDX.SPDXID}}") {
        return "SPDXRef-DOCUMENT";
      }
      if (template === "{{.SBOM.SPDX.dataLicense}}") {
        return "CC0-1.0";
      }
      if (template === "{{json .SBOM.SPDX.creationInfo}}") {
        return JSON.stringify({
          created: "2026-08-29T12:00:00Z",
          creators: ["Tool: synthetic-syft"],
        });
      }
      if (template === "{{len .SBOM.SPDX.packages}}") return "1";
      throw new Error(`Unexpected unbounded evidence template: ${template}`);
    },
    raw() {
      return JSON.stringify({
        schemaVersion: 2,
        manifests: [
          { platform: { os: "linux", architecture: "amd64" } },
          { platform: { os: "linux", architecture: "arm64" } },
        ],
      });
    },
  };
}

describe("release preflight", () => {
  it("refuses publication when producer provenance cannot be independently reverified", () => {
    const fixture = releaseFixture();
    writeFileSync(fixture.producerGh, "#!/usr/bin/env bash\nexit 77\n");
    expect(() =>
      runReleasePreflight({
        repositoryRoot: fixture.repository,
        releaseCommit: fixture.releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: inspector(fixture.sourceCommit),
      }),
    ).toThrow(/could not be verified through GitHub/);
  });

  it("normalizes Syft entropy and SPDX set ordering into stable release bytes", () => {
    const identity = {
      artifactDigest: `sha256:${"b".repeat(64)}`,
      artifactName: "vorton-1.2.3-contracts.tgz",
      createdAt: "2026-08-29T12:00:00.000Z",
      version: "1.2.3",
    };
    const first = {
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      dataLicense: "CC0-1.0",
      name: "vorton-1.2.3-contracts.tgz",
      documentNamespace: "https://anchore.com/syft/random-one",
      creationInfo: {
        creators: ["Tool: syft", "Organization: Anchore, Inc"],
        created: "2026-08-29T12:01:00Z",
      },
      packages: [
        {
          SPDXID: "SPDXRef-B",
          checksums: [
            { algorithm: "SHA1", checksumValue: "2" },
            { algorithm: "MD5", checksumValue: "1" },
          ],
          fileContributors: ["B", "A"],
          hasFiles: ["SPDXRef-File-B", "SPDXRef-File-A"],
        },
        {
          SPDXID: "SPDXRef-A",
          name: "vorton-1.2.3-contracts.tgz",
          checksums: [
            { algorithm: "SHA256", checksumValue: "b".repeat(64) },
            { algorithm: "SHA1", checksumValue: "3" },
          ],
          fileContributors: ["D", "C"],
          hasFiles: ["SPDXRef-File-D", "SPDXRef-File-C"],
        },
      ],
      hasExtractedLicensingInfos: [
        { licenseId: "LicenseRef-A", crossRefs: ["https://b", "https://a"] },
      ],
      snippets: [
        {
          SPDXID: "SPDXRef-Snippet-A",
          ranges: [{ endPointer: 2 }, { endPointer: 1 }],
        },
      ],
      relationships: [
        {
          spdxElementId: "SPDXRef-DOCUMENT",
          relatedSpdxElement: "SPDXRef-A",
          relationshipType: "DESCRIBES",
        },
        {
          spdxElementId: "SPDXRef-A",
          relatedSpdxElement: "SPDXRef-B",
          relationshipType: "DEPENDS_ON",
        },
      ],
    };
    const second = {
      relationships: [...first.relationships].reverse(),
      packages: [...first.packages].reverse().map((entry) => ({
        ...entry,
        checksums: [...entry.checksums].reverse(),
        fileContributors: [...entry.fileContributors].reverse(),
        hasFiles: [...entry.hasFiles].reverse(),
      })),
      hasExtractedLicensingInfos: [
        {
          ...first.hasExtractedLicensingInfos[0],
          crossRefs: [
            ...first.hasExtractedLicensingInfos[0]!.crossRefs,
          ].reverse(),
        },
      ],
      snippets: [
        {
          ...first.snippets[0],
          ranges: [...first.snippets[0]!.ranges].reverse(),
        },
      ],
      creationInfo: {
        created: "2026-08-29T12:02:00Z",
        creators: [...first.creationInfo.creators].reverse(),
      },
      documentNamespace: "https://anchore.com/syft/random-two",
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      dataLicense: "CC0-1.0",
      name: "vorton-1.2.3-contracts.tgz",
    };

    const normalized = normalizeSpdxDocument(first, identity);
    expect(normalizeSpdxDocument(second, identity)).toBe(normalized);
    expect(normalized).toContain(
      `"documentNamespace": "https://vorton.dev/releases/v1.2.3/sbom/sha256-${"b".repeat(64)}"`,
    );
    expect(normalized).toContain(`"created": "2026-08-29T12:00:00Z"`);
    expect(() =>
      normalizeSpdxDocument(first, {
        ...identity,
        createdAt: "2026-08-29T12:00:00.001Z",
      }),
    ).toThrow(/nonzero fractional seconds/);
    expect(() =>
      normalizeSpdxDocument(first, {
        ...identity,
        artifactDigest: `sha256:${"c".repeat(64)}`,
      }),
    ).toThrow(/SHA256 must match/);
  });

  it("binds normalized SPDX identity to the exact contract artifact bytes", () => {
    const { repository } = releaseFixture();
    const artifactPath = join(repository, "vorton-1.2.3-contracts.tgz");
    const sbomPath = join(repository, "vorton-1.2.3.spdx.json");
    const artifact = "synthetic contract artifact\n";
    const artifactDigest = sha256(artifact);
    writeFileSync(artifactPath, artifact);
    writeFileSync(
      sbomPath,
      JSON.stringify({
        spdxVersion: "SPDX-2.3",
        SPDXID: "SPDXRef-DOCUMENT",
        dataLicense: "CC0-1.0",
        name: "vorton-1.2.3-contracts.tgz",
        documentNamespace: "https://anchore.com/syft/random",
        creationInfo: {
          created: "2026-08-29T13:00:00Z",
          creators: ["Tool: syft-1.42.3"],
        },
        packages: [
          {
            SPDXID: "SPDXRef-DocumentRoot",
            name: "vorton-1.2.3-contracts.tgz",
            checksums: [
              {
                algorithm: "SHA256",
                checksumValue: artifactDigest.slice("sha256:".length),
              },
            ],
          },
        ],
        relationships: [
          {
            spdxElementId: "SPDXRef-DOCUMENT",
            relatedSpdxElement: "SPDXRef-DocumentRoot",
            relationshipType: "DESCRIBES",
          },
        ],
      }),
    );

    normalizeSpdxFile({
      artifactPath,
      manifestPath: join(repository, "release/manifests/1.2.3.json"),
      sbomPath,
    });

    expect(readFileSync(sbomPath, "utf8")).toContain(
      `"documentNamespace": "https://vorton.dev/releases/v1.2.3/sbom/${artifactDigest.replace(":", "-")}"`,
    );
  });

  it("binds the exact evidence-bearing release child to OCI evidence and Hindsight platforms", () => {
    const { repository, releaseCommit, sourceCommit } = releaseFixture();
    const result = runReleasePreflight({
      repositoryRoot: repository,
      releaseCommit,
      repositoryOwner: "moonbase-labs",
      version: "1.2.3",
      inspector: inspector(sourceCommit),
    });

    expect(result.releaseCommit).toBe(releaseCommit);
    expect(result.manifest.sourceCommit).toBe(sourceCommit);
    expect(result.hindsightReference).toBe(
      `ghcr.io/vectorize-io/hindsight@sha256:${"9".repeat(64)}`,
    );

    const legacyInspector = inspector(sourceCommit);
    legacyInspector.format = (reference, template) => {
      if (template.includes("SLSA.builder")) {
        return JSON.stringify({ id: "" });
      }
      if (template.includes("SLSA.buildType")) {
        return JSON.stringify("https://mobyproject.org/buildkit@v1");
      }
      if (
        template.includes("SLSA.runDetails") ||
        template.includes("SLSA.buildDefinition")
      ) {
        return "null";
      }
      return inspector(sourceCommit).format(reference, template);
    };
    expect(
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: legacyInspector,
      }).manifest.sourceCommit,
    ).toBe(sourceCommit);
  });

  it("fails closed on missing image evidence and Hindsight architectures", () => {
    const { repository, releaseCommit, sourceCommit } = releaseFixture();
    const missingProvenance = inspector(sourceCommit);
    missingProvenance.format = (reference, template) =>
      template.includes("Provenance")
        ? "null"
        : inspector(sourceCommit).format(reference, template);
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: missingProvenance,
      }),
    ).toThrow(/exactly one complete recognized BuildKit SLSA/);

    const malformedProvenance = inspector(sourceCommit);
    malformedProvenance.format = (reference, template) =>
      template.includes("runDetails")
        ? JSON.stringify({ unexpected: true })
        : inspector(sourceCommit).format(reference, template);
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: malformedProvenance,
      }),
    ).toThrow(/SLSA v1 builder must contain a string id/);

    const malformedBuildType = inspector(sourceCommit);
    malformedBuildType.format = (reference, template) =>
      template.includes("buildDefinition")
        ? JSON.stringify("synthetic-build-type")
        : inspector(sourceCommit).format(reference, template);
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: malformedBuildType,
      }),
    ).toThrow(/exactly one complete recognized BuildKit SLSA/);

    const mixedProvenance = inspector(sourceCommit);
    mixedProvenance.format = (reference, template) => {
      if (template.includes("SLSA.builder")) {
        return JSON.stringify({ id: "synthetic-legacy-builder" });
      }
      if (template.includes("SLSA.buildType")) {
        return JSON.stringify("https://mobyproject.org/buildkit@v1");
      }
      return inspector(sourceCommit).format(reference, template);
    };
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: mixedProvenance,
      }),
    ).toThrow(/exactly one complete recognized BuildKit SLSA/);

    const malformedSpdx = inspector(sourceCommit);
    malformedSpdx.format = (reference, template) =>
      template === "{{.SBOM.SPDX.spdxVersion}}"
        ? "SPDX-2.2"
        : inspector(sourceCommit).format(reference, template);
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: malformedSpdx,
      }),
    ).toThrow(/SBOM must use SPDX-2.3/);

    const malformedCreationInfo = inspector(sourceCommit);
    malformedCreationInfo.format = (reference, template) =>
      template === "{{json .SBOM.SPDX.creationInfo}}"
        ? JSON.stringify({ unexpected: true })
        : inspector(sourceCommit).format(reference, template);
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: malformedCreationInfo,
      }),
    ).toThrow(/creation info must contain a UTC created timestamp/);

    const missingSbomPackages = inspector(sourceCommit);
    missingSbomPackages.format = (reference, template) =>
      template === "{{len .SBOM.SPDX.packages}}"
        ? "0"
        : inspector(sourceCommit).format(reference, template);
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: missingSbomPackages,
      }),
    ).toThrow(/SBOM package count must be a positive integer/);

    expect(() =>
      requireHindsightPlatforms(
        JSON.stringify({
          manifests: [{ platform: { os: "linux", architecture: "amd64" } }],
        }),
      ),
    ).toThrow(/missing linux\/arm64/);

    const fractional = releaseFixture("9", "2026-08-29T12:00:00.001Z");
    expect(() =>
      runReleasePreflight({
        repositoryRoot: fractional.repository,
        releaseCommit: fractional.releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: inspector(fractional.sourceCommit),
      }),
    ).toThrow(/nonzero fractional seconds/);
  });

  it("requires a canonical digest-pinned Hindsight image", () => {
    expect(() =>
      parseHindsightImageReference(
        `[build]\nimage = "ghcr.io/vectorize-io/hindsight:latest"\n`,
      ),
    ).toThrow(/pinned by sha256 digest/);
    expect(() =>
      parseHindsightImageReference(
        `[build]\nimage = "ghcr.io/vectorize-io/hindsight@sha256:${"1".repeat(64)}"\nimage = "ghcr.io/vectorize-io/hindsight@sha256:${"2".repeat(64)}"\n`,
      ),
    ).toThrow(/exactly one/);
    expect(
      parseCliHindsightImageReference(
        `const HINDSIGHT_IMAGE = "ghcr.io/vectorize-io/hindsight@sha256:${"3".repeat(64)}";`,
      ),
    ).toBe(`ghcr.io/vectorize-io/hindsight@sha256:${"3".repeat(64)}`);
    expect(() =>
      parseCliHindsightImageReference(
        `const HINDSIGHT_IMAGE = "ghcr.io/vectorize-io/hindsight:latest";`,
      ),
    ).toThrow(/pinned by sha256 digest/);

    const { repository, releaseCommit, sourceCommit } = releaseFixture("8");
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: inspector(sourceCommit),
      }),
    ).toThrow(/Fly contract and Vorton CLI HINDSIGHT_IMAGE must match exactly/);
  });

  it("discovers a delayed draft after one creation and bounded read-only checks", () => {
    const draft = { id: 42, tag_name: "v0.3.0", draft: true };
    const result = runReleaseDiscovery([[[]], [[]], [[]], [[draft]]]);

    expect(result).toEqual({
      apiCount: 4,
      createCount: 1,
      matching: [draft],
      sleepCalls: ["2", "2"],
      succeeded: true,
    });
  });

  it("fails closed after six post-create checks spanning ten seconds", () => {
    const result = runReleaseDiscovery(Array.from({ length: 7 }, () => [[]]));

    expect(result).toEqual({
      apiCount: 7,
      createCount: 1,
      matching: [],
      sleepCalls: ["2", "2", "2", "2", "2"],
      succeeded: false,
    });
  });

  it("rejects duplicate exact-tag releases without creating another", () => {
    const result = runReleaseDiscovery([
      [
        [
          { id: 43, tag_name: "v0.3.0", draft: true },
          { id: 44, tag_name: "v0.3.0", draft: true },
        ],
      ],
    ]);

    expect(result.apiCount).toBe(1);
    expect(result.createCount).toBe(0);
    expect(result.matching).toHaveLength(2);
    expect(result.sleepCalls).toEqual([]);
    expect(result.succeeded).toBe(false);
  });

  it("leaves an existing published release unchanged", () => {
    const published = { id: 45, tag_name: "v0.3.0", draft: false };
    const result = runReleaseDiscovery([[[published]]]);

    expect(result).toEqual({
      apiCount: 1,
      createCount: 0,
      matching: [published],
      sleepCalls: [],
      succeeded: true,
    });
  });

  it("replays a pre-helper tag with resolver logic carried by the active workflow", () => {
    const repository = mkdtempSync(join(tmpdir(), "vorton-replay-test-"));
    command(repository, ["init", "-q"]);
    command(repository, ["config", "user.name", "Release Test"]);
    command(repository, [
      "config",
      "user.email",
      "release-test@example.invalid",
    ]);
    write(
      repository,
      ".github/workflows/release.yml",
      "name: Historical release workflow\n",
    );
    commit(repository, "historical release");
    command(repository, ["tag", "v0.3.0"]);

    const activeWorkflow = readFileSync(
      join(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );
    write(repository, ".github/workflows/release.yml", activeWorkflow);
    commit(repository, "current release workflow");
    const loadedWorkflow = command(repository, [
      "show",
      "HEAD:.github/workflows/release.yml",
    ]);
    command(repository, ["checkout", "--detach", "v0.3.0"]);

    expect(() =>
      command(repository, [
        "cat-file",
        "-e",
        "HEAD:release/resolve-github-release.ts",
      ]),
    ).toThrow();
    expect(releaseDiscoveryScript(loadedWorkflow)).not.toMatch(
      /release\/resolve-github-release|\b(?:node|npx|tsx)\b/,
    );

    const published = { id: 46, tag_name: "v0.3.0", draft: false };
    expect(
      runReleaseDiscovery([[[published]]], {
        repository,
        workflow: loadedWorkflow,
      }),
    ).toMatchObject({
      createCount: 0,
      matching: [published],
      succeeded: true,
    });
  });

  it("wires one preflight into CI and tag publication, with recoverable release uploads", () => {
    const ci = readFileSync(
      join(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const release = readFileSync(
      join(process.cwd(), ".github/workflows/release.yml"),
      "utf8",
    );
    const preflight = readFileSync(
      join(process.cwd(), "release/preflight-release.ts"),
      "utf8",
    );

    expect(ci).toContain("npm run release:preflight");
    expect(ci).toContain("--if-present");
    expect(release).toContain("npm run release:preflight");
    expect(release).toContain('gh release view "$TAG_NAME"');
    expect(release).toContain("# BEGIN bounded release discovery");
    expect(release).toContain("for visibility_check in 1 2 3 4 5 6");
    expect(release).not.toContain("release/resolve-github-release");
    expect(release).toContain('gh release upload "$TAG_NAME"');
    expect(release).toContain("--clobber");
    expect(release).toContain(
      '"/repos/$GITHUB_REPOSITORY/releases/assets/$asset_id"',
    );
    expect(release).toContain("unexpected release asset");
    expect(release).toContain("cmp --silent");
    expect(release).toContain("Normalize deterministic SBOM identity");
    expect(release).toContain("npm run release:normalize-sbom");
    expect(release).toContain("syft-version: v1.42.3");
    expect(release).toContain("upload-artifact: false");
    expect(release).toContain(
      'test "$(jq -r \'.[0].name\' matching-releases.json)" = "Vorton $TAG_NAME"',
    );
    expect(release).toContain(
      "cmp --silent release-notes.md existing-release-notes.md",
    );
    expect(preflight).not.toContain("localeCompare");
    for (const field of [
      "crossRefs",
      "fileContributors",
      "hasFiles",
      "ranges",
    ]) {
      expect(preflight).toContain(`"${field}"`);
    }
    expect(release).toMatch(
      /if \[ "\$release_is_draft" = "false" \]; then\s+verify_release_assets\s+cp exact-release\.json published-release\.json\s+else\s+test "\$release_is_draft" = "true"[\s\S]+?gh release upload "\$TAG_NAME"[\s\S]+?--clobber/,
    );
  });
});
