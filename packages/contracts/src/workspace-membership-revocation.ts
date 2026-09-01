import { z } from "zod";

import {
  canonicalModuleLifecycleJson,
  moduleLifecycleCanonicalSha256,
} from "./module-lifecycle.js";

const canonicalUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const realm = z.enum(["personal", "organizational"]);
const personKind = z.enum(["owner", "member"]);
const utcMilliseconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime()
  .refine(
    (value) => new Date(value).toISOString() === value,
    "must be a canonical UTC millisecond timestamp",
  );
const utcMicroseconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const millisecondProjection = `${value.slice(0, 23)}Z`;
    return (
      Number.isFinite(Date.parse(millisecondProjection)) &&
      new Date(millisecondProjection).toISOString() === millisecondProjection
    );
  }, "must be a valid UTC microsecond timestamp");

function milliseconds(value: string): number {
  return Date.parse(value);
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return (
    canonicalModuleLifecycleJson(left) === canonicalModuleLifecycleJson(right)
  );
}

export const canonicalWorkspaceMembershipRevocationJson =
  canonicalModuleLifecycleJson;
export const workspaceMembershipRevocationCanonicalSha256 =
  moduleLifecycleCanonicalSha256;

function addAuthorityIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

export const workspaceMembershipRevocationWorkSnapshotSchema = z
  .object({
    id: canonicalUuid,
    vortonInstallationId: canonicalUuid,
    workspaceId: canonicalUuid,
    title: z.string().trim().min(1).max(240),
    requestedOutcome: z.string().trim().min(1),
    acceptanceCriteria: z.array(z.string().trim().min(1)),
    state: z.literal("ready"),
    priority: z.number().int().safe().min(0).max(100),
    parentWorkId: canonicalUuid.nullable(),
    requestedByPersonId: canonicalUuid.nullable(),
    custodianPersonId: canonicalUuid,
    custodianWorkerId: z.literal(null),
    leaseExpiresAt: z.literal(null),
    createdAt: utcMicroseconds,
    updatedAt: utcMicroseconds,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.updatedAt < snapshot.createdAt) {
      addAuthorityIssue(
        context,
        ["updatedAt"],
        "Work update time cannot precede creation",
      );
    }
  });

export function projectWorkspaceMembershipRevocationWorkSnapshot(
  value: unknown,
): WorkspaceMembershipRevocationWorkSnapshot {
  return workspaceMembershipRevocationWorkSnapshotSchema.parse(value);
}

export async function hashWorkspaceMembershipRevocationWorkSnapshot(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceMembershipRevocationWorkSnapshot(value),
  );
}

export const workspaceMembershipRevocationBindingSchema = z
  .object({
    vortonInstallationId: canonicalUuid,
    workspaceId: canonicalUuid,
    realm,
    targetPersonId: canonicalUuid,
    targetPersonKind: personKind,
    workId: canonicalUuid,
    workSnapshotSha256: sha256,
  })
  .strict();

export const workspaceMembershipRevocationAuthoritySchema = z
  .object({
    principalKind: z.literal("person"),
    personId: canonicalUuid,
    workspaceMembershipKind: z.literal("owner"),
    capability: z.literal("workspace.membership.revoke"),
    mode: z.literal("modify"),
    workId: canonicalUuid,
    policyId: canonicalUuid,
    policySha256: sha256,
    capabilityGrantId: canonicalUuid,
    workScoped: z.literal(true),
    rolesGrantAuthority: z.literal(false),
  })
  .strict();

export const workspaceMembershipRevocationApprovalRequestSchema = z
  .object({
    approvalId: canonicalUuid,
    targetPersonId: canonicalUuid,
    expectedTargetKind: personKind,
    workId: canonicalUuid,
    capabilityGrantId: canonicalUuid,
    expiresAt: utcMilliseconds,
  })
  .strict();

export const workspaceMembershipRevocationApplyRequestSchema = z
  .object({ receiptId: canonicalUuid })
  .strict();

