import { z } from "zod";

import { adoptedReleaseProjectionSchema } from "./installation-authority.js";
import {
  canonicalWorkspaceCoreSurfaceSelectionJson,
  hashWorkspaceCoreSurface,
  workspaceCompiledCoreSurfaceRegistrySha256,
  workspaceCoreSurfaceSchema,
} from "./workspace-core-surface-selection.js";
import { moduleLifecycleCanonicalSha256 } from "./module-lifecycle.js";

/**
 * Narrow installation-scoped compatibility authority for core surfaces already
 * compiled into an adopted Vorton release. Historical presentation values are
 * represented only by opaque preimage hashes. These contracts do not install a
 * release, admit a module, load an artifact, start a runtime, or borrow any
 * workspace's authority.
 */

const canonicalUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const realm = z.enum(["personal", "organizational"]);
const utcMilliseconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime()
  .refine(
    (value) => new Date(value).toISOString() === value,
    "must be a canonical UTC millisecond timestamp",
  );

function milliseconds(value: string): number {
  return Date.parse(value);
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return (
    canonicalWorkspaceCoreSurfaceSelectionJson(left) ===
    canonicalWorkspaceCoreSurfaceSelectionJson(right)
  );
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function isCanonicallySorted(values: string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

export const canonicalInstallationCoreSurfaceReconciliationJson =
  canonicalWorkspaceCoreSurfaceSelectionJson;
export const installationCoreSurfaceReconciliationCanonicalSha256 =
  moduleLifecycleCanonicalSha256;

export const installationCoreSurfaceReconciliationReceiptReferenceSchema = z
  .object({
    receiptId: canonicalUuid,
    receiptSha256: sha256,
  })
  .strict();

const workspaceCoreSurfaceLineageSchema = z
  .object({
    contract: z.enum([
      "vorton.workspace-core-surface-selection-receipt.v1",
      "vorton.workspace-core-surface-reconciliation-receipt.v1",
    ]),
    receiptId: canonicalUuid,
    receiptSha256: sha256,
  })
  .strict();

export const installationCoreSurfaceInventoryEntrySchema = z
  .object({
    workspaceId: canonicalUuid,
    realm,
    state: z.enum(["unconfigured", "selected", "legacy-unreceipted"]),
    moduleCount: z.number().int().safe().min(0).max(7),
    surfaceSha256: sha256,
    lineage: workspaceCoreSurfaceLineageSchema.nullable(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.state === "unconfigured" &&
      (entry.moduleCount !== 0 || entry.lineage !== null)
    ) {
      addIssue(
        context,
        ["state"],
        "An unconfigured workspace must have an empty, unreceipted surface",
      );
    }
    if (
      entry.state === "selected" &&
      (entry.moduleCount === 0 || entry.lineage === null)
    ) {
      addIssue(
        context,
        ["state"],
        "A selected surface must be nonempty and receipt-backed",
      );
    }
    if (
      entry.state === "legacy-unreceipted" &&
      (entry.moduleCount === 0 || entry.lineage !== null)
    ) {
      addIssue(
        context,
        ["state"],
        "A legacy compatibility surface must be nonempty and unreceipted",
      );
    }
  });

const inventoryCoreSchema = z
  .object({
    workspaceCount: z.number().int().safe().positive(),
    unconfiguredWorkspaceCount: z.number().int().safe().min(0),
    selectedWorkspaceCount: z.number().int().safe().min(0),
    legacyWorkspaceCount: z.number().int().safe().min(0),
    entries: z.array(installationCoreSurfaceInventoryEntrySchema).min(1),
  })
  .strict()
  .superRefine((inventory, context) => {
    const workspaceIds = inventory.entries.map((entry) => entry.workspaceId);
    const unconfigured = inventory.entries.filter(
      (entry) => entry.state === "unconfigured",
    ).length;
    const selected = inventory.entries.filter(
      (entry) => entry.state === "selected",
    ).length;
    const legacy = inventory.entries.filter(
      (entry) => entry.state === "legacy-unreceipted",
    ).length;
    if (
      !isCanonicallySorted(workspaceIds) ||
      inventory.workspaceCount !== inventory.entries.length ||
      inventory.unconfiguredWorkspaceCount !== unconfigured ||
      inventory.selectedWorkspaceCount !== selected ||
      inventory.legacyWorkspaceCount !== legacy
    ) {
      addIssue(
        context,
        ["entries"],
        "Inventory must be complete, unique, sorted, and count-consistent",
      );
    }
  });

export const installationCoreSurfaceInventorySchema = z
  .object({
    ...inventoryCoreSchema.shape,
    inventorySha256: sha256,
  })
  .strict()
  .superRefine((inventory, context) => {
    const { inventorySha256: _inventorySha256, ...core } = inventory;
    const result = inventoryCoreSchema.safeParse(core);
    if (!result.success) {
      for (const issue of result.error.issues) {
        addIssue(context, issue.path, issue.message);
      }
    }
  });

export const installationCoreSurfaceTransitionSchema = z
  .object({
    workspaceId: canonicalUuid,
    realm,
    preimageModuleCount: z.number().int().safe().positive().max(7),
    preimageSurfaceSha256: sha256,
    targetSurface: workspaceCoreSurfaceSchema,
    targetSurfaceSha256: sha256,
  })
  .strict()
  .superRefine((transition, context) => {
    if (
      transition.targetSurface.modules.length === 0 ||
      transition.preimageSurfaceSha256 === transition.targetSurfaceSha256
    ) {
      addIssue(
        context,
        ["targetSurface"],
        "Compatibility reconciliation must replace a nonempty legacy surface with a changed generic surface",
      );
    }
  });

export const installationCoreSurfaceReconciliationLimitsSchema = z
  .object({
    compiledCoreSurfaceCompatibilityOnly: z.literal(true),
    workspaceProjectionMetadataRead: z.literal(true),
    workspaceProjectionMutated: z.literal(true),
    workspaceLineageMutated: z.literal(true),
    installationLineageMutated: z.literal(true),
    releaseInstalled: z.literal(false),
    releaseAdopted: z.literal(false),
    workspaceCreated: z.literal(false),
    workspaceAuthorityBorrowed: z.literal(false),
    workspaceBusinessDataRead: z.literal(false),
    workspaceBusinessDataMutated: z.literal(false),
    personalDataRead: z.literal(false),
    artifactResolved: z.literal(false),
    artifactLoaded: z.literal(false),
    moduleRuntimeStarted: z.literal(false),
    moduleAdmitted: z.literal(false),
    moduleMigrated: z.literal(false),
    infrastructureMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
    privateConsumerAuthorityGranted: z.literal(false),
  })
  .strict();

const planCoreShape = {
  contract: z.literal(
    "vorton.installation-core-surface-reconciliation-plan.v1",
  ),
  operation: z.literal("reconcile-legacy-compiled-core-surfaces"),
  vortonInstallationId: canonicalUuid,
  targetRelease: adoptedReleaseProjectionSchema,
  compiledRegistrySha256: z.literal(workspaceCompiledCoreSurfaceRegistrySha256),
  legacyProjectionContractSha256: sha256,
  predecessorReconciliationReceipt:
    installationCoreSurfaceReconciliationReceiptReferenceSchema.nullable(),
  inventory: installationCoreSurfaceInventorySchema,
  transitions: z.array(installationCoreSurfaceTransitionSchema).min(1),
  transitionSetSha256: sha256,
  limits: installationCoreSurfaceReconciliationLimitsSchema,
} as const;

type PlanCoreCandidate = z.infer<z.ZodObject<typeof planCoreShape>>;

function validatePlanCore(
  plan: PlanCoreCandidate,
  context: z.RefinementCtx,
): void {
  const transitionWorkspaceIds = plan.transitions.map(
    (transition) => transition.workspaceId,
  );
  const legacyEntries = plan.inventory.entries.filter(
    (entry) => entry.state === "legacy-unreceipted",
  );
  if (
    !isCanonicallySorted(transitionWorkspaceIds) ||
    plan.transitions.length !== legacyEntries.length
  ) {
    addIssue(
      context,
      ["transitions"],
      "Transitions must be sorted and cover every legacy workspace exactly once",
    );
    return;
  }
  for (const [index, transition] of plan.transitions.entries()) {
    const inventoryEntry = legacyEntries[index];
    if (
      !inventoryEntry ||
      transition.workspaceId !== inventoryEntry.workspaceId ||
      transition.realm !== inventoryEntry.realm ||
      transition.preimageModuleCount !== inventoryEntry.moduleCount ||
      transition.preimageSurfaceSha256 !== inventoryEntry.surfaceSha256
    ) {
      addIssue(
        context,
        ["transitions", index],
        "Transition does not match its complete inventory preimage",
      );
    }
  }
  const authorityIds = [
    plan.targetRelease.adoptionReceiptId,
    ...plan.inventory.entries.flatMap((entry) =>
      entry.lineage ? [entry.lineage.receiptId] : [],
    ),
    ...(plan.predecessorReconciliationReceipt
      ? [plan.predecessorReconciliationReceipt.receiptId]
      : []),
  ];
  if (new Set(authorityIds).size !== authorityIds.length) {
    addIssue(
      context,
      ["transitions"],
      "Release, predecessor, and workspace receipt identities must be distinct",
    );
  }
}

export const installationCoreSurfaceReconciliationPlanCoreSchema = z
  .object(planCoreShape)
  .strict()
  .superRefine(validatePlanCore);

export const installationCoreSurfaceReconciliationPlanSchema = z
  .object({ ...planCoreShape, planHash: sha256 })
  .strict()
  .superRefine(validatePlanCore);

export function projectInstallationCoreSurfaceInventoryCore(
  value: unknown,
): z.infer<typeof inventoryCoreSchema> {
  const inventory = installationCoreSurfaceInventorySchema.parse(value);
  const { inventorySha256: _inventorySha256, ...core } = inventory;
  return inventoryCoreSchema.parse(core);
}

export async function hashInstallationCoreSurfaceInventory(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectInstallationCoreSurfaceInventoryCore(value),
  );
}

export async function hashInstallationCoreSurfaceTransitionSet(
  value: unknown,
): Promise<string> {
  const transitions = z
    .array(installationCoreSurfaceTransitionSchema)
    .min(1)
    .parse(value);
  return moduleLifecycleCanonicalSha256(transitions);
}

export function projectInstallationCoreSurfaceReconciliationPlanCore(
  value: unknown,
): InstallationCoreSurfaceReconciliationPlanCore {
  const plan = installationCoreSurfaceReconciliationPlanSchema.parse(value);
  const { planHash: _planHash, ...core } = plan;
  return installationCoreSurfaceReconciliationPlanCoreSchema.parse(core);
}

export async function hashInstallationCoreSurfaceReconciliationPlan(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectInstallationCoreSurfaceReconciliationPlanCore(value),
  );
}

