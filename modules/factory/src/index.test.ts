import { describe, expect, it } from "vitest";
import { createSyntheticFactoryFixtureDataSource } from "./index.js";

describe("synthetic Factory fixture", () => {
  it("preserves external execution authority through read-only observation", async () => {
    const snapshot =
      await createSyntheticFactoryFixtureDataSource().getSnapshot();
    const ticket = snapshot.tickets[0]!;

    expect(snapshot.mode).toBe("read-only");
    expect(snapshot.repository).toBe("moonbase-lab/launch-control");
    expect(ticket.ticket.number).toBe(42);
    expect(ticket.claimedWorker).toBeNull();
    expect(ticket.lease).toMatchObject({
      state: "blocked",
      recovery: "awaiting-owner",
    });
    expect(ticket.pullRequest).toMatchObject({
      number: 43,
      draft: true,
      branch: "fix/offline-telemetry-replay",
      sourceHead: "e8f63827e20c5f0625fe8ef505f3b95c8f310623",
    });
    expect(ticket.receipt.authority.claim).toBe("repository-execution");
    expect(ticket.receipt.authority.ticket).toBe("github");
    expect(ticket.receipt.cursor.executionRevision).toContain(
      "authority_generation_conflict",
    );
    expect(ticket.ticket.url).toContain("example.invalid");
  });
});
