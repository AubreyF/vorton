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
const coreSurfaceId = z.enum([
  "command",
  "opportunities",
  "goals",
  "tasks",
  "tools",
  "factory",
  "admin",
]);
export const workspaceCompiledCoreSurfaceRegistry = {
  contract: "vorton.compiled-core-surface-registry.v1",
  surfaces: [
    {
      id: "command",
      contractVersion: "v1",
      label: "Command Bridge",
      presentationVariant: "standard",
    },
    {
      id: "opportunities",
      contractVersion: "v1",
      label: "Opportunities",
      presentationVariant: "standard",
    },
    {
      id: "goals",
      contractVersion: "v1",
      label: "Goals",
      presentationVariant: "standard",
    },
    {
      id: "tasks",
      contractVersion: "v1",
      label: "Tasks",
      presentationVariant: "standard",
    },
    {
      id: "tools",
      contractVersion: "v1",
      label: "Tools",
      presentationVariant: "standard",
    },
    {
      id: "factory",
      contractVersion: "v1",
      label: "Factory",
      presentationVariant: "read-only",
    },
    {
      id: "admin",
      contractVersion: "v1",
      label: "Admin",
      presentationVariant: "standard",
    },
  ],
} as const;
export const workspaceCompiledCoreSurfaceRegistrySha256 =
  "sha256:f9ae99ad9b8a053f5fb3915e94efd130f6c5d9a00b4abc6037a0c4e73368bd93";
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

export const workspaceCoreSurfaceSelectionReceiptReferenceSchema = z
  .object({
    receiptId: canonicalUuid,
    receiptSha256: sha256,
  })
  .strict();

function milliseconds(value: string): number {
  return Date.parse(value);
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return (
    canonicalModuleLifecycleJson(left) === canonicalModuleLifecycleJson(right)
  );
}

function addAuthorityIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

export const canonicalWorkspaceCoreSurfaceSelectionJson =
  canonicalModuleLifecycleJson;
export const workspaceCoreSurfaceSelectionCanonicalSha256 =
  moduleLifecycleCanonicalSha256;

export const workspaceCoreSurfaceProjectionSchema = z
  .object({
    id: coreSurfaceId,
    contractVersion: z.literal("v1"),
    label: z
      .string()
      .min(1)
      .max(80)
      .refine(
        (value) => value === value.trim(),
        "must not have surrounding whitespace",
      ),
    navigationOrder: z.number().int().safe().min(0).max(10_000),
    presentationVariant: z.enum(["standard", "read-only"]),
  })
  .strict()
  .superRefine((module, context) => {
    const compiled = workspaceCompiledCoreSurfaceRegistry.surfaces.find(
      (surface) => surface.id === module.id,
    );
    if (
      !compiled ||
      module.contractVersion !== compiled.contractVersion ||
      module.label !== compiled.label ||
      module.presentationVariant !== compiled.presentationVariant
    ) {
      addAuthorityIssue(
        context,
        ["presentationVariant"],
        "Core-surface tuple is not a supported Vorton v1 projection",
      );
    }
  });

export const workspaceCoreSurfaceSchema = z
  .object({
    defaultModuleId: coreSurfaceId.nullable(),
    modules: z.array(workspaceCoreSurfaceProjectionSchema).max(7),
  })
  .strict()
  .superRefine((surface, context) => {
    const ids = surface.modules.map((module) => module.id);
    const orders = surface.modules.map((module) => module.navigationOrder);
    if (
      new Set(ids).size !== ids.length ||
      new Set(orders).size !== orders.length
    ) {
      addAuthorityIssue(
        context,
        ["modules"],
        "Core-surface identities and navigation orders must be unique",
      );
    }

    const canonicalOrder = [...surface.modules].sort(
      (left, right) =>
        left.navigationOrder - right.navigationOrder ||
        left.id.localeCompare(right.id),
    );
    if (!equalCanonical(canonicalOrder, surface.modules)) {
      addAuthorityIssue(
        context,
        ["modules"],
        "Core surfaces must be sorted by navigation order and then identity",
      );
    }

    if (surface.modules.length === 0) {
      if (surface.defaultModuleId !== null) {
        addAuthorityIssue(
          context,
          ["defaultModuleId"],
          "An empty core surface must have a null default",
        );
      }
      return;
    }
    if (
      surface.defaultModuleId === null ||
      !ids.includes(surface.defaultModuleId)
    ) {
      addAuthorityIssue(
        context,
        ["defaultModuleId"],
        "A nonempty core surface must default to an included module",
      );
    }
  });

