import {
  dataClassificationSchema,
  deriveDataClassification,
  sourceCitationSchema,
  type DataClassification,
  type SourceCitation,
} from "@aubos/contracts";

import type {
  HindsightAdapter,
  HindsightBank,
  HindsightMemory,
} from "./index.js";

export interface HttpHindsightConfig {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

interface RecallItem {
  id?: unknown;
  text?: unknown;
  content?: unknown;
  type?: unknown;
  metadata?: unknown;
  tags?: unknown;
  document_id?: unknown;
  source_fact_ids?: unknown;
  fact_type?: unknown;
  state?: unknown;
}

interface ParsedSourceFact {
  classification: DataClassification;
  citations: SourceCitation[];
  sourceRevisionIds: string[];
}

function bankPath(bank: HindsightBank): string {
  if (!bank.id.startsWith(`${bank.realm}:${bank.installationId}:`)) {
    throw new Error(
      "Hindsight bank identity does not match its installation realm",
    );
  }
  return `/v1/default/banks/${encodeURIComponent(bank.id)}`;
}

function metadata(memory: HindsightMemory): Record<string, string> {
  return {
    aubos_memory_id: memory.id,
    aubos_citations: JSON.stringify(memory.citations),
    aubos_source_revision_ids: JSON.stringify(memory.sourceRevisionIds),
    aubos_invalidated_at: memory.invalidatedAt ?? "",
    aubos_classification: memory.classification,
    aubos_lineage_version: "1",
  };
}

function stableObservationScope(bank: HindsightBank): [string, string] {
  return [
    `aubos-installation:${bank.installationId}`,
    `aubos-realm:${bank.realm}`,
  ];
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function parseCitations(value: unknown): SourceCitation[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    const result = sourceCitationSchema.array().safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function citationKey(citation: SourceCitation): string {
  return JSON.stringify([
    citation.sourceRevisionId,
    citation.sourceUri,
    citation.revisionHash,
    citation.locator,
  ]);
}

/** Authenticated, server-only adapter for Hindsight's v1 REST API. */
export class HttpHindsightAdapter implements HindsightAdapter {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(config: HttpHindsightConfig) {
    if (!config.baseUrl.trim())
      throw new Error("AUBOS_HINDSIGHT_URL is required");
    if (!config.apiKey.trim())
      throw new Error("AUBOS_HINDSIGHT_API_KEY is required");
    const baseUrl = new URL(config.baseUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new Error("AUBOS_HINDSIGHT_URL must use HTTP or HTTPS");
    }
    this.#baseUrl = baseUrl.toString().replace(/\/$/, "");
    this.#apiKey = config.apiKey;
    this.#fetch = config.fetch ?? fetch;
  }

  async ensureBank(bank: HindsightBank): Promise<void> {
    await this.#request(bankPath(bank), { method: "PUT", body: "{}" });
  }

  async retain(bank: HindsightBank, memory: HindsightMemory): Promise<void> {
    await this.ensureBank(bank);
    await this.#retain(bank, memory);
  }

  async retrieve(
    bank: HindsightBank,
    query: string,
  ): Promise<HindsightMemory[]> {
    const scope = stableObservationScope(bank);
    const payload = await this.#recall(bank, {
      query,
      types: ["world", "experience", "observation"],
      prefer_observations: false,
      budget: "low",
      max_tokens: 4096,
      tags: scope,
      tags_match: "all_strict",
      include: {
        entities: null,
        source_facts: {
          max_tokens: -1,
          max_tokens_per_observation: -1,
        },
      },
    });
    return this.#parseRecall(bank, payload).filter(
      (memory) => memory.invalidatedAt === null,
    );
  }

