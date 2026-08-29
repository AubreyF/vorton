import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { FakeExecutiveWorkerAdapter } from "@aubos/workers";
import { InMemoryExecutiveLedger } from "@aubos/executive";
import type { Database } from "@aubos/database";

import { createApiServer } from "./server.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const authUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const personId = "7fb46f09-3894-4c24-933c-77c7a403341c";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const workId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const roleId = "d37f356b-6297-4cd1-902d-c2755423a612";
const servers: ReturnType<typeof createApiServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function runtime() {
  const ledger = new InMemoryExecutiveLedger(() => crypto.randomUUID());
  await ledger.append({
    installationId,
    workId: null,
    kind: "evidence",
    summary: "Synthetic runtime evidence",
    payload: { classification: "synthetic", sourceUri: null },
    actor: { kind: "person", id: personId },
  });
  const evidence = ledger.records[0]!;
  const authorityVerifier = {
    resolvePerson: async (input: { authUserId: string }) => {
      if (input.authUserId !== authUserId)
        throw new Error("Member authority is required");
      return personId;
    },
    assertApplicable: async () => undefined,
  };
  const database = {
    asAdministrator: async (
      operation: (transaction: {
        query: (sql: string) => Promise<{ rows: never[]; rowCount: number }>;
      }) => Promise<unknown>,
    ) => operation({ query: async () => ({ rows: [], rowCount: 1 }) }),
  } as unknown as Database;
  const server = createApiServer({
    database,
    ledger,
    authorityVerifier,
    identityVerifier: { verify: async () => ({ authUserId }) },
    worker: new FakeExecutiveWorkerAdapter(),
    requestResolver: {
      resolveBootstrap: async (resolvedAuthUserId: string) => ({
        installations:
          resolvedAuthUserId === authUserId
            ? [
                {
                  id: installationId,
                  displayName: "Synthetic installation",
                  personKind: "owner" as const,
                  proposalBindings: [
                    {
                      workId,
                      workTitle: "Assess fixture",
                      workerId,
                      workerName: "Synthetic worker",
                      roleId,
                      roleName: "Synthetic reviewer",
                      evidence: [
                        {
                          id: evidence.id,
                          summary: evidence.summary,
                          classification: "synthetic",
                        },
                      ],
                    },
                  ],
                },
              ]
            : [],
      }),
      resolveProposal: async (input: {
        installationId: string;
        workId: string;
        workerId: string;
        roleId: string;
        objective: string;
        background: boolean;
      }) => ({
        installationId: input.installationId,
        workId: input.workId,
        workerId: input.workerId,
        role: {
          roleId: input.roleId,
          name: "Synthetic reviewer",
          version: 1,
          contentSha256: "a".repeat(64),
          skillMarkdown: "Recommend. Never execute.",
        },
        objective: input.objective,
        evidence: [
          {
            recordId: evidence.id,
            summary: evidence.summary,
            sourceUri: null,
            classification: "synthetic" as const,
          },
        ],
        background: input.background,
      }),
      resolveAuthority: async (input: {
        approvalRecordId: string;
        capabilityGrantId: string;
      }) => ({
        policyId: roleId,
        capabilityGrantId: input.capabilityGrantId,
        approvalRecordId: input.approvalRecordId,
        executorWorkerId: workerId,
        capability: "executive.synthetic.check",
        mode: "diagnose" as const,
      }),
    } as never,
    workerRuns: { record: async () => "synthetic-run" } as never,
    release: "synthetic-test",
    allowedOrigin: "https://control.aubos.example",
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${String(port)}`, ledger, evidence };
}

function proposal(evidenceId: string) {
  return {
    installationId,
    workId,
    workerId,
    roleId,
    objective: "Assess the synthetic fixture",
    evidenceRecordIds: [evidenceId],
    background: false,
  };
}

describe("control-plane API", () => {
  it("serves an unauthenticated health endpoint", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "aubos-api",
    });
  });

  it("returns only the verified caller's eligible runtime bootstrap", async () => {
    const { baseUrl } = await runtime();
    const response = await fetch(`${baseUrl}/v1/runtime/bootstrap`, {
      headers: { authorization: "Bearer verified-by-fixture" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      installations: [
        {
          id: installationId,
          personKind: "owner",
          proposalBindings: [{ workId, workerId, roleId }],
        },
      ],
    });
  });

  it("persists model output only as a recommendation proposal", async () => {
    const { baseUrl, ledger, evidence } = await runtime();
    const response = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify(proposal(evidence.id)),
    });
    expect(response.status).toBe(201);
    expect(ledger.records.map((record) => record.kind)).toEqual([
      "evidence",
      "proposal",
    ]);
    expect(ledger.work).toEqual([]);
  });

  it("rejects an identity supplied in the body and grants no execution authority", async () => {
    const { baseUrl, ledger, evidence } = await runtime();
    const response = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "POST",
      headers: {
        authorization: "Bearer verified-by-fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...proposal(evidence.id),
        authUserId: crypto.randomUUID(),
      }),
    });
    expect(response.status).toBe(400);
    expect(ledger.records).toHaveLength(1);
    const execution = await fetch(`${baseUrl}/v1/executive/work`, {
      method: "POST",
    });
    expect(execution.status).toBe(400);
    expect(ledger.work).toEqual([]);
  });

  it("requires separate human review, decision, and approval before promotion to Work", async () => {
    const { baseUrl, ledger, evidence } = await runtime();
    const headers = {
      authorization: "Bearer verified-by-fixture",
      "content-type": "application/json",
    };
    const proposalResponse = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(proposal(evidence.id)),
    });
    const proposalPayload = (await proposalResponse.json()) as {
      proposal: { id: string };
    };
    expect(ledger.work).toEqual([]);

    const review = (await fetch(`${baseUrl}/v1/executive/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        proposalRecordId: proposalPayload.proposal.id,
        summary: "Human review supports the bounded diagnostic",
        disposition: "support",
      }),
    }).then((response) => response.json())) as { id: string };
    const decision = (await fetch(`${baseUrl}/v1/executive/decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        reviewRecordId: review.id,
        summary: "Owner decision remains bounded",
        classification: "owner-required",
      }),
    }).then((response) => response.json())) as { id: string };
    const approval = (await fetch(`${baseUrl}/v1/executive/approvals`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        decisionRecordId: decision.id,
        summary: "Approved for synthetic diagnosis only",
      }),
    }).then((response) => response.json())) as { id: string };
    expect(ledger.work).toEqual([]);

    const promoted = await fetch(`${baseUrl}/v1/executive/work`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        installationId,
        approvalRecordId: approval.id,
        capabilityGrantId: "4156f0af-e62f-4b16-a7bc-97c8301c2e2f",
        title: "Run synthetic diagnostic",
        requestedOutcome: "Produce a bounded diagnostic receipt",
        acceptanceCriteria: ["No external system is contacted"],
      }),
    });
    expect(promoted.status).toBe(201);
    expect(ledger.records.map((record) => record.kind)).toEqual([
      "evidence",
      "proposal",
      "review",
      "decision",
      "approval",
    ]);
    expect(ledger.work).toHaveLength(1);
  });

  it("allows credentialed CORS only from the configured control-plane origin", async () => {
    const { baseUrl } = await runtime();
    const allowed = await fetch(`${baseUrl}/v1/executive/proposals`, {
      method: "OPTIONS",
      headers: {
        origin: "https://control.aubos.example",
        "access-control-request-method": "POST",
      },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://control.aubos.example",
    );
    const denied = await fetch(`${baseUrl}/healthz`, {
      headers: { origin: "https://forged.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
