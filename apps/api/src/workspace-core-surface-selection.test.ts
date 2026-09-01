import { describe, expect, it } from "vitest";

import {
  hashWorkspaceCoreSurfaceSelectionApprovalCore,
  hashWorkspaceCoreSurfaceSelectionApprovalReceipt,
  hashWorkspaceCoreSurfaceSelectionReceipt,
  hashWorkspaceCoreSurfaceSelectionWorkSnapshot,
  hashWorkspaceCoreSurface,
  workspaceCompiledCoreSurfaceRegistrySha256,
  type WorkspaceCoreSurfaceSelectionApproval,
  type WorkspaceCoreSurfaceSelectionApprovalCreation,
  type WorkspaceCoreSurfaceSelectionApprovalReceipt,
  type WorkspaceCoreSurfaceSelectionApprovalRequest,
  type WorkspaceCoreSurfaceSelectionReceipt,
  type WorkspaceCoreSurfaceSelectionWorkSnapshot,
  type WorkspaceCoreSurface,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import { StepUpAuthenticationError } from "./auth.js";
import {
  DatabaseWorkspaceCoreSurfaceSelectionAuthority,
  WorkspaceCoreSurfaceSelectionConflictError,
  WorkspaceCoreSurfaceSelectionForbiddenError,
  WorkspaceCoreSurfaceSelectionInputError,
  WorkspaceCoreSurfaceSelectionIntegrityError,
  requireWorkspaceCoreSurfaceSelectionRecentAal2,
} from "./workspace-core-surface-selection.js";

const ids = {
  installation: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  owner: "10000000-0000-4000-8000-000000000003",
  work: "10000000-0000-4000-8000-000000000004",
  requester: "10000000-0000-4000-8000-000000000005",
  policy: "10000000-0000-4000-8000-000000000006",
  grant: "10000000-0000-4000-8000-000000000007",
  predecessorReceipt: "10000000-0000-4000-8000-000000000008",
  approval: "10000000-0000-4000-8000-000000000009",
  approvalRecord: "10000000-0000-4000-8000-00000000000a",
  approvalReceipt: "10000000-0000-4000-8000-00000000000b",
  receipt: "10000000-0000-4000-8000-00000000000c",
  authUser: "10000000-0000-4000-8000-00000000000d",
  otherInstallation: "20000000-0000-4000-8000-000000000001",
} as const;

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const approvedAt = "2026-08-31T18:00:00.000Z";
const aal2VerifiedAt = "2026-08-31T17:55:00.000Z";
const expiresAt = "2026-09-01T18:00:00.000Z";
const appliedAt = "2026-08-31T18:05:00.000Z";

const currentSurface: WorkspaceCoreSurface = {
  defaultModuleId: "command",
  modules: [
    {
      id: "command",
      contractVersion: "v1",
      label: "Command Bridge",
      navigationOrder: 10,
      presentationVariant: "standard",
    },
    {
      id: "admin",
      contractVersion: "v1",
      label: "Admin",
      navigationOrder: 20,
      presentationVariant: "standard",
    },
  ],
};

const targetSurface: WorkspaceCoreSurface = {
  defaultModuleId: "command",
  modules: [
    ...currentSurface.modules,
    {
      id: "factory",
      contractVersion: "v1",
      label: "Factory",
      navigationOrder: 30,
      presentationVariant: "read-only",
    },
  ],
};
const targetPreferences = {
  defaultCoreSurfaceId: "command" as const,
  coreSurfaces: targetSurface.modules.map(({ id, navigationOrder }) => ({
    id,
    navigationOrder,
  })),
};

const workSnapshot: WorkspaceCoreSurfaceSelectionWorkSnapshot = {
  id: ids.work,
  vortonInstallationId: ids.installation,
  workspaceId: ids.workspace,
  title: "Select the governed workspace core surface",
  requestedOutcome: "Publish one explicit compiled workspace surface",
  acceptanceCriteria: ["Bind exact preimage and postimage surfaces"],
  state: "ready",
  priority: 90,
  parentWorkId: null,
  requestedByPersonId: ids.requester,
  custodianPersonId: ids.owner,
  custodianWorkerId: null,
  leaseExpiresAt: null,
  createdAt: "2026-08-31T17:30:00.123456Z",
  updatedAt: "2026-08-31T17:45:00.654321Z",
};

const predecessorCoreSurfaceSelectionReceipt = {
  receiptId: ids.predecessorReceipt,
  receiptSha256: digest("8"),
};

async function makeApprovalRequest(
  overrides: Partial<WorkspaceCoreSurfaceSelectionApprovalRequest> = {},
): Promise<WorkspaceCoreSurfaceSelectionApprovalRequest> {
  return {
    approvalId: ids.approval,
    workId: ids.work,
    capabilityGrantId: ids.grant,
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    expectedCurrentSurfaceSha256:
      await hashWorkspaceCoreSurface(currentSurface),
    expectedPredecessorCoreSurfaceSelectionReceipt:
      predecessorCoreSurfaceSelectionReceipt,
    targetPreferences,
    expiresAt,
    ...overrides,
  };
}

interface CreationOptions {
  installationId?: string;
  workspaceId?: string;
  approvalId?: string;
  workId?: string;
  capabilityGrantId?: string;
  currentSurface?: WorkspaceCoreSurface;
  targetSurface?: WorkspaceCoreSurface;
  predecessor?: typeof predecessorCoreSurfaceSelectionReceipt | null;
  expiresAt?: string;
}

async function makeApprovalCreation(
  options: CreationOptions = {},
): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
  const installationId = options.installationId ?? ids.installation;
  const workspaceId = options.workspaceId ?? ids.workspace;
  const approvalId = options.approvalId ?? ids.approval;
  const workId = options.workId ?? ids.work;
  const capabilityGrantId = options.capabilityGrantId ?? ids.grant;
  const current = options.currentSurface ?? currentSurface;
  const target = options.targetSurface ?? targetSurface;
  const predecessor =
    options.predecessor === undefined
      ? predecessorCoreSurfaceSelectionReceipt
      : options.predecessor;
  const binding = {
    vortonInstallationId: installationId,
    workspaceId,
    realm: "organizational" as const,
    workId,
    workSnapshotSha256: await hashWorkspaceCoreSurfaceSelectionWorkSnapshot({
      ...workSnapshot,
      id: workId,
      vortonInstallationId: installationId,
      workspaceId,
    }),
    currentSurface: current,
    currentSurfaceSha256: await hashWorkspaceCoreSurface(current),
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    predecessorCoreSurfaceSelectionReceipt: predecessor,
    targetPreferences: {
      defaultCoreSurfaceId: target.defaultModuleId,
      coreSurfaces: target.modules.map(({ id, navigationOrder }) => ({
        id,
        navigationOrder,
      })),
    },
    targetSurface: target,
    targetSurfaceSha256: await hashWorkspaceCoreSurface(target),
  };
  const authority = {
    principalKind: "person" as const,
    personId: ids.owner,
    workspaceMembershipKind: "owner" as const,
    capability: "workspace.core-surface.select" as const,
    mode: "modify" as const,
    workId,
    policyId: ids.policy,
    policySha256: digest("6"),
    capabilityGrantId,
    workScoped: true as const,
    rolesGrantAuthority: false as const,
  };
  const scope = {
    action: "workspace.core-surface.select" as const,
    compiledCoreSurfaceOnly: true as const,
    defaultModuleProjectionOnly: true as const,
    moduleReleaseAdmission: false as const,
    infrastructureMutation: false as const,
    otherWorkspaceRead: false as const,
    otherWorkspaceMutation: false as const,
    externalSystemMutation: false as const,
  };
  const placeholderApproval: WorkspaceCoreSurfaceSelectionApproval = {
    contract: "vorton.workspace-core-surface-selection-approval.v1",
    approvalId,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    ownerPersonId: ids.owner,
    binding,
    authority,
    approvedAt,
    expiresAt: options.expiresAt ?? expiresAt,
    aal2VerifiedAt,
    assuranceLevel: "aal2",
    ownerMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    currentSurfaceVerifiedAt: approvedAt,
    scope,
    rolesGrantAuthority: false,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: digest("f"),
  };
  const approvalHash =
    await hashWorkspaceCoreSurfaceSelectionApprovalCore(placeholderApproval);
  const placeholderReceipt: WorkspaceCoreSurfaceSelectionApprovalReceipt = {
    contract: "vorton.workspace-core-surface-selection-approval-receipt.v1",
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres",
    approvalId,
    approvalRecordId: ids.approvalRecord,
    approvalHash,
    ownerPersonId: ids.owner,
    binding,
    authority,
    approvedAt,
    expiresAt: options.expiresAt ?? expiresAt,
    createdAt: approvedAt,
    aal2VerifiedAt,
    assuranceLevel: "aal2",
    ownerMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    currentSurfaceVerifiedAt: approvedAt,
    scope,
    rolesGrantAuthority: false,
    effects: {
      approvalCreated: true,
      approvalConsumed: false,
      coreSurfaceProjectionMutated: false,
      defaultCoreSurfaceProjectionMutated: false,
      coreSurfaceSelectionLineageMutated: false,
      moduleReleaseAdmitted: false,
      infrastructureMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
      artifactResolved: false,
      artifactLoaded: false,
      moduleRuntimeStarted: false,
      moduleAdmitted: false,
      moduleMigrated: false,
      privateConsumerAuthorityGranted: false,
    },
    receiptHash: digest("e"),
  };
  const receiptHash =
    await hashWorkspaceCoreSurfaceSelectionApprovalReceipt(placeholderReceipt);
  return {
    approval: { ...placeholderApproval, approvalReceiptSha256: receiptHash },
    approvalReceipt: { ...placeholderReceipt, receiptHash },
  };
}

