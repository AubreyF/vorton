import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { FakeExecutiveWorkerAdapter } from "@vorton/workers";
import { InMemoryExecutiveLedger } from "@vorton/executive";
import type { Database } from "@vorton/database";
import { workspaceCompiledCoreSurfaceRegistrySha256 } from "@vorton/contracts";

import type { AuthenticatedIdentity } from "./auth.js";
import { InstallationAuthorityIntegrityError } from "./installation-authority.js";
import {
  ModuleLifecycleAuthorityConflictError,
  ModuleLifecycleAuthorityForbiddenError,
  ModuleLifecycleAuthorityInputError,
  ModuleLifecycleAuthorityIntegrityError,
} from "./module-lifecycle-authority.js";
import {
  WorkspaceMembershipRevocationConflictError,
  WorkspaceMembershipRevocationForbiddenError,
  WorkspaceMembershipRevocationInputError,
  WorkspaceMembershipRevocationIntegrityError,
} from "./workspace-membership-revocation.js";
import {
  WorkspaceCoreSurfaceSelectionConflictError,
  WorkspaceCoreSurfaceSelectionForbiddenError,
  WorkspaceCoreSurfaceSelectionInputError,
  WorkspaceCoreSurfaceSelectionIntegrityError,
} from "./workspace-core-surface-selection.js";
import { createApiServer } from "./server.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5"; // gitleaks:allow
const personId = "7fb46f09-3894-4c24-933c-77c7a403341c";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const credentialId = "ae24e48d-19b0-4e8f-8e06-6194bacf1ae1";
const workerToken = "w".repeat(43);
const workId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const roleId = "d37f356b-6297-4cd1-902d-c2755423a612";
const servers: ReturnType<typeof createApiServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function runtime(
  identity: AuthenticatedIdentity = {
    authUserId,
    aal: "aal2",
    authTime: Math.floor(Date.now() / 1000),
  },
) {
  const ledger = new InMemoryExecutiveLedger(() => crypto.randomUUID());
  await ledger.append({
    installationId,
    workspaceId,
    workId: null,
    kind: "evidence",
    summary: "Synthetic runtime evidence",
    payload: { classification: "synthetic", sourceUri: null },
    actor: { kind: "person", id: personId },
  });
  const evidence = ledger.records[0]!;
  const authorityVerifier = {
    resolvePerson: async (input: { authUserId: string }) => {
      if (input.authUserId !== authUserId)
        throw new Error("Member authority is required");
      return personId;
    },
    assertApplicable: async () => undefined,
  };
  const database = {
    asAdministrator: async (
      operation: (transaction: {
        query: (sql: string) => Promise<{ rows: never[]; rowCount: number }>;
      }) => Promise<unknown>,
    ) => operation({ query: async () => ({ rows: [], rowCount: 1 }) }),
  } as unknown as Database;
  const councilCalls: Array<{
    operation: "get" | "install" | "advance";
    workId: string;
    requester: {
      installationId: string;
      workspaceId: string;
      authUserId: string;
    };
  }> = [];
  const installationAuthorityCalls: Array<{
    operation: "release" | "workspace";
    installationId: string;
    request: unknown;
    identity: AuthenticatedIdentity;
  }> = [];
  const moduleLifecycleAuthorityCalls: Array<{
    installationId: string;
    workspaceId: string;
    request: unknown;
    identity: AuthenticatedIdentity;
  }> = [];
  const moduleLifecycleExecutionCalls: Array<{
    operation: "consume" | "finalize";
    installationId: string;
    workspaceId: string;
    authorityId: string;
    request: unknown;
    worker: unknown;
  }> = [];
  const workspaceMembershipRevocationCalls: Array<{
    operation: "approve" | "apply";
    installationId: string;
    workspaceId: string;
    approvalId?: string;
    request: unknown;
    identity: AuthenticatedIdentity;
  }> = [];
  const workspaceCoreSurfaceSelectionCalls: Array<{
    operation: "approve" | "apply";
    installationId: string;
    workspaceId: string;
    approvalId?: string;
    request: unknown;
    identity: AuthenticatedIdentity;
  }> = [];
  const councilState = {
    protocol: "vorton.executive-council.v1",
    installationId,
    workspaceId,
    work: {
      id: workId,
      title: "Assess fixture",
      requestedOutcome: "Reach a grounded recommendation",
      acceptanceCriteria: ["Preserve dissent"],
      state: "ready",
    },
    authority: "none",
    phase: "proposal",
    nextStep: {
      phase: "proposal",
      roleId,
      roleName: "Chief Executive Officer",
    },
    counts: { proposals: 0, reviews: 0, syntheses: 0, total: 0, required: 11 },
    roles: [],
    synthesis: null,
  };
  const server = createApiServer({
    database,
    ledger,
    authorityVerifier,
    identityVerifier: { verify: async () => identity },
    worker: new FakeExecutiveWorkerAdapter(),
    requestResolver: {
      resolveBootstrap: async (resolvedAuthUserId: string) => ({
        installations:
          resolvedAuthUserId === authUserId
            ? [
                {
                  id: installationId,
                  slug: "synthetic-installation",
                  displayName: "Synthetic installation",
                  workspaces: [
                    {
                      id: workspaceId,
                      slug: "synthetic-workspace",
                      displayName: "Synthetic workspace",
                      moduleSurface: {
                        defaultModuleId: "command",
                        modules: [
                          {
                            id: "command",
                            contractVersion: "v1",
                            label: "Command Bridge",
                            navigationOrder: 10,
                            presentationVariant: "standard",
                          },
                        ],
                      },
                      realm: "organizational" as const,
                      personKind: "owner" as const,
                      workItems: [
                        {
                          id: workId,
                          title: "Assess fixture",
                          requestedOutcome: "Reach a grounded recommendation",
                          acceptanceCriteria: ["Cite the synthetic evidence"],
                          state: "ready" as const,
                          priority: 80,
                          parentWorkId: null,
                          custodianName: "Synthetic worker",
                          custodianKind: "worker" as const,
                          updatedAt: "2026-08-30T01:02:03.000Z",
                        },
                      ],
                      proposalBindings: [
                        {
                          workId,
                          workTitle: "Assess fixture",
                          workerId,
                          workerName: "Synthetic worker",
                          roleId,
                          roleName: "Synthetic reviewer",
                          evidence: [
                            {
                              id: evidence.id,
                              summary: evidence.summary,
                              classification: "synthetic",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ]
            : [],
      }),
      resolveProposal: async (input: {
        installationId: string;
        workspaceId: string;
        workId: string;
        workerId: string;
        roleId: string;
        objective: string;
        background: boolean;
      }) => ({
        installationId: input.installationId,
        workspaceId: input.workspaceId,
        workId: input.workId,
        workerId: input.workerId,
        role: {
          roleId: input.roleId,
          name: "Synthetic reviewer",
          version: 1,
          contentSha256: "a".repeat(64),
          skillMarkdown: "Recommend. Never execute.",
        },
        objective: input.objective,
        evidence: [
          {
            recordId: evidence.id,
            summary: evidence.summary,
            sourceUri: null,
            classification: "synthetic" as const,
          },
        ],
        background: input.background,
      }),
      resolveAuthority: async (input: {
        approvalRecordId: string;
        capabilityGrantId: string;
      }) => ({
        policyId: roleId,
        capabilityGrantId: input.capabilityGrantId,
        approvalRecordId: input.approvalRecordId,
        executorWorkerId: workerId,
        capability: "executive.synthetic.check",
        mode: "diagnose" as const,
      }),
    } as never,
    workerRuns: { record: async () => "synthetic-run" } as never,
    councilResolver: {
      get: async (
        resolvedWorkId: string,
        requester: {
          installationId: string;
          workspaceId: string;
          authUserId: string;
        },
      ) => {
        councilCalls.push({
          operation: "get",
          workId: resolvedWorkId,
          requester,
        });
        return councilState;
      },
      install: async (
        resolvedWorkId: string,
        requester: {
          installationId: string;
          workspaceId: string;
          authUserId: string;
        },
      ) => {
        councilCalls.push({
          operation: "install",
          workId: resolvedWorkId,
          requester,
        });
        return councilState;
      },
      advance: async (
        resolvedWorkId: string,
        requester: {
          installationId: string;
          workspaceId: string;
          authUserId: string;
        },
      ) => {
        councilCalls.push({
          operation: "advance",
          workId: resolvedWorkId,
          requester,
        });
        return councilState;
      },
    } as never,
    installationAuthority: {
      approveRelease: async (
        resolvedInstallationId: string,
        request: { planHash?: string },
        resolvedIdentity: AuthenticatedIdentity,
      ) => {
        if (request.planHash === `sha256:${"9".repeat(64)}`) {
          throw new InstallationAuthorityIntegrityError(
            "sensitive malformed database output detail",
          );
        }
        installationAuthorityCalls.push({
          operation: "release",
          installationId: resolvedInstallationId,
          request,
          identity: resolvedIdentity,
        });
        return { contract: "vorton.release-adoption-approval.v1" };
      },
      approveWorkspace: async () => {
        throw new Error("not configured in this fixture");
      },
    } as never,
    moduleLifecycleAuthority: {
      approve: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        request: { approvalId: string },
        resolvedIdentity: AuthenticatedIdentity,
      ) => {
        if (request.approvalId === "66666666-6666-4666-8666-666666666666") {
          throw new ModuleLifecycleAuthorityInputError(
            "The module lifecycle approval request is invalid",
          );
        }
        if (request.approvalId === "77777777-7777-4777-8777-777777777777") {
          throw new ModuleLifecycleAuthorityForbiddenError(
            "Live workspace owner authority with recent AAL2 is required",
          );
        }
        if (request.approvalId === "88888888-8888-4888-8888-888888888888") {
          throw new ModuleLifecycleAuthorityConflictError(
            "The requested approval conflicts with immutable lifecycle authority",
          );
        }
        if (request.approvalId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab") {
          throw new WorkspaceCoreSurfaceSelectionConflictError(
            "Expected predecessor core-surface selection receipt is invalid",
          );
        }
        if (request.approvalId === "99999999-9999-4999-8999-999999999999") {
          throw new ModuleLifecycleAuthorityIntegrityError(
            "sensitive malformed lifecycle receipt detail",
          );
        }
        moduleLifecycleAuthorityCalls.push({
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          request,
          identity: resolvedIdentity,
        });
        return {
          approval: {
            contract: "vorton.module-lifecycle-action-approval.v1",
            approvalId: request.approvalId,
          },
          receipt: {
            contract: "vorton.module-lifecycle-approval-receipt.v1",
          },
        };
      },
    } as never,
    workerCredentialVerifier: {
      authenticateCredential: async (token: string) =>
        token === workerToken
          ? {
              credentialId,
              installationId,
              workspaceId,
              workerId,
              expiresAt: "2026-08-31T20:00:00.000Z",
            }
          : null,
    },
    moduleLifecycleExecution: {
      consume: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        approvalId: string,
        request: unknown,
        resolvedWorker: unknown,
      ) => {
        moduleLifecycleExecutionCalls.push({
          operation: "consume",
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          authorityId: approvalId,
          request,
          worker: resolvedWorker,
        });
        return {
          approval: { contract: "vorton.module-lifecycle-action-approval.v1" },
          approvalReceipt: {
            contract: "vorton.module-lifecycle-approval-receipt.v1",
          },
          command: {
            contract: "vorton.module-lifecycle-action-command.v1",
          },
        };
      },
      finalize: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        commandId: string,
        request: unknown,
        resolvedWorker: unknown,
      ) => {
        moduleLifecycleExecutionCalls.push({
          operation: "finalize",
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          authorityId: commandId,
          request,
          worker: resolvedWorker,
        });
        return {
          command: {
            contract: "vorton.module-lifecycle-action-command.v1",
          },
          actionReceipt: {
            contract: "vorton.module-lifecycle-action-receipt.v1",
          },
        };
      },
    } as never,
    workspaceMembershipRevocationAuthority: {
      approve: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        request: { approvalId: string },
        resolvedIdentity: AuthenticatedIdentity,
      ) => {
        if (request.approvalId === "66666666-6666-4666-8666-666666666666") {
          throw new WorkspaceMembershipRevocationInputError(
            "The workspace membership revocation request is invalid",
          );
        }
        if (request.approvalId === "77777777-7777-4777-8777-777777777777") {
          throw new WorkspaceMembershipRevocationForbiddenError(
            "Live workspace owner authority is required",
          );
        }
        if (request.approvalId === "88888888-8888-4888-8888-888888888888") {
          throw new WorkspaceMembershipRevocationConflictError(
            "The request conflicts with immutable workspace membership authority",
          );
        }
        if (request.approvalId === "99999999-9999-4999-8999-999999999999") {
          throw new WorkspaceMembershipRevocationIntegrityError(
            "sensitive malformed membership revocation detail",
          );
        }
        workspaceMembershipRevocationCalls.push({
          operation: "approve",
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          request,
          identity: resolvedIdentity,
        });
        return {
          approval: {
            contract: "vorton.workspace-membership-revocation-approval.v1",
            approvalId: request.approvalId,
          },
          approvalReceipt: {
            contract:
              "vorton.workspace-membership-revocation-approval-receipt.v1",
          },
        };
      },
      apply: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        approvalId: string,
        request: unknown,
        resolvedIdentity: AuthenticatedIdentity,
      ) => {
        workspaceMembershipRevocationCalls.push({
          operation: "apply",
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          approvalId,
          request,
          identity: resolvedIdentity,
        });
        return {
          approval: {
            contract: "vorton.workspace-membership-revocation-approval.v1",
            approvalId,
          },
          approvalReceipt: {
            contract:
              "vorton.workspace-membership-revocation-approval-receipt.v1",
          },
          receipt: {
            contract: "vorton.workspace-membership-revocation-receipt.v1",
          },
        };
      },
    } as never,
    workspaceCoreSurfaceSelectionAuthority: {
      approve: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        request: { approvalId: string },
        resolvedIdentity: AuthenticatedIdentity,
      ) => {
        if (request.approvalId === "66666666-6666-4666-8666-666666666666") {
          throw new WorkspaceCoreSurfaceSelectionInputError(
            "The workspace core-surface selection request is invalid",
          );
        }
        if (request.approvalId === "77777777-7777-4777-8777-777777777777") {
          throw new WorkspaceCoreSurfaceSelectionForbiddenError(
            "Live workspace owner authority is required",
          );
        }
        if (request.approvalId === "88888888-8888-4888-8888-888888888888") {
          throw new WorkspaceCoreSurfaceSelectionConflictError(
            "The request conflicts with immutable workspace core-surface authority",
          );
        }
        if (request.approvalId === "99999999-9999-4999-8999-999999999999") {
          throw new WorkspaceCoreSurfaceSelectionIntegrityError(
            "sensitive malformed core-surface selection detail",
          );
        }
        workspaceCoreSurfaceSelectionCalls.push({
          operation: "approve",
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          request,
          identity: resolvedIdentity,
        });
        return {
          approval: {
            contract: "vorton.workspace-core-surface-selection-approval.v1",
            approvalId: request.approvalId,
          },
          approvalReceipt: {
            contract:
              "vorton.workspace-core-surface-selection-approval-receipt.v1",
          },
        };
      },
      apply: async (
        resolvedInstallationId: string,
        resolvedWorkspaceId: string,
        approvalId: string,
        request: unknown,
        resolvedIdentity: AuthenticatedIdentity,
      ) => {
        workspaceCoreSurfaceSelectionCalls.push({
          operation: "apply",
          installationId: resolvedInstallationId,
          workspaceId: resolvedWorkspaceId,
          approvalId,
          request,
          identity: resolvedIdentity,
        });
        return {
          approval: {
            contract: "vorton.workspace-core-surface-selection-approval.v1",
            approvalId,
          },
          approvalReceipt: {
            contract:
              "vorton.workspace-core-surface-selection-approval-receipt.v1",
          },
          receipt: {
            contract: "vorton.workspace-core-surface-selection-receipt.v1",
          },
        };
      },
    } as never,
    release: "synthetic-test",
    allowedOrigin: "https://control.vorton.example",
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    ledger,
    evidence,
    councilCalls,
    installationAuthorityCalls,
    moduleLifecycleAuthorityCalls,
    moduleLifecycleExecutionCalls,
    workspaceMembershipRevocationCalls,
    workspaceCoreSurfaceSelectionCalls,
  };
}

function proposal(evidenceId: string) {
  return {
    installationId,
    workspaceId,
    workId,
    workerId,
    roleId,
    objective: "Assess the synthetic fixture",
    evidenceRecordIds: [evidenceId],
    background: false,
  };
}

function moduleLifecycleApproval(
  approvalId = "22222222-2222-4222-8222-222222222222",
) {
  const digest = (character: string) => `sha256:${character.repeat(64)}`;
  return {
    approvalId,
    binding: {
      vortonInstallationId: installationId,
      workspaceId,
      realm: "organizational",
      module: "tasks",
      sequence: 1,
      migrationPlanHash: digest("1"),
      sourceSnapshotSha256: digest("2"),
      targetPreimageSha256: digest("3"),
      targetPostimageSha256: digest("4"),
      target: {
        action: "backup",
        backupId: "33333333-3333-4333-8333-333333333333",
        storageObjectKey: "tasks/sequence-1/preimage.enc",
        encryptionKeyBindingId: "44444444-4444-4444-8444-444444444444",
      },
    },
    expiresAt: "2026-08-31T12:00:00.000Z",
  };
}

const membershipTargetPersonId = "12121212-1212-4212-8212-121212121212";
const membershipCapabilityGrantId = "13131313-1313-4313-8313-131313131313";
const membershipApprovalId = "a4141414-1414-4414-8414-141414141414";
const membershipReceiptId = "15151515-1515-4515-8515-151515151515";

function workspaceMembershipRevocationApproval(
  approvalId = membershipApprovalId,
) {
  return {
    approvalId,
    targetPersonId: membershipTargetPersonId,
    expectedTargetKind: "member" as const,
    workId,
    capabilityGrantId: membershipCapabilityGrantId,
    expiresAt: "2026-09-01T12:00:00.000Z",
  };
}

function workspaceMembershipRevocationApply() {
  return { receiptId: membershipReceiptId };
}

const coreSurfaceSelectionApprovalId = "a6161616-1616-4616-8616-161616161616";
const coreSurfaceSelectionReceiptId = "17171717-1717-4717-8717-171717171717";
const coreSurfaceSelectionCapabilityGrantId =
  "18181818-1818-4818-8818-181818181818";
const coreSurfaceSelectionPredecessorReceiptId =
  "19191919-1919-4919-8919-191919191919";

function workspaceCoreSurfaceSelectionApproval(
  approvalId = coreSurfaceSelectionApprovalId,
) {
  return {
    approvalId,
    workId,
    capabilityGrantId: coreSurfaceSelectionCapabilityGrantId,
    compiledRegistrySha256: workspaceCompiledCoreSurfaceRegistrySha256,
    expectedCurrentSurfaceSha256: `sha256:${"1".repeat(64)}`,
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: coreSurfaceSelectionPredecessorReceiptId,
      receiptSha256: `sha256:${"2".repeat(64)}`,
    },
    targetPreferences: {
      defaultCoreSurfaceId: "command" as const,
      coreSurfaces: [
        { id: "command" as const, navigationOrder: 10 },
        { id: "factory" as const, navigationOrder: 20 },
      ],
    },
    expiresAt: "2026-09-01T12:00:00.000Z",
  };
}

function workspaceCoreSurfaceSelectionApply() {
  return { receiptId: coreSurfaceSelectionReceiptId };
}

const lifecycleApprovalId = "55555555-5555-4555-8555-555555555555";
const lifecycleCommandId = "66666666-6666-4666-8666-666666666666";
const lifecycleReceiptId = "77777777-7777-4777-8777-777777777777";

function moduleLifecycleConsume() {
  return {
    commandId: lifecycleCommandId,
    workId,
    proofScope: "controlled-synthetic" as const,
  };
}

function moduleLifecycleFinalize() {
  const digest = (character: string) => `sha256:${character.repeat(64)}`;
  return {
    receiptId: lifecycleReceiptId,
    outcome: { status: "succeeded" as const, code: "completed" as const },
    effects: {
      approvalConsumed: true as const,
      actionAttempted: true as const,
      actionCompleted: true as const,
      productionModuleDataMutated: false as const,
      otherWorkspaceMutated: false as const,
      mutationBoundary: "workspace-backup-artifact" as const,
    },
    evidence: {
      action: "backup" as const,
      capturedAt: "2026-08-31T18:00:00.000Z",
      recordCount: 0,
      capturedStateSha256: digest("5"),
      manifestSha256: digest("6"),
      encryptedArtifactSha256: digest("7"),
      encryptedAtRest: true as const,
      workspaceKeyBound: true as const,
      workspaceStorageBound: true as const,
      otherWorkspaceAccessDenied: true as const,
    },
  };
}

describe("control-plane API", () => {
  it("serves an unauthenticated health endpoint", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "vorton-api",
    });
  });

  it("returns only the verified caller's eligible runtime bootstrap", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(`${baseUrl}/v1/runtime/bootstrap`, {
      headers: { authorization: "Bearer verified-by-fixture" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      installations: [
        {
          id: installationId,
          slug: "synthetic-installation",
          workspaces: [
            {
              id: workspaceId,
              personKind: "owner",
              workItems: [{ id: workId, state: "ready", priority: 80 }],
              proposalBindings: [{ workId, workerId, roleId }],
            },
          ],
        },
      ],
    });
  });

  it("routes a strict recent-AAL2 release approval without caching it", async () => {
    const { baseUrl, installationAuthorityCalls } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/release-adoption-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          origin: "https://control.vorton.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approvalId: "22222222-2222-4222-8222-222222222222",
          planHash: `sha256:${"6".repeat(64)}`,
          release: {
            version: "1.0.0",
            sourceCommit: "a".repeat(40),
            manifestSha256: `sha256:${"1".repeat(64)}`,
            archiveSha256: `sha256:${"2".repeat(64)}`,
            coreMigrationHead: "20260830000300_installation_authority_api",
            workspaceIsolationProofSha256: `sha256:${"3".repeat(64)}`,
            workspaceIsolationProofHash: `sha256:${"4".repeat(64)}`,
            imageDigests: { api: `sha256:${"5".repeat(64)}` },
          },
          expiresAt: "2026-08-31T12:00:00.000Z",
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(installationAuthorityCalls).toHaveLength(1);
    expect(installationAuthorityCalls[0]).toMatchObject({
      operation: "release",
      installationId,
      identity: { authUserId, aal: "aal2" },
    });
  });

  it("does not expose an installation authority apply route", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/release-adoption-apply`,
      { method: "POST" },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a noncanonical uppercase installation identifier", async () => {
    const { baseUrl, installationAuthorityCalls } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId.toUpperCase()}/release-adoption-approvals`,
      {
        method: "POST",
        headers: { authorization: "Bearer verified-by-fixture" },
      },
    );
    expect(response.status).toBe(400);
    expect(installationAuthorityCalls).toEqual([]);
  });

  it("rejects an uppercase approval UUID before the authority adapter", async () => {
    const { baseUrl, installationAuthorityCalls } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/release-adoption-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approvalId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          planHash: `sha256:${"6".repeat(64)}`,
          release: {
            version: "1.0.0",
            sourceCommit: "a".repeat(40),
            manifestSha256: `sha256:${"1".repeat(64)}`,
            archiveSha256: `sha256:${"2".repeat(64)}`,
            coreMigrationHead: "20260830000300_installation_authority_api",
            workspaceIsolationProofSha256: `sha256:${"3".repeat(64)}`,
            workspaceIsolationProofHash: `sha256:${"4".repeat(64)}`,
            imageDigests: { api: `sha256:${"5".repeat(64)}` },
          },
          expiresAt: "2026-08-31T12:00:00.000Z",
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(installationAuthorityCalls).toEqual([]);
  });

  it("rejects release approval without a recent explicit second factor", async () => {
    const { baseUrl, installationAuthorityCalls } = await runtime({
      authUserId,
      aal: "aal2",
      authTime: undefined,
    });
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/release-adoption-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(installationAuthorityCalls).toEqual([]);
  });

  it("returns readable installation-authority failures to the allowed browser origin", async () => {
    const { baseUrl } = await runtime({
      authUserId,
      aal: "aal2",
      authTime: undefined,
    });
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/release-adoption-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          origin: "https://control.vorton.example",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://control.vorton.example",
    );
  });

  it("returns a generic 500 when database approval output violates integrity", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/release-adoption-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          origin: "https://control.vorton.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approvalId: "22222222-2222-4222-8222-222222222222",
          planHash: `sha256:${"9".repeat(64)}`,
          release: {
            version: "1.0.0",
            sourceCommit: "a".repeat(40),
            manifestSha256: `sha256:${"1".repeat(64)}`,
            archiveSha256: `sha256:${"2".repeat(64)}`,
            coreMigrationHead: "20260830000300_installation_authority_api",
            workspaceIsolationProofSha256: `sha256:${"3".repeat(64)}`,
            workspaceIsolationProofHash: `sha256:${"4".repeat(64)}`,
            imageDigests: { api: `sha256:${"5".repeat(64)}` },
          },
          expiresAt: "2026-08-31T12:00:00.000Z",
        }),
      },
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://control.vorton.example",
    );
    const payload = JSON.stringify(await response.json());
    expect(payload).toContain("internal_error");
    expect(payload).not.toContain("sensitive malformed");
  });

  it("routes a strict lifecycle approval and returns both no-store documents", async () => {
    const { baseUrl, moduleLifecycleAuthorityCalls } = await runtime();
    const body = moduleLifecycleApproval();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          origin: "https://control.vorton.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      approval: {
        contract: "vorton.module-lifecycle-action-approval.v1",
        approvalId: body.approvalId,
      },
      receipt: {
        contract: "vorton.module-lifecycle-approval-receipt.v1",
      },
    });
    expect(moduleLifecycleAuthorityCalls).toEqual([
      {
        installationId,
        workspaceId,
        request: body,
        identity: {
          authUserId,
          aal: "aal2",
          authTime: expect.any(Number),
        },
      },
    ]);
  });

  it("rejects future lifecycle AAL2 and cross-workspace bindings before the adapter", async () => {
    const future = await runtime({
      authUserId,
      aal: "aal2",
      authTime: Math.floor(Date.now() / 1_000) + 30,
    });
    const route = `/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals`;
    const futureResponse = await fetch(`${future.baseUrl}${route}`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify(moduleLifecycleApproval()),
    });
    expect(futureResponse.status).toBe(403);
    await expect(futureResponse.json()).resolves.toMatchObject({
      error: { code: "aal2_required" },
    });
    expect(future.moduleLifecycleAuthorityCalls).toEqual([]);

    const current = await runtime();
    const crossBound = moduleLifecycleApproval();
    crossBound.binding.workspaceId = crypto.randomUUID();
    const crossBoundResponse = await fetch(`${current.baseUrl}${route}`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify(crossBound),
    });
    expect(crossBoundResponse.status).toBe(400);
    expect(current.moduleLifecycleAuthorityCalls).toEqual([]);

    const malformedPathResponse = await fetch(
      `${current.baseUrl}/v1/installations/not-a-uuid/workspaces/${workspaceId}/module-lifecycle-action-approvals`,
      {
        method: "POST",
        headers: { authorization: "Bearer verified-by-fixture" },
      },
    );
    expect(malformedPathResponse.status).toBe(400);
    expect(current.moduleLifecycleAuthorityCalls).toEqual([]);
  });

  it("hides lifecycle serializer and hash failures behind a generic 500", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          origin: "https://control.vorton.example",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          moduleLifecycleApproval("99999999-9999-4999-8999-999999999999"),
        ),
      },
    );
    expect(response.status).toBe(500);
    const payload = JSON.stringify(await response.json());
    expect(payload).toContain("internal_error");
    expect(payload).not.toContain("sensitive malformed");
  });

  it("maps lifecycle input, lost authority, and immutable replay conflicts", async () => {
    const { baseUrl } = await runtime();
    const route = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals`;
    const headers = {
      authorization: "Bearer verified-by-fixture",
      "content-type": "application/json",
    };
    const cases = [
      ["66666666-6666-4666-8666-666666666666", 400, "invalid_request"],
      ["77777777-7777-4777-8777-777777777777", 403, "forbidden"],
      [
        "88888888-8888-4888-8888-888888888888",
        409,
        "module_lifecycle_authority_conflict",
      ],
      [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        409,
        "workspace_core_surface_selection_conflict",
      ],
    ] as const;
    for (const [approvalId, status, code] of cases) {
      const response = await fetch(route, {
        method: "POST",
        headers,
        body: JSON.stringify(moduleLifecycleApproval(approvalId)),
      });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    }
  });

  it("routes strict same-person membership approval and execution requests", async () => {
    const { baseUrl, workspaceMembershipRevocationCalls } = await runtime();
    const baseRoute = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/membership-revocation-approvals`;
    const headers = {
      authorization: "Bearer verified-by-fixture",
      origin: "https://control.vorton.example",
      "content-type": "application/json",
    };
    const approvalRequest = workspaceMembershipRevocationApproval();
    const approvalResponse = await fetch(baseRoute, {
      method: "POST",
      headers,
      body: JSON.stringify(approvalRequest),
    });
    expect(approvalResponse.status).toBe(201);
    expect(approvalResponse.headers.get("cache-control")).toBe("no-store");
    await expect(approvalResponse.json()).resolves.toMatchObject({
      approval: {
        contract: "vorton.workspace-membership-revocation-approval.v1",
        approvalId: membershipApprovalId,
      },
      approvalReceipt: {
        contract: "vorton.workspace-membership-revocation-approval-receipt.v1",
      },
    });

    const applyRequest = workspaceMembershipRevocationApply();
    const applyResponse = await fetch(
      `${baseRoute}/${membershipApprovalId}/execute`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(applyRequest),
      },
    );
    expect(applyResponse.status).toBe(200);
    expect(applyResponse.headers.get("cache-control")).toBe("no-store");
    await expect(applyResponse.json()).resolves.toMatchObject({
      receipt: {
        contract: "vorton.workspace-membership-revocation-receipt.v1",
      },
    });
    expect(workspaceMembershipRevocationCalls).toEqual([
      {
        operation: "approve",
        installationId,
        workspaceId,
        request: approvalRequest,
        identity: {
          authUserId,
          aal: "aal2",
          authTime: expect.any(Number),
        },
      },
      {
        operation: "apply",
        installationId,
        workspaceId,
        approvalId: membershipApprovalId,
        request: applyRequest,
        identity: {
          authUserId,
          aal: "aal2",
          authTime: expect.any(Number),
        },
      },
    ]);
  });

  it("rejects stale identity, claimed identity, and malformed membership revocation paths", async () => {
    const stale = await runtime({
      authUserId,
      aal: "aal2",
      authTime: Math.floor(Date.now() / 1_000) - 11 * 60,
    });
    const route = `${stale.baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/membership-revocation-approvals`;
    const staleResponse = await fetch(route, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify(workspaceMembershipRevocationApproval()),
    });
    expect(staleResponse.status).toBe(403);
    expect(stale.workspaceMembershipRevocationCalls).toEqual([]);

    const current = await runtime();
    const claimedResponse = await fetch(
      `${current.baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/membership-revocation-approvals`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...workspaceMembershipRevocationApproval(),
          authUserId: crypto.randomUUID(),
        }),
      },
    );
    expect(claimedResponse.status).toBe(400);

    for (const path of [
      `/v1/installations/not-a-uuid/workspaces/${workspaceId}/membership-revocation-approvals`,
      `/v1/installations/${installationId}/workspaces/${workspaceId}/membership-revocation-approvals/${membershipApprovalId.toUpperCase()}/execute`,
    ]) {
      const response = await fetch(`${current.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          path.endsWith("/execute")
            ? workspaceMembershipRevocationApply()
            : workspaceMembershipRevocationApproval(),
        ),
      });
      expect(response.status).toBe(400);
    }
    expect(current.workspaceMembershipRevocationCalls).toEqual([]);
  });

  it("maps membership revocation authority failures without leaking integrity details", async () => {
    const { baseUrl } = await runtime();
    const route = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/membership-revocation-approvals`;
    const headers = {
      authorization: "Bearer verified-by-fixture",
      origin: "https://control.vorton.example",
      "content-type": "application/json",
    };
    const cases = [
      ["66666666-6666-4666-8666-666666666666", 400, "invalid_request"],
      ["77777777-7777-4777-8777-777777777777", 403, "forbidden"],
      [
        "88888888-8888-4888-8888-888888888888",
        409,
        "workspace_membership_revocation_conflict",
      ],
      ["99999999-9999-4999-8999-999999999999", 500, "internal_error"],
    ] as const;
    for (const [approvalId, status, code] of cases) {
      const response = await fetch(route, {
        method: "POST",
        headers,
        body: JSON.stringify(workspaceMembershipRevocationApproval(approvalId)),
      });
      expect(response.status).toBe(status);
      const payload = JSON.stringify(await response.json());
      expect(payload).toContain(code);
      expect(payload).not.toContain("sensitive malformed");
    }
  });

  it("routes strict same-person core-surface selection approval and execution requests", async () => {
    const { baseUrl, workspaceCoreSurfaceSelectionCalls } = await runtime();
    const baseRoute = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/core-surface-selection-approvals`;
    const headers = {
      authorization: "Bearer verified-by-fixture",
      origin: "https://control.vorton.example",
      "content-type": "application/json",
    };
    const approvalRequest = workspaceCoreSurfaceSelectionApproval();
    const approvalResponse = await fetch(baseRoute, {
      method: "POST",
      headers,
      body: JSON.stringify(approvalRequest),
    });
    expect(approvalResponse.status).toBe(201);
    expect(approvalResponse.headers.get("cache-control")).toBe("no-store");
    await expect(approvalResponse.json()).resolves.toMatchObject({
      approval: {
        contract: "vorton.workspace-core-surface-selection-approval.v1",
        approvalId: coreSurfaceSelectionApprovalId,
      },
      approvalReceipt: {
        contract: "vorton.workspace-core-surface-selection-approval-receipt.v1",
      },
    });

    const applyRequest = workspaceCoreSurfaceSelectionApply();
    const applyResponse = await fetch(
      `${baseRoute}/${coreSurfaceSelectionApprovalId}/execute`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(applyRequest),
      },
    );
    expect(applyResponse.status).toBe(200);
    expect(applyResponse.headers.get("cache-control")).toBe("no-store");
    await expect(applyResponse.json()).resolves.toMatchObject({
      receipt: {
        contract: "vorton.workspace-core-surface-selection-receipt.v1",
      },
    });
    expect(workspaceCoreSurfaceSelectionCalls).toEqual([
      {
        operation: "approve",
        installationId,
        workspaceId,
        request: approvalRequest,
        identity: {
          authUserId,
          aal: "aal2",
          authTime: expect.any(Number),
        },
      },
      {
        operation: "apply",
        installationId,
        workspaceId,
        approvalId: coreSurfaceSelectionApprovalId,
        request: applyRequest,
        identity: {
          authUserId,
          aal: "aal2",
          authTime: expect.any(Number),
        },
      },
    ]);
  });

  it("rejects stale or future identity, claimed identity, malformed body, and noncanonical core-surface selection paths", async () => {
    for (const authTime of [
      Math.floor(Date.now() / 1_000) - 11 * 60,
      Math.floor(Date.now() / 1_000) + 60,
    ]) {
      const runtimeWithInvalidAal2 = await runtime({
        authUserId,
        aal: "aal2",
        authTime,
      });
      const response = await fetch(
        `${runtimeWithInvalidAal2.baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/core-surface-selection-approvals`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer verified-by-fixture",
            "content-type": "application/json",
          },
          body: JSON.stringify(workspaceCoreSurfaceSelectionApproval()),
        },
      );
      expect(response.status).toBe(403);
      expect(runtimeWithInvalidAal2.workspaceCoreSurfaceSelectionCalls).toEqual(
        [],
      );
    }

    const current = await runtime();
    const baseRoute = `${current.baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/core-surface-selection-approvals`;
    const headers = {
      authorization: "Bearer verified-by-fixture",
      "content-type": "application/json",
    };
    const invalidBodies = [
      {
        ...workspaceCoreSurfaceSelectionApproval(),
        authUserId: crypto.randomUUID(),
      },
      { ...workspaceCoreSurfaceSelectionApproval(), unexpected: true },
      {
        ...workspaceCoreSurfaceSelectionApproval(),
        compiledRegistrySha256: `sha256:${"9".repeat(64)}`,
      },
      {
        ...workspaceCoreSurfaceSelectionApproval(),
        targetPreferences: {
          ...workspaceCoreSurfaceSelectionApproval().targetPreferences,
          label: "Caller injection",
        },
      },
      {
        ...workspaceCoreSurfaceSelectionApproval(),
        targetPreferences: {
          ...workspaceCoreSurfaceSelectionApproval().targetPreferences,
          presentationVariant: "read-only",
        },
      },
      { receiptId: coreSurfaceSelectionReceiptId, unexpected: true },
    ];
    const bodyRoutes = [
      baseRoute,
      baseRoute,
      baseRoute,
      baseRoute,
      baseRoute,
      `${baseRoute}/${coreSurfaceSelectionApprovalId}/execute`,
    ];
    for (let index = 0; index < invalidBodies.length; index += 1) {
      const response = await fetch(bodyRoutes[index]!, {
        method: "POST",
        headers,
        body: JSON.stringify(invalidBodies[index]),
      });
      expect(response.status).toBe(400);
    }

    for (const path of [
      `/v1/installations/not-a-uuid/workspaces/${workspaceId}/core-surface-selection-approvals`,
      `/v1/installations/${installationId}/workspaces/${workspaceId}/core-surface-selection-approvals/${coreSurfaceSelectionApprovalId.toUpperCase()}/execute`,
    ]) {
      const response = await fetch(`${current.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          path.endsWith("/execute")
            ? workspaceCoreSurfaceSelectionApply()
            : workspaceCoreSurfaceSelectionApproval(),
        ),
      });
      expect(response.status).toBe(400);
    }
    expect(current.workspaceCoreSurfaceSelectionCalls).toEqual([]);
  });

  it("maps core-surface selection authority failures without leaking integrity details", async () => {
    const { baseUrl } = await runtime();
    const route = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/core-surface-selection-approvals`;
    const headers = {
      authorization: "Bearer verified-by-fixture",
      origin: "https://control.vorton.example",
      "content-type": "application/json",
    };
    const cases = [
      ["66666666-6666-4666-8666-666666666666", 400, "invalid_request"],
      ["77777777-7777-4777-8777-777777777777", 403, "forbidden"],
      [
        "88888888-8888-4888-8888-888888888888",
        409,
        "workspace_core_surface_selection_conflict",
      ],
      ["99999999-9999-4999-8999-999999999999", 500, "internal_error"],
    ] as const;
    for (const [approvalId, status, code] of cases) {
      const response = await fetch(route, {
        method: "POST",
        headers,
        body: JSON.stringify(workspaceCoreSurfaceSelectionApproval(approvalId)),
      });
      expect(response.status).toBe(status);
      const payload = JSON.stringify(await response.json());
      expect(payload).toContain(code);
      expect(payload).not.toContain("sensitive malformed");
    }
  });

  it("routes originless worker-only lifecycle consume and finalize requests without caching", async () => {
    const { baseUrl, moduleLifecycleExecutionCalls } = await runtime();
    const consumeRequest = moduleLifecycleConsume();
    const consumeResponse = await fetch(
      `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals/${lifecycleApprovalId}/consume`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${workerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(consumeRequest),
      },
    );

    expect(consumeResponse.status).toBe(200);
    expect(consumeResponse.headers.get("cache-control")).toBe("no-store");
    expect(
      consumeResponse.headers.get("access-control-allow-origin"),
    ).toBeNull();
    await expect(consumeResponse.json()).resolves.toMatchObject({
      approval: { contract: "vorton.module-lifecycle-action-approval.v1" },
      approvalReceipt: {
        contract: "vorton.module-lifecycle-approval-receipt.v1",
      },
      command: { contract: "vorton.module-lifecycle-action-command.v1" },
    });

    const finalizeRequest = moduleLifecycleFinalize();
    const finalizeResponse = await fetch(
      `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-commands/${lifecycleCommandId}/finalize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${workerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(finalizeRequest),
      },
    );

    expect(finalizeResponse.status).toBe(200);
    expect(finalizeResponse.headers.get("cache-control")).toBe("no-store");
    expect(
      finalizeResponse.headers.get("access-control-allow-origin"),
    ).toBeNull();
    await expect(finalizeResponse.json()).resolves.toMatchObject({
      command: { contract: "vorton.module-lifecycle-action-command.v1" },
      actionReceipt: {
        contract: "vorton.module-lifecycle-action-receipt.v1",
      },
    });

    const authenticatedWorker = {
      credentialId,
      installationId,
      workspaceId,
      workerId,
      expiresAt: "2026-08-31T20:00:00.000Z",
    };
    expect(moduleLifecycleExecutionCalls).toEqual([
      {
        operation: "consume",
        installationId,
        workspaceId,
        authorityId: lifecycleApprovalId,
        request: consumeRequest,
        worker: authenticatedWorker,
      },
      {
        operation: "finalize",
        installationId,
        workspaceId,
        authorityId: lifecycleCommandId,
        request: finalizeRequest,
        worker: authenticatedWorker,
      },
    ]);
  });

  it("rejects missing and human-session bearer credentials at the worker boundary", async () => {
    const { baseUrl, moduleLifecycleExecutionCalls } = await runtime();
    const route = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals/${lifecycleApprovalId}/consume`;
    const humanJwt =
      "eyJhbGciOiJSUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.signature";

    for (const authorization of [undefined, `Bearer ${humanJwt}`]) {
      const response = await fetch(route, {
        method: "POST",
        headers: {
          ...(authorization ? { authorization } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(moduleLifecycleConsume()),
      });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "unauthorized" },
      });
    }
    expect(moduleLifecycleExecutionCalls).toEqual([]);
  });

  it("rejects claimed worker identities and noncanonical lifecycle execution paths before the adapter", async () => {
    const { baseUrl, moduleLifecycleExecutionCalls } = await runtime();
    const headers = {
      authorization: `Bearer ${workerToken}`,
      "content-type": "application/json",
    };
    const consumeRoute = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-approvals/${lifecycleApprovalId}/consume`;
    const finalizeRoute = `${baseUrl}/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-commands/${lifecycleCommandId}/finalize`;

    const claimedWorkerResponse = await fetch(consumeRoute, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...moduleLifecycleConsume(), workerId }),
    });
    expect(claimedWorkerResponse.status).toBe(400);

    const claimedCredentialResponse = await fetch(finalizeRoute, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...moduleLifecycleFinalize(), credentialId }),
    });
    expect(claimedCredentialResponse.status).toBe(400);

    for (const path of [
      `/v1/installations/not-a-uuid/workspaces/${workspaceId}/module-lifecycle-action-approvals/${lifecycleApprovalId}/consume`,
      `/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-action-commands/${credentialId.toUpperCase()}/finalize`,
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          path.includes("/consume")
            ? moduleLifecycleConsume()
            : moduleLifecycleFinalize(),
        ),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_request" },
      });
    }
    expect(moduleLifecycleExecutionCalls).toEqual([]);
  });

  it("does not expose generic lifecycle apply or action routes", async () => {
    const { baseUrl } = await runtime();
    for (const path of [
      `/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-actions`,
      `/v1/installations/${installationId}/workspaces/${workspaceId}/module-lifecycle-apply`,
    ]) {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST" });
      expect(response.status).toBe(404);
    }
  });

  it("persists model output only as a recommendation proposal", async () => {
    const { baseUrl, ledger, evidence } = await runtime();
    const response = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify(proposal(evidence.id)),
    });
    expect(response.status).toBe(201);
    expect(ledger.records.map((record) => record.kind)).toEqual([
      "evidence",
      "proposal",
    ]);
    expect(ledger.work).toEqual([]);
  });

  it("rejects an identity supplied in the body and grants no execution authority", async () => {
    const { baseUrl, ledger, evidence } = await runtime();
    const response = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...proposal(evidence.id),
        authUserId: crypto.randomUUID(),
      }),
    });
    expect(response.status).toBe(400);
    expect(ledger.records).toHaveLength(1);
    const execution = await fetch(`${baseUrl}/v1/executive/work`, {
      method: "POST",
    });
    expect(execution.status).toBe(400);
    expect(ledger.work).toEqual([]);
  });

  it("requires separate human review, decision, and approval before promotion to Work", async () => {
    const { baseUrl, ledger, evidence } = await runtime();
    const headers = {
      authorization: "Bearer verified-by-fixture",
      "content-type": "application/json",
    };
    const proposalResponse = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(proposal(evidence.id)),
    });
    const proposalPayload = (await proposalResponse.json()) as {
      proposal: { id: string };
    };
    expect(ledger.work).toEqual([]);

    const review = (await fetch(`${baseUrl}/v1/executive/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        workspaceId,
        proposalRecordId: proposalPayload.proposal.id,
        summary: "Human review supports the bounded diagnostic",
        disposition: "support",
      }),
    }).then((response) => response.json())) as { id: string };
    const decision = (await fetch(`${baseUrl}/v1/executive/decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        workspaceId,
        reviewRecordId: review.id,
        summary: "Owner decision remains bounded",
        classification: "owner-required",
      }),
    }).then((response) => response.json())) as { id: string };
    const approval = (await fetch(`${baseUrl}/v1/executive/approvals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        workspaceId,
        decisionRecordId: decision.id,
        summary: "Approved for synthetic diagnosis only",
      }),
    }).then((response) => response.json())) as { id: string };
    expect(ledger.work).toEqual([]);

    const promoted = await fetch(`${baseUrl}/v1/executive/work`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        workspaceId,
        approvalRecordId: approval.id,
        capabilityGrantId: "4156f0af-e62f-4b16-a7bc-97c8301c2e2f",
        title: "Run synthetic diagnostic",
        requestedOutcome: "Produce a bounded diagnostic receipt",
        acceptanceCriteria: ["No external system is contacted"],
      }),
    });
    expect(promoted.status).toBe(201);
    expect(ledger.records.map((record) => record.kind)).toEqual([
      "evidence",
      "proposal",
      "review",
      "decision",
      "approval",
    ]);
    expect(ledger.work).toHaveLength(1);
  });

  it("allows credentialed CORS only from the configured control-plane origin", async () => {
    const { baseUrl } = await runtime();
    const allowed = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "OPTIONS",
      headers: {
        origin: "https://control.vorton.example",
        "access-control-request-method": "POST",
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://control.vorton.example",
    );
    const denied = await fetch(`${baseUrl}/healthz`, {
      headers: { origin: "https://forged.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("exposes server-resolved council read, install, and one-step advance routes", async () => {
    const { baseUrl, councilCalls } = await runtime();
    const headers = {
      authorization: "Bearer verified-by-fixture",
      "content-type": "application/json",
    };
    const read = await fetch(
      `${baseUrl}/v1/executive/councils/${workId}?installationId=${installationId}&workspaceId=${workspaceId}`,
      { headers },
    );
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({
      protocol: "vorton.executive-council.v1",
      authority: "none",
      counts: { required: 11 },
    });
    const install = await fetch(
      `${baseUrl}/v1/executive/councils/${workId}/install`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ installationId, workspaceId }),
      },
    );
    expect(install.status).toBe(201);
    const advance = await fetch(
      `${baseUrl}/v1/executive/councils/${workId}/advance`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ installationId, workspaceId }),
      },
    );
    expect(advance.status).toBe(200);
    expect(councilCalls).toEqual([
      {
        operation: "get",
        workId,
        requester: { installationId, workspaceId, authUserId },
      },
      {
        operation: "install",
        workId,
        requester: {
          installationId,
          workspaceId,
          authUserId,
          aal: "aal2",
          authTime: expect.any(Number),
        },
      },
      {
        operation: "advance",
        workId,
        requester: { installationId, workspaceId, authUserId },
      },
    ]);
  });

  it("requires recent AAL2 for Council installation, approval, and Work promotion", async () => {
    const { baseUrl, councilCalls } = await runtime({
      authUserId,
      aal: "aal1",
      authTime: Math.floor(Date.now() / 1000),
    });
    const headers = {
      authorization: "Bearer verified-by-fixture",
      "content-type": "application/json",
    };
    const read = await fetch(
      `${baseUrl}/v1/executive/councils/${workId}?installationId=${installationId}&workspaceId=${workspaceId}`,
      { headers },
    );
    expect(read.status).toBe(200);
    const advance = await fetch(
      `${baseUrl}/v1/executive/councils/${workId}/advance`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ installationId, workspaceId }),
      },
    );
    expect(advance.status).toBe(200);
    const sensitivePaths = [
      `/v1/executive/councils/${workId}/install`,
      "/v1/executive/approvals",
      "/v1/executive/work",
    ];
    for (const path of sensitivePaths) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ installationId, workspaceId }),
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "aal2_required" },
      });
    }
    expect(councilCalls.map((call) => call.operation)).toEqual([
      "get",
      "advance",
    ]);
  });

  it("rejects client-supplied council roles, evidence, or peer context", async () => {
    const { baseUrl, councilCalls } = await runtime();
    const response = await fetch(
      `${baseUrl}/v1/executive/councils/${workId}/advance`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer verified-by-fixture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          installationId,
          peerContext: [{ authority: "forged" }],
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(councilCalls).toEqual([]);
  });
});