const revocationScopeSchema = z
  .object({
    action: z.literal("workspace.membership.revoke"),
    targetMembershipOnly: z.literal(true),
    selfRevocation: z.literal(false),
    personDeletion: z.literal(false),
    workspaceDeletion: z.literal(false),
    otherMembershipMutation: z.literal(false),
    otherWorkspaceRead: z.literal(false),
    otherWorkspaceMutation: z.literal(false),
    externalSystemMutation: z.literal(false),
  })
  .strict();

const ownerContinuityAtApprovalSchema = z
  .object({
    checkedAt: utcMilliseconds,
    liveOwnerCount: z.number().int().safe().positive(),
  })
  .strict();

const approvalCoreShape = {
  contract: z.literal("vorton.workspace-membership-revocation-approval.v1"),
  approvalId: canonicalUuid,
  approvalRecordId: canonicalUuid,
  approvalPlane: z.literal("workspace-postgres"),
  actorPersonId: canonicalUuid,
  binding: workspaceMembershipRevocationBindingSchema,
  authority: workspaceMembershipRevocationAuthoritySchema,
  approvedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  actorMembershipVerifiedAt: utcMilliseconds,
  targetMembershipVerifiedAt: utcMilliseconds,
  policyVerifiedAt: utcMilliseconds,
  capabilityGrantVerifiedAt: utcMilliseconds,
  workVerifiedAt: utcMilliseconds,
  ownerContinuityAtApproval: ownerContinuityAtApprovalSchema,
  scope: revocationScopeSchema,
} as const;

type ApprovalCoreCandidate = z.infer<z.ZodObject<typeof approvalCoreShape>>;

function validateApprovalCore(
  approval: ApprovalCoreCandidate,
  context: z.RefinementCtx,
): void {
  const approvedAt = milliseconds(approval.approvedAt);
  const aal2VerifiedAt = milliseconds(approval.aal2VerifiedAt);
  const expiresAt = milliseconds(approval.expiresAt);
  const verificationTimes = [
    approval.actorMembershipVerifiedAt,
    approval.targetMembershipVerifiedAt,
    approval.policyVerifiedAt,
    approval.capabilityGrantVerifiedAt,
    approval.workVerifiedAt,
    approval.ownerContinuityAtApproval.checkedAt,
  ];

  if (
    approval.actorPersonId === approval.binding.targetPersonId ||
    approval.authority.personId !== approval.actorPersonId ||
    approval.authority.workId !== approval.binding.workId
  ) {
    addAuthorityIssue(
      context,
      ["actorPersonId"],
      "Revocation authority must bind one non-target person and the exact Work",
    );
  }
  if (
    verificationTimes.some((value) => value !== approval.approvedAt) ||
    aal2VerifiedAt > approvedAt ||
    approvedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
    expiresAt <= approvedAt ||
    expiresAt > approvedAt + 24 * 60 * 60 * 1_000
  ) {
    addAuthorityIssue(
      context,
      ["approvedAt"],
      "Approval timestamps violate the live authority window",
    );
  }
  if (
    approval.binding.targetPersonKind === "owner" &&
    approval.ownerContinuityAtApproval.liveOwnerCount < 2
  ) {
    addAuthorityIssue(
      context,
      ["ownerContinuityAtApproval", "liveOwnerCount"],
      "An owner target requires another live owner before approval",
    );
  }
  if (
    new Set([
      approval.approvalId,
      approval.approvalRecordId,
      approval.authority.policyId,
      approval.authority.capabilityGrantId,
    ]).size !== 4
  ) {
    addAuthorityIssue(
      context,
      ["approvalId"],
      "Approval, Record, Policy, and grant identities must be distinct",
    );
  }
}

export const workspaceMembershipRevocationApprovalCoreSchema = z
  .object(approvalCoreShape)
  .strict()
  .superRefine(validateApprovalCore);

