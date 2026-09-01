import {
  canonicalWorkspaceCoreSurfaceSelectionJson,
  parseWorkspaceCoreSurfaceSelectionApprovalCreation,
  parseWorkspaceCoreSurfaceSelectionReceipt,
  workspaceCoreSurfaceSelectionApplyRequestSchema,
  workspaceCoreSurfaceSelectionApprovalRequestSchema,
  type WorkspaceCoreSurfaceSelectionApplyRequest,
  type WorkspaceCoreSurfaceSelectionApprovalCreation,
  type WorkspaceCoreSurfaceSelectionApprovalRequest,
  type WorkspaceCoreSurfaceSelectionReceipt,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import {
  StepUpAuthenticationError,
  recentAal2MaxAgeSeconds,
  type AuthenticatedIdentity,
} from "./auth.js";

export class WorkspaceCoreSurfaceSelectionInputError extends Error {}
export class WorkspaceCoreSurfaceSelectionForbiddenError extends Error {}
export class WorkspaceCoreSurfaceSelectionConflictError extends Error {}
export class WorkspaceCoreSurfaceSelectionIntegrityError extends Error {}

const forbiddenDatabaseErrors = new Set([
  "Target workspace does not exist",
  "Signed recent workspace-person AAL2 is required",
  "A live workspace owner is required to approve core-surface selection",
  "A live workspace owner is required to apply or replay core-surface selection",
  "The same live workspace owner must apply or replay core-surface selection",
  "Exact ready person-custodied Work is required",
  "Exact Work-scoped capability grant does not exist",
  "Exact live person Work-scoped core-surface selection capability is required",
  "Approved Work, Policy, or capability authority changed",
]);

const inputDatabaseErrors = new Set([
  "Exact workspace core-surface selection approval request is invalid",
  "Exact workspace core-surface selection apply request is invalid",
  "Core-surface selection approval expiry must be within 24 hours",
  "Workspace module surface must have exact default and modules fields",
  "Workspace module surface exceeds the supported module count",
  "Workspace default module is invalid",
  "Workspace module tuple has an invalid shape",
  "Workspace module navigation order is invalid",
  "Workspace module label is invalid",
  "Unsupported workspace module tuple",
  "Compiled core-surface projection contains an unsupported tuple",
  "Workspace module identifiers must be unique",
  "Workspace module navigation orders must be unique",
  "An empty module surface requires a null default module",
  "A nonempty module surface requires a default module",
  "Workspace default module must be activated",
  "Target workspace module surface is not canonically ordered",
  "Core-surface selection must change the exact compiled surface",
  "Core-surface selection receipt identity conflicts with authority",
  "Workspace core-surface selection request reuses an authority identity or hash",
  "Compiled core-surface registry digest drifted",
  "Core-surface default must be a selected registry entry",
  "Empty core-surface preferences require a null default",
  "Target workspace core-surface preferences are not canonically ordered",
  "Unsupported workspace core-surface tuple",
  "Workspace core-surface preference has an invalid shape",
  "Workspace core-surface preference is invalid",
  "Workspace core-surface preferences exceed the registry",
  "Workspace core-surface preferences have an invalid shape",
  "Workspace core-surface preferences must be unique",
  "Workspace default core-surface preference is invalid",
]);

const conflictDatabaseErrors = new Set([
  "Core-surface selection approval retry conflicts with immutable authority",
  "Core-surface selection receipt retry conflicts with immutable application",
  "Exact workspace core-surface selection approval does not exist",
  "Expected current workspace module surface hash does not match",
  "Expected predecessor core-surface selection receipt is invalid",
  "Current workspace module surface lacks exact receipt lineage",
  "Current workspace module surface changed after approval",
  "Approved workspace core-surface selection predecessor is no longer terminal",
]);

function classifyDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code !== "P0001") throw error;
  if (forbiddenDatabaseErrors.has(message)) {
    throw new WorkspaceCoreSurfaceSelectionForbiddenError(
      "Live workspace owner authority, exact Work scope, and recent AAL2 are required",
    );
  }
  if (inputDatabaseErrors.has(message)) {
    throw new WorkspaceCoreSurfaceSelectionInputError(
      "The workspace core-surface selection request is invalid",
    );
  }
  if (conflictDatabaseErrors.has(message)) {
    throw new WorkspaceCoreSurfaceSelectionConflictError(
      "The request conflicts with immutable workspace core-surface authority",
    );
  }
  throw new WorkspaceCoreSurfaceSelectionIntegrityError(
    "Workspace core-surface selection authority failed closed",
  );
}

