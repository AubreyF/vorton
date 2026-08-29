import { describe, expect, it, vi } from "vitest";

import {
  HttpHindsightAdapter,
  type HindsightBank,
  type HindsightMemory,
} from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const sourceRevisionId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const bank: HindsightBank = {
  id: `organizational:${installationId}:default`,
  installationId,
  realm: "organizational",
};
const memory: HindsightMemory = {
  id: "derived-memory-1",
  text: "Synthetic derived memory",
  citations: [
    {
      sourceRevisionId,
      sourceUri: "urn:aubos:synthetic",
      revisionHash: "a".repeat(64),
      locator: "fixture:1",
    },
  ],
  sourceRevisionIds: [sourceRevisionId],
  invalidatedAt: null,
};

describe("HTTP Hindsight adapter", () => {
  it("fails closed without a server URL and API key", () => {
    expect(() => new HttpHindsightAdapter({ baseUrl: "", apiKey: "" })).toThrow(
      "URL is required",
    );
    expect(
      () =>
        new HttpHindsightAdapter({
          baseUrl: "http://hindsight.internal:8888",
          apiKey: "",
        }),
    ).toThrow("API_KEY is required");
  });

  it("retains deterministic document identity and complete AubOS lineage", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const adapter = new HttpHindsightAdapter({
      baseUrl: "http://hindsight.internal:8888",
      apiKey: "synthetic-secret",
      fetch: fetch as typeof globalThis.fetch,
    });
    await adapter.retain(bank, memory);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer synthetic-secret",
    });
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body.items[0]).toMatchObject({
      document_id: memory.id,
      update_mode: "replace",
    });
    expect(JSON.parse(body.items[0].metadata.aubos_citations)).toEqual(
      memory.citations,
    );
    expect(
      JSON.parse(body.items[0].metadata.aubos_source_revision_ids),
    ).toEqual([sourceRevisionId]);
  });

  it("invalidates exact Hindsight facts without retaining replacement facts", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(_url), method: init?.method ?? "GET", body });
        if (calls.length === 1) {
          return Response.json({
            results: [
              {
                id: "fact-1",
                text: memory.text,
                metadata: {
                  aubos_memory_id: memory.id,
                  aubos_citations: JSON.stringify(memory.citations),
                  aubos_source_revision_ids: JSON.stringify(
                    memory.sourceRevisionIds,
                  ),
                  aubos_invalidated_at: "",
                  aubos_lineage_version: "1",
                },
              },
            ],
          });
        }
        return Response.json({});
      },
    );
    const adapter = new HttpHindsightAdapter({
      baseUrl: "http://hindsight.internal:8888",
      apiKey: "synthetic-secret",
      fetch: fetch as typeof globalThis.fetch,
    });
    await adapter.invalidateSource(
      bank,
      sourceRevisionId,
      "2026-08-28T12:00:00.000Z",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      url: expect.stringContaining("/memories/fact-1"),
      method: "PATCH",
      body: {
        state: "invalidated",
        metadata: { aubos_invalidated_at: "2026-08-28T12:00:00.000Z" },
      },
    });
    expect(
      calls.some(
        (call) => call.method === "POST" && call.url.endsWith("/memories"),
      ),
    ).toBe(false);
  });

  it("fails closed when Hindsight omits a fact ID required for invalidation", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        results: [
          {
            text: memory.text,
            metadata: {
              aubos_memory_id: memory.id,
              aubos_citations: JSON.stringify(memory.citations),
              aubos_source_revision_ids: JSON.stringify(
                memory.sourceRevisionIds,
              ),
              aubos_invalidated_at: "",
              aubos_lineage_version: "1",
            },
          },
        ],
      }),
    );
    const adapter = new HttpHindsightAdapter({
      baseUrl: "http://hindsight.internal:8888",
      apiKey: "synthetic-secret",
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(
      adapter.invalidateSource(
        bank,
        sourceRevisionId,
        "2026-08-28T12:00:00.000Z",
      ),
    ).rejects.toThrow("fact ID");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