export async function parseInstallationCoreSurfaceReconciliationPlan(
  value: unknown,
): Promise<InstallationCoreSurfaceReconciliationPlan> {
  const plan = installationCoreSurfaceReconciliationPlanSchema.parse(value);
  const inventoryHash = await hashInstallationCoreSurfaceInventory(
    plan.inventory,
  );
  const transitionSetHash = await hashInstallationCoreSurfaceTransitionSet(
    plan.transitions,
  );
  const targetHashes = await Promise.all(
    plan.transitions.map((transition) =>
      hashWorkspaceCoreSurface(transition.targetSurface),
    ),
  );
  if (
    inventoryHash !== plan.inventory.inventorySha256 ||
    transitionSetHash !== plan.transitionSetSha256 ||
    targetHashes.some(
      (hash, index) => hash !== plan.transitions[index]!.targetSurfaceSha256,
    ) ||
    (await hashInstallationCoreSurfaceReconciliationPlan(plan)) !==
      plan.planHash
  ) {
    throw new Error(
      "Installation core-surface reconciliation plan hashes are invalid",
    );
  }
  return plan;
}

export const installationCoreSurfaceReconciliationBindingSchema = z
  .object({
    vortonInstallationId: canonicalUuid,
    planHash: sha256,
    targetRelease: adoptedReleaseProjectionSchema,
    compiledRegistrySha256: z.literal(
      workspaceCompiledCoreSurfaceRegistrySha256,
    ),
    legacyProjectionContractSha256: sha256,
    predecessorReconciliationReceipt:
      installationCoreSurfaceReconciliationReceiptReferenceSchema.nullable(),
    inventorySha256: sha256,
    transitionSetSha256: sha256,
    workspaceCount: z.number().int().safe().positive(),
    legacyWorkspaceCount: z.number().int().safe().positive(),
  })
  .strict();