export const workspaceMembershipRevocationApprovalDocumentSchema = z
  .object({
    ...approvalCoreShape,
    approvalReceiptId: canonicalUuid,
    approvalReceiptSha256: sha256,
  })
  .strict()
  .superRefine((approval, context) => {
    validateApprovalCore(approval, context);
    if (
      new Set([
        approval.approvalId,
        approval.approvalRecordId,
        approval.approvalReceiptId,
        approval.authority.policyId,
        approval.authority.capabilityGrantId,
      ]).size !== 5 ||
      new Set([
        approval.approvalReceiptSha256,
        approval.binding.workSnapshotSha256,
        approval.authority.policySha256,
      ]).size !== 3
    ) {
      addAuthorityIssue(
        context,
        ["approvalReceiptId"],
        "Approval artifact identities and content digests must be distinct",
      );
    }
  });

const approvalCreationEffectsSchema = z
  .object({
    approvalCreated: z.literal(true),
    approvalConsumed: z.literal(false),
    targetMembershipRevoked: z.literal(false),
    targetMembershipMutated: z.literal(false),
    targetPersonDeleted: z.literal(false),
    workspaceDeleted: z.literal(false),
    otherMembershipMutated: z.literal(false),
    otherPersonMutated: z.literal(false),
    otherWorkspaceRead: z.literal(false),
    otherWorkspaceMutation: z.literal(false),
    workMutated: z.literal(false),
    policyMutated: z.literal(false),
    capabilityGrantMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
  })
  .strict();

const approvalReceiptShape = {
  contract: z.literal(
    "vorton.workspace-membership-revocation-approval-receipt.v1",
  ),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("workspace-postgres"),
  approvalId: canonicalUuid,
  approvalRecordId: canonicalUuid,
  approvalHash: sha256,
  actorPersonId: canonicalUuid,
  binding: workspaceMembershipRevocationBindingSchema,
  authority: workspaceMembershipRevocationAuthoritySchema,
  approvedAt: utcMilliseconds,
  createdAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  actorMembershipVerifiedAt: utcMilliseconds,
  targetMembershipVerifiedAt: utcMilliseconds,
  policyVerifiedAt: utcMilliseconds,
  capabilityGrantVerifiedAt: utcMilliseconds,
  workVerifiedAt: utcMilliseconds,
  ownerContinuityVerifiedAt: utcMilliseconds,
  effects: approvalCreationEffectsSchema,
} as const;

export const workspaceMembershipRevocationApprovalReceiptSchema = z
  .object({ ...approvalReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const verificationTimes = [
      receipt.createdAt,
      receipt.actorMembershipVerifiedAt,
      receipt.targetMembershipVerifiedAt,
      receipt.policyVerifiedAt,
      receipt.capabilityGrantVerifiedAt,
      receipt.workVerifiedAt,
      receipt.ownerContinuityVerifiedAt,
    ];
    const approvedAt = milliseconds(receipt.approvedAt);
    const aal2VerifiedAt = milliseconds(receipt.aal2VerifiedAt);
    if (
      receipt.actorPersonId === receipt.binding.targetPersonId ||
      receipt.authority.personId !== receipt.actorPersonId ||
      receipt.authority.workId !== receipt.binding.workId ||
      verificationTimes.some((value) => value !== receipt.approvedAt) ||
      aal2VerifiedAt > approvedAt ||
      approvedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
      new Set([
        receipt.approvalId,
        receipt.approvalRecordId,
        receipt.receiptId,
        receipt.authority.policyId,
        receipt.authority.capabilityGrantId,
      ]).size !== 5 ||
      new Set([
        receipt.approvalHash,
        receipt.receiptHash,
        receipt.binding.workSnapshotSha256,
        receipt.authority.policySha256,
      ]).size !== 4
    ) {
      addAuthorityIssue(
        context,
        ["receiptId"],
        "Approval receipt does not bind exact no-effect authority",
      );
    }
  });