export const workspaceCoreSurfacePreferencesSchema = z
  .object({
    defaultCoreSurfaceId: coreSurfaceId.nullable(),
    coreSurfaces: z
      .array(
        z
          .object({
            id: coreSurfaceId,
            navigationOrder: z.number().int().safe().min(0).max(10_000),
          })
          .strict(),
      )
      .max(7),
  })
  .strict()
  .superRefine((preferences, context) => {
    const ids = preferences.coreSurfaces.map((surface) => surface.id);
    const orders = preferences.coreSurfaces.map(
      (surface) => surface.navigationOrder,
    );
    if (
      new Set(ids).size !== ids.length ||
      new Set(orders).size !== orders.length
    ) {
      addAuthorityIssue(
        context,
        ["coreSurfaces"],
        "Core-surface preferences must be unique",
      );
    }
    const canonicalOrder = [...preferences.coreSurfaces].sort(
      (left, right) =>
        left.navigationOrder - right.navigationOrder ||
        left.id.localeCompare(right.id),
    );
    if (!equalCanonical(canonicalOrder, preferences.coreSurfaces)) {
      addAuthorityIssue(
        context,
        ["coreSurfaces"],
        "Core-surface preferences must be canonically ordered",
      );
    }
    if (preferences.coreSurfaces.length === 0) {
      if (preferences.defaultCoreSurfaceId !== null) {
        addAuthorityIssue(
          context,
          ["defaultCoreSurfaceId"],
          "Empty preferences require a null default",
        );
      }
    } else if (
      preferences.defaultCoreSurfaceId === null ||
      !ids.includes(preferences.defaultCoreSurfaceId)
    ) {
      addAuthorityIssue(
        context,
        ["defaultCoreSurfaceId"],
        "The default must be a selected compiled core surface",
      );
    }
  });

const compiledCoreSurfaceById = new Map(
  workspaceCompiledCoreSurfaceRegistry.surfaces.map((surface) => [
    surface.id,
    surface,
  ]),
);

export function deriveWorkspaceCoreSurface(
  value: unknown,
): WorkspaceCoreSurface {
  const preferences = workspaceCoreSurfacePreferencesSchema.parse(value);
  return workspaceCoreSurfaceSchema.parse({
    defaultModuleId: preferences.defaultCoreSurfaceId,
    modules: preferences.coreSurfaces.map(({ id, navigationOrder }) => ({
      ...compiledCoreSurfaceById.get(id)!,
      navigationOrder,
    })),
  });
}

export function projectWorkspaceCoreSurface(
  value: unknown,
): WorkspaceCoreSurface {
  return workspaceCoreSurfaceSchema.parse(value);
}

export async function hashWorkspaceCoreSurface(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(projectWorkspaceCoreSurface(value));
}

export const workspaceCoreSurfaceSelectionWorkSnapshotSchema = z
  .object({
    id: canonicalUuid,
    vortonInstallationId: canonicalUuid,
    workspaceId: canonicalUuid,
    title: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) => value === value.trim(),
        "must not have surrounding whitespace",
      ),
    requestedOutcome: z
      .string()
      .min(1)
      .refine(
        (value) => value === value.trim(),
        "must not have surrounding whitespace",
      ),
    acceptanceCriteria: z.array(
      z
        .string()
        .min(1)
        .refine(
          (value) => value === value.trim(),
          "must not have surrounding whitespace",
        ),
    ),
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

export function projectWorkspaceCoreSurfaceSelectionWorkSnapshot(
  value: unknown,
): WorkspaceCoreSurfaceSelectionWorkSnapshot {
  return workspaceCoreSurfaceSelectionWorkSnapshotSchema.parse(value);
}

export async function hashWorkspaceCoreSurfaceSelectionWorkSnapshot(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceCoreSurfaceSelectionWorkSnapshot(value),
  );
}

export const workspaceCoreSurfaceSelectionBindingSchema = z
  .object({
    vortonInstallationId: canonicalUuid,
    workspaceId: canonicalUuid,
    realm,
    workId: canonicalUuid,
    workSnapshotSha256: sha256,
    currentSurface: workspaceCoreSurfaceSchema,
    currentSurfaceSha256: sha256,
    compiledRegistrySha256: z.literal(
      workspaceCompiledCoreSurfaceRegistrySha256,
    ),
    predecessorCoreSurfaceSelectionReceipt:
      workspaceCoreSurfaceSelectionReceiptReferenceSchema.nullable(),
    targetPreferences: workspaceCoreSurfacePreferencesSchema,
    targetSurface: workspaceCoreSurfaceSchema,
    targetSurfaceSha256: sha256,
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      !equalCanonical(
        deriveWorkspaceCoreSurface(binding.targetPreferences),
        binding.targetSurface,
      )
    ) {
      addAuthorityIssue(
        context,
        ["targetPreferences"],
        "Target surface must be derived from the exact compiled registry",
      );
    }
    if (
      binding.currentSurface.modules.length > 0 &&
      binding.predecessorCoreSurfaceSelectionReceipt === null
    ) {
      addAuthorityIssue(
        context,
        ["predecessorCoreSurfaceSelectionReceipt"],
        "Only an empty genesis surface may have no predecessor receipt",
      );
    }
    if (
      equalCanonical(binding.currentSurface, binding.targetSurface) ||
      binding.currentSurfaceSha256 === binding.targetSurfaceSha256
    ) {
      addAuthorityIssue(
        context,
        ["targetSurface"],
        "Selection must change the exact compiled core surface",
      );
    }
  });

