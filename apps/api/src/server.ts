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
  releaseAdoptionApprovalRequestSchema,
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
  ExecutiveRequestInputError,
  ExecutiveRequestResolutionError,
  parseProposalInput,
  type DatabaseExecutiveRequestResolver,
} from "./request-resolver.js";

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
