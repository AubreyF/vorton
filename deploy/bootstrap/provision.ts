import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

const classifications = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "synthetic",
] as const;
type Classification = (typeof classifications)[number];

const defaultRoleSkillPath = resolve(
  __dirname,
  "../../packages/executive/roles/strategic-reviewer/SKILL.md",
);

const runtimeRoles = ["authenticated", "aubos_worker"] as const;

export interface BootstrapConfig {
  authUserId: string;
  installationSlug: string;
  installationName: string;
  ownerDisplayName: string;
  workerName: string;
  provider: "openai-responses" | "codex-subscription";
  billingRealm: "organization" | "owner-delegated";
  model: string;
  classificationCeiling: Classification;
  evidenceClassification: Classification;
  runtimeRole: string;
  roleName: string;
  roleVersion: number;
  roleSkillMarkdown: string;
  workTitle: string;
  requestedOutcome: string;
  evidenceSummary: string;
}

export interface BootstrapSecrets {
  administratorDatabaseUrl: string;
  administratorDatabaseSsl: boolean;
  runtimeDatabasePassword: string;
  runtimeContextSigningSecret: string;
}

interface SqlClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

interface Identifiers {
  installationId: string;
  personId: string;
  workerId: string;
  roleId: string;
  workId: string;
  policyId: string;
  grantId: string;
  evidenceId: string;
}

interface ExistingRow extends QueryResultRow {
  value: Record<string, unknown>;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  return env[name]?.trim() || fallback;
}

function exactBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

function exactClassification(value: string, name: string): Classification {
  if (!classifications.includes(value as Classification)) {
    throw new Error(`${name} must be a valid AubOS data classification`);
  }
  return value as Classification;
}

function classificationAllows(
  ceiling: Classification,
  classification: Classification,
): boolean {
  if (ceiling === "synthetic")
    return classification === "public" || classification === "synthetic";
  if (classification === "synthetic") return true;
  return (
    classifications.indexOf(classification) <= classifications.indexOf(ceiling)
  );
}

