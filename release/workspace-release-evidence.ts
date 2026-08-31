import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReleaseManifest } from "@vorton/contracts";

import {
  fetchGitHubWorkspaceProducerAttestation,
  verifyGitHubWorkspaceProducerAttestation,
  type GitHubWorkspaceProducerAttestation,
} from "./github-workspace-producer.js";
import {
  validateWorkspaceIsolationProof,
  type WorkspaceIsolationProof,
} from "./workspace-isolation-proof.js";

type WorkspaceIsolationMetadata = NonNullable<
  ReleaseManifest["evidence"]
>["workspaceIsolation"];

export interface WorkspaceEvidenceOutput {
  bytes: Buffer;
  path: string;
}

export interface PreparedWorkspaceEvidence {
  metadata: WorkspaceIsolationMetadata;
  outputs: WorkspaceEvidenceOutput[];
}

function sha256(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  description: string,
): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} must be an object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${description} fields differ`,
  );
}

function parseCanonicalJson(bytes: Buffer, description: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
  assert(
    bytes.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`)),
    `${description} must use unambiguous canonical JSON bytes`,
  );
  return value;
}

function evidenceRoot(version: string): string {
  return `release/evidence/${version}/workspace-isolation`;
}

function evidenceReferences(
  proof: WorkspaceIsolationProof,
): Array<{ digest: string; name: string }> {
  return [
    {
      name: "producer test report",
      digest: proof.producer.testReportSha256,
    },
    {
      name: "producer PostgreSQL authority proof",
      digest: proof.producer.postgresAuthoritySha256,
    },
    ...proof.claims.map((claim) => ({
      name: `claim ${claim.id}`,
      digest: claim.evidenceSha256,
    })),
  ];
}

function referencedEvidenceDigests(
  proof: WorkspaceIsolationProof,
): Set<string> {
  const firstReferenceByDigest = new Map<string, string>();
  for (const reference of evidenceReferences(proof)) {
    const first = firstReferenceByDigest.get(reference.digest);
    if (first) {
      throw new Error(
        `Workspace evidence digest is reused by ${first} and ${reference.name}: ${reference.digest}`,
      );
    }
    firstReferenceByDigest.set(reference.digest, reference.name);
  }
  return new Set(firstReferenceByDigest.keys());
}

function requireEvidenceMapping(
  proof: WorkspaceIsolationProof,
  evidenceByDigest: ReadonlyMap<string, Buffer>,
): void {
  for (const claim of proof.claims) {
    const bytes = evidenceByDigest.get(claim.evidenceSha256);
    if (!bytes) {
      throw new Error(
        `Workspace claim ${claim.id} has no included evidence file for ${claim.evidenceSha256}`,
      );
    }
    const receipt = parseCanonicalJson(
      bytes,
      `Workspace claim receipt ${claim.id}`,
    );
    exactKeys(
      receipt,
      [
        "schemaVersion",
        "contract",
        "sourceCommit",
        "migrationHead",
        "claimId",
        "status",
        "adversarial",
      ],
      `Workspace claim receipt ${claim.id}`,
    );
    assert(
      receipt.schemaVersion === 1 &&
        receipt.contract === "vorton.workspace-claim-receipt.v1" &&
        receipt.sourceCommit === proof.sourceCommit &&
        receipt.migrationHead === proof.migrationHead &&
        receipt.claimId === claim.id &&
        receipt.status === "passed" &&
        receipt.adversarial === true,
      `Workspace claim receipt differs: ${claim.id}`,
    );
  }
  for (const [name, digest, contract, collectionKey] of [
    [
      "test report",
      proof.producer.testReportSha256,
      "vorton.workspace-test-report.v1",
      "commands",
    ],
    [
      "PostgreSQL authority proof",
      proof.producer.postgresAuthoritySha256,
      "vorton.workspace-postgres-authority-report.v1",
      "checks",
    ],
  ] as const) {
    const bytes = evidenceByDigest.get(digest);
    if (!bytes) {
      throw new Error(
        `Workspace ${name} has no included evidence file for ${digest}`,
      );
    }
    const report = parseCanonicalJson(bytes, `Workspace ${name}`);
    exactKeys(
      report,
      [
        "schemaVersion",
        "contract",
        "sourceCommit",
        "migrationHead",
        "status",
        collectionKey,
      ],
      `Workspace ${name}`,
    );
    const collection = report[collectionKey];
    assert(
      report.schemaVersion === 1 &&
        report.contract === contract &&
        report.sourceCommit === proof.sourceCommit &&
        report.migrationHead === proof.migrationHead &&
        report.status === "passed" &&
        Array.isArray(collection) &&
        collection.length > 0 &&
        collection.every(
          (entry) => typeof entry === "string" && entry.length > 0,
        ),
      `Workspace ${name} differs`,
    );
  }
}

