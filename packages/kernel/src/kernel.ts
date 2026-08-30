import { createHash, randomBytes } from "node:crypto";

import {
  capabilityGrantInputSchema,
  recordInputSchema,
  workerAdvertisementSchema,
  workInputSchema,
  type CapabilityGrantInput,
  type DataClassification,
  type RecordInput,
  type WorkerAdvertisement,
  type WorkInput,
} from "@vorton/contracts";
import {
  Database,
  type PersonContext,
  type SqlExecutor,
  type WorkerContext,
} from "@vorton/database";

export type { PersonContext, WorkerContext } from "@vorton/database";

export interface KernelDependencies {
  now?: () => Date;
  randomToken?: () => string;
}

export interface IssuedWorkerCredential {
  credentialId: string;
  token: string;
  tokenHint: string;
  expiresAt: string;
}

export interface AuthenticatedWorkerCredential extends WorkerContext {
  expiresAt: string;
}

interface IdRow {
  id: string;
}

export interface PersonRow extends IdRow {
  installation_id: string;
  auth_user_id: string;
  display_name: string;
  kind: "owner" | "member";
  created_at: Date;
}

export interface WorkerRow extends IdRow {
  installation_id: string;
  name: string;
  provider: string;
  billing_realm: string;
  host: string;
  runtime: string;
  model: string;
  advertised_capabilities: string[];
  data_classification_ceiling: DataClassification;
  isolation: string;
  network_policy: string;
  health: "healthy" | "degraded" | "offline";
  last_seen_at: Date | null;
  created_at: Date;
}

export interface RoleRow extends IdRow {
  installation_id: string;
  name: string;
  version: number;
  skill_markdown: string;
  content_sha256: string;
  created_by_person_id: string;
  created_at: Date;
}

