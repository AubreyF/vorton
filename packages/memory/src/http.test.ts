import { describe, expect, it, vi } from "vitest";

import {
  HttpHindsightAdapter,
  type HindsightBank,
  type HindsightMemory,
} from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const sourceRevisionId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const secondSourceRevisionId = "11111111-2222-4333-8444-555555555555";
const bank: HindsightBank = {
  id: `organizational:${installationId}:default`,
  installationId,
  realm: "organizational",
};
const observationTags = [
  `vorton-installation:${installationId}`,
  "vorton-realm:organizational",
];
const memory: HindsightMemory = {
  id: "derived-memory-1",
  text: "Synthetic derived memory",
  classification: "synthetic",
  citations: [
    {
      sourceRevisionId,
      sourceUri: "urn:vorton:synthetic",
      revisionHash: "a".repeat(64),
      locator: "fixture:1",
    },
  ],
  sourceRevisionIds: [sourceRevisionId],
  invalidatedAt: null,
};
const secondCitation = {
  sourceRevisionId: secondSourceRevisionId,
  sourceUri: "urn:vorton:second-synthetic",
  revisionHash: "b".repeat(64),
  locator: "fixture:2",
};

function lineageMetadata(input: {
  memoryId: string;
  citations: HindsightMemory["citations"];
  sourceRevisionIds: string[];
  classification?: HindsightMemory["classification"];
  invalidatedAt?: string;
}): Record<string, string> {
  return {
    vorton_memory_id: input.memoryId,
    vorton_citations: JSON.stringify(input.citations),
    vorton_source_revision_ids: JSON.stringify(input.sourceRevisionIds),
    vorton_invalidated_at: input.invalidatedAt ?? "",
    vorton_classification: input.classification ?? "synthetic",
    vorton_lineage_version: "1",
  };
}

function sourceFact(input: {
  id: string;
  memoryId: string;
  type?: "world" | "experience";
  citations?: HindsightMemory["citations"];
  sourceRevisionIds?: string[];
  classification?: HindsightMemory["classification"];
}) {
  const citations = input.citations ?? memory.citations;
  const sourceRevisionIds = input.sourceRevisionIds ?? [sourceRevisionId];
  return {
    id: input.id,
    text: `Source ${input.id}`,
    type: input.type ?? "world",
    document_id: input.memoryId,
    tags: [
      `vorton-installation:${installationId}`,
      "vorton-realm:organizational",
      ...sourceRevisionIds.map((id) => `vorton-source:${id}`),
    ],
    metadata: lineageMetadata({
      memoryId: input.memoryId,
      citations,
      sourceRevisionIds,
      classification: input.classification,
    }),
  };
}

function listedSourceFact(input: Parameters<typeof sourceFact>[0]) {
  const fact = sourceFact(input);
  const { type, ...listed } = fact;
  return { ...listed, fact_type: type, state: "valid" };
}

