import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type { Database } from "@vorton/database";
import {
  ExecutiveWorkflow,
  type ExecutiveAuthorityVerifier,
  type ExecutiveLedger,
} from "@vorton/executive";
import type { ExecutiveWorkerProvider } from "@vorton/workers";
import {
  moduleLifecycleActionApprovalRequestSchema,
  moduleLifecycleActionConsumeRequestSchema,
  moduleLifecycleActionFinalizeRequestSchema,
  releaseAdoptionApprovalRequestSchema,
  workspaceCoreSurfaceSelectionApplyRequestSchema,
  workspaceCoreSurfaceSelectionApprovalRequestSchema,
  workspaceMembershipRevocationApplyRequestSchema,
  workspaceMembershipRevocationApprovalRequestSchema,
  workspaceCreationApprovalRequestSchema,
} from "@vorton/contracts";

import {
  AuthenticationError,
  StepUpAuthenticationError,
  requireRecentAal2,
  type IdentityVerifier,
} from "./auth.js";
import {
  ExecutiveCouncilConflictError,
  ExecutiveCouncilInputError,
  ExecutiveCouncilResolutionError,
  parseCouncilInstallationInput,
  type DatabaseExecutiveCouncilResolver,
} from "./council-resolver.js";
import type { DatabaseWorkerRunRecorder } from "./database-worker-runs.js";
import {
  InstallationAuthorityConflictError,
  InstallationAuthorityForbiddenError,
  InstallationAuthorityInputError,
  InstallationAuthorityIntegrityError,
  type DatabaseInstallationAuthority,
} from "./installation-authority.js";
import {
  ModuleLifecycleAuthorityConflictError,
  ModuleLifecycleAuthorityForbiddenError,
  ModuleLifecycleAuthorityInputError,
  ModuleLifecycleAuthorityIntegrityError,
  requireModuleLifecycleRecentAal2,
  type DatabaseModuleLifecycleAuthority,
} from "./module-lifecycle-authority.js";
import {
  ModuleLifecycleExecutionConflictError,
  ModuleLifecycleExecutionForbiddenError,
  ModuleLifecycleExecutionInputError,
  ModuleLifecycleExecutionIntegrityError,
  type DatabaseModuleLifecycleExecution,
} from "./module-lifecycle-execution.js";
import {
  WorkspaceMembershipRevocationConflictError,
  WorkspaceMembershipRevocationForbiddenError,
  WorkspaceMembershipRevocationInputError,
  WorkspaceMembershipRevocationIntegrityError,
  requireWorkspaceMembershipRevocationRecentAal2,
  type DatabaseWorkspaceMembershipRevocationAuthority,
} from "./workspace-membership-revocation.js";
import {
  WorkspaceCoreSurfaceSelectionConflictError,
  WorkspaceCoreSurfaceSelectionForbiddenError,
  WorkspaceCoreSurfaceSelectionInputError,
  WorkspaceCoreSurfaceSelectionIntegrityError,
  requireWorkspaceCoreSurfaceSelectionRecentAal2,
  type DatabaseWorkspaceCoreSurfaceSelectionAuthority,
} from "./workspace-core-surface-selection.js";
import {
  ExecutiveRequestInputError,
  ExecutiveRequestResolutionError,
  parseProposalInput,
  type DatabaseExecutiveRequestResolver,
} from "./request-resolver.js";
import {
  verifyWorkerCredential,
  type WorkerCredentialVerifier,
} from "./worker-auth.js";

export interface ApiServerDependencies {
  database: Database;
  ledger: ExecutiveLedger;
  authorityVerifier: ExecutiveAuthorityVerifier;
  identityVerifier: IdentityVerifier;
  worker: ExecutiveWorkerProvider;
  requestResolver: DatabaseExecutiveRequestResolver;
  workerRuns: DatabaseWorkerRunRecorder;
  councilResolver: DatabaseExecutiveCouncilResolver;
  installationAuthority: DatabaseInstallationAuthority;
  moduleLifecycleAuthority: DatabaseModuleLifecycleAuthority;
  moduleLifecycleExecution: DatabaseModuleLifecycleExecution;
  workspaceMembershipRevocationAuthority: DatabaseWorkspaceMembershipRevocationAuthority;
  workspaceCoreSurfaceSelectionAuthority: DatabaseWorkspaceCoreSurfaceSelectionAuthority;
  workerCredentialVerifier: WorkerCredentialVerifier;
  release: string;
  allowedOrigin: string;
}

