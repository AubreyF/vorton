import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  requiredWorkspaceClaims,
  type WorkspaceIsolationProof,
} from "./workspace-isolation-proof.js";

export const workspaceProducerRepository = "AubreyF/vorton";
export const workspaceProducerWorkflow =
  ".github/workflows/workspace-isolation-proof.yml";
export const workspaceProducerArtifact = "vorton-workspace-isolation-evidence";

type ProducerEvidenceKind =
  "test-report" | "postgres-authority-report" | "claim-receipt";

interface ProducerEvidenceIndexEntry {
  kind: ProducerEvidenceKind;
  claimId?: string;
  path: string;
  digest: string;
}

interface ProducerEvidenceIndex {
  schemaVersion: 1;
  contract: "vorton.workspace-producer-attestation.v1";
  repository: typeof workspaceProducerRepository;
  workflow: typeof workspaceProducerWorkflow;
  sourceCommit: string;
  migrationHead: string;
  runUrl: string;
  files: ProducerEvidenceIndexEntry[];
}

export interface GitHubWorkspaceProducerAttestation {
  repository: string;
  workflow: string;
  sourceCommit: string;
  conclusion: string;
  runUrl: string;
  indexBytes: Buffer;
  files: ReadonlyMap<string, Buffer>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(content: Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
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

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parseIndex(bytes: Buffer): ProducerEvidenceIndex {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Workspace producer attestation is not valid JSON");
  }
  assert(
    bytes.equals(canonicalJson(value)),
    "Workspace producer attestation must use unambiguous canonical JSON bytes",
  );
  exactKeys(
    value,
    [
      "schemaVersion",
      "contract",
      "repository",
      "workflow",
      "sourceCommit",
      "migrationHead",
      "runUrl",
      "files",
    ],
    "Workspace producer attestation",
  );
  assert(value.schemaVersion === 1, "Workspace producer schema is unsupported");
  assert(
    value.contract === "vorton.workspace-producer-attestation.v1",
    "Workspace producer contract is unsupported",
  );
  assert(Array.isArray(value.files), "Workspace producer files are missing");
  for (const [index, entry] of value.files.entries()) {
    const candidate = entry as Record<string, unknown>;
    const claimReceipt = candidate.kind === "claim-receipt";
    exactKeys(
      entry,
      claimReceipt
        ? ["kind", "claimId", "path", "digest"]
        : ["kind", "path", "digest"],
      `Workspace producer file ${index}`,
    );
  }
  return value as unknown as ProducerEvidenceIndex;
}

function expectedEntries(
  proof: WorkspaceIsolationProof,
): ProducerEvidenceIndexEntry[] {
  return [
    {
      kind: "test-report",
      path: "reports/test-report.json",
      digest: proof.producer.testReportSha256,
    },
    {
      kind: "postgres-authority-report",
      path: "reports/postgres-authority-report.json",
      digest: proof.producer.postgresAuthoritySha256,
    },
    ...requiredWorkspaceClaims.map((claimId) => ({
      kind: "claim-receipt" as const,
      claimId,
      path: `claims/${claimId}.json`,
      digest: proof.claims.find((claim) => claim.id === claimId)!
        .evidenceSha256,
    })),
  ];
}

function safeRelativePath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    path.length > 0 &&
    path
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export function verifyGitHubWorkspaceProducerAttestation(options: {
  attestation: GitHubWorkspaceProducerAttestation;
  migrationHead: string;
  proof: WorkspaceIsolationProof;
}): ReadonlyMap<string, Buffer> {
  const { attestation, proof } = options;
  assert(
    attestation.repository === workspaceProducerRepository &&
      attestation.repository === proof.producer.repository,
    "GitHub producer repository differs",
  );
  assert(
    attestation.workflow === workspaceProducerWorkflow,
    "GitHub producer workflow differs",
  );
  assert(
    attestation.sourceCommit === proof.sourceCommit,
    "GitHub producer source commit differs",
  );
  assert(
    attestation.conclusion === "success" &&
      proof.producer.workflowConclusion === "success",
    "GitHub producer workflow did not pass",
  );
  assert(
    attestation.runUrl === proof.producer.workflowRunUrl,
    "GitHub producer workflow run differs",
  );

  const index = parseIndex(attestation.indexBytes);
  assert(
    index.repository === attestation.repository,
    "Producer index repository differs",
  );
  assert(
    index.workflow === attestation.workflow,
    "Producer index workflow differs",
  );
  assert(
    index.sourceCommit === proof.sourceCommit,
    "Producer index source commit differs",
  );
  assert(
    index.migrationHead === options.migrationHead,
    "Producer index migration head differs",
  );
  assert(
    index.runUrl === attestation.runUrl,
    "Producer index workflow run differs",
  );

  const expected = expectedEntries(proof);
  assert(
    JSON.stringify(index.files) === JSON.stringify(expected),
    "Producer evidence index differs from the required reports and claim receipts",
  );
  assert(
    attestation.files.size === expected.length,
    "Producer artifact contains an unexpected file set",
  );

  const verifiedByDigest = new Map<string, Buffer>();
  for (const entry of expected) {
    assert(
      safeRelativePath(entry.path),
      `Producer evidence path is unsafe: ${entry.path}`,
    );
    const bytes = attestation.files.get(entry.path);
    assert(bytes, `Producer artifact is missing ${entry.path}`);
    assert(
      sha256(bytes) === entry.digest,
      `Producer artifact bytes differ: ${entry.path}`,
    );
    assert(
      !verifiedByDigest.has(entry.digest),
      `Producer artifact reuses evidence digest: ${entry.digest}`,
    );
    verifiedByDigest.set(entry.digest, bytes);
  }
  return verifiedByDigest;
}

function ghJson(path: string): any {
  return JSON.parse(
    execFileSync("gh", ["api", "--hostname", "github.com", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function readDownloadedArtifact(root: string): {
  indexBytes: Buffer;
  files: ReadonlyMap<string, Buffer>;
} {
  const absoluteRoot = realpathSync(root);
  const files = new Map<string, Buffer>();
  let indexBytes: Buffer | undefined;

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const status = lstatSync(absolute);
      assert(
        !status.isSymbolicLink(),
        "Producer artifact contains a symbolic link",
      );
      const resolved = realpathSync(absolute);
      const relation = relative(absoluteRoot, resolved);
      assert(
        relation !== ".." &&
          !relation.startsWith(`..${sep}`) &&
          !isAbsolute(relation),
        "Producer artifact path escapes its root",
      );
      if (status.isDirectory()) {
        visit(absolute);
        continue;
      }
      assert(status.isFile(), "Producer artifact contains a non-file entry");
      const path = relative(absoluteRoot, absolute).split(sep).join("/");
      if (path === "workspace-producer-attestation.json") {
        indexBytes = readFileSync(absolute);
      } else {
        files.set(path, readFileSync(absolute));
      }
    }
  };
  visit(absoluteRoot);
  assert(
    indexBytes,
    "Producer artifact lacks workspace-producer-attestation.json",
  );
  return { indexBytes, files };
}

export function fetchGitHubWorkspaceProducerAttestation(
  proof: WorkspaceIsolationProof,
): GitHubWorkspaceProducerAttestation {
  const runId = proof.producer.workflowRunUrl.match(
    /\/runs\/([1-9][0-9]*)$/,
  )?.[1];
  assert(runId, "Workspace proof workflow run is invalid");

  let run: any;
  let artifactsResponse: any;
  try {
    run = ghJson(`repos/${workspaceProducerRepository}/actions/runs/${runId}`);
    artifactsResponse = ghJson(
      `repos/${workspaceProducerRepository}/actions/runs/${runId}/artifacts?per_page=100`,
    );
  } catch (error) {
    throw new Error(
      `Workspace release producer attestation could not be verified through GitHub: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  assert(run.id === Number(runId), "GitHub producer run identity differs");
  assert(
    run.repository?.full_name === workspaceProducerRepository,
    "GitHub producer repository differs",
  );
  assert(
    run.path === workspaceProducerWorkflow,
    "GitHub producer workflow differs",
  );
  assert(
    run.head_sha === proof.sourceCommit,
    "GitHub producer source commit differs",
  );
  assert(run.conclusion === "success", "GitHub producer workflow did not pass");
  assert(
    run.html_url === proof.producer.workflowRunUrl,
    "GitHub producer workflow run differs",
  );
  assert(
    Number.isInteger(artifactsResponse?.total_count) &&
      artifactsResponse.total_count <= 100 &&
      Array.isArray(artifactsResponse.artifacts),
    "GitHub producer artifact listing is incomplete",
  );
  const artifacts = artifactsResponse.artifacts.filter(
    (artifact: any) => artifact?.name === workspaceProducerArtifact,
  );
  assert(
    artifacts.length === 1,
    `GitHub producer must contain exactly one ${workspaceProducerArtifact} artifact`,
  );
  const artifact = artifacts[0];
  assert(artifact.expired === false, "GitHub producer artifact has expired");
  assert(
    artifact.workflow_run?.id === Number(runId),
    "GitHub producer artifact run differs",
  );
  assert(
    artifact.workflow_run?.head_sha === proof.sourceCommit,
    "GitHub producer artifact source commit differs",
  );

  const destination = mkdtempSync(join(tmpdir(), "vorton-workspace-producer-"));
  try {
    execFileSync(
      "gh",
      [
        "run",
        "download",
        runId,
        "--repo",
        `github.com/${workspaceProducerRepository}`,
        "--name",
        workspaceProducerArtifact,
        "--dir",
        destination,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const downloaded = readDownloadedArtifact(destination);
    return {
      repository: run.repository.full_name,
      workflow: run.path,
      sourceCommit: run.head_sha,
      conclusion: run.conclusion,
      runUrl: run.html_url,
      ...downloaded,
    };
  } catch (error) {
    throw new Error(
      `Workspace release producer artifact could not be downloaded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

export function workspaceProducerIndex(options: {
  migrationHead: string;
  proof: WorkspaceIsolationProof;
}): ProducerEvidenceIndex {
  return {
    schemaVersion: 1,
    contract: "vorton.workspace-producer-attestation.v1",
    repository: workspaceProducerRepository,
    workflow: workspaceProducerWorkflow,
    sourceCommit: options.proof.sourceCommit,
    migrationHead: options.migrationHead,
    runUrl: options.proof.producer.workflowRunUrl,
    files: expectedEntries(options.proof),
  };
}