export const installationCoreSurfaceReconciliationPlanRequestSchema = z
  .object({
    releaseAdoptionReceiptId: canonicalUuid,
    releaseAdoptionReceiptSha256: sha256,
  })
  .strict();

export const installationCoreSurfaceReconciliationApprovalRequestSchema = z
  .object({
    approvalId: canonicalUuid,
    planHash: sha256,
    expiresAt: utcMilliseconds,
  })
  .strict();

export const installationCoreSurfaceReconciliationApplyRequestSchema = z
  .object({ receiptId: canonicalUuid })
  .strict();

export const installationCoreSurfaceReconciliationAuthoritySchema = z
  .object({
    principalKind: z.literal("person"),
    personId: canonicalUuid,
    installationPersonKind: z.literal("owner"),
    signedInstallationPersonContext: z.literal(true),
    liveInstallationOwnerChecked: z.literal(true),
    workspaceAuthorityBorrowed: z.literal(false),
    rolesGrantAuthority: z.literal(false),
  })
  .strict();

const approvalCoreShape = {
  contract: z.literal(
    "vorton.installation-core-surface-reconciliation-approval.v1",
  ),
  approvalId: canonicalUuid,
  approvalPlane: z.literal("installation-postgres"),
  ownerPersonId: canonicalUuid,
  binding: installationCoreSurfaceReconciliationBindingSchema,
  authority: installationCoreSurfaceReconciliationAuthoritySchema,
  approvedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  installationOwnerVerifiedAt: utcMilliseconds,
  scope: installationCoreSurfaceReconciliationLimitsSchema,
  rolesGrantAuthority: z.literal(false),
} as const;

type ApprovalCoreCandidate = z.infer<z.ZodObject<typeof approvalCoreShape>>;

function validateApprovalCore(
  approval: ApprovalCoreCandidate,
  context: z.RefinementCtx,
): void {
  const approvedAt = milliseconds(approval.approvedAt);
  const aal2VerifiedAt = milliseconds(approval.aal2VerifiedAt);
  const expiresAt = milliseconds(approval.expiresAt);
  if (
    approval.authority.personId !== approval.ownerPersonId ||
    approval.installationOwnerVerifiedAt !== approval.approvedAt ||
    aal2VerifiedAt > approvedAt ||
    approvedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
    expiresAt <= approvedAt ||
    expiresAt > approvedAt + 24 * 60 * 60 * 1_000
  ) {
    addIssue(
      context,
      ["approvedAt"],
      "Approval violates installation-owner, AAL2, or bounded-scope authority",
    );
  }
}

export const installationCoreSurfaceReconciliationApprovalCoreSchema = z
  .object(approvalCoreShape)
  .strict()
  .superRefine(validateApprovalCore);

export const installationCoreSurfaceReconciliationApprovalSchema = z
  .object({
    ...approvalCoreShape,
    approvalReceiptId: canonicalUuid,
    approvalReceiptSha256: sha256,
  })
  .strict()
  .superRefine((approval, context) => {
    validateApprovalCore(approval, context);
    const identities = [
      approval.approvalId,
      approval.approvalReceiptId,
      approval.binding.targetRelease.adoptionReceiptId,
      ...(approval.binding.predecessorReconciliationReceipt
        ? [approval.binding.predecessorReconciliationReceipt.receiptId]
        : []),
    ];
    if (new Set(identities).size !== identities.length) {
      addIssue(
        context,
        ["approvalReceiptId"],
        "Approval authority identities must be distinct",
      );
    }
  });

const approvalCreationEffectsSchema = z
  .object({
    approvalCreated: z.literal(true),
    approvalConsumed: z.literal(false),
    installationReconciliationApplied: z.literal(false),
    workspaceProjectionMutated: z.literal(false),
    workspaceLineageMutated: z.literal(false),
    installationLineageMutated: z.literal(false),
    releaseInstalled: z.literal(false),
    releaseAdopted: z.literal(false),
    workspaceAuthorityBorrowed: z.literal(false),
    workspaceBusinessDataRead: z.literal(false),
    workspaceBusinessDataMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
  })
  .strict();

const approvalReceiptShape = {
  contract: z.literal(
    "vorton.installation-core-surface-reconciliation-approval-receipt.v1",
  ),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("installation-postgres"),
  approvalId: canonicalUuid,
  approvalHash: sha256,
  ownerPersonId: canonicalUuid,
  binding: installationCoreSurfaceReconciliationBindingSchema,
  authority: installationCoreSurfaceReconciliationAuthoritySchema,
  approvedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
  createdAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  installationOwnerVerifiedAt: utcMilliseconds,
  scope: installationCoreSurfaceReconciliationLimitsSchema,
  rolesGrantAuthority: z.literal(false),
  effects: approvalCreationEffectsSchema,
} as const;