export const workspaceCoreSurfaceSelectionAuthoritySchema = z
  .object({
    principalKind: z.literal("person"),
    personId: canonicalUuid,
    workspaceMembershipKind: z.literal("owner"),
    capability: z.literal("workspace.core-surface.select"),
    mode: z.literal("modify"),
    workId: canonicalUuid,
    policyId: canonicalUuid,
    policySha256: sha256,
    capabilityGrantId: canonicalUuid,
    workScoped: z.literal(true),
    rolesGrantAuthority: z.literal(false),
  })
  .strict();

export const workspaceCoreSurfaceSelectionApprovalRequestSchema = z
  .object({
    approvalId: canonicalUuid,
    workId: canonicalUuid,
    capabilityGrantId: canonicalUuid,
    compiledRegistrySha256: z.literal(
      workspaceCompiledCoreSurfaceRegistrySha256,
    ),
    expectedCurrentSurfaceSha256: sha256,
    expectedPredecessorCoreSurfaceSelectionReceipt:
      workspaceCoreSurfaceSelectionReceiptReferenceSchema.nullable(),
    targetPreferences: workspaceCoreSurfacePreferencesSchema,
    expiresAt: utcMilliseconds,
  })
  .strict()
  .superRefine((request, context) => {
    const identities = [
      request.approvalId,
      request.workId,
      request.capabilityGrantId,
      ...(request.expectedPredecessorCoreSurfaceSelectionReceipt
        ? [request.expectedPredecessorCoreSurfaceSelectionReceipt.receiptId]
        : []),
    ];
    const hashes = [
      request.expectedCurrentSurfaceSha256,
      ...(request.expectedPredecessorCoreSurfaceSelectionReceipt
        ? [request.expectedPredecessorCoreSurfaceSelectionReceipt.receiptSha256]
        : []),
    ];
    if (
      new Set(identities).size !== identities.length ||
      new Set(hashes).size !== hashes.length
    ) {
      addAuthorityIssue(
        context,
        ["approvalId"],
        "Request authority identities and hashes must be distinct",
      );
    }
  });

export const workspaceCoreSurfaceSelectionApplyRequestSchema = z
  .object({ receiptId: canonicalUuid })
  .strict();

export const workspaceCoreSurfaceSelectionScopeSchema = z
  .object({
    action: z.literal("workspace.core-surface.select"),
    compiledCoreSurfaceOnly: z.literal(true),
    defaultModuleProjectionOnly: z.literal(true),
    moduleReleaseAdmission: z.literal(false),
    infrastructureMutation: z.literal(false),
    otherWorkspaceRead: z.literal(false),
    otherWorkspaceMutation: z.literal(false),
    externalSystemMutation: z.literal(false),
  })
  .strict();