export const workspaceMembershipRevocationApprovalCreationSchema = z
  .object({
    approval: workspaceMembershipRevocationApprovalDocumentSchema,
    approvalReceipt: workspaceMembershipRevocationApprovalReceiptSchema,
  })
  .strict()
  .superRefine(({ approval, approvalReceipt }, context) => {
    if (
      approval.approvalReceiptId !== approvalReceipt.receiptId ||
      approval.approvalReceiptSha256 !== approvalReceipt.receiptHash ||
      approval.approvalId !== approvalReceipt.approvalId ||
      approval.approvalRecordId !== approvalReceipt.approvalRecordId ||
      approval.actorPersonId !== approvalReceipt.actorPersonId ||
      approval.approvedAt !== approvalReceipt.approvedAt ||
      approval.aal2VerifiedAt !== approvalReceipt.aal2VerifiedAt ||
      !equalCanonical(approval.binding, approvalReceipt.binding) ||
      !equalCanonical(approval.authority, approvalReceipt.authority)
    ) {
      addAuthorityIssue(
        context,
        ["approvalReceipt"],
        "Approval and its atomic no-effect receipt do not match",
      );
    }
  });

export function projectWorkspaceMembershipRevocationApprovalCore(
  value: unknown,
): WorkspaceMembershipRevocationApprovalCore {
  const approval =
    workspaceMembershipRevocationApprovalDocumentSchema.parse(value);
  const {
    approvalReceiptId: _approvalReceiptId,
    approvalReceiptSha256: _approvalReceiptSha256,
    ...core
  } = approval;
  return workspaceMembershipRevocationApprovalCoreSchema.parse(core);
}

export async function hashWorkspaceMembershipRevocationApprovalCore(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceMembershipRevocationApprovalCore(value),
  );
}

export function projectWorkspaceMembershipRevocationApprovalReceiptCore(
  value: unknown,
): Omit<WorkspaceMembershipRevocationApprovalReceipt, "receiptHash"> {
  const receipt =
    workspaceMembershipRevocationApprovalReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashWorkspaceMembershipRevocationApprovalReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceMembershipRevocationApprovalReceiptCore(value),
  );
}

export async function parseWorkspaceMembershipRevocationApprovalCreation(
  value: unknown,
): Promise<WorkspaceMembershipRevocationApprovalCreation> {
  const creation =
    workspaceMembershipRevocationApprovalCreationSchema.parse(value);
  const approvalHash = await hashWorkspaceMembershipRevocationApprovalCore(
    creation.approval,
  );
  const approvalReceiptHash =
    await hashWorkspaceMembershipRevocationApprovalReceipt(
      creation.approvalReceipt,
    );
  if (approvalHash !== creation.approvalReceipt.approvalHash) {
    throw new Error("Membership revocation approval hash is invalid");
  }
  if (approvalReceiptHash !== creation.approvalReceipt.receiptHash) {
    throw new Error("Membership revocation approval receipt hash is invalid");
  }
  return creation;
}

const ownerContinuitySchema = z
  .object({
    checkedAt: utcMilliseconds,
    liveOwnerCountBefore: z.number().int().safe().positive(),
    liveOwnerCountAfter: z.number().int().safe().positive(),
    finalOwnerRevoked: z.literal(false),
  })
  .strict();

const revocationIdempotencySchema = z
  .object({
    key: canonicalUuid,
    exactReplayReturnsSameReceipt: z.literal(true),
    conflictingReplayDenied: z.literal(true),
    additionalRevocationsOnReplay: z.literal(0),
  })
  .strict();

const revocationEffectsSchema = z
  .object({
    targetMembershipRevoked: z.literal(true),
    targetPersonDeleted: z.literal(false),
    workspaceDeleted: z.literal(false),
    otherMembershipMutated: z.literal(false),
    otherPersonMutated: z.literal(false),
    otherWorkspaceRead: z.literal(false),
    otherWorkspaceMutation: z.literal(false),
    workMutated: z.literal(false),
    policyMutated: z.literal(false),
    capabilityGrantMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
  })
  .strict();

