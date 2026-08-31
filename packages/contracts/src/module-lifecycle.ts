import { z } from "zod";

export type CanonicalModuleLifecycleJson =
  | null
  | boolean
  | string
  | number
  | CanonicalModuleLifecycleJson[]
  | { [key: string]: CanonicalModuleLifecycleJson };

export function canonicalModuleLifecycleJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        "Canonical lifecycle JSON numbers must be safe integers",
      );
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalModuleLifecycleJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical lifecycle JSON requires a plain object");
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );
    for (const [key, item] of entries) {
      if (!/^[\x20-\x7e]+$/.test(key) || item === undefined) {
        throw new TypeError(
          "Canonical lifecycle JSON requires ASCII keys and defined values",
        );
      }
    }
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalModuleLifecycleJson(item)}`,
      )
      .join(",")}}`;
  }
  throw new TypeError("Value is not canonical lifecycle JSON");
}

export async function moduleLifecycleCanonicalSha256(
  value: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalModuleLifecycleJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const objectKey = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9._/-]+$/)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        ),
    "must be a normalized relative object key",
  );
const utcMilliseconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime();

const receiptReferenceSchema = z
  .object({
    receiptId: uuid,
    receiptSha256: sha256,
  })
  .strict();

const backupTargetSchema = z
  .object({
    action: z.literal("backup"),
    backupId: uuid,
    storageObjectKey: objectKey,
    encryptionKeyBindingId: uuid,
  })
  .strict();

const recoveryTargetSchema = z
  .object({
    action: z.literal("recovery"),
    recoveryId: uuid,
    recoveryNamespace: identifier,
    backupReceipt: receiptReferenceSchema,
  })
  .strict();

const controlledDeletionTargetSchema = z
  .object({
    action: z.literal("deletion"),
    mode: z.literal("controlled-fixture"),
    rehearsalId: uuid,
    controlledFixtureId: uuid,
    productionDeletion: z.literal(false),
    noProductionRecords: z.literal(true),
    backupReceipt: receiptReferenceSchema,
    recoveryReceipt: receiptReferenceSchema,
    surfaces: z
      .object({
        database: z.literal(true),
        storage: z.literal(true),
        memory: z.literal(true),
        search: z.literal(true),
        backups: z.literal(true),
      })
      .strict(),
  })
  .strict();

const rollbackTargetSchema = z
  .object({
    action: z.literal("rollback"),
    rollbackId: uuid,
    rollbackNamespace: identifier,
    backupReceipt: receiptReferenceSchema,
    recoveryReceipt: receiptReferenceSchema,
    deletionRehearsalReceipt: receiptReferenceSchema,
  })
  .strict();

export const moduleLifecycleActionTargetSchema = z.discriminatedUnion(
  "action",
  [
    backupTargetSchema,
    recoveryTargetSchema,
    controlledDeletionTargetSchema,
    rollbackTargetSchema,
  ],
);

export const moduleLifecycleBindingSchema = z
  .object({
    vortonInstallationId: uuid,
    workspaceId: uuid,
    realm: z.enum(["personal", "organizational"]),
    module: identifier,
    sequence: z.number().int().safe().positive(),
    migrationPlanHash: sha256,
    sourceSnapshotSha256: sha256,
    targetPreimageSha256: sha256,
    targetPostimageSha256: sha256,
    target: moduleLifecycleActionTargetSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.targetPreimageSha256 === binding.targetPostimageSha256) {
      context.addIssue({
        code: "custom",
        path: ["targetPostimageSha256"],
        message: "Lifecycle preimage and postimage must differ",
      });
    }
  });

export const moduleLifecycleActionApprovalRequestSchema = z
  .object({
    approvalId: uuid,
    binding: moduleLifecycleBindingSchema,
    expiresAt: utcMilliseconds,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      prerequisiteReceipts(request.binding.target).some(
        (receipt) => receipt.receiptId === request.approvalId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["approvalId"],
        message:
          "Approval and prerequisite receipt identities must be distinct",
      });
    }
  });

const approvalScopeSchema = z
  .object({
    action: z.enum(["backup", "recovery", "deletion", "rollback"]),
    moduleOnly: z.literal(true),
    otherWorkspaceMutation: z.literal(false),
    productionDeletion: z.literal(false),
  })
  .strict();

const moduleLifecycleApprovalCoreShape = {
  contract: z.literal("vorton.module-lifecycle-action-approval.v1"),
  approvalId: uuid,
  approvalRecordId: uuid,
  approvalPlane: z.literal("workspace-postgres"),
  ownerPersonId: uuid,
  binding: moduleLifecycleBindingSchema,
  approvedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  workspaceMembershipVerifiedAt: utcMilliseconds,
  scope: approvalScopeSchema,
  rolesGrantAuthority: z.literal(false),
} as const;

function prerequisiteReceipts(
  target: z.infer<typeof moduleLifecycleActionTargetSchema>,
): Array<z.infer<typeof receiptReferenceSchema>> {
  switch (target.action) {
    case "recovery":
      return [target.backupReceipt];
    case "deletion":
      return [target.backupReceipt, target.recoveryReceipt];
    case "rollback":
      return [
        target.backupReceipt,
        target.recoveryReceipt,
        target.deletionRehearsalReceipt,
      ];
    default:
      return [];
  }
}

