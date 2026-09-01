import {
  parseWorkspaceMembershipRevocationApprovalCreation,
  parseWorkspaceMembershipRevocationReceipt,
  workspaceMembershipRevocationApplyRequestSchema,
  workspaceMembershipRevocationApprovalRequestSchema,
  type WorkspaceMembershipRevocationApplyRequest,
  type WorkspaceMembershipRevocationApprovalCreation,
  type WorkspaceMembershipRevocationApprovalRequest,
  type WorkspaceMembershipRevocationReceipt,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import {
  StepUpAuthenticationError,
  recentAal2MaxAgeSeconds,
  type AuthenticatedIdentity,
} from "./auth.js";

export class WorkspaceMembershipRevocationInputError extends Error {}
export class WorkspaceMembershipRevocationForbiddenError extends Error {}
export class WorkspaceMembershipRevocationConflictError extends Error {}
export class WorkspaceMembershipRevocationIntegrityError extends Error {}

const forbiddenDatabaseErrors = new Set([
  "Target workspace does not exist",
  "Signed recent workspace-person AAL2 is required",
  "A live workspace owner is required to approve revocation",
  "A live workspace owner is required to apply or replay revocation",
  "The same live workspace owner must apply or replay revocation",
  "The same live workspace owner must approve and apply revocation",
  "Exact ready person-custodied Work is required",
  "Exact Work-scoped capability grant does not exist",
  "Exact live person Work-scoped revocation capability is required",
  "Approved Work, Policy, or capability authority changed",
]);

const inputDatabaseErrors = new Set([
  "Exact workspace membership revocation approval request is invalid",
  "Exact workspace membership revocation apply request is invalid",
  "Revocation approval expiry must be within 24 hours",
  "Target membership kind does not match the approval request",
  "Self-revocation is forbidden",
  "Approval, Policy, and grant identities must be distinct",
  "Revocation receipt identity conflicts with authority",
]);

const conflictDatabaseErrors = new Set([
  "Membership revocation approval retry conflicts with immutable authority",
  "Membership revocation receipt retry conflicts with immutable application",
  "Target live workspace membership does not exist",
  "Exact target membership is no longer live",
  "Exact membership revocation approval does not exist",
  "Existing membership revocation lacks exact product receipt",
  "The final live workspace owner cannot be revoked",
  "Workspace owner continuity changed during revocation",
]);

function classifyDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code !== "P0001") throw error;
  if (forbiddenDatabaseErrors.has(message)) {
    throw new WorkspaceMembershipRevocationForbiddenError(
      "Live workspace owner authority, exact Work scope, and recent AAL2 are required",
    );
  }
  if (inputDatabaseErrors.has(message)) {
    throw new WorkspaceMembershipRevocationInputError(
      "The workspace membership revocation request is invalid",
    );
  }
  if (conflictDatabaseErrors.has(message)) {
    throw new WorkspaceMembershipRevocationConflictError(
      "The request conflicts with immutable workspace membership authority",
    );
  }
  throw new WorkspaceMembershipRevocationIntegrityError(
    "Workspace membership revocation authority failed closed",
  );
}

export function requireWorkspaceMembershipRevocationRecentAal2(
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
      "Recent AAL2 step-up authentication is required for workspace membership revocation",
    );
  }
}

function parseApprovalRequest(
  request: WorkspaceMembershipRevocationApprovalRequest,
): WorkspaceMembershipRevocationApprovalRequest {
  const parsed =
    workspaceMembershipRevocationApprovalRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new WorkspaceMembershipRevocationInputError(
      "The workspace membership revocation approval request is invalid",
    );
  }
  return parsed.data;
}

function parseApplyRequest(
  request: WorkspaceMembershipRevocationApplyRequest,
): WorkspaceMembershipRevocationApplyRequest {
  const parsed =
    workspaceMembershipRevocationApplyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new WorkspaceMembershipRevocationInputError(
      "The workspace membership revocation apply request is invalid",
    );
  }
  return parsed.data;
}

async function parseDatabaseCreation(
  value: unknown,
): Promise<WorkspaceMembershipRevocationApprovalCreation> {
  try {
    return await parseWorkspaceMembershipRevocationApprovalCreation(value);
  } catch {
    throw new WorkspaceMembershipRevocationIntegrityError(
      "Database returned an invalid workspace membership revocation approval",
    );
  }
}

