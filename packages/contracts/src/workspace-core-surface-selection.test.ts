import { describe, expect, it } from "vitest";

import {
  canonicalWorkspaceCoreSurfaceSelectionJson,
  hashWorkspaceCoreSurfaceSelectionApprovalCore,
  hashWorkspaceCoreSurfaceSelectionApprovalReceipt,
  hashWorkspaceCoreSurfaceSelectionReceipt,
  hashWorkspaceCoreSurfaceSelectionWorkSnapshot,
  hashWorkspaceCoreSurface,
  parseWorkspaceCoreSurfaceSelectionApprovalCreation,
  parseWorkspaceCoreSurfaceSelectionReceipt,
  projectWorkspaceCoreSurfaceSelectionApprovalCore,
  projectWorkspaceCoreSurfaceSelectionApprovalReceiptCore,
  projectWorkspaceCoreSurfaceSelectionReceiptCore,
  workspaceCoreSurfaceSelectionApplyRequestSchema,
  workspaceCoreSurfaceSelectionApprovalCoreSchema,
  workspaceCoreSurfaceSelectionApprovalDocumentSchema,
  workspaceCoreSurfaceSelectionApprovalReceiptSchema,
  workspaceCoreSurfaceSelectionApprovalRequestSchema,
  workspaceCoreSurfaceSelectionReceiptSchema,
  workspaceCoreSurfaceSchema,
  workspaceCompiledCoreSurfaceRegistrySha256,
  workspaceCompiledCoreSurfaceRegistry,
  workspaceCoreSurfaceSelectionCanonicalSha256,
  type WorkspaceCoreSurfaceSelectionApproval,
  type WorkspaceCoreSurfaceSelectionApprovalCreation,
  type WorkspaceCoreSurfaceSelectionApprovalReceipt,
  type WorkspaceCoreSurfaceSelectionReceipt,
  type WorkspaceCoreSurfaceSelectionWorkSnapshot,
  type WorkspaceCoreSurface,
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
  title: "Select the governed FreedOS core surface",
  requestedOutcome: "Publish one explicit compiled workspace surface",
  acceptanceCriteria: [
    "Bind the exact current and target surfaces",
    "Admit no module release or infrastructure change",
  ],
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

async function makeApprovalCreation(
  overrides: {
    currentSurface?: WorkspaceCoreSurface;
    targetSurface?: WorkspaceCoreSurface;
    predecessorCoreSurfaceSelectionReceipt?: {
      receiptId: string;
      receiptSha256: string;
    } | null;
    ownerPersonId?: string;
    aal2VerifiedAt?: string;
    expiresAt?: string;
  } = {},
): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
  const current = overrides.currentSurface ?? currentSurface;
  const target = overrides.targetSurface ?? targetSurface;
  const ownerPersonId = overrides.ownerPersonId ?? ids.owner;
  const binding = {
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    realm: "organizational" as const,
    workId: ids.work,
    workSnapshotSha256:
      await hashWorkspaceCoreSurfaceSelectionWorkSnapshot(workSnapshot),
    currentSurface: current,
    currentSurfaceSha256: await hashWorkspaceCoreSurface(current),
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    predecessorCoreSurfaceSelectionReceipt:
      overrides.predecessorCoreSurfaceSelectionReceipt === undefined
        ? {
            receiptId: ids.predecessorReceipt,
            receiptSha256: digest("8"),
          }
        : overrides.predecessorCoreSurfaceSelectionReceipt,
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
    personId: ownerPersonId,
    workspaceMembershipKind: "owner" as const,
    capability: "workspace.core-surface.select" as const,
    mode: "modify" as const,
    workId: ids.work,
    policyId: ids.policy,
    policySha256: digest("6"),
    capabilityGrantId: ids.grant,
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
    approvalId: ids.approval,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    ownerPersonId,
    binding,
    authority,
    approvedAt,
    expiresAt: overrides.expiresAt ?? expiresAt,
    aal2VerifiedAt: overrides.aal2VerifiedAt ?? aal2VerifiedAt,
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
    approvalId: ids.approval,
    approvalRecordId: ids.approvalRecord,
    approvalHash,
    ownerPersonId,
    binding,
    authority,
    approvedAt,
    expiresAt: overrides.expiresAt ?? expiresAt,
    createdAt: approvedAt,
    aal2VerifiedAt: overrides.aal2VerifiedAt ?? aal2VerifiedAt,
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
    approval: {
      ...placeholderApproval,
      approvalReceiptSha256: receiptHash,
    },
    approvalReceipt: { ...placeholderReceipt, receiptHash },
  };
}