const revocationReceiptShape = {
  contract: z.literal("vorton.workspace-membership-revocation-receipt.v1"),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("workspace-postgres"),
  membershipRevocationId: canonicalUuid,
  approvalId: canonicalUuid,
  approvalRecordId: canonicalUuid,
  approvalReceiptId: canonicalUuid,
  approvalReceiptSha256: sha256,
  approvalHash: sha256,
  binding: workspaceMembershipRevocationBindingSchema,
  authority: workspaceMembershipRevocationAuthoritySchema,
  approvedByPersonId: canonicalUuid,
  appliedByPersonId: canonicalUuid,
  approvalConsumptionCount: z.literal(1),
  approvalConsumedAt: utcMilliseconds,
  revokedAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  actorMembershipVerifiedAt: utcMilliseconds,
  targetMembershipVerifiedAt: utcMilliseconds,
  policyVerifiedAt: utcMilliseconds,
  capabilityGrantVerifiedAt: utcMilliseconds,
  workSnapshotVerifiedAt: utcMilliseconds,
  ownerContinuity: ownerContinuitySchema,
  idempotency: revocationIdempotencySchema,
  effects: revocationEffectsSchema,
} as const;

export const workspaceMembershipRevocationReceiptSchema = z
  .object({ ...revocationReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const verificationTimes = [
      receipt.approvalConsumedAt,
      receipt.revokedAt,
      receipt.actorMembershipVerifiedAt,
      receipt.targetMembershipVerifiedAt,
      receipt.policyVerifiedAt,
      receipt.capabilityGrantVerifiedAt,
      receipt.workSnapshotVerifiedAt,
      receipt.ownerContinuity.checkedAt,
    ];
    const identityValues = [
      receipt.receiptId,
      receipt.membershipRevocationId,
      receipt.approvalId,
      receipt.approvalRecordId,
      receipt.approvalReceiptId,
      receipt.authority.policyId,
      receipt.authority.capabilityGrantId,
    ];
    const hashValues = [
      receipt.receiptHash,
      receipt.approvalHash,
      receipt.approvalReceiptSha256,
      receipt.binding.workSnapshotSha256,
      receipt.authority.policySha256,
    ];
    const ownerTarget = receipt.binding.targetPersonKind === "owner";
    const consumedAt = milliseconds(receipt.approvalConsumedAt);
    const aal2VerifiedAt = milliseconds(receipt.aal2VerifiedAt);
    const ownerCountsValid = ownerTarget
      ? receipt.ownerContinuity.liveOwnerCountBefore >= 2 &&
        receipt.ownerContinuity.liveOwnerCountAfter ===
          receipt.ownerContinuity.liveOwnerCountBefore - 1
      : receipt.ownerContinuity.liveOwnerCountAfter ===
        receipt.ownerContinuity.liveOwnerCountBefore;

    if (
      receipt.approvedByPersonId !== receipt.appliedByPersonId ||
      receipt.appliedByPersonId === receipt.binding.targetPersonId ||
      receipt.authority.personId !== receipt.appliedByPersonId ||
      receipt.authority.workId !== receipt.binding.workId ||
      receipt.idempotency.key !== receipt.receiptId ||
      aal2VerifiedAt > consumedAt ||
      consumedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
      verificationTimes.some((value) => value !== receipt.approvalConsumedAt) ||
      !ownerCountsValid ||
      new Set(identityValues).size !== identityValues.length ||
      new Set(hashValues).size !== hashValues.length
    ) {
      addAuthorityIssue(
        context,
        ["receiptId"],
        "Revocation receipt does not bind exact same-person authority and effects",
      );
    }
  });

