import { describe, expect, it } from "vitest";

import {
  requiredWorkspaceClaims,
  validateGitHubProducer,
  validateWorkspaceIsolationProof,
  workspaceProofHash,
  type WorkspaceIsolationProof,
} from "./workspace-isolation-proof.js";

const sourceCommit = "a".repeat(40);
const migrationHead = "20260830000100_workspaces";
const evidenceSha256 = `sha256:${"b".repeat(64)}`;

function proof(): WorkspaceIsolationProof {
  const unsigned = {
    schemaVersion: 1,
    contract: "vorton.workspace-isolation-proof.v1",
    status: "passed",
    generatedAt: "2026-08-30T21:00:00Z",
    sourceCommit,
    migrationHead,
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
      testReportSha256: evidenceSha256,
      postgresAuthoritySha256: evidenceSha256,
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
      evidenceSha256,
    })),
    releaseBlockers: [] as [],
  } satisfies Omit<WorkspaceIsolationProof, "proofHash">;
  return {
    ...unsigned,
    proofHash: workspaceProofHash(unsigned),
  };
}

describe("workspace isolation release proof", () => {
  it("accepts the complete AubOS consumer contract without weakening claims", () => {
    expect(
      validateWorkspaceIsolationProof(proof(), {
        sourceCommit,
        migrationHead,
      }),
    ).toMatchObject({ status: "passed", releaseBlockers: [] });
  });

  it("rejects missing or reordered adversarial claims", () => {
    expect(requiredWorkspaceClaims[7]).toBe(
      "installation-scoped-workspace-birth",
    );
    const candidate = proof() as unknown as Record<string, unknown>;
    candidate.claims = [...(candidate.claims as unknown[])].reverse();
    candidate.proofHash = workspaceProofHash(candidate);
    expect(() =>
      validateWorkspaceIsolationProof(candidate, {
        sourceCommit,
        migrationHead,
      }),
    ).toThrow("claim identity or order differs");
  });

  it("requires the installation-scoped workspace birth authority boundary", () => {
    const candidate = proof() as unknown as Record<string, any>;
    candidate.authority.workspaceCreationApprovalConsumedExactlyOnce = false;
    candidate.proofHash = workspaceProofHash(candidate);
    expect(() =>
      validateWorkspaceIsolationProof(candidate, {
        sourceCommit,
        migrationHead,
      }),
    ).toThrow("not consumed exactly once");
  });

  it("rejects unmodeled proof and nested authority properties", () => {
    const extraRoot = {
      ...proof(),
      unmodeledProofProperty: true,
    } as unknown as Record<string, unknown>;
    extraRoot.proofHash = workspaceProofHash(extraRoot);
    expect(() =>
      validateWorkspaceIsolationProof(extraRoot, {
        sourceCommit,
        migrationHead,
      }),
    ).toThrow("Workspace proof fields differ");

    const extraAuthority = proof() as unknown as Record<string, any>;
    extraAuthority.authority.unmodeledAuthorityProperty = true;
    extraAuthority.proofHash = workspaceProofHash(extraAuthority);
    expect(() =>
      validateWorkspaceIsolationProof(extraAuthority, {
        sourceCommit,
        migrationHead,
      }),
    ).toThrow("Workspace proof authority fields differ");
  });

  it("rejects the Factory pilot and every remaining release blocker", () => {
    const pilot = proof() as unknown as Record<string, any>;
    pilot.factory.currentPilotAcceptedAsProof = true;
    pilot.proofHash = workspaceProofHash(pilot);
    expect(() =>
      validateWorkspaceIsolationProof(pilot, { sourceCommit, migrationHead }),
    ).toThrow("Factory pilot was accepted");

    const blocked = proof() as unknown as Record<string, any>;
    blocked.releaseBlockers = ["storage-objects"];
    blocked.proofHash = workspaceProofHash(blocked);
    expect(() =>
      validateWorkspaceIsolationProof(blocked, {
        sourceCommit,
        migrationHead,
      }),
    ).toThrow("still has blockers");
  });

  it("binds the proof to its exact GitHub workflow commit and run", () => {
    const candidate = proof();
    expect(() =>
      validateGitHubProducer(candidate, {
        GITHUB_ACTIONS: "true",
        GITHUB_SHA: sourceCommit,
        GITHUB_RUN_ID: "123",
      }),
    ).not.toThrow();
    expect(() =>
      validateGitHubProducer(candidate, {
        GITHUB_ACTIONS: "true",
        GITHUB_SHA: "c".repeat(40),
        GITHUB_RUN_ID: "123",
      }),
    ).toThrow("commit differs");
  });
});
