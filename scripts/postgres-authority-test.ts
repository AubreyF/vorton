import { createHmac } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "pg";

import {
  executiveWorkerJobSchema,
  type ExecutiveWorkerJobRequest,
} from "@vorton/contracts";
import { Database } from "@vorton/database";
import type { ExecutiveWorkerProvider } from "@vorton/workers";

import { DatabaseExecutiveCouncilResolver } from "../apps/api/src/council-resolver.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(__dirname, "..");
const migrationDirectory = resolve(repositoryRoot, "supabase/migrations");
const runtimeRole = "aubos_runtime";
const runtimePassword = "synthetic-runtime-password-original-0001";
const replayPassword = "synthetic-runtime-password-replay-000002";
const contextSecret = "synthetic-context-signing-secret-000001";
const ownerAuthUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const otherInstallationId = "36bb264a-668f-45a6-8da0-6e5cad3fc026";
const otherWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherWorkId = "02fb4603-57f1-4a04-a6f6-2d473af03f7b";
const otherWorkerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherRoleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherPolicyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const organizationalBankId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const personalBankId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

interface BootstrapResult {
  status: string;
  installationId: string;
  workspaceId: string;
  workId: string;
  workerId: string;
  roleId: string;
  runtimeDatabaseRole: string;
}

interface LocalPostgres {
  adminDatabaseUrl: string;
  stop(): Promise<void>;
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

async function unusedPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Node did not allocate a PostgreSQL test port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function startLocalPostgres(): Promise<LocalPostgres> {
  let bindir: string;
  try {
    bindir = execFileSync("pg_config", ["--bindir"], {
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(
      "pg_config is required when VORTON_AUTHORITY_TEST_DATABASE_URL is not set",
    );
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "vorton-pg-authority-"));
  const dataDirectory = join(temporaryRoot, "data");
  const socketDirectory = join(temporaryRoot, "socket");
  const passwordFile = join(temporaryRoot, "admin-password");
  await mkdir(socketDirectory);
  await writeFile(passwordFile, "synthetic-admin-password-000000000001\n", {
    mode: 0o600,
  });
  const port = await unusedPort();
  const initdb = join(bindir, "initdb");
  const pgCtl = join(bindir, "pg_ctl");

  try {
    execFileSync(
      initdb,
      [
        "-D",
        dataDirectory,
        "-U",
        "postgres",
        "--no-locale",
        "-E",
        "UTF8",
        "--auth-local=trust",
        "--auth-host=scram-sha-256",
        `--pwfile=${passwordFile}`,
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      pgCtl,
      [
        "-D",
        dataDirectory,
        "-o",
        `-F -p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }

  const bootstrapConnection = new Client({
    connectionString: `postgresql://postgres:synthetic-admin-password-000000000001@127.0.0.1:${port}/postgres`,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await bootstrapConnection.connect();
    await bootstrapConnection.query("create database vorton_authority");
  } finally {
    await bootstrapConnection.end();
  }

  return {
    adminDatabaseUrl: `postgresql://postgres:synthetic-admin-password-000000000001@127.0.0.1:${port}/vorton_authority`,
    async stop(): Promise<void> {
      try {
        execFileSync(pgCtl, ["-D", dataDirectory, "-m", "fast", "-w", "stop"], {
          stdio: "ignore",
        });
      } catch {
        // Preserve the original test failure if PostgreSQL already stopped.
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}

function databaseUrlForRole(
  adminDatabaseUrl: string,
  role: string,
  password: string,
): string {
  const url = new URL(adminDatabaseUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function connect(databaseUrl: string): Promise<Client> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  return client;
}

async function applyMigrations(admin: Client): Promise<string[]> {
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  requireCondition(
    migrationNames.length > 0,
    "No Vorton migrations were found",
  );
  for (const migrationName of migrationNames) {
    await admin.query(
      await readFile(join(migrationDirectory, migrationName), "utf8"),
    );
  }
  return migrationNames;
}

async function runBootstrap(
  adminDatabaseUrl: string,
  proposedRuntimePassword: string,
): Promise<BootstrapResult> {
  const executable = resolve(repositoryRoot, "node_modules/.bin/tsx");
  const { stdout } = await execFileAsync(
    executable,
    [resolve(repositoryRoot, "deploy/bootstrap/provision.ts"), "--apply"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        VORTON_BOOTSTRAP_DATABASE_URL: adminDatabaseUrl,
        VORTON_BOOTSTRAP_DATABASE_SSL: "false",
        VORTON_BOOTSTRAP_RUNTIME_DATABASE_PASSWORD: proposedRuntimePassword,
        VORTON_BOOTSTRAP_CONTEXT_SIGNING_SECRET: contextSecret,
        VORTON_BOOTSTRAP_AUTH_USER_ID: ownerAuthUserId,
        VORTON_BOOTSTRAP_INSTALLATION_SLUG: "postgres-authority-lab",
        VORTON_BOOTSTRAP_INSTALLATION_NAME: "Postgres Authority Lab",
        VORTON_BOOTSTRAP_OWNER_DISPLAY_NAME: "Synthetic Authority Owner",
        VORTON_WORKER_PROVIDER: "openai-responses",
        VORTON_WORKER_MODEL: "synthetic-model",
        VORTON_OPENAI_MODEL: "synthetic-model",
        VORTON_WORKER_CLASSIFICATION_CEILING: "synthetic",
        VORTON_OPENAI_CLASSIFICATION_CEILING: "synthetic",
        VORTON_BOOTSTRAP_EVIDENCE_CLASSIFICATION: "synthetic",
      },
      maxBuffer: 1024 * 1024,
    },
  );
  const result = JSON.parse(stdout) as BootstrapResult;
  requireCondition(result.status === "applied", "Bootstrap did not apply");
  requireCondition(
    result.runtimeDatabaseRole === runtimeRole,
    "Bootstrap returned an unexpected runtime role",
  );
  return result;
}

async function rolePasswordHash(admin: Client): Promise<string> {
  const result = await admin.query<{ rolpassword: string | null }>(
    "select rolpassword from pg_authid where rolname = $1",
    [runtimeRole],
  );
  const value = result.rows[0]?.rolpassword;
  requireCondition(value, "Runtime role has no password verifier");
  return value;
}

async function expectLoginRejected(databaseUrl: string): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
  } catch (error) {
    requireCondition(
      (error as { code?: string }).code === "28P01",
      "Replay password was rejected for an unexpected reason",
    );
    return;
  } finally {
    await client.end().catch(() => undefined);
  }
  throw new Error("Bootstrap replay silently rotated the runtime password");
}

async function setSignedContext(
  client: Client,
  kind: "person" | "worker",
  installationId: string,
  workspaceId: string,
  subjectId: string,
  credentialId = "",
): Promise<void> {
  const transaction = await client.query<{ txid: string }>(
    "select txid_current()::text as txid",
  );
  const txid = transaction.rows[0]?.txid;
  requireCondition(txid, "PostgreSQL did not return a transaction ID");
  const signature = createHmac("sha256", contextSecret)
    .update(
      `${txid}|${kind}|${installationId}|${workspaceId}|${subjectId}|${credentialId}`,
    )
    .digest("hex");
  await client.query(
    `select set_config('aubos.context_kind', $1, true),
            set_config('aubos.installation_id', $2, true),
            set_config('vorton.workspace_id', $3, true),
            set_config('aubos.subject_id', $4, true),
            set_config('aubos.credential_id', $5, true),
            set_config('aubos.context_signature', $6, true)`,
    [kind, installationId, workspaceId, subjectId, credentialId, signature],
  );
}

async function inRuntimeTransaction<T>(
  databaseUrl: string,
  role: "authenticated" | "aubos_worker",
  setup: (client: Client) => Promise<void>,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(databaseUrl);
  try {
    await client.query("begin");
    await setup(client);
    await client.query(`set local role ${role}`);
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function expectRuntimeDenied(
  databaseUrl: string,
  role: "authenticated" | "aubos_worker",
  setup: (client: Client) => Promise<void>,
  sql: string,
  values: unknown[],
  label: string,
): Promise<void> {
  try {
    await inRuntimeTransaction(databaseUrl, role, setup, (client) =>
      client.query(sql, values),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    requireCondition(
      code === "42501",
      `${label} failed with SQLSTATE ${code ?? "unknown"}, not an RLS denial`,
    );
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function expectRuntimeSqlState(
  databaseUrl: string,
  role: "authenticated" | "aubos_worker",
  setup: (client: Client) => Promise<void>,
  sql: string,
  values: unknown[],
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await inRuntimeTransaction(databaseUrl, role, setup, (client) =>
      client.query(sql, values),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    requireCondition(
      code === expectedCode,
      `${label} failed with SQLSTATE ${code ?? "unknown"}, not ${expectedCode}`,
    );
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function seedAuthorityFixtures(
  admin: Client,
  bootstrap: BootstrapResult,
): Promise<string> {
  const owner = await admin.query<{ id: string }>(
    "select id from public.people where installation_id = $1 and auth_user_id = $2",
    [bootstrap.installationId, ownerAuthUserId],
  );
  const ownerPersonId = owner.rows[0]?.id;
  requireCondition(ownerPersonId, "Bootstrap owner was not persisted");
  await admin.query(
    `insert into public.workspaces
       (id, installation_id, slug, display_name, realm, created_by_person_id)
     values ($1, $2, 'personal-hostile-fixture', 'Personal hostile fixture',
             'personal', $3)`,
    [otherWorkspaceId, bootstrap.installationId, ownerPersonId],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values ($1, $2, $3, 'owner')`,
    [bootstrap.installationId, otherWorkspaceId, ownerPersonId],
  );
  await admin.query(
    `insert into public.work
       (id, installation_id, workspace_id, title, requested_outcome, state)
     values ($1, $2, $3, 'Other workspace work', 'Remain inaccessible.', 'ready')`,
    [otherWorkId, bootstrap.installationId, otherWorkspaceId],
  );
  await admin.query(
    `insert into public.records
       (installation_id, workspace_id, work_id, kind, summary, payload, classification, actor_person_id)
     values
       ($1, $2, $3, 'decision', 'Synthetic owner decision.', '{}', 'synthetic', $4),
       ($1, $2, $3, 'approval', 'Synthetic owner approval.', '{}', 'synthetic', $4)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
      ownerPersonId,
    ],
  );
  return ownerPersonId;
}

async function proveWorkspaceResourceCoexistence(
  admin: Client,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  await admin.query(
    `insert into public.workers
       (id, installation_id, workspace_id, name, provider, billing_realm, host,
        runtime, model, advertised_capabilities, data_classification_ceiling,
        isolation, network_policy, health)
     select $1, installation_id, $2, name, provider, billing_realm, host,
            runtime, model, advertised_capabilities, data_classification_ceiling,
            isolation, network_policy, health
       from public.workers
      where installation_id = $3 and workspace_id = $4 and id = $5`,
    [
      otherWorkerId,
      otherWorkspaceId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
    ],
  );
  await admin.query(
    `insert into public.roles
       (id, installation_id, workspace_id, name, version, skill_markdown,
        content_sha256, created_by_person_id)
     select $1, installation_id, $2, name, version, skill_markdown,
            content_sha256, $3
       from public.roles
      where installation_id = $4 and workspace_id = $5 and id = $6`,
    [
      otherRoleId,
      otherWorkspaceId,
      ownerPersonId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.roleId,
    ],
  );
  await admin.query(
    `insert into public.policies
       (id, installation_id, workspace_id, name, version, definition,
        content_sha256, created_by_person_id)
     select $1, installation_id, $2, name, version, definition,
            content_sha256, $3
       from public.policies
      where installation_id = $4 and workspace_id = $5
      order by created_at
      limit 1`,
    [
      otherPolicyId,
      otherWorkspaceId,
      ownerPersonId,
      bootstrap.installationId,
      bootstrap.workspaceId,
    ],
  );
  await admin.query(
    `insert into public.source_connections
       (installation_id, workspace_id, installation_realm, provider,
        external_account_id, credential_reference, poll_overlap_seconds,
        requests_per_minute, page_size, max_pages_per_poll,
        backoff_base_seconds, backoff_max_seconds, watermark)
     values
       ($1, $2, 'organizational', 'google-meet', 'organizational-source',
        'secret://organizational-source', 60, 30, 100, 5, 1, 60, now()),
       ($1, $3, 'personal', 'google-meet', 'personal-source',
        'secret://personal-source', 60, 30, 100, 5, 1, 60, now())`,
    [bootstrap.installationId, bootstrap.workspaceId, otherWorkspaceId],
  );
  await admin.query(
    `insert into public.memory_banks
       (id, installation_id, workspace_id, installation_realm, adapter,
        external_bank_id, database_locator, object_bucket_locator)
     values
       ($1, $2, $3, 'organizational', 'hindsight',
        'hostile-organizational-bank', 'postgres://organizational-bank',
        'object://organizational-bank'),
       ($4, $2, $5, 'personal', 'hindsight',
        'hostile-personal-bank', 'postgres://personal-bank',
        'object://personal-bank')`,
    [
      organizationalBankId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      personalBankId,
      otherWorkspaceId,
    ],
  );

  const proof = await admin.query<{
    banks: string;
    duplicate_policies: string;
    duplicate_roles: string;
    duplicate_workers: string;
    realms: string[];
  }>(
    `select
       (select count(*)::text from public.memory_banks
         where installation_id = $1) as banks,
       (select count(*)::text from public.workers worker
         where worker.installation_id = $1
           and worker.name = (select name from public.workers where id = $2))
         as duplicate_workers,
       (select count(*)::text from public.roles role
         where role.installation_id = $1
           and (role.name, role.version) =
             (select name, version from public.roles where id = $3))
         as duplicate_roles,
       (select count(*)::text from public.policies policy
         where policy.installation_id = $1
           and (policy.name, policy.version) =
             (select name, version from public.policies where id = $4))
         as duplicate_policies,
       (select array_agg(installation_realm::text order by installation_realm::text)
          from public.memory_banks where installation_id = $1) as realms`,
    [
      bootstrap.installationId,
      bootstrap.workerId,
      bootstrap.roleId,
      otherPolicyId,
    ],
  );
  const row = proof.rows[0];
  requireCondition(
    row?.banks === "2",
    "One installation did not retain two memory banks",
  );
  requireCondition(
    row.duplicate_workers === "2" &&
      row.duplicate_roles === "2" &&
      row.duplicate_policies === "2",
    "Same named workspace resources did not coexist",
  );
  requireCondition(
    JSON.stringify(row.realms) ===
      JSON.stringify(["organizational", "personal"]),
    "Personal and organizational banks did not remain realm separated",
  );
}

async function proveRoleShape(admin: Client): Promise<void> {
  const shape = await admin.query<{
    rolcanlogin: boolean;
    rolinherit: boolean;
    rolbypassrls: boolean;
    memberships: string[];
    direct_table_privileges: number;
  }>(
    `select runtime.rolcanlogin,
            runtime.rolinherit,
            runtime.rolbypassrls,
            coalesce((
              select array_agg(granted.rolname::text order by granted.rolname::text)
              from pg_auth_members membership
              join pg_roles granted on granted.oid = membership.roleid
              where membership.member = runtime.oid
            ), '{}'::text[]) as memberships,
            (
              select count(*)::integer
              from pg_class object
              cross join lateral aclexplode(coalesce(object.relacl, acldefault('r', object.relowner))) privilege
              where privilege.grantee = runtime.oid
                and object.relkind in ('r', 'p', 'v', 'm', 'f')
            ) as direct_table_privileges
       from pg_roles runtime
      where runtime.rolname = $1`,
    [runtimeRole],
  );
  const role = shape.rows[0];
  requireCondition(role?.rolcanlogin, "Runtime role cannot log in");
  requireCondition(
    !role.rolinherit,
    "Runtime role unexpectedly inherits privileges",
  );
  requireCondition(
    !role.rolbypassrls,
    "Runtime role unexpectedly bypasses RLS",
  );
  requireCondition(
    JSON.stringify(role.memberships) ===
      JSON.stringify(["aubos_worker", "authenticated"]),
    `Runtime role memberships are not exact: ${role.memberships.join(", ")}`,
  );
  requireCondition(
    role.direct_table_privileges === 0,
    "Runtime role has direct table privileges",
  );
}

async function provePersonBoundary(
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  const unsignedSetup = async (client: Client): Promise<void> => {
    await client.query(
      `select set_config('aubos.context_kind', 'person', true),
              set_config('aubos.installation_id', $1, true),
              set_config('vorton.workspace_id', $2, true),
              set_config('aubos.subject_id', $3, true),
              set_config('aubos.credential_id', '', true),
              set_config('aubos.context_signature', '', true)`,
      [bootstrap.installationId, bootstrap.workspaceId, ownerAuthUserId],
    );
  };
  const forgedSetup = async (client: Client): Promise<void> => {
    await unsignedSetup(client);
    await client.query(
      "select set_config('aubos.context_signature', $1, true)",
      ["0".repeat(64)],
    );
  };

  for (const [label, setup] of [
    ["unsigned", unsignedSetup],
    ["forged", forgedSetup],
  ] as const) {
    const visible = await inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      async (client) =>
        await client.query<{ count: string }>(
          "select count(*)::text as count from public.records where kind in ('approval', 'decision')",
        ),
    );
    requireCondition(
      visible.rows[0]?.count === "0",
      `${label} person context read human authority records`,
    );
    for (const kind of ["decision", "approval"] as const) {
      await expectRuntimeDenied(
        runtimeDatabaseUrl,
        "authenticated",
        setup,
        `insert into public.records
           (installation_id, workspace_id, work_id, kind, summary, payload, classification, actor_person_id)
         values ($1, $2, $3, $4, 'Forged authority.', '{}', 'synthetic', $5)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          kind,
          ownerPersonId,
        ],
        `${label} person ${kind}`,
      );
    }
  }

  const visible = await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    (client) =>
      setSignedContext(
        client,
        "person",
        bootstrap.installationId,
        bootstrap.workspaceId,
        ownerAuthUserId,
      ),
    async (client) =>
      await client.query<{ id: string }>(
        "select id from public.workspaces order by id",
      ),
  );
  requireCondition(
    visible.rows.length === 1 && visible.rows[0]?.id === bootstrap.workspaceId,
    "Signed person context crossed its workspace boundary",
  );
}

async function proveWorkerBoundary(
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  const credentialId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
  const signedWorker = (client: Client): Promise<void> =>
    setSignedContext(
      client,
      "worker",
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
      credentialId,
    );
  const unsignedWorker = async (client: Client): Promise<void> => {
    await client.query(
      `select set_config('aubos.context_kind', 'worker', true),
              set_config('aubos.installation_id', $1, true),
              set_config('vorton.workspace_id', $2, true),
              set_config('aubos.subject_id', $3, true),
              set_config('aubos.credential_id', $4, true),
              set_config('aubos.context_signature', '', true)`,
      [
        bootstrap.installationId,
        bootstrap.workspaceId,
        bootstrap.workerId,
        credentialId,
      ],
    );
  };
  const forgedWorker = async (client: Client): Promise<void> => {
    await unsignedWorker(client);
    await client.query(
      "select set_config('aubos.context_signature', $1, true)",
      ["f".repeat(64)],
    );
  };

  for (const [label, setup] of [
    ["unsigned", unsignedWorker],
    ["forged", forgedWorker],
  ] as const) {
    const visible = await inRuntimeTransaction(
      runtimeDatabaseUrl,
      "aubos_worker",
      setup,
      async (client) =>
        await client.query<{ count: string }>(
          "select count(*)::text as count from public.records where kind in ('approval', 'decision')",
        ),
    );
    requireCondition(
      visible.rows[0]?.count === "0",
      `${label} worker context read human authority records`,
    );
    for (const kind of ["decision", "approval"] as const) {
      await expectRuntimeDenied(
        runtimeDatabaseUrl,
        "aubos_worker",
        setup,
        `insert into public.records
           (installation_id, workspace_id, work_id, kind, summary, payload, classification, actor_worker_id)
         values ($1, $2, $3, $4, 'Forged worker authority.', '{}', 'synthetic', $5)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          kind,
          bootstrap.workerId,
        ],
        `${label} worker ${kind}`,
      );
    }
  }

  await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    async (client) => {
      await client.query(
        `insert into public.records
           (installation_id, workspace_id, work_id, kind, summary, payload, classification, actor_worker_id)
         values ($1, $2, $3, 'proposal', 'Synthetic scoped proposal.', '{}', 'synthetic', $4)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          bootstrap.workerId,
        ],
      );
      await client.query(
        `insert into public.worker_runs
           (installation_id, workspace_id, work_id, worker_id, role_id, provider, model,
            provider_job_id, status, store, background)
         values ($1, $2, $3, $4, $5, 'synthetic', 'synthetic-model',
                 'synthetic-provider-job', 'queued', false, false)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          bootstrap.workerId,
          bootstrap.roleId,
        ],
      );
      const persisted = await client.query<{
        proposals: string;
        runs: string;
      }>(
        `select
           (select count(*)::text from public.records
             where kind = 'proposal' and actor_worker_id = $1) as proposals,
           (select count(*)::text from public.worker_runs
             where worker_id = $1 and provider_job_id = 'synthetic-provider-job') as runs`,
        [bootstrap.workerId],
      );
      requireCondition(
        persisted.rows[0]?.proposals === "1" && persisted.rows[0]?.runs === "1",
        "Signed worker proposal or run did not persist through RLS",
      );
    },
  );

  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    `insert into public.records
       (installation_id, workspace_id, work_id, kind, summary, payload, classification, actor_worker_id)
     values ($1, $2, $3, 'proposal', 'Cross-workspace proposal.', '{}', 'synthetic', $4)`,
    [
      bootstrap.installationId,
      otherWorkspaceId,
      otherWorkId,
      bootstrap.workerId,
    ],
    "Worker cross-workspace proposal",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    `insert into public.worker_runs
       (installation_id, workspace_id, work_id, worker_id, role_id, provider, model,
        provider_job_id, status, store, background)
     values ($1, $2, $3, $4, $5, 'synthetic', 'synthetic-model',
             'cross-workspace-job', 'queued', false, false)`,
    [
      bootstrap.installationId,
      otherWorkspaceId,
      otherWorkId,
      bootstrap.workerId,
      bootstrap.roleId,
    ],
    "Worker cross-workspace run",
  );

  for (const kind of ["decision", "approval"] as const) {
    await expectRuntimeDenied(
      runtimeDatabaseUrl,
      "aubos_worker",
      signedWorker,
      `insert into public.records
         (installation_id, workspace_id, work_id, kind, summary, payload, classification, actor_person_id)
       values ($1, $2, $3, $4, 'Worker-forged human authority.', '{}', 'synthetic', $5)`,
      [
        bootstrap.installationId,
        bootstrap.workspaceId,
        bootstrap.workId,
        kind,
        ownerPersonId,
      ],
      `Worker human ${kind}`,
    );
  }
}

async function proveCouncilBoundary(
  admin: Client,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
): Promise<void> {
  const credentialId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
  const signedWorker = (client: Client): Promise<void> =>
    setSignedContext(
      client,
      "worker",
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
      credentialId,
    );
  const work = await admin.query<{
    input_sha256: string;
    state: string;
    updated_at: string;
  }>(
    `select state,
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
    [bootstrap.installationId, bootstrap.workspaceId, bootstrap.workId],
  );
  const updatedAt = work.rows[0]?.updated_at;
  requireCondition(updatedAt, "Council proof Work revision is missing");
  requireCondition(work.rows[0]?.state, "Council proof Work state is missing");
  const inputSha256 = work.rows[0]?.input_sha256;
  requireCondition(inputSha256, "Council proof Work input hash is missing");
  const inputRecordIds = [bootstrap.workId];
  const runMetadata = {
    installation_id: bootstrap.installationId,
    workspace_id: bootstrap.workspaceId,
    council_protocol: "vorton.executive-council.v1",
    council_phase: "proposal",
    council_role_id: bootstrap.roleId,
    input_record_ids: inputRecordIds,
    work_updated_at: updatedAt,
    work_input_sha256: inputSha256,
    authority: "none",
  };
  const recordPayload = {
    installationId: bootstrap.installationId,
    workspaceId: bootstrap.workspaceId,
    councilProtocol: "vorton.executive-council.v1",
    councilPhase: "proposal",
    councilRoleId: bootstrap.roleId,
    inputRecordIds,
    evidenceRecordIds: inputRecordIds,
    peerRecordIds: [],
    workUpdatedAt: updatedAt,
    workInputSha256: inputSha256,
    authority: "none",
    providerJob: {
      id: "synthetic-council-job",
      provider: "synthetic",
      model: "synthetic-model",
      store: false,
      background: false,
    },
    recommendation: {},
  };

  await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    async (client) => {
      const revision = await client.query<{
        installation_id: string | null;
        matches: boolean;
      }>(
        `select public.current_installation_id()::text as installation_id,
                public.council_work_revision_matches($1, $2::timestamptz, $3) as matches`,
        [bootstrap.workId, updatedAt, inputSha256],
      );
      requireCondition(
        revision.rows[0]?.matches,
        `Signed council worker ${revision.rows[0]?.installation_id ?? "without installation"} could not resolve the frozen Work revision in ${work.rows[0]!.state} state`,
      );
      await client.query(
        `insert into public.worker_runs
           (installation_id, workspace_id, work_id, worker_id, role_id, provider, model,
            provider_job_id, status, store, background, metadata)
         values ($1, $2, $3, $4, $5, 'synthetic', 'synthetic-model',
                 'synthetic-council-job', 'completed', false, false, $6::jsonb)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          bootstrap.workerId,
          bootstrap.roleId,
          JSON.stringify(runMetadata),
        ],
      );
      await client.query(
        `insert into public.worker_runs
           (installation_id, workspace_id, work_id, worker_id, role_id, provider, model,
            provider_job_id, status, store, background, metadata)
         values ($1, $2, $3, $4, $5, 'synthetic', 'synthetic-model',
                 'synthetic-synthesis-job', 'completed', false, false, $6::jsonb)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          bootstrap.workerId,
          bootstrap.roleId,
          JSON.stringify({ ...runMetadata, council_phase: "synthesis" }),
        ],
      );
      await client.query(
        `insert into public.records
           (installation_id, workspace_id, work_id, kind, summary, payload, classification,
            actor_worker_id)
         values ($1, $2, $3, 'proposal', 'Synthetic council proposal.', $4::jsonb,
                 'synthetic', $5)`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          JSON.stringify(recordPayload),
          bootstrap.workerId,
        ],
      );
    },
  );

  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    `insert into public.worker_runs
       (installation_id, workspace_id, work_id, worker_id, role_id, provider, model,
        provider_job_id, status, store, background, metadata)
     values ($1, $2, $3, $4, $5, 'synthetic', 'synthetic-model',
             'duplicate-council-job', 'queued', false, false, $6::jsonb)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
      bootstrap.workerId,
      bootstrap.roleId,
      JSON.stringify(runMetadata),
    ],
    "23505",
    "Concurrent council phase and role attempt",
  );

  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    `insert into public.worker_runs
       (installation_id, workspace_id, work_id, worker_id, role_id, provider, model,
        provider_job_id, status, store, background, metadata)
     values ($1, $2, $3, $4, $5, 'synthetic', 'synthetic-model',
             'stored-council-job', 'failed', true, false, $6::jsonb)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
      bootstrap.workerId,
      bootstrap.roleId,
      JSON.stringify(runMetadata),
    ],
    "23514",
    "Stored council attempt",
  );

  const synthesisPayload = {
    ...recordPayload,
    councilPhase: "synthesis",
    providerJob: {
      ...recordPayload.providerJob,
      id: "synthetic-synthesis-job",
    },
  };
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    `insert into public.records
       (installation_id, workspace_id, work_id, kind, summary, payload, classification,
        actor_worker_id)
     values ($1, $2, $3, 'proposal', 'Forged council inputs.', $4::jsonb,
             'synthetic', $5)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
      JSON.stringify({
        ...synthesisPayload,
        inputRecordIds: [otherWorkId],
        evidenceRecordIds: [otherWorkId],
      }),
      bootstrap.workerId,
    ],
    "Forged council run inputs",
  );

  await admin.query(
    "update public.work set title = title || ' changed' where installation_id = $1 and id = $2",
    [bootstrap.installationId, bootstrap.workId],
  );
  const mutatedRevision = await admin.query<{ updated_at: string }>(
    `select to_char(updated_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
       from public.work where installation_id = $1 and id = $2`,
    [bootstrap.installationId, bootstrap.workId],
  );
  requireCondition(
    mutatedRevision.rows[0]?.updated_at === updatedAt,
    "Same-state Work mutation unexpectedly changed the timestamp fixture",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorker,
    `insert into public.records
       (installation_id, workspace_id, work_id, kind, summary, payload, classification,
        actor_worker_id)
     values ($1, $2, $3, 'proposal', 'Stale council synthesis.', $4::jsonb,
             'synthetic', $5)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
      JSON.stringify(synthesisPayload),
      bootstrap.workerId,
    ],
    "Stale council Work revision",
  );
}

async function proveCouncilResolverFrozenEvidenceRead(
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
): Promise<void> {
  let sequence = 0;
  const provider: ExecutiveWorkerProvider = {
    provider: "openai-responses",
    model: "synthetic-model",
    dataClassificationCeiling: "synthetic",
    storesResponses: false,
    async submit(request: ExecutiveWorkerJobRequest) {
      sequence += 1;
      return executiveWorkerJobSchema.parse({
        jobId: `postgres-council-job-${String(sequence).padStart(2, "0")}`,
        provider: this.provider,
        model: this.model,
        status: "completed",
        store: false,
        background: false,
        installationId: request.installationId,
        workspaceId: request.workspaceId,
        workId: request.workId,
        workerId: request.workerId,
        recommendation: {
          summary: "Synthetic PostgreSQL council recommendation.",
          evidenceRecordIds: request.evidence.map((item) => item.recordId),
          alternatives: [
            {
              title: "Remain bounded",
              description: "Use only the supplied synthetic evidence.",
              expectedOutcome: "A durable advisory record.",
              risks: ["Synthetic evidence can omit a material condition."],
            },
          ],
          recommendedAction: {
            title: "Open owner review",
            description: "Preserve owner authority.",
            capability: "executive.review",
            mode: "recommend",
            externalEffect: false,
          },
          confidence: 0.7,
          uncertainties: ["No outside sources were consulted."],
        },
      });
    },
    retrieve(job) {
      return Promise.resolve(job);
    },
  };
  const database = new Database({
    connectionString: runtimeDatabaseUrl,
    contextSigningSecret: contextSecret,
  });
  const resolver = new DatabaseExecutiveCouncilResolver(database, provider);
  const requester = {
    installationId: bootstrap.installationId,
    workspaceId: bootstrap.workspaceId,
    authUserId: ownerAuthUserId,
    aal: "aal2" as const,
    authTime: Math.floor(Date.now() / 1000),
  };
  try {
    await resolver.install(bootstrap.workId, requester);
    const advanced = await resolver.advance(bootstrap.workId, requester);
    requireCondition(
      advanced.counts.total === 1,
      "Real PostgreSQL council advance did not persist its first record",
    );
    const reread = await resolver.get(bootstrap.workId, requester);
    requireCondition(
      reread.counts.total === 1,
      "Real PostgreSQL council frozen-evidence read lost its durable record",
    );
  } finally {
    await database.close();
  }
}

async function main(): Promise<void> {
  const externalDatabaseUrl =
    process.env.VORTON_AUTHORITY_TEST_DATABASE_URL?.trim();
  const localPostgres = externalDatabaseUrl
    ? undefined
    : await startLocalPostgres();
  const adminDatabaseUrl =
    externalDatabaseUrl ?? localPostgres?.adminDatabaseUrl;
  requireCondition(adminDatabaseUrl, "PostgreSQL test database URL is missing");
  const admin = await connect(adminDatabaseUrl);

  try {
    const existing = await admin.query<{ installed: boolean }>(
      "select to_regclass('public.installations') is not null as installed",
    );
    requireCondition(
      !existing.rows[0]?.installed,
      "Authority test requires a fresh PostgreSQL database",
    );
    await admin.query(`
      create schema extensions;
      create schema auth;
      create role anon nologin noinherit;
      create role authenticated nologin noinherit;
      grant usage on schema extensions to anon, authenticated;
      create table auth.users (
        id uuid primary key,
        email text unique
      );
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    const migrations = await applyMigrations(admin);
    await admin.query(
      "insert into auth.users (id, email) values ($1, 'owner@synthetic.invalid')",
      [ownerAuthUserId],
    );

    const bootstrap = await runBootstrap(adminDatabaseUrl, runtimePassword);
    const originalPasswordHash = await rolePasswordHash(admin);
    const runtimeDatabaseUrl = databaseUrlForRole(
      adminDatabaseUrl,
      runtimeRole,
      runtimePassword,
    );
    const firstRuntimeLogin = await connect(runtimeDatabaseUrl);
    await firstRuntimeLogin.end();

    await runBootstrap(adminDatabaseUrl, replayPassword);
    requireCondition(
      (await rolePasswordHash(admin)) === originalPasswordHash,
      "Bootstrap replay changed the runtime password verifier",
    );
    await expectLoginRejected(
      databaseUrlForRole(adminDatabaseUrl, runtimeRole, replayPassword),
    );
    const replayRuntimeLogin = await connect(runtimeDatabaseUrl);
    await replayRuntimeLogin.end();

    await proveRoleShape(admin);
    const ownerPersonId = await seedAuthorityFixtures(admin, bootstrap);
    await proveWorkspaceResourceCoexistence(admin, bootstrap, ownerPersonId);
    await provePersonBoundary(runtimeDatabaseUrl, bootstrap, ownerPersonId);
    await proveWorkerBoundary(runtimeDatabaseUrl, bootstrap, ownerPersonId);
    await proveCouncilResolverFrozenEvidenceRead(runtimeDatabaseUrl, bootstrap);
    await proveCouncilBoundary(admin, runtimeDatabaseUrl, bootstrap);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          postgres: (await admin.query<{ version: string }>("select version()"))
            .rows[0]?.version,
          migrations,
          runtimeRole: {
            login: true,
            inherit: false,
            bypassRls: false,
            directTablePrivileges: 0,
            memberships: ["aubos_worker", "authenticated"],
            replayPreservedPassword: true,
          },
          boundaries: {
            unsignedAndForgedContextsDenied: true,
            signedPersonInstallationScoped: true,
            signedWorkerProposalAndRunScoped: true,
            sameNamedWorkspaceResourcesCoexist: true,
            personalAndOrganizationalMemoryBanksSeparated: true,
            workerHumanAuthorityDenied: true,
            councilAttemptFenced: true,
            councilStorageDenied: true,
            councilWorkRevisionBound: true,
            councilFrozenEvidenceReadBound: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await admin.end().catch(() => undefined);
    await localPostgres?.stop();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
