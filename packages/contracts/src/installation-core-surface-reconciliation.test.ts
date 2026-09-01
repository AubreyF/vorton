import { describe, expect, it } from "vitest";

import {
  bindingFromPlan,
  canonicalInstallationCoreSurfaceReconciliationJson,
  deriveInstallationCoreSurfacePostimageInventory,
  hashInstallationCoreSurfaceInventory,
  hashInstallationCoreSurfaceReconciliationApprovalCore,
  hashInstallationCoreSurfaceReconciliationApprovalReceipt,
  hashInstallationCoreSurfaceReconciliationPlan,
  hashInstallationCoreSurfaceReconciliationReceipt,
  hashInstallationCoreSurfaceReconciliationVerification,
  hashInstallationCoreSurfaceTransitionSet,
  hashWorkspaceCoreSurfaceReconciliationReceipt,
  installationCoreSurfaceReconciliationApprovalCreationSchema,
  installationCoreSurfaceReconciliationApprovalRequestSchema,
  installationCoreSurfaceReconciliationApprovalSchema,
  installationCoreSurfaceReconciliationApplyRequestSchema,
  installationCoreSurfaceReconciliationPlanRequestSchema,
  installationCoreSurfaceReconciliationPlanSchema,
  installationCoreSurfaceReconciliationReceiptSchema,
  installationCoreSurfaceReconciliationVerificationSchema,
  parseInstallationCoreSurfaceReconciliationApplication,
  parseInstallationCoreSurfaceReconciliationApprovalCreation,
  parseInstallationCoreSurfaceReconciliationPlan,
  parseInstallationCoreSurfaceReconciliationVerification,
  projectInstallationCoreSurfaceReconciliationApprovalCore,
  projectInstallationCoreSurfaceReconciliationApprovalReceiptCore,
  projectInstallationCoreSurfaceReconciliationPlanCore,
  projectInstallationCoreSurfaceReconciliationReceiptCore,
  projectInstallationCoreSurfaceReconciliationVerificationCore,
  workspaceCoreSurfaceReconciliationReceiptSchema,
  type InstallationCoreSurfaceInventory,
  type InstallationCoreSurfaceReconciliationApplication,
  type InstallationCoreSurfaceReconciliationApproval,
  type InstallationCoreSurfaceReconciliationApprovalCreation,
  type InstallationCoreSurfaceReconciliationApprovalReceipt,
  type InstallationCoreSurfaceReconciliationPlan,
  type InstallationCoreSurfaceReconciliationReceipt,
  type InstallationCoreSurfaceReconciliationVerification,
  type WorkspaceCoreSurfaceReconciliationReceipt,
} from "./installation-core-surface-reconciliation.js";
import {
  hashWorkspaceCoreSurface,
  workspaceCompiledCoreSurfaceRegistrySha256,
  type WorkspaceCoreSurface,
} from "./workspace-core-surface-selection.js";

const ids = {
  installation: "20000000-0000-4000-8000-000000000001",
  owner: "20000000-0000-4000-8000-000000000002",
  workspaceA: "20000000-0000-4000-8000-000000000003",
  workspaceB: "20000000-0000-4000-8000-000000000004",
  releaseReceipt: "20000000-0000-4000-8000-000000000005",
  predecessor: "20000000-0000-4000-8000-000000000006",
  existingSelection: "20000000-0000-4000-8000-000000000007",
  workspaceReceipt: "20000000-0000-4000-8000-000000000008",
  approval: "20000000-0000-4000-8000-000000000009",
  approvalReceipt: "20000000-0000-4000-8000-00000000000b",
  applicationReceipt: "20000000-0000-4000-8000-00000000000c",
} as const;

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const approvedAt = "2026-08-31T20:00:00.000Z";
const expiresAt = "2026-09-01T20:00:00.000Z";
const appliedAt = "2026-08-31T20:05:00.000Z";

