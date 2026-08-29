import { describe, expect, it } from "vitest";

import { InMemoryHindsightAdapter } from "@aubos/memory";
import { ContextGateway } from "./index.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const firstId = "11111111-1111-4111-a111-111111111111";
const secondId = "22222222-2222-4222-a222-222222222222";
const revisionHash = "a".repeat(64);
const clock = { now: () => "2026-08-28T12:00:00.000Z" };

function source(
  id = firstId,
  boundary: "personal" | "organizational" | "mixed" = "personal",
) {
  return {
    id,
    installationId,
    installationRealm: "personal" as const,
    sourceType: "synthetic-transcript",
    sourceObjectId: "conversation-1",
    sourceUri: "synthetic://conversation-1",
    revisionHash,
    classification: "synthetic" as const,
    boundary,
    observedAt: clock.now(),
    text: id === firstId ? "Lunar apples" : "Lunar oranges",
    citations: [
      {
        sourceRevisionId: id,
        sourceUri: "synthetic://conversation-1",
        revisionHash,
        locator: "utterance:0",
      },
    ],
  };
}

describe("Context Gateway", () => {
  it("quarantines mixed and cross-realm material before Hindsight", async () => {
    const gateway = new ContextGateway(new InMemoryHindsightAdapter(), clock);
    await expect(
      gateway.admit(source(firstId, "mixed")),
    ).resolves.toMatchObject({
      admissionState: "quarantined",
    });
    await expect(
      gateway.retrieve({
        installationId,
        installationRealm: "personal",
        query: "Lunar",
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("returns only cited untrusted context and records a receipt", async () => {
    const gateway = new ContextGateway(new InMemoryHindsightAdapter(), clock);
    await gateway.admit(source());
    const result = await gateway.retrieve({
      installationId,
      installationRealm: "personal",
      query: "Lunar",
    });
    expect(result.context[0]).toMatchObject({
      text: "Lunar apples",
      trust: "untrusted",
      derived: true,
      citations: [{ sourceRevisionId: firstId }],
    });
    expect(result.receipt).toMatchObject({
      installationId,
      resultIds: [`source:${firstId}`],
      sourceRevisionIds: [firstId],
    });
  });

  it("propagates supersession and deletion through consolidation lineage", async () => {
    const gateway = new ContextGateway(new InMemoryHindsightAdapter(), clock);
    await gateway.admit(source());
    await gateway.consolidate({
      installationId,
      installationRealm: "personal",
      derivedMemoryId: "reflection-1",
      text: "Synthetic fruit reflection",
      sourceRevisionIds: [firstId],
    });
    const revised = await gateway.admit({
      ...source(secondId),
      revisionHash: "b".repeat(64),
    });
    expect(revised.supersedesRevisionId).toBe(firstId);
    expect(
      gateway.getLineage(installationId, "reflection-1")?.invalidatedAt,
    ).toBe(clock.now());
    await gateway.deleteSource({
      installationId,
      installationRealm: "personal",
      sourceRevisionId: secondId,
    });
    await expect(
      gateway.retrieve({
        installationId,
        installationRealm: "personal",
        query: "Lunar",
      }),
    ).resolves.toMatchObject({ context: [] });
  });

  it("rejects attempts to reuse one installation across realms", async () => {
    const gateway = new ContextGateway(new InMemoryHindsightAdapter(), clock);
    await gateway.admit(source());
    await expect(
      gateway.retrieve({
        installationId,
        installationRealm: "organizational",
        query: "Lunar",
      }),
    ).rejects.toThrow("cannot cross");
  });
});