export const installationCoreSurfaceReconciliationApprovalReceiptSchema = z
  .object({ ...approvalReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const approvedAt = milliseconds(receipt.approvedAt);
    const aal2VerifiedAt = milliseconds(receipt.aal2VerifiedAt);
    const expiresAt = milliseconds(receipt.expiresAt);
    const identities = [
      receipt.receiptId,
      receipt.approvalId,
      receipt.binding.targetRelease.adoptionReceiptId,
      ...(receipt.binding.predecessorReconciliationReceipt
        ? [receipt.binding.predecessorReconciliationReceipt.receiptId]
        : []),
    ];
    if (
      receipt.createdAt !== receipt.approvedAt ||
      receipt.installationOwnerVerifiedAt !== receipt.approvedAt ||
      receipt.authority.personId !== receipt.ownerPersonId ||
      aal2VerifiedAt > approvedAt ||
      approvedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
      expiresAt <= approvedAt ||
      expiresAt > approvedAt + 24 * 60 * 60 * 1_000 ||
      new Set(identities).size !== identities.length
    ) {
      addIssue(
        context,
        ["receiptId"],
        "Approval receipt does not bind exact no-effect installation authority",
      );
    }
  });

export const installationCoreSurfaceReconciliationApprovalCreationSchema = z
  .object({
    approval: installationCoreSurfaceReconciliationApprovalSchema,
    approvalReceipt: installationCoreSurfaceReconciliationApprovalReceiptSchema,
  })
  .strict()
  .superRefine(({ approval, approvalReceipt }, context) => {
    if (
      approval.approvalReceiptId !== approvalReceipt.receiptId ||
      approval.approvalReceiptSha256 !== approvalReceipt.receiptHash ||
      approval.approvalId !== approvalReceipt.approvalId ||
      approval.ownerPersonId !== approvalReceipt.ownerPersonId ||
      approval.approvedAt !== approvalReceipt.approvedAt ||
      approval.expiresAt !== approvalReceipt.expiresAt ||
      approval.aal2VerifiedAt !== approvalReceipt.aal2VerifiedAt ||
      !equalCanonical(approval.binding, approvalReceipt.binding) ||
      !equalCanonical(approval.authority, approvalReceipt.authority) ||
      !equalCanonical(approval.scope, approvalReceipt.scope)
    ) {
      addIssue(
        context,
        ["approvalReceipt"],
        "Approval and its atomic no-effect receipt do not match",
      );
    }
  });

export function projectInstallationCoreSurfaceReconciliationApprovalCore(
  value: unknown,
): InstallationCoreSurfaceReconciliationApprovalCore {
  const approval =
    installationCoreSurfaceReconciliationApprovalSchema.parse(value);
  const {
    approvalReceiptId: _approvalReceiptId,
    approvalReceiptSha256: _approvalReceiptSha256,
    ...core
  } = approval;
  return installationCoreSurfaceReconciliationApprovalCoreSchema.parse(core);
}

export async function hashInstallationCoreSurfaceReconciliationApprovalCore(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectInstallationCoreSurfaceReconciliationApprovalCore(value),
  );
}

export function projectInstallationCoreSurfaceReconciliationApprovalReceiptCore(
  value: unknown,
): Omit<InstallationCoreSurfaceReconciliationApprovalReceipt, "receiptHash"> {
  const receipt =
    installationCoreSurfaceReconciliationApprovalReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashInstallationCoreSurfaceReconciliationApprovalReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectInstallationCoreSurfaceReconciliationApprovalReceiptCore(value),
  );
}

export async function parseInstallationCoreSurfaceReconciliationApprovalCreation(
  value: unknown,
  planValue: unknown,
): Promise<InstallationCoreSurfaceReconciliationApprovalCreation> {
  const plan = await parseInstallationCoreSurfaceReconciliationPlan(planValue);
  const creation =
    installationCoreSurfaceReconciliationApprovalCreationSchema.parse(value);
  const expectedBinding = bindingFromPlan(plan);
  const approvalHash =
    await hashInstallationCoreSurfaceReconciliationApprovalCore(
      creation.approval,
    );
  const receiptHash =
    await hashInstallationCoreSurfaceReconciliationApprovalReceipt(
      creation.approvalReceipt,
    );
  const authorityIds = [
    creation.approval.approvalId,
    creation.approval.approvalReceiptId,
    plan.targetRelease.adoptionReceiptId,
    ...(plan.predecessorReconciliationReceipt
      ? [plan.predecessorReconciliationReceipt.receiptId]
      : []),
  ];
  if (
    !equalCanonical(creation.approval.binding, expectedBinding) ||
    approvalHash !== creation.approvalReceipt.approvalHash ||
    receiptHash !== creation.approvalReceipt.receiptHash ||
    new Set(authorityIds).size !== authorityIds.length
  ) {
    throw new Error(
      "Installation core-surface reconciliation approval authority is invalid",
    );
  }
  return creation;
}

export function bindingFromPlan(
  plan: InstallationCoreSurfaceReconciliationPlan,
): InstallationCoreSurfaceReconciliationBinding {
  return installationCoreSurfaceReconciliationBindingSchema.parse({
    vortonInstallationId: plan.vortonInstallationId,
    planHash: plan.planHash,
    targetRelease: plan.targetRelease,
    compiledRegistrySha256: plan.compiledRegistrySha256,
    legacyProjectionContractSha256: plan.legacyProjectionContractSha256,
    predecessorReconciliationReceipt: plan.predecessorReconciliationReceipt,
    inventorySha256: plan.inventory.inventorySha256,
    transitionSetSha256: plan.transitionSetSha256,
    workspaceCount: plan.inventory.workspaceCount,
    legacyWorkspaceCount: plan.inventory.legacyWorkspaceCount,
  });
}

const workspaceReceiptEffectsSchema = z
  .object({
    legacyCompatibilityReconciled: z.literal(true),
    workspaceProjectionMetadataRead: z.literal(true),
    workspaceProjectionMutated: z.literal(true),
    historicalAttributionPreserved: z.literal(true),
    workspaceLineageAdvanced: z.literal(true),
    workspaceAuthorityBorrowed: z.literal(false),
    workspaceBusinessDataRead: z.literal(false),
    workspaceBusinessDataMutated: z.literal(false),
    artifactResolved: z.literal(false),
    artifactLoaded: z.literal(false),
    moduleRuntimeStarted: z.literal(false),
    moduleAdmitted: z.literal(false),
    moduleMigrated: z.literal(false),
    personalDataRead: z.literal(false),
  })
  .strict();