const targetSurface: WorkspaceCoreSurface = {
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
      id: "factory",
      contractVersion: "v1",
      label: "Factory",
      navigationOrder: 20,
      presentationVariant: "read-only",
    },
    {
      id: "admin",
      contractVersion: "v1",
      label: "Admin",
      navigationOrder: 30,
      presentationVariant: "standard",
    },
  ],
};

const limits = {
  compiledCoreSurfaceCompatibilityOnly: true as const,
  workspaceProjectionMetadataRead: true as const,
  workspaceProjectionMutated: true as const,
  workspaceLineageMutated: true as const,
  installationLineageMutated: true as const,
  releaseInstalled: false as const,
  releaseAdopted: false as const,
  workspaceCreated: false as const,
  workspaceAuthorityBorrowed: false as const,
  workspaceBusinessDataRead: false as const,
  workspaceBusinessDataMutated: false as const,
  personalDataRead: false as const,
  artifactResolved: false as const,
  artifactLoaded: false as const,
  moduleRuntimeStarted: false as const,
  moduleAdmitted: false as const,
  moduleMigrated: false as const,
  infrastructureMutated: false as const,
  externalSystemMutated: false as const,
  privateConsumerAuthorityGranted: false as const,
};

const targetRelease = {
  adoptionReceiptId: ids.releaseReceipt,
  adoptionReceiptSha256: digest("1"),
  receiptPlane: "installation-postgres" as const,
  manifestSha256: digest("2"),
  sourceCommit: "3".repeat(40),
  migrationHead: "20260831000100_fixture_release",
  workspaceIsolationProofSha256: digest("4"),
  workspaceIsolationProofHash: digest("5"),
  status: "adopted" as const,
  adoptedAt: "2026-08-31T19:00:00.000Z",
};

async function makePlan(): Promise<InstallationCoreSurfaceReconciliationPlan> {
  const inventoryCore = {
    workspaceCount: 2,
    unconfiguredWorkspaceCount: 0,
    selectedWorkspaceCount: 1,
    legacyWorkspaceCount: 1,
    entries: [
      {
        workspaceId: ids.workspaceA,
        realm: "organizational" as const,
        state: "legacy-unreceipted" as const,
        moduleCount: 3,
        surfaceSha256: digest("6"),
        lineage: null,
      },
      {
        workspaceId: ids.workspaceB,
        realm: "personal" as const,
        state: "selected" as const,
        moduleCount: 1,
        surfaceSha256: digest("7"),
        lineage: {
          contract:
            "vorton.workspace-core-surface-selection-receipt.v1" as const,
          receiptId: ids.existingSelection,
          receiptSha256: digest("8"),
        },
      },
    ],
  };
  const inventory: InstallationCoreSurfaceInventory = {
    ...inventoryCore,
    inventorySha256: await hashInstallationCoreSurfaceInventory({
      ...inventoryCore,
      inventorySha256: digest("f"),
    }),
  };
  const transitions = [
    {
      workspaceId: ids.workspaceA,
      realm: "organizational" as const,
      preimageModuleCount: 3,
      preimageSurfaceSha256: digest("6"),
      targetSurface,
      targetSurfaceSha256: await hashWorkspaceCoreSurface(targetSurface),
    },
  ];
  const placeholder: InstallationCoreSurfaceReconciliationPlan = {
    contract: "vorton.installation-core-surface-reconciliation-plan.v1",
    operation: "reconcile-legacy-compiled-core-surfaces",
    vortonInstallationId: ids.installation,
    targetRelease,
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    legacyProjectionContractSha256: digest("9"),
    predecessorReconciliationReceipt: {
      receiptId: ids.predecessor,
      receiptSha256: digest("a"),
    },
    inventory,
    transitions,
    transitionSetSha256:
      await hashInstallationCoreSurfaceTransitionSet(transitions),
    limits,
    planHash: digest("b"),
  };
  return {
    ...placeholder,
    planHash: await hashInstallationCoreSurfaceReconciliationPlan(placeholder),
  };
}

