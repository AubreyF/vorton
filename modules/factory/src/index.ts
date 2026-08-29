import {
  reconcileRepositoryTicket,
  type FactoryTicketSnapshot,
  type RepositoryExecutionObservation,
} from "@aubos/repository-connector";
import {
  createGitHubReadOnlyConnector,
  type GitHubCheckFixture,
} from "@aubos/repository-connector-github";

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

const observedAt = "2026-08-29T00:33:00.000Z";
const sourceHead = "031a27aa348dd621aa39e102afc9bc6f7904ab9b";

const passedChecks = [
  "Analyze (actions)",
  "Tooling smoke plan",
  "Analyze (javascript-typescript)",
  "Analyze (python)",
  "Analyze (rust)",
  "Feature validation",
  "Tooling smoke shard (general 1/1)",
  "Tooling smoke shard (automation-control 1/4)",
  "Tooling smoke shard (automation-control 2/4)",
  "Tooling smoke shard (automation-control 4/4)",
  "Tooling smoke shard (kernel-guard-cutover 1/2)",
  "Tooling smoke shard (kernel-guard-cutover 2/2)",
  "Tooling smoke shard (nightly-self-improve 1/2)",
  "Tooling smoke shard (outcome-ledger-repair 1/7)",
  "Tooling smoke shard (outcome-ledger-repair 3/7)",
  "Tooling smoke shard (outcome-ledger-repair 6/7)",
  "Native actor acceptance (macOS)",
  "CodeQL",
  "Vercel Preview Comments",
  "Vercel – freed-pwa",
] as const;

const pendingChecks = [
  "Tooling smoke shard (automation-control 3/4)",
  "Tooling smoke shard (nightly-self-improve 2/2)",
  "Tooling smoke shard (outcome-ledger-repair 2/7)",
  "Tooling smoke shard (outcome-ledger-repair 4/7)",
  "Tooling smoke shard (outcome-ledger-repair 5/7)",
  "Tooling smoke shard (outcome-ledger-repair 7/7)",
] as const;

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
    name: "Main PR guard",
    status: "COMPLETED",
    conclusion: "SKIPPED",
  },
  {
    name: "Dev integration",
    status: "COMPLETED",
    conclusion: "SKIPPED",
  },
];

const fixture = {
  repository: "freed-project/freed",
  issues: [
    {
      number: 1628,
      title: "Add supported repair for stranded event-history witnesses",
      url: "https://github.com/freed-project/freed/issues/1628",
      state: "OPEN" as const,
      updatedAt: "2026-08-28T20:56:36Z",
    },
  ],
  pullRequests: [
    {
      number: 1629,
      title: "fix: add event history witness repair",
      url: "https://github.com/freed-project/freed/pull/1629",
      state: "OPEN" as const,
      isDraft: true,
      headRefName: "fix/event-history-witness-repair",
      headRefOid: sourceHead,
      statusCheckRollup: checks,
    },
  ],
};

const execution: RepositoryExecutionObservation = {
  ticketNumber: 1628,
  installationWorkId: "WORK-FREED-1628",
  revision:
    "freed-control@2da04afda6b7a893f55c70c835d0a1230638ed04:authority_generation_conflict",
  claimReadState: "unavailable",
  claims: [],
  lease: {
    state: "blocked",
    recovery: "awaiting-owner",
    detail: "Canonical task and lease reads fail closed before reconciliation.",
  },
  pullRequestNumber: 1629,
  blockers: [
    "authority_generation_conflict",
    "Owner confirmation required before canonical witness retirement",
  ],
};

export function createFreedFactoryFixtureDataSource(): FactoryDataSource {
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
        installation: "FreedOS Linux pilot",
        provider: connector.provider,
        repository: connector.repository,
        mode: connector.mode,
        observedAt,
        tickets: reconciled,
      };
    },
  };
}