const approvalCoreShape = {
  contract: z.literal("vorton.workspace-core-surface-selection-approval.v1"),
  approvalId: canonicalUuid,
  approvalRecordId: canonicalUuid,
  approvalPlane: z.literal("workspace-postgres"),
  ownerPersonId: canonicalUuid,
  binding: workspaceCoreSurfaceSelectionBindingSchema,
  authority: workspaceCoreSurfaceSelectionAuthoritySchema,
  approvedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  ownerMembershipVerifiedAt: utcMilliseconds,
  policyVerifiedAt: utcMilliseconds,
  capabilityGrantVerifiedAt: utcMilliseconds,
  workVerifiedAt: utcMilliseconds,
  currentSurfaceVerifiedAt: utcMilliseconds,
  scope: workspaceCoreSurfaceSelectionScopeSchema,
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
  const verificationTimes = [
    approval.ownerMembershipVerifiedAt,
    approval.policyVerifiedAt,
    approval.capabilityGrantVerifiedAt,
    approval.workVerifiedAt,
    approval.currentSurfaceVerifiedAt,
  ];
  if (
    approval.authority.personId !== approval.ownerPersonId ||
    approval.authority.workId !== approval.binding.workId
  ) {
    addAuthorityIssue(
      context,
      ["ownerPersonId"],
      "Selection authority must bind one owner and the exact Work",
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
  const identities = [
    approval.approvalId,
    approval.approvalRecordId,
    approval.binding.workId,
    approval.authority.policyId,
    approval.authority.capabilityGrantId,
    ...(approval.binding.predecessorCoreSurfaceSelectionReceipt
      ? [approval.binding.predecessorCoreSurfaceSelectionReceipt.receiptId]
      : []),
  ];
  const hashes = [
    approval.binding.workSnapshotSha256,
    approval.binding.currentSurfaceSha256,
    approval.binding.targetSurfaceSha256,
    approval.authority.policySha256,
    ...(approval.binding.predecessorCoreSurfaceSelectionReceipt
      ? [approval.binding.predecessorCoreSurfaceSelectionReceipt.receiptSha256]
      : []),
  ];
  if (
    new Set(identities).size !== identities.length ||
    new Set(hashes).size !== hashes.length
  ) {
    addAuthorityIssue(
      context,
      ["approvalId"],
      "Authority identities and content hashes must be distinct",
    );
  }
}

export const workspaceCoreSurfaceSelectionApprovalCoreSchema = z
  .object(approvalCoreShape)
  .strict()
  .superRefine(validateApprovalCore);

export const workspaceCoreSurfaceSelectionApprovalDocumentSchema = z
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
      approval.approvalRecordId,
      approval.approvalReceiptId,
      approval.binding.workId,
      approval.authority.policyId,
      approval.authority.capabilityGrantId,
      ...(approval.binding.predecessorCoreSurfaceSelectionReceipt
        ? [approval.binding.predecessorCoreSurfaceSelectionReceipt.receiptId]
        : []),
    ];
    const hashes = [
      approval.approvalReceiptSha256,
      approval.binding.workSnapshotSha256,
      approval.binding.currentSurfaceSha256,
      approval.binding.targetSurfaceSha256,
      approval.authority.policySha256,
      ...(approval.binding.predecessorCoreSurfaceSelectionReceipt
        ? [
            approval.binding.predecessorCoreSurfaceSelectionReceipt
              .receiptSha256,
          ]
        : []),
    ];
    if (
      new Set(identities).size !== identities.length ||
      new Set(hashes).size !== hashes.length
    ) {
      addAuthorityIssue(
        context,
        ["approvalReceiptId"],
        "Approval artifact identities and hashes must be distinct",
      );
    }
  });

const approvalCreationEffectsSchema = z
  .object({
    approvalCreated: z.literal(true),
    approvalConsumed: z.literal(false),
    coreSurfaceProjectionMutated: z.literal(false),
    defaultCoreSurfaceProjectionMutated: z.literal(false),
    coreSurfaceSelectionLineageMutated: z.literal(false),
    moduleReleaseAdmitted: z.literal(false),
    infrastructureMutated: z.literal(false),
    otherWorkspaceRead: z.literal(false),
    otherWorkspaceMutation: z.literal(false),
    workMutated: z.literal(false),
    policyMutated: z.literal(false),
    capabilityGrantMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
    artifactResolved: z.literal(false),
    artifactLoaded: z.literal(false),
    moduleRuntimeStarted: z.literal(false),
    moduleAdmitted: z.literal(false),
    moduleMigrated: z.literal(false),
    privateConsumerAuthorityGranted: z.literal(false),
  })
  .strict();

const approvalReceiptShape = {
  contract: z.literal(
    "vorton.workspace-core-surface-selection-approval-receipt.v1",
  ),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("workspace-postgres"),
  approvalId: canonicalUuid,
  approvalRecordId: canonicalUuid,
  approvalHash: sha256,
  ownerPersonId: canonicalUuid,
  binding: workspaceCoreSurfaceSelectionBindingSchema,
  authority: workspaceCoreSurfaceSelectionAuthoritySchema,
  approvedAt: utcMilliseconds,
  expiresAt: utcMilliseconds,
  createdAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  ownerMembershipVerifiedAt: utcMilliseconds,
  policyVerifiedAt: utcMilliseconds,
  capabilityGrantVerifiedAt: utcMilliseconds,
  workVerifiedAt: utcMilliseconds,
  currentSurfaceVerifiedAt: utcMilliseconds,
  scope: workspaceCoreSurfaceSelectionScopeSchema,
  rolesGrantAuthority: z.literal(false),
  effects: approvalCreationEffectsSchema,
} as const;

