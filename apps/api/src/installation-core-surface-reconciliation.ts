import {
  installationCoreSurfaceReconciliationApplicationSchema,
  installationCoreSurfaceReconciliationApprovalCreationSchema,
  installationCoreSurfaceReconciliationApplyRequestSchema,
  installationCoreSurfaceReconciliationApprovalRequestSchema,
  installationCoreSurfaceReconciliationPlanRequestSchema,
  parseInstallationCoreSurfaceReconciliationApprovalCreation,
  parseInstallationCoreSurfaceReconciliationPlan,
  type InstallationCoreSurfaceReconciliationApplication,
  type InstallationCoreSurfaceReconciliationApprovalCreation,
  type InstallationCoreSurfaceReconciliationApplyRequest,
  type InstallationCoreSurfaceReconciliationApprovalRequest,
  type InstallationCoreSurfaceReconciliationPlan,
  type InstallationCoreSurfaceReconciliationPlanRequest,
} from "@vorton/contracts";
import type { Database, SqlExecutor } from "@vorton/database";

import {
  StepUpAuthenticationError,
  recentAal2MaxAgeSeconds,
  type AuthenticatedIdentity,
} from "./auth.js";

export class InstallationCoreSurfaceReconciliationInputError extends Error {}
export class InstallationCoreSurfaceReconciliationForbiddenError extends Error {}
export class InstallationCoreSurfaceReconciliationConflictError extends Error {}
export class InstallationCoreSurfaceReconciliationIntegrityError extends Error {}

const forbiddenDatabaseErrors = new Set([
  "Signed recent installation-person AAL2 is required",
  "Live installation owner authority is required",
  "Live unexpired installation-owner authority is required",
]);

const inputDatabaseErrors = new Set([
  "Installation reconciliation approval expiry is invalid",
  "Installation reconciliation approval identities conflict",
  "Installation reconciliation receipt identity conflicts with authority",
]);

const conflictDatabaseErrors = new Set([
  "Exact adopted Vorton release receipt is required",
  "Adopted release does not carry reconciliation authority",
  "Installation contains no eligible legacy core surface",
  "Installation core-surface reconciliation target is unavailable",
  "Exact installation reconciliation plan hash is required",
  "Installation reconciliation approval retry conflicts with immutable authority",
  "Exact installation reconciliation approval is required",
  "Installation reconciliation authority changed before application",
  "Installation reconciliation retry conflicts with immutable receipt",
  "Installation reconciliation workspace preimage changed",
]);

function classifyDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code !== "P0001") throw error;
  if (forbiddenDatabaseErrors.has(message)) {
    throw new InstallationCoreSurfaceReconciliationForbiddenError(
      "Live installation owner authority with recent AAL2 is required",
    );
  }
  if (inputDatabaseErrors.has(message)) {
    throw new InstallationCoreSurfaceReconciliationInputError(
      "The installation core-surface reconciliation request is invalid",
    );
  }
  if (conflictDatabaseErrors.has(message)) {
    throw new InstallationCoreSurfaceReconciliationConflictError(
      "The request conflicts with immutable installation core-surface authority",
    );
  }
  throw new InstallationCoreSurfaceReconciliationIntegrityError(
    "Installation core-surface reconciliation authority failed closed",
  );
}

export function requireInstallationCoreSurfaceReconciliationRecentAal2(
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
      "Recent AAL2 step-up authentication is required for installation core-surface reconciliation",
    );
  }
}

function parsePlanRequest(
  request: InstallationCoreSurfaceReconciliationPlanRequest,
): InstallationCoreSurfaceReconciliationPlanRequest {
  const parsed =
    installationCoreSurfaceReconciliationPlanRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new InstallationCoreSurfaceReconciliationInputError(
      "The installation core-surface reconciliation plan request is invalid",
    );
  }
  return parsed.data;
}

function parseApprovalRequest(
  request: InstallationCoreSurfaceReconciliationApprovalRequest,
): InstallationCoreSurfaceReconciliationApprovalRequest {
  const parsed =
    installationCoreSurfaceReconciliationApprovalRequestSchema.safeParse(
      request,
    );
  if (!parsed.success) {
    throw new InstallationCoreSurfaceReconciliationInputError(
      "The installation core-surface reconciliation approval request is invalid",
    );
  }
  return parsed.data;
}

function parseApplyRequest(
  request: InstallationCoreSurfaceReconciliationApplyRequest,
): InstallationCoreSurfaceReconciliationApplyRequest {
  const parsed =
    installationCoreSurfaceReconciliationApplyRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new InstallationCoreSurfaceReconciliationInputError(
      "The installation core-surface reconciliation apply request is invalid",
    );
  }
  return parsed.data;
}

async function readPlan(
  transaction: SqlExecutor,
  installationId: string,
  request: InstallationCoreSurfaceReconciliationPlanRequest,
): Promise<InstallationCoreSurfaceReconciliationPlan> {
  const result = await transaction.query<{ plan: unknown }>(
    `select public.read_installation_core_surface_reconciliation_plan(
       $1::uuid, $2::uuid, $3::text
     ) as plan`,
    [
      installationId,
      request.releaseAdoptionReceiptId,
      request.releaseAdoptionReceiptSha256,
    ],
  );
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new InstallationCoreSurfaceReconciliationIntegrityError(
      "Database returned an ambiguous installation core-surface reconciliation plan",
    );
  }
  try {
    const plan = await parseInstallationCoreSurfaceReconciliationPlan(
      result.rows[0]?.plan,
    );
    if (
      plan.vortonInstallationId !== installationId ||
      plan.targetRelease.adoptionReceiptId !==
        request.releaseAdoptionReceiptId ||
      plan.targetRelease.adoptionReceiptSha256 !==
        request.releaseAdoptionReceiptSha256
    ) {
      throw new Error(
        "Plan violated its exact installation or release binding",
      );
    }
    return plan;
  } catch {
    throw new InstallationCoreSurfaceReconciliationIntegrityError(
      "Database returned an invalid installation core-surface reconciliation plan",
    );
  }
}