async function parseDatabaseApplication(value: unknown): Promise<{
  approval: WorkspaceMembershipRevocationApprovalCreation["approval"];
  approvalReceipt: WorkspaceMembershipRevocationApprovalCreation["approvalReceipt"];
  receipt: WorkspaceMembershipRevocationReceipt;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceMembershipRevocationIntegrityError(
      "Database returned an invalid workspace membership revocation application",
    );
  }
  const candidate = value as Record<string, unknown>;
  const creation = await parseDatabaseCreation({
    approval: candidate.approval,
    approvalReceipt: candidate.approvalReceipt,
  });
  try {
    const receipt = await parseWorkspaceMembershipRevocationReceipt(
      candidate.receipt,
      creation,
    );
    return { ...creation, receipt };
  } catch {
    throw new WorkspaceMembershipRevocationIntegrityError(
      "Database returned an invalid workspace membership revocation receipt",
    );
  }
}

function assertApprovalProjection(
  installationId: string,
  workspaceId: string,
  request: WorkspaceMembershipRevocationApprovalRequest,
  creation: WorkspaceMembershipRevocationApprovalCreation,
): void {
  const approval = creation.approval;
  if (
    approval.approvalId !== request.approvalId ||
    approval.binding.vortonInstallationId !== installationId ||
    approval.binding.workspaceId !== workspaceId ||
    approval.binding.targetPersonId !== request.targetPersonId ||
    approval.binding.targetPersonKind !== request.expectedTargetKind ||
    approval.binding.workId !== request.workId ||
    approval.authority.capabilityGrantId !== request.capabilityGrantId ||
    approval.expiresAt !== request.expiresAt
  ) {
    throw new WorkspaceMembershipRevocationIntegrityError(
      "Database approval violated the exact workspace membership revocation request",
    );
  }
}

function assertApplicationProjection(
  installationId: string,
  workspaceId: string,
  approvalId: string,
  request: WorkspaceMembershipRevocationApplyRequest,
  application: Awaited<ReturnType<typeof parseDatabaseApplication>>,
): void {
  if (
    application.approval.approvalId !== approvalId ||
    application.receipt.approvalId !== approvalId ||
    application.receipt.receiptId !== request.receiptId ||
    application.receipt.binding.vortonInstallationId !== installationId ||
    application.receipt.binding.workspaceId !== workspaceId
  ) {
    throw new WorkspaceMembershipRevocationIntegrityError(
      "Database application violated the exact workspace membership revocation request",
    );
  }
}

export class DatabaseWorkspaceMembershipRevocationAuthority {
  constructor(private readonly database: Database) {}

  async approve(
    installationId: string,
    workspaceId: string,
    request: WorkspaceMembershipRevocationApprovalRequest,
    identity: AuthenticatedIdentity,
  ): Promise<WorkspaceMembershipRevocationApprovalCreation> {
    requireWorkspaceMembershipRevocationRecentAal2(identity);
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
            `select public.create_workspace_membership_revocation_approval(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::public.person_kind, $6::uuid, $7::uuid, $8::timestamptz
             ) as creation`,
            [
              exactRequest.approvalId,
              installationId,
              workspaceId,
              exactRequest.targetPersonId,
              exactRequest.expectedTargetKind,
              exactRequest.workId,
              exactRequest.capabilityGrantId,
              exactRequest.expiresAt,
            ],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new WorkspaceMembershipRevocationIntegrityError(
              "Database returned an ambiguous workspace membership revocation approval",
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
    request: WorkspaceMembershipRevocationApplyRequest,
    identity: AuthenticatedIdentity,
  ): Promise<Awaited<ReturnType<typeof parseDatabaseApplication>>> {
    requireWorkspaceMembershipRevocationRecentAal2(identity);
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
            `select public.apply_workspace_membership_revocation(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid
             ) as application`,
            [exactRequest.receiptId, approvalId, installationId, workspaceId],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new WorkspaceMembershipRevocationIntegrityError(
              "Database returned an ambiguous workspace membership revocation application",
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