const workspaceReceiptShape = {
  contract: z.literal(
    "vorton.workspace-core-surface-reconciliation-receipt.v1",
  ),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("installation-postgres"),
  installationReceiptId: canonicalUuid,
  approvalId: canonicalUuid,
  approvalReceiptId: canonicalUuid,
  approvalReceiptSha256: sha256,
  planHash: sha256,
  vortonInstallationId: canonicalUuid,
  workspaceId: canonicalUuid,
  realm,
  predecessorCoreSurfaceLineageReceipt: z.literal(null),
  compiledRegistrySha256: z.literal(workspaceCompiledCoreSurfaceRegistrySha256),
  legacyProjectionContractSha256: sha256,
  preimageModuleCount: z.number().int().safe().positive().max(7),
  preimageSurfaceSha256: sha256,
  postimageSurface: workspaceCoreSurfaceSchema,
  postimageSurfaceSha256: sha256,
  appliedByPersonId: canonicalUuid,
  appliedAt: utcMilliseconds,
  rowCounts: z
    .object({
      preimageCoreSurfaceRows: z.number().int().safe().positive().max(7),
      updatedCoreSurfaceRows: z.literal(1),
      postimageCoreSurfaceRows: z.number().int().safe().positive().max(7),
      defaultCoreSurfaceRowsUpdated: z.literal(0),
      workspaceLineageRowsInserted: z.literal(1),
      workspaceBusinessRowsRead: z.literal(0),
      workspaceBusinessRowsMutated: z.literal(0),
    })
    .strict(),
  effects: workspaceReceiptEffectsSchema,
} as const;

export const workspaceCoreSurfaceReconciliationReceiptSchema = z
  .object({ ...workspaceReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const identities = [
      receipt.receiptId,
      receipt.installationReceiptId,
      receipt.approvalId,
      receipt.approvalReceiptId,
    ];
    if (
      receipt.preimageSurfaceSha256 === receipt.postimageSurfaceSha256 ||
      receipt.preimageModuleCount !==
        receipt.rowCounts.preimageCoreSurfaceRows ||
      receipt.rowCounts.postimageCoreSurfaceRows !==
        receipt.postimageSurface.modules.length ||
      receipt.postimageSurface.modules.length === 0 ||
      new Set(identities).size !== identities.length
    ) {
      addIssue(
        context,
        ["receiptId"],
        "Workspace receipt does not bind one exact compatibility transition",
      );
    }
  });

export function projectWorkspaceCoreSurfaceReconciliationReceiptCore(
  value: unknown,
): Omit<WorkspaceCoreSurfaceReconciliationReceipt, "receiptHash"> {
  const receipt = workspaceCoreSurfaceReconciliationReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashWorkspaceCoreSurfaceReconciliationReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceCoreSurfaceReconciliationReceiptCore(value),
  );
}

const applicationReceiptEffectsSchema = z
  .object({
    approvalConsumed: z.literal(true),
    installationReconciliationApplied: z.literal(true),
    legacyCompatibilityReconciled: z.literal(true),
    workspaceProjectionMetadataRead: z.literal(true),
    workspaceProjectionMutated: z.literal(true),
    historicalAttributionPreserved: z.literal(true),
    workspaceLineageAdvanced: z.literal(true),
    installationLineageAdvanced: z.literal(true),
    releaseInstalled: z.literal(false),
    releaseAdopted: z.literal(false),
    workspaceAuthorityBorrowed: z.literal(false),
    workspaceBusinessDataRead: z.literal(false),
    workspaceBusinessDataMutated: z.literal(false),
    artifactResolved: z.literal(false),
    artifactLoaded: z.literal(false),
    moduleRuntimeStarted: z.literal(false),
    moduleAdmitted: z.literal(false),
    moduleMigrated: z.literal(false),
    personalDataRead: z.literal(false),
    infrastructureMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
    privateConsumerAuthorityGranted: z.literal(false),
  })
  .strict();

const applicationReceiptShape = {
  contract: z.literal(
    "vorton.installation-core-surface-reconciliation-receipt.v1",
  ),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("installation-postgres"),
  approvalId: canonicalUuid,
  approvalReceiptId: canonicalUuid,
  approvalReceiptSha256: sha256,
  approvalHash: sha256,
  binding: installationCoreSurfaceReconciliationBindingSchema,
  approvedByPersonId: canonicalUuid,
  appliedByPersonId: canonicalUuid,
  approvalConsumptionCount: z.literal(1),
  approvalConsumedAt: utcMilliseconds,
  appliedAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  installationOwnerVerifiedAt: utcMilliseconds,
  preimageInventorySha256: sha256,
  postimageInventory: installationCoreSurfaceInventorySchema,
  workspaceReceipts: z
    .array(
      z
        .object({
          workspaceId: canonicalUuid,
          receiptId: canonicalUuid,
          receiptSha256: sha256,
        })
        .strict(),
    )
    .min(1),
  rowCounts: z
    .object({
      workspaceInventoryRowsRead: z.number().int().safe().positive(),
      legacyWorkspaceRowsLocked: z.number().int().safe().positive(),
      workspaceProjectionRowsUpdated: z.number().int().safe().positive(),
      workspaceLineageRowsInserted: z.number().int().safe().positive(),
      installationLineageRowsUpdated: z.literal(1),
      workspaceBusinessRowsRead: z.literal(0),
      workspaceBusinessRowsMutated: z.literal(0),
    })
    .strict(),
  idempotency: z
    .object({
      key: canonicalUuid,
      exactReplayReturnsSameReceipt: z.literal(true),
      conflictingReplayDenied: z.literal(true),
      additionalProjectionMutationsOnReplay: z.literal(0),
    })
    .strict(),
  effects: applicationReceiptEffectsSchema,
} as const;

