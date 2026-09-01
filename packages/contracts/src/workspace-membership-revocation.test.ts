import { describe, expect, it } from "vitest";

import { moduleLifecycleCanonicalSha256 } from "./module-lifecycle.js";
import {
  canonicalWorkspaceMembershipRevocationJson,
  hashWorkspaceMembershipRevocationApprovalCore,
  hashWorkspaceMembershipRevocationApprovalReceipt,
  hashWorkspaceMembershipRevocationReceipt,
  hashWorkspaceMembershipRevocationWorkSnapshot,
  parseWorkspaceMembershipRevocationApprovalCreation,
  parseWorkspaceMembershipRevocationReceipt,
  projectWorkspaceMembershipRevocationApprovalCore,
  projectWorkspaceMembershipRevocationApprovalReceiptCore,
  projectWorkspaceMembershipRevocationReceiptCore,
  projectWorkspaceMembershipRevocationWorkSnapshot,
  workspaceMembershipRevocationApplyRequestSchema,
  workspaceMembershipRevocationApprovalCreationSchema,
  workspaceMembershipRevocationApprovalDocumentSchema,
  workspaceMembershipRevocationApprovalRequestSchema,
  workspaceMembershipRevocationReceiptSchema,
  type WorkspaceMembershipRevocationApproval,
  type WorkspaceMembershipRevocationApprovalCreation,
  type WorkspaceMembershipRevocationApprovalReceipt,
  type WorkspaceMembershipRevocationReceipt,
  type WorkspaceMembershipRevocationWorkSnapshot,
} from "./workspace-membership-revocation.js";

const ids = {
  installation: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  target: "10000000-0000-4000-8000-000000000004",
  work: "10000000-0000-4000-8000-000000000005",
  workRequester: "10000000-0000-4000-8000-000000000006",
  policy: "10000000-0000-4000-8000-000000000007",
  grant: "10000000-0000-4000-8000-000000000008",
  approval: "10000000-0000-4000-8000-000000000009",
  approvalRecord: "10000000-0000-4000-8000-00000000000a",
  approvalReceipt: "10000000-0000-4000-8000-00000000000b",
  revocation: "10000000-0000-4000-8000-00000000000c",
  receipt: "10000000-0000-4000-8000-00000000000d",
} as const;

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const approvedAt = "2026-08-31T18:00:00.000Z";
const aal2VerifiedAt = "2026-08-31T17:55:00.000Z";
const expiresAt = "2026-09-01T18:00:00.000Z";
const appliedAt = "2026-08-31T18:05:00.000Z";

const workSnapshot: WorkspaceMembershipRevocationWorkSnapshot = {
  id: ids.work,
  vortonInstallationId: ids.installation,
  workspaceId: ids.workspace,
  title: "Revoke one synthetic membership",
  requestedOutcome: "Remove one exact membership while preserving an owner",
  acceptanceCriteria: [
    "Use the exact workspace scoped grant",
    "Leave every foreign workspace untouched",
  ],
  state: "ready",
  priority: 90,
  parentWorkId: null,
  requestedByPersonId: ids.workRequester,
  custodianPersonId: ids.actor,
  custodianWorkerId: null,
  leaseExpiresAt: null,
  createdAt: "2026-08-31T17:30:00.123456Z",
  updatedAt: "2026-08-31T17:45:00.654321Z",
};