  async invalidateSource(
    bank: HindsightBank,
    sourceRevisionId: string,
    at: string,
  ): Promise<void> {
    const sourceTag = `aubos-source:${sourceRevisionId}`;
    const invalidated = new Set<string>();
    const maximumFacts = 100_000;
    while (true) {
      const items = await this.#listActiveSourceFacts(bank, sourceTag);
      if (items.length === 0) return;
      if (invalidated.size + items.length > maximumFacts) {
        throw new Error(
          "Hindsight source invalidation exceeded its safety bound",
        );
      }
      for (const item of items) {
        if (typeof item.id !== "string" || !item.id) {
          throw new Error(
            "Hindsight list omitted the fact ID required for invalidation",
          );
        }
        const normalized: RecallItem = { ...item, type: item.fact_type };
        const parsed = this.#parseRawFact(bank, normalized);
        if (
          item.state !== "valid" ||
          !parsed ||
          !parsed.sourceRevisionIds.includes(sourceRevisionId) ||
          !Array.isArray(item.tags) ||
          !item.tags.includes(sourceTag)
        ) {
          throw new Error(
            "Hindsight list omitted valid AubOS lineage required for invalidation",
          );
        }
        if (invalidated.has(item.id)) {
          throw new Error("Hindsight source invalidation made no progress");
        }
        invalidated.add(item.id);
        await this.#request(
          `${bankPath(bank)}/memories/${encodeURIComponent(item.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              state: "invalidated",
              reason: `AubOS source revision invalidated at ${at}`,
            }),
          },
        );
      }
    }
  }

  async #listActiveSourceFacts(
    bank: HindsightBank,
    sourceTag: string,
  ): Promise<RecallItem[]> {
    const query = new URLSearchParams({
      tags: sourceTag,
      tags_match: "all_strict",
      state: "valid",
      limit: "100",
      offset: "0",
    });
    const payload = await this.#request(
      `${bankPath(bank)}/memories/list?${query.toString()}`,
      { method: "GET" },
    );
    const object =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    if (
      !object ||
      !Array.isArray(object.items) ||
      typeof object.total !== "number" ||
      typeof object.limit !== "number" ||
      typeof object.offset !== "number" ||
      object.offset !== 0 ||
      object.limit < 1 ||
      object.total < object.items.length ||
      (object.total > 0 && object.items.length === 0)
    ) {
      throw new Error("Hindsight returned an invalid memory list page");
    }
    return object.items as RecallItem[];
  }

  async #retain(bank: HindsightBank, memory: HindsightMemory): Promise<void> {
    await this.#request(`${bankPath(bank)}/memories`, {
      method: "POST",
      body: JSON.stringify({
        async: false,
        items: [
          {
            content: memory.text,
            context: "aubos-derived-memory",
            document_id: memory.id,
            update_mode: "replace",
            tags: [
              `aubos-installation:${bank.installationId}`,
              `aubos-realm:${bank.realm}`,
              ...memory.sourceRevisionIds.map((id) => `aubos-source:${id}`),
            ],
            observation_scopes: [stableObservationScope(bank)],
            metadata: metadata(memory),
          },
        ],
      }),
    });
  }

  #recall(
    bank: HindsightBank,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.#request(`${bankPath(bank)}/memories/recall`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  #parseRecall(bank: HindsightBank, payload: unknown): HindsightMemory[] {
    const object =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const items = Array.isArray(object.results)
      ? (object.results as RecallItem[])
      : Array.isArray(object.memories)
        ? (object.memories as RecallItem[])
        : [];
    const sourceFacts =
      object.source_facts &&
      typeof object.source_facts === "object" &&
      !Array.isArray(object.source_facts)
        ? (object.source_facts as Record<string, RecallItem>)
        : {};
    const sourceFactsTruncated = object.source_facts_truncated === true;
    return items.flatMap((item) => {
      if (item.type === "observation") {
        const observation = this.#parseObservation(
          bank,
          item,
          sourceFacts,
          sourceFactsTruncated,
        );
        return observation ? [observation] : [];
      }
      const rawFact = this.#parseRawFact(bank, item);
      return rawFact ? [rawFact] : [];
    });
  }

  #parseRawFact(bank: HindsightBank, item: RecallItem): HindsightMemory | null {
    const itemMetadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {};
    const id =
      typeof itemMetadata.aubos_memory_id === "string"
        ? itemMetadata.aubos_memory_id
        : typeof item.id === "string"
          ? item.id
          : null;
    const text =
      typeof item.text === "string"
        ? item.text
        : typeof item.content === "string"
          ? item.content
          : null;
    const citations = parseCitations(itemMetadata.aubos_citations);
    const sourceRevisionIds = parseStringArray(
      itemMetadata.aubos_source_revision_ids,
    );
    const invalidatedAt = itemMetadata.aubos_invalidated_at;
    const classification = dataClassificationSchema.safeParse(
      itemMetadata.aubos_classification,
    );
    if (
      !id ||
      !text ||
      (item.type !== "world" && item.type !== "experience") ||
      itemMetadata.aubos_lineage_version !== "1" ||
      !classification.success ||
      typeof invalidatedAt !== "string" ||
      item.document_id !== id ||
      citations.length === 0 ||
      sourceRevisionIds.length === 0 ||
      !sameStringSet(
        sourceRevisionIds,
        citations.map((citation) => citation.sourceRevisionId),
      ) ||
      !Array.isArray(item.tags) ||
      !item.tags.every((tag) => typeof tag === "string")
    ) {
      return null;
    }
    const tags = new Set(item.tags as string[]);
    if (
      !stableObservationScope(bank).every((tag) => tags.has(tag)) ||
      ![...new Set(sourceRevisionIds)].every((sourceRevisionId) =>
        tags.has(`aubos-source:${sourceRevisionId}`),
      )
    ) {
      return null;
    }
    return {
      id,
      text,
      classification: classification.data,
      citations,
      sourceRevisionIds,
      invalidatedAt: invalidatedAt || null,
    };
  }

  #parseObservation(
    bank: HindsightBank,
    item: RecallItem,
    sourceFacts: Record<string, RecallItem>,
    sourceFactsTruncated: boolean,
  ): HindsightMemory | null {
    if (
      sourceFactsTruncated ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.text !== "string" ||
      !item.text ||
      !Array.isArray(item.source_fact_ids) ||
      item.source_fact_ids.length === 0 ||
      !Array.isArray(item.tags) ||
      !item.tags.every((tag) => typeof tag === "string") ||
      !sameStringSet(item.tags as string[], stableObservationScope(bank)) ||
      !item.source_fact_ids.every(
        (sourceFactId) =>
          typeof sourceFactId === "string" && sourceFactId.length > 0,
      )
    ) {
      return null;
    }

    const parsedFacts: ParsedSourceFact[] = [];
    for (const sourceFactId of item.source_fact_ids as string[]) {
      const sourceFact = sourceFacts[sourceFactId];
      const parsed = this.#parseObservationSourceFact(
        bank,
        sourceFactId,
        sourceFact,
      );
      if (!parsed) return null;
      parsedFacts.push(parsed);
    }

    const citationsByKey = new Map<string, SourceCitation>();
    const sourceRevisionIds = new Set<string>();
    for (const fact of parsedFacts) {
      for (const citation of fact.citations) {
        citationsByKey.set(citationKey(citation), citation);
      }
      for (const sourceRevisionId of fact.sourceRevisionIds) {
        sourceRevisionIds.add(sourceRevisionId);
      }
    }

    return {
      id: `hindsight:observation:${item.id}`,
      text: item.text,
      classification: deriveDataClassification(
        parsedFacts.map((fact) => fact.classification),
      ),
      citations: [...citationsByKey.entries()]
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([, citation]) => citation),
      sourceRevisionIds: [...sourceRevisionIds].sort(compareStrings),
      invalidatedAt: null,
    };
  }

  #parseObservationSourceFact(
    bank: HindsightBank,
    sourceFactId: string,
    sourceFact: RecallItem | undefined,
  ): ParsedSourceFact | null {
    if (
      !sourceFact ||
      sourceFact.id !== sourceFactId ||
      (sourceFact.type !== "world" && sourceFact.type !== "experience") ||
      !sourceFact.metadata ||
      typeof sourceFact.metadata !== "object" ||
      Array.isArray(sourceFact.metadata) ||
      !Array.isArray(sourceFact.tags) ||
      !sourceFact.tags.every((tag) => typeof tag === "string")
    ) {
      return null;
    }

    const itemMetadata = sourceFact.metadata as Record<string, unknown>;
    const memoryId = itemMetadata.aubos_memory_id;
    const citations = parseCitations(itemMetadata.aubos_citations);
    const sourceRevisionIds = parseStringArray(
      itemMetadata.aubos_source_revision_ids,
    );
    const classification = dataClassificationSchema.safeParse(
      itemMetadata.aubos_classification,
    );
    if (
      itemMetadata.aubos_lineage_version !== "1" ||
      !classification.success ||
      itemMetadata.aubos_invalidated_at !== "" ||
      typeof memoryId !== "string" ||
      !memoryId ||
      sourceFact.document_id !== memoryId ||
      citations.length === 0 ||
      sourceRevisionIds.length === 0 ||
      !sameStringSet(
        sourceRevisionIds,
        citations.map((citation) => citation.sourceRevisionId),
      )
    ) {
      return null;
    }

    const tags = new Set(sourceFact.tags as string[]);
    if (
      !stableObservationScope(bank).every((tag) => tags.has(tag)) ||
      ![...new Set(sourceRevisionIds)].every((sourceRevisionId) =>
        tags.has(`aubos-source:${sourceRevisionId}`),
      )
    ) {
      return null;
    }

    return {
      classification: classification.data,
      citations,
      sourceRevisionIds,
    };
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`Hindsight request failed with HTTP ${response.status}`);
    if (response.status === 204) return {};
    return response.json();
  }
}

export function createHttpHindsightAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HttpHindsightAdapter {
  return new HttpHindsightAdapter({
    baseUrl: env.AUBOS_HINDSIGHT_URL ?? "",
    apiKey: env.AUBOS_HINDSIGHT_API_KEY ?? "",
  });
}