export const workspaceCoreSurfaceSelectionApprovalReceiptSchema = z
  .object({ ...approvalReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const verifiedAt = [
      receipt.createdAt,
      receipt.ownerMembershipVerifiedAt,
      receipt.policyVerifiedAt,
      receipt.capabilityGrantVerifiedAt,
      receipt.workVerifiedAt,
      receipt.currentSurfaceVerifiedAt,
    ];
    const approvedAt = milliseconds(receipt.approvedAt);
    const aal2VerifiedAt = milliseconds(receipt.aal2VerifiedAt);
    const identities = [
      receipt.receiptId,
      receipt.approvalId,
      receipt.approvalRecordId,
      receipt.binding.workId,
      receipt.authority.policyId,
      receipt.authority.capabilityGrantId,
      ...(receipt.binding.predecessorCoreSurfaceSelectionReceipt
        ? [receipt.binding.predecessorCoreSurfaceSelectionReceipt.receiptId]
        : []),
    ];
    const hashes = [
      receipt.receiptHash,
      receipt.approvalHash,
      receipt.binding.workSnapshotSha256,
      receipt.binding.currentSurfaceSha256,
      receipt.binding.targetSurfaceSha256,
      receipt.authority.policySha256,
      ...(receipt.binding.predecessorCoreSurfaceSelectionReceipt
        ? [receipt.binding.predecessorCoreSurfaceSelectionReceipt.receiptSha256]
        : []),
    ];
    if (
      receipt.authority.personId !== receipt.ownerPersonId ||
      receipt.authority.workId !== receipt.binding.workId ||
      verifiedAt.some((value) => value !== receipt.approvedAt) ||
      aal2VerifiedAt > approvedAt ||
      approvedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
      milliseconds(receipt.expiresAt) <= approvedAt ||
      milliseconds(receipt.expiresAt) > approvedAt + 24 * 60 * 60 * 1_000 ||
      new Set(identities).size !== identities.length ||
      new Set(hashes).size !== hashes.length
    ) {
      addAuthorityIssue(
        context,
        ["receiptId"],
        "Approval receipt does not bind exact no-effect authority",
      );
    }
  });

export const workspaceCoreSurfaceSelectionApprovalCreationSchema = z
  .object({
    approval: workspaceCoreSurfaceSelectionApprovalDocumentSchema,
    approvalReceipt: workspaceCoreSurfaceSelectionApprovalReceiptSchema,
  })
  .strict()
  .superRefine(({ approval, approvalReceipt }, context) => {
    if (
      approval.approvalReceiptId !== approvalReceipt.receiptId ||
      approval.approvalReceiptSha256 !== approvalReceipt.receiptHash ||
      approval.approvalId !== approvalReceipt.approvalId ||
      approval.approvalRecordId !== approvalReceipt.approvalRecordId ||
      approval.ownerPersonId !== approvalReceipt.ownerPersonId ||
      approval.approvedAt !== approvalReceipt.approvedAt ||
      approval.expiresAt !== approvalReceipt.expiresAt ||
      approval.aal2VerifiedAt !== approvalReceipt.aal2VerifiedAt ||
      !equalCanonical(approval.binding, approvalReceipt.binding) ||
      !equalCanonical(approval.authority, approvalReceipt.authority) ||
      !equalCanonical(approval.scope, approvalReceipt.scope)
    ) {
      addAuthorityIssue(
        context,
        ["approvalReceipt"],
        "Approval and its atomic no-effect receipt do not match",
      );
    }
  });

export function projectWorkspaceCoreSurfaceSelectionApprovalCore(
  value: unknown,
): WorkspaceCoreSurfaceSelectionApprovalCore {
  const approval =
    workspaceCoreSurfaceSelectionApprovalDocumentSchema.parse(value);
  const {
    approvalReceiptId: _approvalReceiptId,
    approvalReceiptSha256: _approvalReceiptSha256,
    ...core
  } = approval;
  return workspaceCoreSurfaceSelectionApprovalCoreSchema.parse(core);
}

export async function hashWorkspaceCoreSurfaceSelectionApprovalCore(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceCoreSurfaceSelectionApprovalCore(value),
  );
}

export function projectWorkspaceCoreSurfaceSelectionApprovalReceiptCore(
  value: unknown,
): Omit<WorkspaceCoreSurfaceSelectionApprovalReceipt, "receiptHash"> {
  const receipt =
    workspaceCoreSurfaceSelectionApprovalReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashWorkspaceCoreSurfaceSelectionApprovalReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceCoreSurfaceSelectionApprovalReceiptCore(value),
  );
}

