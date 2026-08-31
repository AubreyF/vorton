import { describe, expect, it } from "vitest";

import {
  type ModuleLifecycleActionCommand,
  type ModuleLifecycleActionReceipt,
  type ModuleLifecycleActionTarget,
  canonicalModuleLifecycleJson,
  hashModuleLifecycleApprovalCore,
  hashModuleLifecycleApprovalReceipt,
  hashModuleLifecycleActionCommand,
  hashModuleLifecycleActionReceipt,
  moduleLifecycleActionCommandSchema,
  moduleLifecycleActionConsumeRequestSchema,
  moduleLifecycleActionFinalizeRequestSchema,
  moduleLifecycleActionReceiptSchema,
  moduleLifecycleActionApprovalDocumentSchema,
  moduleLifecycleActionApprovalRequestSchema,
  moduleLifecycleApprovalCoreSchema,
  moduleLifecycleApprovalReceiptSchema,
  moduleLifecycleCanonicalSha256,
  parseModuleLifecycleApprovalCreation,
  parseModuleLifecycleActionCommandCreation,
  parseModuleLifecycleActionCompletion,
  parseModuleLifecycleActionReceipt,
} from "./module-lifecycle.js";

const ids = {
  approval: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  owner: "44444444-4444-4444-8444-444444444444",
  action: "55555555-5555-4555-8555-555555555555",
  fixture: "66666666-6666-4666-8666-666666666666",
  receipt: "77777777-7777-4777-8777-777777777777",
  secondReceipt: "88888888-8888-4888-8888-888888888888",
  approvalRecord: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  approvalReceipt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  command: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  actionReceipt: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  worker: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  credential: "12121212-1212-4212-8212-121212121212",
  finalCredential: "13131313-1313-4313-8313-131313131313",
  work: "14141414-1414-4414-8414-141414141414",
  policy: "15151515-1515-4515-8515-151515151515",
  grant: "16161616-1616-4616-8616-161616161616",
  backupActionReceipt: "17171717-1717-4717-8717-171717171717",
  recoveryActionReceipt: "18181818-1818-4818-8818-181818181818",
  deletionActionReceipt: "19191919-1919-4919-8919-191919191919",
};
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const binding = {
  vortonInstallationId: ids.installation,
  workspaceId: ids.workspace,
  realm: "personal" as const,
  module: "tasks",
  sequence: 1,
  migrationPlanHash: digest("1"),
  sourceSnapshotSha256: digest("2"),
  targetPreimageSha256: digest("3"),
  targetPostimageSha256: digest("4"),
};
const receipt = {
  receiptId: ids.receipt,
  receiptSha256: digest("5"),
};

const targets = [
  {
    action: "backup" as const,
    backupId: ids.action,
    storageObjectKey: "tasks/sequence-1/preimage.enc",
    encryptionKeyBindingId: ids.fixture,
  },
  {
    action: "recovery" as const,
    recoveryId: ids.action,
    recoveryNamespace: "tasks-recovery-1",
    backupReceipt: receipt,
  },
  {
    action: "deletion" as const,
    mode: "controlled-fixture" as const,
    rehearsalId: ids.action,
    controlledFixtureId: ids.fixture,
    productionDeletion: false as const,
    noProductionRecords: true as const,
    backupReceipt: receipt,
    recoveryReceipt: {
      receiptId: ids.secondReceipt,
      receiptSha256: digest("6"),
    },
    surfaces: {
      database: true as const,
      storage: true as const,
      memory: true as const,
      search: true as const,
      backups: true as const,
    },
  },
  {
    action: "rollback" as const,
    rollbackId: ids.action,
    rollbackNamespace: "tasks-rollback-1",
    backupReceipt: receipt,
    recoveryReceipt: {
      receiptId: ids.secondReceipt,
      receiptSha256: digest("6"),
    },
    deletionRehearsalReceipt: {
      receiptId: "99999999-9999-4999-8999-999999999999",
      receiptSha256: digest("7"),
    },
  },
] satisfies ModuleLifecycleActionTarget[];