export interface WorkRow extends IdRow {
  installation_id: string;
  title: string;
  requested_outcome: string;
  acceptance_criteria: string[];
  state: string;
  priority: number;
  parent_work_id: string | null;
  requested_by_person_id: string | null;
  custodian_person_id: string | null;
  custodian_worker_id: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PolicyRow extends IdRow {
  installation_id: string;
  name: string;
  version: number;
  definition: Record<string, unknown>;
  content_sha256: string;
  created_by_person_id: string;
  created_at: Date;
}

export interface RecordRow extends IdRow {
  installation_id: string;
  work_id: string | null;
  kind: RecordInput["kind"];
  summary: string;
  payload: Record<string, unknown>;
  source_uri: string | null;
  classification: DataClassification;
  actor_person_id: string | null;
  actor_worker_id: string | null;
  supersedes_record_id: string | null;
  created_at: Date;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${label} must be a UUID`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function requireOwner(
  transaction: SqlExecutor,
  context: PersonContext,
): Promise<PersonRow> {
  const result = await transaction.query<PersonRow>(
    `select id, installation_id, auth_user_id, display_name, kind, created_at
       from public.people
      where installation_id = $1 and auth_user_id = $2 and kind = 'owner'`,
    [context.installationId, context.authUserId],
  );
  const person = result.rows[0];
  if (!person) throw new Error("Owner authority is required");
  return person;
}

export class PeopleService {
  constructor(private readonly database: Database) {}

  provision(
    actor: PersonContext,
    authUserId: string,
    displayName: string,
    kind: "owner" | "member" = "member",
  ): Promise<string> {
    requireUuid(authUserId, "authUserId");
    if (!displayName.trim()) throw new Error("displayName is required");
    return this.database.asAdministrator(async (transaction) => {
      await requireOwner(transaction, actor);
      const result = await transaction.query<IdRow>(
        "select id from public.provision_person($1, $2, $3, $4)",
        [actor.installationId, authUserId, displayName, kind],
      );
      const person = result.rows[0];
      if (!person) throw new Error("Person provisioning failed");
      return person.id;
    });
  }

  list(context: PersonContext): Promise<PersonRow[]> {
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<PersonRow>(
        `select id, installation_id, auth_user_id, display_name, kind, created_at
           from public.people
          where installation_id = $1
          order by created_at, id`,
        [context.installationId],
      );
      return result.rows;
    });
  }

  current(context: PersonContext): Promise<PersonRow> {
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<PersonRow>(
        `select id, installation_id, auth_user_id, display_name, kind, created_at
           from public.people
          where installation_id = $1 and auth_user_id = $2`,
        [context.installationId, context.authUserId],
      );
      const person = result.rows[0];
      if (!person)
        throw new Error(
          "Authenticated user is not a member of this installation",
        );
      return person;
    });
  }
}

export class WorkersService {
  readonly #now: () => Date;
  readonly #randomToken: () => string;

  constructor(
    private readonly database: Database,
    dependencies: KernelDependencies = {},
  ) {
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomToken =
      dependencies.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  list(context: PersonContext): Promise<WorkerRow[]> {
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<WorkerRow>(
        `select id, installation_id, name, provider, billing_realm, host, runtime, model,
                advertised_capabilities, data_classification_ceiling, isolation,
                network_policy, health, last_seen_at, created_at
           from public.workers
          where installation_id = $1
          order by name, id`,
        [context.installationId],
      );
      return result.rows;
    });
  }

  register(
    actor: PersonContext,
    input: {
      name: string;
      provider: string;
      billingRealm: string;
      host: string;
      runtime: string;
      model: string;
      dataClassificationCeiling: DataClassification;
      isolation: string;
      networkPolicy: string;
    },
  ): Promise<string> {
    if (Object.values(input).some((value) => !value.trim())) {
      throw new Error("Worker registration fields cannot be blank");
    }
    return this.database.asAdministrator(async (transaction) => {
      const person = await requireOwner(transaction, actor);
      const result = await transaction.query<IdRow>(
        `insert into public.workers
          (installation_id, name, provider, billing_realm, host, runtime, model,
           data_classification_ceiling, isolation, network_policy)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [
          actor.installationId,
          input.name,
          input.provider,
          input.billingRealm,
          input.host,
          input.runtime,
          input.model,
          input.dataClassificationCeiling,
          input.isolation,
          input.networkPolicy,
        ],
      );
      const worker = result.rows[0];
      if (!worker) throw new Error("Worker registration failed");
      await transaction.query(
        `insert into public.records
          (installation_id, kind, summary, payload, classification, actor_person_id)
         values ($1, 'decision', 'Worker registered', $2::jsonb, 'internal', $3)`,
        [
          actor.installationId,
          JSON.stringify({ workerId: worker.id, name: input.name }),
          person.id,
        ],
      );
      return worker.id;
    });
  }

  advertise(context: WorkerContext, input: WorkerAdvertisement): Promise<void> {
    const advertisement = workerAdvertisementSchema.parse(input);
    if (
      advertisement.workerId !== context.workerId ||
      advertisement.installationId !== context.installationId
    ) {
      throw new Error(
        "Worker advertisement cannot cross its credential boundary",
      );
    }
    return this.database.asWorker(context, async (transaction) => {
      await transaction.query(
        `update public.workers
            set provider = $3, billing_realm = $4, host = $5, runtime = $6,
                model = $7, advertised_capabilities = $8,
                data_classification_ceiling = $9, isolation = $10,
                network_policy = $11, health = $12, last_seen_at = now()
          where installation_id = $1 and id = $2`,
        [
          context.installationId,
          context.workerId,
          advertisement.provider,
          advertisement.billingRealm,
          advertisement.host,
          advertisement.runtime,
          advertisement.model,
          advertisement.capabilities,
          advertisement.dataClassificationCeiling,
          advertisement.isolation,
          advertisement.networkPolicy,
          advertisement.health,
        ],
      );
    });
  }

  async issueCredential(
    actor: PersonContext,
    workerId: string,
    lifetimeSeconds = 300,
  ): Promise<IssuedWorkerCredential> {
    requireUuid(workerId, "workerId");
    if (
      !Number.isInteger(lifetimeSeconds) ||
      lifetimeSeconds < 1 ||
      lifetimeSeconds > 900
    ) {
      throw new Error("Worker credentials must live between 1 and 900 seconds");
    }
    const issuedAt = this.#now();
    const expiresAt = new Date(issuedAt.getTime() + lifetimeSeconds * 1_000);
    const token = this.#randomToken();
    if (token.length < 32)
      throw new Error("Worker credential entropy is insufficient");
    const tokenHash = sha256(token);
    const tokenHint = token.slice(-8);

    return await this.database.asAdministrator(async (transaction) => {
      const person = await requireOwner(transaction, actor);
      const result = await transaction.query<IdRow>(
        `insert into public.worker_credentials
          (installation_id, worker_id, token_hash, token_hint, issued_at, expires_at, issued_by_person_id)
         values ($1, $2, decode($3, 'hex'), $4, $5, $6, $7)
         returning id`,
        [
          actor.installationId,
          workerId,
          tokenHash,
          tokenHint,
          issuedAt.toISOString(),
          expiresAt.toISOString(),
          person.id,
        ],
      );
      const credential = result.rows[0];
      if (!credential) throw new Error("Credential issuance failed");
      await transaction.query(
        `insert into public.records
          (installation_id, kind, summary, payload, classification, actor_person_id)
         values ($1, 'receipt', 'Worker credential issued', $2::jsonb, 'internal', $3)`,
        [
          actor.installationId,
          JSON.stringify({
            credentialId: credential.id,
            workerId,
            expiresAt: expiresAt.toISOString(),
          }),
          person.id,
        ],
      );
      return {
        credentialId: credential.id,
        token,
        tokenHint,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  authenticateCredential(
    token: string,
  ): Promise<AuthenticatedWorkerCredential | null> {
    if (token.length < 32) return Promise.resolve(null);
    return this.database.asAdministrator(async (transaction) => {
      const result = await transaction.query<{
        id: string;
        installation_id: string;
        worker_id: string;
        expires_at: Date;
      }>(
        `select credential.id, credential.installation_id, credential.worker_id, credential.expires_at
           from public.worker_credentials credential
          where credential.token_hash = decode($1, 'hex')
            and credential.expires_at > now()
            and not exists (
              select 1 from public.worker_credential_revocations revocation
              where revocation.credential_id = credential.id
            )`,
        [sha256(token)],
      );
      const row = result.rows[0];
      return row
        ? {
            credentialId: row.id,
            installationId: row.installation_id,
            workerId: row.worker_id,
            expiresAt: row.expires_at.toISOString(),
          }
        : null;
    });
  }

  revokeCredential(
    actor: PersonContext,
    credentialId: string,
    reason: string,
  ): Promise<void> {
    requireUuid(credentialId, "credentialId");
    if (!reason.trim())
      throw new Error("Credential revocation requires a reason");
    return this.database.asAdministrator(async (transaction) => {
      const person = await requireOwner(transaction, actor);
      await transaction.query(
        `insert into public.worker_credential_revocations
          (installation_id, credential_id, revoked_by_person_id, reason)
         values ($1, $2, $3, $4)`,
        [actor.installationId, credentialId, person.id, reason],
      );
      await transaction.query(
        `insert into public.records
          (installation_id, kind, summary, payload, classification, actor_person_id)
         values ($1, 'decision', 'Worker credential revoked', $2::jsonb, 'internal', $3)`,
        [
          actor.installationId,
          JSON.stringify({ credentialId, reason }),
          person.id,
        ],
      );
    });
  }
}

export class RolesService {
  constructor(private readonly database: Database) {}

  list(context: PersonContext): Promise<RoleRow[]> {
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<RoleRow>(
        `select id, installation_id, name, version, skill_markdown, content_sha256,
                created_by_person_id, created_at
           from public.roles
          where installation_id = $1
          order by name, version desc`,
        [context.installationId],
      );
      return result.rows;
    });
  }

  createVersion(
    context: PersonContext,
    input: { name: string; version: number; skillMarkdown: string },
  ): Promise<string> {
    if (
      !input.name.trim() ||
      !input.skillMarkdown.trim() ||
      input.version < 1
    ) {
      throw new Error(
        "Role name, positive version, and SKILL.md content are required",
      );
    }
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<IdRow>(
        `insert into public.roles
          (installation_id, name, version, skill_markdown, content_sha256, created_by_person_id)
         values ($1, $2, $3, $4, $5, public.current_person_id($1))
         returning id`,
        [
          context.installationId,
          input.name,
          input.version,
          input.skillMarkdown,
          sha256(input.skillMarkdown),
        ],
      );
      const role = result.rows[0];
      if (!role) throw new Error("Role creation failed");
      return role.id;
    });
  }

  assign(
    context: PersonContext,
    workerId: string,
    roleId: string,
  ): Promise<string> {
    requireUuid(workerId, "workerId");
    requireUuid(roleId, "roleId");
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<IdRow>(
        `insert into public.worker_role_assignments
          (installation_id, worker_id, role_id, assigned_by_person_id)
         values ($1, $2, $3, public.current_person_id($1)) returning id`,
        [context.installationId, workerId, roleId],
      );
      const assignment = result.rows[0];
      if (!assignment) throw new Error("Role assignment failed");
      return assignment.id;
    });
  }
}

