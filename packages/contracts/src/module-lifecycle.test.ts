import { describe, expect, it } from "vitest";

import {
  canonicalModuleLifecycleJson,
  hashModuleLifecycleApprovalCore,
  hashModuleLifecycleApprovalReceipt,
  moduleLifecycleActionApprovalDocumentSchema,
  moduleLifecycleActionApprovalRequestSchema,
  moduleLifecycleApprovalCoreSchema,
  moduleLifecycleApprovalReceiptSchema,
  moduleLifecycleCanonicalSha256,
  parseModuleLifecycleApprovalCreation,
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
];

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