async function makeApprovalCreation(
  plan: InstallationCoreSurfaceReconciliationPlan,
): Promise<InstallationCoreSurfaceReconciliationApprovalCreation> {
  const authority = {
    principalKind: "person" as const,
    personId: ids.owner,
    installationPersonKind: "owner" as const,
    signedInstallationPersonContext: true as const,
    liveInstallationOwnerChecked: true as const,
    workspaceAuthorityBorrowed: false as const,
    rolesGrantAuthority: false as const,
  };
  const placeholderApproval: InstallationCoreSurfaceReconciliationApproval = {
    contract: "vorton.installation-core-surface-reconciliation-approval.v1",
    approvalId: ids.approval,
    approvalPlane: "installation-postgres",
    ownerPersonId: ids.owner,
    binding: bindingFromPlan(plan),
    authority,
    approvedAt,
    expiresAt,
    aal2VerifiedAt: "2026-08-31T19:55:00.000Z",
    assuranceLevel: "aal2",
    installationOwnerVerifiedAt: approvedAt,
    scope: limits,
    rolesGrantAuthority: false,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: digest("c"),
  };
  const approvalHash =
    await hashInstallationCoreSurfaceReconciliationApprovalCore(
      placeholderApproval,
    );
  const placeholderReceipt: InstallationCoreSurfaceReconciliationApprovalReceipt =
    {
      contract:
        "vorton.installation-core-surface-reconciliation-approval-receipt.v1",
      receiptId: ids.approvalReceipt,
      receiptPlane: "installation-postgres",
      approvalId: ids.approval,
      approvalHash,
      ownerPersonId: ids.owner,
      binding: bindingFromPlan(plan),
      authority,
      approvedAt,
      expiresAt,
      createdAt: approvedAt,
      aal2VerifiedAt: "2026-08-31T19:55:00.000Z",
      assuranceLevel: "aal2",
      installationOwnerVerifiedAt: approvedAt,
      scope: limits,
      rolesGrantAuthority: false,
      effects: {
        approvalCreated: true,
        approvalConsumed: false,
        installationReconciliationApplied: false,
        workspaceProjectionMutated: false,
        workspaceLineageMutated: false,
        installationLineageMutated: false,
        releaseInstalled: false,
        releaseAdopted: false,
        workspaceAuthorityBorrowed: false,
        workspaceBusinessDataRead: false,
        workspaceBusinessDataMutated: false,
        externalSystemMutated: false,
      },
      receiptHash: digest("d"),
    };
  const receiptHash =
    await hashInstallationCoreSurfaceReconciliationApprovalReceipt(
      placeholderReceipt,
    );
  return {
    approval: {
      ...placeholderApproval,
      approvalReceiptSha256: receiptHash,
    },
    approvalReceipt: { ...placeholderReceipt, receiptHash },
  };
}