export class WorkService {
  constructor(private readonly database: Database) {}

  list(context: PersonContext): Promise<WorkRow[]> {
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<WorkRow>(
        `select id, installation_id, title, requested_outcome, acceptance_criteria,
                state, priority, parent_work_id, requested_by_person_id,
                custodian_person_id, custodian_worker_id, lease_expires_at,
                created_at, updated_at
           from public.work
          where installation_id = $1
          order by priority desc, created_at, id`,
        [context.installationId],
      );
      return result.rows;
    });
  }

  create(context: PersonContext, input: WorkInput): Promise<string> {
    const work = workInputSchema.parse(input);
    if (work.installationId !== context.installationId) {
      throw new Error(
        "Work cannot cross the authenticated installation boundary",
      );
    }
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<IdRow>(
        `insert into public.work
          (installation_id, title, requested_outcome, acceptance_criteria, parent_work_id,
           priority, requested_by_person_id)
         values ($1, $2, $3, $4::jsonb, $5, $6, public.current_person_id($1)) returning id`,
        [
          work.installationId,
          work.title,
          work.requestedOutcome,
          JSON.stringify(work.acceptanceCriteria),
          work.parentWorkId,
          work.priority,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Work creation failed");
      return row.id;
    });
  }

  lease(
    context: PersonContext,
    workId: string,
    workerId: string,
    expiresAt: Date,
  ): Promise<void> {
    requireUuid(workId, "workId");
    requireUuid(workerId, "workerId");
    if (expiresAt <= new Date())
      throw new Error("Work leases must expire in the future");
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query(
        `update public.work
            set state = 'leased', custodian_worker_id = $3,
                custodian_person_id = null, lease_expires_at = $4
          where installation_id = $1 and id = $2 and state in ('ready', 'review')`,
        [context.installationId, workId, workerId, expiresAt.toISOString()],
      );
      if (result.rowCount !== 1)
        throw new Error("Work is not available to lease");
    });
  }

  transitionAsWorker(
    context: WorkerContext,
    workId: string,
    state: "ready" | "blocked" | "review" | "cancelled",
  ): Promise<void> {
    requireUuid(workId, "workId");
    return this.database.asWorker(context, async (transaction) => {
      await transaction.query("select public.worker_transition_work($1, $2)", [
        workId,
        state,
      ]);
    });
  }
}

