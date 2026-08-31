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