describe("module lifecycle action approval contract", () => {
  it("uses one portable canonical JSON and SHA-256 boundary", async () => {
    const vector = {
      z: null,
      a: {
        timestamp: "2026-08-30T12:00:00.000Z",
        uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        integer: 42,
        array: [3, "x", false],
        nested: { b: 2, a: 1 },
      },
    };
    const expected =
      '{"a":{"array":[3,"x",false],"integer":42,"nested":{"a":1,"b":2},"timestamp":"2026-08-30T12:00:00.000Z","uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"z":null}';
    expect(canonicalModuleLifecycleJson(vector)).toBe(expected);
    expect(canonicalModuleLifecycleJson({ a: vector.a, z: null })).toBe(
      expected,
    );
    await expect(moduleLifecycleCanonicalSha256(vector)).resolves.toBe(
      "sha256:12b1b0f57cff0749342d1d85bdd5ec6fcbb5f024209ca22b408e31959e5e8c6e",
    );
    expect(() =>
      canonicalModuleLifecycleJson({ unsafe: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
  });

  it("binds a strict exact target for every lifecycle action", () => {
    for (const target of targets) {
      expect(
        moduleLifecycleActionApprovalRequestSchema.parse({
          approvalId: ids.approval,
          binding: { ...binding, target },
          expiresAt: "2026-08-30T13:00:00.000Z",
        }),
      ).toBeTruthy();
    }
  });

  it("rejects ambiguous, cross-action, and noncanonical request data", () => {
    expect(() =>
      moduleLifecycleActionApprovalRequestSchema.parse({
        approvalId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        binding: {
          ...binding,
          target: { ...targets[0], recoveryNamespace: "smuggled" },
        },
        expiresAt: "2026-08-30T13:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalRequestSchema.parse({
        approvalId: ids.approval,
        binding: {
          ...binding,
          target: {
            ...targets[0],
            storageObjectKey: "tasks/sequence-1/\u0000preimage.enc",
          },
        },
        expiresAt: "2026-08-30T13:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalRequestSchema.parse({
        approvalId: ids.approval,
        binding: {
          ...binding,
          target: {
            ...targets[2],
            productionDeletion: true,
          },
        },
        expiresAt: "2026-08-30T13:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalRequestSchema.parse({
        approvalId: ids.approval,
        binding: {
          ...binding,
          targetPostimageSha256: binding.targetPreimageSha256,
          target: targets[0],
        },
        expiresAt: "2026-08-30T13:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalRequestSchema.parse({
        approvalId: ids.receipt,
        binding: { ...binding, target: targets[1] },
        expiresAt: "2026-08-30T13:00:00.000Z",
      }),
    ).toThrow();
  });

  it("records owner, live membership, recent AAL2, and role non-authority", () => {
    const document = {
      contract: "vorton.module-lifecycle-action-approval.v1",
      approvalId: ids.approval,
      approvalRecordId: ids.approvalRecord,
      approvalReceiptId: ids.approvalReceipt,
      approvalReceiptSha256: digest("8"),
      approvalPlane: "workspace-postgres",
      ownerPersonId: ids.owner,
      binding: { ...binding, target: targets[2] },
      approvedAt: "2026-08-30T12:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
      assuranceLevel: "aal2",
      workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
      scope: {
        action: "deletion",
        moduleOnly: true,
        otherWorkspaceMutation: false,
        productionDeletion: false,
      },
      rolesGrantAuthority: false,
    };
    expect(
      moduleLifecycleActionApprovalDocumentSchema.parse(document),
    ).toBeTruthy();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...document,
        rolesGrantAuthority: true,
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...document,
        scope: { ...document.scope, action: "backup" },
      }),
    ).toThrow();
  });

  it("enforces the recent-AAL2 and expiry windows", () => {
    const base = {
      contract: "vorton.module-lifecycle-action-approval.v1",
      approvalId: ids.approval,
      approvalRecordId: ids.approvalRecord,
      approvalReceiptId: ids.approvalReceipt,
      approvalReceiptSha256: digest("8"),
      approvalPlane: "workspace-postgres",
      ownerPersonId: ids.owner,
      binding: { ...binding, target: targets[0] },
      approvedAt: "2026-08-30T12:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T12:00:00.000Z",
      assuranceLevel: "aal2",
      workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
      scope: {
        action: "backup",
        moduleOnly: true,
        otherWorkspaceMutation: false,
        productionDeletion: false,
      },
      rolesGrantAuthority: false,
    };
    expect(
      moduleLifecycleActionApprovalDocumentSchema.parse(base),
    ).toBeTruthy();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...base,
        aal2VerifiedAt: "2026-08-30T12:00:01.000Z",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...base,
        expiresAt: "2026-08-31T12:00:01.000Z",
      }),
    ).toThrow();
  });

  it("requires referenced immutable receipts to have distinct identities", () => {
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        contract: "vorton.module-lifecycle-action-approval.v1",
        approvalId: ids.receipt,
        approvalRecordId: ids.approvalRecord,
        approvalReceiptId: ids.approvalReceipt,
        approvalReceiptSha256: digest("8"),
        approvalPlane: "workspace-postgres",
        ownerPersonId: ids.owner,
        binding: { ...binding, target: targets[1] },
        approvedAt: "2026-08-30T12:00:00.000Z",
        expiresAt: "2026-08-30T13:00:00.000Z",
        aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
        assuranceLevel: "aal2",
        workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
        scope: {
          action: "recovery",
          moduleOnly: true,
          otherWorkspaceMutation: false,
          productionDeletion: false,
        },
        rolesGrantAuthority: false,
      }),
    ).toThrow();

    const rollbackDocument = {
      contract: "vorton.module-lifecycle-action-approval.v1",
      approvalId: ids.approval,
      approvalRecordId: ids.approvalRecord,
      approvalReceiptId: ids.approvalReceipt,
      approvalReceiptSha256: digest("8"),
      approvalPlane: "workspace-postgres",
      ownerPersonId: ids.owner,
      binding: { ...binding, target: targets[3] },
      approvedAt: "2026-08-30T12:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
      assuranceLevel: "aal2",
      workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
      scope: {
        action: "rollback",
        moduleOnly: true,
        otherWorkspaceMutation: false,
        productionDeletion: false,
      },
      rolesGrantAuthority: false,
    };
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...rollbackDocument,
        binding: {
          ...binding,
          target: {
            ...targets[3],
            backupReceipt: {
              ...receipt,
              receiptId: ids.approvalRecord,
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...rollbackDocument,
        binding: {
          ...binding,
          target: {
            ...targets[3],
            recoveryReceipt: {
              receiptId: ids.approvalReceipt,
              receiptSha256: digest("6"),
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...rollbackDocument,
        binding: {
          ...binding,
          target: {
            ...targets[3],
            recoveryReceipt: {
              receiptId: ids.secondReceipt,
              receiptSha256: receipt.receiptSha256,
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionApprovalDocumentSchema.parse({
        ...rollbackDocument,
        approvalReceiptSha256: receipt.receiptSha256,
      }),
    ).toThrow();
  });

  it("binds an immutable no-effect approval-creation receipt", () => {
    const receiptDocument = {
      contract: "vorton.module-lifecycle-approval-receipt.v1",
      receiptId: ids.approvalReceipt,
      receiptPlane: "workspace-postgres",
      approvalId: ids.approval,
      approvalHash: digest("8"),
      binding: { ...binding, target: targets[0] },
      action: "backup",
      vortonInstallationId: ids.installation,
      workspaceId: ids.workspace,
      ownerPersonId: ids.owner,
      approvedAt: "2026-08-30T12:00:00.000Z",
      createdAt: "2026-08-30T12:00:00.000Z",
      liveMembershipCheckedAt: "2026-08-30T12:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
      assuranceLevel: "aal2",
      effects: {
        actionExecuted: false,
        approvalConsumed: false,
        workspaceMutated: false,
        moduleDataMutated: false,
        externalSystemMutated: false,
      },
      receiptHash: digest("9"),
    };
    expect(
      moduleLifecycleApprovalReceiptSchema.parse(receiptDocument),
    ).toBeTruthy();
    expect(() =>
      moduleLifecycleApprovalReceiptSchema.parse({
        ...receiptDocument,
        action: "rollback",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleApprovalReceiptSchema.parse({
        ...receiptDocument,
        effects: { ...receiptDocument.effects, actionExecuted: true },
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleApprovalReceiptSchema.parse({
        ...receiptDocument,
        aal2VerifiedAt: "2026-08-30T12:00:01.000Z",
      }),
    ).toThrow();
  });

  it("verifies the noncircular approval core and receipt hashes", async () => {
    const core = moduleLifecycleApprovalCoreSchema.parse({
      contract: "vorton.module-lifecycle-action-approval.v1",
      approvalId: ids.approval,
      approvalRecordId: ids.approvalRecord,
      approvalPlane: "workspace-postgres",
      ownerPersonId: ids.owner,
      binding: { ...binding, target: targets[0] },
      approvedAt: "2026-08-30T12:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
      assuranceLevel: "aal2",
      workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
      scope: {
        action: "backup",
        moduleOnly: true,
        otherWorkspaceMutation: false,
        productionDeletion: false,
      },
      rolesGrantAuthority: false,
    });
    const approvalHash = await moduleLifecycleCanonicalSha256(core);
    const receiptWithoutHash = {
      contract: "vorton.module-lifecycle-approval-receipt.v1",
      receiptId: ids.approvalReceipt,
      receiptPlane: "workspace-postgres",
      approvalId: ids.approval,
      approvalHash,
      binding: core.binding,
      action: "backup",
      vortonInstallationId: ids.installation,
      workspaceId: ids.workspace,
      ownerPersonId: ids.owner,
      approvedAt: core.approvedAt,
      createdAt: core.approvedAt,
      liveMembershipCheckedAt: core.approvedAt,
      aal2VerifiedAt: core.aal2VerifiedAt,
      assuranceLevel: "aal2",
      effects: {
        actionExecuted: false,
        approvalConsumed: false,
        workspaceMutated: false,
        moduleDataMutated: false,
        externalSystemMutated: false,
      },
    };
    const receiptHash =
      await moduleLifecycleCanonicalSha256(receiptWithoutHash);
    const creation = {
      approval: {
        ...core,
        approvalReceiptId: ids.approvalReceipt,
        approvalReceiptSha256: receiptHash,
      },
      receipt: { ...receiptWithoutHash, receiptHash },
    };
    await expect(
      parseModuleLifecycleApprovalCreation(creation),
    ).resolves.toBeTruthy();
    await expect(
      hashModuleLifecycleApprovalCore(creation.approval),
    ).resolves.toBe(approvalHash);
    await expect(
      hashModuleLifecycleApprovalReceipt(creation.receipt),
    ).resolves.toBe(receiptHash);
    await expect(
      parseModuleLifecycleApprovalCreation({
        ...creation,
        receipt: { ...creation.receipt, approvalHash: digest("0") },
      }),
    ).rejects.toThrow("core hash");
    await expect(
      parseModuleLifecycleApprovalCreation({
        ...creation,
        approval: {
          ...creation.approval,
          approvalReceiptSha256: digest("0"),
        },
      }),
    ).rejects.toThrow();
  });
});

const successfulEvidence = {
  backup: {
    action: "backup" as const,
    capturedAt: "2026-08-30T12:11:00.000Z",
    recordCount: 7,
    capturedStateSha256: binding.targetPreimageSha256,
    manifestSha256: digest("a"),
    encryptedArtifactSha256: digest("b"),
    encryptedAtRest: true as const,
    workspaceKeyBound: true as const,
    workspaceStorageBound: true as const,
    otherWorkspaceAccessDenied: true as const,
  },
  recovery: {
    action: "recovery" as const,
    isolatedNamespaceSha256: digest("a"),
    restoredRecordCount: 7,
    restoredStateSha256: binding.targetPreimageSha256,
    productionNamespaceMutated: false as const,
    otherWorkspaceMutationCount: 0 as const,
    recoveryNamespaceDeleted: true as const,
  },
  deletion: {
    action: "deletion" as const,
    mode: "controlled-fixture" as const,
    controlledFixtureId: ids.fixture,
    deletionManifestSha256: digest("a"),
    productionRecordsDeleted: 0 as const,
    residualCounts: {
      databaseRows: 0 as const,
      storageObjects: 0 as const,
      memoryFragments: 0 as const,
      searchDocuments: 0 as const,
      backupObjects: 0 as const,
    },
    postDeletionRetrievalDenied: true as const,
    otherWorkspaceMutationCount: 0 as const,
  },
  rollback: {
    action: "rollback" as const,
    fromPostimageSha256: binding.targetPostimageSha256,
    restoredPreimageSha256: binding.targetPreimageSha256,
    replayedPostimageSha256: binding.targetPostimageSha256,
    productionNamespaceMutated: false as const,
    otherWorkspaceMutationCount: 0 as const,
    rollbackNamespaceDeleted: true as const,
  },
};

const mutationBoundaries = {
  backup: "workspace-backup-artifact" as const,
  recovery: "isolated-recovery-namespace" as const,
  deletion: "controlled-fixture" as const,
  rollback: "isolated-rollback-namespace" as const,
};

function exactPredecessors(target: ModuleLifecycleActionTarget) {
  switch (target.action) {
    case "backup":
      return { action: "backup" as const };
    case "recovery":
      return { action: "recovery" as const, backup: target.backupReceipt };
    case "deletion":
      return {
        action: "deletion" as const,
        backup: target.backupReceipt,
        recovery: target.recoveryReceipt,
      };
    case "rollback":
      return {
        action: "rollback" as const,
        backup: target.backupReceipt,
        recovery: target.recoveryReceipt,
        deletion: target.deletionRehearsalReceipt,
      };
  }
}

async function lifecycleArtifacts(target: ModuleLifecycleActionTarget) {
  const core = moduleLifecycleApprovalCoreSchema.parse({
    contract: "vorton.module-lifecycle-action-approval.v1",
    approvalId: ids.approval,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    ownerPersonId: ids.owner,
    binding: { ...binding, target },
    approvedAt: "2026-08-30T12:00:00.000Z",
    expiresAt: "2026-08-30T13:00:00.000Z",
    aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
    assuranceLevel: "aal2",
    workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
    scope: {
      action: target.action,
      moduleOnly: true,
      otherWorkspaceMutation: false,
      productionDeletion: false,
    },
    rolesGrantAuthority: false,
  });
  const approvalHash = await moduleLifecycleCanonicalSha256(core);
  const approvalReceiptCore = {
    contract: "vorton.module-lifecycle-approval-receipt.v1" as const,
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres" as const,
    approvalId: ids.approval,
    approvalHash,
    binding: core.binding,
    action: target.action,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    approvedAt: core.approvedAt,
    createdAt: core.approvedAt,
    liveMembershipCheckedAt: core.approvedAt,
    aal2VerifiedAt: core.aal2VerifiedAt,
    assuranceLevel: "aal2" as const,
    effects: {
      actionExecuted: false as const,
      approvalConsumed: false as const,
      workspaceMutated: false as const,
      moduleDataMutated: false as const,
      externalSystemMutated: false as const,
    },
  };
  const approvalReceiptSha256 =
    await moduleLifecycleCanonicalSha256(approvalReceiptCore);
  const approval = {
    ...core,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256,
  };
  const approvalReceipt = {
    ...approvalReceiptCore,
    receiptHash: approvalReceiptSha256,
  };
  const consumedAt = "2026-08-30T12:10:00.000Z";
  const executor = {
    kind: "worker" as const,
    workerId: ids.worker,
    workId: ids.work,
    policyId: ids.policy,
    admission: {
      credentialId: ids.credential,
      capabilityGrantId: ids.grant,
      liveAuthorityCheckedAt: consumedAt,
    },
    rolesGrantAuthority: false as const,
  };
  const commandWithPlaceholder = {
    contract: "vorton.module-lifecycle-action-command.v1" as const,
    commandId: ids.command,
    commandPlane: "workspace-postgres" as const,
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256,
    approvalHash,
    binding: core.binding,
    action: target.action,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    proofScope: "controlled-synthetic" as const,
    executor,
    approvalConsumptionCount: 1 as const,
    consumedAt,
    idempotencyKey: ids.command,
    predecessorReceipts: exactPredecessors(target),
    effects: {
      approvalConsumed: true as const,
      actionExecuted: false as const,
      workspaceMutated: false as const,
      moduleDataMutated: false as const,
      externalSystemMutated: false as const,
    },
    commandHash: digest("c"),
  };
  const commandHash = await hashModuleLifecycleActionCommand(
    commandWithPlaceholder,
  );
  const command = { ...commandWithPlaceholder, commandHash };
  const executedAt = "2026-08-30T12:12:00.000Z";
  const actionReceiptWithPlaceholder = {
    contract: "vorton.module-lifecycle-action-receipt.v1" as const,
    receiptId: ids.actionReceipt,
    receiptPlane: "workspace-postgres" as const,
    commandId: ids.command,
    commandHash,
    idempotencyKey: ids.command,
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256,
    approvalHash,
    binding: core.binding,
    action: target.action,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    proofScope: "controlled-synthetic" as const,
    executor: {
      ...executor,
      finalization: {
        credentialId: ids.finalCredential,
        liveAuthorityCheckedAt: executedAt,
      },
    },
    approvalConsumptionCount: 1 as const,
    consumedAt,
    executedAt,
    predecessorReceipts: exactPredecessors(target),
    outcome: { status: "succeeded" as const, code: "completed" as const },
    effects: {
      approvalConsumed: true as const,
      actionAttempted: true as const,
      actionCompleted: true as const,
      productionModuleDataMutated: false as const,
      otherWorkspaceMutated: false as const,
      mutationBoundary: mutationBoundaries[target.action],
    },
    evidence: successfulEvidence[target.action],
    receiptHash: digest("d"),
  };
  const receiptHash = await hashModuleLifecycleActionReceipt(
    actionReceiptWithPlaceholder,
  );
  const actionReceipt = { ...actionReceiptWithPlaceholder, receiptHash };
  return { approval, approvalReceipt, command, actionReceipt };
}

async function reviseActionReceipt(
  receipt: ModuleLifecycleActionReceipt,
  changes: Partial<ModuleLifecycleActionReceipt>,
): Promise<ModuleLifecycleActionReceipt> {
  const candidate = moduleLifecycleActionReceiptSchema.parse({
    ...receipt,
    ...changes,
    receiptHash: digest("f"),
  });
  return moduleLifecycleActionReceiptSchema.parse({
    ...candidate,
    receiptHash: await hashModuleLifecycleActionReceipt(candidate),
  });
}

async function reviseCommandProofScope(
  command: ModuleLifecycleActionCommand,
  proofScope: "controlled-synthetic" | "workspace-production",
): Promise<ModuleLifecycleActionCommand> {
  const candidate = moduleLifecycleActionCommandSchema.parse({
    ...command,
    proofScope,
    commandHash: digest("e"),
  });
  return moduleLifecycleActionCommandSchema.parse({
    ...candidate,
    commandHash: await hashModuleLifecycleActionCommand(candidate),
  });
}

describe("module lifecycle action command and terminal receipt", () => {
  it("accepts only the minimal worker request projections", () => {
    expect(
      moduleLifecycleActionConsumeRequestSchema.parse({
        commandId: ids.command,
        workId: ids.work,
        proofScope: "controlled-synthetic",
      }),
    ).toEqual({
      commandId: ids.command,
      workId: ids.work,
      proofScope: "controlled-synthetic",
    });
    expect(() =>
      moduleLifecycleActionConsumeRequestSchema.parse({
        commandId: ids.command,
        workId: ids.work,
        proofScope: "controlled-synthetic",
        workerId: ids.worker,
      }),
    ).toThrow();
    expect(
      moduleLifecycleActionFinalizeRequestSchema.parse({
        receiptId: ids.actionReceipt,
        outcome: { status: "succeeded", code: "completed" },
        effects: {
          approvalConsumed: true,
          actionAttempted: true,
          actionCompleted: true,
          productionModuleDataMutated: false,
          otherWorkspaceMutated: false,
          mutationBoundary: "workspace-backup-artifact",
        },
        evidence: successfulEvidence.backup,
      }),
    ).toMatchObject({ receiptId: ids.actionReceipt });
    expect(() =>
      moduleLifecycleActionFinalizeRequestSchema.parse({
        receiptId: ids.actionReceipt,
        outcome: { status: "succeeded", code: "completed" },
        effects: {
          approvalConsumed: true,
          actionAttempted: true,
          actionCompleted: true,
          productionModuleDataMutated: false,
          otherWorkspaceMutated: false,
          mutationBoundary: "workspace-backup-artifact",
        },
        evidence: successfulEvidence.backup,
        workspaceId: ids.workspace,
      }),
    ).toThrow();
  });

  it("binds the exact consumed approval into a no-effect worker command", async () => {
    const artifacts = await lifecycleArtifacts(targets[0]!);
    expect(
      moduleLifecycleActionCommandSchema.parse(artifacts.command),
    ).toBeTruthy();
    await expect(
      parseModuleLifecycleActionCommandCreation({
        approval: artifacts.approval,
        approvalReceipt: artifacts.approvalReceipt,
        command: artifacts.command,
      }),
    ).resolves.toBeTruthy();
    expect(artifacts.command.idempotencyKey).toBe(artifacts.command.commandId);
    expect(artifacts.command.executor.rolesGrantAuthority).toBe(false);
  });

  it("accepts exact success evidence for every action boundary", async () => {
    for (const target of targets) {
      const artifacts = await lifecycleArtifacts(target);
      expect(
        moduleLifecycleActionReceiptSchema.parse(artifacts.actionReceipt),
      ).toBeTruthy();
      await expect(
        parseModuleLifecycleActionReceipt(artifacts.actionReceipt),
      ).resolves.toBeTruthy();
    }
  });

  it("verifies the complete approval, command, and backup receipt chain", async () => {
    const artifacts = await lifecycleArtifacts(targets[0]!);
    const completion = {
      ...artifacts,
      predecessorReceiptDocuments: { action: "backup" as const },
    };
    await expect(
      parseModuleLifecycleActionCompletion(completion),
    ).resolves.toBeTruthy();
    await expect(
      parseModuleLifecycleActionCompletion({
        ...completion,
        actionReceipt: {
          ...completion.actionReceipt,
          consumedAt: "2026-08-30T12:10:01.000Z",
        },
      }),
    ).rejects.toThrow();
  });

  it("records a failed attempt as quarantined and demands new approval", async () => {
    const artifacts = await lifecycleArtifacts(targets[0]!);
    const failedWithPlaceholder = {
      ...artifacts.actionReceipt,
      outcome: {
        status: "failed" as const,
        code: "artifact-verification-failed",
        stage: "verification" as const,
        retryDisposition: "new-approval-required" as const,
      },
      effects: {
        approvalConsumed: true as const,
        actionAttempted: true as const,
        actionCompleted: false as const,
        authorizedTargetMutation: "unknown" as const,
        productionModuleDataMutation: "none" as const,
        otherWorkspaceMutation: "none" as const,
        quarantined: true as const,
      },
      evidence: {
        action: "backup" as const,
        failureEvidenceSha256: digest("e"),
        lastSafeCheckpoint: "artifact-written",
      },
      receiptHash: digest("f"),
    };
    const failed = {
      ...failedWithPlaceholder,
      receiptHash: await hashModuleLifecycleActionReceipt(
        failedWithPlaceholder,
      ),
    };
    await expect(
      parseModuleLifecycleActionReceipt(failed),
    ).resolves.toBeTruthy();
    expect(() =>
      moduleLifecycleActionReceiptSchema.parse({
        ...failed,
        outcome: { status: "succeeded", code: "completed" },
      }),
    ).toThrow();
  });

  it("rejects identity reuse, authority drift, and hash substitution", async () => {
    const artifacts = await lifecycleArtifacts(targets[0]!);
    await expect(
      parseModuleLifecycleActionCompletion({
        ...artifacts,
        predecessorReceiptDocuments: { action: "backup" },
        actionReceipt: {
          ...artifacts.actionReceipt,
          receiptId: ids.approvalRecord,
        },
      }),
    ).rejects.toThrow();
    expect(() =>
      moduleLifecycleActionReceiptSchema.parse({
        ...artifacts.actionReceipt,
        executor: {
          ...artifacts.actionReceipt.executor,
          rolesGrantAuthority: true,
        },
      }),
    ).toThrow();
    await expect(
      parseModuleLifecycleActionReceipt({
        ...artifacts.actionReceipt,
        receiptHash: digest("0"),
      }),
    ).rejects.toThrow("hash");
    expect(() =>
      moduleLifecycleActionCommandSchema.parse({
        ...artifacts.command,
        idempotencyKey: ids.actionReceipt,
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionReceiptSchema.parse({
        ...artifacts.actionReceipt,
        executor: {
          ...artifacts.actionReceipt.executor,
          finalization: {
            ...artifacts.actionReceipt.executor.finalization,
            liveAuthorityCheckedAt: artifacts.actionReceipt.consumedAt,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionReceiptSchema.parse({
        ...artifacts.actionReceipt,
        evidence: {
          ...artifacts.actionReceipt.evidence,
          capturedAt: "2026-08-30T12:13:00.000Z",
        },
      }),
    ).toThrow();
    const deletion = await lifecycleArtifacts(targets[2]!);
    expect(() =>
      moduleLifecycleActionCommandSchema.parse({
        ...deletion.command,
        proofScope: "workspace-production",
      }),
    ).toThrow();
    expect(() =>
      moduleLifecycleActionReceiptSchema.parse({
        ...deletion.actionReceipt,
        proofScope: "workspace-production",
      }),
    ).toThrow();
  });

  it("allows production rollback to depend on a controlled deletion rehearsal", async () => {
    const backupArtifacts = await lifecycleArtifacts(targets[0]!);
    const backup = await reviseActionReceipt(
      moduleLifecycleActionReceiptSchema.parse(backupArtifacts.actionReceipt),
      {
        receiptId: ids.backupActionReceipt,
        proofScope: "workspace-production",
        consumedAt: "2026-08-30T12:01:00.000Z",
        executedAt: "2026-08-30T12:02:00.000Z",
        executor: {
          ...backupArtifacts.actionReceipt.executor,
          admission: {
            ...backupArtifacts.actionReceipt.executor.admission,
            liveAuthorityCheckedAt: "2026-08-30T12:01:00.000Z",
          },
          finalization: {
            ...backupArtifacts.actionReceipt.executor.finalization,
            liveAuthorityCheckedAt: "2026-08-30T12:02:00.000Z",
          },
        },
        evidence: {
          ...successfulEvidence.backup,
          capturedAt: "2026-08-30T12:01:30.000Z",
        },
      },
    );
    const recoveryTarget = {
      ...targets[1]!,
      backupReceipt: {
        receiptId: backup.receiptId,
        receiptSha256: backup.receiptHash,
      },
    };
    const recoveryArtifacts = await lifecycleArtifacts(recoveryTarget);
    const recovery = await reviseActionReceipt(
      moduleLifecycleActionReceiptSchema.parse(recoveryArtifacts.actionReceipt),
      {
        receiptId: ids.recoveryActionReceipt,
        proofScope: "workspace-production",
        consumedAt: "2026-08-30T12:03:00.000Z",
        executedAt: "2026-08-30T12:04:00.000Z",
        executor: {
          ...recoveryArtifacts.actionReceipt.executor,
          admission: {
            ...recoveryArtifacts.actionReceipt.executor.admission,
            liveAuthorityCheckedAt: "2026-08-30T12:03:00.000Z",
          },
          finalization: {
            ...recoveryArtifacts.actionReceipt.executor.finalization,
            liveAuthorityCheckedAt: "2026-08-30T12:04:00.000Z",
          },
        },
      },
    );
    const deletionTarget = {
      ...targets[2]!,
      backupReceipt: {
        receiptId: backup.receiptId,
        receiptSha256: backup.receiptHash,
      },
      recoveryReceipt: {
        receiptId: recovery.receiptId,
        receiptSha256: recovery.receiptHash,
      },
    };
    const deletionArtifacts = await lifecycleArtifacts(deletionTarget);
    const deletion = await reviseActionReceipt(
      moduleLifecycleActionReceiptSchema.parse(deletionArtifacts.actionReceipt),
      {
        receiptId: ids.deletionActionReceipt,
        consumedAt: "2026-08-30T12:05:00.000Z",
        executedAt: "2026-08-30T12:06:00.000Z",
        executor: {
          ...deletionArtifacts.actionReceipt.executor,
          admission: {
            ...deletionArtifacts.actionReceipt.executor.admission,
            liveAuthorityCheckedAt: "2026-08-30T12:05:00.000Z",
          },
          finalization: {
            ...deletionArtifacts.actionReceipt.executor.finalization,
            liveAuthorityCheckedAt: "2026-08-30T12:06:00.000Z",
          },
        },
      },
    );
    const rollbackTarget = {
      ...targets[3]!,
      backupReceipt: {
        receiptId: backup.receiptId,
        receiptSha256: backup.receiptHash,
      },
      recoveryReceipt: {
        receiptId: recovery.receiptId,
        receiptSha256: recovery.receiptHash,
      },
      deletionRehearsalReceipt: {
        receiptId: deletion.receiptId,
        receiptSha256: deletion.receiptHash,
      },
    };
    const rollbackArtifacts = await lifecycleArtifacts(rollbackTarget);
    const command = await reviseCommandProofScope(
      moduleLifecycleActionCommandSchema.parse(rollbackArtifacts.command),
      "workspace-production",
    );
    const actionReceipt = await reviseActionReceipt(
      moduleLifecycleActionReceiptSchema.parse(rollbackArtifacts.actionReceipt),
      {
        proofScope: "workspace-production",
        commandHash: command.commandHash,
      },
    );
    const completion = {
      approval: rollbackArtifacts.approval,
      approvalReceipt: rollbackArtifacts.approvalReceipt,
      command,
      actionReceipt,
      predecessorReceiptDocuments: {
        action: "rollback" as const,
        backup,
        recovery,
        deletion,
      },
    };
    await expect(
      parseModuleLifecycleActionCompletion(completion),
    ).resolves.toBeTruthy();
    await expect(
      parseModuleLifecycleActionCompletion({
        approval: recoveryArtifacts.approval,
        approvalReceipt: recoveryArtifacts.approvalReceipt,
        command: recoveryArtifacts.command,
        actionReceipt: recoveryArtifacts.actionReceipt,
        predecessorReceiptDocuments: {
          action: "recovery",
          backup,
        },
      }),
    ).rejects.toThrow("proof scopes");
  });

  it("pins the canonical full action receipt hash vector", async () => {
    const artifacts = await lifecycleArtifacts(targets[0]!);
    await expect(
      hashModuleLifecycleActionReceipt(artifacts.actionReceipt),
    ).resolves.toBe(
      "sha256:dd5210005bd1d9567d6cb5b30f5d0bcdffd4269ab7410c46fe33d552acddc908",
    );
  });

  it("pins the canonical full action command hash vector", async () => {
    const artifacts = await lifecycleArtifacts(targets[0]!);
    await expect(
      hashModuleLifecycleActionCommand(artifacts.command),
    ).resolves.toBe(
      "sha256:c00f0523aebd637b11d14e6b088f23f174217e7a193f02c9c493ef6273f934b2",
    );
  });
});
