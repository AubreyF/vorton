import { describe, expect, it } from "vitest";
import { createFreedFactoryFixtureDataSource } from "./index.js";

describe("Freed Factory fixture", () => {
  it("preserves the active pilot as a read-only authority observation", async () => {
    const snapshot = await createFreedFactoryFixtureDataSource().getSnapshot();
    const ticket = snapshot.tickets[0]!;

    expect(snapshot.mode).toBe("read-only");
    expect(snapshot.repository).toBe("freed-project/freed");
    expect(ticket.ticket.number).toBe(1628);
    expect(ticket.claimedWorker).toBeNull();
    expect(ticket.lease).toMatchObject({
      state: "blocked",
      recovery: "awaiting-owner",
    });
    expect(ticket.pullRequest).toMatchObject({
      number: 1629,
      draft: true,
      branch: "fix/event-history-witness-repair",
      sourceHead: "031a27aa348dd621aa39e102afc9bc6f7904ab9b",
    });
    expect(ticket.receipt.authority.claim).toBe("repository-execution");
    expect(ticket.receipt.authority.ticket).toBe("github");
    expect(ticket.receipt.cursor.executionRevision).toContain(
      "authority_generation_conflict",
    );
  });
});