export function requireWorkspaceCoreSurfaceSelectionRecentAal2(
  identity: AuthenticatedIdentity,
  nowSeconds = Math.floor(Date.now() / 1_000),
): asserts identity is AuthenticatedIdentity & {
  aal: "aal2";
  authTime: number;
} {
  const authTime = identity.authTime;
  if (
    identity.aal !== "aal2" ||
    authTime === undefined ||
    !Number.isInteger(authTime) ||
    authTime > nowSeconds ||
    nowSeconds - authTime > recentAal2MaxAgeSeconds // gitleaks:allow
  ) {
    throw new StepUpAuthenticationError(
      "Recent AAL2 step-up authentication is required for workspace core-surface selection",
    );
  }
}

function parseApprovalRequest(
  request: WorkspaceCoreSurfaceSelectionApprovalRequest,
): WorkspaceCoreSurfaceSelectionApprovalRequest {
  const parsed =
    workspaceCoreSurfaceSelectionApprovalRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new WorkspaceCoreSurfaceSelectionInputError(
      "The workspace core-surface selection approval request is invalid",
    );
  }
  return parsed.data;
}

function parseApplyRequest(
  request: WorkspaceCoreSurfaceSelectionApplyRequest,
): WorkspaceCoreSurfaceSelectionApplyRequest {
  const parsed =
    workspaceCoreSurfaceSelectionApplyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new WorkspaceCoreSurfaceSelectionInputError(
      "The workspace core-surface selection apply request is invalid",
    );
  }
  return parsed.data;
}

async function parseDatabaseCreation(
  value: unknown,
): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
  try {
    return await parseWorkspaceCoreSurfaceSelectionApprovalCreation(value);
  } catch {
    throw new WorkspaceCoreSurfaceSelectionIntegrityError(
      "Database returned an invalid workspace core-surface selection approval",
    );
  }
}

async function parseDatabaseApplication(value: unknown): Promise<{
  approval: WorkspaceCoreSurfaceSelectionApprovalCreation["approval"];
  approvalReceipt: WorkspaceCoreSurfaceSelectionApprovalCreation["approvalReceipt"];
  receipt: WorkspaceCoreSurfaceSelectionReceipt;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceCoreSurfaceSelectionIntegrityError(
      "Database returned an invalid workspace core-surface selection application",
    );
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "approval" ||
    keys[1] !== "approvalReceipt" ||
    keys[2] !== "receipt"
  ) {
    throw new WorkspaceCoreSurfaceSelectionIntegrityError(
      "Database returned an invalid workspace core-surface selection application",
    );
  }
  const creation = await parseDatabaseCreation({
    approval: candidate.approval,
    approvalReceipt: candidate.approvalReceipt,
  });
  try {
    const receipt = await parseWorkspaceCoreSurfaceSelectionReceipt(
      candidate.receipt,
      creation,
    );
    return { ...creation, receipt };
  } catch {
    throw new WorkspaceCoreSurfaceSelectionIntegrityError(
      "Database returned an invalid workspace core-surface selection receipt",
    );
  }
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return (
    canonicalWorkspaceCoreSurfaceSelectionJson(left) ===
    canonicalWorkspaceCoreSurfaceSelectionJson(right)
  );
}