async function makeApplication(
  plan: InstallationCoreSurfaceReconciliationPlan,
  creation: InstallationCoreSurfaceReconciliationApprovalCreation,
): Promise<InstallationCoreSurfaceReconciliationApplication> {
  const transition = plan.transitions[0]!;
  const placeholderChild: WorkspaceCoreSurfaceReconciliationReceipt = {
    contract: "vorton.workspace-core-surface-reconciliation-receipt.v1",
    receiptId: ids.workspaceReceipt,
    receiptPlane: "installation-postgres",
    installationReceiptId: ids.applicationReceipt,
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: creation.approvalReceipt.receiptHash,
    planHash: plan.planHash,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspaceA,
    realm: "organizational",
    predecessorCoreSurfaceLineageReceipt: null,
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    legacyProjectionContractSha256: plan.legacyProjectionContractSha256,
    preimageModuleCount: 3,
    preimageSurfaceSha256: transition.preimageSurfaceSha256,
    postimageSurface: targetSurface,
    postimageSurfaceSha256: transition.targetSurfaceSha256,
    appliedByPersonId: ids.owner,
    appliedAt,
    rowCounts: {
      preimageCoreSurfaceRows: 3,
      updatedCoreSurfaceRows: 1,
      postimageCoreSurfaceRows: 3,
      defaultCoreSurfaceRowsUpdated: 0,
      workspaceLineageRowsInserted: 1,
      workspaceBusinessRowsRead: 0,
      workspaceBusinessRowsMutated: 0,
    },
    effects: {
      legacyCompatibilityReconciled: true,
      workspaceProjectionMetadataRead: true,
      workspaceProjectionMutated: true,
      historicalAttributionPreserved: true,
      workspaceLineageAdvanced: true,
      workspaceAuthorityBorrowed: false,
      workspaceBusinessDataRead: false,
      workspaceBusinessDataMutated: false,
      artifactResolved: false,
      artifactLoaded: false,
      moduleRuntimeStarted: false,
      moduleAdmitted: false,
      moduleMigrated: false,
      personalDataRead: false,
    },
    receiptHash: digest("e"),
  };
  const child = {
    ...placeholderChild,
    receiptHash:
      await hashWorkspaceCoreSurfaceReconciliationReceipt(placeholderChild),
  };
  const postimageInventory =
    await deriveInstallationCoreSurfacePostimageInventory(plan, [child]);
  const approvalHash =
    await hashInstallationCoreSurfaceReconciliationApprovalCore(
      creation.approval,
    );
  const placeholderReceipt: InstallationCoreSurfaceReconciliationReceipt = {
    contract: "vorton.installation-core-surface-reconciliation-receipt.v1",
    receiptId: ids.applicationReceipt,
    receiptPlane: "installation-postgres",
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: creation.approvalReceipt.receiptHash,
    approvalHash,
    binding: bindingFromPlan(plan),
    approvedByPersonId: ids.owner,
    appliedByPersonId: ids.owner,
    approvalConsumptionCount: 1,
    approvalConsumedAt: appliedAt,
    appliedAt,
    aal2VerifiedAt: "2026-08-31T20:00:00.000Z",
    assuranceLevel: "aal2",
    installationOwnerVerifiedAt: appliedAt,
    preimageInventorySha256: plan.inventory.inventorySha256,
    postimageInventory,
    workspaceReceipts: [
      {
        workspaceId: ids.workspaceA,
        receiptId: child.receiptId,
        receiptSha256: child.receiptHash,
      },
    ],
    rowCounts: {
      workspaceInventoryRowsRead: 2,
      legacyWorkspaceRowsLocked: 1,
      workspaceProjectionRowsUpdated: 1,
      workspaceLineageRowsInserted: 1,
      installationLineageRowsUpdated: 1,
      workspaceBusinessRowsRead: 0,
      workspaceBusinessRowsMutated: 0,
    },
    idempotency: {
      key: ids.applicationReceipt,
      exactReplayReturnsSameReceipt: true,
      conflictingReplayDenied: true,
      additionalProjectionMutationsOnReplay: 0,
    },
    effects: {
      approvalConsumed: true,
      installationReconciliationApplied: true,
      legacyCompatibilityReconciled: true,
      workspaceProjectionMetadataRead: true,
      workspaceProjectionMutated: true,
      historicalAttributionPreserved: true,
      workspaceLineageAdvanced: true,
      installationLineageAdvanced: true,
      releaseInstalled: false,
      releaseAdopted: false,
      workspaceAuthorityBorrowed: false,
      workspaceBusinessDataRead: false,
      workspaceBusinessDataMutated: false,
      artifactResolved: false,
      artifactLoaded: false,
      moduleRuntimeStarted: false,
      moduleAdmitted: false,
      moduleMigrated: false,
      personalDataRead: false,
      infrastructureMutated: false,
      externalSystemMutated: false,
      privateConsumerAuthorityGranted: false,
    },
    receiptHash: digest("f"),
  };
  return {
    applicationReceipt: {
      ...placeholderReceipt,
      receiptHash:
        await hashInstallationCoreSurfaceReconciliationReceipt(
          placeholderReceipt,
        ),
    },
    workspaceReceipts: [child],
  };
}

