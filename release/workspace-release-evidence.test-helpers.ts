import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  requiredWorkspaceClaims,
  workspaceProofHash,
  type WorkspaceIsolationProof,
} from "./workspace-isolation-proof.js";
import {
  workspaceProducerIndex,
  workspaceProducerRepository,
  workspaceProducerWorkflow,
  type GitHubWorkspaceProducerAttestation,
} from "./github-workspace-producer.js";

function digest(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function write(root: string, path: string, content: string | Buffer): void {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

export function writeWorkspaceReleaseEvidenceFixture(options: {
  migrationHead: string;
  repository: string;
  sourceCommit: string;
  version: string;
}) {
  const testReportBytes = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        contract: "vorton.workspace-test-report.v1",
        sourceCommit: options.sourceCommit,
        migrationHead: options.migrationHead,
        status: "passed",
        commands: ["synthetic focused workspace test suite"],
      },
      null,
      2,
    )}\n`,
  );
  const postgresAuthorityBytes = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        contract: "vorton.workspace-postgres-authority-report.v1",
        sourceCommit: options.sourceCommit,
        migrationHead: options.migrationHead,
        status: "passed",
        checks: ["synthetic hostile PostgreSQL authority proof"],
      },
      null,
      2,
    )}\n`,
  );
  const claimEvidence = Object.fromEntries(
    requiredWorkspaceClaims.map((id) => {
      const bytes = Buffer.from(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            contract: "vorton.workspace-claim-receipt.v1",
            sourceCommit: options.sourceCommit,
            migrationHead: options.migrationHead,
            claimId: id,
            status: "passed",
            adversarial: true,
          },
          null,
          2,
        )}\n`,
      );
      return [id, { bytes, digest: digest(bytes) }];
    }),
  ) as Record<
    (typeof requiredWorkspaceClaims)[number],
    { bytes: Buffer; digest: string }
  >;
  const unsigned = {
    schemaVersion: 1,
    contract: "vorton.workspace-isolation-proof.v1",
    status: "passed",
    generatedAt: "2026-08-30T21:00:00Z",
    sourceCommit: options.sourceCommit,
    migrationHead: options.migrationHead,
    workspaceContractVersion: 1,
    topology: {
      sameInstallation: true,
      distinctWorkspaceIds: true,
      personalWorkspace: { fixtureIdentity: "aubos", realm: "personal" },
      organizationalWorkspace: {
        fixtureIdentity: "freedos",
        realm: "organizational",
      },
    },
    schema: {
      workspaceRealmAuthoritative: true,
      installationsRealmLegacyMetadataOnly: true,
      workspaceScopedWorkerNames: true,
      workspaceScopedRoleVersions: true,
      workspaceScopedPolicyVersions: true,
      workspaceScopedMemoryBanks: true,
    },
    branding: {
      installationDisplayNameNeutral: true,
      workspaceDisplayNamePresented: true,
      brandingInfersAuthority: false,
    },
    privacy: {
      fixturesOnly: true,
      containsPersonalRecords: false,
      productionSyntheticDataAllowed: false,
      inspectedLiveOrganizationalWorkspace: false,
    },
    producer: {
      repository: "AubreyF/vorton",
      sourceTreeClean: true,
      workflowConclusion: "success",
      workflowRunUrl: "https://github.com/AubreyF/vorton/actions/runs/123",
      testReportSha256: digest(testReportBytes),
      postgresAuthoritySha256: digest(postgresAuthorityBytes),
    },
    identity: {
      sharedAuthenticationPlane: true,
      livePostgresMembership: true,
      revocationImmediate: true,
      sensitiveActionsRequireRecentAal2: true,
    },
    factory: {
      vortonInstallationIdNamed: true,
      workspaceIdNamed: true,
      githubAppInstallationIdSeparatelyNamed: true,
      currentPilotAcceptedAsProof: false,
    },
    authority: {
      rolesGrantAuthority: false,
      policyCapabilitiesApprovalsAndWorkRequired: true,
      installationWorkspaceCreationApprovalPlane: true,
      runtimeRoleCanSetAuthClaims: false,
      workspaceCreationUsesSignedTransactionBoundary: true,
      workspaceCreationApprovalConsumedExactlyOnce: true,
      workspaceCreationReceiptInsertedAtomically: true,
      existingWorkspaceAuthorityBorrowedForWorkspaceCreation: false,
    },
    claims: requiredWorkspaceClaims.map((id) => ({
      id,
      status: "passed" as const,
      adversarial: true as const,
      evidenceSha256: claimEvidence[id].digest,
    })),
    releaseBlockers: [] as [],
  } satisfies Omit<WorkspaceIsolationProof, "proofHash">;
  const proof: WorkspaceIsolationProof = {
    ...unsigned,
    proofHash: workspaceProofHash(unsigned),
  };
  const proofBytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`);
  const root = `release/evidence/${options.version}/workspace-isolation`;
  const proofPath = `${root}/workspace-isolation-proof.json`;
  const evidenceFiles = [
    { bytes: testReportBytes, digest: digest(testReportBytes) },
    {
      bytes: postgresAuthorityBytes,
      digest: digest(postgresAuthorityBytes),
    },
    ...requiredWorkspaceClaims.map((id) => claimEvidence[id]),
  ].map(({ bytes, digest: evidenceDigest }) => ({
    bytes,
    digest: evidenceDigest,
    path: `${root}/claims/${evidenceDigest.slice("sha256:".length)}.evidence`,
  }));
  write(options.repository, proofPath, proofBytes);
  for (const file of evidenceFiles) {
    write(options.repository, file.path, file.bytes);
  }
  const producerIndex = workspaceProducerIndex({
    proof,
    migrationHead: options.migrationHead,
  });
  const producerFiles = new Map<string, Buffer>([
    ["reports/test-report.json", testReportBytes],
    ["reports/postgres-authority-report.json", postgresAuthorityBytes],
    ...requiredWorkspaceClaims.map(
      (id) => [`claims/${id}.json`, claimEvidence[id].bytes] as const,
    ),
  ]);
  const producerAttestation: GitHubWorkspaceProducerAttestation = {
    repository: workspaceProducerRepository,
    workflow: workspaceProducerWorkflow,
    sourceCommit: options.sourceCommit,
    conclusion: "success",
    runUrl: proof.producer.workflowRunUrl,
    indexBytes: Buffer.from(`${JSON.stringify(producerIndex, null, 2)}\n`),
    files: producerFiles,
  };

  return {
    contracts: { workspace: 1 as const },
    evidence: {
      workspaceIsolation: {
        contract: "vorton.workspace-isolation-proof.v1" as const,
        proof: {
          path: proofPath,
          digest: digest(proofBytes),
        },
        files: evidenceFiles.map(({ path, digest: evidenceDigest }) => ({
          path,
          digest: evidenceDigest,
        })),
      },
    },
    evidenceFiles,
    proof,
    proofBytes,
    proofPath,
    producerAttestation,
  };
}
