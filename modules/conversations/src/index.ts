import { createHash } from "node:crypto";

import type {
  AdmissionState,
  DataClassification,
  InstallationRealm,
  SourceBoundary,
  TranscriptProvider,
  TranscriptRevision,
  TranscriptUtterance,
} from "@aubos/contracts";

export type ProviderTranscript = {
  objectId: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
  participants: string[];
  utterances: TranscriptUtterance[];
  providerObservedAt: string;
  completeness: "complete" | "partial" | "unavailable";
  classification: DataClassification;
  boundary: SourceBoundary;
  deleted: boolean;
};

export type TranscriptPollRequest = {
  updatedAfter: string;
  observedBefore: string;
  cursor: string | null;
  limit: number;
};

export type TranscriptPollPage = {
  items: ProviderTranscript[];
  nextCursor: string | null;
};

/** Read-only transport. Implementations receive no mutation or media methods. */
export interface TranscriptPollingTransport {
  readonly provider: TranscriptProvider;
  listTranscripts(request: TranscriptPollRequest): Promise<TranscriptPollPage>;
}

export interface TranscriptRevisionSink {
  latest(
    installationId: string,
    provider: TranscriptProvider,
    objectId: string,
  ): Promise<TranscriptRevision | null>;
  append(revision: TranscriptRevision): Promise<"created" | "existing">;
}

export type PollingConfig = {
  overlapMs: number;
  rateLimit: {
    requestsPerMinute: number;
    pageSize: number;
    maxPagesPerPoll: number;
  };
  backoff: { baseMs: number; maxMs: number };
  adapterVersion: string;
};

export type PollingState = {
  watermark: string;
  cursor: string | null;
  windowEnd: string | null;
  consecutiveFailures: number;
  nextPollAt: string | null;
};

export type PollResult = {
  created: number;
  existing: number;
  deleted: number;
  pages: number;
  state: PollingState;
};

export class ScheduledTranscriptPoller {
  readonly #installation: { id: string; realm: InstallationRealm };
  readonly #connectionId: string;
  readonly #transport: TranscriptPollingTransport;
  readonly #sink: TranscriptRevisionSink;
  readonly #config: PollingConfig;
  #state: PollingState;

  constructor(
    installation: { id: string; realm: InstallationRealm },
    connectionId: string,
    transport: TranscriptPollingTransport,
    sink: TranscriptRevisionSink,
    config: PollingConfig,
    initialWatermark: string,
  ) {
    this.#installation = installation;
    this.#connectionId = connectionId;
    this.#transport = transport;
    this.#sink = sink;
    this.#config = config;
    validateConfig(this.#config);
    this.#state = {
      watermark: initialWatermark,
      cursor: null,
      windowEnd: null,
      consecutiveFailures: 0,
      nextPollAt: null,
    };
  }

  get state(): PollingState {
    return structuredClone(this.#state);
  }

  async poll(observedAt: string): Promise<PollResult> {
    if (this.#state.nextPollAt && observedAt < this.#state.nextPollAt) {
      throw new Error(`Poll is backed off until ${this.#state.nextPollAt}`);
    }
    const updatedAfter = new Date(
      Date.parse(this.#state.watermark) - this.#config.overlapMs,
    ).toISOString();
    const windowEnd = this.#state.windowEnd ?? observedAt;
    let cursor: string | null = this.#state.cursor;
    let pages = 0;
    let created = 0;
    let existing = 0;
    let deleted = 0;
    try {
      do {
        if (
          pages >=
          Math.min(
            this.#config.rateLimit.maxPagesPerPoll,
            this.#config.rateLimit.requestsPerMinute,
          )
        )
          break;
        const page = await this.#transport.listTranscripts({
          updatedAfter,
          observedBefore: windowEnd,
          cursor,
          limit: this.#config.rateLimit.pageSize,
        });
        pages += 1;
        cursor = page.nextCursor;
        this.#state = { ...this.#state, cursor, windowEnd };
        for (const item of page.items) {
          const result = await this.#ingest(item, observedAt);
          if (result === "created") created += 1;
          else existing += 1;
          if (item.deleted && result === "created") deleted += 1;
        }
      } while (cursor !== null);
      const completed = cursor === null;
      this.#state = completed
        ? {
            watermark: windowEnd,
            cursor: null,
            windowEnd: null,
            consecutiveFailures: 0,
            nextPollAt: null,
          }
        : {
            ...this.#state,
            consecutiveFailures: 0,
            nextPollAt: new Date(
              Date.parse(observedAt) +
                Math.ceil(60_000 / this.#config.rateLimit.requestsPerMinute),
            ).toISOString(),
          };
      return { created, existing, deleted, pages, state: this.state };
    } catch (error) {
      const failures = this.#state.consecutiveFailures + 1;
      const delay = Math.min(
        this.#config.backoff.maxMs,
        this.#config.backoff.baseMs * 2 ** (failures - 1),
      );
      this.#state = {
        ...this.#state,
        cursor,
        windowEnd,
        consecutiveFailures: failures,
        nextPollAt: new Date(Date.parse(observedAt) + delay).toISOString(),
      };
      throw error;
    }
  }