function validateApprovalCore(
  approval: z.infer<z.ZodObject<typeof moduleLifecycleApprovalCoreShape>>,
  context: z.RefinementCtx,
): void {
  const approvedAt = Date.parse(approval.approvedAt);
  const aal2At = Date.parse(approval.aal2VerifiedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (approval.scope.action !== approval.binding.target.action) {
    context.addIssue({
      code: "custom",
      path: ["scope", "action"],
      message: "Approval scope must match the exact lifecycle target",
    });
  }
  if (
    approval.workspaceMembershipVerifiedAt !== approval.approvedAt ||
    aal2At > approvedAt ||
    approvedAt - aal2At > 10 * 60 * 1_000 ||
    expiresAt <= approvedAt ||
    expiresAt > approvedAt + 24 * 60 * 60 * 1_000
  ) {
    context.addIssue({
      code: "custom",
      path: ["approvedAt"],
      message: "Lifecycle approval timestamps violate the authority window",
    });
  }
  const references = prerequisiteReceipts(approval.binding.target);
  const identities = [
    approval.approvalId,
    approval.approvalRecordId,
    ...references.map((receipt) => receipt.receiptId),
  ];
  if (
    new Set(identities).size !== identities.length ||
    new Set(references.map((receipt) => receipt.receiptSha256)).size !==
      references.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["approvalId"],
      message:
        "Approval, Record, and prerequisite receipt identities and digests must be distinct",
    });
  }
}

export const moduleLifecycleApprovalCoreSchema = z
  .object(moduleLifecycleApprovalCoreShape)
  .strict()
  .superRefine(validateApprovalCore);

export const moduleLifecycleActionApprovalDocumentSchema = z
  .object({
    ...moduleLifecycleApprovalCoreShape,
    approvalReceiptId: uuid,
    approvalReceiptSha256: sha256,
  })
  .strict()
  .superRefine((approval, context) => {
    validateApprovalCore(approval, context);
    const identities = [
      approval.approvalId,
      approval.approvalRecordId,
      approval.approvalReceiptId,
      ...prerequisiteReceipts(approval.binding.target).map(
        (receipt) => receipt.receiptId,
      ),
    ];
    const receiptDigests = [
      approval.approvalReceiptSha256,
      ...prerequisiteReceipts(approval.binding.target).map(
        (receipt) => receipt.receiptSha256,
      ),
    ];
    if (
      new Set(identities).size !== identities.length ||
      new Set(receiptDigests).size !== receiptDigests.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["approvalReceiptId"],
        message:
          "Approval, Record, and receipt identities and digests must be distinct",
      });
    }
  });

const approvalCreationEffectsSchema = z
  .object({
    actionExecuted: z.literal(false),
    approvalConsumed: z.literal(false),
    workspaceMutated: z.literal(false),
    moduleDataMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
  })
  .strict();

// approvalHash binds canonical JSON of moduleLifecycleApprovalCoreSchema.
// receiptHash binds canonical JSON of this receipt excluding only receiptHash.
export const moduleLifecycleApprovalReceiptSchema = z
  .object({
    contract: z.literal("vorton.module-lifecycle-approval-receipt.v1"),
    receiptId: uuid,
    receiptPlane: z.literal("workspace-postgres"),
    approvalId: uuid,
    approvalHash: sha256,
    binding: moduleLifecycleBindingSchema,
    action: z.enum(["backup", "recovery", "deletion", "rollback"]),
    vortonInstallationId: uuid,
    workspaceId: uuid,
    ownerPersonId: uuid,
    approvedAt: utcMilliseconds,
    createdAt: utcMilliseconds,
    liveMembershipCheckedAt: utcMilliseconds,
    aal2VerifiedAt: utcMilliseconds,
    assuranceLevel: z.literal("aal2"),
    effects: approvalCreationEffectsSchema,
    receiptHash: sha256,
  })
  .strict()
  .superRefine((receipt, context) => {
    const identities = [
      receipt.receiptId,
      receipt.approvalId,
      ...prerequisiteReceipts(receipt.binding.target).map(
        (reference) => reference.receiptId,
      ),
    ];
    if (
      new Set(identities).size !== identities.length ||
      receipt.action !== receipt.binding.target.action ||
      receipt.vortonInstallationId !== receipt.binding.vortonInstallationId ||
      receipt.workspaceId !== receipt.binding.workspaceId ||
      receipt.createdAt !== receipt.approvedAt ||
      receipt.liveMembershipCheckedAt !== receipt.approvedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["receiptId"],
        message: "Approval receipt projections do not match exact authority",
      });
    }
    const approvedAt = Date.parse(receipt.approvedAt);
    const aal2At = Date.parse(receipt.aal2VerifiedAt);
    if (aal2At > approvedAt || approvedAt - aal2At > 10 * 60 * 1_000) {
      context.addIssue({
        code: "custom",
        path: ["aal2VerifiedAt"],
        message: "Approval receipt does not bind recent AAL2",
      });
    }
  });

export const moduleLifecycleApprovalCreationSchema = z
  .object({
    approval: moduleLifecycleActionApprovalDocumentSchema,
    receipt: moduleLifecycleApprovalReceiptSchema,
  })
  .strict()
  .superRefine(({ approval, receipt }, context) => {
    if (
      approval.approvalReceiptId !== receipt.receiptId ||
      approval.approvalReceiptSha256 !== receipt.receiptHash ||
      approval.approvalId !== receipt.approvalId ||
      approval.ownerPersonId !== receipt.ownerPersonId ||
      approval.approvedAt !== receipt.approvedAt ||
      approval.aal2VerifiedAt !== receipt.aal2VerifiedAt ||
      approval.binding.vortonInstallationId !== receipt.vortonInstallationId ||
      approval.binding.workspaceId !== receipt.workspaceId ||
      approval.binding.target.action !== receipt.action ||
      canonicalModuleLifecycleJson(approval.binding) !==
        canonicalModuleLifecycleJson(receipt.binding)
    ) {
      context.addIssue({
        code: "custom",
        path: ["receipt"],
        message: "Approval and atomic creation receipt do not match",
      });
    }
  });