export class PolicyService {
  constructor(private readonly database: Database) {}

  list(context: PersonContext): Promise<PolicyRow[]> {
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<PolicyRow>(
        `select id, installation_id, name, version, definition, content_sha256,
                created_by_person_id, created_at
           from public.policies
          where installation_id = $1
          order by name, version desc`,
        [context.installationId],
      );
      return result.rows;
    });
  }

  createVersion(
    context: PersonContext,
    input: {
      name: string;
      version: number;
      definition: Record<string, unknown>;
    },
  ): Promise<string> {
    const encoded = canonicalJson(input.definition);
    if (!input.name.trim() || input.version < 1)
      throw new Error("Policy name and positive version are required");
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<IdRow>(
        `insert into public.policies
          (installation_id, name, version, definition, content_sha256, created_by_person_id)
         values ($1, $2, $3, $4::jsonb, $5, public.current_person_id($1)) returning id`,
        [
          context.installationId,
          input.name,
          input.version,
          encoded,
          sha256(encoded),
        ],
      );
      const policy = result.rows[0];
      if (!policy) throw new Error("Policy creation failed");
      return policy.id;
    });
  }

  async grant(
    context: PersonContext,
    input: CapabilityGrantInput,
  ): Promise<string> {
    const grant = capabilityGrantInputSchema.parse(input);
    if (grant.installationId !== context.installationId) {
      throw new Error("A capability grant cannot cross installations");
    }
    return await this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<IdRow>(
        `insert into public.capability_grants
          (installation_id, policy_id, principal_kind, person_id, worker_id, capability,
           mode, work_id, expires_at, granted_by_person_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, public.current_person_id($1)) returning id`,
        [
          grant.installationId,
          grant.policyId,
          grant.principalKind,
          grant.principalKind === "person" ? grant.principalId : null,
          grant.principalKind === "worker" ? grant.principalId : null,
          grant.capability,
          grant.mode,
          grant.workId,
          grant.expiresAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Capability grant failed");
      await transaction.query(
        `insert into public.records
          (installation_id, work_id, kind, summary, payload, classification, actor_person_id)
         values ($1, $2, 'approval', 'Capability granted', $3::jsonb, 'internal',
                 public.current_person_id($1))`,
        [
          grant.installationId,
          grant.workId,
          JSON.stringify({
            grantId: row.id,
            policyId: grant.policyId,
            principalKind: grant.principalKind,
            principalId: grant.principalId,
            capability: grant.capability,
            mode: grant.mode,
            expiresAt: grant.expiresAt,
          }),
        ],
      );
      return row.id;
    });
  }

  revoke(
    context: PersonContext,
    grantId: string,
    reason: string,
  ): Promise<void> {
    requireUuid(grantId, "grantId");
    if (!reason.trim()) throw new Error("Grant revocation requires a reason");
    return this.database.asPerson(context, async (transaction) => {
      await transaction.query(
        `insert into public.capability_grant_revocations
          (installation_id, grant_id, revoked_by_person_id, reason)
         values ($1, $2, public.current_person_id($1), $3)`,
        [context.installationId, grantId, reason],
      );
      await transaction.query(
        `insert into public.records
          (installation_id, kind, summary, payload, classification, actor_person_id)
         values ($1, 'decision', 'Capability grant revoked', $2::jsonb, 'internal',
                 public.current_person_id($1))`,
        [context.installationId, JSON.stringify({ grantId, reason })],
      );
    });
  }
}

