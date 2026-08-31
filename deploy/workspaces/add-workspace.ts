import { createHash } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const prefixedSha256Pattern = /^sha256:[a-f0-9]{64}$/;
const sourceCommitPattern = /^[a-f0-9]{40}$/;
const migrationHeadPattern = /^\d{14}_[a-z0-9_]+$/;

export const workspaceAdditionProtocol = "vorton.add-workspace.v1";

export interface WorkspaceAdditionConfig {
  installationId: string;
  personId: string;
  authUserId: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceDisplayName: string;
  workspaceRealm: "personal" | "organizational";
  adoptedRelease: {
    adoptionReceiptId: string;
    adoptionReceiptSha256: string;
    receiptPlane: "installation-postgres";
    manifestSha256: string;
    sourceCommit: string;
    migrationHead: string;
    workspaceIsolationProofSha256: string;
    workspaceIsolationProofHash: string;
    status: "adopted";
    adoptedAt: string;
  };
}

export interface WorkspaceAdditionAuthority {
  approvalId: string;
  receiptId: string;
  expectedWorkspacePlanSha256: string;
}

export interface WorkspaceAdditionSecrets {
  administratorDatabaseUrl: string;
  administratorDatabaseSsl: boolean;
}

interface SqlClient {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

interface WorkspaceAdditionPlanDocument {
  schemaVersion: 1;
  protocol: typeof workspaceAdditionProtocol;
  operation: "add-workspace-to-existing-installation";
  adoptedRelease: WorkspaceAdditionConfig["adoptedRelease"];
  installation: { id: string; create: false };
  owner: { personId: string; authUserId: string; create: false };
  workspace: {
    id: string;
    slug: string;
    displayName: string;
    realm: "personal" | "organizational";
    membership: "owner";
  };
  creates: {
    workspaces: 1;
    workspaceMemberships: 1;
    installationReceipts: 1;
    allOtherWorkspaceScopedRows: 0;
    infrastructureStacks: 0;
  };
  effects: "none";
}

export interface WorkspaceAdditionPlan extends WorkspaceAdditionPlanDocument {
  workspacePlanSha256: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function uuid(value: string, name: string): string {
  if (!uuidPattern.test(value)) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function prefixedSha256(value: string, name: string): string {
  if (!prefixedSha256Pattern.test(value)) {
    throw new Error(`${name} must be sha256: plus 64 lowercase hex characters`);
  }
  return value;
}

function exactSourceCommit(value: string): string {
  if (!sourceCommitPattern.test(value)) {
    throw new Error(
      "VORTON_ADD_WORKSPACE_SOURCE_COMMIT must be an exact lowercase 40-character Git commit",
    );
  }
  return value;
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function readWorkspaceAdditionConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceAdditionConfig {
  const workspaceSlug = required(env, "VORTON_ADD_WORKSPACE_SLUG");
  const workspaceDisplayName = required(
    env,
    "VORTON_ADD_WORKSPACE_DISPLAY_NAME",
  );
  const workspaceRealm = required(env, "VORTON_ADD_WORKSPACE_REALM");
  if (!/^[a-z][a-z0-9-]*$/.test(workspaceSlug)) {
    throw new Error(
      "VORTON_ADD_WORKSPACE_SLUG must start with a letter and contain lowercase letters, digits, or hyphens",
    );
  }
  if (
    workspaceDisplayName.trim() !== workspaceDisplayName ||
    workspaceDisplayName.length < 1 ||
    workspaceDisplayName.length > 120
  ) {
    throw new Error(
      "VORTON_ADD_WORKSPACE_DISPLAY_NAME must contain 1 to 120 non-padding characters",
    );
  }
  if (workspaceRealm !== "personal" && workspaceRealm !== "organizational") {
    throw new Error(
      "VORTON_ADD_WORKSPACE_REALM must be personal or organizational",
    );
  }
  return {
    installationId: uuid(
      required(env, "VORTON_ADD_WORKSPACE_INSTALLATION_ID"),
      "VORTON_ADD_WORKSPACE_INSTALLATION_ID",
    ),
    personId: uuid(
      required(env, "VORTON_ADD_WORKSPACE_PERSON_ID"),
      "VORTON_ADD_WORKSPACE_PERSON_ID",
    ),
    authUserId: uuid(
      required(env, "VORTON_ADD_WORKSPACE_AUTH_USER_ID"),
      "VORTON_ADD_WORKSPACE_AUTH_USER_ID",
    ),
    workspaceId: uuid(
      required(env, "VORTON_ADD_WORKSPACE_ID"),
      "VORTON_ADD_WORKSPACE_ID",
    ),
    workspaceSlug,
    workspaceDisplayName,
    workspaceRealm,
    adoptedRelease: readAdoptedReleaseProjection(env),
  };
}

function readAdoptedReleaseProjection(
  env: NodeJS.ProcessEnv,
): WorkspaceAdditionConfig["adoptedRelease"] {
  const migrationHead = required(
    env,
    "VORTON_ADD_WORKSPACE_RELEASE_MIGRATION_HEAD",
  );
  if (!migrationHeadPattern.test(migrationHead)) {
    throw new Error(
      "VORTON_ADD_WORKSPACE_RELEASE_MIGRATION_HEAD must be a 14-digit migration identity",
    );
  }
  const workspaceIsolationProofSha256 = prefixedSha256(
    required(env, "VORTON_ADD_WORKSPACE_ISOLATION_PROOF_SHA256"),
    "VORTON_ADD_WORKSPACE_ISOLATION_PROOF_SHA256",
  );
  const workspaceIsolationProofHash = prefixedSha256(
    required(env, "VORTON_ADD_WORKSPACE_ISOLATION_PROOF_HASH"),
    "VORTON_ADD_WORKSPACE_ISOLATION_PROOF_HASH",
  );
  if (workspaceIsolationProofSha256 === workspaceIsolationProofHash) {
    throw new Error(
      "Workspace isolation proof byte digest and canonical proof hash must differ",
    );
  }
  const adoptedAt = required(env, "VORTON_ADD_WORKSPACE_RELEASE_ADOPTED_AT");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(adoptedAt) ||
    !Number.isFinite(Date.parse(adoptedAt))
  ) {
    throw new Error(
      "VORTON_ADD_WORKSPACE_RELEASE_ADOPTED_AT must be an exact UTC timestamp",
    );
  }
  return {
    adoptionReceiptId: uuid(
      required(env, "VORTON_ADD_WORKSPACE_RELEASE_ADOPTION_RECEIPT_ID"),
      "VORTON_ADD_WORKSPACE_RELEASE_ADOPTION_RECEIPT_ID",
    ),
    adoptionReceiptSha256: prefixedSha256(
      required(env, "VORTON_ADD_WORKSPACE_RELEASE_ADOPTION_RECEIPT_SHA256"),
      "VORTON_ADD_WORKSPACE_RELEASE_ADOPTION_RECEIPT_SHA256",
    ),
    receiptPlane: "installation-postgres",
    manifestSha256: prefixedSha256(
      required(env, "VORTON_ADD_WORKSPACE_RELEASE_MANIFEST_SHA256"),
      "VORTON_ADD_WORKSPACE_RELEASE_MANIFEST_SHA256",
    ),
    sourceCommit: exactSourceCommit(
      required(env, "VORTON_ADD_WORKSPACE_RELEASE_SOURCE_COMMIT"),
    ),
    migrationHead,
    workspaceIsolationProofSha256,
    workspaceIsolationProofHash,
    status: "adopted",
    adoptedAt,
  };
}

export function readWorkspaceAdditionAuthority(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceAdditionAuthority {
  const approvalId = uuid(
    required(env, "VORTON_ADD_WORKSPACE_APPROVAL_ID"),
    "VORTON_ADD_WORKSPACE_APPROVAL_ID",
  );
  return {
    approvalId,
    receiptId: uuid(
      required(env, "VORTON_ADD_WORKSPACE_RECEIPT_ID"),
      "VORTON_ADD_WORKSPACE_RECEIPT_ID",
    ),
    expectedWorkspacePlanSha256: prefixedSha256(
      required(env, "VORTON_ADD_WORKSPACE_PLAN_SHA256"),
      "VORTON_ADD_WORKSPACE_PLAN_SHA256",
    ),
  };
}

export function readWorkspaceAdditionSecrets(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceAdditionSecrets {
  const administratorDatabaseUrl = required(
    env,
    "VORTON_ADD_WORKSPACE_DATABASE_URL",
  );
  const parsed = new URL(administratorDatabaseUrl);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(
      "VORTON_ADD_WORKSPACE_DATABASE_URL must be a PostgreSQL URL",
    );
  }
  return {
    administratorDatabaseUrl,
    administratorDatabaseSsl: exactBoolean(
      env,
      "VORTON_ADD_WORKSPACE_DATABASE_SSL",
      true,
    ),
  };
}

function planDocument(
  config: WorkspaceAdditionConfig,
): WorkspaceAdditionPlanDocument {
  return {
    schemaVersion: 1,
    protocol: workspaceAdditionProtocol,
    operation: "add-workspace-to-existing-installation",
    adoptedRelease: config.adoptedRelease,
    installation: { id: config.installationId, create: false },
    owner: {
      personId: config.personId,
      authUserId: config.authUserId,
      create: false,
    },
    workspace: {
      id: config.workspaceId,
      slug: config.workspaceSlug,
      displayName: config.workspaceDisplayName,
      realm: config.workspaceRealm,
      membership: "owner",
    },
    creates: {
      workspaces: 1,
      workspaceMemberships: 1,
      installationReceipts: 1,
      allOtherWorkspaceScopedRows: 0,
      infrastructureStacks: 0,
    },
    effects: "none",
  };
}

export function buildWorkspaceAdditionPlan(
  config: WorkspaceAdditionConfig,
): WorkspaceAdditionPlan {
  const document = planDocument(config);
  return {
    ...document,
    workspacePlanSha256: sha256(canonicalJson(document)),
  };
}

async function workspaceScopedTables(client: SqlClient): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name
       from information_schema.columns
      where table_schema = 'public'
        and column_name = 'workspace_id'
        and table_name not in (
          'workspaces', 'workspace_memberships', 'workspace_creation_receipts'
        )
      order by table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function requireEmptyWorkspace(
  client: SqlClient,
  workspaceId: string,
): Promise<void> {
  for (const table of await workspaceScopedTables(client)) {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) {
      throw new Error("Workspace table inventory contained an unsafe name");
    }
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from public.${table} where workspace_id = $1`,
      [workspaceId],
    );
    if (result.rows[0]?.count !== "0") {
      throw new Error(
        `New workspace is not empty: public.${table} contains scoped rows`,
      );
    }
  }
}

async function assertStableWorkspaceBirth(
  client: SqlClient,
  config: WorkspaceAdditionConfig,
): Promise<void> {
  const workspace = await client.query<{
    created_by_person_id: string;
    display_name: string;
    installation_id: string;
    realm: string;
    slug: string;
  }>(
    `select installation_id::text as installation_id, slug, display_name,
            realm::text as realm, created_by_person_id::text as created_by_person_id
       from public.workspaces where id = $1`,
    [config.workspaceId],
  );
  const row = workspace.rows[0];
  if (
    !row ||
    row.installation_id !== config.installationId ||
    row.slug !== config.workspaceSlug ||
    row.display_name !== config.workspaceDisplayName ||
    row.realm !== config.workspaceRealm ||
    row.created_by_person_id !== config.personId
  ) {
    throw new Error("Workspace already exists with conflicting data");
  }
}

async function assertInitialOwnerMembership(
  client: SqlClient,
  config: WorkspaceAdditionConfig,
): Promise<void> {
  const membership = await client.query<{ kind: string }>(
    `select kind::text as kind
       from public.workspace_memberships
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [config.installationId, config.workspaceId, config.personId],
  );
  if (membership.rows[0]?.kind !== "owner") {
    throw new Error("Workspace owner membership is missing or conflicting");
  }
}

async function workspaceCreationReceipt(
  client: SqlClient,
  config: WorkspaceAdditionConfig,
  authority: WorkspaceAdditionAuthority,
): Promise<
  | {
      approval_id: string;
      id: string;
      owner_person_id: string;
      release_adoption_receipt_id: string;
      release_adoption_receipt_sha256: string;
      source_commit: string;
      workspace_id: string;
      workspace_plan_sha256: string;
    }
  | undefined
> {
  const result = await client.query<{
    approval_id: string;
    id: string;
    owner_person_id: string;
    release_adoption_receipt_id: string;
    release_adoption_receipt_sha256: string;
    source_commit: string;
    workspace_id: string;
    workspace_plan_sha256: string;
  }>(
    `select id::text as id, approval_id::text as approval_id,
            workspace_id::text as workspace_id,
            owner_person_id::text as owner_person_id,
            release_adoption_receipt_id::text as release_adoption_receipt_id,
            release_adoption_receipt_sha256, source_commit, workspace_plan_sha256
       from public.workspace_creation_receipts
      where installation_id = $1
        and (id = $2 or approval_id = $3 or workspace_id = $4)`,
    [
      config.installationId,
      authority.receiptId,
      authority.approvalId,
      config.workspaceId,
    ],
  );
  return result.rows[0];
}

function assertExactReceipt(
  receipt: NonNullable<Awaited<ReturnType<typeof workspaceCreationReceipt>>>,
  config: WorkspaceAdditionConfig,
  authority: WorkspaceAdditionAuthority,
  plan: WorkspaceAdditionPlan,
): void {
  if (
    receipt.id !== authority.receiptId ||
    receipt.approval_id !== authority.approvalId ||
    receipt.workspace_id !== config.workspaceId ||
    receipt.owner_person_id !== config.personId ||
    receipt.release_adoption_receipt_id !==
      config.adoptedRelease.adoptionReceiptId ||
    receipt.release_adoption_receipt_sha256 !==
      config.adoptedRelease.adoptionReceiptSha256 ||
    receipt.source_commit !== config.adoptedRelease.sourceCommit ||
    receipt.workspace_plan_sha256 !== plan.workspacePlanSha256
  ) {
    throw new Error("Workspace creation receipt conflicts with the exact plan");
  }
}

export async function addWorkspaceToExistingInstallation(
  client: SqlClient,
  config: WorkspaceAdditionConfig,
  authority: WorkspaceAdditionAuthority,
): Promise<{
  status: "applied" | "already-applied";
  workspacePlanSha256: string;
}> {
  const plan = buildWorkspaceAdditionPlan(config);
  if (authority.expectedWorkspacePlanSha256 !== plan.workspacePlanSha256) {
    throw new Error(
      "Workspace addition plan digest does not match apply input",
    );
  }
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `vorton-add-workspace:${config.installationId}:${config.workspaceId}`,
  ]);

