import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  stageContractArchive,
  verifyStagedWorkspaceEvidence,
} from "./stage-contract-archive.js";
import {
  prepareWorkspaceReleaseEvidenceWithAttestation,
  writeWorkspaceReleaseEvidence,
} from "./workspace-release-evidence.js";
import { writeWorkspaceReleaseEvidenceFixture } from "./workspace-release-evidence.test-helpers.js";
import { workspaceProofHash } from "./workspace-isolation-proof.js";

const sourceCommit = "a".repeat(40);
const migrationHead = "20260830000100_workspaces";

function digest(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function write(root: string, path: string, content: string | Buffer): void {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function inputFixture() {
  const root = mkdtempSync(join(tmpdir(), "vorton-workspace-evidence-"));
  return {
    root,
    ...writeWorkspaceReleaseEvidenceFixture({
      repository: root,
      version: "0.4.0",
      sourceCommit,
      migrationHead,
    }),
  };
}

function prepare(input: ReturnType<typeof inputFixture>) {
  return prepareWorkspaceReleaseEvidenceWithAttestation(
    {
      version: "0.4.0",
      sourceCommit,
      migrationHead,
      proofPath: join(input.root, input.proofPath),
      proofSha256: digest(input.proofBytes),
      evidencePaths: input.evidenceFiles.map((file) =>
        join(input.root, file.path),
      ),
    },
    input.producerAttestation,
  );
}

describe("workspace release evidence carrier", () => {
  it("rejects altered proof bytes before parsing their claims", () => {
    const input = inputFixture();
    writeFileSync(join(input.root, input.proofPath), `${input.proofBytes} `);

    expect(() => prepare(input)).toThrow("proof byte digest differs");
  });

  it("binds proof content to the exact source commit and canonical migration head", () => {
    const input = inputFixture();
    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit: "c".repeat(40),
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(input.proofBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow("source commit differs");
    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead: `${migrationHead}.sql`,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(input.proofBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow("migration head differs");
  });

  it("rejects a claim digest with no included evidence file", () => {
    const input = inputFixture();
    const proof = structuredClone(input.proof);
    proof.claims[0]!.evidenceSha256 = `sha256:${"c".repeat(64)}`;
    proof.proofHash = workspaceProofHash(
      proof as unknown as Record<string, unknown>,
    );
    const proofBytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`);
    writeFileSync(join(input.root, input.proofPath), proofBytes);

    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(proofBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow(/claim database-read-write has no included evidence file/);
  });

  it("rejects an evidence digest that no report or claim references", () => {
    const input = inputFixture();
    const orphan = join(input.root, "orphan.evidence");
    writeFileSync(orphan, "orphan evidence\n");

    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(input.proofBytes),
          evidencePaths: [
            ...input.evidenceFiles.map((file) => join(input.root, file.path)),
            orphan,
          ],
        },
        input.producerAttestation,
      ),
    ).toThrow(/evidence file is not referenced/);
  });

  it("rejects digest reuse across independent claim and producer receipts", () => {
    const input = inputFixture();
    const proof = structuredClone(input.proof);
    proof.claims[1]!.evidenceSha256 = proof.claims[0]!.evidenceSha256;
    proof.proofHash = workspaceProofHash(
      proof as unknown as Record<string, unknown>,
    );
    const proofBytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`);
    writeFileSync(join(input.root, input.proofPath), proofBytes);

    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(proofBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow(/evidence digest is reused/);
  });

  it("rejects a checksum placeholder instead of a typed claim receipt", () => {
    const input = inputFixture();
    const placeholderBytes = Buffer.from("{}\n");
    const placeholderPath = join(input.root, "placeholder.evidence");
    writeFileSync(placeholderPath, placeholderBytes);
    const proof = structuredClone(input.proof);
    proof.claims[0]!.evidenceSha256 = digest(placeholderBytes);
    proof.proofHash = workspaceProofHash(
      proof as unknown as Record<string, unknown>,
    );
    const proofBytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`);
    writeFileSync(join(input.root, input.proofPath), proofBytes);

    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(proofBytes),
          evidencePaths: [
            placeholderPath,
            ...input.evidenceFiles
              .slice(0, 2)
              .map((file) => join(input.root, file.path)),
            ...input.evidenceFiles
              .slice(3)
              .map((file) => join(input.root, file.path)),
          ],
        },
        input.producerAttestation,
      ),
    ).toThrow(/claim receipt database-read-write fields differ/);
  });

  it("rejects caller-asserted producer provenance", () => {
    const input = inputFixture();
    const fabricated = {
      ...input.producerAttestation,
      sourceCommit: "f".repeat(40),
    };
    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(input.proofBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        fabricated,
      ),
    ).toThrow(/GitHub producer source commit differs/);

    const replacedFiles = new Map(input.producerAttestation.files);
    replacedFiles.set(
      "reports/test-report.json",
      Buffer.from("fabricated locally\n"),
    );
    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(input.proofBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        { ...input.producerAttestation, files: replacedFiles },
      ),
    ).toThrow(/Producer artifact bytes differ: reports\/test-report.json/);
  });

  it("rejects duplicate-key proof bytes even when their raw digest is declared", () => {
    const input = inputFixture();
    const ambiguousBytes = Buffer.from(
      input.proofBytes
        .toString("utf8")
        .replace(
          '  "status": "passed",',
          '  "status": "passed",\n  "status": "passed",',
        ),
    );
    writeFileSync(join(input.root, input.proofPath), ambiguousBytes);

    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(ambiguousBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow(/unambiguous canonical JSON/);
  });

  it("keeps blocked or incomplete proofs out of the carrier", () => {
    const input = inputFixture();
    const blocked = structuredClone(input.proof) as unknown as Record<
      string,
      any
    >;
    blocked.releaseBlockers = ["storage-objects"];
    blocked.proofHash = workspaceProofHash(blocked);
    const blockedBytes = Buffer.from(`${JSON.stringify(blocked, null, 2)}\n`);
    writeFileSync(join(input.root, input.proofPath), blockedBytes);
    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(blockedBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow("still has blockers");

    const incomplete = structuredClone(input.proof) as unknown as Record<
      string,
      any
    >;
    incomplete.claims = incomplete.claims.slice(1);
    incomplete.proofHash = workspaceProofHash(incomplete);
    const incompleteBytes = Buffer.from(
      `${JSON.stringify(incomplete, null, 2)}\n`,
    );
    writeFileSync(join(input.root, input.proofPath), incompleteBytes);
    expect(() =>
      prepareWorkspaceReleaseEvidenceWithAttestation(
        {
          version: "0.4.0",
          sourceCommit,
          migrationHead,
          proofPath: join(input.root, input.proofPath),
          proofSha256: digest(incompleteBytes),
          evidencePaths: input.evidenceFiles.map((file) =>
            join(input.root, file.path),
          ),
        },
        input.producerAttestation,
      ),
    ).toThrow("claim identity or order differs");
  });

  it("includes the exact proof and evidence bytes in deterministic archive paths", async () => {
    const input = inputFixture();
    const source = mkdtempSync(join(tmpdir(), "vorton-archive-source-"));
    const staged = mkdtempSync(join(tmpdir(), "vorton-archive-staged-"));
    const prepared = prepare(input);
    writeWorkspaceReleaseEvidence(source, prepared);

    for (const directory of [
      "deploy",
      "schemas",
      "supabase/migrations",
      "templates",
      "packages/executive/roles",
    ]) {
      mkdirSync(join(source, directory), { recursive: true });
    }
    write(source, "packages/cli/package.json", '{"version":"0.4.0"}\n');
    write(source, "packages/cli/src/cli.ts", "console.log('vorton');\n");
    write(
      source,
      "release/bootstrap-runtime/package.json",
      '{"name":"vorton-bootstrap","version":"0.4.0"}\n',
    );
    write(
      source,
      "release/bootstrap-runtime/package-lock.json",
      '{"name":"vorton-bootstrap","version":"0.4.0","lockfileVersion":3,"packages":{"":{"name":"vorton-bootstrap","version":"0.4.0"}}}\n',
    );
    write(
      source,
      "release/hindsight-canary-cli.ts",
      "console.log('canary');\n",
    );
    const manifest = {
      schemaVersion: 2,
      status: "released",
      version: "0.4.0",
      sourceCommit,
      createdAt: "2026-08-30T21:00:00.000Z",
      cliVersion: "0.4.0",
      contracts: { host: 1, module: 1, worker: 1, workspace: 1 },
      coreMigrationHead: migrationHead,
      evidence: { workspaceIsolation: prepared.metadata },
      images: Object.fromEntries(
        ["control-plane", "web", "worker"].map((name) => [
          name,
          {
            reference: `ghcr.io/aubreyf/vorton-${name}@sha256:${"d".repeat(64)}`,
            digest: `sha256:${"d".repeat(64)}`,
          },
        ]),
      ),
      managedFiles: [
        {
          path: "host/runtime.json",
          template: "templates/releases/0.4.0/host/runtime.json",
          digest: `sha256:${"e".repeat(64)}`,
        },
      ],
    };
    write(
      source,
      "release/manifests/0.4.0.json",
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    await stageContractArchive(staged, source, "0.4.0");
    expect(
      existsSync(
        join(staged, "release/workspace-release-evidence.test-helpers.ts"),
      ),
    ).toBe(false);
    for (const output of prepared.outputs) {
      expect(readFileSync(join(staged, output.path))).toEqual(output.bytes);
    }

    const second = mkdtempSync(join(tmpdir(), "vorton-archive-second-"));
    cpSync(staged, second, { recursive: true });
    for (const output of prepared.outputs) {
      expect(readFileSync(join(second, output.path))).toEqual(output.bytes);
    }

    const evidenceOutput = prepared.outputs.find((output) =>
      output.path.endsWith(".evidence"),
    )!;
    writeFileSync(join(staged, evidenceOutput.path), "altered evidence\n");
    await expect(
      verifyStagedWorkspaceEvidence(source, staged, "0.4.0"),
    ).rejects.toThrow("evidence bytes differ");

    const outside = join(input.root, "outside-archive.txt");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(source, "release/manifests/escape-link"));
    const rejectedStage = mkdtempSync(
      join(tmpdir(), "vorton-archive-symlink-rejected-"),
    );
    await expect(
      stageContractArchive(rejectedStage, source, "0.4.0"),
    ).rejects.toThrow("Archive source contains a symbolic link");

    const redirectedRoot = mkdtempSync(
      join(tmpdir(), "vorton-archive-redirect-root-"),
    );
    const redirectTarget = mkdtempSync(
      join(tmpdir(), "vorton-archive-redirect-target-"),
    );
    symlinkSync(redirectTarget, join(redirectedRoot, "redirect"));
    await expect(
      stageContractArchive(
        join(redirectedRoot, "redirect", "archive"),
        source,
        "0.4.0",
      ),
    ).rejects.toThrow(/destination ancestor/);
    expect(existsSync(join(redirectTarget, "archive"))).toBe(false);

    const deepRedirectRoot = mkdtempSync(
      join(tmpdir(), "vorton-archive-deep-redirect-root-"),
    );
    const deepRedirectTarget = mkdtempSync(
      join(tmpdir(), "vorton-archive-deep-redirect-target-"),
    );
    mkdirSync(join(deepRedirectTarget, "existing"));
    symlinkSync(deepRedirectTarget, join(deepRedirectRoot, "redirect"));
    await expect(
      stageContractArchive(
        join(deepRedirectRoot, "redirect", "existing", "archive"),
        source,
        "0.4.0",
      ),
    ).rejects.toThrow(/destination ancestor/);
    expect(existsSync(join(deepRedirectTarget, "existing", "archive"))).toBe(
      false,
    );
  });
});