function parseProof(
  bytes: Buffer,
  expected: { migrationHead: string; sourceCommit: string },
): WorkspaceIsolationProof {
  const value = parseCanonicalJson(bytes, "Workspace isolation proof");
  return validateWorkspaceIsolationProof(value, expected);
}

export interface WorkspaceReleaseEvidenceInput {
  evidencePaths: readonly string[];
  migrationHead: string;
  proofPath: string;
  proofSha256: string;
  sourceCommit: string;
  version: string;
}

function prepareWorkspaceReleaseEvidenceFromAttestation(
  options: WorkspaceReleaseEvidenceInput,
  attestation: GitHubWorkspaceProducerAttestation,
): PreparedWorkspaceEvidence {
  const proofBytes = readFileSync(options.proofPath);
  const exactProofDigest = sha256(proofBytes);
  if (exactProofDigest !== options.proofSha256) {
    throw new Error(
      `Workspace proof byte digest differs: ${exactProofDigest} != ${options.proofSha256}`,
    );
  }
  const proof = parseProof(proofBytes, {
    sourceCommit: options.sourceCommit,
    migrationHead: options.migrationHead,
  });

  const evidenceByDigest = new Map<string, Buffer>();
  for (const path of options.evidencePaths) {
    const bytes = readFileSync(path);
    const digest = sha256(bytes);
    const existing = evidenceByDigest.get(digest);
    if (existing && !existing.equals(bytes)) {
      throw new Error(`Workspace evidence digest collision: ${digest}`);
    }
    evidenceByDigest.set(digest, bytes);
  }
  if (evidenceByDigest.size === 0) {
    throw new Error("At least one workspace evidence file is required");
  }

  const referenced = referencedEvidenceDigests(proof);
  requireEvidenceMapping(proof, evidenceByDigest);
  for (const digest of evidenceByDigest.keys()) {
    if (!referenced.has(digest)) {
      throw new Error(`Workspace evidence file is not referenced: ${digest}`);
    }
  }

  const producerEvidence = verifyGitHubWorkspaceProducerAttestation({
    attestation,
    migrationHead: options.migrationHead,
    proof,
  });
  for (const digest of evidenceByDigest.keys()) {
    if (!producerEvidence.get(digest)?.equals(evidenceByDigest.get(digest)!)) {
      throw new Error(
        `Workspace evidence bytes differ from the GitHub producer artifact: ${digest}`,
      );
    }
  }

  const root = evidenceRoot(options.version);
  const files = [...evidenceByDigest.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([digest, bytes]) => ({
      bytes,
      digest,
      path: `${root}/claims/${digest.slice("sha256:".length)}.evidence`,
    }));
  const proofOutput = {
    bytes: proofBytes,
    path: `${root}/workspace-isolation-proof.json`,
  };

  return {
    metadata: {
      contract: "vorton.workspace-isolation-proof.v1",
      proof: {
        path: proofOutput.path,
        digest: exactProofDigest,
      },
      files: files.map(({ digest, path }) => ({ digest, path })),
    },
    outputs: [
      proofOutput,
      ...files.map(({ bytes, path }) => ({ bytes, path })),
    ],
  };
}

export function prepareWorkspaceReleaseEvidence(
  options: WorkspaceReleaseEvidenceInput,
): PreparedWorkspaceEvidence {
  const proofBytes = readFileSync(options.proofPath);
  if (sha256(proofBytes) !== options.proofSha256) {
    throw new Error(
      "Workspace proof byte digest differs before producer verification",
    );
  }
  const proof = parseProof(proofBytes, {
    sourceCommit: options.sourceCommit,
    migrationHead: options.migrationHead,
  });
  return prepareWorkspaceReleaseEvidenceFromAttestation(
    options,
    fetchGitHubWorkspaceProducerAttestation(proof),
  );
}

