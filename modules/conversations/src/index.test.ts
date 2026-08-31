import { describe, expect, it } from "vitest";

import {
  FakeTranscriptPollingTransport,
  InMemoryTranscriptRevisionSink,
  createGoogleMeetPollingAdapter,
  createOmiPollingAdapter,
  type PollingAdapterInput,
  type ProviderTranscript,
} from "./index.js";

const installation = {
  id: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  realm: "organizational" as const,
};
const connectionId = "0dd9b2cc-b44c-4039-a1fc-5226b5d9bb06";
const config = {
  overlapMs: 5 * 60_000,
  rateLimit: { requestsPerMinute: 30, pageSize: 1, maxPagesPerPoll: 10 },
  backoff: { baseMs: 1_000, maxMs: 8_000 },
  adapterVersion: "synthetic-v1",
};

function transcript(
  overrides: Partial<ProviderTranscript> = {},
): ProviderTranscript {
  return {
    objectId: "meeting-1",
    title: "Synthetic mission review",
    startedAt: "2026-08-28T11:00:00.000Z",
    endedAt: "2026-08-28T11:30:00.000Z",
    participants: ["Synthetic Ada", "Synthetic Ravi"],
    utterances: [
      {
        ordinal: 0,
        speaker: "Synthetic Ada",
        text: "Review the fictional telemetry.",
        startedAt: "2026-08-28T11:01:00.000Z",
        endedAt: "2026-08-28T11:01:05.000Z",
      },
    ],
    providerObservedAt: "2026-08-28T11:59:00.000Z",
    completeness: "complete",
    classification: "synthetic",
    boundary: "organizational",
    deleted: false,
    ...overrides,
  };
}

function adapterInput(
  transport: FakeTranscriptPollingTransport,
  sink = new InMemoryTranscriptRevisionSink(),
): PollingAdapterInput {
  return {
    installation,
    connectionId,
    transport,
    sink,
    config,
    initialWatermark: "2026-08-28T11:00:00.000Z",
  };
}

describe.each(["google-meet", "omi"] as const)(
  "%s polling adapter",
  (provider) => {
    it("uses overlap windows and stable hashes for idempotency", async () => {
      const transport = new FakeTranscriptPollingTransport(provider, [
        transcript(),
      ]);
      const sink = new InMemoryTranscriptRevisionSink();
      const input = adapterInput(transport, sink);
      const poller =
        provider === "google-meet"
          ? createGoogleMeetPollingAdapter(input)
          : createOmiPollingAdapter(input);
      await expect(
        poller.poll("2026-08-28T12:00:00.000Z"),
      ).resolves.toMatchObject({
        created: 1,
        pages: 1,
      });
      await expect(
        poller.poll("2026-08-28T12:05:00.000Z"),
      ).resolves.toMatchObject({
        created: 0,
        existing: 1,
      });
      expect(transport.requests[1]?.updatedAfter).toBe(
        "2026-08-28T11:55:00.000Z",
      );
      expect(sink.all()).toHaveLength(1);
    });

    it("creates revisions for changes and provider deletions", async () => {
      const item = transcript();
      const transport = new FakeTranscriptPollingTransport(provider, [item]);
      const sink = new InMemoryTranscriptRevisionSink();
      const input = adapterInput(transport, sink);
      const poller =
        provider === "google-meet"
          ? createGoogleMeetPollingAdapter(input)
          : createOmiPollingAdapter(input);
      await poller.poll("2026-08-28T12:00:00.000Z");
      item.deleted = true;
      item.completeness = "unavailable";
      item.providerObservedAt = "2026-08-28T12:01:00.000Z";
      const result = await poller.poll("2026-08-28T12:05:00.000Z");
      expect(result).toMatchObject({ created: 1, deleted: 1 });
      expect(sink.all()[1]).toMatchObject({
        deletedAt: "2026-08-28T12:05:00.000Z",
        supersedesRevisionId: sink.all()[0]?.id,
        completeness: "unavailable",
      });
    });

    it("quarantines mixed material and applies deterministic backoff", async () => {
      const transport = new FakeTranscriptPollingTransport(provider, [
        transcript({ boundary: "mixed" }),
      ]);
      const sink = new InMemoryTranscriptRevisionSink();
      const input = adapterInput(transport, sink);
      const poller =
        provider === "google-meet"
          ? createGoogleMeetPollingAdapter(input)
          : createOmiPollingAdapter(input);
      transport.failOnce();
      await expect(poller.poll("2026-08-28T12:00:00.000Z")).rejects.toThrow(
        "synthetic rate limit",
      );
      expect(poller.state.nextPollAt).toBe("2026-08-28T12:00:01.000Z");
      await expect(poller.poll("2026-08-28T12:00:00.500Z")).rejects.toThrow(
        "backed off",
      );
      await poller.poll("2026-08-28T12:00:01.000Z");
      expect(sink.all()[0]?.admissionState).toBe("quarantined");
    });
  },
);

describe("provider guardrails", () => {
  it("does not let a provider transport enter the wrong adapter", () => {
    const omi = new FakeTranscriptPollingTransport("omi", []);
    expect(() => createGoogleMeetPollingAdapter(adapterInput(omi))).toThrow(
      "google-meet transport",
    );
  });

  it("resumes a rate-limited page window without skipping older items", async () => {
    const first = transcript({ objectId: "meeting-1" });
    const second = transcript({
      objectId: "meeting-2",
      providerObservedAt: "2026-08-28T11:59:30.000Z",
    });
    const transport = new FakeTranscriptPollingTransport("google-meet", [
      first,
      second,
    ]);
    const sink = new InMemoryTranscriptRevisionSink();
    const input = adapterInput(transport, sink);
    input.config = {
      ...config,
      rateLimit: { requestsPerMinute: 60, pageSize: 1, maxPagesPerPoll: 1 },
    };
    const poller = createGoogleMeetPollingAdapter(input);
    await expect(
      poller.poll("2026-08-28T12:00:00.000Z"),
    ).resolves.toMatchObject({
      created: 1,
      state: { watermark: "2026-08-28T11:00:00.000Z", cursor: "1" },
    });
    await poller.poll("2026-08-28T12:00:01.000Z");
    expect(sink.all().map((revision) => revision.providerObjectId)).toEqual([
      "meeting-1",
      "meeting-2",
    ]);
    expect(poller.state).toMatchObject({
      watermark: "2026-08-28T12:00:00.000Z",
      cursor: null,
      windowEnd: null,
    });
  });
});