async function makeReceipt(
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
  receiptId: string = ids.receipt,
): Promise<WorkspaceCoreSurfaceSelectionReceipt> {
  const approvalHash = await hashWorkspaceCoreSurfaceSelectionApprovalCore(
    creation.approval,
  );
  const approvalReceiptSha256 =
    await hashWorkspaceCoreSurfaceSelectionApprovalReceipt(
      creation.approvalReceipt,
    );
  const placeholder: WorkspaceCoreSurfaceSelectionReceipt = {
    contract: "vorton.workspace-core-surface-selection-receipt.v1",
    receiptId,
    receiptPlane: "workspace-postgres",
    approvalId: creation.approval.approvalId,
    approvalRecordId: creation.approval.approvalRecordId,
    approvalReceiptId: creation.approval.approvalReceiptId,
    approvalReceiptSha256,
    approvalHash,
    binding: creation.approval.binding,
    authority: creation.approval.authority,
    scope: creation.approval.scope,
    approvedByPersonId: creation.approval.ownerPersonId,
    appliedByPersonId: creation.approval.ownerPersonId,
    approvalConsumptionCount: 1,
    approvalConsumedAt: appliedAt,
    appliedAt,
    aal2VerifiedAt: approvedAt,
    assuranceLevel: "aal2",
    ownerMembershipVerifiedAt: appliedAt,
    policyVerifiedAt: appliedAt,
    capabilityGrantVerifiedAt: appliedAt,
    workSnapshotVerifiedAt: appliedAt,
    currentSurfaceVerifiedAt: appliedAt,
    predecessorCoreSurfaceSelectionReceipt:
      creation.approval.binding.predecessorCoreSurfaceSelectionReceipt,
    preimageSurface: creation.approval.binding.currentSurface,
    preimageSurfaceSha256: creation.approval.binding.currentSurfaceSha256,
    postimageSurface: creation.approval.binding.targetSurface,
    postimageSurfaceSha256: creation.approval.binding.targetSurfaceSha256,
    rowCounts: {
      preimageCoreSurfaceRows:
        creation.approval.binding.currentSurface.modules.length,
      deletedCoreSurfaceRows:
        creation.approval.binding.currentSurface.modules.length,
      insertedCoreSurfaceRows:
        creation.approval.binding.targetSurface.modules.length,
      postimageCoreSurfaceRows:
        creation.approval.binding.targetSurface.modules.length,
      defaultCoreSurfaceRowsUpdated: 1,
      coreSurfaceSelectionLineageRowsUpdated: 1,
      otherWorkspaceRowsRead: 0,
      otherWorkspaceRowsMutated: 0,
    },
    idempotency: {
      key: receiptId,
      exactReplayReturnsSameReceipt: true,
      conflictingReplayDenied: true,
      additionalProjectionMutationsOnReplay: 0,
    },
    effects: {
      approvalConsumed: true,
      coreSurfaceProjectionReplaced: true,
      defaultCoreSurfaceProjectionReplaced: true,
      coreSurfaceSelectionLineageAdvanced: true,
      moduleReleaseAdmitted: false,
      infrastructureMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
      artifactResolved: false,
      artifactLoaded: false,
      moduleRuntimeStarted: false,
      moduleAdmitted: false,
      moduleMigrated: false,
      privateConsumerAuthorityGranted: false,
    },
    receiptHash: digest("d"),
  };
  return {
    ...placeholder,
    receiptHash: await hashWorkspaceCoreSurfaceSelectionReceipt(placeholder),
  };
}