export const installationCoreSurfaceReconciliationReceiptSchema = z
  .object({ ...applicationReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const workspaceIds = receipt.workspaceReceipts.map(
      (reference) => reference.workspaceId,
    );
    const receiptIds = receipt.workspaceReceipts.map(
      (reference) => reference.receiptId,
    );
    const appliedAt = milliseconds(receipt.appliedAt);
    const aal2VerifiedAt = milliseconds(receipt.aal2VerifiedAt);
    if (
      receipt.approvedByPersonId !== receipt.appliedByPersonId ||
      receipt.installationOwnerVerifiedAt !== receipt.appliedAt ||
      receipt.approvalConsumedAt !== receipt.appliedAt ||
      receipt.idempotency.key !== receipt.receiptId ||
      aal2VerifiedAt > appliedAt ||
      appliedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
      !isCanonicallySorted(workspaceIds) ||
      new Set(receiptIds).size !== receiptIds.length ||
      receipt.workspaceReceipts.length !==
        receipt.binding.legacyWorkspaceCount ||
      receipt.rowCounts.workspaceInventoryRowsRead !==
        receipt.binding.workspaceCount ||
      receipt.rowCounts.legacyWorkspaceRowsLocked !==
        receipt.binding.legacyWorkspaceCount ||
      receipt.rowCounts.workspaceLineageRowsInserted !==
        receipt.binding.legacyWorkspaceCount ||
      receipt.rowCounts.workspaceProjectionRowsUpdated !==
        receipt.binding.legacyWorkspaceCount
    ) {
      addIssue(
        context,
        ["receiptId"],
        "Application receipt does not bind exact one-time installation reconciliation",
      );
    }
  });

export const installationCoreSurfaceReconciliationApplicationSchema = z
  .object({
    applicationReceipt: installationCoreSurfaceReconciliationReceiptSchema,
    workspaceReceipts: z
      .array(workspaceCoreSurfaceReconciliationReceiptSchema)
      .min(1),
  })
  .strict();

export function projectInstallationCoreSurfaceReconciliationReceiptCore(
  value: unknown,
): Omit<InstallationCoreSurfaceReconciliationReceipt, "receiptHash"> {
  const receipt =
    installationCoreSurfaceReconciliationReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashInstallationCoreSurfaceReconciliationReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectInstallationCoreSurfaceReconciliationReceiptCore(value),
  );
}

export async function deriveInstallationCoreSurfacePostimageInventory(
  planValue: unknown,
  workspaceReceiptsValue: unknown,
): Promise<InstallationCoreSurfaceInventory> {
  const plan = await parseInstallationCoreSurfaceReconciliationPlan(planValue);
  const workspaceReceipts = z
    .array(workspaceCoreSurfaceReconciliationReceiptSchema)
    .min(1)
    .parse(workspaceReceiptsValue);
  const receiptsByWorkspace = new Map(
    workspaceReceipts.map((receipt) => [receipt.workspaceId, receipt]),
  );
  const expectedWorkspaceIds = plan.transitions.map(
    (transition) => transition.workspaceId,
  );
  const actualWorkspaceIds = workspaceReceipts.map(
    (receipt) => receipt.workspaceId,
  );
  if (
    workspaceReceipts.length !== plan.transitions.length ||
    new Set(actualWorkspaceIds).size !== actualWorkspaceIds.length ||
    !equalCanonical(actualWorkspaceIds, expectedWorkspaceIds)
  ) {
    throw new Error(
      "Workspace reconciliation receipts must cover every transition exactly once",
    );
  }
  const entries = plan.inventory.entries.map((entry) => {
    if (entry.state !== "legacy-unreceipted") {
      return entry;
    }
    const receipt = receiptsByWorkspace.get(entry.workspaceId);
    if (!receipt) {
      throw new Error("Missing workspace reconciliation receipt");
    }
    return {
      workspaceId: entry.workspaceId,
      realm: entry.realm,
      state: "selected" as const,
      moduleCount: receipt.postimageSurface.modules.length,
      surfaceSha256: receipt.postimageSurfaceSha256,
      lineage: {
        contract:
          "vorton.workspace-core-surface-reconciliation-receipt.v1" as const,
        receiptId: receipt.receiptId,
        receiptSha256: receipt.receiptHash,
      },
    };
  });
  const core = inventoryCoreSchema.parse({
    workspaceCount: entries.length,
    unconfiguredWorkspaceCount: entries.filter(
      (entry) => entry.state === "unconfigured",
    ).length,
    selectedWorkspaceCount: entries.filter(
      (entry) => entry.state === "selected",
    ).length,
    legacyWorkspaceCount: 0,
    entries,
  });
  return installationCoreSurfaceInventorySchema.parse({
    ...core,
    inventorySha256: await moduleLifecycleCanonicalSha256(core),
  });
}

