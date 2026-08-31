import type {
  ReadOnlyRepositoryConnector,
  RepositoryCheck,
  RepositoryPullRequest,
  RepositoryTicket,
} from "@vorton/repository-connector";

export type GitHubIssueFixture = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  updatedAt: string;
};

export type GitHubCheckFixture = {
  name: string;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED";
  conclusion: "SUCCESS" | "FAILURE" | "CANCELLED" | "SKIPPED" | "";
};

export type GitHubPullRequestFixture = {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  statusCheckRollup: readonly GitHubCheckFixture[];
};

export type GitHubReadFixture = {
  githubAppInstallationId?: string | null;
  repository: string;
  issues: readonly GitHubIssueFixture[];
  pullRequests: readonly GitHubPullRequestFixture[];
};

function mapCheck(check: GitHubCheckFixture): RepositoryCheck {
  const state =
    check.status !== "COMPLETED"
      ? "pending"
      : check.conclusion === "SUCCESS"
        ? "passed"
        : check.conclusion === "SKIPPED"
          ? "skipped"
          : "failed";
  return { name: check.name, state };
}

/**
 * Maps provider payloads behind the provider-neutral connector contract. The
 * adapter intentionally exposes no mutation methods. Live transport and auth
 * remain outside the Wave 2 read-only boundary.
 */
export function createGitHubReadOnlyConnector(
  fixture: GitHubReadFixture,
): ReadOnlyRepositoryConnector {
  return {
    provider: "github",
    repository: fixture.repository,
    githubAppInstallationId: fixture.githubAppInstallationId ?? null,
    mode: "read-only",
    async listOpenTickets(): Promise<readonly RepositoryTicket[]> {
      return fixture.issues
        .filter((issue) => issue.state === "OPEN")
        .map((issue) => ({
          id: `github:${fixture.repository}#${issue.number}`,
          number: issue.number,
          title: issue.title,
          url: issue.url,
          state: "open",
          revision: `issue-${issue.number}@${issue.updatedAt}`,
        }));
    },
    async getPullRequest(
      number: number,
    ): Promise<RepositoryPullRequest | null> {
      const pullRequest = fixture.pullRequests.find(
        (candidate) => candidate.number === number,
      );
      if (!pullRequest) return null;
      return {
        id: `github:${fixture.repository}/pull/${pullRequest.number}`,
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        state:
          pullRequest.state.toLowerCase() as RepositoryPullRequest["state"],
        draft: pullRequest.isDraft,
        branch: pullRequest.headRefName,
        sourceHead: pullRequest.headRefOid,
        checks: pullRequest.statusCheckRollup.map(mapCheck),
      };
    },
  };
}
