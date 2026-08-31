import { describe, expect, it, vi } from "vitest";

import { runHindsightCanary } from "./hindsight-canary.js";

interface Fact {
  id: string;
  text: string;
  fact_type: "world" | "experience";
  document_id: string;
  tags: string[];
  metadata: Record<string, string>;
  state: "valid" | "invalidated";
  invalidated_at: string | null;
}

class FakeHindsight {
  readonly facts = new Map<string, Fact>();
  readonly calls: Array<{
    method: string;
    path: string;
    body: unknown;
  }> = [];
  deleted = false;
  statsCalls = 0;
  failConsolidation = false;
  unhealthyOperation: string | null = null;
  cleanupStatus = 200;
  extraRoutingTag: string | null = null;

  fetch = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      this.calls.push({ method, path: `${url.pathname}${url.search}`, body });
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization !== "Bearer synthetic-canary-key") {
        return Response.json({}, { status: 401 });
      }

      if (
        method === "PUT" &&
        /\/v1\/default\/banks\/[^/]+$/.test(url.pathname)
      ) {
        return Response.json({ success: true });
      }
      if (method === "POST" && url.pathname.endsWith("/health/llm")) {
        return Response.json({
          bank_id: decodeURIComponent(url.pathname.split("/").at(-3) ?? ""),
          operations: ["retain", "consolidation", "reflect"].map(
            (operation) => ({
              operation,
              ok: this.unhealthyOperation !== operation,
              status:
                this.unhealthyOperation === operation
                  ? "auth_failed"
                  : "connected",
              latency_ms: 1,
            }),
          ),
        });
      }
      if (method === "POST" && url.pathname.endsWith("/memories")) {
        const request = body as {
          items: Array<{
            content: string;
            document_id: string;
            tags: string[];
            metadata: Record<string, string>;
          }>;
        };
        const item = request.items[0]!;
        const count = item.document_id.endsWith("source-a") ? 2 : 1;
        for (let index = 0; index < count; index += 1) {
          const id = `fact-${this.facts.size + 1}`;
          this.facts.set(id, {
            id,
            text: `${item.content} extracted-${String(index + 1)}`,
            fact_type: index % 2 === 0 ? "world" : "experience",
            document_id: item.document_id,
            tags: [
              ...item.tags,
              ...(this.extraRoutingTag ? [this.extraRoutingTag] : []),
            ],
            metadata: item.metadata,
            state: "valid",
            invalidated_at: null,
          });
        }
        return Response.json({ success: true, async: false });
      }
      if (method === "GET" && url.pathname.endsWith("/memories/list")) {
        const tag = url.searchParams.get("tags");
        const state = url.searchParams.get("state");
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        const matching = [...this.facts.values()]
          .filter(
            (fact) => fact.state === state && tag && fact.tags.includes(tag),
          )
          .sort((left, right) => left.id.localeCompare(right.id));
        return Response.json({
          items: matching.slice(offset, offset + limit),
          total: matching.length,
          limit,
          offset,
        });
      }
      if (method === "GET" && url.pathname.endsWith("/stats")) {
        this.statsCalls += 1;
        if (this.failConsolidation) {
          return Response.json({
            pending_consolidation: 0,
            failed_consolidation: 1,
            total_observations: 0,
          });
        }
        return Response.json({
          pending_consolidation:
            this.statsCalls === 1 ? this.validFacts().length : 0,
          failed_consolidation: 0,
          total_observations: this.statsCalls === 1 ? 0 : 1,
        });
      }
      if (method === "POST" && url.pathname.endsWith("/memories/recall")) {
        const request = body as {
          include?: {
            source_facts?: {
              max_tokens?: number;
              max_tokens_per_observation?: number;
            };
          };
        };
        if (
          request.include?.source_facts?.max_tokens !== -1 ||
          request.include.source_facts.max_tokens_per_observation !== -1
        ) {
          return Response.json({}, { status: 400 });
        }
        const facts = this.validFacts();
        const scope = facts[0]?.tags.filter(
          (tag) => !tag.startsWith("vorton-source:"),
        );
        const sourceFacts = Object.fromEntries(
          facts.map((fact) => [
            fact.id,
            {
              ...fact,
              type: fact.fact_type,
            },
          ]),
        );
        return Response.json({
          results:
            facts.length === 0
              ? []
              : [
                  {
                    id: "observation-1",
                    text: "Synthetic cited observation",
                    type: "observation",
                    tags: scope,
                    source_fact_ids: facts.map((fact) => fact.id),
                  },
                ],
          source_facts: sourceFacts,
          source_facts_truncated: false,
        });
      }
      if (method === "PATCH" && /\/memories\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const fact = this.facts.get(id);
        if (!fact) return Response.json({}, { status: 404 });
        const request = body as {
          state?: string;
          reason?: string;
          metadata?: unknown;
        };
        if (
          request.state !== "invalidated" ||
          typeof request.reason !== "string" ||
          request.metadata !== undefined
        ) {
          return Response.json({}, { status: 400 });
        }
        fact.state = "invalidated";
        fact.invalidated_at = "2026-08-29T12:00:00Z";
        return Response.json({ success: true });
      }
      if (
        method === "DELETE" &&
        /\/v1\/default\/banks\/[^/]+$/.test(url.pathname)
      ) {
        this.deleted = true;
        return Response.json({ success: true }, { status: this.cleanupStatus });
      }
      return Response.json({}, { status: 404 });
    },
  );

  validFacts(): Fact[] {
    return [...this.facts.values()].filter((fact) => fact.state === "valid");
  }
}