async function makeReceipt(
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
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
    receiptId: ids.receipt,
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
    aal2VerifiedAt: "2026-08-31T18:00:00.000Z",
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
      key: ids.receipt,
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

describe("workspace core-surface selection contracts", () => {
  it("accepts only canonical supported compiled core surfaces", async () => {
    expect(workspaceCoreSurfaceSchema.parse(currentSurface)).toEqual(
      currentSurface,
    );
    expect(
      workspaceCoreSurfaceSchema.parse({
        defaultModuleId: null,
        modules: [],
      }),
    ).toEqual({ defaultModuleId: null, modules: [] });
    expect(
      await hashWorkspaceCoreSurface({
        modules: currentSurface.modules,
        defaultModuleId: "command",
      }),
    ).toBe(await hashWorkspaceCoreSurface(currentSurface));
    expect(canonicalWorkspaceCoreSurfaceSelectionJson({ b: 2, a: 1 })).toBe(
      '{"a":1,"b":2}',
    );

    const invalidSurfaces = [
      {
        ...targetSurface,
        modules: targetSurface.modules.map((module) =>
          module.id === "factory"
            ? { ...module, presentationVariant: "standard" }
            : module,
        ),
      },
      {
        ...targetSurface,
        modules: targetSurface.modules.map((module) =>
          module.id === "factory"
            ? { ...module, presentationVariant: "freed-read-only" }
            : module,
        ),
      },
      {
        ...currentSurface,
        modules: [
          ...currentSurface.modules,
          {
            id: "installation-owned-custom-module",
            contractVersion: "v1",
            label: "Custom",
            navigationOrder: 30,
            presentationVariant: "standard",
          },
        ],
      },
      {
        ...currentSurface,
        modules: [...currentSurface.modules].reverse(),
      },
      {
        ...currentSurface,
        modules: [
          currentSurface.modules[0],
          { ...currentSurface.modules[1], navigationOrder: 10 },
        ],
      },
      {
        ...currentSurface,
        modules: [
          currentSurface.modules[0],
          { ...currentSurface.modules[0], navigationOrder: 20 },
        ],
      },
      { ...currentSurface, defaultModuleId: null },
      { ...currentSurface, defaultModuleId: "tasks" },
      { defaultModuleId: "command", modules: [] },
      {
        ...currentSurface,
        modules: currentSurface.modules.map((module) => ({
          ...module,
          contractVersion: "v2",
        })),
      },
      {
        ...currentSurface,
        modules: currentSurface.modules.map((module) => ({
          ...module,
          label: `\u00a0${module.label}`,
        })),
      },
    ];
    for (const invalid of invalidSurfaces) {
      expect(workspaceCoreSurfaceSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("publishes only transitional compiled core-surface authority", async () => {
    const creation = await makeApprovalCreation();
    expect(creation.approval.scope).toEqual({
      action: "workspace.core-surface.select",
      compiledCoreSurfaceOnly: true,
      defaultModuleProjectionOnly: true,
      moduleReleaseAdmission: false,
      infrastructureMutation: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      externalSystemMutation: false,
    });
    expect(creation.approval.scope).not.toHaveProperty(
      "compiledModuleProjectionOnly",
    );
  });

  it("binds an exact ready person-custodied Work snapshot", async () => {
    const hash =
      await hashWorkspaceCoreSurfaceSelectionWorkSnapshot(workSnapshot);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    for (const substitution of [
      { state: "review" },
      { custodianPersonId: null },
      { custodianWorkerId: ids.owner },
      { leaseExpiresAt: approvedAt },
      { createdAt: "2026-08-31T17:30:00.123Z" },
      { updatedAt: "2026-08-31T16:45:00.654321Z" },
      { title: " Governed selection" },
      { requestedOutcome: "Governed selection\u00a0" },
      { acceptanceCriteria: [" Exact surface"] },
    ]) {
      await expect(
        hashWorkspaceCoreSurfaceSelectionWorkSnapshot({
          ...workSnapshot,
          ...substitution,
        }),
      ).rejects.toThrow();
    }
  });

  it("keeps approval and apply requests strict and authority-light", () => {
    const approvalRequest = {
      approvalId: ids.approval,
      workId: ids.work,
      capabilityGrantId: ids.grant,
      compiledRegistrySha256:
        workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
      expectedCurrentSurfaceSha256: digest("1"),
      expectedPredecessorCoreSurfaceSelectionReceipt: {
        receiptId: ids.predecessorReceipt,
        receiptSha256: digest("8"),
      },
      targetPreferences,
      expiresAt,
    };
    expect(
      workspaceCoreSurfaceSelectionApprovalRequestSchema.parse(approvalRequest),
    ).toEqual(approvalRequest);
    for (const extra of [
      { ownerPersonId: ids.owner },
      { workspaceId: ids.workspace },
      { realm: "organizational" },
      { policyId: ids.policy },
      { approvalReceiptId: ids.approvalReceipt },
    ]) {
      expect(
        workspaceCoreSurfaceSelectionApprovalRequestSchema.safeParse({
          ...approvalRequest,
          ...extra,
        }).success,
      ).toBe(false);
    }
    for (const hostile of [
      { compiledRegistrySha256: digest("9") },
      {
        targetPreferences: {
          ...targetPreferences,
          label: "Caller-controlled slop",
        },
      },
      {
        targetPreferences: {
          ...targetPreferences,
          presentationVariant: "standard",
        },
      },
      {
        targetPreferences: {
          defaultCoreSurfaceId: "command",
          coreSurfaces: [
            { id: "installation-owned-module", navigationOrder: 10 },
          ],
        },
      },
    ]) {
      expect(
        workspaceCoreSurfaceSelectionApprovalRequestSchema.safeParse({
          ...approvalRequest,
          ...hostile,
        }).success,
      ).toBe(false);
    }
    for (const collision of [
      { approvalId: ids.work },
      { approvalId: ids.grant },
      {
        expectedPredecessorCoreSurfaceSelectionReceipt: {
          receiptId: ids.approval,
          receiptSha256: digest("8"),
        },
      },
      {
        expectedPredecessorCoreSurfaceSelectionReceipt: {
          receiptId: ids.predecessorReceipt,
          receiptSha256: digest("1"),
        },
      },
    ]) {
      expect(
        workspaceCoreSurfaceSelectionApprovalRequestSchema.safeParse({
          ...approvalRequest,
          ...collision,
        }).success,
      ).toBe(false);
    }
    expect(
      workspaceCoreSurfaceSelectionApplyRequestSchema.parse({
        receiptId: ids.receipt,
      }),
    ).toEqual({ receiptId: ids.receipt });
    expect(
      workspaceCoreSurfaceSelectionApplyRequestSchema.safeParse({
        receiptId: ids.receipt,
        approvalId: ids.approval,
      }).success,
    ).toBe(false);
  });

  it("pins the exact transitional compiled registry digest", async () => {
    await expect(
      workspaceCoreSurfaceSelectionCanonicalSha256(
        workspaceCompiledCoreSurfaceRegistry,
      ),
    ).resolves.toBe(workspaceCompiledCoreSurfaceRegistrySha256);
  });

  it("allows null lineage only for an explicit empty genesis surface", async () => {
    const empty: WorkspaceCoreSurface = {
      defaultModuleId: null,
      modules: [],
    };
    await expect(
      makeApprovalCreation({
        currentSurface: empty,
        predecessorCoreSurfaceSelectionReceipt: null,
      }),
    ).resolves.toBeDefined();
    await expect(
      makeApprovalCreation({ predecessorCoreSurfaceSelectionReceipt: null }),
    ).rejects.toThrow(/predecessor/i);
    await expect(
      makeApprovalCreation({
        currentSurface: empty,
        predecessorCoreSurfaceSelectionReceipt: {
          receiptId: ids.predecessorReceipt,
          receiptSha256: digest("8"),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("verifies noncircular approval and no-effect receipt hashes", async () => {
    const creation = await makeApprovalCreation();
    await expect(
      parseWorkspaceCoreSurfaceSelectionApprovalCreation(creation),
    ).resolves.toEqual(creation);
    expect(
      projectWorkspaceCoreSurfaceSelectionApprovalCore(creation.approval),
    ).not.toHaveProperty("approvalReceiptId");
    expect(
      projectWorkspaceCoreSurfaceSelectionApprovalReceiptCore(
        creation.approvalReceipt,
      ),
    ).not.toHaveProperty("receiptHash");

    await expect(
      parseWorkspaceCoreSurfaceSelectionApprovalCreation({
        ...creation,
        approval: {
          ...creation.approval,
          approvalReceiptSha256: digest("a"),
        },
      }),
    ).rejects.toThrow();
    await expect(
      parseWorkspaceCoreSurfaceSelectionApprovalCreation({
        ...creation,
        approvalReceipt: {
          ...creation.approvalReceipt,
          approvalHash: digest("b"),
        },
      }),
    ).rejects.toThrow();
    await expect(
      parseWorkspaceCoreSurfaceSelectionApprovalCreation({
        ...creation,
        approval: {
          ...creation.approval,
          binding: {
            ...creation.approval.binding,
            targetSurfaceSha256: digest("c"),
          },
        },
        approvalReceipt: {
          ...creation.approvalReceipt,
          binding: {
            ...creation.approvalReceipt.binding,
            targetSurfaceSha256: digest("c"),
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects future or stale AAL2, excessive expiry, and identity collisions", async () => {
    await expect(
      makeApprovalCreation({
        aal2VerifiedAt: "2026-08-31T18:00:00.001Z",
      }),
    ).rejects.toThrow();
    await expect(
      makeApprovalCreation({
        aal2VerifiedAt: "2026-08-31T17:49:59.999Z",
      }),
    ).rejects.toThrow();
    await expect(
      makeApprovalCreation({
        expiresAt: "2026-09-01T18:00:00.001Z",
      }),
    ).rejects.toThrow();

    const creation = await makeApprovalCreation();
    const core = projectWorkspaceCoreSurfaceSelectionApprovalCore(
      creation.approval,
    );
    for (const { schema, artifact } of [
      {
        schema: workspaceCoreSurfaceSelectionApprovalCoreSchema,
        artifact: core,
      },
      {
        schema: workspaceCoreSurfaceSelectionApprovalDocumentSchema,
        artifact: creation.approval,
      },
      {
        schema: workspaceCoreSurfaceSelectionApprovalReceiptSchema,
        artifact: creation.approvalReceipt,
      },
    ]) {
      for (const predecessorCoreSurfaceSelectionReceipt of [
        {
          receiptId: ids.work,
          receiptSha256:
            artifact.binding.predecessorCoreSurfaceSelectionReceipt!
              .receiptSha256,
        },
        {
          receiptId:
            artifact.binding.predecessorCoreSurfaceSelectionReceipt!.receiptId,
          receiptSha256: artifact.binding.workSnapshotSha256,
        },
      ]) {
        expect(
          schema.safeParse({
            ...artifact,
            binding: {
              ...artifact.binding,
              predecessorCoreSurfaceSelectionReceipt,
            },
          }).success,
        ).toBe(false);
      }
    }
    expect(
      workspaceCoreSurfaceSelectionReceiptSchema.safeParse({
        ...(await makeReceipt(creation)),
        receiptId: ids.approvalReceipt,
      }).success,
    ).toBe(false);
    await expect(
      parseWorkspaceCoreSurfaceSelectionApprovalCreation({
        ...creation,
        approval: {
          ...creation.approval,
          approvalReceiptId: ids.policy,
        },
      }),
    ).rejects.toThrow();
  });

  it("accepts one distinct receipt identity and verifies its exact lineage", async () => {
    const creation = await makeApprovalCreation();
    const receipt = await makeReceipt(creation);
    await expect(
      parseWorkspaceCoreSurfaceSelectionReceipt(receipt, creation),
    ).resolves.toEqual(receipt);
    expect(
      projectWorkspaceCoreSurfaceSelectionReceiptCore(receipt),
    ).not.toHaveProperty("receiptHash");
    expect(receipt.rowCounts).toEqual({
      preimageCoreSurfaceRows: 2,
      deletedCoreSurfaceRows: 2,
      insertedCoreSurfaceRows: 3,
      postimageCoreSurfaceRows: 3,
      defaultCoreSurfaceRowsUpdated: 1,
      coreSurfaceSelectionLineageRowsUpdated: 1,
      otherWorkspaceRowsRead: 0,
      otherWorkspaceRowsMutated: 0,
    });
    expect(receipt.predecessorCoreSurfaceSelectionReceipt).toEqual(
      creation.approval.binding.predecessorCoreSurfaceSelectionReceipt,
    );
    expect(receipt.idempotency).toEqual({
      key: receipt.receiptId,
      exactReplayReturnsSameReceipt: true,
      conflictingReplayDenied: true,
      additionalProjectionMutationsOnReplay: 0,
    });
    for (const collision of [
      receipt.approvalId,
      receipt.approvalRecordId,
      receipt.approvalReceiptId,
      receipt.binding.workId,
      receipt.authority.policyId,
      receipt.authority.capabilityGrantId,
      receipt.predecessorCoreSurfaceSelectionReceipt!.receiptId,
    ]) {
      expect(
        workspaceCoreSurfaceSelectionReceiptSchema.safeParse({
          ...receipt,
          receiptId: collision,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects receipt substitutions, bad counts, stale authority, and drift", async () => {
    const creation = await makeApprovalCreation();
    const receipt = await makeReceipt(creation);
    const mutations: WorkspaceCoreSurfaceSelectionReceipt[] = [
      {
        ...receipt,
        appliedByPersonId: ids.requester,
      },
      {
        ...receipt,
        aal2VerifiedAt: "2026-08-31T17:54:59.999Z",
      },
      {
        ...receipt,
        predecessorCoreSurfaceSelectionReceipt: null,
      },
      {
        ...receipt,
        rowCounts: { ...receipt.rowCounts, insertedCoreSurfaceRows: 2 },
      },
      {
        ...receipt,
        idempotency: { ...receipt.idempotency, key: ids.approval },
      },
      {
        ...receipt,
        postimageSurfaceSha256: digest("c"),
      },
      {
        ...receipt,
        effects: { ...receipt.effects, moduleReleaseAdmitted: true } as never,
      },
    ];
    for (const mutation of mutations) {
      await expect(
        parseWorkspaceCoreSurfaceSelectionReceipt(mutation, creation),
      ).rejects.toThrow();
    }
    await expect(
      parseWorkspaceCoreSurfaceSelectionReceipt(
        { ...receipt, approvalConsumedAt: expiresAt, appliedAt: expiresAt },
        creation,
      ),
    ).rejects.toThrow();
  });
});