export function projectModuleLifecycleApprovalCore(
  value: unknown,
): ModuleLifecycleApprovalCore {
  const approval = moduleLifecycleActionApprovalDocumentSchema.parse(value);
  const {
    approvalReceiptId: _approvalReceiptId,
    approvalReceiptSha256: _approvalReceiptSha256,
    ...approvalCoreCandidate
  } = approval;
  return moduleLifecycleApprovalCoreSchema.parse(approvalCoreCandidate);
}

export async function hashModuleLifecycleApprovalCore(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectModuleLifecycleApprovalCore(value),
  );
}

export function projectModuleLifecycleApprovalReceiptCore(
  value: unknown,
): Omit<ModuleLifecycleApprovalReceipt, "receiptHash"> {
  const receipt = moduleLifecycleApprovalReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...receiptCore } = receipt;
  return receiptCore;
}

export async function hashModuleLifecycleApprovalReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectModuleLifecycleApprovalReceiptCore(value),
  );
}

export async function parseModuleLifecycleApprovalCreation(
  value: unknown,
): Promise<z.infer<typeof moduleLifecycleApprovalCreationSchema>> {
  const creation = moduleLifecycleApprovalCreationSchema.parse(value);
  if (
    (await hashModuleLifecycleApprovalCore(creation.approval)) !==
    creation.receipt.approvalHash
  ) {
    throw new Error("Lifecycle approval core hash does not match receipt");
  }
  if (
    (await hashModuleLifecycleApprovalReceipt(creation.receipt)) !==
    creation.receipt.receiptHash
  ) {
    throw new Error("Lifecycle approval receipt hash is invalid");
  }
  return creation;
}

const actionReceiptExecutorSchema = z
  .object({
    kind: z.literal("worker"),
    workerId: uuid,
    workId: uuid,
    policyId: uuid,
    admission: z
      .object({
        credentialId: uuid,
        capabilityGrantId: uuid,
        liveAuthorityCheckedAt: utcMilliseconds,
      })
      .strict(),
    finalization: z
      .object({
        credentialId: uuid,
        liveAuthorityCheckedAt: utcMilliseconds,
      })
      .strict(),
    rolesGrantAuthority: z.literal(false),
  })
  .strict();

const actionCommandExecutorSchema = z
  .object({
    kind: z.literal("worker"),
    workerId: uuid,
    workId: uuid,
    policyId: uuid,
    admission: z
      .object({
        credentialId: uuid,
        capabilityGrantId: uuid,
        liveAuthorityCheckedAt: utcMilliseconds,
      })
      .strict(),
    rolesGrantAuthority: z.literal(false),
  })
  .strict();

const backupPredecessorsSchema = z
  .object({ action: z.literal("backup") })
  .strict();
const recoveryPredecessorsSchema = z
  .object({ action: z.literal("recovery"), backup: receiptReferenceSchema })
  .strict();
const deletionPredecessorsSchema = z
  .object({
    action: z.literal("deletion"),
    backup: receiptReferenceSchema,
    recovery: receiptReferenceSchema,
  })
  .strict();
const rollbackPredecessorsSchema = z
  .object({
    action: z.literal("rollback"),
    backup: receiptReferenceSchema,
    recovery: receiptReferenceSchema,
    deletion: receiptReferenceSchema,
  })
  .strict();

export const moduleLifecycleActionPredecessorsSchema = z.discriminatedUnion(
  "action",
  [
    backupPredecessorsSchema,
    recoveryPredecessorsSchema,
    deletionPredecessorsSchema,
    rollbackPredecessorsSchema,
  ],
);

const succeededOutcomeSchema = z
  .object({ status: z.literal("succeeded"), code: z.literal("completed") })
  .strict();
const failedOutcomeSchema = z
  .object({
    status: z.literal("failed"),
    code: identifier,
    stage: z.enum(["execution", "verification", "reconciliation"]),
    retryDisposition: z.literal("new-approval-required"),
  })
  .strict();

export const moduleLifecycleActionOutcomeSchema = z.discriminatedUnion(
  "status",
  [succeededOutcomeSchema, failedOutcomeSchema],
);

const succeededEffectsSchema = z
  .object({
    approvalConsumed: z.literal(true),
    actionAttempted: z.literal(true),
    actionCompleted: z.literal(true),
    productionModuleDataMutated: z.literal(false),
    otherWorkspaceMutated: z.literal(false),
    mutationBoundary: z.enum([
      "workspace-backup-artifact",
      "isolated-recovery-namespace",
      "controlled-fixture",
      "isolated-rollback-namespace",
    ]),
  })
  .strict();
const failedEffectsSchema = z
  .object({
    approvalConsumed: z.literal(true),
    actionAttempted: z.literal(true),
    actionCompleted: z.literal(false),
    authorizedTargetMutation: z.enum(["none", "partial", "unknown"]),
    productionModuleDataMutation: z.enum(["none", "detected", "unknown"]),
    otherWorkspaceMutation: z.enum(["none", "detected", "unknown"]),
    quarantined: z.literal(true),
  })
  .strict();

export const moduleLifecycleActionEffectsSchema = z.union([
  succeededEffectsSchema,
  failedEffectsSchema,
]);

