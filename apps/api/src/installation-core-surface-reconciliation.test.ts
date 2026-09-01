import { describe, expect, it } from "vitest";

import {
  bindingFromPlan,
  deriveInstallationCoreSurfacePostimageInventory,
  hashInstallationCoreSurfaceInventory,
  hashInstallationCoreSurfaceReconciliationApprovalCore,
  hashInstallationCoreSurfaceReconciliationApprovalReceipt,
  hashInstallationCoreSurfaceReconciliationPlan,
  hashInstallationCoreSurfaceReconciliationReceipt,
  hashInstallationCoreSurfaceTransitionSet,
  hashWorkspaceCoreSurface,
  hashWorkspaceCoreSurfaceReconciliationReceipt,
  workspaceCompiledCoreSurfaceRegistrySha256,
  type InstallationCoreSurfaceInventory,
  type InstallationCoreSurfaceReconciliationApplication,
  type InstallationCoreSurfaceReconciliationApproval,
  type InstallationCoreSurfaceReconciliationApprovalCreation,
  type InstallationCoreSurfaceReconciliationApprovalReceipt,
  type InstallationCoreSurfaceReconciliationPlan,
  type InstallationCoreSurfaceReconciliationReceipt,
  type WorkspaceCoreSurface,
  type WorkspaceCoreSurfaceReconciliationReceipt,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import { StepUpAuthenticationError } from "./auth.js";
import {
  DatabaseInstallationCoreSurfaceReconciliation,
  InstallationCoreSurfaceReconciliationConflictError,
  InstallationCoreSurfaceReconciliationForbiddenError,
  InstallationCoreSurfaceReconciliationInputError,
  InstallationCoreSurfaceReconciliationIntegrityError,
  requireInstallationCoreSurfaceReconciliationRecentAal2,
} from "./installation-core-surface-reconciliation.js";

const ids = {
  installation: "30000000-0000-4000-8000-000000000001",
  workspace: "30000000-0000-4000-8000-000000000002",
  owner: "30000000-0000-4000-8000-000000000003",
  releaseReceipt: "30000000-0000-4000-8000-000000000004",
  approval: "30000000-0000-4000-8000-000000000005",
  approvalReceipt: "30000000-0000-4000-8000-000000000006",
  applicationReceipt: "30000000-0000-4000-8000-000000000007",
  workspaceReceipt: "30000000-0000-4000-8000-000000000008",
  authUser: "30000000-0000-4000-8000-000000000009",
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
      id: "admin",
      contractVersion: "v1",
      label: "Admin",
      navigationOrder: 20,
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
  migrationHead: "20260831000500_fixture_release",
  workspaceIsolationProofSha256: digest("4"),
  workspaceIsolationProofHash: digest("5"),
  status: "adopted" as const,
  adoptedAt: "2026-08-31T19:00:00.000Z",
};

async function makePlan(): Promise<InstallationCoreSurfaceReconciliationPlan> {
  const inventoryCore = {
    workspaceCount: 1,
    unconfiguredWorkspaceCount: 0,
    selectedWorkspaceCount: 0,
    legacyWorkspaceCount: 1,
    entries: [
      {
        workspaceId: ids.workspace,
        realm: "organizational" as const,
        state: "legacy-unreceipted" as const,
        moduleCount: 2,
        surfaceSha256: digest("6"),
        lineage: null,
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
      workspaceId: ids.workspace,
      realm: "organizational" as const,
      preimageModuleCount: 2,
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
    legacyProjectionContractSha256: digest("7"),
    predecessorReconciliationReceipt: null,
    inventory,
    transitions,
    transitionSetSha256:
      await hashInstallationCoreSurfaceTransitionSet(transitions),
    limits,
    planHash: digest("8"),
  };
  return {
    ...placeholder,
    planHash: await hashInstallationCoreSurfaceReconciliationPlan(placeholder),
  };
}

async function makeCreation(
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
  const approval: InstallationCoreSurfaceReconciliationApproval = {
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
    approvalReceiptSha256: digest("9"),
  };
  const approvalHash =
    await hashInstallationCoreSurfaceReconciliationApprovalCore(approval);
  const receipt: InstallationCoreSurfaceReconciliationApprovalReceipt = {
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
    receiptHash: digest("a"),
  };
  const receiptHash =
    await hashInstallationCoreSurfaceReconciliationApprovalReceipt(receipt);
  return {
    approval: { ...approval, approvalReceiptSha256: receiptHash },
    approvalReceipt: { ...receipt, receiptHash },
  };
}

async function makeApplication(
  plan: InstallationCoreSurfaceReconciliationPlan,
  creation: InstallationCoreSurfaceReconciliationApprovalCreation,
): Promise<InstallationCoreSurfaceReconciliationApplication> {
  const transition = plan.transitions[0]!;
  const childPlaceholder: WorkspaceCoreSurfaceReconciliationReceipt = {
    contract: "vorton.workspace-core-surface-reconciliation-receipt.v1",
    receiptId: ids.workspaceReceipt,
    receiptPlane: "installation-postgres",
    installationReceiptId: ids.applicationReceipt,
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: creation.approvalReceipt.receiptHash,
    planHash: plan.planHash,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    realm: "organizational",
    predecessorCoreSurfaceLineageReceipt: null,
    compiledRegistrySha256:
      workspaceCompiledCoreSurfaceRegistrySha256 as typeof workspaceCompiledCoreSurfaceRegistrySha256,
    legacyProjectionContractSha256: plan.legacyProjectionContractSha256,
    preimageModuleCount: 2,
    preimageSurfaceSha256: transition.preimageSurfaceSha256,
    postimageSurface: targetSurface,
    postimageSurfaceSha256: transition.targetSurfaceSha256,
    appliedByPersonId: ids.owner,
    appliedAt,
    rowCounts: {
      preimageCoreSurfaceRows: 2,
      updatedCoreSurfaceRows: 1,
      postimageCoreSurfaceRows: 2,
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
    receiptHash: digest("b"),
  };
  const child = {
    ...childPlaceholder,
    receiptHash:
      await hashWorkspaceCoreSurfaceReconciliationReceipt(childPlaceholder),
  };
  const postimageInventory =
    await deriveInstallationCoreSurfacePostimageInventory(plan, [child]);
  const receiptPlaceholder: InstallationCoreSurfaceReconciliationReceipt = {
    contract: "vorton.installation-core-surface-reconciliation-receipt.v1",
    receiptId: ids.applicationReceipt,
    receiptPlane: "installation-postgres",
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: creation.approvalReceipt.receiptHash,
    approvalHash: await hashInstallationCoreSurfaceReconciliationApprovalCore(
      creation.approval,
    ),
    binding: bindingFromPlan(plan),
    approvedByPersonId: ids.owner,
    appliedByPersonId: ids.owner,
    approvalConsumptionCount: 1,
    approvalConsumedAt: appliedAt,
    appliedAt,
    aal2VerifiedAt: approvedAt,
    assuranceLevel: "aal2",
    installationOwnerVerifiedAt: appliedAt,
    preimageInventorySha256: plan.inventory.inventorySha256,
    postimageInventory,
    workspaceReceipts: [
      {
        workspaceId: ids.workspace,
        receiptId: ids.workspaceReceipt,
        receiptSha256: child.receiptHash,
      },
    ],
    rowCounts: {
      workspaceInventoryRowsRead: 1,
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
    receiptHash: digest("c"),
  };
  return {
    applicationReceipt: {
      ...receiptPlaceholder,
      receiptHash:
        await hashInstallationCoreSurfaceReconciliationReceipt(
          receiptPlaceholder,
        ),
    },
    workspaceReceipts: [child],
  };
}

const recentIdentity = () => ({
  authUserId: ids.authUser,
  aal: "aal2" as const,
  authTime: Math.floor(Date.now() / 1_000) - 60,
});

function databaseResponding(
  respond: (sql: string, values: readonly unknown[]) => unknown,
  captures?: {
    contexts: unknown[];
    queries: Array<{ sql: string; values: readonly unknown[] }>;
  },
): Database {
  return {
    asInstallationPersonWithStepUp: async (
      context: unknown,
      work: (transaction: {
        query: (sql: string, values: readonly unknown[]) => Promise<unknown>;
      }) => Promise<unknown>,
    ) => {
      captures?.contexts.push(context);
      return work({
        query: async (sql, values) => {
          captures?.queries.push({ sql, values });
          const response = respond(sql, values);
          return {
            rows: [
              sql.includes("read_installation_core_surface_reconciliation_plan")
                ? { plan: response }
                : sql.includes(
                      "create_installation_core_surface_reconciliation_approval",
                    )
                  ? { creation: response }
                  : { application: response },
            ],
            rowCount: 1,
          };
        },
      });
    },
  } as unknown as Database;
}

function databaseThrowing(error: unknown): Database {
  return {
    asInstallationPersonWithStepUp: async () => {
      throw error;
    },
  } as unknown as Database;
}

describe("installation core-surface reconciliation API adapter", () => {
  it("requires nonfuture recent AAL2", () => {
    expect(() =>
      requireInstallationCoreSurfaceReconciliationRecentAal2(
        { authUserId: ids.authUser, aal: "aal1", authTime: 999 },
        1_000,
      ),
    ).toThrow(StepUpAuthenticationError);
    expect(() =>
      requireInstallationCoreSurfaceReconciliationRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: 1_001 },
        1_000,
      ),
    ).toThrow(StepUpAuthenticationError);
    expect(() =>
      requireInstallationCoreSurfaceReconciliationRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: 400 },
        1_001,
      ),
    ).toThrow(StepUpAuthenticationError);
    expect(() =>
      requireInstallationCoreSurfaceReconciliationRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: 400 },
        1_000,
      ),
    ).not.toThrow();
  });

  it("reads a release-bound plan in one signed installation-owner context", async () => {
    const plan = await makePlan();
    const captures: {
      contexts: unknown[];
      queries: Array<{ sql: string; values: readonly unknown[] }>;
    } = { contexts: [], queries: [] };
    const adapter = new DatabaseInstallationCoreSurfaceReconciliation(
      databaseResponding(() => plan, captures),
    );
    const request = {
      releaseAdoptionReceiptId: ids.releaseReceipt,
      releaseAdoptionReceiptSha256: targetRelease.adoptionReceiptSha256,
    };
    await expect(
      adapter.plan(ids.installation, request, recentIdentity()),
    ).resolves.toEqual(plan);
    expect(captures.contexts).toEqual([
      {
        authUserId: ids.authUser,
        installationId: ids.installation,
        aal: "aal2",
        authTime: expect.any(Number),
      },
    ]);
    expect(captures.queries[0]?.values).toEqual([
      ids.installation,
      ids.releaseReceipt,
      targetRelease.adoptionReceiptSha256,
    ]);
  });

  it("creates an exact approval and revalidates its database-derived plan", async () => {
    const plan = await makePlan();
    const creation = await makeCreation(plan);
    const captures: {
      contexts: unknown[];
      queries: Array<{ sql: string; values: readonly unknown[] }>;
    } = { contexts: [], queries: [] };
    const adapter = new DatabaseInstallationCoreSurfaceReconciliation(
      databaseResponding(
        (sql) =>
          sql.includes(
            "create_installation_core_surface_reconciliation_approval",
          )
            ? creation
            : plan,
        captures,
      ),
    );
    const request = {
      approvalId: ids.approval,
      planHash: plan.planHash,
      expiresAt,
    };
    await expect(
      adapter.approve(ids.installation, request, recentIdentity()),
    ).resolves.toEqual(creation);
    expect(captures.queries).toHaveLength(2);
    expect(captures.queries[0]?.values).toEqual([
      ids.approval,
      ids.installation,
      plan.planHash,
      expiresAt,
    ]);
  });

  it("applies only the path-bound approval and caller receipt identity", async () => {
    const plan = await makePlan();
    const creation = await makeCreation(plan);
    const application = await makeApplication(plan, creation);
    const captures: {
      contexts: unknown[];
      queries: Array<{ sql: string; values: readonly unknown[] }>;
    } = { contexts: [], queries: [] };
    const adapter = new DatabaseInstallationCoreSurfaceReconciliation(
      databaseResponding(() => application, captures),
    );
    await expect(
      adapter.apply(
        ids.installation,
        ids.approval,
        { receiptId: ids.applicationReceipt },
        recentIdentity(),
      ),
    ).resolves.toEqual(application);
    expect(captures.queries[0]?.values).toEqual([
      ids.installation,
      ids.approval,
      ids.applicationReceipt,
    ]);
  });

  it("rejects malformed input before opening an authority context", async () => {
    let called = false;
    const database = {
      asInstallationPersonWithStepUp: async () => {
        called = true;
      },
    } as unknown as Database;
    const adapter = new DatabaseInstallationCoreSurfaceReconciliation(database);
    await expect(
      adapter.approve(
        ids.installation,
        { approvalId: ids.approval, planHash: "bad", expiresAt } as never,
        recentIdentity(),
      ),
    ).rejects.toBeInstanceOf(InstallationCoreSurfaceReconciliationInputError);
    expect(called).toBe(false);
  });

  it("classifies only known P0001 messages and redacts unknown authority failures", async () => {
    const planRequest = {
      releaseAdoptionReceiptId: ids.releaseReceipt,
      releaseAdoptionReceiptSha256: targetRelease.adoptionReceiptSha256,
    };
    const cases = [
      [
        "Signed recent installation-person AAL2 is required",
        InstallationCoreSurfaceReconciliationForbiddenError,
      ],
      [
        "Exact installation reconciliation plan hash is required",
        InstallationCoreSurfaceReconciliationConflictError,
      ],
      [
        "Installation reconciliation approval expiry is invalid",
        InstallationCoreSurfaceReconciliationInputError,
      ],
      [
        "sensitive unexpected database detail",
        InstallationCoreSurfaceReconciliationIntegrityError,
      ],
    ] as const;
    for (const [message, ErrorType] of cases) {
      const error = Object.assign(new Error(message), { code: "P0001" });
      const adapter = new DatabaseInstallationCoreSurfaceReconciliation(
        databaseThrowing(error),
      );
      await expect(
        adapter.plan(ids.installation, planRequest, recentIdentity()),
      ).rejects.toBeInstanceOf(ErrorType);
    }
  });
});