function uuid(value: string, name: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${name} must be a UUID`);
  }
  return value.toLowerCase();
}

function slug(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(
      "AUBOS_BOOTSTRAP_INSTALLATION_SLUG must start with a letter and contain lowercase letters, digits, or hyphens",
    );
  }
  return value;
}

function roleIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) {
    throw new Error(
      "AUBOS_BOOTSTRAP_RUNTIME_ROLE must be a lowercase PostgreSQL identifier between 3 and 63 characters",
    );
  }
  return value;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(slugValue: string, kind: string): string {
  const bytes = Buffer.from(
    sha256(`aubos-bootstrap-v1:${slugValue}:${kind}`),
    "hex",
  ).subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function identifiersFor(slugValue: string): Identifiers {
  return {
    installationId: deterministicUuid(slugValue, "installation"),
    personId: deterministicUuid(slugValue, "owner"),
    workerId: deterministicUuid(slugValue, "executive-worker"),
    roleId: deterministicUuid(slugValue, "strategic-reviewer-role-v1"),
    workId: deterministicUuid(slugValue, "first-executive-work"),
    policyId: deterministicUuid(slugValue, "executive-recommend-policy-v1"),
    grantId: deterministicUuid(slugValue, "executive-recommend-grant-v1"),
    evidenceId: deterministicUuid(slugValue, "first-executive-evidence"),
  };
}

export async function readBootstrapConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BootstrapConfig> {
  const provider = required(env, "AUBOS_WORKER_PROVIDER");
  if (provider !== "openai-responses" && provider !== "codex-subscription") {
    throw new Error(
      "AUBOS_WORKER_PROVIDER must be openai-responses or codex-subscription for the first installation",
    );
  }
  const model = required(env, "AUBOS_WORKER_MODEL");
  const providerModelName =
    provider === "openai-responses"
      ? "AUBOS_OPENAI_MODEL"
      : "AUBOS_CODEX_MODEL";
  if (model !== required(env, providerModelName)) {
    throw new Error(
      `AUBOS_WORKER_MODEL must exactly match ${providerModelName}`,
    );
  }
  const classificationCeiling = exactClassification(
    optional(env, "AUBOS_WORKER_CLASSIFICATION_CEILING", "internal"),
    "AUBOS_WORKER_CLASSIFICATION_CEILING",
  );
  const providerCeilingName =
    provider === "openai-responses"
      ? "AUBOS_OPENAI_CLASSIFICATION_CEILING"
      : "AUBOS_CODEX_CLASSIFICATION_CEILING";
  const providerCeiling = exactClassification(
    optional(env, providerCeilingName, "internal"),
    providerCeilingName,
  );
  if (classificationCeiling !== providerCeiling) {
    throw new Error(
      `AUBOS_WORKER_CLASSIFICATION_CEILING must exactly match ${providerCeilingName}`,
    );
  }
  if (provider === "codex-subscription") {
    const reasoningEffort = required(env, "AUBOS_CODEX_REASONING_EFFORT");
    if (
      !["low", "medium", "high", "xhigh", "max", "ultra"].includes(
        reasoningEffort,
      )
    ) {
      throw new Error(
        "AUBOS_CODEX_REASONING_EFFORT must be low, medium, high, xhigh, max, or ultra",
      );
    }
  }
  const evidenceClassification = exactClassification(
    optional(env, "AUBOS_BOOTSTRAP_EVIDENCE_CLASSIFICATION", "internal"),
    "AUBOS_BOOTSTRAP_EVIDENCE_CLASSIFICATION",
  );
  if (!classificationAllows(classificationCeiling, evidenceClassification)) {
    throw new Error(
      "Bootstrap evidence exceeds the configured worker classification ceiling",
    );
  }
  const roleSkillMarkdown = await readFile(
    env.AUBOS_BOOTSTRAP_ROLE_SKILL_PATH?.trim() || defaultRoleSkillPath,
    "utf8",
  );
  if (!roleSkillMarkdown.trim()) throw new Error("Role skill file is empty");
  return {
    authUserId: uuid(
      required(env, "AUBOS_BOOTSTRAP_AUTH_USER_ID"),
      "AUBOS_BOOTSTRAP_AUTH_USER_ID",
    ),
    installationSlug: slug(
      optional(env, "AUBOS_BOOTSTRAP_INSTALLATION_SLUG", "moonbase-lab"),
    ),
    installationName: optional(
      env,
      "AUBOS_BOOTSTRAP_INSTALLATION_NAME",
      "Moonbase Lab",
    ),
    ownerDisplayName: optional(
      env,
      "AUBOS_BOOTSTRAP_OWNER_DISPLAY_NAME",
      "Synthetic Owner",
    ),
    workerName: optional(
      env,
      "AUBOS_BOOTSTRAP_WORKER_NAME",
      "Executive Recommendation Worker",
    ),
    provider,
    billingRealm:
      provider === "codex-subscription" ? "owner-delegated" : "organization",
    model,
    classificationCeiling,
    evidenceClassification,
    runtimeRole: roleIdentifier(
      optional(env, "AUBOS_BOOTSTRAP_RUNTIME_ROLE", "aubos_runtime"),
    ),
    roleName: optional(env, "AUBOS_BOOTSTRAP_ROLE_NAME", "Strategic Reviewer"),
    roleVersion: positiveInteger(
      optional(env, "AUBOS_BOOTSTRAP_ROLE_VERSION", "1"),
      "AUBOS_BOOTSTRAP_ROLE_VERSION",
    ),
    roleSkillMarkdown,
    workTitle: optional(
      env,
      "AUBOS_BOOTSTRAP_WORK_TITLE",
      "Review organizational priorities",
    ),
    requestedOutcome: optional(
      env,
      "AUBOS_BOOTSTRAP_REQUESTED_OUTCOME",
      "Recommend the next bounded action using the supplied organizational evidence.",
    ),
    evidenceSummary: optional(
      env,
      "AUBOS_BOOTSTRAP_EVIDENCE_SUMMARY",
      "The synthetic installation is ready for its first executive review.",
    ),
  };
}

export function readBootstrapSecrets(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapSecrets {
  const administratorDatabaseUrl = required(
    env,
    "AUBOS_BOOTSTRAP_DATABASE_URL",
  );
  const parsed = new URL(administratorDatabaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("AUBOS_BOOTSTRAP_DATABASE_URL must be a PostgreSQL URL");
  }
  const runtimeDatabasePassword = required(
    env,
    "AUBOS_BOOTSTRAP_RUNTIME_DATABASE_PASSWORD",
  );
  if (runtimeDatabasePassword.length < 32) {
    throw new Error(
      "AUBOS_BOOTSTRAP_RUNTIME_DATABASE_PASSWORD must contain at least 32 characters",
    );
  }
  const runtimeContextSigningSecret = required(
    env,
    "AUBOS_BOOTSTRAP_CONTEXT_SIGNING_SECRET",
  );
  if (runtimeContextSigningSecret.length < 32) {
    throw new Error(
      "AUBOS_BOOTSTRAP_CONTEXT_SIGNING_SECRET must contain at least 32 characters",
    );
  }
  if (runtimeContextSigningSecret === runtimeDatabasePassword) {
    throw new Error(
      "AUBOS_BOOTSTRAP_CONTEXT_SIGNING_SECRET must differ from the runtime database password",
    );
  }
  return {
    administratorDatabaseUrl,
    administratorDatabaseSsl: exactBoolean(
      env,
      "AUBOS_BOOTSTRAP_DATABASE_SSL",
      true,
    ),
    runtimeDatabasePassword,
    runtimeContextSigningSecret,
  };
}

export function buildBootstrapPlan(
  config: BootstrapConfig,
): Record<string, unknown> {
  const ids = identifiersFor(config.installationSlug);
  return {
    schemaVersion: 1,
    operation: "bootstrap-organizational-installation",
    installation: {
      id: ids.installationId,
      slug: config.installationSlug,
      displayName: config.installationName,
      realm: "organizational",
    },
    authOwner: { authUserId: "[provided]", kind: "owner" },
    runtimeDatabaseRole: {
      name: config.runtimeRole,
      bypassRls: false,
      inherit: false,
      directTablePrivileges: [],
      maySetRoleTo: runtimeRoles,
      credential: "[provided through environment]",
      contextSigningSecret: "[provided separately through environment]",
    },
    executiveBinding: {
      workerId: ids.workerId,
      provider: config.provider,
      billingRealm: config.billingRealm,
      model: config.model,
      classificationCeiling: config.classificationCeiling,
      roleId: ids.roleId,
      workId: ids.workId,
      policyId: ids.policyId,
      grantId: ids.grantId,
      capability: "executive.propose",
      mode: "recommend",
      evidenceId: ids.evidenceId,
    },
    effects: "none",
  };
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
  if (!actual) throw new Error(`${label} was not provisioned`);
  if (
    JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))
  ) {
    throw new Error(
      `${label} already exists with conflicting authoritative data`,
    );
  }
}

async function rowValue(
  client: SqlClient,
  table: string,
  id: string,
  columns: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query<ExistingRow>(
    `select to_jsonb(selected) as value from (select ${columns} from public.${table} where id = $1) selected`,
    [id],
  );
  return result.rows[0]?.value;
}

export async function provisionRuntimeRole(
  client: SqlClient,
  role: string,
  password: string,
  contextSigningSecret: string,
): Promise<void> {
  const safeRole = roleIdentifier(role);
  const administrator = await client.query<{
    current_user: string;
    rolsuper: boolean;
    rolcreaterole: boolean;
    can_grant_authenticated: boolean;
    can_grant_worker: boolean;
    can_write_context_keys: boolean;
  }>(
    `select current_user, role.rolsuper, role.rolcreaterole,
            role.rolsuper or exists (
              select 1 from pg_auth_members membership
               where membership.roleid = (select oid from pg_roles where rolname = 'authenticated')
                 and membership.member = role.oid and membership.admin_option
            ) as can_grant_authenticated,
            role.rolsuper or exists (
              select 1 from pg_auth_members membership
               where membership.roleid = (select oid from pg_roles where rolname = 'aubos_worker')
                 and membership.member = role.oid and membership.admin_option
            ) as can_grant_worker,
            has_table_privilege(current_user, 'aubos_private.runtime_context_keys', 'INSERT')
              and has_table_privilege(current_user, 'aubos_private.runtime_context_keys', 'UPDATE')
              as can_write_context_keys
       from pg_roles role where role.rolname = current_user`,
  );
  const administratorRole = administrator.rows[0];
  if (
    !administratorRole ||
    administratorRole.current_user === safeRole ||
    (!administratorRole.rolsuper && !administratorRole.rolcreaterole) ||
    !administratorRole.can_grant_authenticated ||
    !administratorRole.can_grant_worker ||
    !administratorRole.can_write_context_keys
  ) {
    throw new Error(
      "Bootstrap requires a separate migration identity with CREATEROLE, admin option for authenticated and aubos_worker, and context-key write authority",
    );
  }
  const escaped = await client.query<{ identifier: string; password: string }>(
    "select quote_ident($1) as identifier, quote_literal($2) as password",
    [safeRole, password],
  );
  const identifier = escaped.rows[0]?.identifier;
  const passwordLiteral = escaped.rows[0]?.password;
  if (!identifier || !passwordLiteral) {
    throw new Error("Postgres did not quote the runtime database identity");
  }
  const existing = await client.query<{ exists: boolean }>(
    "select exists(select 1 from pg_roles where rolname = $1) as exists",
    [safeRole],
  );
  if (existing.rows[0]?.exists) {
    await client.query(
      `alter role ${identifier} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
  } else {
    await client.query(
      `create role ${identifier} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${passwordLiteral}`,
    );
  }
  await client.query(
    `revoke all on all tables in schema public from ${identifier}`,
  );
  await client.query(
    `revoke all on all sequences in schema public from ${identifier}`,
  );
  await client.query(`revoke all on schema public from ${identifier}`);
  await client.query(`grant usage on schema public to ${identifier}`);
  await client.query(`grant authenticated, aubos_worker to ${identifier}`);
  await client.query(
    `grant connect on database ${identifierForDatabase(await currentDatabase(client))} to ${identifier}`,
  );
  await client.query(
    `insert into aubos_private.runtime_context_keys (role_name, secret)
     values ($1, convert_to($2, 'UTF8')) on conflict (role_name) do nothing`,
    [safeRole, contextSigningSecret],
  );
  const contextKey = await client.query<{ matches: boolean }>(
    `select secret = convert_to($2, 'UTF8') as matches
       from aubos_private.runtime_context_keys where role_name = $1`,
    [safeRole, contextSigningSecret],
  );
  if (!contextKey.rows[0]?.matches) {
    throw new Error(
      "Runtime context key already exists and differs; bootstrap replay never rotates credentials",
    );
  }
  const verified = await client.query<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
    authenticatedMembership: boolean;
    workerMembership: boolean;
    unexpectedMembership: boolean;
    directTablePrivileges: boolean;
    ownsObjects: boolean;
  }>(
    `select role.rolcanlogin, role.rolinherit, role.rolsuper, role.rolcreatedb,
            role.rolcreaterole, role.rolreplication, role.rolbypassrls,
            pg_has_role(role.rolname, 'authenticated', 'MEMBER') as "authenticatedMembership",
            pg_has_role(role.rolname, 'aubos_worker', 'MEMBER') as "workerMembership",
            exists (
              select 1 from pg_auth_members membership
              join pg_roles granted on granted.oid = membership.roleid
              where membership.member = role.oid
                and granted.rolname not in ('authenticated', 'aubos_worker')
            ) as "unexpectedMembership",
            exists (
              select 1
                from pg_class object
                cross join lateral aclexplode(object.relacl) privilege
               where privilege.grantee = role.oid
            ) as "directTablePrivileges",
            exists (
              select 1 from pg_class object where object.relowner = role.oid
            ) as "ownsObjects"
       from pg_roles role where role.rolname = $1`,
    [safeRole],
  );
  const value = verified.rows[0];
  if (
    !value?.rolcanlogin ||
    value.rolinherit ||
    value.rolsuper ||
    value.rolcreatedb ||
    value.rolcreaterole ||
    value.rolreplication ||
    value.rolbypassrls ||
    !value.authenticatedMembership ||
    !value.workerMembership ||
    value.unexpectedMembership ||
    value.directTablePrivileges ||
    value.ownsObjects
  ) {
    throw new Error(
      "Runtime database role does not match the fail-closed contract",
    );
  }
}