const backupSuccessEvidenceSchema = z
  .object({
    action: z.literal("backup"),
    capturedAt: utcMilliseconds,
    recordCount: z.number().int().safe().nonnegative(),
    capturedStateSha256: sha256,
    manifestSha256: sha256,
    encryptedArtifactSha256: sha256,
    encryptedAtRest: z.literal(true),
    workspaceKeyBound: z.literal(true),
    workspaceStorageBound: z.literal(true),
    otherWorkspaceAccessDenied: z.literal(true),
  })
  .strict();
const recoverySuccessEvidenceSchema = z
  .object({
    action: z.literal("recovery"),
    isolatedNamespaceSha256: sha256,
    restoredRecordCount: z.number().int().safe().nonnegative(),
    restoredStateSha256: sha256,
    productionNamespaceMutated: z.literal(false),
    otherWorkspaceMutationCount: z.literal(0),
    recoveryNamespaceDeleted: z.literal(true),
  })
  .strict();
const deletionSuccessEvidenceSchema = z
  .object({
    action: z.literal("deletion"),
    mode: z.literal("controlled-fixture"),
    controlledFixtureId: uuid,
    deletionManifestSha256: sha256,
    productionRecordsDeleted: z.literal(0),
    residualCounts: z
      .object({
        databaseRows: z.literal(0),
        storageObjects: z.literal(0),
        memoryFragments: z.literal(0),
        searchDocuments: z.literal(0),
        backupObjects: z.literal(0),
      })
      .strict(),
    postDeletionRetrievalDenied: z.literal(true),
    otherWorkspaceMutationCount: z.literal(0),
  })
  .strict();
const rollbackSuccessEvidenceSchema = z
  .object({
    action: z.literal("rollback"),
    fromPostimageSha256: sha256,
    restoredPreimageSha256: sha256,
    replayedPostimageSha256: sha256,
    productionNamespaceMutated: z.literal(false),
    otherWorkspaceMutationCount: z.literal(0),
    rollbackNamespaceDeleted: z.literal(true),
  })
  .strict();
const failureEvidenceSchema = z
  .object({
    action: z.enum(["backup", "recovery", "deletion", "rollback"]),
    failureEvidenceSha256: sha256,
    lastSafeCheckpoint: identifier,
  })
  .strict();

export const moduleLifecycleActionEvidenceSchema = z.union([
  backupSuccessEvidenceSchema,
  recoverySuccessEvidenceSchema,
  deletionSuccessEvidenceSchema,
  rollbackSuccessEvidenceSchema,
  failureEvidenceSchema,
]);

export const moduleLifecycleActionConsumeRequestSchema = z
  .object({
    commandId: uuid,
    workId: uuid,
    proofScope: z.enum(["controlled-synthetic", "workspace-production"]),
  })
  .strict();

export const moduleLifecycleActionFinalizeRequestSchema = z
  .object({
    receiptId: uuid,
    outcome: moduleLifecycleActionOutcomeSchema,
    effects: moduleLifecycleActionEffectsSchema,
    evidence: moduleLifecycleActionEvidenceSchema,
  })
  .strict();

const actionReceiptShape = {
  contract: z.literal("vorton.module-lifecycle-action-receipt.v1"),
  receiptId: uuid,
  receiptPlane: z.literal("workspace-postgres"),
  commandId: uuid,
  commandHash: sha256,
  idempotencyKey: uuid,
  approvalId: uuid,
  approvalReceiptId: uuid,
  approvalReceiptSha256: sha256,
  approvalHash: sha256,
  binding: moduleLifecycleBindingSchema,
  action: z.enum(["backup", "recovery", "deletion", "rollback"]),
  vortonInstallationId: uuid,
  workspaceId: uuid,
  ownerPersonId: uuid,
  proofScope: z.enum(["controlled-synthetic", "workspace-production"]),
  executor: actionReceiptExecutorSchema,
  approvalConsumptionCount: z.literal(1),
  consumedAt: utcMilliseconds,
  executedAt: utcMilliseconds,
  predecessorReceipts: moduleLifecycleActionPredecessorsSchema,
  outcome: moduleLifecycleActionOutcomeSchema,
  effects: moduleLifecycleActionEffectsSchema,
  evidence: moduleLifecycleActionEvidenceSchema,
} as const;

const actionCommandEffectsSchema = z
  .object({
    approvalConsumed: z.literal(true),
    actionExecuted: z.literal(false),
    workspaceMutated: z.literal(false),
    moduleDataMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
  })
  .strict();

function receiptReferences(
  predecessors: z.infer<typeof moduleLifecycleActionPredecessorsSchema>,
): Array<z.infer<typeof receiptReferenceSchema>> {
  switch (predecessors.action) {
    case "recovery":
      return [predecessors.backup];
    case "deletion":
      return [predecessors.backup, predecessors.recovery];
    case "rollback":
      return [
        predecessors.backup,
        predecessors.recovery,
        predecessors.deletion,
      ];
    default:
      return [];
  }
}

function expectedMutationBoundary(
  action: z.infer<typeof moduleLifecycleActionPredecessorsSchema>["action"],
): z.infer<typeof succeededEffectsSchema>["mutationBoundary"] {
  switch (action) {
    case "backup":
      return "workspace-backup-artifact";
    case "recovery":
      return "isolated-recovery-namespace";
    case "deletion":
      return "controlled-fixture";
    case "rollback":
      return "isolated-rollback-namespace";
  }
}