export async function parseWorkspaceCoreSurfaceSelectionApprovalCreation(
  value: unknown,
): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
  const creation =
    workspaceCoreSurfaceSelectionApprovalCreationSchema.parse(value);
  const approvalHash = await hashWorkspaceCoreSurfaceSelectionApprovalCore(
    creation.approval,
  );
  const approvalReceiptHash =
    await hashWorkspaceCoreSurfaceSelectionApprovalReceipt(
      creation.approvalReceipt,
    );
  const currentSurfaceHash = await hashWorkspaceCoreSurface(
    creation.approval.binding.currentSurface,
  );
  const targetSurfaceHash = await hashWorkspaceCoreSurface(
    creation.approval.binding.targetSurface,
  );
  if (
    approvalHash !== creation.approvalReceipt.approvalHash ||
    approvalReceiptHash !== creation.approvalReceipt.receiptHash ||
    currentSurfaceHash !== creation.approval.binding.currentSurfaceSha256 ||
    targetSurfaceHash !== creation.approval.binding.targetSurfaceSha256
  ) {
    throw new Error(
      "Workspace core-surface selection approval hashes are invalid",
    );
  }
  return creation;
}

const selectionRowCountsSchema = z
  .object({
    preimageCoreSurfaceRows: z.number().int().safe().min(0).max(7),
    deletedCoreSurfaceRows: z.number().int().safe().min(0).max(7),
    insertedCoreSurfaceRows: z.number().int().safe().min(0).max(7),
    postimageCoreSurfaceRows: z.number().int().safe().min(0).max(7),
    defaultCoreSurfaceRowsUpdated: z.literal(1),
    coreSurfaceSelectionLineageRowsUpdated: z.literal(1),
    otherWorkspaceRowsRead: z.literal(0),
    otherWorkspaceRowsMutated: z.literal(0),
  })
  .strict();

const selectionIdempotencySchema = z
  .object({
    key: canonicalUuid,
    exactReplayReturnsSameReceipt: z.literal(true),
    conflictingReplayDenied: z.literal(true),
    additionalProjectionMutationsOnReplay: z.literal(0),
  })
  .strict();

const selectionEffectsSchema = z
  .object({
    approvalConsumed: z.literal(true),
    coreSurfaceProjectionReplaced: z.literal(true),
    defaultCoreSurfaceProjectionReplaced: z.literal(true),
    coreSurfaceSelectionLineageAdvanced: z.literal(true),
    moduleReleaseAdmitted: z.literal(false),
    infrastructureMutated: z.literal(false),
    otherWorkspaceRead: z.literal(false),
    otherWorkspaceMutation: z.literal(false),
    workMutated: z.literal(false),
    policyMutated: z.literal(false),
    capabilityGrantMutated: z.literal(false),
    externalSystemMutated: z.literal(false),
    artifactResolved: z.literal(false),
    artifactLoaded: z.literal(false),
    moduleRuntimeStarted: z.literal(false),
    moduleAdmitted: z.literal(false),
    moduleMigrated: z.literal(false),
    privateConsumerAuthorityGranted: z.literal(false),
  })
  .strict();

const selectionReceiptShape = {
  contract: z.literal("vorton.workspace-core-surface-selection-receipt.v1"),
  receiptId: canonicalUuid,
  receiptPlane: z.literal("workspace-postgres"),
  approvalId: canonicalUuid,
  approvalRecordId: canonicalUuid,
  approvalReceiptId: canonicalUuid,
  approvalReceiptSha256: sha256,
  approvalHash: sha256,
  binding: workspaceCoreSurfaceSelectionBindingSchema,
  authority: workspaceCoreSurfaceSelectionAuthoritySchema,
  scope: workspaceCoreSurfaceSelectionScopeSchema,
  approvedByPersonId: canonicalUuid,
  appliedByPersonId: canonicalUuid,
  approvalConsumptionCount: z.literal(1),
  approvalConsumedAt: utcMilliseconds,
  appliedAt: utcMilliseconds,
  aal2VerifiedAt: utcMilliseconds,
  assuranceLevel: z.literal("aal2"),
  ownerMembershipVerifiedAt: utcMilliseconds,
  policyVerifiedAt: utcMilliseconds,
  capabilityGrantVerifiedAt: utcMilliseconds,
  workSnapshotVerifiedAt: utcMilliseconds,
  currentSurfaceVerifiedAt: utcMilliseconds,
  predecessorCoreSurfaceSelectionReceipt:
    workspaceCoreSurfaceSelectionReceiptReferenceSchema.nullable(),
  preimageSurface: workspaceCoreSurfaceSchema,
  preimageSurfaceSha256: sha256,
  postimageSurface: workspaceCoreSurfaceSchema,
  postimageSurfaceSha256: sha256,
  rowCounts: selectionRowCountsSchema,
  idempotency: selectionIdempotencySchema,
  effects: selectionEffectsSchema,
} as const;

