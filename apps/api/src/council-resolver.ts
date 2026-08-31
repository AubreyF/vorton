import { createHash, randomUUID } from "node:crypto";

import {
  deriveDataClassification,
  executiveCouncilRecordSchema,
  executiveCouncilStateSchema,
  executiveRecommendationSchema,
  executiveWorkerJobRequestSchema,
  executiveWorkerJobSchema,
  type ExecutiveCouncilPeerContext,
  type ExecutiveCouncilRecord,
  type ExecutiveCouncilState,
  type ExecutiveEvidence,
  type ExecutiveWorkerJob,
  type ExecutiveWorkerJobRequest,
} from "@vorton/contracts";
import type { Database, PersonContext, SqlExecutor } from "@vorton/database";
import {
  canonicalCouncilRoles,
  deriveCouncilState,
  executiveCouncilProtocol,
  type CanonicalCouncilRole,
  type CouncilWorkSnapshot,
  type InstalledCouncilRole,
} from "@vorton/executive";
import type { ExecutiveWorkerProvider } from "@vorton/workers";

import { requireRecentAal2, type AuthenticatedIdentity } from "./auth.js";

export class ExecutiveCouncilInputError extends Error {}
export class ExecutiveCouncilResolutionError extends Error {}
export class ExecutiveCouncilConflictError extends Error {}

interface PersonRow {
  id: string;
  kind: "owner" | "member";
}

interface WorkRow {
  id: string;
  title: string;
  requested_outcome: string;
  acceptance_criteria: unknown;
  state: ExecutiveCouncilState["work"]["state"];
  updated_at: Date | string;
  input_sha256: string;
}

interface WorkerRow {
  id: string;
  name: string;
  provider: string;
  model: string;
}

interface RoleRow {
  id: string;
  worker_id: string;
  name: string;
  version: number;
  skill_markdown: string;
  content_sha256: string;
}

interface EvidenceRow {
  id: string;
  summary: string;
  source_uri: string | null;
  classification: ExecutiveEvidence["classification"];
}

interface RecordRow {
  id: string;
  installation_id: string;
  workspace_id: string;
  kind: "proposal" | "review";
  summary: string;
  payload: Record<string, unknown>;
  actor_worker_id: string;
}

interface CouncilSnapshot {
  work: CouncilWorkSnapshot;
  workUpdatedAt: string;
  workInputSha256: string;
  roles: Array<
    InstalledCouncilRole & {
      skillMarkdown: string;
      contentSha256: string;
    }
  >;
  records: CouncilContribution[];
  evidence: ExecutiveEvidence[];
}

interface CouncilContribution extends ExecutiveCouncilRecord {
  evidenceRecordIds: string[];
  workUpdatedAt: string;
  workInputSha256: string;
}

interface ResolvedCouncilWork {
  work: CouncilWorkSnapshot;
  updatedAt: string;
  inputSha256: string;
}

interface CouncilAttemptReservation {
  id: string;
}

interface JsonRow {
  value: Record<string, unknown>;
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): string {
  if (!uuid.test(value)) {
    throw new ExecutiveCouncilInputError(`${label} must be a UUID`);
  }
  return value.toLowerCase();
}

export function parseCouncilInstallationInput(value: unknown): {
  installationId: string;
  workspaceId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExecutiveCouncilInputError(
      "Council request body must be an object",
    );
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (
    keys.length !== 2 ||
    !keys.includes("installationId") ||
    !keys.includes("workspaceId")
  ) {
    throw new ExecutiveCouncilInputError(
      "Only installationId and workspaceId may be supplied; roles, workers, evidence, peer context, and authority are server-resolved",
    );
  }
  if (typeof body.installationId !== "string") {
    throw new ExecutiveCouncilInputError("installationId must be a UUID");
  }
  if (typeof body.workspaceId !== "string") {
    throw new ExecutiveCouncilInputError("workspaceId must be a UUID");
  }
  return {
    installationId: requireUuid(body.installationId, "installationId"),
    workspaceId: requireUuid(body.workspaceId, "workspaceId"),
  };
}