function exactTargetPredecessors(
  binding: z.infer<typeof moduleLifecycleBindingSchema>,
): z.infer<typeof moduleLifecycleActionPredecessorsSchema> {
  switch (binding.target.action) {
    case "backup":
      return { action: "backup" };
    case "recovery":
      return { action: "recovery", backup: binding.target.backupReceipt };
    case "deletion":
      return {
        action: "deletion",
        backup: binding.target.backupReceipt,
        recovery: binding.target.recoveryReceipt,
      };
    case "rollback":
      return {
        action: "rollback",
        backup: binding.target.backupReceipt,
        recovery: binding.target.recoveryReceipt,
        deletion: binding.target.deletionRehearsalReceipt,
      };
  }
}

export const moduleLifecycleActionReceiptSchema = z
  .object({ ...actionReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const refs = receiptReferences(receipt.predecessorReceipts);
    const ids = [
      receipt.approvalId,
      receipt.approvalReceiptId,
      receipt.commandId,
      receipt.receiptId,
      ...refs.map((reference) => reference.receiptId),
    ];
    const hashes = [
      receipt.approvalHash,
      receipt.approvalReceiptSha256,
      receipt.commandHash,
      receipt.receiptHash,
      ...refs.map((reference) => reference.receiptSha256),
    ];
    const commonMismatch =
      receipt.action !== receipt.binding.target.action ||
      receipt.action !== receipt.predecessorReceipts.action ||
      receipt.action !== receipt.evidence.action ||
      receipt.idempotencyKey !== receipt.commandId ||
      receipt.vortonInstallationId !== receipt.binding.vortonInstallationId ||
      receipt.workspaceId !== receipt.binding.workspaceId ||
      (receipt.action === "deletion" &&
        receipt.proofScope !== "controlled-synthetic") ||
      receipt.executedAt < receipt.consumedAt ||
      receipt.executor.admission.liveAuthorityCheckedAt !==
        receipt.consumedAt ||
      receipt.executor.finalization.liveAuthorityCheckedAt !==
        receipt.executedAt ||
      (receipt.action === "backup" &&
        "capturedAt" in receipt.evidence &&
        (receipt.evidence.capturedAt < receipt.consumedAt ||
          receipt.evidence.capturedAt > receipt.executedAt)) ||
      canonicalModuleLifecycleJson(receipt.predecessorReceipts) !==
        canonicalModuleLifecycleJson(
          exactTargetPredecessors(receipt.binding),
        ) ||
      new Set(ids).size !== ids.length ||
      new Set(hashes).size !== hashes.length;
    if (commonMismatch) {
      context.addIssue({
        code: "custom",
        path: ["receiptId"],
        message:
          "Action receipt does not bind exact authority and predecessors",
      });
    }

    if (receipt.outcome.status === "succeeded") {
      if (
        !receipt.effects.actionCompleted ||
        !("mutationBoundary" in receipt.effects) ||
        receipt.effects.mutationBoundary !==
          expectedMutationBoundary(receipt.action)
      ) {
        context.addIssue({
          code: "custom",
          path: ["effects"],
          message: "Successful action effects do not match the action boundary",
        });
      }
      if (
        (receipt.action === "backup" &&
          (!("capturedStateSha256" in receipt.evidence) ||
            receipt.evidence.capturedStateSha256 !==
              receipt.binding.targetPreimageSha256 ||
            new Set([
              receipt.evidence.capturedStateSha256,
              receipt.evidence.manifestSha256,
              receipt.evidence.encryptedArtifactSha256,
            ]).size !== 3)) ||
        (receipt.action === "recovery" &&
          (!("restoredStateSha256" in receipt.evidence) ||
            receipt.evidence.restoredStateSha256 !==
              receipt.binding.targetPreimageSha256)) ||
        (receipt.action === "deletion" &&
          (!("controlledFixtureId" in receipt.evidence) ||
            receipt.binding.target.action !== "deletion" ||
            receipt.evidence.controlledFixtureId !==
              receipt.binding.target.controlledFixtureId)) ||
        (receipt.action === "rollback" &&
          (!("fromPostimageSha256" in receipt.evidence) ||
            receipt.evidence.fromPostimageSha256 !==
              receipt.binding.targetPostimageSha256 ||
            receipt.evidence.restoredPreimageSha256 !==
              receipt.binding.targetPreimageSha256 ||
            receipt.evidence.replayedPostimageSha256 !==
              receipt.binding.targetPostimageSha256))
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message:
            "Successful action evidence does not match the exact binding",
        });
      }
    } else if (
      receipt.effects.actionCompleted ||
      !("quarantined" in receipt.effects) ||
      !("failureEvidenceSha256" in receipt.evidence)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message:
          "Failed actions must be terminal, quarantined, and require a new approval",
      });
    }
  });

const actionCommandShape = {
  contract: z.literal("vorton.module-lifecycle-action-command.v1"),
  commandId: uuid,
  commandPlane: z.literal("workspace-postgres"),
  approvalId: uuid,
  approvalReceiptId: uuid,
  approvalReceiptSha256: sha256,
  approvalHash: sha256,
  binding: moduleLifecycleBindingSchema,
  action: z.enum(["backup", "recovery", "deletion", "rollback"]),
  vortonInstallationId: uuid,
  workspaceId: uuid,
  ownerPersonId: uuid,
  proofScope: z.enum(["controlled-synthetic", "workspace-production"]),
  executor: actionCommandExecutorSchema,
  approvalConsumptionCount: z.literal(1),
  consumedAt: utcMilliseconds,
  idempotencyKey: uuid,
  predecessorReceipts: moduleLifecycleActionPredecessorsSchema,
  effects: actionCommandEffectsSchema,
} as const;