export async function parseInstallationCoreSurfaceReconciliationApplication(
  value: unknown,
  planValue: unknown,
  approvalCreationValue: unknown,
): Promise<InstallationCoreSurfaceReconciliationApplication> {
  const plan = await parseInstallationCoreSurfaceReconciliationPlan(planValue);
  const creation =
    await parseInstallationCoreSurfaceReconciliationApprovalCreation(
      approvalCreationValue,
      plan,
    );
  const application =
    installationCoreSurfaceReconciliationApplicationSchema.parse(value);
  const receipt = application.applicationReceipt;
  const expectedBinding = bindingFromPlan(plan);
  const approvalHash =
    await hashInstallationCoreSurfaceReconciliationApprovalCore(
      creation.approval,
    );
  const approvalReceiptHash =
    await hashInstallationCoreSurfaceReconciliationApprovalReceipt(
      creation.approvalReceipt,
    );
  const expectedPostimage =
    await deriveInstallationCoreSurfacePostimageInventory(
      plan,
      application.workspaceReceipts,
    );
  const transitionsByWorkspace = new Map(
    plan.transitions.map((transition) => [transition.workspaceId, transition]),
  );
  const referencesByWorkspace = new Map(
    receipt.workspaceReceipts.map((reference) => [
      reference.workspaceId,
      reference,
    ]),
  );
  const childWorkspaceIds = application.workspaceReceipts.map(
    (child) => child.workspaceId,
  );
  const referenceWorkspaceIds = receipt.workspaceReceipts.map(
    (reference) => reference.workspaceId,
  );
  const applicationAuthorityIds = [
    receipt.receiptId,
    receipt.approvalId,
    receipt.approvalReceiptId,
    ...application.workspaceReceipts.map((child) => child.receiptId),
    plan.targetRelease.adoptionReceiptId,
    ...plan.inventory.entries.flatMap((entry) =>
      entry.lineage ? [entry.lineage.receiptId] : [],
    ),
    ...(plan.predecessorReconciliationReceipt
      ? [plan.predecessorReconciliationReceipt.receiptId]
      : []),
  ];
  if (
    application.workspaceReceipts.length !== plan.transitions.length ||
    receipt.workspaceReceipts.length !== plan.transitions.length ||
    !equalCanonical(
      childWorkspaceIds,
      plan.transitions.map((item) => item.workspaceId),
    ) ||
    !equalCanonical(referenceWorkspaceIds, childWorkspaceIds) ||
    new Set(applicationAuthorityIds).size !== applicationAuthorityIds.length
  ) {
    throw new Error(
      "Installation reconciliation application does not cover exact distinct transition authority",
    );
  }
  for (const child of application.workspaceReceipts) {
    const transition = transitionsByWorkspace.get(child.workspaceId);
    const reference = referencesByWorkspace.get(child.workspaceId);
    if (
      !transition ||
      !reference ||
      child.receiptId !== reference.receiptId ||
      child.installationReceiptId !== receipt.receiptId ||
      child.approvalId !== creation.approval.approvalId ||
      child.approvalReceiptId !== creation.approval.approvalReceiptId ||
      child.approvalReceiptSha256 !== approvalReceiptHash ||
      child.planHash !== plan.planHash ||
      child.vortonInstallationId !== plan.vortonInstallationId ||
      child.realm !== transition.realm ||
      child.appliedByPersonId !== receipt.appliedByPersonId ||
      child.preimageModuleCount !== transition.preimageModuleCount ||
      child.preimageSurfaceSha256 !== transition.preimageSurfaceSha256 ||
      !equalCanonical(child.postimageSurface, transition.targetSurface) ||
      child.postimageSurfaceSha256 !== transition.targetSurfaceSha256 ||
      child.appliedAt !== receipt.appliedAt ||
      (await hashWorkspaceCoreSurface(child.postimageSurface)) !==
        child.postimageSurfaceSha256 ||
      (await hashWorkspaceCoreSurfaceReconciliationReceipt(child)) !==
        child.receiptHash ||
      reference.receiptSha256 !== child.receiptHash
    ) {
      throw new Error(
        "Workspace reconciliation receipt does not match its exact transition",
      );
    }
  }
  if (
    receipt.approvalId !== creation.approval.approvalId ||
    receipt.approvalReceiptId !== creation.approval.approvalReceiptId ||
    receipt.approvalReceiptSha256 !== approvalReceiptHash ||
    receipt.approvalHash !== approvalHash ||
    receipt.approvedByPersonId !== creation.approval.ownerPersonId ||
    receipt.appliedByPersonId !== creation.approval.ownerPersonId ||
    !equalCanonical(receipt.binding, expectedBinding) ||
    receipt.preimageInventorySha256 !== plan.inventory.inventorySha256 ||
    !equalCanonical(receipt.postimageInventory, expectedPostimage) ||
    receipt.appliedAt < creation.approval.approvedAt ||
    receipt.appliedAt >= creation.approval.expiresAt ||
    receipt.rowCounts.workspaceProjectionRowsUpdated !==
      plan.transitions.length ||
    (await hashInstallationCoreSurfaceInventory(receipt.postimageInventory)) !==
      receipt.postimageInventory.inventorySha256 ||
    (await hashInstallationCoreSurfaceReconciliationReceipt(receipt)) !==
      receipt.receiptHash
  ) {
    throw new Error(
      "Installation reconciliation receipt does not match its exact authority",
    );
  }
  return application;
}

const verificationShape = {
  contract: z.literal(
    "vorton.installation-core-surface-reconciliation-verification.v1",
  ),
  vortonInstallationId: canonicalUuid,
  planHash: sha256,
  targetRelease: adoptedReleaseProjectionSchema,
  compiledRegistrySha256: z.literal(workspaceCompiledCoreSurfaceRegistrySha256),
  applicationReceipt:
    installationCoreSurfaceReconciliationReceiptReferenceSchema,
  currentInstallationReconciliationReceipt:
    installationCoreSurfaceReconciliationReceiptReferenceSchema,
  postimageInventorySha256: sha256,
  currentWorkspaceReceipts: z
    .array(
      z
        .object({
          workspaceId: canonicalUuid,
          receiptId: canonicalUuid,
          receiptSha256: sha256,
        })
        .strict(),
    )
    .min(1),
  verifiedAt: utcMilliseconds,
  verified: z.literal(true),
  observations: z
    .object({
      installationLineageRowsRead: z.literal(1),
      workspaceLineageRowsRead: z.number().int().safe().positive(),
      workspaceProjectionRowsRead: z.number().int().safe().positive(),
      workspaceBusinessRowsRead: z.literal(0),
      otherInstallationRowsRead: z.literal(0),
      externalSystemsRead: z.literal(0),
    })
    .strict(),
} as const;

export const installationCoreSurfaceReconciliationVerificationSchema = z
  .object({ ...verificationShape, verificationHash: sha256 })
  .strict()
  .superRefine((verification, context) => {
    const workspaceIds = verification.currentWorkspaceReceipts.map(
      (reference) => reference.workspaceId,
    );
    if (
      !equalCanonical(
        verification.applicationReceipt,
        verification.currentInstallationReconciliationReceipt,
      ) ||
      !isCanonicallySorted(workspaceIds) ||
      verification.observations.workspaceLineageRowsRead !==
        verification.currentWorkspaceReceipts.length
    ) {
      addIssue(
        context,
        ["currentInstallationReconciliationReceipt"],
        "Verification must bind the exact current installation and workspace receipt heads",
      );
    }
  });