async function makeVerification(
  application: InstallationCoreSurfaceReconciliationApplication,
): Promise<InstallationCoreSurfaceReconciliationVerification> {
  const receipt = application.applicationReceipt;
  const reference = {
    receiptId: receipt.receiptId,
    receiptSha256: receipt.receiptHash,
  };
  const placeholder: InstallationCoreSurfaceReconciliationVerification = {
    contract: "vorton.installation-core-surface-reconciliation-verification.v1",
    vortonInstallationId: ids.installation,
    planHash: receipt.binding.planHash,
    targetRelease: receipt.binding.targetRelease,
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    applicationReceipt: reference,
    currentInstallationReconciliationReceipt: reference,
    postimageInventorySha256: receipt.postimageInventory.inventorySha256,
    currentWorkspaceReceipts: receipt.postimageInventory.entries.flatMap(
      (entry) =>
        entry.lineage
          ? [
              {
                workspaceId: entry.workspaceId,
                receiptId: entry.lineage.receiptId,
                receiptSha256: entry.lineage.receiptSha256,
              },
            ]
          : [],
    ),
    verifiedAt: "2026-08-31T20:06:00.000Z",
    verified: true,
    observations: {
      installationLineageRowsRead: 1,
      workspaceLineageRowsRead: 2,
      workspaceProjectionRowsRead: 4,
      workspaceBusinessRowsRead: 0,
      otherInstallationRowsRead: 0,
      externalSystemsRead: 0,
    },
    verificationHash: digest("0"),
  };
  return {
    ...placeholder,
    verificationHash:
      await hashInstallationCoreSurfaceReconciliationVerification(placeholder),
  };
}

