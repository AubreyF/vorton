import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sha256 } from "./release-lib.js";
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

function releaseFixture(
  cliDigest = "9",
  createdAt = "2026-08-29T12:00:00.000Z",
): {
  repository: string;
  releaseCommit: string;
  sourceCommit: string;
} {
  const repository = mkdtempSync(join(tmpdir(), "aubos-preflight-test-"));
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
        contracts: { host: 1, module: 1, worker: 1 },
        coreMigrationHead: "20260829000100_test",
        images: Object.fromEntries(
          ["control-plane", "web", "worker"].map((name) => [
            name,
            {
              reference: `ghcr.io/moonbase-labs/aubos-${name}@${digest}`,
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
  return { repository, releaseCommit, sourceCommit };
}

function inspector(sourceCommit: string): OciInspector {
  return {
    format(_reference, template) {
      if (template.includes("Labels")) {
        return JSON.stringify({
          "org.opencontainers.image.revision": sourceCommit,
        });
      }
      return JSON.stringify({ evidence: "present" });
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
  it("normalizes Syft entropy and SPDX set ordering into stable release bytes", () => {
    const identity = {
      artifactDigest: `sha256:${"b".repeat(64)}`,
      artifactName: "aubos-1.2.3-contracts.tgz",
      createdAt: "2026-08-29T12:00:00.000Z",
      version: "1.2.3",
    };
    const first = {
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      dataLicense: "CC0-1.0",
      name: "aubos-1.2.3-contracts.tgz",
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
          name: "aubos-1.2.3-contracts.tgz",
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
      name: "aubos-1.2.3-contracts.tgz",
    };

    const normalized = normalizeSpdxDocument(first, identity);
    expect(normalizeSpdxDocument(second, identity)).toBe(normalized);
    expect(normalized).toContain(
      `"documentNamespace": "https://aubos.dev/releases/v1.2.3/sbom/sha256-${"b".repeat(64)}"`,
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
    const artifactPath = join(repository, "aubos-1.2.3-contracts.tgz");
    const sbomPath = join(repository, "aubos-1.2.3.spdx.json");
    const artifact = "synthetic contract artifact\n";
    const artifactDigest = sha256(artifact);
    writeFileSync(artifactPath, artifact);
    writeFileSync(
      sbomPath,
      JSON.stringify({
        spdxVersion: "SPDX-2.3",
        SPDXID: "SPDXRef-DOCUMENT",
        dataLicense: "CC0-1.0",
        name: "aubos-1.2.3-contracts.tgz",
        documentNamespace: "https://anchore.com/syft/random",
        creationInfo: {
          created: "2026-08-29T13:00:00Z",
          creators: ["Tool: syft-1.42.3"],
        },
        packages: [
          {
            SPDXID: "SPDXRef-DocumentRoot",
            name: "aubos-1.2.3-contracts.tgz",
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
      `"documentNamespace": "https://aubos.dev/releases/v1.2.3/sbom/${artifactDigest.replace(":", "-")}"`,
    );
  });

  it("binds the exact manifest-only release child to OCI evidence and Hindsight platforms", () => {
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
  });

  it("fails closed on missing image evidence and Hindsight architectures", () => {
    const { repository, releaseCommit, sourceCommit } = releaseFixture();
    const missingProvenance = inspector(sourceCommit);
    missingProvenance.format = (_reference, template) =>
      template.includes("Labels")
        ? JSON.stringify({
            "org.opencontainers.image.revision": sourceCommit,
          })
        : template.includes("Provenance")
          ? "{}"
          : JSON.stringify({ evidence: "present" });
    expect(() =>
      runReleasePreflight({
        repositoryRoot: repository,
        releaseCommit,
        repositoryOwner: "moonbase-labs",
        version: "1.2.3",
        inspector: missingProvenance,
      }),
    ).toThrow(/provenance must be a nonempty object/);

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
    ).toThrow(/Fly contract and AubOS CLI HINDSIGHT_IMAGE must match exactly/);
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
    expect(release).toContain('gh release create "$TAG_NAME"');
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
      'test "$(jq -r \'.[0].name\' matching-releases.json)" = "AubOS $TAG_NAME"',
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