export class RecordsService {
  constructor(private readonly database: Database) {}

  listForWork(context: PersonContext, workId: string): Promise<RecordRow[]> {
    requireUuid(workId, "workId");
    return this.database.asPerson(context, async (transaction) => {
      const result = await transaction.query<RecordRow>(
        `select id, installation_id, work_id, kind, summary, payload, source_uri,
                classification, actor_person_id, actor_worker_id,
                supersedes_record_id, created_at
           from public.records
          where installation_id = $1 and work_id = $2
          order by created_at, id`,
        [context.installationId, workId],
      );
      return result.rows;
    });
  }

  appendAsPerson(context: PersonContext, input: RecordInput): Promise<string> {
    const record = recordInputSchema.parse(input);
    if (record.installationId !== context.installationId)
      throw new Error("Record boundary mismatch");
    return this.database.asPerson(context, (transaction) =>
      this.#append(transaction, record, "public.current_person_id($1)", null),
    );
  }

  appendAsWorker(context: WorkerContext, input: RecordInput): Promise<string> {
    const record = recordInputSchema.parse(input);
    if (record.installationId !== context.installationId)
      throw new Error("Record boundary mismatch");
    return this.database.asWorker(context, (transaction) =>
      this.#append(transaction, record, null, "public.current_worker_id()"),
    );
  }

  async #append(
    transaction: SqlExecutor,
    record: RecordInput,
    personExpression: string | null,
    workerExpression: string | null,
  ): Promise<string> {
    const result = await transaction.query<IdRow>(
      `insert into public.records
        (installation_id, work_id, kind, summary, payload, source_uri, classification,
         supersedes_record_id, actor_person_id, actor_worker_id)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8,
         ${personExpression ?? "null"}, ${workerExpression ?? "null"}) returning id`,
      [
        record.installationId,
        record.workId,
        record.kind,
        record.summary,
        JSON.stringify(record.payload),
        record.sourceUri,
        record.classification,
        record.supersedesRecordId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Record append failed");
    return row.id;
  }
}

export class Kernel {
  readonly people: PeopleService;
  readonly workers: WorkersService;
  readonly roles: RolesService;
  readonly work: WorkService;
  readonly policy: PolicyService;
  readonly records: RecordsService;

  constructor(database: Database, dependencies: KernelDependencies = {}) {
    this.people = new PeopleService(database);
    this.workers = new WorkersService(database, dependencies);
    this.roles = new RolesService(database);
    this.work = new WorkService(database);
    this.policy = new PolicyService(database);
    this.records = new RecordsService(database);
  }
}
