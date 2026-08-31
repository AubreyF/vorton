import { z } from "zod";

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sourceCommit = z.string().regex(/^[a-f0-9]{40}$/);
const migrationHead = z.string().regex(/^\d{14}_[a-z0-9_]+$/);
const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const canonicalSemver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
const utcMilliseconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .datetime();

function milliseconds(value: string): number {
  return Date.parse(value);
}

export const releaseAdoptionReleaseSchema = z
  .object({
    version: canonicalSemver,
    sourceCommit,
    manifestSha256: sha256,
    archiveSha256: sha256,
    coreMigrationHead: migrationHead,
    workspaceIsolationProofSha256: sha256,
    workspaceIsolationProofHash: sha256,
    imageDigests: z.record(identifier, sha256),
  })
  .strict()
  .superRefine((release, context) => {
    if (
      release.workspaceIsolationProofSha256 ===
      release.workspaceIsolationProofHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["workspaceIsolationProofHash"],
        message: "Proof byte digest and canonical proof hash must differ",
      });
    }
    if (Object.keys(release.imageDigests).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["imageDigests"],
        message: "At least one immutable image digest is required",
      });
    }
  });

export const adoptedReleaseProjectionSchema = z
  .object({
    adoptionReceiptId: uuid,
    adoptionReceiptSha256: sha256,
    receiptPlane: z.literal("installation-postgres"),
    manifestSha256: sha256,
    sourceCommit,
    migrationHead,
    workspaceIsolationProofSha256: sha256,
    workspaceIsolationProofHash: sha256,
    status: z.literal("adopted"),
    adoptedAt: utcMilliseconds,
  })
  .strict()
  .superRefine((release, context) => {
    if (
      release.workspaceIsolationProofSha256 ===
      release.workspaceIsolationProofHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["workspaceIsolationProofHash"],
        message: "Proof byte digest and canonical proof hash must differ",
      });
    }
  });

export const releaseAdoptionApprovalRequestSchema = z
  .object({
    approvalId: uuid,
    planHash: sha256,
    release: releaseAdoptionReleaseSchema,
    expiresAt: utcMilliseconds,
  })
  .strict();

export const workspaceCreationApprovalRequestSchema = z
  .object({
    approvalId: uuid,
    workspace: z
      .object({
        id: uuid,
        slug: identifier,
        displayName: z.string().trim().min(1).max(120),
        realm: z.enum(["personal", "organizational"]),
      })
      .strict(),
    releaseAdoptionReceiptId: uuid,
    releaseAdoptionReceiptSha256: sha256,
    workspacePlanSha256: sha256,
  })
  .strict();

const releaseAdoptionScopeSchema = z
  .object({
    adoptRelease: z.literal(true),
    installRelease: z.literal(false),
    mutateInstallation: z.literal(false),
    createWorkspace: z.literal(false),
    createInfrastructure: z.literal(false),
    inspectFreedos: z.literal(false),
    personalSourceRead: z.literal(false),
    dataMigration: z.literal(false),
  })
  .strict();

export const releaseAdoptionApprovalDocumentSchema = z
  .object({
    contract: z.literal("vorton.release-adoption-approval.v1"),
    approvalId: uuid,
    approvalPlane: z.literal("installation-postgres"),
    installationId: uuid,
    approvedByPersonId: uuid,
    planHash: sha256,
    release: releaseAdoptionReleaseSchema,
    manifestSha256: sha256,
    archiveSha256: sha256,
    sourceCommit,
    approvedAt: utcMilliseconds,
    expiresAt: utcMilliseconds,
    aal2VerifiedAt: utcMilliseconds,
    assuranceLevel: z.literal("aal2"),
    installationOwnerVerifiedAt: utcMilliseconds,
    scope: releaseAdoptionScopeSchema,
  })
  .strict()
  .superRefine((approval, context) => {
    if (
      approval.manifestSha256 !== approval.release.manifestSha256 ||
      approval.archiveSha256 !== approval.release.archiveSha256 ||
      approval.sourceCommit !== approval.release.sourceCommit
    ) {
      context.addIssue({
        code: "custom",
        path: ["release"],
        message: "Release projections must match the complete approved release",
      });
    }
    const approvedAt = milliseconds(approval.approvedAt);
    const aal2At = milliseconds(approval.aal2VerifiedAt);
    const expiresAt = milliseconds(approval.expiresAt);
    if (
      approval.installationOwnerVerifiedAt !== approval.approvedAt ||
      aal2At > approvedAt + 60 * 1_000 ||
      approvedAt - aal2At > 10 * 60 * 1_000 ||
      expiresAt <= approvedAt ||
      expiresAt > approvedAt + 24 * 60 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["approvedAt"],
        message:
          "Approval timestamps violate the installation authority window",
      });
    }
  });