async function makeApplication(
  options: CreationOptions & { receiptId?: string } = {},
) {
  const creation = await makeApprovalCreation(options);
  return {
    ...creation,
    receipt: await makeReceipt(creation, options.receiptId),
  };
}

const recentIdentity = () => ({
  authUserId: ids.authUser,
  aal: "aal2" as const,
  authTime: Math.floor(Date.now() / 1_000) - 60,
});

function databaseReturning(
  column: "creation" | "application",
  value: unknown,
  captures?: {
    contexts: unknown[];
    queries: Array<{ sql: string; values: readonly unknown[] }>;
  },
): Database {
  return {
    asWorkspacePersonWithStepUp: async (
      context: unknown,
      work: (transaction: {
        query: (sql: string, values: readonly unknown[]) => Promise<unknown>;
      }) => Promise<unknown>,
    ) => {
      captures?.contexts.push(context);
      return work({
        query: async (sql, values) => {
          captures?.queries.push({ sql, values });
          return { rows: [{ [column]: value }], rowCount: 1 };
        },
      });
    },
  } as unknown as Database;
}

function databaseThrowing(error: unknown): Database {
  return {
    asWorkspacePersonWithStepUp: async () => {
      throw error;
    },
  } as unknown as Database;
}

describe("workspace core-surface selection database authority", () => {
  it("creates an approval inside the exact signed workspace-person AAL2 transaction", async () => {
    const creation = await makeApprovalCreation();
    const request = await makeApprovalRequest();
    const captures = {
      contexts: [] as unknown[],
      queries: [] as Array<{ sql: string; values: readonly unknown[] }>,
    };
    const identity = recentIdentity();
    const authority = new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
      databaseReturning("creation", creation, captures),
    );

    await expect(
      authority.approve(ids.installation, ids.workspace, request, identity),
    ).resolves.toEqual(creation);
    expect(captures.contexts).toEqual([
      {
        authUserId: ids.authUser,
        vortonInstallationId: ids.installation,
        workspaceId: ids.workspace,
        aal: "aal2",
        authTime: identity.authTime,
      },
    ]);
    expect(captures.queries[0]?.sql).toMatch(
      /public\.create_workspace_core_surface_selection_approval\(\s*\$1::uuid, \$2::uuid, \$3::uuid, \$4::uuid, \$5::uuid,\s*\$6::text, \$7::text, \$8::jsonb, \$9::jsonb, \$10::timestamptz\s*\)/,
    );
    expect(captures.queries[0]?.values).toEqual([
      request.approvalId,
      ids.installation,
      ids.workspace,
      request.workId,
      request.capabilityGrantId,
      request.compiledRegistrySha256,
      request.expectedCurrentSurfaceSha256,
      request.expectedPredecessorCoreSurfaceSelectionReceipt,
      request.targetPreferences,
      request.expiresAt,
    ]);
  });

  it("passes a null predecessor through the PostgreSQL boundary for an empty genesis surface", async () => {
    const emptySurface: WorkspaceCoreSurface = {
      defaultModuleId: null,
      modules: [],
    };
    const creation = await makeApprovalCreation({
      currentSurface: emptySurface,
      predecessor: null,
    });
    const request = await makeApprovalRequest({
      expectedCurrentSurfaceSha256:
        await hashWorkspaceCoreSurface(emptySurface),
      expectedPredecessorCoreSurfaceSelectionReceipt: null,
    });
    const captures = {
      contexts: [] as unknown[],
      queries: [] as Array<{ sql: string; values: readonly unknown[] }>,
    };
    const authority = new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
      databaseReturning("creation", creation, captures),
    );

    await expect(
      authority.approve(
        ids.installation,
        ids.workspace,
        request,
        recentIdentity(),
      ),
    ).resolves.toEqual(creation);
    expect(captures.queries[0]?.values[7]).toBeNull();
  });

  it("applies the exact approval inside a fresh signed workspace-person AAL2 transaction", async () => {
    const application = await makeApplication();
    const captures = {
      contexts: [] as unknown[],
      queries: [] as Array<{ sql: string; values: readonly unknown[] }>,
    };
    const identity = recentIdentity();
    const authority = new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
      databaseReturning("application", application, captures),
    );

    await expect(
      authority.apply(
        ids.installation,
        ids.workspace,
        ids.approval,
        { receiptId: ids.receipt },
        identity,
      ),
    ).resolves.toEqual(application);
    expect(captures.queries[0]?.sql).toMatch(
      /public\.apply_workspace_core_surface_selection\(\s*\$1::uuid, \$2::uuid, \$3::uuid, \$4::uuid\s*\)/,
    );
    expect(captures.queries[0]?.values).toEqual([
      ids.receipt,
      ids.approval,
      ids.installation,
      ids.workspace,
    ]);
  });

  it("rejects stale and future AAL2 before opening a database transaction", () => {
    const now = 1_800_000_000;
    expect(() =>
      requireWorkspaceCoreSurfaceSelectionRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: now - 601 },
        now,
      ),
    ).toThrow(StepUpAuthenticationError);
    expect(() =>
      requireWorkspaceCoreSurfaceSelectionRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: now + 1 },
        now,
      ),
    ).toThrow(StepUpAuthenticationError);
  });

  it("rejects malformed requests and substituted approval or receipt projections", async () => {
    const creation = await makeApprovalCreation({
      installationId: ids.otherInstallation,
    });
    const authority = new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
      databaseReturning("creation", creation),
    );
    await expect(
      authority.approve(
        ids.installation,
        ids.workspace,
        await makeApprovalRequest(),
        recentIdentity(),
      ),
    ).rejects.toBeInstanceOf(WorkspaceCoreSurfaceSelectionIntegrityError);

    await expect(
      authority.approve(
        ids.installation,
        ids.workspace,
        { ...(await makeApprovalRequest()), unexpected: true } as never,
        recentIdentity(),
      ),
    ).rejects.toBeInstanceOf(WorkspaceCoreSurfaceSelectionInputError);

    const substitutedTarget = {
      defaultModuleId: "command" as const,
      modules: targetSurface.modules.filter((module) => module.id !== "admin"),
    };
    const targetSubstitution = await makeApprovalCreation({
      targetSurface: substitutedTarget,
    });
    await expect(
      new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
        databaseReturning("creation", targetSubstitution),
      ).approve(
        ids.installation,
        ids.workspace,
        await makeApprovalRequest(),
        recentIdentity(),
      ),
    ).rejects.toBeInstanceOf(WorkspaceCoreSurfaceSelectionIntegrityError);

    const substitutedReceiptId = "30000000-0000-4000-8000-000000000001";
    const application = await makeApplication({
      receiptId: substitutedReceiptId,
    });
    await expect(
      new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
        databaseReturning("application", application),
      ).apply(
        ids.installation,
        ids.workspace,
        ids.approval,
        { receiptId: ids.receipt },
        recentIdentity(),
      ),
    ).rejects.toBeInstanceOf(WorkspaceCoreSurfaceSelectionIntegrityError);

    await expect(
      new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
        databaseReturning("application", {
          ...(await makeApplication()),
          unexpected: true,
        }),
      ).apply(
        ids.installation,
        ids.workspace,
        ids.approval,
        { receiptId: ids.receipt },
        recentIdentity(),
      ),
    ).rejects.toBeInstanceOf(WorkspaceCoreSurfaceSelectionIntegrityError);
  });

  it("classifies known database failures without exposing SQL details", async () => {
    const cases = [
      [
        "Exact workspace core-surface selection approval request is invalid",
        WorkspaceCoreSurfaceSelectionInputError,
      ],
      [
        "Workspace core-surface selection request reuses an authority identity or hash",
        WorkspaceCoreSurfaceSelectionInputError,
      ],
      [
        "Signed recent workspace-person AAL2 is required",
        WorkspaceCoreSurfaceSelectionForbiddenError,
      ],
      [
        "Exact Work-scoped capability grant does not exist",
        WorkspaceCoreSurfaceSelectionForbiddenError,
      ],
      [
        "Current workspace module surface changed after approval",
        WorkspaceCoreSurfaceSelectionConflictError,
      ],
      [
        "Expected predecessor core-surface selection receipt is invalid",
        WorkspaceCoreSurfaceSelectionConflictError,
      ],
      [
        "Approved workspace core-surface selection predecessor is no longer terminal",
        WorkspaceCoreSurfaceSelectionConflictError,
      ],
      [
        "sensitive unknown PostgreSQL module authority failure",
        WorkspaceCoreSurfaceSelectionIntegrityError,
      ],
    ] as const;
    const request = await makeApprovalRequest();
    for (const [message, expected] of cases) {
      const error = Object.assign(new Error(message), { code: "P0001" });
      const authority = new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
        databaseThrowing(error),
      );
      const result = authority.approve(
        ids.installation,
        ids.workspace,
        request,
        recentIdentity(),
      );
      await expect(result).rejects.toBeInstanceOf(expected);
      await expect(result).rejects.not.toThrow(message);
    }
  });

  it("does not disguise non-authority database failures", async () => {
    const failure = Object.assign(new Error("connection unavailable"), {
      code: "08006",
    });
    const authority = new DatabaseWorkspaceCoreSurfaceSelectionAuthority(
      databaseThrowing(failure),
    );
    await expect(
      authority.approve(
        ids.installation,
        ids.workspace,
        await makeApprovalRequest(),
        recentIdentity(),
      ),
    ).rejects.toBe(failure);
  });
});
