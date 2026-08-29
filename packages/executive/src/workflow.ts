import { randomUUID } from "node:crypto";

import {
  decisionClassificationSchema,
  executionAuthoritySchema,
  executiveRecommendationSchema,
  executiveWorkerJobRequestSchema,
  executiveWorkerJobSchema,
  type DataClassification,
  type DecisionClassification,
  type ExecutiveRecommendation,
  type ExecutiveWorkerJob,
  type ExecutiveWorkerJobRequest,
  type ExecutionAuthority,
  type RecordInput,
  type WorkInput,
} from "@aubos/contracts";
import type { ExecutiveWorkerProvider } from "@aubos/workers";
import type {
  DatabaseContext,
  PersonContext,
  WorkerContext,
} from "@aubos/database";

export type ExecutiveActor =
  { kind: "person"; id: string } | { kind: "worker"; id: string };

export interface ExecutiveRecord {
  id: string;
  installationId: string;
  workId: string | null;
  kind: RecordInput["kind"];
  summary: string;
  payload: Record<string, unknown>;
  actor: ExecutiveActor;
  supersedesRecordId: string | null;
}

export interface ExecutiveWork {
  id: string;
  input: WorkInput;
  authority: ExecutionAuthority;
}

export interface AppendExecutiveRecord {
  installationId: string;
  workId: string | null;
  kind: RecordInput["kind"];
  summary: string;
  payload: Record<string, unknown>;
  actor: ExecutiveActor;
  supersedesRecordId?: string | null;
}

export interface ExecutiveLedger {
  append(
    record: AppendExecutiveRecord,
    context?: DatabaseContext,
  ): Promise<ExecutiveRecord>;
  getRecord(
    id: string,
    context?: DatabaseContext,
  ): Promise<ExecutiveRecord | null>;
  createWork(
    input: WorkInput,
    authority: ExecutionAuthority,
    context?: PersonContext,
  ): Promise<ExecutiveWork>;
}

export class InMemoryExecutiveLedger implements ExecutiveLedger {
  readonly records: ExecutiveRecord[] = [];
  readonly work: ExecutiveWork[] = [];
  readonly #id: () => string;

  constructor(id: () => string = randomUUID) {
    this.#id = id;
  }

  append(record: AppendExecutiveRecord): Promise<ExecutiveRecord> {
    const created = {
      ...record,
      id: this.#id(),
      supersedesRecordId: record.supersedesRecordId ?? null,
    };
    this.records.push(created);
    return Promise.resolve(created);
  }

  getRecord(id: string): Promise<ExecutiveRecord | null> {
    return Promise.resolve(
      this.records.find((record) => record.id === id) ?? null,
    );
  }