export const moduleLifecycleActionCommandSchema = z
  .object({ ...actionCommandShape, commandHash: sha256 })
  .strict()
  .superRefine((command, context) => {
    const refs = receiptReferences(command.predecessorReceipts);
    const ids = [
      command.approvalId,
      command.approvalReceiptId,
      command.commandId,
      ...refs.map((reference) => reference.receiptId),
    ];
    const hashes = [
      command.approvalHash,
      command.approvalReceiptSha256,
      command.commandHash,
      ...refs.map((reference) => reference.receiptSha256),
    ];
    if (
      command.idempotencyKey !== command.commandId ||
      command.action !== command.binding.target.action ||
      command.action !== command.predecessorReceipts.action ||
      command.vortonInstallationId !== command.binding.vortonInstallationId ||
      command.workspaceId !== command.binding.workspaceId ||
      (command.action === "deletion" &&
        command.proofScope !== "controlled-synthetic") ||
      command.executor.admission.liveAuthorityCheckedAt !==
        command.consumedAt ||
      canonicalModuleLifecycleJson(command.predecessorReceipts) !==
        canonicalModuleLifecycleJson(
          exactTargetPredecessors(command.binding),
        ) ||
      new Set(ids).size !== ids.length ||
      new Set(hashes).size !== hashes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["commandId"],
        message: "Action command does not bind exact consumed authority",
      });
    }
  });

export function projectModuleLifecycleActionCommandCore(
  value: unknown,
): Omit<ModuleLifecycleActionCommand, "commandHash"> {
  const command = moduleLifecycleActionCommandSchema.parse(value);
  const { commandHash: _commandHash, ...core } = command;
  return core;
}

export async function hashModuleLifecycleActionCommand(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectModuleLifecycleActionCommandCore(value),
  );
}

export const moduleLifecycleActionCommandCreationSchema = z
  .object({
    approval: moduleLifecycleActionApprovalDocumentSchema,
    approvalReceipt: moduleLifecycleApprovalReceiptSchema,
    command: moduleLifecycleActionCommandSchema,
  })
  .strict();

export async function parseModuleLifecycleActionCommandCreation(
  value: unknown,
): Promise<ModuleLifecycleActionCommandCreation> {
  const creation = moduleLifecycleActionCommandCreationSchema.parse(value);
  await parseModuleLifecycleApprovalCreation({
    approval: creation.approval,
    receipt: creation.approvalReceipt,
  });
  const approvalHash = await hashModuleLifecycleApprovalCore(creation.approval);
  const approvalReceiptHash = await hashModuleLifecycleApprovalReceipt(
    creation.approvalReceipt,
  );
  const command = creation.command;
  const commandReferences = receiptReferences(command.predecessorReceipts);
  const commandIdentities = [
    creation.approval.approvalId,
    creation.approval.approvalRecordId,
    creation.approval.approvalReceiptId,
    command.commandId,
    ...commandReferences.map((reference) => reference.receiptId),
  ];
  const commandHashes = [
    approvalHash,
    approvalReceiptHash,
    command.commandHash,
    ...commandReferences.map((reference) => reference.receiptSha256),
  ];
  if (
    approvalHash !== command.approvalHash ||
    approvalReceiptHash !== command.approvalReceiptSha256 ||
    creation.approval.approvalId !== command.approvalId ||
    creation.approval.approvalReceiptId !== command.approvalReceiptId ||
    creation.approval.ownerPersonId !== command.ownerPersonId ||
    new Set(commandIdentities).size !== commandIdentities.length ||
    new Set(commandHashes).size !== commandHashes.length ||
    canonicalModuleLifecycleJson(creation.approval.binding) !==
      canonicalModuleLifecycleJson(command.binding) ||
    command.consumedAt < creation.approval.approvedAt ||
    command.consumedAt >= creation.approval.expiresAt
  ) {
    throw new Error(
      "Lifecycle action command does not match its approval authority",
    );
  }
  if (
    (await hashModuleLifecycleActionCommand(command)) !== command.commandHash
  ) {
    throw new Error("Lifecycle action command hash is invalid");
  }
  return creation;
}

export function projectModuleLifecycleActionReceiptCore(
  value: unknown,
): Omit<ModuleLifecycleActionReceipt, "receiptHash"> {
  const receipt = moduleLifecycleActionReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashModuleLifecycleActionReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectModuleLifecycleActionReceiptCore(value),
  );
}

export async function parseModuleLifecycleActionReceipt(
  value: unknown,
): Promise<ModuleLifecycleActionReceipt> {
  const receipt = moduleLifecycleActionReceiptSchema.parse(value);
  if (
    (await hashModuleLifecycleActionReceipt(receipt)) !== receipt.receiptHash
  ) {
    throw new Error("Lifecycle action receipt hash is invalid");
  }
  return receipt;
}

const actionReceiptDocumentsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("backup") }).strict(),
  z
    .object({
      action: z.literal("recovery"),
      backup: moduleLifecycleActionReceiptSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("deletion"),
      backup: moduleLifecycleActionReceiptSchema,
      recovery: moduleLifecycleActionReceiptSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("rollback"),
      backup: moduleLifecycleActionReceiptSchema,
      recovery: moduleLifecycleActionReceiptSchema,
      deletion: moduleLifecycleActionReceiptSchema,
    })
    .strict(),
]);

export const moduleLifecycleActionCompletionSchema = z
  .object({
    approval: moduleLifecycleActionApprovalDocumentSchema,
    approvalReceipt: moduleLifecycleApprovalReceiptSchema,
    command: moduleLifecycleActionCommandSchema,
    predecessorReceiptDocuments: actionReceiptDocumentsSchema,
    actionReceipt: moduleLifecycleActionReceiptSchema,
  })
  .strict();