async function currentDatabase(client: SqlClient): Promise<string> {
  const result = await client.query<{ name: string }>(
    "select current_database() as name",
  );
  const name = result.rows[0]?.name;
  if (!name) throw new Error("Postgres did not report the current database");
  return name;
}

function identifierForDatabase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function provisionInstallation(
  client: SqlClient,
  config: BootstrapConfig,
): Promise<Identifiers> {
  const ids = identifiersFor(config.installationSlug);
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `aubos-bootstrap:${config.installationSlug}`,
  ]);
  const schema = await client.query<{ applied: boolean }>(
    "select to_regclass('aubos_private.runtime_context_keys') is not null as applied",
  );
  if (!schema.rows[0]?.applied) {
    throw new Error(
      "AubOS migrations through 20260828000400_runtime_authority must be applied first",
    );
  }
  const authUser = await client.query<{ exists: boolean }>(
    "select exists(select 1 from auth.users where id = $1) as exists",
    [config.authUserId],
  );
  if (!authUser.rows[0]?.exists) {
    throw new Error(
      "AUBOS_BOOTSTRAP_AUTH_USER_ID does not identify an existing Supabase Auth user",
    );
  }

  await client.query(
    `insert into public.installations (id, slug, display_name, realm)
     values ($1, $2, $3, 'organizational') on conflict do nothing`,
    [ids.installationId, config.installationSlug, config.installationName],
  );
  assertExact(
    "Installation",
    await rowValue(
      client,
      "installations",
      ids.installationId,
      "id, slug, display_name, realm",
    ),
    {
      id: ids.installationId,
      slug: config.installationSlug,
      display_name: config.installationName,
      realm: "organizational",
    },
  );

  await client.query(
    `insert into public.people (id, installation_id, auth_user_id, display_name, kind)
     values ($1, $2, $3, $4, 'owner') on conflict do nothing`,
    [
      ids.personId,
      ids.installationId,
      config.authUserId,
      config.ownerDisplayName,
    ],
  );
  assertExact(
    "Owner",
    await rowValue(
      client,
      "people",
      ids.personId,
      "id, installation_id, auth_user_id, display_name, kind",
    ),
    {
      id: ids.personId,
      installation_id: ids.installationId,
      auth_user_id: config.authUserId,
      display_name: config.ownerDisplayName,
      kind: "owner",
    },
  );

  await client.query(
    `insert into public.workers
       (id, installation_id, name, provider, billing_realm, host, runtime, model,
        advertised_capabilities, data_classification_ceiling, isolation, network_policy, health)
     values ($1, $2, $3, $4, $5, 'fly.io', $4, $6,
             array['executive.propose'], $7, 'separate-service', 'private-api-only', 'offline')
     on conflict do nothing`,
    [
      ids.workerId,
      ids.installationId,
      config.workerName,
      config.provider,
      config.billingRealm,
      config.model,
      config.classificationCeiling,
    ],
  );
  assertExact(
    "Worker",
    await rowValue(
      client,
      "workers",
      ids.workerId,
      `id, installation_id, name, provider, billing_realm, host, runtime, model,
       advertised_capabilities, data_classification_ceiling, isolation, network_policy, health`,
    ),
    {
      id: ids.workerId,
      installation_id: ids.installationId,
      name: config.workerName,
      provider: config.provider,
      billing_realm: config.billingRealm,
      host: "fly.io",
      runtime: config.provider,
      model: config.model,
      advertised_capabilities: ["executive.propose"],
      data_classification_ceiling: config.classificationCeiling,
      isolation: "separate-service",
      network_policy: "private-api-only",
      health: "offline",
    },
  );

  const roleHash = sha256(config.roleSkillMarkdown);
  await client.query(
    `insert into public.roles
       (id, installation_id, name, version, skill_markdown, content_sha256, created_by_person_id)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
    [
      ids.roleId,
      ids.installationId,
      config.roleName,
      config.roleVersion,
      config.roleSkillMarkdown,
      roleHash,
      ids.personId,
    ],
  );
  assertExact(
    "Role",
    await rowValue(
      client,
      "roles",
      ids.roleId,
      "id, installation_id, name, version, skill_markdown, content_sha256, created_by_person_id",
    ),
    {
      id: ids.roleId,
      installation_id: ids.installationId,
      name: config.roleName,
      version: config.roleVersion,
      skill_markdown: config.roleSkillMarkdown,
      content_sha256: roleHash,
      created_by_person_id: ids.personId,
    },
  );

  const assignmentId = deterministicUuid(
    config.installationSlug,
    "executive-worker-strategic-role-assignment",
  );
  await client.query(
    `insert into public.worker_role_assignments
       (id, installation_id, worker_id, role_id, assigned_by_person_id)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [assignmentId, ids.installationId, ids.workerId, ids.roleId, ids.personId],
  );
  assertExact(
    "Worker role assignment",
    await rowValue(
      client,
      "worker_role_assignments",
      assignmentId,
      "id, installation_id, worker_id, role_id, assigned_by_person_id",
    ),
    {
      id: assignmentId,
      installation_id: ids.installationId,
      worker_id: ids.workerId,
      role_id: ids.roleId,
      assigned_by_person_id: ids.personId,
    },
  );

  const policyDefinition = {
    capability: "executive.propose",
    mode: "recommend",
    effect: "recommendation-only",
    externalEffects: false,
  };
  const policyEncoded = JSON.stringify(canonical(policyDefinition));
  await client.query(
    `insert into public.policies
       (id, installation_id, name, version, definition, content_sha256, created_by_person_id)
     values ($1, $2, 'Executive recommendation only', 1, $3::jsonb, $4, $5)
     on conflict do nothing`,
    [
      ids.policyId,
      ids.installationId,
      policyEncoded,
      sha256(policyEncoded),
      ids.personId,
    ],
  );
  assertExact(
    "Policy",
    await rowValue(
      client,
      "policies",
      ids.policyId,
      "id, installation_id, name, version, definition, content_sha256, created_by_person_id",
    ),
    {
      id: ids.policyId,
      installation_id: ids.installationId,
      name: "Executive recommendation only",
      version: 1,
      definition: policyDefinition,
      content_sha256: sha256(policyEncoded),
      created_by_person_id: ids.personId,
    },
  );

  await client.query(
    `insert into public.work
       (id, installation_id, title, requested_outcome, acceptance_criteria, state,
        priority, requested_by_person_id)
     values ($1, $2, $3, $4, $5::jsonb, 'ready', 70, $6)
     on conflict do nothing`,
    [
      ids.workId,
      ids.installationId,
      config.workTitle,
      config.requestedOutcome,
      JSON.stringify(["Produce one evidence-cited structured recommendation."]),
      ids.personId,
    ],
  );
  assertExact(
    "Executive Work",
    await rowValue(
      client,
      "work",
      ids.workId,
      "id, installation_id, title, requested_outcome, acceptance_criteria, state, priority, requested_by_person_id",
    ),
    {
      id: ids.workId,
      installation_id: ids.installationId,
      title: config.workTitle,
      requested_outcome: config.requestedOutcome,
      acceptance_criteria: [
        "Produce one evidence-cited structured recommendation.",
      ],
      state: "ready",
      priority: 70,
      requested_by_person_id: ids.personId,
    },
  );

  await client.query(
    `insert into public.capability_grants
       (id, installation_id, policy_id, principal_kind, worker_id, capability,
        mode, work_id, granted_by_person_id)
     values ($1, $2, $3, 'worker', $4, 'executive.propose', 'recommend', $5, $6)
     on conflict do nothing`,
    [
      ids.grantId,
      ids.installationId,
      ids.policyId,
      ids.workerId,
      ids.workId,
      ids.personId,
    ],
  );
  assertExact(
    "Executive recommendation grant",
    await rowValue(
      client,
      "capability_grants",
      ids.grantId,
      `id, installation_id, policy_id, principal_kind, person_id, worker_id,
       capability, mode, work_id, expires_at, granted_by_person_id`,
    ),
    {
      id: ids.grantId,
      installation_id: ids.installationId,
      policy_id: ids.policyId,
      principal_kind: "worker",
      person_id: null,
      worker_id: ids.workerId,
      capability: "executive.propose",
      mode: "recommend",
      work_id: ids.workId,
      expires_at: null,
      granted_by_person_id: ids.personId,
    },
  );

  await client.query(
    `insert into public.records
       (id, installation_id, work_id, kind, summary, payload, source_uri,
        classification, actor_person_id)
     values ($1, $2, $3, 'evidence', $4, $5::jsonb, $6, $7, $8)
     on conflict do nothing`,
    [
      ids.evidenceId,
      ids.installationId,
      ids.workId,
      config.evidenceSummary,
      JSON.stringify({ bootstrap: true, syntheticDefault: true }),
      `urn:aubos:bootstrap:${config.installationSlug}`,
      config.evidenceClassification,
      ids.personId,
    ],
  );
  assertExact(
    "Bootstrap evidence",
    await rowValue(
      client,
      "records",
      ids.evidenceId,
      `id, installation_id, work_id, kind, summary, payload, source_uri,
       classification, actor_person_id, actor_worker_id, supersedes_record_id`,
    ),
    {
      id: ids.evidenceId,
      installation_id: ids.installationId,
      work_id: ids.workId,
      kind: "evidence",
      summary: config.evidenceSummary,
      payload: { bootstrap: true, syntheticDefault: true },
      source_uri: `urn:aubos:bootstrap:${config.installationSlug}`,
      classification: config.evidenceClassification,
      actor_person_id: ids.personId,
      actor_worker_id: null,
      supersedes_record_id: null,
    },
  );

  return ids;
}