  createWork(
    input: WorkInput,
    authority: ExecutionAuthority,
  ): Promise<ExecutiveWork> {
    const created = { id: this.#id(), input, authority };
    this.work.push(created);
    return Promise.resolve(created);
  }
}

export interface ExecutiveWorkflowDependencies {
  ledger: ExecutiveLedger;
  worker: ExecutiveWorkerProvider;
  authorityVerifier: ExecutiveAuthorityVerifier;
}

export interface ExecutiveAuthorityVerification {
  installationId: string;
  authority: ExecutionAuthority;
  approval: ExecutiveRecord;
  decision: ExecutiveRecord;
  proposal: ExecutiveRecord;
  requester: PersonContext;
}

/** The implementation must verify Policy, grant, revocation, scope, and expiry. */
export interface ExecutiveAuthorityVerifier {
  resolvePerson(input: {
    installationId: string;
    authUserId: string;
    requiredAuthority: "member" | "owner";
    operation: "review" | "decision" | "approval";
  }): Promise<string>;
  assertApplicable(input: ExecutiveAuthorityVerification): Promise<void>;
}

async function requireRecord(
  ledger: ExecutiveLedger,
  id: string,
  kind: ExecutiveRecord["kind"],
  context?: DatabaseContext,
): Promise<ExecutiveRecord> {
  const record = await ledger.getRecord(id, context);
  if (!record || record.kind !== kind) {
    throw new Error(`A ${kind} record is required`);
  }
  return record;
}

function recommendationFrom(record: ExecutiveRecord): ExecutiveRecommendation {
  const recommendation = record.payload.recommendation;
  if (!recommendation || typeof recommendation !== "object") {
    throw new Error("Proposal does not contain a worker recommendation");
  }
  return executiveRecommendationSchema.parse(recommendation);
}

function assertJobBoundary(
  request: ExecutiveWorkerJobRequest,
  job: ExecutiveWorkerJob,
  provider: ExecutiveWorkerProvider,
): void {
  if (
    job.installationId !== request.installationId ||
    job.workId !== request.workId ||
    job.workerId !== request.workerId ||
    job.provider !== provider.provider ||
    job.model !== provider.model
  ) {
    throw new Error(
      "Worker job crossed its provider, installation, Work, or worker boundary",
    );
  }
}

/**
 * Coordinates append-only executive records. It deliberately contains no
 * external-action adapter. Creating governed Work is the strongest operation.
 */
export class ExecutiveWorkflow {
  readonly #ledger: ExecutiveLedger;
  readonly #worker: ExecutiveWorkerProvider;
  readonly #authorityVerifier: ExecutiveAuthorityVerifier;

  constructor(dependencies: ExecutiveWorkflowDependencies) {
    this.#ledger = dependencies.ledger;
    this.#worker = dependencies.worker;
    this.#authorityVerifier = dependencies.authorityVerifier;
  }