export function projectWorkspaceMembershipRevocationReceiptCore(
  value: unknown,
): Omit<WorkspaceMembershipRevocationReceipt, "receiptHash"> {
  const receipt = workspaceMembershipRevocationReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashWorkspaceMembershipRevocationReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceMembershipRevocationReceiptCore(value),
  );
}

export async function parseWorkspaceMembershipRevocationReceipt(
  value: unknown,
  approvalCreation: unknown,
): Promise<WorkspaceMembershipRevocationReceipt> {
  const creation =
    await parseWorkspaceMembershipRevocationApprovalCreation(approvalCreation);
  const receipt = workspaceMembershipRevocationReceiptSchema.parse(value);
  const approvalHash = await hashWorkspaceMembershipRevocationApprovalCore(
    creation.approval,
  );
  const approvalReceiptHash =
    await hashWorkspaceMembershipRevocationApprovalReceipt(
      creation.approvalReceipt,
    );
  const ids = [
    creation.approval.approvalId,
    creation.approval.approvalRecordId,
    creation.approval.approvalReceiptId,
    receipt.membershipRevocationId,
    receipt.receiptId,
  ];
  const hashes = [
    approvalHash,
    approvalReceiptHash,
    creation.approval.binding.workSnapshotSha256,
    creation.approval.authority.policySha256,
    receipt.receiptHash,
  ];
  if (
    receipt.approvalId !== creation.approval.approvalId ||
    receipt.approvalRecordId !== creation.approval.approvalRecordId ||
    receipt.approvalReceiptId !== creation.approval.approvalReceiptId ||
    receipt.approvalReceiptSha256 !== approvalReceiptHash ||
    receipt.approvalHash !== approvalHash ||
    receipt.approvedByPersonId !== creation.approval.actorPersonId ||
    receipt.appliedByPersonId !== creation.approval.actorPersonId ||
    !equalCanonical(receipt.binding, creation.approval.binding) ||
    !equalCanonical(receipt.authority, creation.approval.authority) ||
    receipt.approvalConsumedAt < creation.approval.approvedAt ||
    receipt.approvalConsumedAt >= creation.approval.expiresAt ||
    new Set(ids).size !== ids.length ||
    new Set(hashes).size !== hashes.length
  ) {
    throw new Error(
      "Membership revocation receipt does not match its exact approval authority",
    );
  }
  if (
    (await hashWorkspaceMembershipRevocationReceipt(receipt)) !==
    receipt.receiptHash
  ) {
    throw new Error("Membership revocation receipt hash is invalid");
  }
  return receipt;
}

export type WorkspaceMembershipRevocationWorkSnapshot = z.infer<
  typeof workspaceMembershipRevocationWorkSnapshotSchema
>;
export type WorkspaceMembershipRevocationBinding = z.infer<
  typeof workspaceMembershipRevocationBindingSchema
>;
export type WorkspaceMembershipRevocationAuthority = z.infer<
  typeof workspaceMembershipRevocationAuthoritySchema
>;
export type WorkspaceMembershipRevocationApprovalRequest = z.infer<
  typeof workspaceMembershipRevocationApprovalRequestSchema
>;
export type WorkspaceMembershipRevocationApplyRequest = z.infer<
  typeof workspaceMembershipRevocationApplyRequestSchema
>;
export type WorkspaceMembershipRevocationApprovalCore = z.infer<
  typeof workspaceMembershipRevocationApprovalCoreSchema
>;
export type WorkspaceMembershipRevocationApproval = z.infer<
  typeof workspaceMembershipRevocationApprovalDocumentSchema
>;
export type WorkspaceMembershipRevocationApprovalReceipt = z.infer<
  typeof workspaceMembershipRevocationApprovalReceiptSchema
>;
export type WorkspaceMembershipRevocationApprovalCreation = z.infer<
  typeof workspaceMembershipRevocationApprovalCreationSchema
>;
export type WorkspaceMembershipRevocationReceipt = z.infer<
  typeof workspaceMembershipRevocationReceiptSchema
>;
