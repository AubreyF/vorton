import {
  releaseAdoptionApprovalDocumentSchema,
  releaseAdoptionApprovalRequestSchema,
  type ReleaseAdoptionApprovalDocument,
  type ReleaseAdoptionApprovalRequest,
  workspaceCreationApprovalDocumentSchema,
  workspaceCreationApprovalRequestSchema,
  type WorkspaceCreationApprovalDocument,
  type WorkspaceCreationApprovalRequest,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import {
  StepUpAuthenticationError,
  requireRecentAal2,
  type AuthenticatedIdentity,
} from "./auth.js";

export class InstallationAuthorityInputError extends Error {}
export class InstallationAuthorityForbiddenError extends Error {}
export class InstallationAuthorityConflictError extends Error {}
export class InstallationAuthorityIntegrityError extends Error {}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function classifyDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code !== "P0001") throw error;
  if (
    [
      "Signed installation-person AAL2 context is required to approve release adoption",
      "Signed installation-person AAL2 context is required to approve workspace creation",
      "Installation owner authority is required",
    ].includes(message)
  ) {
    throw new InstallationAuthorityForbiddenError(
      "Live installation owner authority with recent AAL2 is required",
    );
  }
  if (
    [
      "Release adoption approval retry conflicts with immutable authority",
      "Workspace creation approval retry conflicts with immutable authority",
      "Exact installation-scoped release adoption receipt is required",
    ].includes(message)
  ) {
    throw new InstallationAuthorityConflictError(
      "The requested approval conflicts with installation authority state",
    );
  }
  if (
    [
      "Release adoption approval expiry must be within 24 hours",
      "Release adoption approval requires the complete exact release object",
    ].includes(message)
  ) {
    throw new InstallationAuthorityInputError(
      "The installation approval request is invalid",
    );
  }
  throw error;
}

function assertRecentStepUp(
  identity: AuthenticatedIdentity,
): asserts identity is AuthenticatedIdentity & {
  aal: "aal2";
  authTime: number;
} {
  try {
    requireRecentAal2(identity);
  } catch (error) {
    if (error instanceof StepUpAuthenticationError) {
      throw new InstallationAuthorityForbiddenError(
        "Recent AAL2 authentication is required",
      );
    }
    throw error;
  }
}

export class DatabaseInstallationAuthority {
  constructor(private readonly database: Database) {}

  async approveRelease(
    installationId: string,
    request: ReleaseAdoptionApprovalRequest,
    identity: AuthenticatedIdentity,
  ): Promise<ReleaseAdoptionApprovalDocument> {
    assertRecentStepUp(identity);
    const parsedRequest =
      releaseAdoptionApprovalRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new InstallationAuthorityInputError(
        "The release adoption approval request is invalid",
      );
    }
    const exactRequest = parsedRequest.data;
    try {
      return await this.database.asInstallationPersonWithStepUp(
        {
          authUserId: identity.authUserId,
          installationId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        async (transaction) => {
          const result = await transaction.query<{ document: unknown }>(
            `select public.create_release_adoption_approval(
               $1::uuid, $2::uuid, $3::text, $4::jsonb, $5::timestamptz
             ) as document`,
            [
              exactRequest.approvalId,
              installationId,
              exactRequest.planHash,
              exactRequest.release,
              exactRequest.expiresAt,
            ],
          );
          const parsed = releaseAdoptionApprovalDocumentSchema.safeParse(
            result.rows[0]?.document,
          );
          if (!parsed.success) {
            throw new InstallationAuthorityIntegrityError(
              "Database returned an invalid release approval document",
            );
          }
          const document = parsed.data;
          if (
            document.installationId !== installationId ||
            document.approvalId !== exactRequest.approvalId ||
            document.planHash !== exactRequest.planHash ||
            document.expiresAt !== exactRequest.expiresAt ||
            canonical(document.release) !== canonical(exactRequest.release)
          ) {
            throw new InstallationAuthorityIntegrityError(
              "Database release approval violated request binding",
            );
          }
          return document;
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }

  async approveWorkspace(
    installationId: string,
    request: WorkspaceCreationApprovalRequest,
    identity: AuthenticatedIdentity,
  ): Promise<WorkspaceCreationApprovalDocument> {
    assertRecentStepUp(identity);
    const parsedRequest =
      workspaceCreationApprovalRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new InstallationAuthorityInputError(
        "The workspace creation approval request is invalid",
      );
    }
    const exactRequest = parsedRequest.data;
    try {
      return await this.database.asInstallationPersonWithStepUp(
        {
          authUserId: identity.authUserId,
          installationId,
          aal: "aal2",
          authTime: identity.authTime,
        },
        async (transaction) => {
          const result = await transaction.query<{ document: unknown }>(
            `select public.create_workspace_creation_approval(
               $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
               $6::public.installation_realm, $7::uuid, $8::text, $9::text
             ) as document`,
            [
              exactRequest.approvalId,
              installationId,
              exactRequest.workspace.id,
              exactRequest.workspace.slug,
              exactRequest.workspace.displayName,
              exactRequest.workspace.realm,
              exactRequest.releaseAdoptionReceiptId,
              exactRequest.releaseAdoptionReceiptSha256,
              exactRequest.workspacePlanSha256,
            ],
          );
          const parsed = workspaceCreationApprovalDocumentSchema.safeParse(
            result.rows[0]?.document,
          );
          if (!parsed.success) {
            throw new InstallationAuthorityIntegrityError(
              "Database returned an invalid workspace approval document",
            );
          }
          const document = parsed.data;
          if (
            document.installationId !== installationId ||
            document.approvalId !== exactRequest.approvalId ||
            document.workspacePlanSha256 !== exactRequest.workspacePlanSha256 ||
            document.adoptedRelease.adoptionReceiptId !==
              exactRequest.releaseAdoptionReceiptId ||
            document.adoptedRelease.adoptionReceiptSha256 !==
              exactRequest.releaseAdoptionReceiptSha256 ||
            canonical(document.workspace) !== canonical(exactRequest.workspace)
          ) {
            throw new InstallationAuthorityIntegrityError(
              "Database workspace approval violated request binding",
            );
          }
          return document;
        },
      );
    } catch (error) {
      classifyDatabaseError(error);
    }
  }
}