  recordEvidence(input: {
    installationId: string;
    summary: string;
    sourceUri: string | null;
    classification: DataClassification;
    actor: ExecutiveActor;
    payload?: Record<string, unknown>;
  }): Promise<ExecutiveRecord> {
    return this.#ledger.append({
      installationId: input.installationId,
      workId: null,
      kind: "evidence",
      summary: input.summary,
      payload: {
        ...input.payload,
        sourceUri: input.sourceUri,
        classification: input.classification,
      },
      actor: input.actor,
    });
  }

  async startProposal(
    request: ExecutiveWorkerJobRequest,
    requester?: PersonContext,
  ): Promise<{
    job: ExecutiveWorkerJob;
    proposal: ExecutiveRecord | null;
  }> {
    const parsedRequest = executiveWorkerJobRequestSchema.parse(request);
    for (const evidence of parsedRequest.evidence) {
      const record = await requireRecord(
        this.#ledger,
        evidence.recordId,
        "evidence",
        requester,
      );
      if (record.installationId !== parsedRequest.installationId) {
        throw new Error("Evidence cannot cross installation boundaries");
      }
    }
    const job = executiveWorkerJobSchema.parse(
      await this.#worker.submit(parsedRequest),
    );
    assertJobBoundary(parsedRequest, job, this.#worker);
    return {
      job,
      proposal:
        job.status === "completed" ? await this.#recordProposal(job) : null,
    };
  }

  async completeProposal(job: ExecutiveWorkerJob): Promise<{
    job: ExecutiveWorkerJob;
    proposal: ExecutiveRecord | null;
  }> {
    const submitted = executiveWorkerJobSchema.parse(job);
    if (
      submitted.provider !== this.#worker.provider ||
      submitted.model !== this.#worker.model
    ) {
      throw new Error("Worker job does not belong to the configured provider");
    }
    const current = executiveWorkerJobSchema.parse(
      await this.#worker.retrieve(submitted),
    );
    if (
      current.jobId !== submitted.jobId ||
      current.installationId !== submitted.installationId ||
      current.workId !== submitted.workId ||
      current.workerId !== submitted.workerId
    ) {
      throw new Error("Retrieved worker job crossed its recorded boundary");
    }
    return {
      job: current,
      proposal:
        current.status === "completed"
          ? await this.#recordProposal(current)
          : null,
    };
  }

  async review(input: {
    proposalRecordId: string;
    reviewer: PersonContext;
    summary: string;
    disposition: "support" | "revise" | "reject";
  }): Promise<ExecutiveRecord> {
    const proposal = await requireRecord(
      this.#ledger,
      input.proposalRecordId,
      "proposal",
      input.reviewer,
    );
    if (input.reviewer.installationId !== proposal.installationId) {
      throw new Error("Reviewer context cannot cross installations");
    }
    const reviewerPersonId = await this.#authorityVerifier.resolvePerson({
      installationId: proposal.installationId,
      authUserId: input.reviewer.authUserId,
      requiredAuthority: "member",
      operation: "review",
    });
    return this.#ledger.append(
      {
        installationId: proposal.installationId,
        workId: proposal.workId,
        kind: "review",
        summary: input.summary,
        payload: {
          proposalRecordId: proposal.id,
          disposition: input.disposition,
        },
        actor: { kind: "person", id: reviewerPersonId },
      },
      input.reviewer,
    );
  }

  async decide(input: {
    reviewRecordId: string;
    decisionMaker: PersonContext;
    summary: string;
    classification: DecisionClassification;
  }): Promise<ExecutiveRecord> {
    const review = await requireRecord(
      this.#ledger,
      input.reviewRecordId,
      "review",
      input.decisionMaker,
    );
    const classification = decisionClassificationSchema.parse(
      input.classification,
    );
    if (input.decisionMaker.installationId !== review.installationId) {
      throw new Error("Decision maker context cannot cross installations");
    }
    const decisionMakerPersonId = await this.#authorityVerifier.resolvePerson({
      installationId: review.installationId,
      authUserId: input.decisionMaker.authUserId,
      requiredAuthority: "owner",
      operation: "decision",
    });
    return this.#ledger.append(
      {
        installationId: review.installationId,
        workId: review.workId,
        kind: "decision",
        summary: input.summary,
        payload: {
          reviewRecordId: review.id,
          proposalRecordId: review.payload.proposalRecordId,
          classification,
        },
        actor: { kind: "person", id: decisionMakerPersonId },
      },
      input.decisionMaker,
    );
  }

  async approve(input: {
    decisionRecordId: string;
    approver: PersonContext;
    summary: string;
  }): Promise<ExecutiveRecord> {
    const decision = await requireRecord(
      this.#ledger,
      input.decisionRecordId,
      "decision",
      input.approver,
    );
    if (decision.payload.classification === "prohibited") {
      throw new Error("A prohibited decision cannot be approved");
    }
    if (input.approver.installationId !== decision.installationId) {
      throw new Error("Approver context cannot cross installations");
    }
    const approverPersonId = await this.#authorityVerifier.resolvePerson({
      installationId: decision.installationId,
      authUserId: input.approver.authUserId,
      requiredAuthority: "owner",
      operation: "approval",
    });
    return this.#ledger.append(
      {
        installationId: decision.installationId,
        workId: decision.workId,
        kind: "approval",
        summary: input.summary,
        payload: {
          decisionRecordId: decision.id,
          proposalRecordId: decision.payload.proposalRecordId,
        },
        actor: { kind: "person", id: approverPersonId },
      },
      input.approver,
    );
  }

  async createExecutionWork(input: {
    approvalRecordId: string;
    authority: ExecutionAuthority;
    title: string;
    requestedOutcome: string;
    acceptanceCriteria: string[];
    priority?: number;
    requester: PersonContext;
  }): Promise<ExecutiveWork> {
    const authority = executionAuthoritySchema.parse(input.authority);
    if (authority.approvalRecordId !== input.approvalRecordId) {
      throw new Error("Execution authority must cite the applicable approval");
    }
    const approval = await requireRecord(
      this.#ledger,
      input.approvalRecordId,
      "approval",
      input.requester,
    );
    const decisionId = approval.payload.decisionRecordId;
    if (typeof decisionId !== "string") {
      throw new Error("Approval does not cite a decision");
    }
    const decision = await requireRecord(
      this.#ledger,
      decisionId,
      "decision",
      input.requester,
    );
    const proposalId = approval.payload.proposalRecordId;
    if (typeof proposalId !== "string") {
      throw new Error("Approval does not cite a proposal");
    }
    const proposal = await requireRecord(
      this.#ledger,
      proposalId,
      "proposal",
      input.requester,
    );
    const action = recommendationFrom(proposal).recommendedAction;
    if (
      action.capability !== authority.capability ||
      action.mode !== authority.mode
    ) {
      throw new Error("Capability grant does not match the approved action");
    }
    await this.#authorityVerifier.assertApplicable({
      installationId: approval.installationId,
      authority,
      approval,
      decision,
      proposal,
      requester: input.requester,
    });
    return this.#ledger.createWork(
      {
        installationId: approval.installationId,
        title: input.title,
        requestedOutcome: input.requestedOutcome,
        acceptanceCriteria: input.acceptanceCriteria,
        parentWorkId: proposal.workId,
        priority: input.priority ?? 50,
      },
      authority,
      input.requester,
    );
  }

  recordReceipt(input: {
    work: ExecutiveWork;
    workerId: string;
    summary: string;
    artifacts: Array<{ uri: string; sha256?: string }>;
  }): Promise<ExecutiveRecord> {
    if (input.workerId !== input.work.authority.executorWorkerId) {
      throw new Error(
        "Receipt worker does not hold the verified execution authority",
      );
    }
    return this.#ledger.append(
      {
        installationId: input.work.input.installationId,
        workId: input.work.id,
        kind: "receipt",
        summary: input.summary,
        payload: {
          authority: input.work.authority,
          artifacts: input.artifacts,
        },
        actor: { kind: "worker", id: input.workerId },
      },
      {
        installationId: input.work.input.installationId,
        workerId: input.workerId,
      },
    );
  }

  async recordOutcome(input: {
    receiptRecordId: string;
    observer: ExecutiveActor;
    summary: string;
    comparedWithIntent: string;
  }): Promise<ExecutiveRecord> {
    const receipt = await requireRecord(
      this.#ledger,
      input.receiptRecordId,
      "receipt",
    );
    return this.#ledger.append({
      installationId: receipt.installationId,
      workId: receipt.workId,
      kind: "outcome",
      summary: input.summary,
      payload: {
        receiptRecordId: receipt.id,
        comparedWithIntent: input.comparedWithIntent,
      },
      actor: input.observer,
    });
  }

  async createCandidateLearning(input: {
    outcomeRecordId: string;
    actor: ExecutiveActor;
    summary: string;
    claim: string;
  }): Promise<ExecutiveRecord> {
    const outcome = await requireRecord(
      this.#ledger,
      input.outcomeRecordId,
      "outcome",
    );
    return this.#ledger.append({
      installationId: outcome.installationId,
      workId: outcome.workId,
      kind: "learning",
      summary: input.summary,
      payload: {
        outcomeRecordId: outcome.id,
        admissionState: "candidate",
        quarantine: true,
        claim: input.claim,
      },
      actor: input.actor,
    });
  }

  #recordProposal(job: ExecutiveWorkerJob): Promise<ExecutiveRecord> {
    if (!job.recommendation) {
      throw new Error("Completed worker job has no structured recommendation");
    }
    const workerContext: WorkerContext = {
      installationId: job.installationId,
      workerId: job.workerId,
    };
    return this.#ledger.append(
      {
        installationId: job.installationId,
        workId: job.workId,
        kind: "proposal",
        summary: job.recommendation.summary,
        payload: {
          providerJob: {
            id: job.jobId,
            provider: job.provider,
            model: job.model,
            store: job.store,
            background: job.background,
          },
          recommendation: job.recommendation,
        },
        actor: { kind: "worker", id: job.workerId },
      },
      workerContext,
    );
  }
}