  const receipt = await workspaceCreationReceipt(client, config, authority);
  const existing = await client.query<{ exists: boolean }>(
    "select exists(select 1 from public.workspaces where id = $1) as exists",
    [config.workspaceId],
  );
  if (receipt) {
    assertExactReceipt(receipt, config, authority, plan);
    await assertStableWorkspaceBirth(client, config);
    return {
      status: "already-applied",
      workspacePlanSha256: plan.workspacePlanSha256,
    };
  }
  if (existing.rows[0]?.exists) {
    throw new Error(
      "Target workspace exists without its installation-scoped creation receipt",
    );
  }
  await client.query(
    `select id::text as id
       from public.apply_workspace_creation($1, $2, $3, $4)`,
    [
      config.installationId,
      authority.approvalId,
      authority.receiptId,
      plan.workspacePlanSha256,
    ],
  );
  await assertStableWorkspaceBirth(client, config);
  await assertInitialOwnerMembership(client, config);
  const createdReceipt = await workspaceCreationReceipt(
    client,
    config,
    authority,
  );
  if (!createdReceipt) throw new Error("Workspace creation receipt is missing");
  assertExactReceipt(createdReceipt, config, authority, plan);
  await requireEmptyWorkspace(client, config.workspaceId);
  return { status: "applied", workspacePlanSha256: plan.workspacePlanSha256 };
}

export async function applyWorkspaceAddition(
  config: WorkspaceAdditionConfig,
  authority: WorkspaceAdditionAuthority,
  secrets: WorkspaceAdditionSecrets,
): Promise<Record<string, unknown>> {
  const pool = new Pool({
    connectionString: secrets.administratorDatabaseUrl,
    ssl: secrets.administratorDatabaseSsl
      ? { rejectUnauthorized: true }
      : undefined,
    max: 1,
    application_name: "vorton-add-workspace",
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("begin");
    await client.query("set local statement_timeout = '30s'");
    const result = await addWorkspaceToExistingInstallation(
      client,
      config,
      authority,
    );
    await client.query("commit");
    return {
      ...result,
      installationId: config.installationId,
      workspaceId: config.workspaceId,
      receiptId: authority.receiptId,
      createdRows:
        result.status === "applied"
          ? {
              workspaces: 1,
              workspaceMemberships: 1,
              installationReceipts: 1,
              allOther: 0,
            }
          : {
              workspaces: 0,
              workspaceMemberships: 0,
              installationReceipts: 0,
              allOther: 0,
            },
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
  const config = readWorkspaceAdditionConfig();
  if (command === "--plan") {
    console.log(JSON.stringify(buildWorkspaceAdditionPlan(config), null, 2));
    return;
  }
  const result = await applyWorkspaceAddition(
    config,
    readWorkspaceAdditionAuthority(),
    readWorkspaceAdditionSecrets(),
  );
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("deploy/workspaces/add-workspace.ts")) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Workspace addition failed",
    );
    process.exitCode = 1;
  });
}