async function parseDatabaseCreation(
  value: unknown,
  transaction: SqlExecutor,
  installationId: string,
  request: InstallationCoreSurfaceReconciliationApprovalRequest,
): Promise<InstallationCoreSurfaceReconciliationApprovalCreation> {
  const shape =
    installationCoreSurfaceReconciliationApprovalCreationSchema.safeParse(
      value,
    );
  if (!shape.success) {
    throw new InstallationCoreSurfaceReconciliationIntegrityError(
      "Database returned an invalid installation core-surface reconciliation approval",
    );
  }
  const targetRelease = shape.data.approval.binding.targetRelease;
  const plan = await readPlan(transaction, installationId, {
    releaseAdoptionReceiptId: targetRelease.adoptionReceiptId,
    releaseAdoptionReceiptSha256: targetRelease.adoptionReceiptSha256,
  });
  try {
    const creation =
      await parseInstallationCoreSurfaceReconciliationApprovalCreation(
        shape.data,
        plan,
      );
    if (
      creation.approval.approvalId !== request.approvalId ||
      creation.approval.binding.vortonInstallationId !== installationId ||
      creation.approval.binding.planHash !== request.planHash ||
      creation.approval.expiresAt !== request.expiresAt
    ) {
      throw new Error("Approval violated its exact request binding");
    }
    return creation;
  } catch {
    throw new InstallationCoreSurfaceReconciliationIntegrityError(
      "Database returned an invalid installation core-surface reconciliation approval",
    );
  }
}

function parseDatabaseApplication(
  value: unknown,
  installationId: string,
  approvalId: string,
  request: InstallationCoreSurfaceReconciliationApplyRequest,
): InstallationCoreSurfaceReconciliationApplication {
  const parsed =
    installationCoreSurfaceReconciliationApplicationSchema.safeParse(value);
  if (!parsed.success) {
    throw new InstallationCoreSurfaceReconciliationIntegrityError(
      "Database returned an invalid installation core-surface reconciliation application",
    );
  }
  const application = parsed.data;
  if (
    application.applicationReceipt.receiptId !== request.receiptId ||
    application.applicationReceipt.approvalId !== approvalId ||
    application.applicationReceipt.binding.vortonInstallationId !==
      installationId ||
    application.workspaceReceipts.some(
      (receipt) =>
        receipt.vortonInstallationId !== installationId ||
        receipt.installationReceiptId !== request.receiptId ||
        receipt.approvalId !== approvalId,
    )
  ) {
    throw new InstallationCoreSurfaceReconciliationIntegrityError(
      "Database application violated the exact installation core-surface reconciliation request",
    );
  }
  return application;
}

export class DatabaseInstallationCoreSurfaceReconciliation {
  constructor(private readonly database: Database) {}

  async plan(
    installationId: string,
    request: InstallationCoreSurfaceReconciliationPlanRequest,
    identity: AuthenticatedIdentity,
  ): Promise<InstallationCoreSurfaceReconciliationPlan> {
    requireInstallationCoreSurfaceReconciliationRecentAal2(identity);
    const exactRequest = parsePlanRequest(request);
    try {
      return await this.database.asInstallationPersonWithStepUp(
        {
          authUserId: identity.authUserId,
          installationId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        (transaction) => readPlan(transaction, installationId, exactRequest),
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }

  async approve(
    installationId: string,
    request: InstallationCoreSurfaceReconciliationApprovalRequest,
    identity: AuthenticatedIdentity,
  ): Promise<InstallationCoreSurfaceReconciliationApprovalCreation> {
    requireInstallationCoreSurfaceReconciliationRecentAal2(identity);
    const exactRequest = parseApprovalRequest(request);
    try {
      return await this.database.asInstallationPersonWithStepUp(
        {
          authUserId: identity.authUserId,
          installationId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        async (transaction) => {
          const result = await transaction.query<{ creation: unknown }>(
            `select public.create_installation_core_surface_reconciliation_approval(
               $1::uuid, $2::uuid, $3::text, $4::timestamptz
             ) as creation`,
            [
              exactRequest.approvalId,
              installationId,
              exactRequest.planHash,
              exactRequest.expiresAt,
            ],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new InstallationCoreSurfaceReconciliationIntegrityError(
              "Database returned an ambiguous installation core-surface reconciliation approval",
            );
          }
          return parseDatabaseCreation(
            result.rows[0]?.creation,
            transaction,
            installationId,
            exactRequest,
          );
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }

  async apply(
    installationId: string,
    approvalId: string,
    request: InstallationCoreSurfaceReconciliationApplyRequest,
    identity: AuthenticatedIdentity,
  ): Promise<InstallationCoreSurfaceReconciliationApplication> {
    requireInstallationCoreSurfaceReconciliationRecentAal2(identity);
    const exactRequest = parseApplyRequest(request);
    try {
      return await this.database.asInstallationPersonWithStepUp(
        {
          authUserId: identity.authUserId,
          installationId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        async (transaction) => {
          const result = await transaction.query<{ application: unknown }>(
            `select public.apply_installation_core_surface_reconciliation(
               $1::uuid, $2::uuid, $3::uuid
             ) as application`,
            [installationId, approvalId, exactRequest.receiptId],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new InstallationCoreSurfaceReconciliationIntegrityError(
              "Database returned an ambiguous installation core-surface reconciliation application",
            );
          }
          return parseDatabaseApplication(
            result.rows[0]?.application,
            installationId,
            approvalId,
            exactRequest,
          );
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }
}
