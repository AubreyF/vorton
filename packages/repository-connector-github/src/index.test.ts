import { describe, expect, it } from "vitest";
import { createGitHubReadOnlyConnector } from "./index.js";

describe("GitHub read-only connector", () => {
  it("normalizes open issues, exact heads, drafts, and check states", async () => {
    const connector = createGitHubReadOnlyConnector({
      repository: "example/repository",
      issues: [
        {
          number: 1,
          title: "Open",
          url: "https://github.com/example/repository/issues/1",
          state: "OPEN",
          updatedAt: "2026-08-28T20:56:36Z",
        },
        {
          number: 2,
          title: "Closed",
          url: "https://github.com/example/repository/issues/2",
          state: "CLOSED",
          updatedAt: "2026-08-28T20:56:36Z",
        },
      ],
      pullRequests: [
        {
          number: 3,
          title: "Draft repair",
          url: "https://github.com/example/repository/pull/3",
          state: "OPEN",
          isDraft: true,
          headRefName: "fix/repair",
          headRefOid: "a".repeat(40),
          statusCheckRollup: [
            { name: "Unit", status: "COMPLETED", conclusion: "SUCCESS" },
            { name: "Integration", status: "IN_PROGRESS", conclusion: "" },
          ],
        },
      ],
    });

    expect(connector.mode).toBe("read-only");
    expect(await connector.listOpenTickets()).toHaveLength(1);
    expect(await connector.getPullRequest(3)).toMatchObject({
      draft: true,
      branch: "fix/repair",
      sourceHead: "a".repeat(40),
      checks: [
        { name: "Unit", state: "passed" },
        { name: "Integration", state: "pending" },
      ],
    });
  });
});