export const workspaceCoreSurfaceSelectionReceiptSchema = z
  .object({ ...selectionReceiptShape, receiptHash: sha256 })
  .strict()
  .superRefine((receipt, context) => {
    const verifiedAt = [
      receipt.approvalConsumedAt,
      receipt.appliedAt,
      receipt.ownerMembershipVerifiedAt,
      receipt.policyVerifiedAt,
      receipt.capabilityGrantVerifiedAt,
      receipt.workSnapshotVerifiedAt,
      receipt.currentSurfaceVerifiedAt,
    ];
    const appliedAt = milliseconds(receipt.appliedAt);
    const aal2VerifiedAt = milliseconds(receipt.aal2VerifiedAt);
    const identities = [
      receipt.receiptId,
      receipt.approvalId,
      receipt.approvalRecordId,
      receipt.approvalReceiptId,
      receipt.binding.workId,
      receipt.authority.policyId,
      receipt.authority.capabilityGrantId,
      ...(receipt.predecessorCoreSurfaceSelectionReceipt
        ? [receipt.predecessorCoreSurfaceSelectionReceipt.receiptId]
        : []),
    ];
    const hashes = [
      receipt.receiptHash,
      receipt.approvalReceiptSha256,
      receipt.approvalHash,
      receipt.binding.workSnapshotSha256,
      receipt.binding.currentSurfaceSha256,
      receipt.binding.targetSurfaceSha256,
      receipt.authority.policySha256,
      ...(receipt.predecessorCoreSurfaceSelectionReceipt
        ? [receipt.predecessorCoreSurfaceSelectionReceipt.receiptSha256]
        : []),
    ];
    if (
      receipt.approvedByPersonId !== receipt.appliedByPersonId ||
      receipt.authority.personId !== receipt.appliedByPersonId ||
      receipt.authority.workId !== receipt.binding.workId ||
      receipt.idempotency.key !== receipt.receiptId ||
      verifiedAt.some((value) => value !== receipt.appliedAt) ||
      aal2VerifiedAt > appliedAt ||
      appliedAt - aal2VerifiedAt > 10 * 60 * 1_000 ||
      !equalCanonical(
        receipt.preimageSurface,
        receipt.binding.currentSurface,
      ) ||
      receipt.preimageSurfaceSha256 !== receipt.binding.currentSurfaceSha256 ||
      !equalCanonical(
        receipt.predecessorCoreSurfaceSelectionReceipt,
        receipt.binding.predecessorCoreSurfaceSelectionReceipt,
      ) ||
      !equalCanonical(
        receipt.postimageSurface,
        receipt.binding.targetSurface,
      ) ||
      receipt.postimageSurfaceSha256 !== receipt.binding.targetSurfaceSha256 ||
      receipt.rowCounts.preimageCoreSurfaceRows !==
        receipt.preimageSurface.modules.length ||
      receipt.rowCounts.deletedCoreSurfaceRows !==
        receipt.preimageSurface.modules.length ||
      receipt.rowCounts.insertedCoreSurfaceRows !==
        receipt.postimageSurface.modules.length ||
      receipt.rowCounts.postimageCoreSurfaceRows !==
        receipt.postimageSurface.modules.length ||
      new Set(identities).size !== identities.length ||
      new Set(hashes).size !== hashes.length
    ) {
      addAuthorityIssue(
        context,
        ["receiptId"],
        "Selection receipt does not bind exact one-time projection replacement",
      );
    }
  });

export function projectWorkspaceCoreSurfaceSelectionReceiptCore(
  value: unknown,
): Omit<WorkspaceCoreSurfaceSelectionReceipt, "receiptHash"> {
  const receipt = workspaceCoreSurfaceSelectionReceiptSchema.parse(value);
  const { receiptHash: _receiptHash, ...core } = receipt;
  return core;
}

export async function hashWorkspaceCoreSurfaceSelectionReceipt(
  value: unknown,
): Promise<string> {
  return moduleLifecycleCanonicalSha256(
    projectWorkspaceCoreSurfaceSelectionReceiptCore(value),
  );
}