function actionReceiptDocumentEntries(
  documents: z.infer<typeof actionReceiptDocumentsSchema>,
): Array<[string, ModuleLifecycleActionReceipt]> {
  switch (documents.action) {
    case "recovery":
      return [["backup", documents.backup]];
    case "deletion":
      return [
        ["backup", documents.backup],
        ["recovery", documents.recovery],
      ];
    case "rollback":
      return [
        ["backup", documents.backup],
        ["recovery", documents.recovery],
        ["deletion", documents.deletion],
      ];
    default:
      return [];
  }
}

export async function parseModuleLifecycleActionCompletion(
  value: unknown,
): Promise<ModuleLifecycleActionCompletion> {
  const completion = moduleLifecycleActionCompletionSchema.parse(value);
  await parseModuleLifecycleApprovalCreation({
    approval: completion.approval,
    receipt: completion.approvalReceipt,
  });
  await parseModuleLifecycleActionCommandCreation({
    approval: completion.approval,
    approvalReceipt: completion.approvalReceipt,
    command: completion.command,
  });
  const approvalHash = await hashModuleLifecycleApprovalCore(
    completion.approval,
  );
  const approvalReceiptHash = await hashModuleLifecycleApprovalReceipt(
    completion.approvalReceipt,
  );
  const receipt = completion.actionReceipt;
  const actionReferences = receiptReferences(receipt.predecessorReceipts);
  const actionIdentities = [
    completion.approval.approvalId,
    completion.approval.approvalRecordId,
    completion.approval.approvalReceiptId,
    completion.command.commandId,
    receipt.receiptId,
    ...actionReferences.map((reference) => reference.receiptId),
  ];
  const actionHashes = [
    approvalHash,
    approvalReceiptHash,
    completion.command.commandHash,
    receipt.receiptHash,
    ...actionReferences.map((reference) => reference.receiptSha256),
  ];
  if (
    approvalHash !== receipt.approvalHash ||
    approvalReceiptHash !== receipt.approvalReceiptSha256 ||
    completion.approval.approvalId !== receipt.approvalId ||
    completion.approval.approvalReceiptId !== receipt.approvalReceiptId ||
    completion.approval.ownerPersonId !== receipt.ownerPersonId ||
    completion.command.commandId !== receipt.commandId ||
    completion.command.commandHash !== receipt.commandHash ||
    completion.command.idempotencyKey !== receipt.idempotencyKey ||
    completion.command.consumedAt !== receipt.consumedAt ||
    completion.command.action !== receipt.action ||
    completion.command.vortonInstallationId !== receipt.vortonInstallationId ||
    completion.command.workspaceId !== receipt.workspaceId ||
    completion.command.ownerPersonId !== receipt.ownerPersonId ||
    completion.command.proofScope !== receipt.proofScope ||
    completion.command.executor.workerId !== receipt.executor.workerId ||
    completion.command.executor.workId !== receipt.executor.workId ||
    completion.command.executor.policyId !== receipt.executor.policyId ||
    new Set(actionIdentities).size !== actionIdentities.length ||
    new Set(actionHashes).size !== actionHashes.length ||
    canonicalModuleLifecycleJson(completion.command.executor.admission) !==
      canonicalModuleLifecycleJson(receipt.executor.admission) ||
    canonicalModuleLifecycleJson(completion.command.binding) !==
      canonicalModuleLifecycleJson(receipt.binding) ||
    canonicalModuleLifecycleJson(completion.command.predecessorReceipts) !==
      canonicalModuleLifecycleJson(receipt.predecessorReceipts) ||
    canonicalModuleLifecycleJson(completion.approval.binding) !==
      canonicalModuleLifecycleJson(receipt.binding) ||
    completion.predecessorReceiptDocuments.action !== receipt.action ||
    receipt.consumedAt < completion.approval.approvedAt ||
    receipt.consumedAt >= completion.approval.expiresAt
  ) {
    throw new Error(
      "Lifecycle action receipt does not match its approval authority",
    );
  }
  await parseModuleLifecycleActionReceipt(receipt);
  const refs = receipt.predecessorReceipts as Record<string, unknown>;
  for (const [key, document] of actionReceiptDocumentEntries(
    completion.predecessorReceiptDocuments,
  )) {
    const reference = refs[key] as z.infer<typeof receiptReferenceSchema>;
    if (
      document.outcome.status !== "succeeded" ||
      document.action !== key ||
      document.receiptId !== reference.receiptId ||
      document.receiptHash !== reference.receiptSha256 ||
      (await hashModuleLifecycleActionReceipt(document)) !==
        document.receiptHash ||
      document.vortonInstallationId !== receipt.vortonInstallationId ||
      document.workspaceId !== receipt.workspaceId ||
      document.binding.realm !== receipt.binding.realm ||
      document.binding.module !== receipt.binding.module ||
      document.binding.sequence !== receipt.binding.sequence ||
      document.binding.migrationPlanHash !==
        receipt.binding.migrationPlanHash ||
      document.binding.sourceSnapshotSha256 !==
        receipt.binding.sourceSnapshotSha256 ||
      document.binding.targetPreimageSha256 !==
        receipt.binding.targetPreimageSha256 ||
      document.binding.targetPostimageSha256 !==
        receipt.binding.targetPostimageSha256 ||
      document.executedAt > receipt.consumedAt
    ) {
      throw new Error("Lifecycle predecessor receipt chain is invalid");
    }
  }
  const predecessorDocuments = completion.predecessorReceiptDocuments;
  if (
    predecessorDocuments.action === "deletion" &&
    (predecessorDocuments.recovery.predecessorReceipts.action !== "recovery" ||
      canonicalModuleLifecycleJson(
        predecessorDocuments.recovery.predecessorReceipts.backup,
      ) !==
        canonicalModuleLifecycleJson({
          receiptId: predecessorDocuments.backup.receiptId,
          receiptSha256: predecessorDocuments.backup.receiptHash,
        }))
  ) {
    throw new Error("Lifecycle predecessor receipt chain is invalid");
  }
  if (
    (predecessorDocuments.action === "recovery" &&
      predecessorDocuments.backup.proofScope !== receipt.proofScope) ||
    (predecessorDocuments.action === "deletion" &&
      predecessorDocuments.backup.proofScope !==
        predecessorDocuments.recovery.proofScope) ||
    (predecessorDocuments.action === "rollback" &&
      (predecessorDocuments.backup.proofScope !== receipt.proofScope ||
        predecessorDocuments.recovery.proofScope !== receipt.proofScope ||
        predecessorDocuments.deletion.proofScope !== "controlled-synthetic"))
  ) {
    throw new Error("Lifecycle predecessor proof scopes are incompatible");
  }
  if (predecessorDocuments.action === "rollback") {
    const recoveryPredecessors =
      predecessorDocuments.recovery.predecessorReceipts;
    const deletionPredecessors =
      predecessorDocuments.deletion.predecessorReceipts;
    const exactBackup = {
      receiptId: predecessorDocuments.backup.receiptId,
      receiptSha256: predecessorDocuments.backup.receiptHash,
    };
    const exactRecovery = {
      receiptId: predecessorDocuments.recovery.receiptId,
      receiptSha256: predecessorDocuments.recovery.receiptHash,
    };
    if (
      recoveryPredecessors.action !== "recovery" ||
      deletionPredecessors.action !== "deletion" ||
      canonicalModuleLifecycleJson(recoveryPredecessors.backup) !==
        canonicalModuleLifecycleJson(exactBackup) ||
      canonicalModuleLifecycleJson(deletionPredecessors.backup) !==
        canonicalModuleLifecycleJson(exactBackup) ||
      canonicalModuleLifecycleJson(deletionPredecessors.recovery) !==
        canonicalModuleLifecycleJson(exactRecovery)
    ) {
      throw new Error("Lifecycle predecessor receipt chain is invalid");
    }
  }
  if (
    (predecessorDocuments.action === "deletion" ||
      predecessorDocuments.action === "rollback") &&
    "recordCount" in predecessorDocuments.backup.evidence &&
    "restoredRecordCount" in predecessorDocuments.recovery.evidence &&
    predecessorDocuments.backup.evidence.recordCount !==
      predecessorDocuments.recovery.evidence.restoredRecordCount
  ) {
    throw new Error(
      "Lifecycle predecessor recovery count does not match backup",
    );
  }
  if (
    receipt.action === "recovery" &&
    completion.predecessorReceiptDocuments.action === "recovery" &&
    "restoredRecordCount" in receipt.evidence &&
    "recordCount" in completion.predecessorReceiptDocuments.backup.evidence &&
    receipt.evidence.restoredRecordCount !==
      completion.predecessorReceiptDocuments.backup.evidence.recordCount
  ) {
    throw new Error("Lifecycle recovery record count does not match backup");
  }
  return completion;
}