const releaseAdoptionStateSchema = z
  .object({
    installationMutated: z.literal(false),
    releaseInstalled: z.literal(false),
    workspaceCreated: z.literal(false),
    infrastructureCreated: z.literal(false),
    personalSourceRead: z.literal(false),
    dataMigrated: z.literal(false),
    freedosInspected: z.literal(false),
  })
  .strict();

export const releaseAdoptionReceiptDocumentSchema = z
  .object({
    contract: z.literal("vorton.release-adoption-receipt.v1"),
    receiptId: uuid,
    receiptPlane: z.literal("installation-postgres"),
    installationId: uuid,
    ownerPersonId: uuid,
    approvalId: uuid,
    planHash: sha256,
    release: releaseAdoptionReleaseSchema,
    status: z.literal("adopted"),
    adoptedAt: utcMilliseconds,
    approvalConsumedAt: utcMilliseconds,
    approvalConsumptionCount: z.literal(1),
    state: releaseAdoptionStateSchema,
    receiptHash: sha256,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.receiptId === receipt.approvalId ||
      receipt.adoptedAt !== receipt.approvalConsumedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["receiptId"],
        message: "Receipt identity or consumption time is invalid",
      });
    }
  });

export const workspaceCreationApprovalDocumentSchema = z
  .object({
    contract: z.literal("vorton.workspace-creation-approval.v1"),
    approvalId: uuid,
    approvalPlane: z.literal("installation-postgres"),
    installationId: uuid,
    approvedByPersonId: uuid,
    workspace: z
      .object({
        id: uuid,
        slug: identifier,
        displayName: z.string().trim().min(1).max(120),
        realm: z.enum(["personal", "organizational"]),
      })
      .strict(),
    adoptedRelease: adoptedReleaseProjectionSchema,
    workspacePlanSha256: sha256,
    scope: z.literal("workspace.create"),
    assuranceLevel: z.literal("aal2"),
    aal2VerifiedAt: utcMilliseconds,
    approvedAt: utcMilliseconds,
    expiresAt: utcMilliseconds,
  })
  .strict()
  .superRefine((approval, context) => {
    const approvedAt = milliseconds(approval.approvedAt);
    const aal2At = milliseconds(approval.aal2VerifiedAt);
    const expiresAt = milliseconds(approval.expiresAt);
    if (
      aal2At > approvedAt + 60 * 1_000 ||
      approvedAt - aal2At > 10 * 60 * 1_000 ||
      expiresAt <= approvedAt ||
      expiresAt > aal2At + 10 * 60 * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["approvedAt"],
        message: "Approval timestamps violate the workspace authority window",
      });
    }
  });

export const workspaceCreationReceiptDocumentSchema = z
  .object({
    contract: z.literal("vorton.workspace-creation-receipt.v1"),
    receiptId: uuid,
    receiptPlane: z.literal("installation-postgres"),
    installationId: uuid,
    approvalId: uuid,
    workspaceId: uuid,
    ownerPersonId: uuid,
    releaseAdoptionReceiptId: uuid,
    releaseAdoptionReceiptSha256: sha256,
    sourceCommit,
    workspacePlanSha256: sha256,
    status: z.literal("created"),
    createdAt: utcMilliseconds,
    approvalConsumedAt: utcMilliseconds,
    approvalConsumptionCount: z.literal(1),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.receiptId === receipt.approvalId) {
      context.addIssue({
        code: "custom",
        path: ["receiptId"],
        message: "Workspace receipt ID must differ from approval ID",
      });
    }
    if (receipt.createdAt !== receipt.approvalConsumedAt) {
      context.addIssue({
        code: "custom",
        path: ["approvalConsumedAt"],
        message:
          "Workspace approval consumption must be atomic with its receipt",
      });
    }
  });

export type ReleaseAdoptionRelease = z.infer<
  typeof releaseAdoptionReleaseSchema
>;
export type ReleaseAdoptionApprovalRequest = z.infer<
  typeof releaseAdoptionApprovalRequestSchema
>;
export type ReleaseAdoptionApprovalDocument = z.infer<
  typeof releaseAdoptionApprovalDocumentSchema
>;
export type ReleaseAdoptionReceiptDocument = z.infer<
  typeof releaseAdoptionReceiptDocumentSchema
>;
export type WorkspaceCreationApprovalRequest = z.infer<
  typeof workspaceCreationApprovalRequestSchema
>;
export type WorkspaceCreationApprovalDocument = z.infer<
  typeof workspaceCreationApprovalDocumentSchema
>;
export type WorkspaceCreationReceiptDocument = z.infer<
  typeof workspaceCreationReceiptDocumentSchema
>;