interface ErrorPayload {
  error: { code: string; message: string };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function json(
  response: ServerResponse,
  status: number,
  payload: unknown,
  allowedOrigin?: string,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...(allowedOrigin
      ? { "access-control-allow-origin": allowedOrigin, vary: "Origin" }
      : {}),
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 256 * 1024)
      throw new RequestError(
        413,
        "request_too_large",
        "Request body exceeds 256 KiB",
      );
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(
      400,
      "invalid_json",
      "Request body must be valid JSON",
    );
  }
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function containsClaimedIdentity(body: unknown): boolean {
  return Boolean(
    body &&
    typeof body === "object" &&
    ("authUserId" in body || "auth_user_id" in body || "userId" in body),
  );
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(
      400,
      "invalid_request",
      "Request body must be an object",
    );
  }
  if (containsClaimedIdentity(body)) {
    throw new RequestError(
      400,
      "identity_not_accepted",
      "Identity is derived only from the verified bearer token",
    );
  }
  return body as Record<string, unknown>;
}

function requiredText(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestError(400, "invalid_request", `${name} is required`);
  }
  return value.trim();
}

export function createApiServer(dependencies: ApiServerDependencies): Server {
  const workflow = new ExecutiveWorkflow({
    ledger: dependencies.ledger,
    worker: dependencies.worker,
    authorityVerifier: dependencies.authorityVerifier,
  });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://runtime.invalid");
      const requestOrigin = request.headers.origin;
      if (requestOrigin && requestOrigin !== dependencies.allowedOrigin) {
        json(response, 403, {
          error: { code: "origin_forbidden", message: "Origin is not allowed" },
        });
        return;
      }
      const send = (status: number, payload: unknown) =>
        json(
          response,
          status,
          payload,
          requestOrigin ? dependencies.allowedOrigin : undefined,
        );
      if (request.method === "OPTIONS") {
        if (!requestOrigin) {
          send(400, {
            error: {
              code: "origin_required",
              message: "CORS preflight requires an Origin",
            },
          });
          return;
        }
        response.writeHead(204, {
          "access-control-allow-origin": dependencies.allowedOrigin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "600",
          vary: "Origin",
        });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        send(200, {
          status: "ok",
          service: "vorton-api",
          release: dependencies.release,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        await dependencies.database.asAdministrator(async (transaction) => {
          await transaction.query("select 1");
        });
        send(200, { status: "ready", service: "vorton-api" });
        return;
      }
      if (
        request.method === "GET" &&
        url.pathname === "/v1/runtime/bootstrap"
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        send(
          200,
          await dependencies.requestResolver.resolveBootstrap(
            identity.authUserId,
          ),
        );
        return;
      }
      const installationAuthorityRoute = url.pathname.match(
        /^\/v1\/installations\/([0-9a-f-]+)\/(release-adoption-approvals|workspace-creation-approvals)$/i,
      );
      if (request.method === "POST" && installationAuthorityRoute?.[1]) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireRecentAal2(identity);
        const installationId = installationAuthorityRoute[1];
        if (!uuidPattern.test(installationId)) {
          throw new RequestError(
            400,
            "invalid_request",
            "installationId must be a UUID",
          );
        }
        const body = objectBody(await readJson(request));
        const result =
          installationAuthorityRoute[2] === "release-adoption-approvals"
            ? await dependencies.installationAuthority.approveRelease(
                installationId,
                releaseAdoptionApprovalRequestSchema.parse(body),
                identity,
              )
            : await dependencies.installationAuthority.approveWorkspace(
                installationId,
                workspaceCreationApprovalRequestSchema.parse(body),
                identity,
              );
        send(201, result);
        return;
      }
      const moduleLifecycleAuthorityRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/module-lifecycle-action-approvals$/,
      );
      if (
        request.method === "POST" &&
        moduleLifecycleAuthorityRoute?.[1] &&
        moduleLifecycleAuthorityRoute[2]
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireModuleLifecycleRecentAal2(identity);
        const installationId = moduleLifecycleAuthorityRoute[1];
        const workspaceId = moduleLifecycleAuthorityRoute[2];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "installationId and workspaceId must be canonical UUIDs",
          );
        }
        const exactRequest = moduleLifecycleActionApprovalRequestSchema.parse(
          objectBody(await readJson(request)),
        );
        if (
          exactRequest.binding.vortonInstallationId !== installationId ||
          exactRequest.binding.workspaceId !== workspaceId
        ) {
          throw new ModuleLifecycleAuthorityInputError(
            "The lifecycle binding must match the installation and workspace path",
          );
        }
        send(
          201,
          await dependencies.moduleLifecycleAuthority.approve(
            installationId,
            workspaceId,
            exactRequest,
            identity,
          ),
        );
        return;
      }
      const membershipRevocationApprovalRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/membership-revocation-approvals$/,
      );
      if (
        request.method === "POST" &&
        membershipRevocationApprovalRoute?.[1] &&
        membershipRevocationApprovalRoute[2]
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireWorkspaceMembershipRevocationRecentAal2(identity);
        const installationId = membershipRevocationApprovalRoute[1];
        const workspaceId = membershipRevocationApprovalRoute[2];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "Membership revocation path identifiers must be canonical UUIDs",
          );
        }
        const exactRequest =
          workspaceMembershipRevocationApprovalRequestSchema.parse(
            objectBody(await readJson(request)),
          );
        send(
          201,
          await dependencies.workspaceMembershipRevocationAuthority.approve(
            installationId,
            workspaceId,
            exactRequest,
            identity,
          ),
        );
        return;
      }
      const membershipRevocationApplyRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/membership-revocation-approvals\/([^/]+)\/execute$/,
      );
      if (
        request.method === "POST" &&
        membershipRevocationApplyRoute?.[1] &&
        membershipRevocationApplyRoute[2] &&
        membershipRevocationApplyRoute[3]
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireWorkspaceMembershipRevocationRecentAal2(identity);
        const installationId = membershipRevocationApplyRoute[1];
        const workspaceId = membershipRevocationApplyRoute[2];
        const approvalId = membershipRevocationApplyRoute[3];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId) ||
          !uuidPattern.test(approvalId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "Membership revocation path identifiers must be canonical UUIDs",
          );
        }
        const exactRequest =
          workspaceMembershipRevocationApplyRequestSchema.parse(
            objectBody(await readJson(request)),
          );
        send(
          200,
          await dependencies.workspaceMembershipRevocationAuthority.apply(
            installationId,
            workspaceId,
            approvalId,
            exactRequest,
            identity,
          ),
        );
        return;
      }
      const coreSurfaceSelectionApprovalRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/core-surface-selection-approvals$/,
      );
      if (
        request.method === "POST" &&
        coreSurfaceSelectionApprovalRoute?.[1] &&
        coreSurfaceSelectionApprovalRoute[2]
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireWorkspaceCoreSurfaceSelectionRecentAal2(identity);
        const installationId = coreSurfaceSelectionApprovalRoute[1];
        const workspaceId = coreSurfaceSelectionApprovalRoute[2];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "Core-surface selection path identifiers must be canonical UUIDs",
          );
        }
        const exactRequest =
          workspaceCoreSurfaceSelectionApprovalRequestSchema.parse(
            objectBody(await readJson(request)),
          );
        send(
          201,
          await dependencies.workspaceCoreSurfaceSelectionAuthority.approve(
            installationId,
            workspaceId,
            exactRequest,
            identity,
          ),
        );
        return;
      }
      const coreSurfaceSelectionApplyRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/core-surface-selection-approvals\/([^/]+)\/execute$/,
      );
      if (
        request.method === "POST" &&
        coreSurfaceSelectionApplyRoute?.[1] &&
        coreSurfaceSelectionApplyRoute[2] &&
        coreSurfaceSelectionApplyRoute[3]
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireWorkspaceCoreSurfaceSelectionRecentAal2(identity);
        const installationId = coreSurfaceSelectionApplyRoute[1];
        const workspaceId = coreSurfaceSelectionApplyRoute[2];
        const approvalId = coreSurfaceSelectionApplyRoute[3];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId) ||
          !uuidPattern.test(approvalId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "Core-surface selection path identifiers must be canonical UUIDs",
          );
        }
        const exactRequest =
          workspaceCoreSurfaceSelectionApplyRequestSchema.parse(
            objectBody(await readJson(request)),
          );
        send(
          200,
          await dependencies.workspaceCoreSurfaceSelectionAuthority.apply(
            installationId,
            workspaceId,
            approvalId,
            exactRequest,
            identity,
          ),
        );
        return;
      }
      const lifecycleConsumeRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/module-lifecycle-action-approvals\/([^/]+)\/consume$/,
      );
      if (
        request.method === "POST" &&
        lifecycleConsumeRoute?.[1] &&
        lifecycleConsumeRoute[2] &&
        lifecycleConsumeRoute[3]
      ) {
        const installationId = lifecycleConsumeRoute[1];
        const workspaceId = lifecycleConsumeRoute[2];
        const approvalId = lifecycleConsumeRoute[3];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId) ||
          !uuidPattern.test(approvalId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "Lifecycle execution path identifiers must be canonical UUIDs",
          );
        }
        const worker = await verifyWorkerCredential(
          request.headers.authorization,
          dependencies.workerCredentialVerifier,
        );
        const exactRequest = moduleLifecycleActionConsumeRequestSchema.parse(
          objectBody(await readJson(request)),
        );
        send(
          200,
          await dependencies.moduleLifecycleExecution.consume(
            installationId,
            workspaceId,
            approvalId,
            exactRequest,
            worker,
          ),
        );
        return;
      }
      const lifecycleFinalizeRoute = url.pathname.match(
        /^\/v1\/installations\/([^/]+)\/workspaces\/([^/]+)\/module-lifecycle-action-commands\/([^/]+)\/finalize$/,
      );
      if (
        request.method === "POST" &&
        lifecycleFinalizeRoute?.[1] &&
        lifecycleFinalizeRoute[2] &&
        lifecycleFinalizeRoute[3]
      ) {
        const installationId = lifecycleFinalizeRoute[1];
        const workspaceId = lifecycleFinalizeRoute[2];
        const commandId = lifecycleFinalizeRoute[3];
        if (
          !uuidPattern.test(installationId) ||
          !uuidPattern.test(workspaceId) ||
          !uuidPattern.test(commandId)
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "Lifecycle execution path identifiers must be canonical UUIDs",
          );
        }
        const worker = await verifyWorkerCredential(
          request.headers.authorization,
          dependencies.workerCredentialVerifier,
        );
        const exactRequest = moduleLifecycleActionFinalizeRequestSchema.parse(
          objectBody(await readJson(request)),
        );
        send(
          200,
          await dependencies.moduleLifecycleExecution.finalize(
            installationId,
            workspaceId,
            commandId,
            exactRequest,
            worker,
          ),
        );
        return;
      }
      const councilRoute = url.pathname.match(
        /^\/v1\/executive\/councils\/([0-9a-f-]+)(?:\/(install|advance))?$/i,
      );
      if (councilRoute?.[1]) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        const workId = councilRoute[1];
        if (request.method === "GET" && !councilRoute[2]) {
          const queryKeys = [...url.searchParams.keys()];
          if (
            queryKeys.length !== 2 ||
            !queryKeys.includes("installationId") ||
            !queryKeys.includes("workspaceId")
          ) {
            throw new ExecutiveCouncilInputError(
              "Council reads require only installationId and workspaceId",
            );
          }
          const parsed = parseCouncilInstallationInput({
            installationId: url.searchParams.get("installationId"),
            workspaceId: url.searchParams.get("workspaceId"),
          });
          send(
            200,
            await dependencies.councilResolver.get(workId, {
              installationId: parsed.installationId,
              workspaceId: parsed.workspaceId,
              authUserId: identity.authUserId,
            }),
          );
          return;
        }
        if (
          request.method === "POST" &&
          (councilRoute[2] === "install" || councilRoute[2] === "advance")
        ) {
          const parsed = parseCouncilInstallationInput(
            objectBody(await readJson(request)),
          );
          if (councilRoute[2] === "install") requireRecentAal2(identity);
          const requester = {
            installationId: parsed.installationId,
            workspaceId: parsed.workspaceId,
            authUserId: identity.authUserId,
          };
          const result =
            councilRoute[2] === "install"
              ? await dependencies.councilResolver.install(workId, {
                  ...requester,
                  aal: identity.aal,
                  authTime: identity.authTime,
                })
              : await dependencies.councilResolver.advance(workId, requester);
          send(councilRoute[2] === "install" ? 201 : 200, result);
          return;
        }
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/executive/proposals"
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        const body = objectBody(await readJson(request));
        const proposalInput = parseProposalInput(body);
        await dependencies.authorityVerifier.resolvePerson({
          installationId: proposalInput.installationId,
          workspaceId: proposalInput.workspaceId,
          authUserId: identity.authUserId,
          requiredAuthority: "member",
          operation: "review",
        });
        const requester = {
          installationId: proposalInput.installationId,
          workspaceId: proposalInput.workspaceId,
          authUserId: identity.authUserId,
        };
        const proposalRequest =
          await dependencies.requestResolver.resolveProposal(
            proposalInput,
            requester,
          );
        const result = await workflow.startProposal(proposalRequest, requester);
        await dependencies.workerRuns.record(proposalRequest, result.job);
        send(result.proposal ? 201 : 202, result);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/executive/reviews"
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        const body = objectBody(await readJson(request));
        if (
          !["support", "revise", "reject"].includes(String(body.disposition))
        ) {
          throw new RequestError(
            400,
            "invalid_request",
            "disposition is invalid",
          );
        }
        const result = await workflow.review({
          proposalRecordId: requiredText(body, "proposalRecordId"),
          reviewer: {
            installationId: requiredText(body, "installationId"),
            workspaceId: requiredText(body, "workspaceId"),
            authUserId: identity.authUserId,
          },
          summary: requiredText(body, "summary"),
          disposition: body.disposition as "support" | "revise" | "reject",
        });
        send(201, result);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/executive/decisions"
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        const body = objectBody(await readJson(request));
        const result = await workflow.decide({
          reviewRecordId: requiredText(body, "reviewRecordId"),
          decisionMaker: {
            installationId: requiredText(body, "installationId"),
            workspaceId: requiredText(body, "workspaceId"),
            authUserId: identity.authUserId,
          },
          summary: requiredText(body, "summary"),
          classification: body.classification as Parameters<
            ExecutiveWorkflow["decide"]
          >[0]["classification"],
        });
        send(201, result);
        return;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/executive/approvals"
      ) {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireRecentAal2(identity);
        const body = objectBody(await readJson(request));
        const result = await workflow.approve({
          decisionRecordId: requiredText(body, "decisionRecordId"),
          approver: {
            installationId: requiredText(body, "installationId"),
            workspaceId: requiredText(body, "workspaceId"),
            authUserId: identity.authUserId,
          },
          summary: requiredText(body, "summary"),
        });
        send(201, result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/executive/work") {
        const identity = await dependencies.identityVerifier.verify(
          request.headers.authorization,
        );
        requireRecentAal2(identity);
        const body = objectBody(await readJson(request));
        const installationId = requiredText(body, "installationId");
        const workspaceId = requiredText(body, "workspaceId");
        await dependencies.authorityVerifier.resolvePerson({
          installationId,
          workspaceId,
          authUserId: identity.authUserId,
          requiredAuthority: "owner",
          operation: "approval",
        });
        const approvalRecordId = requiredText(body, "approvalRecordId");
        const requester = {
          installationId,
          workspaceId,
          authUserId: identity.authUserId,
        };
        const authority = await dependencies.requestResolver.resolveAuthority(
          {
            installationId,
            workspaceId,
            approvalRecordId,
            capabilityGrantId: requiredText(body, "capabilityGrantId"),
          },
          requester,
        );
        const result = await workflow.createExecutionWork({
          approvalRecordId,
          authority,
          title: requiredText(body, "title"),
          requestedOutcome: requiredText(body, "requestedOutcome"),
          acceptanceCriteria: Array.isArray(body.acceptanceCriteria)
            ? body.acceptanceCriteria.map(String)
            : [],
          priority:
            typeof body.priority === "number" ? body.priority : undefined,
          requester,
        });
        send(201, result);
        return;
      }
      send(404, { error: { code: "not_found", message: "Route not found" } });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        json(
          response,
          401,
          { error: { code: "unauthorized", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof StepUpAuthenticationError) {
        json(
          response,
          403,
          { error: { code: "aal2_required", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof RequestError) {
        json(
          response,
          error.status,
          { error: { code: error.code, message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof InstallationAuthorityInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof InstallationAuthorityForbiddenError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof InstallationAuthorityConflictError) {
        json(
          response,
          409,
          {
            error: {
              code: "installation_authority_conflict",
              message: error.message,
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof InstallationAuthorityIntegrityError) {
        json(
          response,
          500,
          {
            error: {
              code: "internal_error",
              message: "The runtime could not complete the request",
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleAuthorityInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleAuthorityForbiddenError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleAuthorityConflictError) {
        json(
          response,
          409,
          {
            error: {
              code: "module_lifecycle_authority_conflict",
              message: error.message,
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleAuthorityIntegrityError) {
        json(
          response,
          500,
          {
            error: {
              code: "internal_error",
              message: "The runtime could not complete the request",
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleExecutionInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleExecutionForbiddenError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleExecutionConflictError) {
        json(
          response,
          409,
          {
            error: {
              code: "module_lifecycle_execution_conflict",
              message: error.message,
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ModuleLifecycleExecutionIntegrityError) {
        json(
          response,
          500,
          {
            error: {
              code: "internal_error",
              message: "The runtime could not complete the request",
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceMembershipRevocationInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceMembershipRevocationForbiddenError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceMembershipRevocationConflictError) {
        json(
          response,
          409,
          {
            error: {
              code: "workspace_membership_revocation_conflict",
              message: error.message,
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceMembershipRevocationIntegrityError) {
        json(
          response,
          500,
          {
            error: {
              code: "internal_error",
              message: "The runtime could not complete the request",
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceCoreSurfaceSelectionInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceCoreSurfaceSelectionForbiddenError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceCoreSurfaceSelectionConflictError) {
        json(
          response,
          409,
          {
            error: {
              code: "workspace_core_surface_selection_conflict",
              message: error.message,
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof WorkspaceCoreSurfaceSelectionIntegrityError) {
        json(
          response,
          500,
          {
            error: {
              code: "internal_error",
              message: "The runtime could not complete the request",
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ExecutiveRequestInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ExecutiveCouncilInputError) {
        json(
          response,
          400,
          { error: { code: "invalid_request", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ExecutiveCouncilResolutionError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ExecutiveCouncilConflictError) {
        json(
          response,
          409,
          { error: { code: "council_conflict", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (error instanceof ExecutiveRequestResolutionError) {
        json(
          response,
          403,
          { error: { code: "forbidden", message: error.message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ZodError"
      ) {
        json(
          response,
          400,
          {
            error: {
              code: "invalid_request",
              message: "Request does not match the Vorton contract",
            },
          },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      const message =
        error instanceof Error ? error.message : "Unknown runtime error";
      if (/authority is required|cannot cross installation/i.test(message)) {
        json(
          response,
          403,
          { error: { code: "forbidden", message } },
          request.headers.origin === dependencies.allowedOrigin
            ? dependencies.allowedOrigin
            : undefined,
        );
        return;
      }
      console.error("Vorton API request failed", error);
      json(
        response,
        500,
        {
          error: {
            code: "internal_error",
            message: "The runtime could not complete the request",
          },
        },
        request.headers.origin === dependencies.allowedOrigin
          ? dependencies.allowedOrigin
          : undefined,
      );
    }
  });
}

export type { ErrorPayload };