export async function applyBootstrap(
  config: BootstrapConfig,
  secrets: BootstrapSecrets,
): Promise<Record<string, unknown>> {
  const pool = new Pool({
    connectionString: secrets.administratorDatabaseUrl,
    ssl: secrets.administratorDatabaseSsl
      ? { rejectUnauthorized: true }
      : undefined,
    max: 1,
    application_name: "aubos-first-install-bootstrap",
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '30s'");
    await provisionRuntimeRole(
      client,
      config.runtimeRole,
      secrets.runtimeDatabasePassword,
      secrets.runtimeContextSigningSecret,
    );
    const ids = await provisionInstallation(client, config);
    await client.query("commit");
    return {
      status: "applied",
      installationId: ids.installationId,
      workId: ids.workId,
      workerId: ids.workerId,
      roleId: ids.roleId,
      evidenceId: ids.evidenceId,
      runtimeDatabaseRole: config.runtimeRole,
      secretsPrinted: false,
    };
  } catch (error) {
    if (client) await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "--plan" && command !== "--apply") {
    throw new Error("Use exactly one mode: --plan or --apply");
  }
  const config = await readBootstrapConfig();
  if (command === "--plan") {
    console.log(JSON.stringify(buildBootstrapPlan(config), null, 2));
    return;
  }
  const result = await applyBootstrap(config, readBootstrapSecrets());
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("deploy/bootstrap/provision.ts")) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Bootstrap operation failed",
    );
    process.exitCode = 1;
  });
}