export function prepareWorkspaceReleaseEvidenceWithAttestation(
  options: WorkspaceReleaseEvidenceInput,
  attestation: GitHubWorkspaceProducerAttestation,
): PreparedWorkspaceEvidence {
  return prepareWorkspaceReleaseEvidenceFromAttestation(options, attestation);
}

export function writeWorkspaceReleaseEvidence(
  repositoryRoot: string,
  prepared: PreparedWorkspaceEvidence,
): void {
  for (const output of prepared.outputs) {
    const destination = join(repositoryRoot, output.path);
    if (
      existsSync(destination) &&
      !readFileSync(destination).equals(output.bytes)
    ) {
      throw new Error(`Workspace evidence already differs: ${output.path}`);
    }
  }
  for (const output of prepared.outputs) {
    const destination = join(repositoryRoot, output.path);
    if (existsSync(destination)) continue;
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, output.bytes, { flag: "wx" });
  }
}

export function validateWorkspaceReleaseEvidence(options: {
  manifest: ReleaseManifest;
  read: (path: string) => Buffer;
}): string[] {
  const workspace = options.manifest.evidence?.workspaceIsolation;
  if (!workspace) return [];

  const expectedRoot = evidenceRoot(options.manifest.version);
  const expectedProofPath = `${expectedRoot}/workspace-isolation-proof.json`;
  if (workspace.proof.path !== expectedProofPath) {
    throw new Error(`Workspace proof path must be ${expectedProofPath}`);
  }
  const proofBytes = options.read(workspace.proof.path);
  if (sha256(proofBytes) !== workspace.proof.digest) {
    throw new Error("Workspace proof bytes differ from the manifest digest");
  }
  const proof = parseProof(proofBytes, {
    sourceCommit: options.manifest.sourceCommit,
    migrationHead: options.manifest.coreMigrationHead,
  });

  const evidenceDigests = new Set<string>();
  const evidenceByDigest = new Map<string, Buffer>();
  const evidencePaths = new Set<string>([workspace.proof.path]);
  for (const file of workspace.files) {
    const expectedPath = `${expectedRoot}/claims/${file.digest.slice("sha256:".length)}.evidence`;
    if (file.path !== expectedPath) {
      throw new Error(
        `Workspace evidence path must be content addressed: ${expectedPath}`,
      );
    }
    if (evidencePaths.has(file.path)) {
      throw new Error(`Workspace evidence path is duplicated: ${file.path}`);
    }
    if (evidenceDigests.has(file.digest)) {
      throw new Error(
        `Workspace evidence digest is duplicated: ${file.digest}`,
      );
    }
    const bytes = options.read(file.path);
    if (sha256(bytes) !== file.digest) {
      throw new Error(
        `Workspace evidence bytes differ from the manifest digest: ${file.path}`,
      );
    }
    evidencePaths.add(file.path);
    evidenceDigests.add(file.digest);
    evidenceByDigest.set(file.digest, bytes);
  }

  const referenced = referencedEvidenceDigests(proof);
  requireEvidenceMapping(proof, evidenceByDigest);
  for (const digest of evidenceDigests) {
    if (!referenced.has(digest)) {
      throw new Error(`Workspace evidence file is not referenced: ${digest}`);
    }
  }

  return [...evidencePaths].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

/** Revalidates committed evidence against the exact remote producer artifact. */
export function reverifyWorkspaceReleaseProducer(options: {
  manifest: ReleaseManifest;
  read: (path: string) => Buffer;
}): void {
  const workspace = options.manifest.evidence?.workspaceIsolation;
  if (!workspace) return;
  validateWorkspaceReleaseEvidence(options);
  const proof = parseProof(options.read(workspace.proof.path), {
    sourceCommit: options.manifest.sourceCommit,
    migrationHead: options.manifest.coreMigrationHead,
  });
  const remote = verifyGitHubWorkspaceProducerAttestation({
    attestation: fetchGitHubWorkspaceProducerAttestation(proof),
    migrationHead: options.manifest.coreMigrationHead,
    proof,
  });
  for (const file of workspace.files) {
    if (!remote.get(file.digest)?.equals(options.read(file.path))) {
      throw new Error(
        `Committed workspace evidence differs from the GitHub producer artifact: ${file.path}`,
      );
    }
  }
}