export async function parseWorkspaceCoreSurfaceSelectionReceipt(
  value: unknown,
  approvalCreation: unknown,
): Promise<WorkspaceCoreSurfaceSelectionReceipt> {
  const creation =
    await parseWorkspaceCoreSurfaceSelectionApprovalCreation(approvalCreation);
  const receipt = workspaceCoreSurfaceSelectionReceiptSchema.parse(value);
  const approvalHash = await hashWorkspaceCoreSurfaceSelectionApprovalCore(
    creation.approval,
  );
  const approvalReceiptHash =
    await hashWorkspaceCoreSurfaceSelectionApprovalReceipt(
      creation.approvalReceipt,
    );
  const preimageHash = await hashWorkspaceCoreSurface(receipt.preimageSurface);
  const postimageHash = await hashWorkspaceCoreSurface(
    receipt.postimageSurface,
  );
  const ids = [
    creation.approval.approvalId,
    creation.approval.approvalRecordId,
    creation.approval.approvalReceiptId,
    receipt.receiptId,
  ];
  const hashes = [
    approvalHash,
    approvalReceiptHash,
    creation.approval.binding.workSnapshotSha256,
    creation.approval.binding.currentSurfaceSha256,
    creation.approval.binding.targetSurfaceSha256,
    creation.approval.authority.policySha256,
    receipt.receiptHash,
  ];
  if (
    receipt.approvalId !== creation.approval.approvalId ||
    receipt.approvalRecordId !== creation.approval.approvalRecordId ||
    receipt.approvalReceiptId !== creation.approval.approvalReceiptId ||
    receipt.approvalReceiptSha256 !== approvalReceiptHash ||
    receipt.approvalHash !== approvalHash ||
    receipt.approvedByPersonId !== creation.approval.ownerPersonId ||
    receipt.appliedByPersonId !== creation.approval.ownerPersonId ||
    !equalCanonical(receipt.binding, creation.approval.binding) ||
    !equalCanonical(receipt.authority, creation.approval.authority) ||
    !equalCanonical(receipt.scope, creation.approval.scope) ||
    receipt.approvalConsumedAt < creation.approval.approvedAt ||
    receipt.approvalConsumedAt >= creation.approval.expiresAt ||
    preimageHash !== receipt.preimageSurfaceSha256 ||
    postimageHash !== receipt.postimageSurfaceSha256 ||
    new Set(ids).size !== ids.length ||
    new Set(hashes).size !== hashes.length
  ) {
    throw new Error(
      "Workspace core-surface selection receipt does not match its exact approval authority",
    );
  }
  if (
    (await hashWorkspaceCoreSurfaceSelectionReceipt(receipt)) !==
    receipt.receiptHash
  ) {
    throw new Error("Workspace core-surface selection receipt hash is invalid");
  }
  return receipt;
}

export type WorkspaceCoreSurfaceProjection = z.infer<
  typeof workspaceCoreSurfaceProjectionSchema
>;
export type WorkspaceCoreSurface = z.infer<typeof workspaceCoreSurfaceSchema>;
export type WorkspaceCoreSurfacePreferences = z.infer<
  typeof workspaceCoreSurfacePreferencesSchema
>;
export type WorkspaceCoreSurfaceSelectionWorkSnapshot = z.infer<
  typeof workspaceCoreSurfaceSelectionWorkSnapshotSchema
>;
export type WorkspaceCoreSurfaceSelectionBinding = z.infer<
  typeof workspaceCoreSurfaceSelectionBindingSchema
>;
export type WorkspaceCoreSurfaceSelectionReceiptReference = z.infer<
  typeof workspaceCoreSurfaceSelectionReceiptReferenceSchema
>;
export type WorkspaceCoreSurfaceSelectionAuthority = z.infer<
  typeof workspaceCoreSurfaceSelectionAuthoritySchema
>;
export type WorkspaceCoreSurfaceSelectionApprovalRequest = z.infer<
  typeof workspaceCoreSurfaceSelectionApprovalRequestSchema
>;
export type WorkspaceCoreSurfaceSelectionApplyRequest = z.infer<
  typeof workspaceCoreSurfaceSelectionApplyRequestSchema
>;
export type WorkspaceCoreSurfaceSelectionApprovalCore = z.infer<
  typeof workspaceCoreSurfaceSelectionApprovalCoreSchema
>;
export type WorkspaceCoreSurfaceSelectionApproval = z.infer<
  typeof workspaceCoreSurfaceSelectionApprovalDocumentSchema
>;
export type WorkspaceCoreSurfaceSelectionApprovalReceipt = z.infer<
  typeof workspaceCoreSurfaceSelectionApprovalReceiptSchema
>;
export type WorkspaceCoreSurfaceSelectionApprovalCreation = z.infer<
  typeof workspaceCoreSurfaceSelectionApprovalCreationSchema
>;
export type WorkspaceCoreSurfaceSelectionReceipt = z.infer<
  typeof workspaceCoreSurfaceSelectionReceiptSchema
>;
