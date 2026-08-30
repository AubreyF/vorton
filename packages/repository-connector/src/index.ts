import {
  factoryReconciliationReceiptSchema,
  type FactoryReconciliationReceipt,
} from "@vorton/contracts";
import type {
  FactoryAuthorityMap,
  FactoryReconciliationCursor,
} from "@vorton/contracts";

export type RepositoryCheck = {
  name: string;
  state: "pending" | "passed" | "failed" | "skipped";
};

export type RepositoryPullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  branch: string;
  sourceHead: string;
  checks: RepositoryCheck[];
};

export type RepositoryTicket = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  revision: string;
};

export interface ReadOnlyRepositoryConnector {
  readonly provider: string;
  readonly repository: string;
  readonly mode: "read-only";
  listOpenTickets(): Promise<readonly RepositoryTicket[]>;
  getPullRequest(number: number): Promise<RepositoryPullRequest | null>;
}

export type ClaimWitness = {
  id: string;
  worker: string;
  state: "active" | "released";
};

export type RepositoryExecutionObservation = {
  ticketNumber: number;
  installationWorkId: string;
  revision: string;
  claimReadState: "available" | "conflict" | "unavailable";
  claims: readonly ClaimWitness[];
  lease: {
    state: "active" | "released" | "blocked" | "unavailable";
    recovery: "none" | "planned" | "awaiting-owner" | "blocked";
    detail: string;
  };
  pullRequestNumber: number | null;
  blockers: readonly string[];
};

export type FactoryTicketSnapshot = {
  ticket: RepositoryTicket;
  installationWorkId: string;
  authorityState: "observed" | "blocked" | "conflict";
  claimedWorker: string | null;
  claimWitnesses: readonly ClaimWitness[];
  lease: RepositoryExecutionObservation["lease"];
  pullRequest: RepositoryPullRequest | null;
  blockers: readonly string[];
  receipt: FactoryReconciliationReceipt;
};

export const repositoryExecutionAuthority: FactoryAuthorityMap = {
  ticket: "github",
  claim: "repository-execution",
  lease: "repository-execution",
  branch: "repository-execution",
  pullRequest: "repository-execution",
  checks: "github",
  publication: "repository-execution",
  recovery: "repository-execution",
};

function uniqueActiveClaims(claims: readonly ClaimWitness[]) {
  return claims.filter(
    (claim, index, all) =>
      claim.state === "active" &&
      all.findIndex(
        (candidate) =>
          candidate.state === "active" &&
          candidate.id === claim.id &&
          candidate.worker === claim.worker,
      ) === index,
  );
}

export async function reconcileRepositoryTicket(input: {
  connector: ReadOnlyRepositoryConnector;
  ticket: RepositoryTicket;
  execution: RepositoryExecutionObservation;
  observedAt: string;
}): Promise<FactoryTicketSnapshot> {
  const activeClaims = uniqueActiveClaims(input.execution.claims);
  const claimConflict =
    input.execution.claimReadState === "conflict" || activeClaims.length > 1;
  const claimUnavailable = input.execution.claimReadState === "unavailable";
  const pullRequest = input.execution.pullRequestNumber
    ? await input.connector.getPullRequest(input.execution.pullRequestNumber)
    : null;
  const blockers = [...input.execution.blockers];

  if (claimConflict && !blockers.includes("conflicting_claim_authority")) {
    blockers.unshift("conflicting_claim_authority");
  }
  if (claimUnavailable && !blockers.includes("claim_authority_unavailable")) {
    blockers.unshift("claim_authority_unavailable");
  }

  const authorityState = claimConflict
    ? "conflict"
    : claimUnavailable || blockers.length > 0
      ? "blocked"
      : "observed";
  const cursor: FactoryReconciliationCursor = {
    provider: input.connector.provider,
    repository: input.connector.repository,
    observedAt: input.observedAt,
    ticketRevision: input.ticket.revision,
    executionRevision: input.execution.revision,
  };

  const receipt = factoryReconciliationReceiptSchema.parse({
    schemaVersion: 1,
    installationWorkId: input.execution.installationWorkId,
    repositoryTicketId: input.ticket.id,
    outcome:
      authorityState === "conflict"
        ? "authority-conflict"
        : authorityState === "blocked"
          ? "blocked"
          : "observed",
    sourceHead: pullRequest?.sourceHead ?? null,
    cursor,
    authority: repositoryExecutionAuthority,
    blockers,
  });

  return {
    ticket: input.ticket,
    installationWorkId: input.execution.installationWorkId,
    authorityState,
    claimedWorker:
      authorityState === "observed" && activeClaims.length === 1
        ? activeClaims[0]!.worker
        : null,
    claimWitnesses: activeClaims,
    lease: input.execution.lease,
    pullRequest,
    blockers,
    receipt,
  };
}