describe("installation core-surface compatibility reconciliation contracts", () => {
  it("binds a complete inventory, every transition, and the adopted target release", async () => {
    const plan = await makePlan();
    await expect(
      parseInstallationCoreSurfaceReconciliationPlan(plan),
    ).resolves.toEqual(plan);
    expect(
      projectInstallationCoreSurfaceReconciliationPlanCore(plan),
    ).not.toHaveProperty("planHash");
    expect(plan.targetRelease.adoptionReceiptId).toBe(ids.releaseReceipt);
    expect(plan.compiledRegistrySha256).toBe(
      workspaceCompiledCoreSurfaceRegistrySha256,
    );
    expect(plan.inventory.entries).toHaveLength(2);
    expect(plan.transitions).toHaveLength(1);
    expect(
      canonicalInstallationCoreSurfaceReconciliationJson({ b: 2, a: 1 }),
    ).toBe('{"a":1,"b":2}');
  });

  it("rejects incomplete inventory, transition substitution, and caller-owned presentation", async () => {
    const plan = await makePlan();
    const hostilePlans = [
      {
        ...plan,
        inventory: {
          ...plan.inventory,
          entries: plan.inventory.entries.slice(0, 1),
        },
      },
      {
        ...plan,
        transitions: [
          {
            ...plan.transitions[0],
            preimageSurfaceSha256: digest("0"),
          },
        ],
      },
      {
        ...plan,
        transitions: [
          {
            ...plan.transitions[0],
            targetSurface: {
              ...targetSurface,
              modules: targetSurface.modules.map((module) =>
                module.id === "factory"
                  ? { ...module, presentationVariant: "standard" }
                  : module,
              ),
            },
          },
        ],
      },
      { ...plan, compiledRegistrySha256: digest("0") },
    ];
    for (const hostile of hostilePlans) {
      await expect(
        parseInstallationCoreSurfaceReconciliationPlan(hostile),
      ).rejects.toThrow();
    }
  });

  it("creates a separate no-effect installation approval receipt", async () => {
    const plan = await makePlan();
    const creation = await makeApprovalCreation(plan);
    await expect(
      parseInstallationCoreSurfaceReconciliationApprovalCreation(
        creation,
        plan,
      ),
    ).resolves.toEqual(creation);
    expect(
      projectInstallationCoreSurfaceReconciliationApprovalCore(
        creation.approval,
      ),
    ).not.toHaveProperty("approvalReceiptId");
    expect(
      projectInstallationCoreSurfaceReconciliationApprovalReceiptCore(
        creation.approvalReceipt,
      ),
    ).not.toHaveProperty("receiptHash");
    expect(creation.approval.authority.workspaceAuthorityBorrowed).toBe(false);
    expect(creation.approvalReceipt.effects).toMatchObject({
      approvalConsumed: false,
      installationReconciliationApplied: false,
      workspaceProjectionMutated: false,
      workspaceBusinessDataRead: false,
    });
  });

  it("keeps plan, approval, and apply requests authority-light", async () => {
    const plan = await makePlan();
    const planRequest = {
      releaseAdoptionReceiptId: ids.releaseReceipt,
      releaseAdoptionReceiptSha256: plan.targetRelease.adoptionReceiptSha256,
    };
    expect(
      installationCoreSurfaceReconciliationPlanRequestSchema.parse(planRequest),
    ).toEqual(planRequest);
    expect(
      installationCoreSurfaceReconciliationPlanRequestSchema.safeParse({
        ...planRequest,
        workspaceId: ids.workspaceA,
      }).success,
    ).toBe(false);
    const approvalRequest = {
      approvalId: ids.approval,
      planHash: plan.planHash,
      expiresAt,
    };
    expect(
      installationCoreSurfaceReconciliationApprovalRequestSchema.parse(
        approvalRequest,
      ),
    ).toEqual(approvalRequest);
    expect(
      installationCoreSurfaceReconciliationApprovalRequestSchema.safeParse({
        ...approvalRequest,
        ownerPersonId: ids.owner,
      }).success,
    ).toBe(false);
    expect(
      installationCoreSurfaceReconciliationApplyRequestSchema.parse({
        receiptId: ids.applicationReceipt,
      }),
    ).toEqual({ receiptId: ids.applicationReceipt });
    expect(
      installationCoreSurfaceReconciliationApplyRequestSchema.safeParse({
        receiptId: ids.applicationReceipt,
        workspaceId: ids.workspaceA,
      }).success,
    ).toBe(false);
  });

  it("rejects future or stale AAL2, borrowed workspace authority, and detached receipt hashes", async () => {
    const plan = await makePlan();
    const creation = await makeApprovalCreation(plan);
    const hostileApprovals = [
      {
        ...creation.approval,
        aal2VerifiedAt: "2026-08-31T20:00:00.001Z",
      },
      {
        ...creation.approval,
        aal2VerifiedAt: "2026-08-31T19:49:59.999Z",
      },
      {
        ...creation.approval,
        authority: {
          ...creation.approval.authority,
          workspaceAuthorityBorrowed: true,
        },
      },
    ];
    for (const hostile of hostileApprovals) {
      expect(
        installationCoreSurfaceReconciliationApprovalSchema.safeParse(hostile)
          .success,
      ).toBe(false);
    }
    await expect(
      parseInstallationCoreSurfaceReconciliationApprovalCreation(
        {
          ...creation,
          approvalReceipt: {
            ...creation.approvalReceipt,
            approvalHash: digest("0"),
          },
        },
        plan,
      ),
    ).rejects.toThrow();
    expect(
      installationCoreSurfaceReconciliationApprovalCreationSchema.safeParse({
        ...creation,
        approvalReceipt: {
          ...creation.approvalReceipt,
          receiptId: ids.approval,
        },
      }).success,
    ).toBe(false);
  });

  it("binds atomic per-workspace receipts into one exact application receipt", async () => {
    const plan = await makePlan();
    const creation = await makeApprovalCreation(plan);
    const application = await makeApplication(plan, creation);
    await expect(
      parseInstallationCoreSurfaceReconciliationApplication(
        application,
        plan,
        creation,
      ),
    ).resolves.toEqual(application);
    expect(
      projectInstallationCoreSurfaceReconciliationReceiptCore(
        application.applicationReceipt,
      ),
    ).not.toHaveProperty("receiptHash");
    expect(application.applicationReceipt.approvalConsumptionCount).toBe(1);
    expect(application.applicationReceipt.workspaceReceipts).toEqual([
      {
        workspaceId: ids.workspaceA,
        receiptId: ids.workspaceReceipt,
        receiptSha256: application.workspaceReceipts[0]!.receiptHash,
      },
    ]);
    expect(
      application.applicationReceipt.postimageInventory.entries[0],
    ).toMatchObject({
      state: "selected",
      lineage: {
        contract: "vorton.workspace-core-surface-reconciliation-receipt.v1",
        receiptId: ids.workspaceReceipt,
      },
    });
  });

  it("rejects detached child receipts, cross-workspace effects, and false postimages", async () => {
    const plan = await makePlan();
    const creation = await makeApprovalCreation(plan);
    const application = await makeApplication(plan, creation);
    const child = application.workspaceReceipts[0]!;
    expect(
      workspaceCoreSurfaceReconciliationReceiptSchema.safeParse({
        ...child,
        effects: {
          ...child.effects,
          workspaceAuthorityBorrowed: true,
        },
      }).success,
    ).toBe(false);
    expect(
      installationCoreSurfaceReconciliationReceiptSchema.safeParse({
        ...application.applicationReceipt,
        rowCounts: {
          ...application.applicationReceipt.rowCounts,
          workspaceBusinessRowsRead: 1,
        },
      }).success,
    ).toBe(false);
    await expect(
      parseInstallationCoreSurfaceReconciliationApplication(
        {
          ...application,
          workspaceReceipts: [{ ...child, preimageSurfaceSha256: digest("0") }],
        },
        plan,
        creation,
      ),
    ).rejects.toThrow();
    await expect(
      parseInstallationCoreSurfaceReconciliationApplication(
        {
          ...application,
          applicationReceipt: {
            ...application.applicationReceipt,
            postimageInventory: {
              ...application.applicationReceipt.postimageInventory,
              inventorySha256: digest("0"),
            },
          },
        },
        plan,
        creation,
      ),
    ).rejects.toThrow();
  });

  it("verifies the exact current installation and workspace receipt heads", async () => {
    const plan = await makePlan();
    const creation = await makeApprovalCreation(plan);
    const application = await makeApplication(plan, creation);
    const verification = await makeVerification(application);
    await expect(
      parseInstallationCoreSurfaceReconciliationVerification(
        verification,
        application,
      ),
    ).resolves.toEqual(verification);
    expect(
      projectInstallationCoreSurfaceReconciliationVerificationCore(
        verification,
      ),
    ).not.toHaveProperty("verificationHash");

    for (const hostile of [
      {
        ...verification,
        currentInstallationReconciliationReceipt: {
          ...verification.currentInstallationReconciliationReceipt,
          receiptSha256: digest("0"),
        },
      },
      {
        ...verification,
        currentWorkspaceReceipts: [
          {
            ...verification.currentWorkspaceReceipts[0]!,
            receiptSha256: digest("0"),
          },
        ],
      },
      { ...verification, postimageInventorySha256: digest("0") },
    ]) {
      await expect(
        parseInstallationCoreSurfaceReconciliationVerification(
          hostile,
          application,
        ),
      ).rejects.toThrow();
    }
  });

  it("emits generic current documents with deterministic canonical hashes", async () => {
    const plan = await makePlan();
    const creation = await makeApprovalCreation(plan);
    const application = await makeApplication(plan, creation);
    const verification = await makeVerification(application);
    const documents = [plan, creation, application, verification];
    const serialized = JSON.stringify(documents).toLowerCase();
    expect(serialized).not.toContain(["fre", "edos"].join(""));
    expect(serialized).not.toContain(["aub", "os"].join(""));

    await expect(
      hashInstallationCoreSurfaceReconciliationPlan({
        ...plan,
        targetRelease: { ...plan.targetRelease },
      }),
    ).resolves.toBe(plan.planHash);
    expect(installationCoreSurfaceReconciliationPlanSchema.parse(plan)).toEqual(
      plan,
    );
    expect(
      installationCoreSurfaceReconciliationVerificationSchema.parse(
        verification,
      ),
    ).toEqual(verification);
  });
});