function deterministicUuid(scope: string, kind: string): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`vorton-executive-council-v1:${scope}:${kind}`)
      .digest("hex"),
    "hex",
  ).subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const encoded = bytes.toString("hex");
  return `${encoded.slice(0, 8)}-${encoded.slice(8, 12)}-${encoded.slice(12, 16)}-${encoded.slice(16, 20)}-${encoded.slice(20)}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function assertExact(
  label: string,
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
): void {
  if (
    !actual ||
    JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))
  ) {
    throw new ExecutiveCouncilConflictError(
      `${label} already exists with conflicting authoritative data`,
    );
  }
}

async function rowValue(
  transaction: SqlExecutor,
  table: string,
  id: string,
  installationId: string,
  workspaceId: string,
  columns: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await transaction.query<JsonRow>(
    `select to_jsonb(selected) as value from (
       select ${columns} from public.${table}
        where id = $1 and installation_id = $2 and workspace_id = $3
     ) selected`,
    [id, installationId, workspaceId],
  );
  return result.rows[0]?.value;
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new ExecutiveCouncilConflictError(`${label} is malformed`);
  }
  return value;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function councilRecord(row: RecordRow): CouncilContribution {
  const providerJob = row.payload.providerJob;
  const recommendation = executiveRecommendationSchema.parse(
    row.payload.recommendation,
  );
  const phase = row.payload.councilPhase;
  const roleId = row.payload.councilRoleId;
  const inputRecordIds = stringArray(
    row.payload.inputRecordIds,
    "Council input record IDs",
  );
  const evidenceRecordIds = stringArray(
    row.payload.evidenceRecordIds,
    "Council evidence record IDs",
  );
  const peerRecordIds = stringArray(
    row.payload.peerRecordIds,
    "Council peer record IDs",
  );
  const workUpdatedAt = row.payload.workUpdatedAt;
  const workInputSha256 = row.payload.workInputSha256;
  const installationId = row.payload.installationId;
  const workspaceId = row.payload.workspaceId;
  if (
    row.payload.councilProtocol !== executiveCouncilProtocol ||
    row.payload.authority !== "none" ||
    installationId !== row.installation_id ||
    workspaceId !== row.workspace_id ||
    typeof roleId !== "string" ||
    !uuid.test(roleId) ||
    typeof workUpdatedAt !== "string" ||
    !Number.isFinite(Date.parse(workUpdatedAt)) ||
    typeof workInputSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(workInputSha256) ||
    !sameSet(inputRecordIds, [...evidenceRecordIds, ...peerRecordIds]) ||
    recommendation.evidenceRecordIds.some(
      (recordId) => !evidenceRecordIds.includes(recordId),
    )
  ) {
    throw new ExecutiveCouncilConflictError(
      "Council contribution crossed its protocol or input boundary",
    );
  }
  const parsed = executiveCouncilRecordSchema.parse({
    id: row.id,
    installationId,
    workspaceId,
    kind: row.kind,
    summary: row.summary,
    actorWorkerId: row.actor_worker_id,
    recommendation,
    phase,
    roleId,
    inputRecordIds,
    peerRecordIds,
    providerJob,
  });
  if (
    (parsed.phase === "review") !== (parsed.kind === "review") ||
    (parsed.phase === "proposal" && parsed.peerRecordIds.length !== 0)
  ) {
    throw new ExecutiveCouncilConflictError(
      "Council contribution kind does not match its phase",
    );
  }
  return {
    ...parsed,
    evidenceRecordIds,
    workUpdatedAt,
    workInputSha256,
  };
}

function contributionPeer(
  contribution: CouncilContribution,
  roles: CouncilSnapshot["roles"],
): ExecutiveCouncilPeerContext {
  const role = roles.find((item) => item.roleId === contribution.roleId);
  if (!role) {
    throw new ExecutiveCouncilConflictError(
      "Council contribution cites an uninstalled role",
    );
  }
  return {
    recordId: contribution.id,
    installationId: contribution.installationId,
    workspaceId: contribution.workspaceId,
    kind: contribution.kind,
    phase: contribution.phase as "proposal" | "review",
    roleId: contribution.roleId,
    roleName: role.name,
    summary: contribution.summary,
    recommendation: contribution.recommendation,
    trust: "untrusted",
    authority: "none",
  };
}

export class DatabaseExecutiveCouncilResolver {
  constructor(
    private readonly database: Database,
    private readonly worker: ExecutiveWorkerProvider,
  ) {}

  async install(
    workIdValue: string,
    requester: PersonContext & AuthenticatedIdentity,
  ): Promise<ExecutiveCouncilState> {
    requireRecentAal2(requester);
    const workId = requireUuid(workIdValue, "workId");
    await this.database.asPerson(requester, async (transaction) => {
      await transaction.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          `${executiveCouncilProtocol}:${requester.installationId}:${requester.workspaceId}:${workId}`,
        ],
      );
      const person = await this.#person(transaction, requester, true);
      const resolvedWork = await this.#work(
        transaction,
        requester.installationId,
        requester.workspaceId,
        workId,
      );
      this.#assertWorkCanAdvance(resolvedWork.work);
      const workers = await transaction.query<WorkerRow>(
        `select id, name, provider, model
           from public.workers
          where installation_id = $1 and workspace_id = $2
            and provider = $3 and model = $4
          order by id`,
        [
          requester.installationId,
          requester.workspaceId,
          this.worker.provider,
          this.worker.model,
        ],
      );
      if (workers.rows.length !== 1 || !workers.rows[0]) {
        throw new ExecutiveCouncilConflictError(
          "Council installation requires exactly one configured recommendation worker",
        );
      }
      const worker = workers.rows[0];
      for (const role of canonicalCouncilRoles) {
        await this.#installRole(
          transaction,
          requester.installationId,
          requester.workspaceId,
          person.id,
          worker.id,
          role,
        );
      }
      await this.#installPolicyAndGrants(
        transaction,
        requester.installationId,
        requester.workspaceId,
        workId,
        person.id,
        worker.id,
      );
    });
    return this.get(workId, requester);
  }

  async get(
    workIdValue: string,
    requester: PersonContext,
  ): Promise<ExecutiveCouncilState> {
    const workId = requireUuid(workIdValue, "workId");
    const snapshot = await this.#snapshot(workId, requester, false, false);
    return deriveCouncilState({
      installationId: requester.installationId,
      workspaceId: requester.workspaceId,
      work: snapshot.work,
      roles: snapshot.roles,
      records: snapshot.records,
    });
  }

  async advance(
    workIdValue: string,
    requester: PersonContext,
  ): Promise<ExecutiveCouncilState> {
    const workId = requireUuid(workIdValue, "workId");
    const snapshot = await this.#snapshot(workId, requester, true, true);
    const state = deriveCouncilState({
      installationId: requester.installationId,
      workspaceId: requester.workspaceId,
      work: snapshot.work,
      roles: snapshot.roles,
      records: snapshot.records,
    });
    if (!state.nextStep) return state;
    this.#assertWorkCanAdvance(snapshot.work);
    if (this.worker.storesResponses) {
      throw new ExecutiveCouncilConflictError(
        "Executive council provider storage must be disabled before any evidence is transmitted",
      );
    }
    const role = snapshot.roles.find(
      (item) => item.roleId === state.nextStep?.roleId,
    );
    if (!role) {
      throw new ExecutiveCouncilConflictError(
        "Next council role is not installed",
      );
    }
    const proposals = snapshot.records.filter(
      (record) => record.phase === "proposal",
    );
    const reviews = snapshot.records.filter(
      (record) => record.phase === "review",
    );
    const peerRecords =
      state.nextStep.phase === "proposal"
        ? []
        : state.nextStep.phase === "review"
          ? proposals.filter((record) => record.roleId !== role.roleId)
          : [...proposals, ...reviews];
    const peerContext = peerRecords.map((record) =>
      contributionPeer(record, snapshot.roles),
    );
    const evidenceRecordIds = snapshot.evidence.map(
      (evidence) => evidence.recordId,
    );
    const inputRecordIds = [
      ...evidenceRecordIds,
      ...peerRecords.map((record) => record.id),
    ];
    const request = executiveWorkerJobRequestSchema.parse({
      installationId: requester.installationId,
      workspaceId: requester.workspaceId,
      workId,
      workerId: role.workerId,
      role: {
        roleId: role.roleId,
        name: role.name,
        version: role.version,
        contentSha256: role.contentSha256,
        skillMarkdown: role.skillMarkdown,
      },
      objective: this.#objective(
        state.nextStep.phase,
        snapshot.work,
        role.name,
      ),
      evidence: snapshot.evidence,
      derivedContext: [],
      council: {
        protocol: executiveCouncilProtocol,
        installationId: requester.installationId,
        workspaceId: requester.workspaceId,
        phase: state.nextStep.phase,
        roleId: role.roleId,
        workUpdatedAt: snapshot.workUpdatedAt,
        workInputSha256: snapshot.workInputSha256,
        inputRecordIds,
        peerContext,
        authority: "none",
      },
      background: false,
    });
    const reservation = await this.#reserveAttempt(request);
    if (!reservation) return this.get(workId, requester);
    let job: ExecutiveWorkerJob;
    try {
      job = executiveWorkerJobSchema.parse(await this.worker.submit(request));
      this.#assertJob(request, job);
    } catch {
      await this.#failReservation(
        request,
        reservation,
        "Council provider call failed before returning a valid bounded job",
      );
      throw new ExecutiveCouncilConflictError(
        "Council provider call failed before returning a valid bounded job",
      );
    }
    if (job.status !== "completed" || !job.recommendation) {
      await this.#persistRunOnly(request, job, reservation);
      throw new ExecutiveCouncilConflictError(
        "Council worker did not return a completed recommendation",
      );
    }
    if (
      job.recommendation.evidenceRecordIds.some(
        (recordId) => !evidenceRecordIds.includes(recordId),
      )
    ) {
      const failedJob = executiveWorkerJobSchema.parse({
        ...job,
        status: "failed",
        recommendation: undefined,
        error:
          "Council recommendation cited evidence outside the frozen authoritative input",
      });
      await this.#persistRunOnly(request, failedJob, reservation);
      throw new ExecutiveCouncilConflictError(
        "Council recommendation cited evidence outside the frozen authoritative input",
      );
    }
    try {
      await this.#persistContribution(request, job, reservation);
    } catch (error) {
      await this.#failReservation(
        request,
        reservation,
        "Council contribution was discarded because its frozen agenda or durable fence changed",
      );
      if (isUniqueViolation(error)) {
        const current = await this.get(workId, requester);
        if (current.counts.total > state.counts.total) return current;
      }
      throw new ExecutiveCouncilConflictError(
        "Council contribution was discarded because its frozen agenda or durable fence changed",
      );
    }
    return this.get(workId, requester);
  }

  async #snapshot(
    workId: string,
    requester: PersonContext,
    ownerRequired: boolean,
    grantsRequired: boolean,
  ): Promise<CouncilSnapshot> {
    return this.database.asPerson(requester, async (transaction) => {
      await this.#person(transaction, requester, ownerRequired);
      const resolvedWork = await this.#work(
        transaction,
        requester.installationId,
        requester.workspaceId,
        workId,
      );
      const rolesResult = await transaction.query<RoleRow>(
        `select role.id, assignment.worker_id, role.name, role.version,
                role.skill_markdown, role.content_sha256
           from public.roles role
           join public.worker_role_assignments assignment
             on assignment.installation_id = role.installation_id
            and assignment.workspace_id = role.workspace_id
            and assignment.role_id = role.id
           join public.workers worker
             on worker.installation_id = assignment.installation_id
            and worker.workspace_id = assignment.workspace_id
            and worker.id = assignment.worker_id
          where role.installation_id = $1
            and role.workspace_id = $2
            and role.name = any($3::text[])
            and worker.provider = $4 and worker.model = $5
          order by array_position($3::text[], role.name), role.id, worker.id`,
        [
          requester.installationId,
          requester.workspaceId,
          canonicalCouncilRoles.map((role) => role.name),
          this.worker.provider,
          this.worker.model,
        ],
      );
      const roles = this.#validateRoles(rolesResult.rows);
      if (grantsRequired) {
        await this.#assertGrants(
          transaction,
          requester.installationId,
          requester.workspaceId,
          workId,
          roles[0]!.workerId,
        );
      }
      const recordRows = await transaction.query<RecordRow>(
        `select id, installation_id, workspace_id, kind, summary, payload,
                actor_worker_id
           from public.records
          where installation_id = $1 and workspace_id = $2 and work_id = $3
            and payload ->> 'councilProtocol' = $4
          order by created_at, id`,
        [
          requester.installationId,
          requester.workspaceId,
          workId,
          executiveCouncilProtocol,
        ],
      );
      const records = recordRows.rows.map(councilRecord);
      this.#validateContributionSet(roles, records, resolvedWork.inputSha256);
      const frozenEvidence = records[0]?.evidenceRecordIds;
      const evidenceResult = await transaction.query<EvidenceRow>(
        frozenEvidence
          ? `select id, summary, source_uri, classification
               from public.records
              where installation_id = $1 and workspace_id = $2
                and kind = 'evidence' and id = any($3::uuid[])
              order by id`
          : `select id, summary, source_uri, classification
               from public.records
              where installation_id = $1 and workspace_id = $2
                and kind = 'evidence'
                and (work_id is null or work_id = $3)
              order by created_at desc, id desc
              limit 20`,
        frozenEvidence
          ? [requester.installationId, requester.workspaceId, frozenEvidence]
          : [requester.installationId, requester.workspaceId, workId],
      );
      if (
        evidenceResult.rows.length === 0 ||
        (frozenEvidence &&
          !sameSet(
            evidenceResult.rows.map((item) => item.id),
            frozenEvidence,
          ))
      ) {
        throw new ExecutiveCouncilConflictError(
          "Council authoritative evidence is missing or crossed its installation or workspace boundary",
        );
      }
      return {
        work: resolvedWork.work,
        workUpdatedAt: resolvedWork.updatedAt,
        workInputSha256: resolvedWork.inputSha256,
        roles,
        records,
        evidence: evidenceResult.rows
          .map((item) => ({
            recordId: item.id,
            summary: item.summary,
            sourceUri: item.source_uri,
            classification: item.classification,
          }))
          .sort((left, right) => left.recordId.localeCompare(right.recordId)),
      };
    });
  }

  async #person(
    transaction: SqlExecutor,
    requester: PersonContext,
    ownerRequired: boolean,
  ): Promise<PersonRow> {
    const result = await transaction.query<PersonRow>(
      `select person.id, membership.kind
         from public.people person
         join public.workspace_memberships membership
           on membership.installation_id = person.installation_id
          and membership.person_id = person.id
        where person.installation_id = $1
          and membership.workspace_id = $2
          and person.auth_user_id = $3
          and ($4::boolean = false or membership.kind = 'owner')`,
      [
        requester.installationId,
        requester.workspaceId,
        requester.authUserId,
        ownerRequired,
      ],
    );
    const person = result.rows[0];
    if (!person) {
      throw new ExecutiveCouncilResolutionError(
        ownerRequired
          ? "Workspace owner authority is required to change or advance the executive council"
          : "Live workspace membership is required to read the executive council",
      );
    }
    return person;
  }

  async #work(
    transaction: SqlExecutor,
    installationId: string,
    workspaceId: string,
    workId: string,
  ): Promise<ResolvedCouncilWork> {
    const result = await transaction.query<WorkRow>(
      `select id, title, requested_outcome, acceptance_criteria, state,
              to_char(updated_at at time zone 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
              encode(extensions.digest(convert_to(jsonb_build_object(
                'id', id,
                'title', title,
                'requestedOutcome', requested_outcome,
                'acceptanceCriteria', acceptance_criteria,
                'state', state::text
              )::text, 'UTF8'), 'sha256'), 'hex') as input_sha256
         from public.work
        where installation_id = $1 and workspace_id = $2 and id = $3`,
      [installationId, workspaceId, workId],
    );
    const work = result.rows[0];
    if (!work) {
      throw new ExecutiveCouncilResolutionError(
        "Council Work is missing or belongs to another installation or workspace",
      );
    }
    const snapshot: CouncilWorkSnapshot = {
      id: work.id,
      title: work.title,
      requestedOutcome: work.requested_outcome,
      acceptanceCriteria: Array.isArray(work.acceptance_criteria)
        ? work.acceptance_criteria.filter(
            (criterion): criterion is string => typeof criterion === "string",
          )
        : [],
      state: work.state,
    };
    const updatedAt =
      work.updated_at instanceof Date
        ? work.updated_at.toISOString()
        : work.updated_at;
    const inputSha256 = work.input_sha256;
    if (!/^[a-f0-9]{64}$/.test(inputSha256)) {
      throw new ExecutiveCouncilConflictError(
        "Council Work input hash could not be resolved",
      );
    }
    return { work: snapshot, updatedAt, inputSha256 };
  }

  #assertWorkCanAdvance(work: CouncilWorkSnapshot): void {
    if (["leased", "completed", "cancelled"].includes(work.state)) {
      throw new ExecutiveCouncilConflictError(
        `Council cannot advance Work in ${work.state} state`,
      );
    }
  }

  #validateRoles(rows: RoleRow[]): CouncilSnapshot["roles"] {
    if (rows.length !== canonicalCouncilRoles.length) {
      throw new ExecutiveCouncilConflictError(
        "Executive council is not installed for this installation",
      );
    }
    const workerIds = new Set(rows.map((row) => row.worker_id));
    if (workerIds.size !== 1) {
      throw new ExecutiveCouncilConflictError(
        "Executive council roles crossed their configured worker boundary",
      );
    }
    return canonicalCouncilRoles.map((canonicalRole) => {
      const matches = rows.filter((row) => row.name === canonicalRole.name);
      const row = matches[0];
      if (
        matches.length !== 1 ||
        !row ||
        row.version !== canonicalRole.version ||
        row.skill_markdown !== canonicalRole.skillMarkdown ||
        row.content_sha256 !== canonicalRole.contentSha256
      ) {
        throw new ExecutiveCouncilConflictError(
          `${canonicalRole.name} role differs from the canonical council version`,
        );
      }
      return {
        roleId: row.id,
        workerId: row.worker_id,
        name: row.name,
        version: row.version,
        skillMarkdown: row.skill_markdown,
        contentSha256: row.content_sha256,
      };
    });
  }

  #validateContributionSet(
    roles: CouncilSnapshot["roles"],
    records: CouncilContribution[],
    currentWorkInputSha256: string,
  ): void {
    const proposals = records.filter((record) => record.phase === "proposal");
    const reviews = records.filter((record) => record.phase === "review");
    const syntheses = records.filter((record) => record.phase === "synthesis");
    if (proposals.length > 5 || reviews.length > 5 || syntheses.length > 1) {
      throw new ExecutiveCouncilConflictError(
        "Council contribution fence was violated",
      );
    }
    for (const record of records) {
      const role = roles.find((item) => item.roleId === record.roleId);
      if (!role || role.workerId !== record.actorWorkerId) {
        throw new ExecutiveCouncilConflictError(
          "Council contribution crossed its role or worker boundary",
        );
      }
      if (record.phase === "review") {
        const expected = proposals
          .filter((proposal) => proposal.roleId !== record.roleId)
          .map((proposal) => proposal.id);
        if (expected.length !== 4 || !sameSet(record.peerRecordIds, expected)) {
          throw new ExecutiveCouncilConflictError(
            "Council review does not cite exactly four other-role proposals",
          );
        }
      }
      if (record.phase === "synthesis") {
        const chiefExecutive = roles.find(
          (candidate) => candidate.name === "Chief Executive Officer",
        );
        const expected = [...proposals, ...reviews].map((item) => item.id);
        if (
          record.roleId !== chiefExecutive?.roleId ||
          expected.length !== 10 ||
          !sameSet(record.peerRecordIds, expected)
        ) {
          throw new ExecutiveCouncilConflictError(
            "Council synthesis does not cite the complete contribution set",
          );
        }
      }
    }
    const frozenEvidence = records[0]?.evidenceRecordIds;
    if (
      frozenEvidence &&
      records.some(
        (record) => !sameSet(record.evidenceRecordIds, frozenEvidence),
      )
    ) {
      throw new ExecutiveCouncilConflictError(
        "Council contributions do not share one frozen evidence set",
      );
    }
    const frozenWorkInputSha256 = records[0]?.workInputSha256;
    const frozenWorkUpdatedAt = records[0]?.workUpdatedAt;
    if (
      frozenWorkInputSha256 &&
      (records.some(
        (record) =>
          record.workInputSha256 !== frozenWorkInputSha256 ||
          record.workUpdatedAt !== frozenWorkUpdatedAt,
      ) ||
        (records.length < 11 &&
          frozenWorkInputSha256 !== currentWorkInputSha256))
    ) {
      throw new ExecutiveCouncilConflictError(
        "Council Work agenda changed after its evidence and recommendations were frozen",
      );
    }
  }

  async #assertGrants(
    transaction: SqlExecutor,
    installationId: string,
    workspaceId: string,
    workId: string,
    workerId: string,
  ): Promise<void> {
    const result = await transaction.query<{ capability: string }>(
      `select grant_row.capability
         from public.capability_grants grant_row
         join public.policies policy
           on policy.installation_id = grant_row.installation_id
          and policy.workspace_id = grant_row.workspace_id
          and policy.id = grant_row.policy_id
        where grant_row.installation_id = $1
          and grant_row.workspace_id = $2
          and grant_row.work_id = $3
          and grant_row.principal_kind = 'worker'
          and grant_row.worker_id = $4
          and grant_row.mode = 'recommend'
          and grant_row.capability = any($5::text[])
          and policy.definition ->> 'protocol' = $6
          and (grant_row.expires_at is null or grant_row.expires_at > now())
          and not exists (
            select 1 from public.capability_grant_revocations revocation
             where revocation.installation_id = grant_row.installation_id
               and revocation.workspace_id = grant_row.workspace_id
               and revocation.grant_id = grant_row.id
          )
        order by grant_row.capability`,
      [
        installationId,
        workspaceId,
        workId,
        workerId,
        ["executive.propose", "executive.review"],
        executiveCouncilProtocol,
      ],
    );
    if (
      !sameSet(
        result.rows.map((row) => row.capability),
        ["executive.propose", "executive.review"],
      )
    ) {
      throw new ExecutiveCouncilResolutionError(
        "Council recommendation grants are missing, expired, revoked, or out of scope",
      );
    }
  }

  async #installRole(
    transaction: SqlExecutor,
    installationId: string,
    workspaceId: string,
    personId: string,
    workerId: string,
    role: CanonicalCouncilRole,
  ): Promise<void> {
    const roleId = deterministicUuid(
      `${installationId}:${workspaceId}`,
      `role:${role.slug}:v1`,
    );
    await transaction.query(
      `insert into public.roles
         (id, installation_id, workspace_id, name, version, skill_markdown,
          content_sha256, created_by_person_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict do nothing`,
      [
        roleId,
        installationId,
        workspaceId,
        role.name,
        role.version,
        role.skillMarkdown,
        role.contentSha256,
        personId,
      ],
    );
    assertExact(
      role.name,
      await rowValue(
        transaction,
        "roles",
        roleId,
        installationId,
        workspaceId,
        "id, installation_id, workspace_id, name, version, skill_markdown, content_sha256, created_by_person_id",
      ),
      {
        id: roleId,
        installation_id: installationId,
        workspace_id: workspaceId,
        name: role.name,
        version: role.version,
        skill_markdown: role.skillMarkdown,
        content_sha256: role.contentSha256,
        created_by_person_id: personId,
      },
    );
    const assignmentId = deterministicUuid(
      `${installationId}:${workspaceId}`,
      `assignment:${workerId}:${roleId}`,
    );
    await transaction.query(
      `insert into public.worker_role_assignments
         (id, installation_id, workspace_id, worker_id, role_id,
          assigned_by_person_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [assignmentId, installationId, workspaceId, workerId, roleId, personId],
    );
    assertExact(
      `${role.name} assignment`,
      await rowValue(
        transaction,
        "worker_role_assignments",
        assignmentId,
        installationId,
        workspaceId,
        "id, installation_id, workspace_id, worker_id, role_id, assigned_by_person_id",
      ),
      {
        id: assignmentId,
        installation_id: installationId,
        workspace_id: workspaceId,
        worker_id: workerId,
        role_id: roleId,
        assigned_by_person_id: personId,
      },
    );
  }

  async #installPolicyAndGrants(
    transaction: SqlExecutor,
    installationId: string,
    workspaceId: string,
    workId: string,
    personId: string,
    workerId: string,
  ): Promise<void> {
    const policyId = deterministicUuid(
      `${installationId}:${workspaceId}`,
      "policy:v1",
    );
    const definition = {
      protocol: executiveCouncilProtocol,
      authority: "none",
      effect: "recommendation-only",
      externalEffects: false,
      mayDecide: false,
      mayApprove: false,
      mayCreateWork: false,
      mayInvokeTools: false,
      capabilities: [
        { capability: "executive.propose", mode: "recommend" },
        { capability: "executive.review", mode: "recommend" },
      ],
    };
    const encoded = JSON.stringify(canonical(definition));
    const contentSha256 = createHash("sha256").update(encoded).digest("hex");
    await transaction.query(
      `insert into public.policies
         (id, installation_id, workspace_id, name, version, definition,
          content_sha256, created_by_person_id)
       values ($1, $2, $3, 'Executive council recommendation only', 1,
               $4::jsonb, $5, $6)
       on conflict do nothing`,
      [policyId, installationId, workspaceId, encoded, contentSha256, personId],
    );
    assertExact(
      "Executive council policy",
      await rowValue(
        transaction,
        "policies",
        policyId,
        installationId,
        workspaceId,
        "id, installation_id, workspace_id, name, version, definition, content_sha256, created_by_person_id",
      ),
      {
        id: policyId,
        installation_id: installationId,
        workspace_id: workspaceId,
        name: "Executive council recommendation only",
        version: 1,
        definition,
        content_sha256: contentSha256,
        created_by_person_id: personId,
      },
    );
    for (const capability of ["executive.propose", "executive.review"]) {
      const grantId = deterministicUuid(
        `${installationId}:${workspaceId}:${workId}`,
        `grant:${capability}`,
      );
      await transaction.query(
        `insert into public.capability_grants
           (id, installation_id, workspace_id, policy_id, principal_kind,
            worker_id, capability, mode, work_id, granted_by_person_id)
         values ($1, $2, $3, $4, 'worker', $5, $6, 'recommend', $7, $8)
         on conflict do nothing`,
        [
          grantId,
          installationId,
          workspaceId,
          policyId,
          workerId,
          capability,
          workId,
          personId,
        ],
      );
      assertExact(
        `${capability} grant`,
        await rowValue(
          transaction,
          "capability_grants",
          grantId,
          installationId,
          workspaceId,
          `id, installation_id, workspace_id, policy_id, principal_kind, person_id, worker_id,
           capability, mode, work_id, expires_at, granted_by_person_id`,
        ),
        {
          id: grantId,
          installation_id: installationId,
          workspace_id: workspaceId,
          policy_id: policyId,
          principal_kind: "worker",
          person_id: null,
          worker_id: workerId,
          capability,
          mode: "recommend",
          work_id: workId,
          expires_at: null,
          granted_by_person_id: personId,
        },
      );
      const revocation = await transaction.query<{ revoked: boolean }>(
        `select exists(
           select 1 from public.capability_grant_revocations
            where installation_id = $1 and workspace_id = $2 and grant_id = $3
         ) as revoked`,
        [installationId, workspaceId, grantId],
      );
      if (revocation.rows[0]?.revoked) {
        throw new ExecutiveCouncilConflictError(
          `${capability} grant was revoked; installer replay never restores authority`,
        );
      }
    }
  }

  #objective(
    phase: "proposal" | "review" | "synthesis",
    work: CouncilWorkSnapshot,
    roleName: string,
  ): string {
    const agenda = `Agenda: ${work.title}. Requested outcome: ${work.requestedOutcome}`;
    if (phase === "proposal") {
      return `${agenda}. Independently produce the ${roleName} recommendation from the frozen authoritative evidence.`;
    }
    if (phase === "review") {
      return `${agenda}. Cross-review the four other-role proposals. Explicitly preserve agreement, disagreement, and required revision.`;
    }
    return `${agenda}. Synthesize all five proposals and five cross-reviews without erasing dissent. Explicitly preserve agreement, disagreement, and required revision.`;
  }

  #assertJob(
    request: ExecutiveWorkerJobRequest,
    job: ExecutiveWorkerJob,
  ): void {
    if (
      job.installationId !== request.installationId ||
      job.workspaceId !== request.workspaceId ||
      job.workId !== request.workId ||
      job.workerId !== request.workerId ||
      job.provider !== this.worker.provider ||
      job.model !== this.worker.model ||
      job.background ||
      job.store
    ) {
      throw new ExecutiveCouncilConflictError(
        "Council worker job crossed its provider, installation, Work, worker, or storage boundary",
      );
    }
  }

  async #persistRunOnly(
    request: ExecutiveWorkerJobRequest,
    job: ExecutiveWorkerJob,
    reservation: CouncilAttemptReservation,
  ): Promise<void> {
    await this.database.asWorker(
      {
        installationId: request.installationId,
        workspaceId: request.workspaceId,
        workerId: request.workerId,
      },
      async (transaction) => {
        await this.#finalizeRun(transaction, request, reservation, job);
      },
    );
  }

  async #persistContribution(
    request: ExecutiveWorkerJobRequest,
    job: ExecutiveWorkerJob,
    reservation: CouncilAttemptReservation,
  ): Promise<void> {
    const council = request.council;
    if (!council || !job.recommendation) {
      throw new ExecutiveCouncilConflictError(
        "Council contribution is missing its protocol or recommendation",
      );
    }
    const evidenceRecordIds = request.evidence.map(
      (evidence) => evidence.recordId,
    );
    const peerRecordIds = council.peerContext.map((peer) => peer.recordId);
    const kind = council.phase === "review" ? "review" : "proposal";
    await this.database.asWorker(
      {
        installationId: request.installationId,
        workspaceId: request.workspaceId,
        workerId: request.workerId,
      },
      async (transaction) => {
        await this.#finalizeRun(transaction, request, reservation, job);
        await transaction.query(
          `insert into public.records
             (installation_id, workspace_id, work_id, kind, summary, payload,
              classification, actor_worker_id)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            request.installationId,
            request.workspaceId,
            request.workId,
            kind,
            job.recommendation!.summary,
            JSON.stringify({
              installationId: request.installationId,
              workspaceId: request.workspaceId,
              councilProtocol: council.protocol,
              councilPhase: council.phase,
              councilRoleId: council.roleId,
              councilRoleName: request.role.name,
              inputRecordIds: council.inputRecordIds,
              evidenceRecordIds,
              peerRecordIds,
              workUpdatedAt: council.workUpdatedAt,
              workInputSha256: council.workInputSha256,
              authority: "none",
              providerJob: {
                id: job.jobId,
                provider: job.provider,
                model: job.model,
                store: job.store,
                background: job.background,
              },
              recommendation: job.recommendation,
            }),
            strongestClassification(request.evidence),
            request.workerId,
          ],
        );
      },
    );
  }

  async #reserveAttempt(
    request: ExecutiveWorkerJobRequest,
  ): Promise<CouncilAttemptReservation | null> {
    try {
      return await this.database.asWorker(
        {
          installationId: request.installationId,
          workspaceId: request.workspaceId,
          workerId: request.workerId,
        },
        async (transaction) => {
          await transaction.query(
            `update public.worker_runs
                set status = 'failed',
                    error = 'Council attempt lease expired before completion'
              where installation_id = $1 and workspace_id = $2
                and work_id = $3 and worker_id = $4
                and metadata ->> 'council_protocol' = $5
                and metadata ->> 'council_phase' = $6
                and metadata ->> 'council_role_id' = $7
                and status in ('queued', 'in_progress')
                and updated_at < now() - interval '35 minutes'`,
            [
              request.installationId,
              request.workspaceId,
              request.workId,
              request.workerId,
              request.council!.protocol,
              request.council!.phase,
              request.council!.roleId,
            ],
          );
          const result = await transaction.query<{ id: string }>(
            `insert into public.worker_runs
               (installation_id, workspace_id, work_id, worker_id, role_id,
                provider, model, provider_job_id, status, store, background,
                metadata, error)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 'in_progress', false,
                     false, $9::jsonb, null)
             returning id`,
            [
              request.installationId,
              request.workspaceId,
              request.workId,
              request.workerId,
              request.role.roleId,
              this.worker.provider,
              this.worker.model,
              `vorton-council-attempt-${randomUUID()}`,
              JSON.stringify(this.#runMetadata(request)),
            ],
          );
          const id = result.rows[0]?.id;
          if (!id) {
            throw new ExecutiveCouncilConflictError(
              "Council attempt reservation was not recorded",
            );
          }
          return { id };
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async #failReservation(
    request: ExecutiveWorkerJobRequest,
    reservation: CouncilAttemptReservation,
    error: string,
  ): Promise<void> {
    await this.database.asWorker(
      {
        installationId: request.installationId,
        workspaceId: request.workspaceId,
        workerId: request.workerId,
      },
      async (transaction) => {
        const result = await transaction.query(
          `update public.worker_runs
              set status = 'failed', error = $2
            where id = $1 and installation_id = $3 and workspace_id = $4
              and status in ('queued', 'in_progress')
            returning id`,
          [reservation.id, error, request.installationId, request.workspaceId],
        );
        if (result.rowCount !== 1) {
          throw new ExecutiveCouncilConflictError(
            "Council attempt reservation could not be failed safely",
          );
        }
      },
    );
  }

  async #finalizeRun(
    transaction: SqlExecutor,
    request: ExecutiveWorkerJobRequest,
    reservation: CouncilAttemptReservation,
    job: ExecutiveWorkerJob,
  ): Promise<void> {
    const result = await transaction.query(
      `update public.worker_runs
          set provider_job_id = $2, status = $3, error = $4
        where id = $1 and installation_id = $5 and workspace_id = $6
          and status in ('queued', 'in_progress')
        returning id`,
      [
        reservation.id,
        job.jobId,
        job.status,
        job.error ?? null,
        request.installationId,
        request.workspaceId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new ExecutiveCouncilConflictError(
        "Council attempt reservation could not be finalized safely",
      );
    }
  }

  #runMetadata(request: ExecutiveWorkerJobRequest): Record<string, unknown> {
    return {
      installation_id: request.installationId,
      workspace_id: request.workspaceId,
      work_id: request.workId,
      worker_id: request.workerId,
      role_sha256: request.role.contentSha256,
      role_version: String(request.role.version),
      council_protocol: request.council?.protocol,
      council_phase: request.council?.phase,
      council_role_id: request.council?.roleId,
      input_record_ids: request.council?.inputRecordIds,
      work_updated_at: request.council?.workUpdatedAt,
      work_input_sha256: request.council?.workInputSha256,
      authority: request.council ? "none" : undefined,
    };
  }
}

function strongestClassification(
  evidence: ExecutiveWorkerJobRequest["evidence"],
): ExecutiveEvidence["classification"] {
  return deriveDataClassification(evidence.map((item) => item.classification));
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505",
  );
}