export type ModuleLifecycleActionTarget = z.infer<
  typeof moduleLifecycleActionTargetSchema
>;
export type ModuleLifecycleActionApprovalRequest = z.infer<
  typeof moduleLifecycleActionApprovalRequestSchema
>;
export type ModuleLifecycleActionApprovalDocument = z.infer<
  typeof moduleLifecycleActionApprovalDocumentSchema
>;
export type ModuleLifecycleApprovalCore = z.infer<
  typeof moduleLifecycleApprovalCoreSchema
>;
export type ModuleLifecycleApprovalReceipt = z.infer<
  typeof moduleLifecycleApprovalReceiptSchema
>;
export type ModuleLifecycleApprovalCreation = z.infer<
  typeof moduleLifecycleApprovalCreationSchema
>;
export type ModuleLifecycleActionPredecessors = z.infer<
  typeof moduleLifecycleActionPredecessorsSchema
>;
export type ModuleLifecycleActionOutcome = z.infer<
  typeof moduleLifecycleActionOutcomeSchema
>;
export type ModuleLifecycleActionEffects = z.infer<
  typeof moduleLifecycleActionEffectsSchema
>;
export type ModuleLifecycleActionEvidence = z.infer<
  typeof moduleLifecycleActionEvidenceSchema
>;
export type ModuleLifecycleActionConsumeRequest = z.infer<
  typeof moduleLifecycleActionConsumeRequestSchema
>;
export type ModuleLifecycleActionFinalizeRequest = z.infer<
  typeof moduleLifecycleActionFinalizeRequestSchema
>;
export type ModuleLifecycleActionReceipt = z.infer<
  typeof moduleLifecycleActionReceiptSchema
>;
export type ModuleLifecycleActionCommand = z.infer<
  typeof moduleLifecycleActionCommandSchema
>;
export type ModuleLifecycleActionCommandCreation = z.infer<
  typeof moduleLifecycleActionCommandCreationSchema
>;
export type ModuleLifecycleActionCompletion = z.infer<
  typeof moduleLifecycleActionCompletionSchema
>;
