import { createHash, randomUUID } from "node:crypto";

import {
  HttpHindsightAdapter,
  type HindsightBank,
  type HindsightMemory,
  workspaceHindsightBank,
} from "@vorton/memory";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGES = 1_000;

type Fetch = typeof globalThis.fetch;

interface SourceCitation {
  sourceRevisionId: string;
  sourceUri: string;
  revisionHash: string;
  locator: string;
}

interface CanarySource {
  memory: HindsightMemory;
  citation: SourceCitation;
  sourceTag: string;
}

interface ListedFact {
  id?: unknown;
  fact_type?: unknown;
  document_id?: unknown;
  tags?: unknown;
  metadata?: unknown;
  state?: unknown;
  invalidated_at?: unknown;
}

interface ListResponse {
  items?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
}

interface BankStats {
  pending_consolidation?: unknown;
  failed_consolidation?: unknown;
  total_observations?: unknown;
}

export interface HindsightCanaryOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetch?: Fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  uuid?: () => string;
}

export interface HindsightCanaryResult {
  status: "passed";
  bankDeleted: true;
  sourceFactCount: number;
  citedObservationId: string;
  invalidatedFactCount: number;
  durationMs: number;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function boundedInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer from ${String(minimum)} through ${String(maximum)}`,
    );
  }
  return value;
}

function parseOptionalInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim()))
    throw new Error(`${name} must be an integer`);
  return boundedInteger(Number(value), name, minimum, maximum);
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(required(value, "VORTON_HINDSIGHT_URL"));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VORTON_HINDSIGHT_URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("VORTON_HINDSIGHT_URL must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "VORTON_HINDSIGHT_URL must not contain a query or fragment",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

function asObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} returned a malformed object`);
  }
  return value as Record<string, unknown>;
}

function asNonNegativeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value as number;
}

function asStringArray(value: unknown, context: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${context} must be an array of strings`);
  }
  return value;
}

function parseJson(value: unknown, context: string): unknown {
  if (typeof value !== "string")
    throw new Error(`${context} must be JSON text`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${context} contains malformed JSON`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function combineSignals(
  signals: Array<AbortSignal | null | undefined>,
): AbortSignal {
  const present = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined && signal !== null,
  );
  return present.length === 1 ? present[0]! : AbortSignal.any(present);
}

function createSource(input: {
  runId: string;
  suffix: "a" | "b";
  text: string;
}): CanarySource {
  const sourceRevisionId = randomUuidFrom(input.runId, input.suffix);
  const sourceUri = `urn:vorton:synthetic:hindsight-release-canary:${input.runId}:source-${input.suffix}`;
  const citation: SourceCitation = {
    sourceRevisionId,
    sourceUri,
    revisionHash: sha256(input.text),
    locator: `canary:source-${input.suffix}`,
  };
  return {
    citation,
    sourceTag: `vorton-source:${sourceRevisionId}`,
    memory: {
      id: `hindsight-release-canary-${input.runId}-source-${input.suffix}`,
      text: input.text,
      classification: "synthetic",
      citations: [citation],
      sourceRevisionIds: [sourceRevisionId],
      invalidatedAt: null,
    },
  };
}