async function makeApprovalCreation(
  overrides: {
    actorPersonId?: string;
    targetPersonId?: string;
    targetPersonKind?: "owner" | "member";
    aal2VerifiedAt?: string;
    expiresAt?: string;
  } = {},
): Promise<WorkspaceMembershipRevocationApprovalCreation> {
  const workSnapshotSha256 =
    await hashWorkspaceMembershipRevocationWorkSnapshot(workSnapshot);
  const actorPersonId = overrides.actorPersonId ?? ids.actor;
  const binding = {
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    realm: "organizational" as const,
    targetPersonId: overrides.targetPersonId ?? ids.target,
    targetPersonKind: overrides.targetPersonKind ?? ("member" as const),
    workId: ids.work,
    workSnapshotSha256,
  };
  const authority = {
    principalKind: "person" as const,
    personId: actorPersonId,
    workspaceMembershipKind: "owner" as const,
    capability: "workspace.membership.revoke" as const,
    mode: "modify" as const,
    workId: ids.work,
    policyId: ids.policy,
    policySha256: digest("1"),
    capabilityGrantId: ids.grant,
    workScoped: true as const,
    rolesGrantAuthority: false as const,
  };
  const placeholderApproval: WorkspaceMembershipRevocationApproval = {
    contract: "vorton.workspace-membership-revocation-approval.v1",
    approvalId: ids.approval,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    actorPersonId,
    binding,
    authority,
    approvedAt,
    expiresAt: overrides.expiresAt ?? expiresAt,
    aal2VerifiedAt: overrides.aal2VerifiedAt ?? aal2VerifiedAt,
    assuranceLevel: "aal2",
    actorMembershipVerifiedAt: approvedAt,
    targetMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    ownerContinuityAtApproval: {
      checkedAt: approvedAt,
      liveOwnerCount: overrides.targetPersonKind === "owner" ? 2 : 1,
    },
    scope: {
      action: "workspace.membership.revoke",
      targetMembershipOnly: true,
      selfRevocation: false,
      personDeletion: false,
      workspaceDeletion: false,
      otherMembershipMutation: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      externalSystemMutation: false,
    },
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: digest("f"),
  };
  const approvalHash =
    await hashWorkspaceMembershipRevocationApprovalCore(placeholderApproval);
  const placeholderReceipt: WorkspaceMembershipRevocationApprovalReceipt = {
    contract: "vorton.workspace-membership-revocation-approval-receipt.v1",
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres",
    approvalId: ids.approval,
    approvalRecordId: ids.approvalRecord,
    approvalHash,
    actorPersonId,
    binding,
    authority,
    approvedAt,
    createdAt: approvedAt,
    aal2VerifiedAt: overrides.aal2VerifiedAt ?? aal2VerifiedAt,
    assuranceLevel: "aal2",
    actorMembershipVerifiedAt: approvedAt,
    targetMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    ownerContinuityVerifiedAt: approvedAt,
    effects: {
      approvalCreated: true,
      approvalConsumed: false,
      targetMembershipRevoked: false,
      targetMembershipMutated: false,
      targetPersonDeleted: false,
      workspaceDeleted: false,
      otherMembershipMutated: false,
      otherPersonMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
    },
    receiptHash: digest("e"),
  };
  const receiptHash =
    await hashWorkspaceMembershipRevocationApprovalReceipt(placeholderReceipt);
  return {
    approval: {
      ...placeholderApproval,
      approvalReceiptSha256: receiptHash,
    },
    approvalReceipt: { ...placeholderReceipt, receiptHash },
  };
}

async function makeReceipt(
  creation: WorkspaceMembershipRevocationApprovalCreation,
): Promise<WorkspaceMembershipRevocationReceipt> {
  const approvalHash = await hashWorkspaceMembershipRevocationApprovalCore(
    creation.approval,
  );
  const approvalReceiptSha256 =
    await hashWorkspaceMembershipRevocationApprovalReceipt(
      creation.approvalReceipt,
    );
  const placeholder: WorkspaceMembershipRevocationReceipt = {
    contract: "vorton.workspace-membership-revocation-receipt.v1",
    receiptId: ids.receipt,
    receiptPlane: "workspace-postgres",
    membershipRevocationId: ids.revocation,
    approvalId: creation.approval.approvalId,
    approvalRecordId: creation.approval.approvalRecordId,
    approvalReceiptId: creation.approval.approvalReceiptId,
    approvalReceiptSha256,
    approvalHash,
    binding: creation.approval.binding,
    authority: creation.approval.authority,
    approvedByPersonId: creation.approval.actorPersonId,
    appliedByPersonId: creation.approval.actorPersonId,
    approvalConsumptionCount: 1,
    approvalConsumedAt: appliedAt,
    revokedAt: appliedAt,
    aal2VerifiedAt: "2026-08-31T18:00:00.000Z",
    assuranceLevel: "aal2",
    actorMembershipVerifiedAt: appliedAt,
    targetMembershipVerifiedAt: appliedAt,
    policyVerifiedAt: appliedAt,
    capabilityGrantVerifiedAt: appliedAt,
    workSnapshotVerifiedAt: appliedAt,
    ownerContinuity: {
      checkedAt: appliedAt,
      liveOwnerCountBefore:
        creation.approval.binding.targetPersonKind === "owner" ? 2 : 1,
      liveOwnerCountAfter: 1,
      finalOwnerRevoked: false,
    },
    idempotency: {
      key: ids.receipt,
      exactReplayReturnsSameReceipt: true,
      conflictingReplayDenied: true,
      additionalRevocationsOnReplay: 0,
    },
    effects: {
      targetMembershipRevoked: true,
      targetPersonDeleted: false,
      workspaceDeleted: false,
      otherMembershipMutated: false,
      otherPersonMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
    },
    receiptHash: digest("d"),
  };
  return {
    ...placeholder,
    receiptHash: await hashWorkspaceMembershipRevocationReceipt(placeholder),
  };
}