function options(server: FakeHindsight) {
  let now = 0;
  const uuids = [
    "11111111-2222-4333-8444-555555555555",
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  ];
  return {
    baseUrl: "http://hindsight.internal:8888",
    apiKey: "synthetic-canary-key",
    timeoutMs: 5_000,
    pollIntervalMs: 100,
    fetch: server.fetch as typeof globalThis.fetch,
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
    uuid: () => uuids.shift()!,
  };
}

describe("Hindsight release canary", () => {
  it("proves cited consolidation, exhaustive source retirement, and cleanup", async () => {
    const server = new FakeHindsight();

    await expect(runHindsightCanary(options(server))).resolves.toMatchObject({
      status: "passed",
      bankDeleted: true,
      sourceFactCount: 3,
      citedObservationId: "hindsight:observation:observation-1",
      invalidatedFactCount: 2,
    });
    expect(server.deleted).toBe(true);
    expect(server.facts.get("fact-1")?.state).toBe("invalidated");
    expect(server.facts.get("fact-2")?.state).toBe("invalidated");
    expect(server.facts.get("fact-3")?.state).toBe("valid");
    for (const fact of server.facts.values()) {
      expect(fact.tags).toContain(
        "vorton-workspace:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      );
      expect(fact.metadata).toMatchObject({
        vorton_installation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        vorton_workspace_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        vorton_realm: "organizational",
        vorton_lineage_version: "2",
      });
    }
    expect(server.calls[0]?.path).toContain(
      encodeURIComponent(
        "organizational:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:bbbbbbbb-cccc-4ddd-8eee-ffffffffffff:default",
      ),
    );
    expect(server.calls.filter((call) => call.method === "PATCH")).toHaveLength(
      2,
    );
    expect(
      server.calls.some(
        (call) =>
          call.method === "GET" &&
          call.path.includes("state=invalidated") &&
          call.path.includes("tags_match=all_strict"),
      ),
    ).toBe(true);
  });

  it("fails on consolidation failure and still deletes the synthetic bank", async () => {
    const server = new FakeHindsight();
    server.failConsolidation = true;

    await expect(runHindsightCanary(options(server))).rejects.toThrow(
      "automatic consolidation failed",
    );
    expect(server.deleted).toBe(true);
    expect(server.calls.at(-1)?.method).toBe("DELETE");
  });

  it("fails closed on an extra foreign workspace scope and still cleans up", async () => {
    const server = new FakeHindsight();
    server.extraRoutingTag =
      "vorton-workspace:cccccccc-dddd-4eee-8fff-111111111111";

    await expect(runHindsightCanary(options(server))).rejects.toThrow(
      "crossed its routing scope",
    );
    expect(server.deleted).toBe(true);
  });

  it("fails on an unhealthy LLM operation before retaining and still cleans up", async () => {
    const server = new FakeHindsight();
    server.unhealthyOperation = "consolidation";

    await expect(runHindsightCanary(options(server))).rejects.toThrow(
      "consolidation operation is not connected",
    );
    expect(server.facts.size).toBe(0);
    expect(server.deleted).toBe(true);
  });

  it("preserves the canary failure when cleanup also fails", async () => {
    const server = new FakeHindsight();
    server.failConsolidation = true;
    server.cleanupStatus = 500;

    await expect(runHindsightCanary(options(server))).rejects.toMatchObject({
      name: "AggregateError",
      errors: expect.arrayContaining([
        expect.objectContaining({
          message: "Hindsight automatic consolidation failed",
        }),
        expect.objectContaining({
          message: expect.stringContaining("cleanup DELETE"),
        }),
      ]),
    });
  });
});