function assertApprovalProjection(
  installationId: string,
  workspaceId: string,
  request: WorkspaceCoreSurfaceSelectionApprovalRequest,
  creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
): void {
  const approval = creation.approval;
  if (
    approval.approvalId !== request.approvalId ||
    approval.binding.vortonInstallationId !== installationId ||
    approval.binding.workspaceId !== workspaceId ||
    approval.binding.workId !== request.workId ||
    approval.authority.capabilityGrantId !== request.capabilityGrantId ||
    approval.binding.currentSurfaceSha256 !==
      request.expectedCurrentSurfaceSha256 ||
    approval.binding.compiledRegistrySha256 !==
      request.compiledRegistrySha256 ||
    !equalCanonical(
      approval.binding.predecessorCoreSurfaceSelectionReceipt,
      request.expectedPredecessorCoreSurfaceSelectionReceipt,
    ) ||
    !equalCanonical(
      approval.binding.targetPreferences,
      request.targetPreferences,
    ) ||
    approval.expiresAt !== request.expiresAt
  ) {
    throw new WorkspaceCoreSurfaceSelectionIntegrityError(
      "Database approval violated the exact workspace core-surface selection request",
    );
  }
}

function assertApplicationProjection(
  installationId: string,
  workspaceId: string,
  approvalId: string,
  request: WorkspaceCoreSurfaceSelectionApplyRequest,
  application: Awaited<ReturnType<typeof parseDatabaseApplication>>,
): void {
  if (
    application.approval.approvalId !== approvalId ||
    application.receipt.approvalId !== approvalId ||
    application.receipt.receiptId !== request.receiptId ||
    application.receipt.binding.vortonInstallationId !== installationId ||
    application.receipt.binding.workspaceId !== workspaceId
  ) {
    throw new WorkspaceCoreSurfaceSelectionIntegrityError(
      "Database application violated the exact workspace core-surface selection request",
    );
  }
}

export class DatabaseWorkspaceCoreSurfaceSelectionAuthority {
  constructor(private readonly database: Database) {}

  async approve(
    installationId: string,
    workspaceId: string,
    request: WorkspaceCoreSurfaceSelectionApprovalRequest,
    identity: AuthenticatedIdentity,
  ): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> {
    requireWorkspaceCoreSurfaceSelectionRecentAal2(identity);
    const exactRequest = parseApprovalRequest(request);

    try {
      return await this.database.asWorkspacePersonWithStepUp(
        {
          authUserId: identity.authUserId,
          vortonInstallationId: installationId,
          workspaceId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        async (transaction) => {
          const result = await transaction.query<{ creation: unknown }>(
            `select public.create_workspace_core_surface_selection_approval(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
               $6::text, $7::text, $8::jsonb, $9::jsonb, $10::timestamptz
             ) as creation`,
            [
              exactRequest.approvalId,
              installationId,
              workspaceId,
              exactRequest.workId,
              exactRequest.capabilityGrantId,
              exactRequest.compiledRegistrySha256,
              exactRequest.expectedCurrentSurfaceSha256,
              exactRequest.expectedPredecessorCoreSurfaceSelectionReceipt,
              exactRequest.targetPreferences,
              exactRequest.expiresAt,
            ],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new WorkspaceCoreSurfaceSelectionIntegrityError(
              "Database returned an ambiguous workspace core-surface selection approval",
            );
          }
          const creation = await parseDatabaseCreation(
            result.rows[0]?.creation,
          );
          assertApprovalProjection(
            installationId,
            workspaceId,
            exactRequest,
            creation,
          );
          return creation;
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }

  async apply(
    installationId: string,
    workspaceId: string,
    approvalId: string,
    request: WorkspaceCoreSurfaceSelectionApplyRequest,
    identity: AuthenticatedIdentity,
  ): Promise<Awaited<ReturnType<typeof parseDatabaseApplication>>> {
    requireWorkspaceCoreSurfaceSelectionRecentAal2(identity);
    const exactRequest = parseApplyRequest(request);

    try {
      return await this.database.asWorkspacePersonWithStepUp(
        {
          authUserId: identity.authUserId,
          vortonInstallationId: installationId,
          workspaceId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        async (transaction) => {
          const result = await transaction.query<{ application: unknown }>(
            `select public.apply_workspace_core_surface_selection(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid
             ) as application`,
            [exactRequest.receiptId, approvalId, installationId, workspaceId],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new WorkspaceCoreSurfaceSelectionIntegrityError(
              "Database returned an ambiguous workspace core-surface selection application",
            );
          }
          const application = await parseDatabaseApplication(
            result.rows[0]?.application,
          );
          assertApplicationProjection(
            installationId,
            workspaceId,
            approvalId,
            exactRequest,
            application,
          );
          return application;
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }
}