describe("workspace membership revocation contracts", () => {
  it("keeps both request calls minimal, strict, and route neutral", () => {
    const approvalRequest = {
      approvalId: ids.approval,
      targetPersonId: ids.target,
      expectedTargetKind: "member",
      workId: ids.work,
      capabilityGrantId: ids.grant,
      expiresAt,
    };
    expect(
      workspaceMembershipRevocationApprovalRequestSchema.parse(approvalRequest),
    ).toEqual(approvalRequest);
    for (const extra of [
      { actorPersonId: ids.actor },
      { workspaceId: ids.workspace },
      { realm: "organizational" },
      { policyId: ids.policy },
      { localRoute: "/admin/members" },
      { sourcePath: "members/target.json" },
      { approvalReceiptId: ids.approvalReceipt },
    ]) {
      expect(
        workspaceMembershipRevocationApprovalRequestSchema.safeParse({
          ...approvalRequest,
          ...extra,
        }).success,
      ).toBe(false);
    }

    expect(
      workspaceMembershipRevocationApplyRequestSchema.parse({
        receiptId: ids.receipt,
      }),
    ).toEqual({ receiptId: ids.receipt });
    for (const extra of [
      { approvalId: ids.approval },
      { actorPersonId: ids.actor },
      { workerId: ids.actor },
      { commandId: ids.approval },
      { path: "/admin/members" },
    ]) {
      expect(
        workspaceMembershipRevocationApplyRequestSchema.safeParse({
          receiptId: ids.receipt,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it("hashes the exact complete Work snapshot with the shared canonical algorithm", async () => {
    const reordered = Object.fromEntries(
      Object.entries(workSnapshot).reverse(),
    );
    const snapshotHash =
      await hashWorkspaceMembershipRevocationWorkSnapshot(workSnapshot);

    expect(projectWorkspaceMembershipRevocationWorkSnapshot(reordered)).toEqual(
      workSnapshot,
    );
    expect(await hashWorkspaceMembershipRevocationWorkSnapshot(reordered)).toBe(
      snapshotHash,
    );
    expect(await moduleLifecycleCanonicalSha256(workSnapshot)).toBe(
      snapshotHash,
    );
    expect(snapshotHash).toBe(
      "sha256:4aa0bf8ea6f823480aecb0446160e5faccdd53b0c46b7018bd05ccde7b9b1e4b",
    );
    expect(canonicalWorkspaceMembershipRevocationJson({ b: 2, a: 1 })).toBe(
      '{"a":1,"b":2}',
    );

    expect(
      workspaceMembershipRevocationApprovalRequestSchema.safeParse({
        approvalId: ids.approval,
        targetPersonId: ids.target,
        expectedTargetKind: "member",
        workId: ids.work,
        capabilityGrantId: ids.grant,
        expiresAt: "2026-09-01T18:00:00.000001Z",
      }).success,
    ).toBe(false);
    expect(() =>
      projectWorkspaceMembershipRevocationWorkSnapshot({
        ...workSnapshot,
        createdAt: "2026-08-31T17:30:00.123Z",
      }),
    ).toThrow();
    expect(() =>
      projectWorkspaceMembershipRevocationWorkSnapshot({
        ...workSnapshot,
        state: "review",
      }),
    ).toThrow();
    expect(() =>
      projectWorkspaceMembershipRevocationWorkSnapshot({
        ...workSnapshot,
        leaseExpiresAt: "2026-08-31T19:00:00.000000Z",
      }),
    ).toThrow();
    expect(() =>
      projectWorkspaceMembershipRevocationWorkSnapshot({
        ...workSnapshot,
        custodianPersonId: null,
      }),
    ).toThrow();
    expect(() =>
      projectWorkspaceMembershipRevocationWorkSnapshot({
        ...workSnapshot,
        custodianWorkerId: ids.actor,
      }),
    ).toThrow();
    expect(() =>
      projectWorkspaceMembershipRevocationWorkSnapshot({
        ...workSnapshot,
        createdAt: "2026-02-31T17:30:00.123456Z",
      }),
    ).toThrow();
  });

  it("verifies noncircular approval and no-effect receipt hashes", async () => {
    const creation = await makeApprovalCreation();
    const parsed =
      await parseWorkspaceMembershipRevocationApprovalCreation(creation);
    const approvalCore = projectWorkspaceMembershipRevocationApprovalCore(
      creation.approval,
    );
    const approvalReceiptCore =
      projectWorkspaceMembershipRevocationApprovalReceiptCore(
        creation.approvalReceipt,
      );

    expect(parsed).toEqual(creation);
    expect(approvalCore).not.toHaveProperty("approvalReceiptId");
    expect(approvalCore).not.toHaveProperty("approvalReceiptSha256");
    expect(approvalReceiptCore).not.toHaveProperty("receiptHash");
    expect(approvalReceiptCore).toHaveProperty("approvalHash");
    expect(
      await hashWorkspaceMembershipRevocationApprovalCore({
        ...creation.approval,
        approvalReceiptId: "20000000-0000-4000-8000-000000000003",
        approvalReceiptSha256: digest("2"),
      }),
    ).toBe(creation.approvalReceipt.approvalHash);
    expect(
      await hashWorkspaceMembershipRevocationApprovalReceipt({
        ...creation.approvalReceipt,
        receiptHash: digest("3"),
      }),
    ).toBe(creation.approvalReceipt.receiptHash);
    expect(creation.approvalReceipt.approvalHash).toBe(
      "sha256:500a298f591b7652f23346b3250ec80f078989f7b02353f6515528dc501492ee",
    );
    expect(creation.approvalReceipt.receiptHash).toBe(
      "sha256:a9c4d518736cf70b4837bdb94f293d7f1faaf163981762376e7c8cea2b2dd193",
    );
    expect(creation.approvalReceipt.effects).toEqual({
      approvalCreated: true,
      approvalConsumed: false,
      targetMembershipRevoked: false,
      targetMembershipMutated: false,
      targetPersonDeleted: false,
      workspaceDeleted: false,
      otherMembershipMutated: false,
      otherPersonMutated: false,
      otherWorkspaceRead: false,
      otherWorkspaceMutation: false,
      workMutated: false,
      policyMutated: false,
      capabilityGrantMutated: false,
      externalSystemMutated: false,
    });
    expect(
      workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
        ...creation.approval,
        workerId: ids.actor,
      }).success,
    ).toBe(false);
    expect(
      workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
        ...creation.approval,
        approvalReceiptSha256: creation.approval.authority.policySha256,
      }).success,
    ).toBe(false);
    expect(
      workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
        ...creation.approval,
        commandId: ids.approval,
      }).success,
    ).toBe(false);
  });

  it("rejects self-revocation, authority substitution, and stale hashes", async () => {
    const creation = await makeApprovalCreation();
    const self = {
      ...creation,
      approval: {
        ...creation.approval,
        actorPersonId: ids.target,
        authority: { ...creation.approval.authority, personId: ids.target },
      },
    };
    expect(
      workspaceMembershipRevocationApprovalCreationSchema.safeParse(self)
        .success,
    ).toBe(false);

    for (const mutation of [
      {
        ...creation,
        approval: {
          ...creation.approval,
          binding: {
            ...creation.approval.binding,
            targetPersonKind: "owner" as const,
          },
        },
      },
      {
        ...creation,
        approval: {
          ...creation.approval,
          authority: {
            ...creation.approval.authority,
            capabilityGrantId: "20000000-0000-4000-8000-000000000001",
          },
        },
      },
      {
        ...creation,
        approval: {
          ...creation.approval,
          authority: {
            ...creation.approval.authority,
            workspaceMembershipKind: "member",
          },
        },
      },
      {
        ...creation,
        approvalReceipt: {
          ...creation.approvalReceipt,
          approvalHash: digest("0"),
        },
      },
      {
        ...creation,
        approvalReceipt: {
          ...creation.approvalReceipt,
          receiptHash: digest("0"),
        },
      },
    ]) {
      await expect(
        parseWorkspaceMembershipRevocationApprovalCreation(mutation),
      ).rejects.toThrow();
    }
  });

  it("rejects future or stale AAL2 and invalid approval windows", async () => {
    const creation = await makeApprovalCreation();
    for (const invalid of [
      { aal2VerifiedAt: "2026-08-31T18:00:00.001Z" },
      { aal2VerifiedAt: "2026-08-31T17:49:59.999Z" },
      { expiresAt: approvedAt },
      { expiresAt: "2026-09-01T18:00:00.001Z" },
    ]) {
      expect(
        workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
          ...creation.approval,
          ...invalid,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects reused approval identities and content digests", async () => {
    const creation = await makeApprovalCreation();
    expect(
      workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
        ...creation.approval,
        approvalRecordId: creation.approval.approvalId,
      }).success,
    ).toBe(false);
    expect(
      workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
        ...creation.approval,
        approvalReceiptId: creation.approval.authority.capabilityGrantId,
      }).success,
    ).toBe(false);
    expect(
      workspaceMembershipRevocationApprovalDocumentSchema.safeParse({
        ...creation.approval,
        approvalReceiptSha256: creation.approval.binding.workSnapshotSha256,
      }).success,
    ).toBe(false);
  });

  it("verifies the exact same-person apply receipt and immutable replay fields", async () => {
    const creation = await makeApprovalCreation();
    const receipt = await makeReceipt(creation);
    const parsed = await parseWorkspaceMembershipRevocationReceipt(
      receipt,
      creation,
    );
    const replay = await parseWorkspaceMembershipRevocationReceipt(
      receipt,
      creation,
    );

    expect(parsed).toEqual(receipt);
    expect(replay).toEqual(receipt);
    expect(
      projectWorkspaceMembershipRevocationReceiptCore(receipt),
    ).not.toHaveProperty("receiptHash");
    expect(receipt.receiptHash).toBe(
      "sha256:a7ce4e03500d196b484bfaab7c2966aabeef7787d74aa4712bbcf0c708450e2b",
    );
    expect(receipt.approvalConsumptionCount).toBe(1);
    expect(receipt.idempotency).toEqual({
      key: ids.receipt,
      exactReplayReturnsSameReceipt: true,
      conflictingReplayDenied: true,
      additionalRevocationsOnReplay: 0,
    });
    expect(receipt.effects.otherWorkspaceRead).toBe(false);
    expect(receipt.effects.otherWorkspaceMutation).toBe(false);
    expect(
      await hashWorkspaceMembershipRevocationReceipt({
        ...receipt,
        receiptHash: digest("4"),
      }),
    ).toBe(receipt.receiptHash);
  });

  it("rejects execution substitution, foreign effects, conflicts, and ID reuse", async () => {
    const creation = await makeApprovalCreation();
    const receipt = await makeReceipt(creation);
    const otherPerson = "20000000-0000-4000-8000-000000000002";
    const mutations: unknown[] = [
      { ...receipt, appliedByPersonId: otherPerson },
      {
        ...receipt,
        binding: { ...receipt.binding, workspaceId: otherPerson },
      },
      {
        ...receipt,
        authority: { ...receipt.authority, policyId: otherPerson },
      },
      {
        ...receipt,
        authority: {
          ...receipt.authority,
          workspaceMembershipKind: "member",
        },
      },
      { ...receipt, approvalConsumptionCount: 2 },
      { ...receipt, membershipRevocationId: receipt.receiptId },
      {
        ...receipt,
        approvalReceiptSha256: receipt.binding.workSnapshotSha256,
      },
      {
        ...receipt,
        approvalReceiptSha256: receipt.authority.policySha256,
      },
      {
        ...receipt,
        effects: { ...receipt.effects, otherWorkspaceRead: true },
      },
      {
        ...receipt,
        idempotency: {
          ...receipt.idempotency,
          additionalRevocationsOnReplay: 1,
        },
      },
      { ...receipt, revokedAt: "2026-08-31T18:05:00.001Z" },
      { ...receipt, aal2VerifiedAt: "2026-08-31T18:05:00.001Z" },
      { ...receipt, aal2VerifiedAt: "2026-08-31T17:54:59.999Z" },
      { ...receipt, receiptHash: digest("0") },
    ];
    for (const mutation of mutations) {
      await expect(
        parseWorkspaceMembershipRevocationReceipt(mutation, creation),
      ).rejects.toThrow();
    }
  });

  it("requires exact owner continuity when the target is an owner", async () => {
    const creation = await makeApprovalCreation({ targetPersonKind: "owner" });
    const receipt = await makeReceipt(creation);
    await expect(
      parseWorkspaceMembershipRevocationReceipt(receipt, creation),
    ).resolves.toEqual(receipt);

    expect(
      workspaceMembershipRevocationReceiptSchema.safeParse({
        ...receipt,
        ownerContinuity: {
          ...receipt.ownerContinuity,
          liveOwnerCountBefore: 1,
          liveOwnerCountAfter: 0,
        },
      }).success,
    ).toBe(false);
  });
});
