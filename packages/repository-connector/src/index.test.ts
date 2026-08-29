import { describe, expect, it } from "vitest";
import {
  reconcileRepositoryTicket,
  type ReadOnlyRepositoryConnector,
} from "./index.js";

const connector: ReadOnlyRepositoryConnector = {
  provider: "fixture",
  repository: "example/repository",
  mode: "read-only",
  async listOpenTickets() {
    return [];
  },
  async getPullRequest() {
    return null;
  },
};

const ticket = {
  id: "fixture:example/repository#9",
  number: 9,
  title: "Prove claim conflict behavior",
  url: "https://example.invalid/issues/9",
  state: "open" as const,
  revision: "ticket-9-revision-1",
};

describe("repository reconciliation", () => {
  it("fails closed when more than one active claim exists", async () => {
    const result = await reconcileRepositoryTicket({
      connector,
      ticket,
      observedAt: "2026-08-29T00:33:00.000Z",
      execution: {
        ticketNumber: 9,
        installationWorkId: "WORK-9",
        revision: "execution-9-revision-1",
        claimReadState: "available",
        claims: [
          { id: "claim-a", worker: "worker-a", state: "active" },
          { id: "claim-b", worker: "worker-b", state: "active" },
        ],
        lease: { state: "blocked", recovery: "blocked", detail: "Conflict" },
        pullRequestNumber: null,
        blockers: [],
      },
    });

    expect(result.authorityState).toBe("conflict");
    expect(result.claimedWorker).toBeNull();
    expect(result.blockers).toContain("conflicting_claim_authority");
    expect(result.receipt.outcome).toBe("authority-conflict");
  });

  it("does not pick the newest claim or collapse distinct witnesses", async () => {
    const result = await reconcileRepositoryTicket({
      connector,
      ticket,
      observedAt: "2026-08-29T00:33:00.000Z",
      execution: {
        ticketNumber: 9,
        installationWorkId: "WORK-9",
        revision: "execution-9-revision-2",
        claimReadState: "available",
        claims: [
          { id: "old-claim", worker: "older-worker", state: "active" },
          { id: "new-claim", worker: "newer-worker", state: "active" },
        ],
        lease: { state: "blocked", recovery: "blocked", detail: "Conflict" },
        pullRequestNumber: null,
        blockers: [],
      },
    });

    expect(result.claimWitnesses.map((claim) => claim.worker)).toEqual([
      "older-worker",
      "newer-worker",
    ]);
    expect(result.claimedWorker).toBeNull();
  });
});
