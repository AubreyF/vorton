import type { FactorySnapshot } from "@aubos/factory";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactoryPage } from "./FactoryPage.js";

describe("Factory control-plane view", () => {
  it("shows a fail-closed conflicting claim without selecting a worker", () => {
    const snapshot: FactorySnapshot = {
      installation: "Fixture pilot",
      provider: "fixture",
      repository: "example/repository",
      mode: "read-only",
      observedAt: "2026-08-29T00:33:00.000Z",
      tickets: [
        {
          ticket: {
            id: "fixture:example/repository#9",
            number: 9,
            title: "Conflicting claim fixture",
            url: "https://example.invalid/issues/9",
            state: "open",
            revision: "ticket-9-revision-1",
          },
          installationWorkId: "WORK-9",
          authorityState: "conflict",
          claimedWorker: null,
          claimWitnesses: [
            { id: "claim-a", worker: "worker-a", state: "active" },
            { id: "claim-b", worker: "worker-b", state: "active" },
          ],
          lease: { state: "blocked", recovery: "blocked", detail: "Conflict" },
          pullRequest: null,
          blockers: ["conflicting_claim_authority"],
          receipt: {
            schemaVersion: 1,
            installationWorkId: "WORK-9",
            repositoryTicketId: "fixture:example/repository#9",
            outcome: "authority-conflict",
            sourceHead: null,
            cursor: {
              provider: "fixture",
              repository: "example/repository",
              observedAt: "2026-08-29T00:33:00.000Z",
              ticketRevision: "ticket-9-revision-1",
              executionRevision: "execution-9-revision-1",
            },
            authority: {
              ticket: "github",
              claim: "repository-execution",
              lease: "repository-execution",
              branch: "repository-execution",
              pullRequest: "repository-execution",
              checks: "github",
              publication: "repository-execution",
              recovery: "repository-execution",
            },
            blockers: ["conflicting_claim_authority"],
          },
        },
      ],
    };

    const html = renderToStaticMarkup(<FactoryPage snapshot={snapshot} />);
    expect(html).toContain("Conflicting claims. Authority is closed.");
    expect(html).toContain("No worker was selected");
    expect(html).toContain("2 active witnesses");
    expect(html).not.toContain("worker-a</strong>");
  });
});