const rawFallback = {
  id: "fact-raw",
  text: memory.text,
  type: "world",
  document_id: memory.id,
  tags: [
    `vorton-installation:${installationId}`,
    "vorton-realm:organizational",
    `vorton-source:${sourceRevisionId}`,
  ],
  metadata: lineageMetadata({
    memoryId: memory.id,
    citations: memory.citations,
    sourceRevisionIds: memory.sourceRevisionIds,
  }),
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

  it("retains deterministic document identity and complete Vorton lineage", async () => {
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
      observation_scopes: [
        [
          `vorton-installation:${installationId}`,
          "vorton-realm:organizational",
        ],
      ],
    });
    expect(body.items[0].observation_scopes[0]).not.toContain(
      `vorton-source:${sourceRevisionId}`,
    );
    expect(JSON.parse(body.items[0].metadata.vorton_citations)).toEqual(
      memory.citations,
    );
    expect(
      JSON.parse(body.items[0].metadata.vorton_source_revision_ids),
    ).toEqual([sourceRevisionId]);
    expect(body.items[0].metadata.vorton_classification).toBe("synthetic");
  });

  it("requests raw facts and fully hydrated native observations within the stable bank scope", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json({ results: [] });
      },
    );
    const adapter = new HttpHindsightAdapter({
      baseUrl: "http://hindsight.internal:8888",
      apiKey: "synthetic-secret",
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(adapter.retrieve(bank, "synthetic query")).resolves.toEqual(
      [],
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      query: "synthetic query",
      types: ["world", "experience", "observation"],
      prefer_observations: false,
      budget: "low",
      max_tokens: 4096,
      tags: [
        `vorton-installation:${installationId}`,
        "vorton-realm:organizational",
      ],
      tags_match: "all_strict",
      include: {
        entities: null,
        source_facts: {
          max_tokens: -1,
          max_tokens_per_observation: -1,
        },
      },
    });
  });

  it("hydrates multi-source observations and deduplicates lineage deterministically", async () => {
    const firstFact = sourceFact({
      id: "fact-first",
      memoryId: "source-memory-first",
      citations: [...memory.citations, secondCitation],
      sourceRevisionIds: [sourceRevisionId, secondSourceRevisionId],
    });
    const secondFact = sourceFact({
      id: "fact-second",
      memoryId: "source-memory-second",
      type: "experience",
      citations: [secondCitation],
      sourceRevisionIds: [secondSourceRevisionId],
      classification: "restricted",
    });
    const fetch = vi.fn(async () =>
      Response.json({
        results: [
          {
            id: "observation-7",
            text: "Synthetic durable observation",
            type: "observation",
            tags: observationTags,
            source_fact_ids: [secondFact.id, firstFact.id],
          },
        ],
        source_facts: {
          [secondFact.id]: secondFact,
          [firstFact.id]: firstFact,
        },
        source_facts_truncated: false,
      }),
    );
    const adapter = new HttpHindsightAdapter({
      baseUrl: "http://hindsight.internal:8888",
      apiKey: "synthetic-secret",
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(adapter.retrieve(bank, "synthetic query")).resolves.toEqual([
      {
        id: "hindsight:observation:observation-7",
        text: "Synthetic durable observation",
        classification: "restricted",
        citations: [secondCitation, memory.citations[0]],
        sourceRevisionIds: [secondSourceRevisionId, sourceRevisionId],
        invalidatedAt: null,
      },
    ]);
  });

  it.each([
    {
      name: "missing source fact",
      response: {
        source_facts: {},
        source_facts_truncated: false,
      },
    },
    {
      name: "truncated source facts",
      response: {
        source_facts: {
          "fact-source": sourceFact({
            id: "fact-source",
            memoryId: "source-memory",
          }),
        },
        source_facts_truncated: true,
      },
    },
    {
      name: "empty source fact list",
      observation: { source_fact_ids: [] },
      response: {
        source_facts: {},
        source_facts_truncated: false,
      },
    },
    {
      name: "wrong observation scope",
      observation: { tags: ["vorton-realm:personal"] },
      response: {
        source_facts: {
          "fact-source": sourceFact({
            id: "fact-source",
            memoryId: "source-memory",
          }),
        },
        source_facts_truncated: false,
      },
    },
  ])(
    "drops an observation with $name while preserving raw fallback",
    async (fixture) => {
      const fetch = vi.fn(async () =>
        Response.json({
          results: [
            rawFallback,
            {
              id: "observation-untrusted",
              text: "Must be omitted",
              type: "observation",
              tags: observationTags,
              source_fact_ids: ["fact-source"],
              ...fixture.observation,
            },
          ],
          ...fixture.response,
        }),
      );
      const adapter = new HttpHindsightAdapter({
        baseUrl: "http://hindsight.internal:8888",
        apiKey: "synthetic-secret",
        fetch: fetch as typeof globalThis.fetch,
      });

      await expect(adapter.retrieve(bank, "synthetic query")).resolves.toEqual([
        memory,
      ]);
    },
  );

  it.each([
    {
      name: "wrong source type",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        type: "observation",
      }),
    },
    {
      name: "mismatched source fact ID",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        id: "different-fact",
      }),
    },
    {
      name: "grafted document metadata",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        document_id: "different-memory",
      }),
    },
    {
      name: "missing Vorton lineage version",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        metadata: { ...fact.metadata, vorton_lineage_version: "" },
      }),
    },
    {
      name: "missing Vorton classification",
      mutate: (fact: ReturnType<typeof sourceFact>) => {
        const { vorton_classification: _omitted, ...metadata } = fact.metadata;
        return { ...fact, metadata };
      },
    },
    {
      name: "malformed Vorton classification",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        metadata: { ...fact.metadata, vorton_classification: "classified" },
      }),
    },
    {
      name: "empty citations",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        metadata: { ...fact.metadata, vorton_citations: "[]" },
      }),
    },
    {
      name: "empty source revision IDs",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        metadata: { ...fact.metadata, vorton_source_revision_ids: "[]" },
      }),
    },
    {
      name: "citation and revision mismatch",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        metadata: {
          ...fact.metadata,
          vorton_source_revision_ids: JSON.stringify([secondSourceRevisionId]),
        },
      }),
    },
    {
      name: "missing installation tag",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        tags: fact.tags.filter(
          (tag) => tag !== `vorton-installation:${installationId}`,
        ),
      }),
    },
    {
      name: "missing source revision tag",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        tags: fact.tags.filter(
          (tag) => tag !== `vorton-source:${sourceRevisionId}`,
        ),
      }),
    },
    {
      name: "invalidated source",
      mutate: (fact: ReturnType<typeof sourceFact>) => ({
        ...fact,
        metadata: {
          ...fact.metadata,
          vorton_invalidated_at: "2026-08-28T12:00:00.000Z",
        },
      }),
    },
  ])(
    "drops an observation with $name while preserving raw fallback",
    async ({ mutate }) => {
      const fact = mutate(
        sourceFact({ id: "fact-source", memoryId: "source-memory" }),
      );
      const fetch = vi.fn(async () =>
        Response.json({
          results: [
            {
              id: "observation-untrusted",
              text: "Must be omitted",
              type: "observation",
              tags: observationTags,
              source_fact_ids: ["fact-source"],
            },
            rawFallback,
          ],
          source_facts: { "fact-source": fact },
          source_facts_truncated: false,
        }),
      );
      const adapter = new HttpHindsightAdapter({
        baseUrl: "http://hindsight.internal:8888",
        apiKey: "synthetic-secret",
        fetch: fetch as typeof globalThis.fetch,
      });

      await expect(adapter.retrieve(bank, "synthetic query")).resolves.toEqual([
        memory,
      ]);
    },
  );

  it.each([
    {
      name: "missing classification",
      classification: undefined,
    },
    {
      name: "malformed classification",
      classification: "classified",
    },
  ])("drops a raw fact with $name", async ({ classification }) => {
    const metadata = { ...rawFallback.metadata } as Record<string, unknown>;
    if (classification === undefined) delete metadata.vorton_classification;
    else metadata.vorton_classification = classification;
    const fetch = vi.fn(async () =>
      Response.json({
        results: [{ ...rawFallback, metadata }],
      }),
    );
    const adapter = new HttpHindsightAdapter({
      baseUrl: "http://hindsight.internal:8888",
      apiKey: "synthetic-secret",
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(adapter.retrieve(bank, "synthetic query")).resolves.toEqual(
      [],
    );
  });

  it("invalidates exact Hindsight facts without retaining replacement facts", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    let listCalls = 0;
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(_url), method: init?.method ?? "GET", body });
        if ((init?.method ?? "GET") === "GET") {
          listCalls += 1;
          if (listCalls > 1) {
            return Response.json({
              items: [],
              total: 0,
              limit: 100,
              offset: 0,
            });
          }
          return Response.json({
            items: [
              {
                ...listedSourceFact({
                  id: "fact-1",
                  memoryId: memory.id,
                }),
                text: memory.text,
              },
              {
                ...listedSourceFact({
                  id: "fact-2",
                  memoryId: "derived-memory-2",
                  type: "experience",
                }),
                text: "Second synthetic fact",
              },
            ],
            total: 2,
            limit: 100,
            offset: 0,
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
    expect(calls).toHaveLength(4);
    const listUrl = new URL(calls[0]!.url);
    expect(listUrl.pathname).toContain("/memories/list");
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      tags: `vorton-source:${sourceRevisionId}`,
      tags_match: "all_strict",
      state: "valid",
      limit: "100",
      offset: "0",
    });
    expect(calls[1]).toMatchObject({
      url: expect.stringContaining("/memories/fact-1"),
      method: "PATCH",
      body: {
        state: "invalidated",
        reason:
          "Vorton source revision invalidated at 2026-08-28T12:00:00.000Z",
      },
    });
    expect(calls[2]).toMatchObject({
      url: expect.stringContaining("/memories/fact-2"),
      method: "PATCH",
    });
    expect(calls[3]).toMatchObject({ method: "GET" });
    expect(
      calls.some(
        (call) => call.method === "POST" && call.url.endsWith("/memories"),
      ),
    ).toBe(false);
  });

  it("fails closed when Hindsight omits a fact ID required for invalidation", async () => {
    const { id: _omitted, ...factWithoutId } = sourceFact({
      id: "fact-withheld",
      memoryId: memory.id,
    });
    const fetch = vi.fn(async () =>
      Response.json({
        items: [
          {
            ...factWithoutId,
            fact_type: factWithoutId.type,
            state: "valid",
            text: memory.text,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
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

  it("fails closed when an invalidated fact remains on the active list", async () => {
    const repeated = listedSourceFact({
      id: "fact-repeated",
      memoryId: memory.id,
    });
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "PATCH") return Response.json({});
        return Response.json({
          items: [repeated],
          total: 1,
          limit: 100,
          offset: 0,
        });
      },
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
    ).rejects.toThrow("made no progress");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
