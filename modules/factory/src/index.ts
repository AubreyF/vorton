import {
  reconcileRepositoryTicket,
  type FactoryTicketSnapshot,
  type RepositoryExecutionObservation,
} from "@vorton/repository-connector";
import {
  createGitHubReadOnlyConnector,
  type GitHubCheckFixture,
} from "@vorton/repository-connector-github";

export type FactorySnapshot = {
  installation: string;
  provider: string;
  repository: string;
  mode: "read-only";
  observedAt: string;
  tickets: readonly FactoryTicketSnapshot[];
};

export interface FactoryDataSource {
  getSnapshot(): Promise<FactorySnapshot>;
}

export const factoryModuleManifest = {
  product: "Vorton Factory",
  connector: "FreedOS Factory",
  connectorPackage: "@vorton/factory-connector-freed",
  sourceRepository: "AubreyF/aubtown",
  sourceCommit: "014b786c8bf6b51a3ed265b4e36773afff0f5d59",
  mode: "read-only",
  authority: {
    backlog: "GitHub Issues",
    execution: "Freed task claims",
    organization: "Vorton Postgres",
    publication: "Draft pull requests only",
  },
  capabilities: [
    "Admission and conflict policy",
    "Host routing and quota governance",
    "Claim-bound custody and checkpoints",
    "Validation and independent review",
    "Draft publication transactions",
    "Signed receipts and reconciliation",
  ],
} as const;

const observedAt = "2026-08-29T00:33:00.000Z";
const sourceHead = "e8f63827e20c5f0625fe8ef505f3b95c8f310623";

const passedChecks = ["Static analysis", "Unit tests"] as const;

const pendingChecks = ["Integration validation"] as const;

const checks: GitHubCheckFixture[] = [
  ...passedChecks.map((name) => ({
    name,
    status: "COMPLETED" as const,
    conclusion: "SUCCESS" as const,
  })),
  ...pendingChecks.map((name) => ({
    name,
    status: "IN_PROGRESS" as const,
    conclusion: "" as const,
  })),
  {
    name: "Publication guard",
    status: "COMPLETED",
    conclusion: "SKIPPED",
  },
];

const fixture = {
  repository: "moonbase-lab/launch-control",
  issues: [
    {
      number: 42,
      title: "Repair the offline telemetry replay fixture",
      url: "https://example.invalid/moonbase-lab/launch-control/issues/42",
      state: "OPEN" as const,
      updatedAt: "2026-08-28T20:56:36Z",
    },
  ],
  pullRequests: [
    {
      number: 43,
      title: "fix: repair offline telemetry replay",
      url: "https://example.invalid/moonbase-lab/launch-control/pull/43",
      state: "OPEN" as const,
      isDraft: true,
      headRefName: "fix/offline-telemetry-replay",
      headRefOid: sourceHead,
      statusCheckRollup: checks,
    },
  ],
};

const execution: RepositoryExecutionObservation = {
  ticketNumber: 42,
  installationWorkId: "WORK-MOONBASE-42",
  revision: "synthetic-execution@revision-7:authority_generation_conflict",
  claimReadState: "unavailable",
  claims: [],
  lease: {
    state: "blocked",
    recovery: "awaiting-owner",
    detail:
      "Canonical claim and lease reads fail closed before reconciliation.",
  },
  pullRequestNumber: 43,
  blockers: [
    "authority_generation_conflict",
    "Synthetic owner confirmation required before fixture recovery",
  ],
};

export function createSyntheticFactoryFixtureDataSource(): FactoryDataSource {
  const connector = createGitHubReadOnlyConnector(fixture);
  return {
    async getSnapshot() {
      const tickets = await connector.listOpenTickets();
      const reconciled = await Promise.all(
        tickets.map((ticket) =>
          reconcileRepositoryTicket({
            connector,
            ticket,
            execution,
            observedAt,
          }),
        ),
      );
      return {
        installation: "Moonbase Lab fixture",
        provider: connector.provider,
        repository: connector.repository,
        mode: connector.mode,
        observedAt,
        tickets: reconciled,
      };
    },
  };
}
