import { sourceCitationSchema, type SourceCitation } from "@aubos/contracts";

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
  metadata?: unknown;
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
    aubos_lineage_version: "1",
  };
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
    const payload = await this.#recall(bank, { query, budget: "low" });
    return this.#parseRecall(payload).filter(
      (memory) => memory.invalidatedAt === null,
    );
  }

  async invalidateSource(
    bank: HindsightBank,
    sourceRevisionId: string,
    at: string,
  ): Promise<void> {
    const payload = await this.#recall(bank, {
      query: sourceRevisionId,
      budget: "low",
      tags: [`aubos-source:${sourceRevisionId}`],
      tags_match: "any_strict",
    });
    const object =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const items = Array.isArray(object.results)
      ? (object.results as RecallItem[])
      : Array.isArray(object.memories)
        ? (object.memories as RecallItem[])
        : [];
    for (const item of items) {
      const parsed = this.#parseRecall({ results: [item] })[0];
      if (!parsed?.sourceRevisionIds.includes(sourceRevisionId)) continue;
      if (typeof item.id !== "string" || !item.id) {
        throw new Error(
          "Hindsight recall omitted the fact ID required for invalidation",
        );
      }
      const itemMetadata =
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {};
      await this.#request(
        `${bankPath(bank)}/memories/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            state: "invalidated",
            metadata: {
              ...itemMetadata,
              aubos_invalidated_at: at,
            },
          }),
        },
      );
    }
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

  #parseRecall(payload: unknown): HindsightMemory[] {
    const object =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const items = Array.isArray(object.results)
      ? (object.results as RecallItem[])
      : Array.isArray(object.memories)
        ? (object.memories as RecallItem[])
        : [];
    return items.flatMap((item) => {
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
      if (!id || !text || itemMetadata.aubos_lineage_version !== "1") return [];
      return [
        {
          id,
          text,
          citations: parseCitations(itemMetadata.aubos_citations),
          sourceRevisionIds: parseStringArray(
            itemMetadata.aubos_source_revision_ids,
          ),
          invalidatedAt:
            typeof itemMetadata.aubos_invalidated_at === "string" &&
            itemMetadata.aubos_invalidated_at
              ? itemMetadata.aubos_invalidated_at
              : null,
        },
      ];
    });
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