function randomUuidFrom(runId: string, suffix: "a" | "b"): string {
  const digest = createHash("sha256")
    .update(`${runId}:${suffix}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

class CanaryClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #deadline: number;
  readonly #now: () => number;

  constructor(input: {
    baseUrl: string;
    apiKey: string;
    fetch: Fetch;
    deadline: number;
    now: () => number;
  }) {
    this.#baseUrl = input.baseUrl;
    this.#apiKey = input.apiKey;
    this.#fetch = input.fetch;
    this.#deadline = input.deadline;
    this.#now = input.now;
  }

  boundedFetch: Fetch = async (input, init) => {
    const remaining = this.remaining();
    return this.#fetch(input, {
      ...init,
      signal: combineSignals([init?.signal, AbortSignal.timeout(remaining)]),
    });
  };

  remaining(): number {
    const remaining = Math.floor(this.#deadline - this.#now());
    if (remaining <= 0) throw new Error("Hindsight release canary timed out");
    return remaining;
  }

  async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.boundedFetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Hindsight canary request ${init.method ?? "GET"} ${path.split("?")[0]} failed with HTTP ${String(response.status)}`,
      );
    }
    if (response.status === 204) return {};
    return response.json();
  }

  async cleanupBank(bankPath: string): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}${bankPath}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Hindsight canary cleanup DELETE ${bankPath} failed with HTTP ${String(response.status)}`,
      );
    }
  }
}

function bankPath(bank: HindsightBank): string {
  return `/v1/default/banks/${encodeURIComponent(bank.id)}`;
}

function validateLineage(
  fact: ListedFact,
  source: CanarySource,
  scopeTags: string[],
  bank: HindsightBank,
  expectedState: "valid" | "invalidated",
): string {
  if (typeof fact.id !== "string" || fact.id.length === 0) {
    throw new Error("Hindsight source list omitted a fact ID");
  }
  if (fact.fact_type !== "world" && fact.fact_type !== "experience") {
    throw new Error(`Hindsight fact ${fact.id} has an unexpected fact type`);
  }
  if (fact.document_id !== source.memory.id || fact.state !== expectedState) {
    throw new Error(
      `Hindsight fact ${fact.id} lost its document or curation state`,
    );
  }
  const tags = asStringArray(fact.tags, `Hindsight fact ${fact.id} tags`);
  const routingTags = tags.filter((tag) =>
    ["vorton-installation:", "vorton-workspace:", "vorton-realm:"].some(
      (prefix) => tag.startsWith(prefix),
    ),
  );
  if (
    routingTags.length !== scopeTags.length ||
    new Set(routingTags).size !== scopeTags.length ||
    scopeTags.some((tag) => !routingTags.includes(tag))
  ) {
    throw new Error(`Hindsight fact ${fact.id} crossed its routing scope`);
  }
  for (const tag of [...scopeTags, source.sourceTag]) {
    if (!tags.includes(tag)) {
      throw new Error(`Hindsight fact ${fact.id} lost required source scope`);
    }
  }
  const metadata = asObject(
    fact.metadata,
    `Hindsight fact ${fact.id} metadata`,
  );
  if (
    metadata.vorton_memory_id !== source.memory.id ||
    metadata.vorton_classification !== "synthetic" ||
    metadata.vorton_installation_id !== bank.installationId ||
    metadata.vorton_workspace_id !== bank.workspaceId ||
    metadata.vorton_realm !== bank.realm ||
    metadata.vorton_lineage_version !== "2" ||
    metadata.vorton_invalidated_at !== ""
  ) {
    throw new Error(`Hindsight fact ${fact.id} lost Vorton lineage metadata`);
  }
  const citations = parseJson(
    metadata.vorton_citations,
    `Hindsight fact ${fact.id} citations`,
  );
  const sourceRevisionIds = parseJson(
    metadata.vorton_source_revision_ids,
    `Hindsight fact ${fact.id} source revisions`,
  );
  if (
    !sameJson(citations, source.memory.citations) ||
    !sameJson(sourceRevisionIds, source.memory.sourceRevisionIds)
  ) {
    throw new Error(`Hindsight fact ${fact.id} changed its citation lineage`);
  }
  if (
    expectedState === "invalidated" &&
    (typeof fact.invalidated_at !== "string" ||
      fact.invalidated_at.length === 0)
  ) {
    throw new Error(`Hindsight fact ${fact.id} lacks invalidation bookkeeping`);
  }
  return fact.id;
}

async function listSourceFacts(
  client: CanaryClient,
  path: string,
  sourceTag: string,
  state: "valid" | "invalidated",
): Promise<ListedFact[]> {
  const collected: ListedFact[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let pages = 0;
  while (true) {
    pages += 1;
    if (pages > MAX_LIST_PAGES) {
      throw new Error("Hindsight source listing exceeded its pagination bound");
    }
    const query = new URLSearchParams({
      tags: sourceTag,
      tags_match: "all_strict",
      state,
      limit: String(LIST_PAGE_SIZE),
      offset: String(offset),
    });
    const response = asObject(
      await client.request(`${path}/memories/list?${query.toString()}`),
      "Hindsight source list",
    ) as ListResponse;
    if (!Array.isArray(response.items)) {
      throw new Error("Hindsight source list omitted items");
    }
    const total = asNonNegativeInteger(
      response.total,
      "Hindsight source list total",
    );
    const limit = asNonNegativeInteger(
      response.limit,
      "Hindsight source list limit",
    );
    const responseOffset = asNonNegativeInteger(
      response.offset,
      "Hindsight source list offset",
    );
    if (limit !== LIST_PAGE_SIZE || responseOffset !== offset) {
      throw new Error("Hindsight source list changed its pagination contract");
    }
    for (const item of response.items) {
      const fact = asObject(item, "Hindsight listed fact") as ListedFact;
      if (typeof fact.id !== "string" || seen.has(fact.id)) {
        throw new Error(
          "Hindsight source list returned a missing or duplicate fact ID",
        );
      }
      seen.add(fact.id);
      collected.push(fact);
    }
    if (collected.length === total) return collected;
    if (collected.length > total || response.items.length === 0) {
      throw new Error(
        "Hindsight source list returned inconsistent pagination totals",
      );
    }
    offset += response.items.length;
  }
}

async function verifyLlmHealth(
  client: CanaryClient,
  path: string,
): Promise<void> {
  const payload = asObject(
    await client.request(`${path}/health/llm`, { method: "POST", body: "{}" }),
    "Hindsight bank LLM health",
  );
  if (!Array.isArray(payload.operations)) {
    throw new Error("Hindsight bank LLM health omitted operations");
  }
  const operations = new Map<string, Record<string, unknown>>();
  for (const value of payload.operations) {
    const operation = asObject(value, "Hindsight bank LLM operation");
    if (typeof operation.operation !== "string") {
      throw new Error(
        "Hindsight bank LLM health returned an unnamed operation",
      );
    }
    operations.set(operation.operation, operation);
  }
  for (const name of ["retain", "consolidation", "reflect"] as const) {
    const operation = operations.get(name);
    if (
      !operation ||
      operation.ok !== true ||
      operation.status !== "connected"
    ) {
      throw new Error(`Hindsight bank LLM ${name} operation is not connected`);
    }
  }
}

async function pollConsolidation(input: {
  client: CanaryClient;
  path: string;
  pollIntervalMs: number;
  sleep: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  while (true) {
    const query = new URLSearchParams({ refresh: "true" });
    const stats = asObject(
      await input.client.request(`${input.path}/stats?${query.toString()}`),
      "Hindsight bank stats",
    ) as BankStats;
    const pending = asNonNegativeInteger(
      stats.pending_consolidation,
      "Hindsight pending consolidation",
    );
    const failed = asNonNegativeInteger(
      stats.failed_consolidation,
      "Hindsight failed consolidation",
    );
    const observations = asNonNegativeInteger(
      stats.total_observations,
      "Hindsight total observations",
    );
    if (failed > 0) {
      throw new Error("Hindsight automatic consolidation failed");
    }
    if (pending === 0) {
      if (observations === 0) {
        throw new Error(
          "Hindsight consolidation completed without an observation",
        );
      }
      return;
    }
    const delay = Math.min(input.pollIntervalMs, input.client.remaining());
    await input.sleep(delay);
  }
}

function findCitedObservation(
  memories: HindsightMemory[],
  sourceRevisionId: string,
): HindsightMemory {
  const observation = memories.find(
    (memory) =>
      memory.id.startsWith("hindsight:observation:") &&
      memory.sourceRevisionIds.includes(sourceRevisionId) &&
      memory.citations.some(
        (citation) => citation.sourceRevisionId === sourceRevisionId,
      ),
  );
  if (!observation) {
    throw new Error(
      "Hindsight recall did not return a fully hydrated cited observation",
    );
  }
  if (
    observation.citations.length === 0 ||
    !observation.sourceRevisionIds.every((sourceId) =>
      observation.citations.some(
        (citation) => citation.sourceRevisionId === sourceId,
      ),
    )
  ) {
    throw new Error("Hindsight observation returned incomplete source lineage");
  }
  return observation;
}

function verifySourceAbsent(
  memories: HindsightMemory[],
  sourceRevisionId: string,
): void {
  if (
    memories.some(
      (memory) =>
        memory.sourceRevisionIds.includes(sourceRevisionId) ||
        memory.citations.some(
          (citation) => citation.sourceRevisionId === sourceRevisionId,
        ),
    )
  ) {
    throw new Error("Invalidated source lineage remained in active recall");
  }
}

export async function runHindsightCanary(
  options: HindsightCanaryOptions,
): Promise<HindsightCanaryResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = required(options.apiKey, "VORTON_HINDSIGHT_API_KEY");
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "VORTON_HINDSIGHT_CANARY_TIMEOUT_MS",
    5_000,
    1_800_000,
  );
  const pollIntervalMs = boundedInteger(
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    "VORTON_HINDSIGHT_CANARY_POLL_INTERVAL_MS",
    100,
    30_000,
  );
  const now = options.now ?? Date.now;
  const startedAt = now();
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const runId = (options.uuid ?? randomUUID)();
  const installationId = (options.uuid ?? randomUUID)();
  const workspaceId = (options.uuid ?? randomUUID)();
  const marker = `VortonCanary${runId.replaceAll("-", "").slice(0, 12)}`;
  const bank = workspaceHindsightBank(
    installationId,
    workspaceId,
    "organizational",
  );
  const path = bankPath(bank);
  const scopeTags = [
    `vorton-installation:${installationId}`,
    `vorton-workspace:${workspaceId}`,
    "vorton-realm:organizational",
  ];
  const firstText =
    `Synthetic release canary ${marker}. Project ${marker} selected cobalt blue as its synthetic launch color. ` +
    `Project ${marker} scheduled its synthetic launch review for 09:17 UTC.`;
  const secondText = `Synthetic release canary ${marker}. Project ${marker} chose a circular emblem for the same synthetic launch.`;
  const firstSource = createSource({ runId, suffix: "a", text: firstText });
  const secondSource = createSource({ runId, suffix: "b", text: secondText });
  const client = new CanaryClient({
    baseUrl,
    apiKey,
    fetch: fetchImplementation,
    deadline: startedAt + timeoutMs,
    now,
  });
  const adapter = new HttpHindsightAdapter({
    baseUrl,
    apiKey,
    fetch: client.boundedFetch,
  });
  let primaryFailure: unknown;

  try {
    await adapter.ensureBank(bank);
    await verifyLlmHealth(client, path);
    await adapter.retain(bank, firstSource.memory);
    await adapter.retain(bank, secondSource.memory);

    const firstFacts = await listSourceFacts(
      client,
      path,
      firstSource.sourceTag,
      "valid",
    );
    const secondFacts = await listSourceFacts(
      client,
      path,
      secondSource.sourceTag,
      "valid",
    );
    if (firstFacts.length === 0 || secondFacts.length === 0) {
      throw new Error("Hindsight retain produced no cited source facts");
    }
    const firstFactIds = firstFacts.map((fact) =>
      validateLineage(fact, firstSource, scopeTags, bank, "valid"),
    );
    secondFacts.forEach((fact) =>
      validateLineage(fact, secondSource, scopeTags, bank, "valid"),
    );

    await pollConsolidation({ client, path, pollIntervalMs, sleep });
    const query = `${marker} cobalt blue synthetic launch review`;
    const recalled = await adapter.retrieve(bank, query);
    const observation = findCitedObservation(
      recalled,
      firstSource.citation.sourceRevisionId,
    );

    await adapter.invalidateSource(
      bank,
      firstSource.citation.sourceRevisionId,
      new Date(now()).toISOString(),
    );
    const remaining = await listSourceFacts(
      client,
      path,
      firstSource.sourceTag,
      "valid",
    );
    if (remaining.length !== 0) {
      throw new Error("Hindsight source invalidation left active facts behind");
    }
    const archived = await listSourceFacts(
      client,
      path,
      firstSource.sourceTag,
      "invalidated",
    );
    const archivedIds = new Set(
      archived.map((fact) =>
        validateLineage(fact, firstSource, scopeTags, bank, "invalidated"),
      ),
    );
    if (!firstFactIds.every((id) => archivedIds.has(id))) {
      throw new Error(
        "Hindsight invalidation did not archive every source fact",
      );
    }
    verifySourceAbsent(
      await adapter.retrieve(bank, query),
      firstSource.citation.sourceRevisionId,
    );

    return {
      status: "passed",
      bankDeleted: true,
      sourceFactCount: firstFacts.length + secondFacts.length,
      citedObservationId: observation.id,
      invalidatedFactCount: firstFactIds.length,
      durationMs: Math.max(0, now() - startedAt),
    };
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      await client.cleanupBank(path);
    } catch (cleanupFailure) {
      if (primaryFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure, cleanupFailure],
          "Hindsight canary failed and synthetic bank cleanup also failed",
        );
      }
      throw cleanupFailure;
    }
  }
}

export async function runHindsightCanaryCommand(): Promise<void> {
  const result = await runHindsightCanary({
    baseUrl: process.env.VORTON_HINDSIGHT_URL ?? "",
    apiKey: process.env.VORTON_HINDSIGHT_API_KEY ?? "",
    timeoutMs: parseOptionalInteger(
      process.env.VORTON_HINDSIGHT_CANARY_TIMEOUT_MS,
      "VORTON_HINDSIGHT_CANARY_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      5_000,
      1_800_000,
    ),
    pollIntervalMs: parseOptionalInteger(
      process.env.VORTON_HINDSIGHT_CANARY_POLL_INTERVAL_MS,
      "VORTON_HINDSIGHT_CANARY_POLL_INTERVAL_MS",
      DEFAULT_POLL_INTERVAL_MS,
      100,
      30_000,
    ),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1]?.endsWith(
  "deploy/fly/runtime/hindsight-canary.ts",
);
if (isMain) {
  runHindsightCanaryCommand().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`Hindsight release canary failed: ${message}\n`);
    process.exitCode = 1;
  });
}
