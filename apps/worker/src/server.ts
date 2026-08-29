import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { executiveWorkerJobRequestSchema } from "@aubos/contracts";
import type { ExecutiveWorkerProvider } from "@aubos/workers";

export interface WorkerServerDependencies {
  secret: string;
  provider: ExecutiveWorkerProvider;
  release: string;
}

function json(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function authorized(header: string | undefined, secret: string): boolean {
  const match = header?.match(/^Bearer ([^\s]+)$/);
  if (!match?.[1]) return false;
  const actual = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 256 * 1024) throw new Error("Request body exceeds 256 KiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createWorkerServer(
  dependencies: WorkerServerDependencies,
): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://runtime.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") {
        json(response, 200, {
          status: "ok",
          service: "aubos-worker",
          provider: dependencies.provider.provider,
          model: dependencies.provider.model,
          release: dependencies.release,
        });
        return;
      }
      if (!authorized(request.headers.authorization, dependencies.secret)) {
        json(response, 401, {
          error: {
            code: "unauthorized",
            message: "Internal worker authorization is required",
          },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/internal/v1/jobs") {
        const body = (await readJson(request)) as { request?: unknown };
        const jobRequest = executiveWorkerJobRequestSchema.parse(body.request);
        const job = await dependencies.provider.submit(jobRequest);
        json(response, job.status === "completed" ? 200 : 202, job);
        return;
      }
      json(response, 404, {
        error: { code: "not_found", message: "Route not found" },
      });
    } catch (error) {
      const invalid =
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ZodError";
      if (!invalid) console.error("AubOS worker request failed", error);
      json(response, invalid ? 400 : 500, {
        error: {
          code: invalid ? "invalid_request" : "worker_error",
          message: invalid
            ? "Request does not match the worker contract"
            : "Worker could not complete the request",
        },
      });
    }
  });
}