export function projectInstallationCoreSurfaceReconciliationVerificationCore(
  value: unknown,
): Omit<InstallationCoreSurfaceReconciliationVerification, "verificationHash"> {
  const verification =
    installationCoreSurfaceReconciliationVerificationSchema.parse(value);
  const { verificationHash: _verificationHash, ...core } = verification;
  return core;
}

export async function hashInstallationCoreSurfaceReconciliationVerification(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectInstallationCoreSurfaceReconciliationVerificationCore(value),
  );
}

export async function parseInstallationCoreSurfaceReconciliationVerification(
  value: unknown,
  applicationValue: unknown,
): Promise<InstallationCoreSurfaceReconciliationVerification> {
  const application =
    installationCoreSurfaceReconciliationApplicationSchema.parse(
      applicationValue,
    );
  const verification =
    installationCoreSurfaceReconciliationVerificationSchema.parse(value);
  const receipt = application.applicationReceipt;
  const receiptReference = {
    receiptId: receipt.receiptId,
    receiptSha256: receipt.receiptHash,
  };
  const expectedWorkspaceHeads = receipt.postimageInventory.entries.flatMap(
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
  );
  const childReceiptHashes = await Promise.all(
    application.workspaceReceipts.map((child) =>
      hashWorkspaceCoreSurfaceReconciliationReceipt(child),
    ),
  );
  const childReferences = application.workspaceReceipts.map((child) => ({
    workspaceId: child.workspaceId,
    receiptId: child.receiptId,
    receiptSha256: child.receiptHash,
  }));
  if (
    verification.vortonInstallationId !==
      receipt.binding.vortonInstallationId ||
    verification.planHash !== receipt.binding.planHash ||
    !equalCanonical(
      verification.targetRelease,
      receipt.binding.targetRelease,
    ) ||
    !equalCanonical(verification.applicationReceipt, receiptReference) ||
    !equalCanonical(
      verification.currentInstallationReconciliationReceipt,
      receiptReference,
    ) ||
    verification.postimageInventorySha256 !==
      receipt.postimageInventory.inventorySha256 ||
    !equalCanonical(
      verification.currentWorkspaceReceipts,
      expectedWorkspaceHeads,
    ) ||
    verification.observations.workspaceProjectionRowsRead !==
      receipt.postimageInventory.entries.reduce(
        (count, entry) => count + entry.moduleCount,
        0,
      ) ||
    verification.verifiedAt < receipt.appliedAt ||
    (await hashInstallationCoreSurfaceInventory(receipt.postimageInventory)) !==
      receipt.postimageInventory.inventorySha256 ||
    childReceiptHashes.some(
      (hash, index) =>
        hash !== application.workspaceReceipts[index]!.receiptHash,
    ) ||
    !equalCanonical(childReferences, receipt.workspaceReceipts) ||
    (await hashInstallationCoreSurfaceReconciliationReceipt(receipt)) !==
      receipt.receiptHash ||
    (await hashInstallationCoreSurfaceReconciliationVerification(
      verification,
    )) !== verification.verificationHash
  ) {
    throw new Error(
      "Installation reconciliation verification does not match the current receipt heads",
    );
  }
  return verification;
}

export type InstallationCoreSurfaceReconciliationReceiptReference = z.infer<
  typeof installationCoreSurfaceReconciliationReceiptReferenceSchema
>;
export type InstallationCoreSurfaceInventoryEntry = z.infer<
  typeof installationCoreSurfaceInventoryEntrySchema
>;
export type InstallationCoreSurfaceInventory = z.infer<
  typeof installationCoreSurfaceInventorySchema
>;
export type InstallationCoreSurfaceTransition = z.infer<
  typeof installationCoreSurfaceTransitionSchema
>;
export type InstallationCoreSurfaceReconciliationPlanCore = z.infer<
  typeof installationCoreSurfaceReconciliationPlanCoreSchema
>;
export type InstallationCoreSurfaceReconciliationPlan = z.infer<
  typeof installationCoreSurfaceReconciliationPlanSchema
>;
export type InstallationCoreSurfaceReconciliationBinding = z.infer<
  typeof installationCoreSurfaceReconciliationBindingSchema
>;
export type InstallationCoreSurfaceReconciliationPlanRequest = z.infer<
  typeof installationCoreSurfaceReconciliationPlanRequestSchema
>;
export type InstallationCoreSurfaceReconciliationApprovalRequest = z.infer<
  typeof installationCoreSurfaceReconciliationApprovalRequestSchema
>;
export type InstallationCoreSurfaceReconciliationApplyRequest = z.infer<
  typeof installationCoreSurfaceReconciliationApplyRequestSchema
>;
export type InstallationCoreSurfaceReconciliationApprovalCore = z.infer<
  typeof installationCoreSurfaceReconciliationApprovalCoreSchema
>;
export type InstallationCoreSurfaceReconciliationApproval = z.infer<
  typeof installationCoreSurfaceReconciliationApprovalSchema
>;
export type InstallationCoreSurfaceReconciliationApprovalReceipt = z.infer<
  typeof installationCoreSurfaceReconciliationApprovalReceiptSchema
>;
export type InstallationCoreSurfaceReconciliationApprovalCreation = z.infer<
  typeof installationCoreSurfaceReconciliationApprovalCreationSchema
>;
export type WorkspaceCoreSurfaceReconciliationReceipt = z.infer<
  typeof workspaceCoreSurfaceReconciliationReceiptSchema
>;
export type InstallationCoreSurfaceReconciliationReceipt = z.infer<
  typeof installationCoreSurfaceReconciliationReceiptSchema
>;
export type InstallationCoreSurfaceReconciliationApplication = z.infer<
  typeof installationCoreSurfaceReconciliationApplicationSchema
>;
export type InstallationCoreSurfaceReconciliationVerification = z.infer<
  typeof installationCoreSurfaceReconciliationVerificationSchema
>;