  async #ingest(
    item: ProviderTranscript,
    ingestedAt: string,
  ): Promise<"created" | "existing"> {
    const revisionHash = sha256(stableJson(providerRevisionContent(item)));
    const prior = await this.#sink.latest(
      this.#installation.id,
      this.#transport.provider,
      item.objectId,
    );
    if (prior?.revisionHash === revisionHash) return "existing";
    const id = deterministicUuid(
      `${this.#installation.id}:${this.#transport.provider}:${item.objectId}:${revisionHash}`,
    );
    const sourceUri = `${this.#transport.provider}://${item.objectId}?revision=${revisionHash}`;
    const boundaryMatches =
      item.boundary !== "mixed" &&
      item.boundary ===
        (this.#installation.realm === "personal"
          ? "personal"
          : "organizational");
    const admissionState: AdmissionState = boundaryMatches
      ? "pending"
      : "quarantined";
    return this.#sink.append({
      id,
      installationId: this.#installation.id,
      installationRealm: this.#installation.realm,
      connectionId: this.#connectionId,
      provider: this.#transport.provider,
      providerObjectId: item.objectId,
      revisionHash,
      title: item.title,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      participants: [...item.participants],
      utterances: structuredClone(item.utterances),
      rawSourcePointer: null,
      providerObservedAt: item.providerObservedAt,
      ingestedAt,
      adapterVersion: this.#config.adapterVersion,
      classification: item.classification,
      completeness: item.completeness,
      boundary: item.boundary,
      admissionState,
      deletedAt: item.deleted ? ingestedAt : null,
      supersedesRevisionId: prior?.id ?? null,
      citations: [
        {
          sourceRevisionId: id,
          sourceUri,
          revisionHash,
          locator: "transcript",
        },
      ],
    });
  }
}

export class InMemoryTranscriptRevisionSink implements TranscriptRevisionSink {
  readonly #revisions: TranscriptRevision[] = [];

  async latest(
    installationId: string,
    provider: TranscriptProvider,
    objectId: string,
  ): Promise<TranscriptRevision | null> {
    return (
      [...this.#revisions]
        .reverse()
        .find(
          (revision) =>
            revision.installationId === installationId &&
            revision.provider === provider &&
            revision.providerObjectId === objectId,
        ) ?? null
    );
  }

  async append(revision: TranscriptRevision): Promise<"created" | "existing"> {
    if (this.#revisions.some((candidate) => candidate.id === revision.id)) {
      return "existing";
    }
    this.#revisions.push(structuredClone(revision));
    return "created";
  }

  all(): TranscriptRevision[] {
    return structuredClone(this.#revisions);
  }
}

/** Deterministic synthetic transport for adapter and scheduler tests. */
export class FakeTranscriptPollingTransport implements TranscriptPollingTransport {
  #failure: Error | null = null;
  readonly requests: TranscriptPollRequest[] = [];

  constructor(
    readonly provider: TranscriptProvider,
    readonly items: ProviderTranscript[],
  ) {}

  failOnce(error = new Error("synthetic rate limit")): void {
    this.#failure = error;
  }

  async listTranscripts(
    request: TranscriptPollRequest,
  ): Promise<TranscriptPollPage> {
    this.requests.push(structuredClone(request));
    if (this.#failure) {
      const error = this.#failure;
      this.#failure = null;
      throw error;
    }
    const offset = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
    const eligible = this.items
      .filter(
        (item) =>
          item.providerObservedAt >= request.updatedAfter &&
          item.providerObservedAt <= request.observedBefore,
      )
      .sort(
        (left, right) =>
          left.providerObservedAt.localeCompare(right.providerObservedAt) ||
          left.objectId.localeCompare(right.objectId),
      );
    const page = eligible.slice(offset, offset + request.limit);
    const next = offset + page.length;
    return {
      items: structuredClone(page),
      nextCursor: next < eligible.length ? String(next) : null,
    };
  }
}

export type PollingAdapterInput = {
  installation: { id: string; realm: InstallationRealm };
  connectionId: string;
  transport: TranscriptPollingTransport;
  sink: TranscriptRevisionSink;
  config: PollingConfig;
  initialWatermark: string;
};

export function createGoogleMeetPollingAdapter(
  input: PollingAdapterInput,
): ScheduledTranscriptPoller {
  if (input.transport.provider !== "google-meet") {
    throw new Error("Google Meet adapter requires a google-meet transport");
  }
  return new ScheduledTranscriptPoller(
    input.installation,
    input.connectionId,
    input.transport,
    input.sink,
    input.config,
    input.initialWatermark,
  );
}

export function createOmiPollingAdapter(
  input: PollingAdapterInput,
): ScheduledTranscriptPoller {
  if (input.transport.provider !== "omi") {
    throw new Error("Omi adapter requires an omi transport");
  }
  return new ScheduledTranscriptPoller(
    input.installation,
    input.connectionId,
    input.transport,
    input.sink,
    input.config,
    input.initialWatermark,
  );
}

function validateConfig(config: PollingConfig): void {
  if (config.overlapMs < 0)
    throw new Error("Polling overlap must not be negative");
  for (const value of [
    config.rateLimit.requestsPerMinute,
    config.rateLimit.pageSize,
    config.rateLimit.maxPagesPerPoll,
    config.backoff.baseMs,
    config.backoff.maxMs,
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        "Rate limits and backoff values must be positive integers",
      );
    }
  }
  if (config.backoff.baseMs > config.backoff.maxMs) {
    throw new Error("Backoff base must not exceed its maximum");
  }
}

function providerRevisionContent(item: ProviderTranscript): unknown {
  return {
    objectId: item.objectId,
    title: item.title,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    participants: item.participants,
    utterances: item.utterances,
    completeness: item.completeness,
    boundary: item.boundary,
    deleted: item.deleted,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(value: string): string {
  const hash = sha256(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
