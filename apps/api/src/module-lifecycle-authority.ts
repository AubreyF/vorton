import {
  canonicalModuleLifecycleJson,
  moduleLifecycleActionApprovalRequestSchema,
  parseModuleLifecycleApprovalCreation,
  type ModuleLifecycleActionApprovalRequest,
  type ModuleLifecycleApprovalCreation,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import {
  StepUpAuthenticationError,
  recentAal2MaxAgeSeconds,
  type AuthenticatedIdentity,
} from "./auth.js";

export class ModuleLifecycleAuthorityInputError extends Error {}
export class ModuleLifecycleAuthorityForbiddenError extends Error {}
export class ModuleLifecycleAuthorityConflictError extends Error {}
export class ModuleLifecycleAuthorityIntegrityError extends Error {}

const forbiddenDatabaseErrors = new Set([
  "Signed workspace-person AAL2 context is required to approve module lifecycle action",
  "Live workspace owner authority is required to approve module lifecycle action",
]);
const inputDatabaseErrors = new Set([
  "Module lifecycle approval expiry must be within 24 hours",
  "Exact module lifecycle binding is invalid",
  "Module lifecycle binding does not match workspace authority",
]);
const conflictDatabaseErrors = new Set([
  "Module lifecycle approval retry conflicts with immutable authority",
]);

function classifyDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code !== "P0001") throw error;
  if (forbiddenDatabaseErrors.has(message)) {
    throw new ModuleLifecycleAuthorityForbiddenError(
      "Live workspace owner authority with recent AAL2 is required",
    );
  }
  if (inputDatabaseErrors.has(message)) {
    throw new ModuleLifecycleAuthorityInputError(
      "The module lifecycle approval request is invalid",
    );
  }
  if (conflictDatabaseErrors.has(message)) {
    throw new ModuleLifecycleAuthorityConflictError(
      "The requested approval conflicts with immutable lifecycle authority",
    );
  }
  throw error;
}

export function requireModuleLifecycleRecentAal2(
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
    nowSeconds - authTime > recentAal2MaxAgeSeconds
  ) {
    throw new StepUpAuthenticationError(
      "Recent AAL2 step-up authentication is required for module lifecycle approval",
    );
  }
}

function parseRequest(
  request: ModuleLifecycleActionApprovalRequest,
): ModuleLifecycleActionApprovalRequest {
  const parsed = moduleLifecycleActionApprovalRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new ModuleLifecycleAuthorityInputError(
      "The module lifecycle approval request is invalid",
    );
  }
  return parsed.data;
}

function assertPathBinding(
  installationId: string,
  workspaceId: string,
  request: ModuleLifecycleActionApprovalRequest,
): void {
  if (
    request.binding.vortonInstallationId !== installationId ||
    request.binding.workspaceId !== workspaceId
  ) {
    throw new ModuleLifecycleAuthorityInputError(
      "The lifecycle binding must match the installation and workspace path",
    );
  }
}

async function parseDatabaseCreation(
  value: unknown,
): Promise<ModuleLifecycleApprovalCreation> {
  try {
    return await parseModuleLifecycleApprovalCreation(value);
  } catch {
    throw new ModuleLifecycleAuthorityIntegrityError(
      "Database returned an invalid module lifecycle approval creation",
    );
  }
}

function assertRequestProjection(
  request: ModuleLifecycleActionApprovalRequest,
  creation: ModuleLifecycleApprovalCreation,
): void {
  if (
    creation.approval.approvalId !== request.approvalId ||
    creation.approval.expiresAt !== request.expiresAt ||
    canonicalModuleLifecycleJson(creation.approval.binding) !==
      canonicalModuleLifecycleJson(request.binding)
  ) {
    throw new ModuleLifecycleAuthorityIntegrityError(
      "Database lifecycle approval violated the exact request binding",
    );
  }
}

export class DatabaseModuleLifecycleAuthority {
  constructor(private readonly database: Database) {}

  async approve(
    installationId: string,
    workspaceId: string,
    request: ModuleLifecycleActionApprovalRequest,
    identity: AuthenticatedIdentity,
  ): Promise<ModuleLifecycleApprovalCreation> {
    requireModuleLifecycleRecentAal2(identity);
    const exactRequest = parseRequest(request);
    assertPathBinding(installationId, workspaceId, exactRequest);

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
            `select public.create_module_lifecycle_action_approval(
               $1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5::timestamptz
             ) as creation`,
            [
              exactRequest.approvalId,
              installationId,
              workspaceId,
              exactRequest.binding,
              exactRequest.expiresAt,
            ],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new ModuleLifecycleAuthorityIntegrityError(
              "Database returned an ambiguous module lifecycle approval creation",
            );
          }
          const creation = await parseDatabaseCreation(
            result.rows[0]?.creation,
          );
          assertRequestProjection(exactRequest, creation);
          return creation;
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }
}
