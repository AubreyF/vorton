import { createHash, createHmac, randomUUID } from "node:crypto";
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
  canonicalModuleLifecycleJson,
  executiveWorkerJobSchema,
  hashModuleLifecycleApprovalCore,
  hashModuleLifecycleApprovalReceipt,
  hashModuleLifecycleActionCommand,
  hashModuleLifecycleActionReceipt,
  hashWorkspaceMembershipRevocationApprovalCore,
  hashWorkspaceMembershipRevocationApprovalReceipt,
  hashWorkspaceMembershipRevocationReceipt,
  hashWorkspaceMembershipRevocationWorkSnapshot,
  hashWorkspaceCoreSurfaceSelectionApprovalCore,
  hashWorkspaceCoreSurfaceSelectionApprovalReceipt,
  hashWorkspaceCoreSurfaceSelectionReceipt,
  hashWorkspaceCoreSurfaceSelectionWorkSnapshot,
  hashWorkspaceCoreSurface,
  deriveWorkspaceCoreSurface,
  workspaceCompiledCoreSurfaceRegistrySha256,
  moduleLifecycleCanonicalSha256,
  parseModuleLifecycleActionCommandCreation,
  parseModuleLifecycleActionCompletion,
  parseModuleLifecycleApprovalCreation,
  parseWorkspaceMembershipRevocationApprovalCreation,
  parseWorkspaceMembershipRevocationReceipt,
  parseWorkspaceCoreSurfaceSelectionApprovalCreation,
  parseWorkspaceCoreSurfaceSelectionReceipt,
  type ExecutiveWorkerJobRequest,
  type ModuleLifecycleActionCompletion,
  type ModuleLifecycleApprovalCreation,
  type WorkspaceMembershipRevocationApprovalCreation,
  type WorkspaceMembershipRevocationReceipt,
  type WorkspaceCoreSurfaceSelectionApprovalCreation,
  type WorkspaceCoreSurfaceSelectionReceipt,
  type WorkspaceCoreSurface,
} from "@vorton/contracts";
import { Database } from "@vorton/database";
import type { ExecutiveWorkerProvider } from "@vorton/workers";

import { DatabaseExecutiveCouncilResolver } from "../apps/api/src/council-resolver.js";
import {
  addWorkspaceToExistingInstallation,
  buildWorkspaceAdditionPlan,
  type WorkspaceAdditionConfig,
} from "../deploy/workspaces/add-workspace.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(__dirname, "..");
const migrationDirectory = resolve(repositoryRoot, "supabase/migrations");
const runtimeRole = "aubos_runtime";
const runtimePassword = "synthetic-runtime-password-original-0001";
const replayPassword = "synthetic-runtime-password-replay-000002";
const contextSecret = "synthetic-context-signing-secret-000001";
const ownerAuthUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5"; // gitleaks:allow
const otherInstallationId = "36bb264a-668f-45a6-8da0-6e5cad3fc026";
const otherWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherWorkId = "02fb4603-57f1-4a04-a6f6-2d473af03f7b";
const otherWorkerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherRoleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherPolicyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const organizationalBankId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const personalBankId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const legacyInstallationId = "10101010-1010-4010-8010-101010101010";
const legacyOwnerAuthUserId = "20202020-2020-4020-8020-202020202020";
const legacyOwnerPersonId = "30303030-3030-4030-8030-303030303030";
const legacyWorkspaceId = "40404040-4040-4040-8040-404040404040";
const legacyBankId = "50505050-5050-4050-8050-505050505050";
const legacyCoreSurfaceInstallationId = "61616161-6161-4161-8161-616161616161";
const legacyCoreSurfaceOwnerAuthUserId = "62626262-6262-4262-8262-626262626262";
const legacyCoreSurfaceOwnerPersonId = "63636363-6363-4363-8363-636363636363";
const legacyCoreSurfaceWorkspaceId = "64646464-6464-4464-8464-646464646464";
const releaseAdoptionReceiptId = "88888888-8888-4888-8888-888888888888";
const workspaceCreationReceiptId = "99999999-9999-4999-8999-999999999999";

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

function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
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

async function seedLegacyMemoryBankBeforeIdentityMigration(
  admin: Client,
): Promise<void> {
  await admin.query(
    "insert into auth.users (id, email) values ($1, 'legacy-memory-owner@synthetic.invalid')",
    [legacyOwnerAuthUserId],
  );
  await admin.query(
    `insert into public.installations (id, slug, display_name, realm)
     values ($1, 'legacy-memory-fixture', 'Legacy Memory Fixture', 'organizational')`,
    [legacyInstallationId],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values ($1, $2, $3, 'Legacy Memory Owner', 'owner')`,
    [legacyOwnerPersonId, legacyInstallationId, legacyOwnerAuthUserId],
  );
  await admin.query(
    `insert into public.workspaces
       (id, installation_id, slug, display_name, realm, created_by_person_id)
     values ($1, $2, 'legacy-memory', 'Legacy Memory', 'organizational', $3)`,
    [legacyWorkspaceId, legacyInstallationId, legacyOwnerPersonId],
  );
  await admin.query(
    `insert into public.memory_banks
       (id, installation_id, workspace_id, installation_realm, adapter,
        external_bank_id, database_locator, object_bucket_locator)
     values ($1, $2, $3, 'organizational', 'hindsight',
             'legacy-unscoped-bank', 'postgres://legacy-memory-bank',
             'object://legacy-memory-bank')`,
    [legacyBankId, legacyInstallationId, legacyWorkspaceId],
  );
}

async function seedLegacyCoreSurfaceBeforeAuthorityMigration(
  admin: Client,
): Promise<void> {
  await admin.query(
    "insert into auth.users (id, email) values ($1, 'legacy-core-surface-owner@synthetic.invalid')",
    [legacyCoreSurfaceOwnerAuthUserId],
  );
  await admin.query(
    `insert into public.installations (id, slug, display_name, realm)
     values ($1, 'legacy-core-surface-fixture',
             'Legacy Core Surface Fixture', 'organizational')`,
    [legacyCoreSurfaceInstallationId],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values ($1, $2, $3, 'Legacy Core Surface Owner', 'owner')`,
    [
      legacyCoreSurfaceOwnerPersonId,
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceOwnerAuthUserId,
    ],
  );
  await admin.query(
    `insert into public.workspaces
       (id, installation_id, slug, display_name, realm, created_by_person_id)
     values ($1, $2, 'legacy-core-surface', 'Legacy Core Surface',
             'organizational', $3)`,
    [
      legacyCoreSurfaceWorkspaceId,
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceOwnerPersonId,
    ],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind, created_at)
     values ($1, $2, $3, 'owner', '2026-08-31T00:00:00.000Z')`,
    [
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceWorkspaceId,
      legacyCoreSurfaceOwnerPersonId,
    ],
  );
  await admin.query(
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id,
        created_at)
     values
       ($1, $2, 'command', 'v1', 'Legacy Command', 10, 'standard', $3,
        '2026-08-31T00:00:01.000Z'),
       ($1, $2, 'factory', 'v1', 'Legacy Factory', 20,
        'freed-read-only', $3, '2026-08-31T00:00:02.000Z')`,
    [
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceWorkspaceId,
      legacyCoreSurfaceOwnerPersonId,
    ],
  );
  await admin.query(
    `update public.workspaces set default_module_id = 'command'
      where installation_id = $1 and id = $2`,
    [legacyCoreSurfaceInstallationId, legacyCoreSurfaceWorkspaceId],
  );
  await admin.query(
    `create temporary table vorton_legacy_core_surface_preimage
       on commit preserve rows as
     select to_jsonb(activation) as row_document
       from public.workspace_module_activations activation
      where activation.installation_id = $1
        and activation.workspace_id = $2
      order by activation.navigation_order, activation.module_id`,
    [legacyCoreSurfaceInstallationId, legacyCoreSurfaceWorkspaceId],
  );
}

async function verifyLegacyCoreSurfaceUnchangedAfterAuthorityMigration(
  admin: Client,
): Promise<void> {
  const result = await admin.query<{
    preimage: unknown;
    current_rows: unknown;
    legacy_factory_rows: string;
    lineage_id: string | null;
    lineage_hash: string | null;
  }>(
    `select
       (select jsonb_agg(snapshot.row_document order by
          (snapshot.row_document->>'navigation_order')::integer,
          snapshot.row_document->>'module_id')
          from vorton_legacy_core_surface_preimage snapshot) as preimage,
       (select jsonb_agg(to_jsonb(activation) order by
          activation.navigation_order, activation.module_id)
          from public.workspace_module_activations activation
         where activation.installation_id = $1
           and activation.workspace_id = $2) as current_rows,
       (select count(*)::text
          from public.workspace_module_activations activation
         where activation.installation_id = $1
           and activation.workspace_id = $2
           and activation.module_id = 'factory'
           and activation.contract_version = 'v1'
           and activation.presentation_variant = 'freed-read-only')
         as legacy_factory_rows,
       workspace.core_surface_selection_receipt_id::text as lineage_id,
       workspace.core_surface_selection_receipt_hash as lineage_hash
      from public.workspaces workspace
     where workspace.installation_id = $1 and workspace.id = $2`,
    [legacyCoreSurfaceInstallationId, legacyCoreSurfaceWorkspaceId],
  );
  const row = result.rows[0];
  requireCondition(
    canonicalModuleLifecycleJson(row?.preimage) ===
      canonicalModuleLifecycleJson(row?.current_rows) &&
      row?.legacy_factory_rows === "1" &&
      row.lineage_id === null &&
      row.lineage_hash === null,
    "Core-surface authority migration rewrote or blessed legacy projection rows",
  );
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
    if (migrationName === "20260830000600_workspace_memory_bank_identity.sql") {
      await seedLegacyMemoryBankBeforeIdentityMigration(admin);
    }
    if (
      migrationName ===
      "20260831000400_workspace_core_surface_selection_authority.sql"
    ) {
      await seedLegacyCoreSurfaceBeforeAuthorityMigration(admin);
    }
    await admin.query(
      await readFile(join(migrationDirectory, migrationName), "utf8"),
    );
    if (
      migrationName ===
      "20260831000400_workspace_core_surface_selection_authority.sql"
    ) {
      await verifyLegacyCoreSurfaceUnchangedAfterAuthorityMigration(admin);
    }
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

async function setSignedInstallationStepUpContext(
  client: Client,
  installationId: string,
  subjectId: string,
  authTime: number,
): Promise<void> {
  await setSignedContext(client, "person", installationId, "*", subjectId);
  const transaction = await client.query<{ txid: string }>(
    "select txid_current()::text as txid",
  );
  const txid = transaction.rows[0]?.txid;
  requireCondition(txid, "PostgreSQL did not return a transaction ID");
  const signature = createHmac("sha256", contextSecret)
    .update(
      `${txid}|installation-person|${installationId}|${subjectId}|aal2|${String(authTime)}`,
    )
    .digest("hex");
  await client.query(
    `select set_config('vorton.aal', 'aal2', true),
            set_config('vorton.auth_time', $1, true),
            set_config('vorton.step_up_signature', $2, true)`,
    [String(authTime), signature],
  );
}

async function setWorkspaceStepUpContext(
  client: Client,
  installationId: string,
  workspaceId: string,
  subjectId: string,
  authTime: number,
  options: {
    aal?: "aal1" | "aal2";
    baseSignature?: "signed" | "unsigned" | "forged";
    stepUpSignature?: "signed" | "unsigned" | "forged";
  } = {},
): Promise<void> {
  const transaction = await client.query<{ txid: string }>(
    "select txid_current()::text as txid",
  );
  const txid = transaction.rows[0]?.txid;
  requireCondition(txid, "PostgreSQL did not return a transaction ID");
  const aal = options.aal ?? "aal2";
  const signedBase = createHmac("sha256", contextSecret)
    .update(`${txid}|person|${installationId}|${workspaceId}|${subjectId}|`)
    .digest("hex");
  const signedStepUp = createHmac("sha256", contextSecret)
    .update(
      `${txid}|workspace-person|${installationId}|${workspaceId}|${subjectId}|${aal}|${String(authTime)}`,
    )
    .digest("hex");
  const signatureValue = (
    kind: "signed" | "unsigned" | "forged" | undefined,
    signed: string,
  ): string => {
    if (kind === "unsigned") return "";
    if (kind === "forged") return "0".repeat(64);
    return signed;
  };
  const baseSignature = signatureValue(options.baseSignature, signedBase);
  const stepUpSignature = signatureValue(options.stepUpSignature, signedStepUp);
  await client.query(
    `select set_config('aubos.context_kind', 'person', true),
            set_config('aubos.installation_id', $1, true),
            set_config('aubos.subject_id', $3, true),
            set_config('aubos.credential_id', '', true),
            set_config('aubos.context_signature', $4, true),
            set_config('vorton.context_kind', 'person', true),
            set_config('vorton.installation_id', $1, true),
            set_config('vorton.workspace_id', $2, true),
            set_config('vorton.subject_id', $3, true),
            set_config('vorton.credential_id', '', true),
            set_config('vorton.context_signature', $4, true),
            set_config('vorton.workspace_step_up_aal', $5, true),
            set_config('vorton.workspace_step_up_auth_time', $6, true),
            set_config('vorton.workspace_step_up_signature', $7, true)`,
    [
      installationId,
      workspaceId,
      subjectId,
      baseSignature,
      aal,
      String(authTime),
      stepUpSignature,
    ],
  );
}

async function inRuntimeTransaction<T>(
  databaseUrl: string,
  role: "anon" | "authenticated" | "aubos_worker",
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

async function expectSqlState(
  client: Client,
  sql: string,
  values: unknown[],
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await client.query(sql, values);
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

async function expectConstraintViolation(
  client: Client,
  sql: string,
  values: unknown[],
  expectedConstraint: string,
  label: string,
): Promise<void> {
  try {
    await client.query(sql, values);
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    requireCondition(
      databaseError.code === "23514" &&
        databaseError.constraint === expectedConstraint,
      `${label} failed with SQLSTATE ${databaseError.code ?? "unknown"} on ${databaseError.constraint ?? "an unknown constraint"}`,
    );
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function expectRuntimeDenied(
  databaseUrl: string,
  role: "anon" | "authenticated" | "aubos_worker",
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

async function expectRuntimeSqlStateAndMessage(
  databaseUrl: string,
  role: "authenticated" | "aubos_worker",
  setup: (client: Client) => Promise<void>,
  sql: string,
  values: unknown[],
  expectedCode: string,
  expectedMessage: string,
  label: string,
): Promise<void> {
  try {
    await inRuntimeTransaction(databaseUrl, role, setup, (client) =>
      client.query(sql, values),
    );
  } catch (error) {
    const databaseError = error as { code?: string; message?: string };
    requireCondition(
      databaseError.code === expectedCode &&
        databaseError.message === expectedMessage,
      `${label} failed with SQLSTATE ${databaseError.code ?? "unknown"} and ${databaseError.message ?? "no message"}`,
    );
    return;
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function seedAuthorityFixtures(
  admin: Client,
  adminDatabaseUrl: string,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
): Promise<string> {
  const owner = await admin.query<{ id: string }>(
    "select id from public.people where installation_id = $1 and auth_user_id = $2",
    [bootstrap.installationId, ownerAuthUserId],
  );
  const ownerPersonId = owner.rows[0]?.id;
  requireCondition(ownerPersonId, "Bootstrap owner was not persisted");
  const releasePlanHash = `sha256:${"1".repeat(64)}`;
  const manifestSha256 = `sha256:${"2".repeat(64)}`;
  const archiveSha256 = `sha256:${"3".repeat(64)}`;
  const workspaceIsolationProofSha256 = `sha256:${"4".repeat(64)}`;
  const workspaceIsolationProofHash = `sha256:${"5".repeat(64)}`;
  const release = {
    version: "0.4.0",
    sourceCommit: "a".repeat(40),
    manifestSha256,
    archiveSha256,
    coreMigrationHead: "20260830000200_workspace_creation_authority",
    workspaceIsolationProofSha256,
    workspaceIsolationProofHash,
    imageDigests: {
      "control-plane": `sha256:${"6".repeat(64)}`,
      web: `sha256:${"7".repeat(64)}`,
      worker: `sha256:${"8".repeat(64)}`,
    },
  };
  const authTime = Math.floor(Date.now() / 1000);
  const createReleaseApproval = async (validFor: string): Promise<string> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      (client) =>
        setSignedInstallationStepUpContext(
          client,
          bootstrap.installationId,
          ownerAuthUserId,
          authTime,
        ),
      async (client) => {
        const result = await client.query<{ id: string }>(
          `select public.create_release_adoption_approval(
            $1, $2, $3, $4::jsonb, clock_timestamp() + $5::interval
          )->>'approvalId' as id`,
          [
            randomUUID(),
            bootstrap.installationId,
            releasePlanHash,
            JSON.stringify(release),
            validFor,
          ],
        );
        const id = result.rows[0]?.id;
        requireCondition(id, "Release adoption approval was not recorded");
        return id;
      },
    );
  const expectInvalidReleaseApproval = async (
    exactReleaseJson: string,
    label: string,
  ): Promise<void> => {
    try {
      await inRuntimeTransaction(
        runtimeDatabaseUrl,
        "authenticated",
        (client) =>
          setSignedInstallationStepUpContext(
            client,
            bootstrap.installationId,
            ownerAuthUserId,
            authTime,
          ),
        (client) =>
          client.query(
            `select public.create_release_adoption_approval(
              $1, $2, $3, $4::jsonb, clock_timestamp() + interval '1 hour'
            )`,
            [
              randomUUID(),
              bootstrap.installationId,
              releasePlanHash,
              exactReleaseJson,
            ],
          ),
      );
    } catch (error) {
      requireCondition(
        (error as { code?: string }).code === "P0001",
        `${label} failed with the wrong SQL state`,
      );
      return;
    }
    throw new Error(`${label} unexpectedly succeeded`);
  };
  await expectInvalidReleaseApproval(
    JSON.stringify({ ...release, version: {} }),
    "Object release version approval",
  );
  await expectInvalidReleaseApproval(
    JSON.stringify({ ...release, version: true }),
    "Boolean release version approval",
  );
  await expectInvalidReleaseApproval(
    JSON.stringify({ ...release, version: "0.04.0" }),
    "Leading-zero release version approval",
  );
  await expectInvalidReleaseApproval(
    JSON.stringify({ ...release, version: "1.2.3-01" }),
    "Leading-zero numeric prerelease approval",
  );
  await expectInvalidReleaseApproval(
    JSON.stringify(release).replace(
      `"sourceCommit":"${release.sourceCommit}"`,
      `"sourceCommit":${"1".repeat(40)}`,
    ),
    "Numeric release source commit approval",
  );
  const skewAcceptedRelease = {
    ...release,
    version: "1.2.3-1a+build.1",
  };
  await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    (client) =>
      setSignedInstallationStepUpContext(
        client,
        bootstrap.installationId,
        ownerAuthUserId,
        Math.floor(Date.now() / 1000) + 30,
      ),
    async (client) => {
      const result = await client.query<{ contract: string }>(
        `select public.create_release_adoption_approval(
          $1, $2, $3, $4::jsonb, clock_timestamp() + interval '1 hour'
        )->>'contract' as contract`,
        [
          randomUUID(),
          bootstrap.installationId,
          releasePlanHash,
          JSON.stringify(skewAcceptedRelease),
        ],
      );
      requireCondition(
        result.rows[0]?.contract === "vorton.release-adoption-approval.v1",
        "Canonical prerelease/build release with +30 second AAL2 skew was rejected",
      );
    },
  );
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "authenticated",
    (client) =>
      setSignedInstallationStepUpContext(
        client,
        bootstrap.installationId,
        ownerAuthUserId,
        Math.ceil(Date.now() / 1000) + 61,
      ),
    `select public.create_release_adoption_approval(
      $1, $2, $3, $4::jsonb, clock_timestamp() + interval '1 hour'
    )`,
    [
      randomUUID(),
      bootstrap.installationId,
      releasePlanHash,
      JSON.stringify(release),
    ],
    "P0001",
    "+61 second AAL2 skew release approval",
  );
  const releaseApprovalId = await createReleaseApproval("1 hour");
  const substitutionReceiptId = "77777777-7777-4777-8777-777777777777";
  for (const [name, substituted] of [
    ["version", { ...release, version: "0.4.1" }],
    [
      "core migration head",
      { ...release, coreMigrationHead: "20260830000100_workspaces" },
    ],
    [
      "proof byte digest",
      {
        ...release,
        workspaceIsolationProofSha256: `sha256:${"9".repeat(64)}`,
      },
    ],
    [
      "proof canonical hash",
      {
        ...release,
        workspaceIsolationProofHash: `sha256:${"a".repeat(64)}`,
      },
    ],
    [
      "image digests",
      {
        ...release,
        imageDigests: {
          ...release.imageDigests,
          worker: `sha256:${"b".repeat(64)}`,
        },
      },
    ],
    [
      "null image digest",
      {
        ...release,
        imageDigests: { ...release.imageDigests, worker: null },
      },
    ],
  ] as const) {
    try {
      await admin.query(
        `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb)`,
        [
          bootstrap.installationId,
          releaseApprovalId,
          substitutionReceiptId,
          releasePlanHash,
          JSON.stringify(substituted),
        ],
      );
    } catch (error) {
      requireCondition(
        (error as { code?: string }).code === "P0001",
        `Release ${name} substitution did not fail closed`,
      );
      continue;
    }
    throw new Error(`Release ${name} substitution unexpectedly succeeded`);
  }
  await expectSqlState(
    admin,
    `select public.apply_release_adoption($1, $2, $2, $3, $4::jsonb)`,
    [
      bootstrap.installationId,
      releaseApprovalId,
      releasePlanHash,
      JSON.stringify(release),
    ],
    "P0001",
    "Release adoption receipt and approval ID reuse",
  );
  const concurrentApprovalId = await createReleaseApproval("1 hour");
  const concurrentReceiptId = "66666666-6666-4666-8666-666666666666";
  const concurrentLeft = await connect(adminDatabaseUrl);
  const concurrentRight = await connect(adminDatabaseUrl);
  try {
    const applyConcurrent = (client: Client) =>
      client.query<{ document: Record<string, unknown> }>(
        `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb) as document`,
        [
          bootstrap.installationId,
          concurrentApprovalId,
          concurrentReceiptId,
          releasePlanHash,
          JSON.stringify(release),
        ],
      );
    const [left, right] = await Promise.all([
      applyConcurrent(concurrentLeft),
      applyConcurrent(concurrentRight),
    ]);
    requireCondition(
      JSON.stringify(left.rows[0]?.document) ===
        JSON.stringify(right.rows[0]?.document),
      "Concurrent exact release applies did not converge on one receipt",
    );
    requireCondition(
      left.rows[0]?.document.approvalConsumptionCount === 1,
      "Concurrent exact release applies consumed approval more than once",
    );
    await expectSqlState(
      admin,
      `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb)`,
      [
        bootstrap.installationId,
        concurrentApprovalId,
        substitutionReceiptId,
        releasePlanHash,
        JSON.stringify(release),
      ],
      "P0001",
      "Concurrent release adoption conflicting receipt retry",
    );
  } finally {
    await concurrentLeft.end();
    await concurrentRight.end();
  }

  const expiringApprovalId = await createReleaseApproval("1500 milliseconds");
  const expiringReceiptId = "55555555-5555-4555-8555-555555555555";
  const firstExpiring = await admin.query<{
    document: Record<string, unknown>;
  }>(
    `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb) as document`,
    [
      bootstrap.installationId,
      expiringApprovalId,
      expiringReceiptId,
      releasePlanHash,
      JSON.stringify(release),
    ],
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1700));
  const expiredReplay = await admin.query<{
    document: Record<string, unknown>;
  }>(
    `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb) as document`,
    [
      bootstrap.installationId,
      expiringApprovalId,
      expiringReceiptId,
      releasePlanHash,
      JSON.stringify(release),
    ],
  );
  requireCondition(
    JSON.stringify(firstExpiring.rows[0]?.document) ===
      JSON.stringify(expiredReplay.rows[0]?.document),
    "Exact release adoption replay failed after approval expiry",
  );
  await expectSqlState(
    admin,
    `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb)`,
    [
      bootstrap.installationId,
      expiringApprovalId,
      substitutionReceiptId,
      releasePlanHash,
      JSON.stringify(release),
    ],
    "P0001",
    "Expired release adoption conflicting receipt retry",
  );
  await admin.query(
    `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb)`,
    [
      bootstrap.installationId,
      releaseApprovalId,
      releaseAdoptionReceiptId,
      releasePlanHash,
      JSON.stringify(release),
    ],
  );
  const persistedReleaseReceipt = (
    await admin.query<{
      adopted_at: Date;
      approval_consumed_at: Date;
      approval_consumption_count: number;
      approval_id: string;
      installation_id: string;
      owner_person_id: string;
      plan_hash: string;
      receipt_hash: string;
      release: typeof release;
      state: Record<string, boolean>;
    }>(
      `select adopted_at, approval_consumed_at, approval_consumption_count,
              approval_id::text, installation_id::text, owner_person_id::text,
              plan_hash, receipt_hash, release, state
         from public.release_adoption_receipts
        where installation_id = $1 and id = $2`,
      [bootstrap.installationId, releaseAdoptionReceiptId],
    )
  ).rows[0];
  requireCondition(persistedReleaseReceipt, "Release receipt cannot be read");
  const releaseReceipt = persistedReleaseReceipt;
  const receiptDocument = {
    contract: "vorton.release-adoption-receipt.v1",
    receiptId: releaseAdoptionReceiptId,
    receiptPlane: "installation-postgres",
    installationId: persistedReleaseReceipt.installation_id,
    ownerPersonId: persistedReleaseReceipt.owner_person_id,
    approvalId: persistedReleaseReceipt.approval_id,
    planHash: persistedReleaseReceipt.plan_hash,
    release: persistedReleaseReceipt.release,
    status: "adopted",
    adoptedAt: persistedReleaseReceipt.adopted_at.toISOString(),
    approvalConsumedAt:
      persistedReleaseReceipt.approval_consumed_at.toISOString(),
    approvalConsumptionCount:
      persistedReleaseReceipt.approval_consumption_count,
    state: persistedReleaseReceipt.state,
  };
  requireCondition(
    persistedReleaseReceipt.receipt_hash === canonicalSha256(receiptDocument),
    "PostgreSQL release adoption receipt hash is not canonical",
  );
  await expectSqlState(
    admin,
    "update public.release_adoption_receipts set receipt_hash = $1 where installation_id = $2 and id = $3",
    [
      `sha256:${"0".repeat(64)}`,
      bootstrap.installationId,
      releaseAdoptionReceiptId,
    ],
    "P0001",
    "Release adoption receipt hash substitution",
  );
  await admin.query(
    "update public.people set kind = 'member' where installation_id = $1 and id = $2",
    [bootstrap.installationId, ownerPersonId],
  );
  try {
    const replay = await admin.query<{ receipt_hash: string }>(
      `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb)
                ->>'receiptHash' as receipt_hash`,
      [
        bootstrap.installationId,
        releaseApprovalId,
        releaseAdoptionReceiptId,
        releasePlanHash,
        JSON.stringify(release),
      ],
    );
    requireCondition(
      replay.rows[0]?.receipt_hash === releaseReceipt.receipt_hash,
      "Exact release adoption retry did not return the immutable receipt",
    );
    await expectSqlState(
      admin,
      `select public.apply_release_adoption($1, $2, $3, $4, $5::jsonb)`,
      [
        bootstrap.installationId,
        releaseApprovalId,
        substitutionReceiptId,
        releasePlanHash,
        JSON.stringify(release),
      ],
      "P0001",
      "Conflicting release adoption retry",
    );
  } finally {
    await admin.query(
      "update public.people set kind = 'owner' where installation_id = $1 and id = $2",
      [bootstrap.installationId, ownerPersonId],
    );
  }
  const workspaceConfig: WorkspaceAdditionConfig = {
    installationId: bootstrap.installationId,
    personId: ownerPersonId,
    authUserId: ownerAuthUserId,
    workspaceId: otherWorkspaceId,
    workspaceSlug: "aubos",
    workspaceDisplayName: "AubOS cloud",
    workspaceRealm: "personal",
    adoptedRelease: {
      adoptionReceiptId: releaseAdoptionReceiptId,
      adoptionReceiptSha256: releaseReceipt.receipt_hash,
      receiptPlane: "installation-postgres",
      manifestSha256,
      sourceCommit: release.sourceCommit,
      migrationHead: release.coreMigrationHead,
      workspaceIsolationProofSha256,
      workspaceIsolationProofHash,
      status: "adopted",
      adoptedAt: releaseReceipt.adopted_at.toISOString(),
    },
  };
  const workspacePlan = buildWorkspaceAdditionPlan(workspaceConfig);
  const forgedStepUp = async (client: Client): Promise<void> => {
    await setSignedContext(
      client,
      "person",
      bootstrap.installationId,
      "*",
      ownerAuthUserId,
    );
    await client.query(
      `select set_config('vorton.aal', 'aal2', true),
              set_config('vorton.auth_time', $1, true),
              set_config('vorton.step_up_signature', '', true)`,
      [String(authTime)],
    );
  };
  const workspaceApprovalId = randomUUID();
  const approvalSql = `select public.create_workspace_creation_approval(
    $1, $2, $3, 'aubos', 'AubOS cloud', 'personal', $4, $5, $6
  )->>'approvalId' as id`;
  const approvalValues = [
    workspaceApprovalId,
    bootstrap.installationId,
    otherWorkspaceId,
    releaseAdoptionReceiptId,
    releaseReceipt.receipt_hash,
    workspacePlan.workspacePlanSha256,
  ];
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "authenticated",
    forgedStepUp,
    approvalSql,
    approvalValues,
    "P0001",
    "Unsigned step-up workspace creation approval",
  );
  const approvalId = await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    (client) =>
      setSignedInstallationStepUpContext(
        client,
        bootstrap.installationId,
        ownerAuthUserId,
        authTime,
      ),
    async (client) => {
      const result = await client.query<{ id: string }>(
        approvalSql,
        approvalValues,
      );
      const id = result.rows[0]?.id;
      requireCondition(id, "Workspace creation approval was not recorded");
      return id;
    },
  );
  const applyClient = await connect(adminDatabaseUrl);
  const demotionClient = await connect(adminDatabaseUrl);
  try {
    await applyClient.query("begin");
    await applyClient.query(
      "select id from public.apply_workspace_creation($1, $2, $3, $4)",
      [
        bootstrap.installationId,
        approvalId,
        workspaceCreationReceiptId,
        workspacePlan.workspacePlanSha256,
      ],
    );
    await demotionClient.query("begin");
    let demotionSettled = false;
    const demotion = demotionClient
      .query(
        "update public.people set kind = 'member' where installation_id = $1 and id = $2",
        [bootstrap.installationId, ownerPersonId],
      )
      .finally(() => {
        demotionSettled = true;
      });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    requireCondition(
      !demotionSettled,
      "Workspace apply did not hold the live owner row through transaction commit",
    );
    await applyClient.query("commit");
    await demotion;
    await demotionClient.query("rollback");
  } catch (error) {
    await applyClient.query("rollback").catch(() => undefined);
    await demotionClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await applyClient.end();
    await demotionClient.end();
  }
  const addition = await addWorkspaceToExistingInstallation(
    admin,
    workspaceConfig,
    {
      approvalId,
      receiptId: workspaceCreationReceiptId,
      expectedWorkspacePlanSha256: workspacePlan.workspacePlanSha256,
    },
  );
  requireCondition(
    addition.status === "already-applied",
    "Workspace addition did not reconcile its atomic PostgreSQL receipt",
  );
  await admin.query(
    "update public.people set kind = 'member' where installation_id = $1 and id = $2",
    [bootstrap.installationId, ownerPersonId],
  );
  try {
    await admin.query(
      "select id from public.apply_workspace_creation($1, $2, $3, $4)",
      [
        bootstrap.installationId,
        approvalId,
        workspaceCreationReceiptId,
        workspacePlan.workspacePlanSha256,
      ],
    );
    await expectSqlState(
      admin,
      "select id from public.apply_workspace_creation($1, $2, $3, $4)",
      [
        bootstrap.installationId,
        approvalId,
        substitutionReceiptId,
        workspacePlan.workspacePlanSha256,
      ],
      "P0001",
      "Conflicting workspace creation retry",
    );
  } finally {
    await admin.query(
      "update public.people set kind = 'owner' where installation_id = $1 and id = $2",
      [bootstrap.installationId, ownerPersonId],
    );
  }
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
        $6, 'postgres://organizational-bank',
        'object://organizational-bank'),
       ($4, $2, $5, 'personal', 'hindsight',
        $7, 'postgres://personal-bank',
        'object://personal-bank')`,
    [
      organizationalBankId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      personalBankId,
      otherWorkspaceId,
      `organizational:${bootstrap.installationId}:${bootstrap.workspaceId}:lineage-v2`,
      `personal:${bootstrap.installationId}:${otherWorkspaceId}:lineage-v2`,
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

async function proveContextGatewayMemoryBankAuthority(
  admin: Client,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  type ResolutionRow = {
    external_bank_id: string;
    installation_realm: "personal" | "organizational";
    principal_kind: "person" | "worker";
    principal_id: string;
    context_subject_id: string;
    capability_grant_id: string;
    capability: string;
    capability_mode: "observe" | "modify";
    data_classification_ceiling:
      "public" | "internal" | "confidential" | "restricted" | "synthetic";
  };
  type ResolverSetup = (client: Client) => Promise<void>;

  const evidence = await admin.query<{
    id: string;
    classification: "synthetic";
  }>(
    `select id::text, classification::text
       from public.records
      where installation_id = $1 and workspace_id = $2 and kind = 'evidence'
      order by created_at limit 1`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  const sourceRevisionId = evidence.rows[0]?.id;
  requireCondition(
    sourceRevisionId,
    "Context Gateway source proof has no authoritative evidence fixture",
  );
  const connection = await admin.query<{ id: string }>(
    `select id::text from public.source_connections
      where installation_id = $1 and workspace_id = $2
      order by created_at limit 1`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  const connectionId = connection.rows[0]?.id;
  requireCondition(
    connectionId,
    "Context Gateway source proof has no source connection fixture",
  );
  const sourceRevisionHash = createHash("sha256")
    .update("synthetic-context-gateway-source")
    .digest("hex");
  await admin.query(
    `insert into public.transcript_revisions (
       id, installation_id, workspace_id, installation_realm, connection_id,
       provider, provider_object_id, revision_hash, title, started_at,
       participants, provider_observed_at, ingested_at, adapter_version,
       classification, completeness, boundary, admission_state
     ) values (
       $1, $2, $3, 'organizational', $4, 'google-meet',
       'synthetic-context-gateway-source', $5,
       'Synthetic Context Gateway source', clock_timestamp(), '[]'::jsonb,
       clock_timestamp(), clock_timestamp(), 'synthetic-v1', 'synthetic',
       'complete', 'organizational', 'admitted'
     )`,
    [
      sourceRevisionId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      connectionId,
      sourceRevisionHash,
    ],
  );
  await admin.query(
    `insert into public.source_citations (
       installation_id, workspace_id, installation_realm,
       transcript_revision_id, source_uri, revision_hash, locator
     ) values ($1, $2, 'organizational', $3,
               'urn:vorton:synthetic:context-gateway', $4, 'fixture:1')`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      sourceRevisionId,
      sourceRevisionHash,
    ],
  );
  await admin.query(
    `insert into public.memory_candidates (
       installation_id, workspace_id, installation_realm,
       source_revision_id, bank_id, candidate_text,
       admission_state, admitted_at
     ) values ($1, $2, 'organizational', $3, $4,
               'Synthetic Context Gateway candidate', 'admitted',
               clock_timestamp())`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      sourceRevisionId,
      organizationalBankId,
    ],
  );
  const publicSourceRevisionId = randomUUID();
  const publicSourceRevisionHash = createHash("sha256")
    .update("public-context-gateway-source")
    .digest("hex");
  await admin.query(
    `insert into public.transcript_revisions (
       id, installation_id, workspace_id, installation_realm, connection_id,
       provider, provider_object_id, revision_hash, title, started_at,
       participants, provider_observed_at, ingested_at, adapter_version,
       classification, completeness, boundary, admission_state
     ) values (
       $1, $2, $3, 'organizational', $4, 'google-meet',
       'public-context-gateway-source', $5,
       'Public Context Gateway source', clock_timestamp(), '[]'::jsonb,
       clock_timestamp(), clock_timestamp(), 'fixture-v1', 'public',
       'complete', 'organizational', 'admitted'
     )`,
    [
      publicSourceRevisionId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      connectionId,
      publicSourceRevisionHash,
    ],
  );
  await admin.query(
    `insert into public.source_citations (
       installation_id, workspace_id, installation_realm,
       transcript_revision_id, source_uri, revision_hash, locator
     ) values ($1, $2, 'organizational', $3,
               'urn:vorton:public:context-gateway', $4, 'fixture:public')`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      publicSourceRevisionId,
      publicSourceRevisionHash,
    ],
  );
  await admin.query(
    `insert into public.memory_candidates (
       installation_id, workspace_id, installation_realm,
       source_revision_id, bank_id, candidate_text,
       admission_state, admitted_at
     ) values ($1, $2, 'organizational', $3, $4,
               'Public Context Gateway candidate', 'admitted',
               clock_timestamp())`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      publicSourceRevisionId,
      organizationalBankId,
    ],
  );
  const hostileSourceIds = {
    pending: randomUUID(),
    quarantined: randomUUID(),
    deleted: randomUUID(),
    superseded: randomUUID(),
    successor: randomUUID(),
  };
  const seedSourceRevision = async (input: {
    id: string;
    label: string;
    admissionState: "pending" | "admitted" | "quarantined";
    boundary: "organizational" | "mixed";
    deleted: boolean;
    supersedesRevisionId?: string;
    candidateState?: "pending" | "admitted" | "quarantined";
  }): Promise<void> => {
    const revisionHash = createHash("sha256").update(input.label).digest("hex");
    await admin.query(
      `insert into public.transcript_revisions (
         id, installation_id, workspace_id, installation_realm, connection_id,
         provider, provider_object_id, revision_hash, title, started_at,
         participants, provider_observed_at, ingested_at, adapter_version,
         classification, completeness, boundary, admission_state, deleted_at,
         supersedes_revision_id
       ) values (
         $1, $2, $3, 'organizational', $4, 'google-meet', $5, $6, $5,
         clock_timestamp(), '[]'::jsonb, clock_timestamp(), clock_timestamp(),
         'synthetic-v1', 'synthetic', 'complete', $7, $8::public.admission_state,
         case when $9 then clock_timestamp() else null end, $10
       )`,
      [
        input.id,
        bootstrap.installationId,
        bootstrap.workspaceId,
        connectionId,
        input.label,
        revisionHash,
        input.boundary,
        input.admissionState,
        input.deleted,
        input.supersedesRevisionId ?? null,
      ],
    );
    await admin.query(
      `insert into public.source_citations (
         installation_id, workspace_id, installation_realm,
         transcript_revision_id, source_uri, revision_hash, locator
       ) values ($1, $2, 'organizational', $3, $4, $5, 'fixture:hostile')`,
      [
        bootstrap.installationId,
        bootstrap.workspaceId,
        input.id,
        `urn:vorton:synthetic:${input.label}`,
        revisionHash,
      ],
    );
    if (input.candidateState) {
      await admin.query(
        `insert into public.memory_candidates (
           installation_id, workspace_id, installation_realm,
           source_revision_id, bank_id, candidate_text, admission_state,
           admitted_at, quarantined_at
         ) values (
           $1, $2, 'organizational', $3,
           case when $4 = 'admitted' then $5::uuid else null end,
           'Synthetic hostile source candidate', $4::public.admission_state,
           case when $4 = 'admitted' then clock_timestamp() else null end,
           case when $4 = 'quarantined' then clock_timestamp() else null end
         )`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          input.id,
          input.candidateState,
          organizationalBankId,
        ],
      );
    }
  };
  await seedSourceRevision({
    id: hostileSourceIds.pending,
    label: "context-gateway-pending",
    admissionState: "pending",
    boundary: "organizational",
    deleted: false,
    candidateState: "pending",
  });
  await seedSourceRevision({
    id: hostileSourceIds.quarantined,
    label: "context-gateway-quarantined",
    admissionState: "quarantined",
    boundary: "mixed",
    deleted: false,
    candidateState: "quarantined",
  });
  await seedSourceRevision({
    id: hostileSourceIds.deleted,
    label: "context-gateway-deleted",
    admissionState: "admitted",
    boundary: "organizational",
    deleted: true,
    candidateState: "admitted",
  });
  await seedSourceRevision({
    id: hostileSourceIds.superseded,
    label: "context-gateway-superseded",
    admissionState: "admitted",
    boundary: "organizational",
    deleted: false,
    candidateState: "admitted",
  });
  await seedSourceRevision({
    id: hostileSourceIds.successor,
    label: "context-gateway-successor",
    admissionState: "admitted",
    boundary: "organizational",
    deleted: false,
    supersedesRevisionId: hostileSourceIds.superseded,
  });

  const memoryCounts = async (): Promise<Record<string, string>> => {
    const result = await admin.query<Record<string, string>>(
      `select
         (select count(*)::text from public.memory_banks) as banks,
         (select count(*)::text from public.memory_candidates) as candidates,
         (select count(*)::text from public.derived_memories) as memories,
         (select count(*)::text from public.consolidation_lineage) as lineage,
         (select count(*)::text from public.retrieval_receipts) as receipts`,
    );
    const row = result.rows[0];
    requireCondition(row, "Context Gateway memory baseline is missing");
    return row;
  };
  const baselineMemoryCounts = await memoryCounts();

  const resolveBank = (
    role: "authenticated" | "aubos_worker",
    setup: ResolverSetup,
    installationId: string,
    workspaceId: string,
    operation: "retain" | "consolidate" | "retrieve" | "invalidate",
    workId: string | null = null,
  ): Promise<ResolutionRow[]> =>
    inRuntimeTransaction(runtimeDatabaseUrl, role, setup, async (client) => {
      const result = await client.query<ResolutionRow>(
        `select external_bank_id, installation_realm::text,
                principal_kind::text, principal_id::text,
                context_subject_id::text, capability_grant_id::text,
                capability,
                capability_mode::text, data_classification_ceiling::text
           from public.resolve_context_gateway_memory_bank(
             $1, $2, $3::public.context_gateway_operation, $4
           )`,
        [installationId, workspaceId, operation, workId],
      );
      return result.rows;
    });
  type SourceMaterialRow = {
    source_revision_id: string;
    classification: string;
    source_uri: string;
    revision_hash: string;
    locator: string;
    external_bank_id: string;
    data_classification_ceiling: string;
  };
  const resolveSourceMaterial = (
    role: "authenticated" | "aubos_worker",
    setup: ResolverSetup,
    installationId: string,
    workspaceId: string,
    realm: "personal" | "organizational",
    workId: string | null,
    sourceRevisionIds: string[],
  ): Promise<SourceMaterialRow[]> =>
    inRuntimeTransaction(runtimeDatabaseUrl, role, setup, async (client) => {
      const result = await client.query<SourceMaterialRow>(
        `select source_revision_id::text, classification::text, source_uri,
                revision_hash, locator, external_bank_id,
                data_classification_ceiling::text
           from public.resolve_context_gateway_source_material(
             $1, $2, $3::public.installation_realm, $4, $5::uuid[]
           )`,
        [installationId, workspaceId, realm, workId, sourceRevisionIds],
      );
      return result.rows;
    });
  const expectNoResolution = async (
    label: string,
    role: "authenticated" | "aubos_worker",
    setup: ResolverSetup,
    installationId: string,
    workspaceId: string,
    operation: "retain" | "consolidate" | "retrieve" | "invalidate",
    workId: string | null = null,
  ): Promise<void> => {
    const rows = await resolveBank(
      role,
      setup,
      installationId,
      workspaceId,
      operation,
      workId,
    );
    requireCondition(
      rows.length === 0,
      `${label} unexpectedly resolved a bank`,
    );
  };
  const expectResolution = async (
    label: string,
    role: "authenticated" | "aubos_worker",
    setup: ResolverSetup,
    installationId: string,
    workspaceId: string,
    operation: "retain" | "consolidate" | "retrieve" | "invalidate",
    workId: string | null,
    expected: ResolutionRow,
  ): Promise<void> => {
    const rows = await resolveBank(
      role,
      setup,
      installationId,
      workspaceId,
      operation,
      workId,
    );
    requireCondition(rows.length === 1, `${label} did not resolve one bank`);
    requireCondition(
      JSON.stringify(rows[0]) === JSON.stringify(expected),
      `${label} returned an unexpected authority projection`,
    );
    requireCondition(
      JSON.stringify(Object.keys(rows[0] ?? {}).sort()) ===
        JSON.stringify(
          [
            "capability",
            "capability_grant_id",
            "capability_mode",
            "context_subject_id",
            "data_classification_ceiling",
            "external_bank_id",
            "installation_realm",
            "principal_id",
            "principal_kind",
          ].sort(),
        ),
      `${label} exposed an unexpected bank, storage, or credential field`,
    );
  };

  const policy = await admin.query<{ id: string }>(
    `select id::text from public.policies
      where installation_id = $1 and workspace_id = $2
      order by created_at limit 1`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  const policyId = policy.rows[0]?.id;
  requireCondition(policyId, "Context Gateway Policy fixture is missing");
  const roleAssignment = await admin.query<{ count: string }>(
    `select count(*)::text as count
       from public.worker_role_assignments
      where installation_id = $1 and workspace_id = $2 and worker_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, bootstrap.workerId],
  );
  requireCondition(
    Number(roleAssignment.rows[0]?.count ?? "0") > 0,
    "Context Gateway role-only hostile proof has no worker role fixture",
  );
  const preexistingMemoryGrants = await admin.query<{ count: string }>(
    `select count(*)::text as count
       from public.capability_grants
      where capability like 'memory.%'`,
  );
  requireCondition(
    preexistingMemoryGrants.rows[0]?.count === "0",
    "Context Gateway proof started with unexpected memory capabilities",
  );

  const validCredentialId = randomUUID();
  const revokedCredentialId = randomUUID();
  const expiredCredentialId = randomUUID();
  const futureCredentialId = randomUUID();
  await admin.query(
    `insert into public.worker_credentials (
       id, installation_id, workspace_id, worker_id, token_hash, token_hint,
       issued_at, expires_at, issued_by_person_id
     ) values
       ($1, $5, $6, $7,
        extensions.digest(convert_to($1::uuid::text, 'UTF8'), 'sha256'),
        'ctx-valid', clock_timestamp() - interval '1 minute',
        clock_timestamp() + interval '10 minutes', $8),
       ($2, $5, $6, $7,
        extensions.digest(convert_to($2::uuid::text, 'UTF8'), 'sha256'),
        'ctx-revoked', clock_timestamp() - interval '1 minute',
        clock_timestamp() + interval '10 minutes', $8),
       ($3, $5, $6, $7,
        extensions.digest(convert_to($3::uuid::text, 'UTF8'), 'sha256'),
        'ctx-expired', clock_timestamp() - interval '10 minutes',
        clock_timestamp() - interval '1 minute', $8),
       ($4, $5, $6, $7,
        extensions.digest(convert_to($4::uuid::text, 'UTF8'), 'sha256'),
        'ctx-future', clock_timestamp() + interval '1 minute',
        clock_timestamp() + interval '10 minutes', $8)`,
    [
      validCredentialId,
      revokedCredentialId,
      expiredCredentialId,
      futureCredentialId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
      ownerPersonId,
    ],
  );
  await admin.query(
    `insert into public.worker_credential_revocations (
       id, installation_id, workspace_id, credential_id,
       revoked_by_person_id, reason
     ) values ($1, $2, $3, $4, $5, 'Synthetic Context Gateway proof')`,
    [
      randomUUID(),
      bootstrap.installationId,
      bootstrap.workspaceId,
      revokedCredentialId,
      ownerPersonId,
    ],
  );

  const signedPerson =
    (
      installationId = bootstrap.installationId,
      workspaceId = bootstrap.workspaceId,
      authUserId = ownerAuthUserId,
    ): ResolverSetup =>
    (client) =>
      setSignedContext(
        client,
        "person",
        installationId,
        workspaceId,
        authUserId,
      );
  const signedWorker =
    (credentialId: string): ResolverSetup =>
    (client) =>
      setSignedContext(
        client,
        "worker",
        bootstrap.installationId,
        bootstrap.workspaceId,
        bootstrap.workerId,
        credentialId,
      );
  const unsignedPerson: ResolverSetup = async (client) => {
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
  const forgedPerson: ResolverSetup = async (client) => {
    await unsignedPerson(client);
    await client.query(
      "select set_config('aubos.context_signature', $1, true)",
      ["a".repeat(64)],
    );
  };
  const unsignedWorker: ResolverSetup = async (client) => {
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
        validCredentialId,
      ],
    );
  };
  const forgedWorker: ResolverSetup = async (client) => {
    await unsignedWorker(client);
    await client.query(
      "select set_config('aubos.context_signature', $1, true)",
      ["b".repeat(64)],
    );
  };

  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "anon",
    async () => undefined,
    `select * from public.resolve_context_gateway_memory_bank(
       $1, $2, 'retrieve'::public.context_gateway_operation, null
     )`,
    [bootstrap.installationId, bootstrap.workspaceId],
    "Anonymous Context Gateway execution",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "anon",
    async () => undefined,
    `select * from public.resolve_context_gateway_source_material(
       $1, $2, 'organizational'::public.installation_realm, null, $3::uuid[]
     )`,
    [bootstrap.installationId, bootstrap.workspaceId, [sourceRevisionId]],
    "Anonymous Context Gateway source projection",
  );
  for (const tableName of [
    "source_connections",
    "transcript_revisions",
    "transcript_utterances",
    "source_citations",
    "memory_banks",
    "memory_candidates",
    "derived_memories",
    "consolidation_lineage",
    "retrieval_receipts",
    "retrieval_receipt_results",
  ]) {
    await expectRuntimeDenied(
      runtimeDatabaseUrl,
      "authenticated",
      signedPerson(),
      `select count(*) from public.${tableName}`,
      [],
      `Direct authenticated ${tableName} read`,
    );
  }

  await expectNoResolution(
    "Owner kind without explicit memory authority",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retrieve",
  );
  await expectNoResolution(
    "Worker role without explicit memory authority",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "consolidate",
  );

  const personRetrieveGrantId = randomUUID();
  const workerConsolidateGrantId = randomUUID();
  const workerRetrieveGrantId = randomUUID();
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       person_id, worker_id, capability, mode, work_id, expires_at,
       granted_by_person_id
     ) values
       ($1, $3, $4, $5, 'person', $6, null,
        'memory.retrieve', 'observe', null,
        clock_timestamp() + interval '10 minutes', $6),
       ($2, $3, $4, $5, 'worker', null, $7,
        'memory.consolidate', 'modify', null,
        clock_timestamp() + interval '10 minutes', $6),
       ($8, $3, $4, $5, 'worker', null, $7,
        'memory.retrieve', 'observe', null,
        clock_timestamp() + interval '10 minutes', $6)`,
    [
      personRetrieveGrantId,
      workerConsolidateGrantId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      policyId,
      ownerPersonId,
      bootstrap.workerId,
      workerRetrieveGrantId,
    ],
  );

  for (const [label, role, setup, operation] of [
    ["Unsigned person context", "authenticated", unsignedPerson, "retrieve"],
    ["Forged person context", "authenticated", forgedPerson, "retrieve"],
    ["Unsigned worker context", "aubos_worker", unsignedWorker, "consolidate"],
    ["Forged worker context", "aubos_worker", forgedWorker, "consolidate"],
  ] as const) {
    await expectNoResolution(
      label,
      role,
      setup,
      bootstrap.installationId,
      bootstrap.workspaceId,
      operation,
    );
  }

  const organizationalExternalBank =
    `organizational:${bootstrap.installationId}:` +
    `${bootstrap.workspaceId}:lineage-v2`;
  await expectResolution(
    "Person retrieve",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retrieve",
    null,
    {
      external_bank_id: organizationalExternalBank,
      installation_realm: "organizational",
      principal_kind: "person",
      principal_id: ownerPersonId,
      context_subject_id: ownerAuthUserId,
      capability_grant_id: personRetrieveGrantId,
      capability: "memory.retrieve",
      capability_mode: "observe",
      data_classification_ceiling: "restricted",
    },
  );
  const projectedSource = await resolveSourceMaterial(
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "organizational",
    null,
    [sourceRevisionId],
  );
  const expectedProjectedSource: SourceMaterialRow = {
    source_revision_id: sourceRevisionId,
    classification: "synthetic",
    source_uri: "urn:vorton:synthetic:context-gateway",
    revision_hash: sourceRevisionHash,
    locator: "fixture:1",
    external_bank_id: organizationalExternalBank,
    data_classification_ceiling: "restricted",
  };
  requireCondition(
    JSON.stringify(projectedSource) ===
      JSON.stringify([expectedProjectedSource]),
    "Context Gateway source projection returned unexpected material",
  );
  requireCondition(
    JSON.stringify(
      await resolveSourceMaterial(
        "authenticated",
        signedPerson(),
        bootstrap.installationId,
        bootstrap.workspaceId,
        "organizational",
        null,
        [sourceRevisionId],
      ),
    ) === JSON.stringify(projectedSource),
    "Context Gateway source projection exact replay drifted",
  );
  for (const [label, installationId, workspaceId, realm, workId, ids] of [
    [
      "Wrong source realm",
      bootstrap.installationId,
      bootstrap.workspaceId,
      "personal",
      null,
      [sourceRevisionId],
    ],
    [
      "Cross-workspace source",
      bootstrap.installationId,
      otherWorkspaceId,
      "personal",
      null,
      [sourceRevisionId],
    ],
    [
      "Cross-installation source",
      otherInstallationId,
      bootstrap.workspaceId,
      "organizational",
      null,
      [sourceRevisionId],
    ],
    [
      "Wrong Work source authority",
      bootstrap.installationId,
      bootstrap.workspaceId,
      "organizational",
      otherWorkId,
      [sourceRevisionId],
    ],
    [
      "Duplicate source revision IDs",
      bootstrap.installationId,
      bootstrap.workspaceId,
      "organizational",
      null,
      [sourceRevisionId, sourceRevisionId],
    ],
    [
      "Unrequested source revision",
      bootstrap.installationId,
      bootstrap.workspaceId,
      "organizational",
      null,
      [randomUUID()],
    ],
  ] as const) {
    const rows = await resolveSourceMaterial(
      "authenticated",
      signedPerson(),
      installationId,
      workspaceId,
      realm,
      workId,
      [...ids],
    );
    requireCondition(rows.length === 0, `${label} unexpectedly returned rows`);
  }
  const oversizedSourceIds = Array.from({ length: 257 }, () => randomUUID());
  requireCondition(
    (
      await resolveSourceMaterial(
        "authenticated",
        signedPerson(),
        bootstrap.installationId,
        bootstrap.workspaceId,
        "organizational",
        null,
        oversizedSourceIds,
      )
    ).length === 0,
    "Oversized source revision request unexpectedly returned rows",
  );
  for (const [label, hostileSourceId] of Object.entries(hostileSourceIds)) {
    if (label === "successor") continue;
    requireCondition(
      (
        await resolveSourceMaterial(
          "authenticated",
          signedPerson(),
          bootstrap.installationId,
          bootstrap.workspaceId,
          "organizational",
          null,
          [hostileSourceId],
        )
      ).length === 0,
      `${label} source unexpectedly entered the retrieval projection`,
    );
  }
  await expectSqlState(
    admin,
    `update public.memory_candidates
        set bank_id = $1
      where installation_id = $2 and workspace_id = $3
        and source_revision_id = $4`,
    [
      personalBankId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      sourceRevisionId,
    ],
    "23503",
    "Cross-workspace candidate bank substitution",
  );

  await expectResolution(
    "Worker consolidate",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "consolidate",
    null,
    {
      external_bank_id: organizationalExternalBank,
      installation_realm: "organizational",
      principal_kind: "worker",
      principal_id: bootstrap.workerId,
      context_subject_id: bootstrap.workerId,
      capability_grant_id: workerConsolidateGrantId,
      capability: "memory.consolidate",
      capability_mode: "modify",
      data_classification_ceiling: "synthetic",
    },
  );
  requireCondition(
    (
      await resolveSourceMaterial(
        "aubos_worker",
        signedWorker(validCredentialId),
        bootstrap.installationId,
        bootstrap.workspaceId,
        "organizational",
        null,
        [publicSourceRevisionId],
      )
    ).length === 0,
    "Synthetic-only worker received a public-classified source",
  );
  await admin.query(
    `update public.workers
        set data_classification_ceiling = 'public'
      where installation_id = $1 and workspace_id = $2 and id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, bootstrap.workerId],
  );
  await expectResolution(
    "Low-ceiling worker consolidate",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "consolidate",
    null,
    {
      external_bank_id: organizationalExternalBank,
      installation_realm: "organizational",
      principal_kind: "worker",
      principal_id: bootstrap.workerId,
      context_subject_id: bootstrap.workerId,
      capability_grant_id: workerConsolidateGrantId,
      capability: "memory.consolidate",
      capability_mode: "modify",
      data_classification_ceiling: "public",
    },
  );
  const publicCeilingSyntheticSource = await resolveSourceMaterial(
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "organizational",
    null,
    [sourceRevisionId],
  );
  requireCondition(
    publicCeilingSyntheticSource.length === 1 &&
      publicCeilingSyntheticSource[0]?.classification === "synthetic" &&
      publicCeilingSyntheticSource[0]?.data_classification_ceiling === "public",
    "Public-ceiling worker did not receive synthetic source material",
  );
  await admin.query(
    `update public.workers
        set data_classification_ceiling = 'synthetic'
      where installation_id = $1 and workspace_id = $2 and id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, bootstrap.workerId],
  );

  await expectNoResolution(
    "Person capability substitution",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retain",
    bootstrap.workId,
  );
  await expectNoResolution(
    "Worker operation substitution",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "invalidate",
  );

  const personRetainGrantId = randomUUID();
  const workerInvalidateGrantId = randomUUID();
  const expiredPersonConsolidateGrantId = randomUUID();
  const futurePersonConsolidateGrantId = randomUUID();
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       person_id, worker_id, capability, mode, work_id, granted_at,
       expires_at, granted_by_person_id
     ) values
       ($1, $4, $5, $6, 'person', $7, null,
        'memory.retain', 'modify', $8, clock_timestamp(),
        clock_timestamp() + interval '10 minutes', $7),
       ($2, $4, $5, $6, 'worker', null, $9,
        'memory.invalidate', 'modify', null, clock_timestamp(),
        clock_timestamp() + interval '10 minutes', $7),
       ($3, $4, $5, $6, 'person', $7, null,
        'memory.consolidate', 'modify', null,
        clock_timestamp() - interval '2 minutes',
        clock_timestamp() - interval '1 minute', $7),
       ($10, $4, $5, $6, 'person', $7, null,
        'memory.consolidate', 'modify', null,
        clock_timestamp() + interval '1 minute',
        clock_timestamp() + interval '10 minutes', $7)`,
    [
      personRetainGrantId,
      workerInvalidateGrantId,
      expiredPersonConsolidateGrantId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      policyId,
      ownerPersonId,
      bootstrap.workId,
      bootstrap.workerId,
      futurePersonConsolidateGrantId,
    ],
  );
  await expectResolution(
    "Person work-bound retain",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retain",
    bootstrap.workId,
    {
      external_bank_id: organizationalExternalBank,
      installation_realm: "organizational",
      principal_kind: "person",
      principal_id: ownerPersonId,
      context_subject_id: ownerAuthUserId,
      capability_grant_id: personRetainGrantId,
      capability: "memory.retain",
      capability_mode: "modify",
      data_classification_ceiling: "restricted",
    },
  );
  await expectNoResolution(
    "Work-bound grant without matching Work",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retain",
  );
  await expectNoResolution(
    "Cross-workspace Work substitution",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retain",
    otherWorkId,
  );
  await expectResolution(
    "Worker invalidate",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "invalidate",
    null,
    {
      external_bank_id: organizationalExternalBank,
      installation_realm: "organizational",
      principal_kind: "worker",
      principal_id: bootstrap.workerId,
      context_subject_id: bootstrap.workerId,
      capability_grant_id: workerInvalidateGrantId,
      capability: "memory.invalidate",
      capability_mode: "modify",
      data_classification_ceiling: "synthetic",
    },
  );
  await expectNoResolution(
    "Expired person capability grant",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "consolidate",
  );
  await expectNoResolution(
    "Future person capability grant",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "consolidate",
  );

  await admin.query(
    `insert into public.capability_grant_revocations (
       id, installation_id, workspace_id, grant_id,
       revoked_by_person_id, reason
     ) values ($1, $2, $3, $4, $5, 'Synthetic Context Gateway proof')`,
    [
      randomUUID(),
      bootstrap.installationId,
      bootstrap.workspaceId,
      personRetrieveGrantId,
      ownerPersonId,
    ],
  );
  await expectNoResolution(
    "Revoked person capability grant",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retrieve",
  );
  requireCondition(
    (
      await resolveSourceMaterial(
        "authenticated",
        signedPerson(),
        bootstrap.installationId,
        bootstrap.workspaceId,
        "organizational",
        null,
        [sourceRevisionId],
      )
    ).length === 0,
    "Revoked person capability grant retained source projection access",
  );

  for (const [label, credentialId] of [
    ["Missing worker credential", randomUUID()],
    ["Revoked worker credential", revokedCredentialId],
    ["Expired worker credential", expiredCredentialId],
    ["Future worker credential", futureCredentialId],
    ["Empty worker credential", ""],
  ] as const) {
    await expectNoResolution(
      label,
      "aubos_worker",
      signedWorker(credentialId),
      bootstrap.installationId,
      bootstrap.workspaceId,
      "consolidate",
    );
  }

  await admin.query(
    `insert into public.capability_grant_revocations (
       id, installation_id, workspace_id, grant_id,
       revoked_by_person_id, reason
     ) values ($1, $2, $3, $4, $5, 'Synthetic revoked worker memory grant')`,
    [
      randomUUID(),
      bootstrap.installationId,
      bootstrap.workspaceId,
      workerConsolidateGrantId,
      ownerPersonId,
    ],
  );
  await expectNoResolution(
    "Revoked worker capability grant",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "consolidate",
  );

  await expectNoResolution(
    "Signed context with wrong installation",
    "authenticated",
    signedPerson(),
    otherInstallationId,
    bootstrap.workspaceId,
    "retrieve",
  );
  await expectNoResolution(
    "Signed context with wrong workspace",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    otherWorkspaceId,
    "retrieve",
  );
  await expectNoResolution(
    "Worker cross-workspace substitution",
    "aubos_worker",
    signedWorker(validCredentialId),
    bootstrap.installationId,
    otherWorkspaceId,
    "consolidate",
  );

  const noMembershipAuthUserId = randomUUID();
  const noMembershipPersonId = randomUUID();
  await admin.query(
    "insert into auth.users (id, email) values ($1, 'context-no-membership@synthetic.invalid')",
    [noMembershipAuthUserId],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values ($1, $2, $3, 'Synthetic Context Gateway outsider', 'owner')`,
    [noMembershipPersonId, bootstrap.installationId, noMembershipAuthUserId],
  );
  await expectNoResolution(
    "Person without workspace membership",
    "authenticated",
    signedPerson(
      bootstrap.installationId,
      bootstrap.workspaceId,
      noMembershipAuthUserId,
    ),
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retrieve",
  );

  const revokedOwnerAuthUserId = randomUUID();
  const revokedOwnerPersonId = randomUUID();
  const revokedOwnerGrantId = randomUUID();
  await admin.query(
    "insert into auth.users (id, email) values ($1, 'context-revoked-owner@synthetic.invalid')",
    [revokedOwnerAuthUserId],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values ($1, $2, $3, 'Synthetic revoked Context Gateway owner', 'owner')`,
    [revokedOwnerPersonId, bootstrap.installationId, revokedOwnerAuthUserId],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values ($1, $2, $3, 'owner')`,
    [bootstrap.installationId, bootstrap.workspaceId, revokedOwnerPersonId],
  );
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       person_id, capability, mode, expires_at, granted_by_person_id
     ) values ($1, $2, $3, $4, 'person', $5, 'memory.retrieve',
               'observe', clock_timestamp() + interval '10 minutes', $6)`,
    [
      revokedOwnerGrantId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      policyId,
      revokedOwnerPersonId,
      ownerPersonId,
    ],
  );
  const signedRevokedOwner = signedPerson(
    bootstrap.installationId,
    bootstrap.workspaceId,
    revokedOwnerAuthUserId,
  );
  await expectResolution(
    "Second owner before membership revocation",
    "authenticated",
    signedRevokedOwner,
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retrieve",
    null,
    {
      external_bank_id: organizationalExternalBank,
      installation_realm: "organizational",
      principal_kind: "person",
      principal_id: revokedOwnerPersonId,
      context_subject_id: revokedOwnerAuthUserId,
      capability_grant_id: revokedOwnerGrantId,
      capability: "memory.retrieve",
      capability_mode: "observe",
      data_classification_ceiling: "restricted",
    },
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedRevokedOwner,
    "select count(*) from public.workspace_membership_revocations",
    [],
    "Direct membership-revocation ledger read",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedPerson(),
    `insert into public.workspace_membership_revocations (
       installation_id, workspace_id, person_id, revoked_by_person_id
     ) values ($1, $2, $3, $4)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      revokedOwnerPersonId,
      ownerPersonId,
    ],
    "Direct membership-revocation ledger write",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedPerson(),
    "select public.revoke_workspace_membership($1, $2, $3)",
    [bootstrap.installationId, bootstrap.workspaceId, revokedOwnerPersonId],
    "Ungoverned membership revocation",
  );
  await admin.query(
    `insert into public.workspace_membership_revocations (
       installation_id, workspace_id, person_id, revoked_by_person_id
     ) values ($1, $2, $3, $4)`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      revokedOwnerPersonId,
      ownerPersonId,
    ],
  );
  await expectNoResolution(
    "Revoked workspace owner",
    "authenticated",
    signedRevokedOwner,
    bootstrap.installationId,
    bootstrap.workspaceId,
    "retrieve",
  );
  requireCondition(
    (
      await resolveSourceMaterial(
        "authenticated",
        signedRevokedOwner,
        bootstrap.installationId,
        bootstrap.workspaceId,
        "organizational",
        null,
        [sourceRevisionId],
      )
    ).length === 0,
    "Revoked workspace owner retained source projection access",
  );
  const revokedBootstrapMembership = await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    signedRevokedOwner,
    (client) =>
      client.query<{ count: string }>(
        `select count(*)::text as count
           from public.workspace_memberships
          where installation_id = $1 and workspace_id = $2`,
        [bootstrap.installationId, bootstrap.workspaceId],
      ),
  );
  requireCondition(
    revokedBootstrapMembership.rows[0]?.count === "0",
    "Revoked workspace owner remained visible to ordinary bootstrap membership reads",
  );

  const otherWorkspaceRetrieveGrantId = randomUUID();
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       person_id, capability, mode, work_id, expires_at,
       granted_by_person_id
     ) values ($1, $2, $3, $4, 'person', $5, 'memory.retrieve',
               'observe', null, clock_timestamp() + interval '10 minutes', $5)`,
    [
      otherWorkspaceRetrieveGrantId,
      bootstrap.installationId,
      otherWorkspaceId,
      otherPolicyId,
      ownerPersonId,
    ],
  );
  const personalExternalBank = `personal:${bootstrap.installationId}:${otherWorkspaceId}:lineage-v2`;
  await expectResolution(
    "Personal workspace retrieve",
    "authenticated",
    signedPerson(bootstrap.installationId, otherWorkspaceId),
    bootstrap.installationId,
    otherWorkspaceId,
    "retrieve",
    null,
    {
      external_bank_id: personalExternalBank,
      installation_realm: "personal",
      principal_kind: "person",
      principal_id: ownerPersonId,
      context_subject_id: ownerAuthUserId,
      capability_grant_id: otherWorkspaceRetrieveGrantId,
      capability: "memory.retrieve",
      capability_mode: "observe",
      data_classification_ceiling: "restricted",
    },
  );
  await expectNoResolution(
    "Cross-workspace bank through organizational context",
    "authenticated",
    signedPerson(),
    bootstrap.installationId,
    otherWorkspaceId,
    "retrieve",
  );

  const noBankWorkspaceId = randomUUID();
  const noBankPolicyId = randomUUID();
  await admin.query(
    `insert into public.workspaces
       (id, installation_id, slug, display_name, realm, created_by_person_id)
     values ($1, $2, $3, 'Synthetic workspace without memory',
             'organizational', $4)`,
    [
      noBankWorkspaceId,
      bootstrap.installationId,
      `no-memory-${noBankWorkspaceId.slice(0, 8)}`,
      ownerPersonId,
    ],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values ($1, $2, $3, 'owner')`,
    [bootstrap.installationId, noBankWorkspaceId, ownerPersonId],
  );
  await admin.query(
    `insert into public.policies
       (id, installation_id, workspace_id, name, version, definition,
        content_sha256, created_by_person_id)
     values ($1, $2, $3, 'context-gateway-memory', 1,
             '{"fixture":"synthetic"}'::jsonb, $4, $5)`,
    [
      noBankPolicyId,
      bootstrap.installationId,
      noBankWorkspaceId,
      createHash("sha256").update(noBankWorkspaceId).digest("hex"),
      ownerPersonId,
    ],
  );
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       person_id, capability, mode, expires_at, granted_by_person_id
     ) values ($1, $2, $3, $4, 'person', $5, 'memory.retrieve',
               'observe', clock_timestamp() + interval '10 minutes', $5)`,
    [
      randomUUID(),
      bootstrap.installationId,
      noBankWorkspaceId,
      noBankPolicyId,
      ownerPersonId,
    ],
  );
  await expectNoResolution(
    "Workspace without a memory bank",
    "authenticated",
    signedPerson(bootstrap.installationId, noBankWorkspaceId),
    bootstrap.installationId,
    noBankWorkspaceId,
    "retrieve",
  );

  const legacyPolicyId = randomUUID();
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values ($1, $2, $3, 'owner')`,
    [legacyInstallationId, legacyWorkspaceId, legacyOwnerPersonId],
  );
  await admin.query(
    `insert into public.policies
       (id, installation_id, workspace_id, name, version, definition,
        content_sha256, created_by_person_id)
     values ($1, $2, $3, 'context-gateway-memory', 1,
             '{"fixture":"synthetic"}'::jsonb, $4, $5)`,
    [
      legacyPolicyId,
      legacyInstallationId,
      legacyWorkspaceId,
      createHash("sha256").update(legacyWorkspaceId).digest("hex"),
      legacyOwnerPersonId,
    ],
  );
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       person_id, capability, mode, expires_at, granted_by_person_id
     ) values ($1, $2, $3, $4, 'person', $5, 'memory.retrieve',
               'observe', clock_timestamp() + interval '10 minutes', $5)`,
    [
      randomUUID(),
      legacyInstallationId,
      legacyWorkspaceId,
      legacyPolicyId,
      legacyOwnerPersonId,
    ],
  );
  await expectNoResolution(
    "Legacy noncanonical memory bank",
    "authenticated",
    signedPerson(
      legacyInstallationId,
      legacyWorkspaceId,
      legacyOwnerAuthUserId,
    ),
    legacyInstallationId,
    legacyWorkspaceId,
    "retrieve",
  );

  requireCondition(
    JSON.stringify(await memoryCounts()) ===
      JSON.stringify(baselineMemoryCounts),
    "Context Gateway authority resolution mutated memory state",
  );
}

async function proveWorkspaceMemoryBankIdentity(
  admin: Client,
  bootstrap: BootstrapResult,
): Promise<void> {
  const constraintName = "memory_banks_external_bank_workspace_identity";
  const constraint = await admin.query<{
    convalidated: boolean;
    definition: string;
  }>(
    `select convalidated, pg_get_constraintdef(oid) as definition
       from pg_constraint
      where conrelid = 'public.memory_banks'::regclass
        and conname = $1`,
    [constraintName],
  );
  requireCondition(
    constraint.rows.length === 1 && !constraint.rows[0]?.convalidated,
    "Memory-bank identity constraint did not preserve explicit legacy remediation",
  );
  requireCondition(
    constraint.rows[0]?.definition.endsWith("NOT VALID"),
    "Memory-bank identity constraint is not visibly marked NOT VALID",
  );

  const preservedLegacy = await admin.query<{ external_bank_id: string }>(
    "select external_bank_id from public.memory_banks where id = $1",
    [legacyBankId],
  );
  requireCondition(
    preservedLegacy.rows[0]?.external_bank_id === "legacy-unscoped-bank",
    "The NOT VALID migration rewrote or rejected the unresolved legacy bank",
  );
  await expectConstraintViolation(
    admin,
    `update public.memory_banks
        set database_locator = database_locator
      where id = $1`,
    [legacyBankId],
    constraintName,
    "Unreconciled legacy memory-bank unrelated update",
  );

  const legacyCanonical =
    `organizational:${legacyInstallationId}:` +
    `${legacyWorkspaceId}:lineage-v2`;
  const reconciledLegacy = await admin.query<{
    external_bank_id: string;
  }>(
    `update public.memory_banks
        set external_bank_id = $1
      where id = $2
      returning external_bank_id`,
    [legacyCanonical, legacyBankId],
  );
  requireCondition(
    reconciledLegacy.rows[0]?.external_bank_id === legacyCanonical,
    "Explicit legacy memory-bank identity reconciliation failed",
  );
  const reconciledUnrelatedUpdate = await admin.query<{ id: string }>(
    `update public.memory_banks
        set database_locator = database_locator
      where id = $1
      returning id`,
    [legacyBankId],
  );
  requireCondition(
    reconciledUnrelatedUpdate.rows[0]?.id === legacyBankId,
    "Reconciled legacy memory bank did not accept an unrelated update",
  );

  const canonical =
    `organizational:${bootstrap.installationId}:` +
    `${bootstrap.workspaceId}:lineage-v2`;
  const personalCanonical = `personal:${bootstrap.installationId}:${otherWorkspaceId}:lineage-v2`;
  const banks = await admin.query<{
    id: string;
    external_bank_id: string;
  }>(
    `select id, external_bank_id
       from public.memory_banks
      where id = any($1::uuid[])
      order by id`,
    [[organizationalBankId, personalBankId]],
  );
  requireCondition(
    banks.rows.some(
      (bank) =>
        bank.id === organizationalBankId && bank.external_bank_id === canonical,
    ) &&
      banks.rows.some(
        (bank) =>
          bank.id === personalBankId &&
          bank.external_bank_id === personalCanonical,
      ),
    "Canonical workspace-bound memory banks were not persisted",
  );

  for (const [label, hostileBankId] of [
    [
      "wrong workspace",
      `organizational:${bootstrap.installationId}:${otherWorkspaceId}:lineage-v2`,
    ],
    [
      "wrong realm",
      `personal:${bootstrap.installationId}:${bootstrap.workspaceId}:lineage-v2`,
    ],
    [
      "wrong installation",
      `organizational:${otherInstallationId}:${bootstrap.workspaceId}:lineage-v2`,
    ],
    [
      "legacy default suffix",
      `organizational:${bootstrap.installationId}:${bootstrap.workspaceId}:default`,
    ],
    ["grafted suffix", `${canonical}:grafted`],
  ] as const) {
    await expectConstraintViolation(
      admin,
      "update public.memory_banks set external_bank_id = $1 where id = $2",
      [hostileBankId, organizationalBankId],
      constraintName,
      `Memory-bank identity ${label}`,
    );
  }

  const canonicalUpdate = await admin.query<{ external_bank_id: string }>(
    `update public.memory_banks
        set external_bank_id = $1
      where id = $2
      returning external_bank_id`,
    [canonical, organizationalBankId],
  );
  requireCondition(
    canonicalUpdate.rows[0]?.external_bank_id === canonical,
    "Canonical workspace-bound memory-bank update failed",
  );
}

async function proveWorkspaceModuleProjectionBoundary(
  admin: Client,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  const personalInitial = await admin.query<{
    activation_count: string;
    default_module_id: string | null;
  }>(
    `select workspace.default_module_id,
            (select count(*)::text
               from public.workspace_module_activations activation
              where activation.installation_id = workspace.installation_id
                and activation.workspace_id = workspace.id)
              as activation_count
       from public.workspaces workspace
      where workspace.installation_id = $1 and workspace.id = $2`,
    [bootstrap.installationId, otherWorkspaceId],
  );
  requireCondition(
    personalInitial.rows[0]?.activation_count === "0" &&
      personalInitial.rows[0]?.default_module_id === null,
    "Unconfigured personal workspace inferred a module or default",
  );

  await admin.query(
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id)
     values
       ($1, $2, 'command', 'v1', 'Command Bridge', 10, 'standard', $3),
       ($1, $2, 'factory', 'v1', 'Factory', 20, 'read-only', $3)`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
  );
  await admin.query(
    `update public.workspaces set default_module_id = 'command'
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  await expectConstraintViolation(
    admin,
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id)
     values ($1, $2, 'finance', 'v1', 'Finance', 30, 'standard', $3)`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
    "workspace_module_activations_supported_tuple",
    "Unsupported workspace module tuple",
  );
  await expectSqlState(
    admin,
    `update public.workspaces set default_module_id = 'tasks'
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, bootstrap.workspaceId],
    "23503",
    "Workspace default without an activation",
  );

  const signedOwner = (client: Client): Promise<void> =>
    setSignedContext(
      client,
      "person",
      bootstrap.installationId,
      bootstrap.workspaceId,
      ownerAuthUserId,
    );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner,
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id)
     values ($1, $2, 'tasks', 'v1', 'Tasks', 30, 'standard', $3)`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
    "Authenticated workspace module insertion",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner,
    `update public.workspace_module_activations set label = 'Substituted'
      where installation_id = $1 and workspace_id = $2
        and module_id = 'command'`,
    [bootstrap.installationId, bootstrap.workspaceId],
    "Authenticated workspace module update",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner,
    `delete from public.workspace_module_activations
      where installation_id = $1 and workspace_id = $2
        and module_id = 'factory'`,
    [bootstrap.installationId, bootstrap.workspaceId],
    "Authenticated workspace module deletion",
  );

  await admin.query(
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id)
     values ($1, $2, 'command', 'v1', 'Legacy Command', 10, 'standard', $3)`,
    [legacyInstallationId, legacyWorkspaceId, legacyOwnerPersonId],
  );

  const readProjection = async (
    installationId: string,
    workspaceId: string,
    subjectId: string,
  ): Promise<{
    activations: Array<{
      installation_id: string;
      workspace_id: string;
      module_id: string;
      contract_version: string;
      label: string;
      navigation_order: number;
      presentation_variant: string;
    }>;
    defaultModuleId: string | null;
    workspaceVisible: boolean;
  }> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      (client) =>
        setSignedContext(
          client,
          "person",
          installationId,
          workspaceId,
          subjectId,
        ),
      async (client) => {
        const activations = await client.query<{
          installation_id: string;
          workspace_id: string;
          module_id: string;
          contract_version: string;
          label: string;
          navigation_order: number;
          presentation_variant: string;
        }>(
          `select installation_id::text, workspace_id::text, module_id,
                  contract_version, label, navigation_order,
                  presentation_variant
             from public.workspace_module_activations
            order by navigation_order, module_id`,
        );
        const workspace = await client.query<{
          default_module_id: string | null;
        }>(
          `select default_module_id from public.workspaces
            where installation_id = $1 and id = $2`,
          [installationId, workspaceId],
        );
        return {
          activations: activations.rows,
          defaultModuleId: workspace.rows[0]?.default_module_id ?? null,
          workspaceVisible: workspace.rowCount === 1,
        };
      },
    );

  const organizationalProjection = await readProjection(
    bootstrap.installationId,
    bootstrap.workspaceId,
    ownerAuthUserId,
  );
  requireCondition(
    organizationalProjection.workspaceVisible &&
      organizationalProjection.defaultModuleId === "command" &&
      canonicalModuleLifecycleJson(organizationalProjection.activations) ===
        canonicalModuleLifecycleJson([
          {
            installation_id: bootstrap.installationId,
            workspace_id: bootstrap.workspaceId,
            module_id: "command",
            contract_version: "v1",
            label: "Command Bridge",
            navigation_order: 10,
            presentation_variant: "standard",
          },
          {
            installation_id: bootstrap.installationId,
            workspace_id: bootstrap.workspaceId,
            module_id: "factory",
            contract_version: "v1",
            label: "Factory",
            navigation_order: 20,
            presentation_variant: "read-only",
          },
        ]),
    "Organizational workspace module projection drifted from exact tuples",
  );
  const personalProjection = await readProjection(
    bootstrap.installationId,
    otherWorkspaceId,
    ownerAuthUserId,
  );
  requireCondition(
    personalProjection.workspaceVisible &&
      personalProjection.defaultModuleId === null &&
      personalProjection.activations.length === 0,
    "Personal workspace projected an unactivated or foreign module",
  );

  const legacyProjection = await readProjection(
    legacyInstallationId,
    legacyWorkspaceId,
    legacyOwnerAuthUserId,
  );
  requireCondition(
    legacyProjection.workspaceVisible &&
      legacyProjection.activations.length === 1 &&
      legacyProjection.activations[0]?.installation_id ===
        legacyInstallationId &&
      legacyProjection.activations[0]?.workspace_id === legacyWorkspaceId,
    "Live foreign workspace member could not read its exact module row",
  );
  await admin.query(
    `insert into public.workspace_membership_revocations
       (installation_id, workspace_id, person_id, revoked_by_person_id,
        revoked_at)
     values ($1, $2, $3, $3,
             date_trunc('milliseconds', clock_timestamp()))`,
    [legacyInstallationId, legacyWorkspaceId, legacyOwnerPersonId],
  );
  const revokedLegacyProjection = await readProjection(
    legacyInstallationId,
    legacyWorkspaceId,
    legacyOwnerAuthUserId,
  );
  requireCondition(
    !revokedLegacyProjection.workspaceVisible &&
      revokedLegacyProjection.activations.length === 0,
    "Revoked workspace member retained module projection access",
  );
}

async function proveWorkspaceCoreSurfaceSelectionBoundary(
  admin: Client,
  adminDatabaseUrl: string,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
): Promise<void> {
  const ids = {
    workspace: randomUUID(),
    outOfBandWorkspace: randomUUID(),
    ownerAuth: randomUUID(),
    ownerPerson: randomUUID(),
    nonOwnerAuth: randomUUID(),
    nonOwnerPerson: randomUUID(),
    revokedOwnerAuth: randomUUID(),
    revokedOwnerPerson: randomUUID(),
    noMembershipAuth: randomUUID(),
    noMembershipPerson: randomUUID(),
    worker: randomUUID(),
    validWork: randomUUID(),
    proposedWork: randomUUID(),
    wrongCustodianWork: randomUUID(),
    leasedWork: randomUUID(),
    workDriftWork: randomUUID(),
    policyDriftWork: randomUUID(),
    grantDriftWork: randomUUID(),
    rollbackWork: randomUUID(),
    receiptRaceWorkspaceA: randomUUID(),
    receiptRaceWorkspaceB: randomUUID(),
    receiptRaceWorkA: randomUUID(),
    receiptRaceWorkB: randomUUID(),
    receiptRacePolicyA: randomUUID(),
    receiptRacePolicyB: randomUUID(),
    receiptRaceGrantA: randomUUID(),
    receiptRaceGrantB: randomUUID(),
    goodPolicy: randomUUID(),
    badPolicy: randomUUID(),
    policyDriftPolicy: randomUUID(),
    goodGrant: randomUUID(),
    wrongPrincipalGrant: randomUUID(),
    wrongWorkGrant: randomUUID(),
    wrongCapabilityGrant: randomUUID(),
    wrongModeGrant: randomUUID(),
    expiredGrant: randomUUID(),
    revokedGrant: randomUUID(),
    badPolicyGrant: randomUUID(),
    proposedWorkGrant: randomUUID(),
    wrongCustodianGrant: randomUUID(),
    leasedWorkGrant: randomUUID(),
    workDriftGrant: randomUUID(),
    policyDriftGrant: randomUUID(),
    grantDriftGrant: randomUUID(),
    rollbackGrant: randomUUID(),
  };

  await admin.query(
    `insert into auth.users (id, email) values
       ($1, 'core-surface-selection-owner@synthetic.invalid'),
       ($2, 'core-surface-selection-member@synthetic.invalid'),
       ($3, 'core-surface-selection-revoked@synthetic.invalid'),
       ($4, 'core-surface-selection-no-membership@synthetic.invalid')`,
    [
      ids.ownerAuth,
      ids.nonOwnerAuth,
      ids.revokedOwnerAuth,
      ids.noMembershipAuth,
    ],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values
       ($1, $9, $2, 'Synthetic core-surface selection owner', 'owner'),
       ($3, $9, $4, 'Synthetic core-surface selection member', 'member'),
       ($5, $9, $6, 'Synthetic revoked core-surface selection owner', 'owner'),
       ($7, $9, $8, 'Synthetic core-surface selection person without membership',
        'owner')`,
    [
      ids.ownerPerson,
      ids.ownerAuth,
      ids.nonOwnerPerson,
      ids.nonOwnerAuth,
      ids.revokedOwnerPerson,
      ids.revokedOwnerAuth,
      ids.noMembershipPerson,
      ids.noMembershipAuth,
      bootstrap.installationId,
    ],
  );
  await admin.query(
    `insert into public.workspaces
       (id, installation_id, slug, display_name, realm, created_by_person_id)
     values
       ($1, $3, $4, 'Synthetic governed core-surface selection',
        'organizational', $5),
       ($2, $3, $6, 'Synthetic out-of-band module projection',
        'organizational', $5),
       ($7, $3, $8, 'Synthetic receipt identity race A',
        'organizational', $5),
       ($9, $3, $10, 'Synthetic receipt identity race B',
        'organizational', $5)`,
    [
      ids.workspace,
      ids.outOfBandWorkspace,
      bootstrap.installationId,
      `selection-${ids.workspace.slice(0, 8)}`,
      ids.ownerPerson,
      `out-of-band-${ids.outOfBandWorkspace.slice(0, 8)}`,
      ids.receiptRaceWorkspaceA,
      `receipt-race-a-${ids.receiptRaceWorkspaceA.slice(0, 8)}`,
      ids.receiptRaceWorkspaceB,
      `receipt-race-b-${ids.receiptRaceWorkspaceB.slice(0, 8)}`,
    ],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values
       ($1, $2, $4, 'owner'),
       ($1, $2, $5, 'member'),
       ($1, $2, $6, 'owner'),
       ($1, $3, $4, 'owner'),
       ($1, $7, $4, 'owner'),
       ($1, $8, $4, 'owner')`,
    [
      bootstrap.installationId,
      ids.workspace,
      ids.outOfBandWorkspace,
      ids.ownerPerson,
      ids.nonOwnerPerson,
      ids.revokedOwnerPerson,
      ids.receiptRaceWorkspaceA,
      ids.receiptRaceWorkspaceB,
    ],
  );
  await admin.query(
    `insert into public.workspace_membership_revocations
       (installation_id, workspace_id, person_id, revoked_by_person_id,
        revoked_at)
     values ($1, $2, $3, $4,
             date_trunc('milliseconds', clock_timestamp()))`,
    [
      bootstrap.installationId,
      ids.workspace,
      ids.revokedOwnerPerson,
      ids.ownerPerson,
    ],
  );
  await admin.query(
    `insert into public.workers
       (id, installation_id, workspace_id, name, provider, billing_realm, host,
        runtime, model, advertised_capabilities, data_classification_ceiling,
        isolation, network_policy, health)
     select $1, installation_id, $2, $3, provider, billing_realm, host,
            runtime, model, advertised_capabilities, data_classification_ceiling,
            isolation, network_policy, health
       from public.workers
      where installation_id = $4 and workspace_id = $5 and id = $6`,
    [
      ids.worker,
      ids.workspace,
      `Synthetic core-surface selection worker ${ids.worker.slice(0, 8)}`,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
    ],
  );

  const insertWork = async (
    id: string,
    state: "proposed" | "ready" | "leased",
    custodianPersonId: string | null,
    custodianWorkerId: string | null = null,
    workspaceId = ids.workspace,
  ): Promise<void> => {
    await admin.query(
      `insert into public.work
         (id, installation_id, workspace_id, title, requested_outcome,
          acceptance_criteria, state, priority, requested_by_person_id,
          custodian_person_id, custodian_worker_id, lease_expires_at,
          created_at, updated_at)
       values
         ($1, $2, $3, $4, $5, $6::jsonb, $7::public.work_state, 91,
          $8, $9, $10,
          case when $7::text = 'leased'
            then clock_timestamp() + interval '1 hour' else null end,
          '2026-08-31T18:00:00.123456Z'::timestamptz,
          '2026-08-31T18:15:00.654321Z'::timestamptz)`,
      [
        id,
        bootstrap.installationId,
        workspaceId,
        `Govern core-surface selection ${id.slice(0, 8)}`,
        "Replace one exact compiled workspace core surface",
        JSON.stringify([
          "Bind the exact current receipt lineage",
          "Leave every foreign workspace unchanged",
        ]),
        state,
        ids.ownerPerson,
        custodianPersonId,
        custodianWorkerId,
      ],
    );
  };
  await insertWork(ids.validWork, "ready", ids.ownerPerson);
  await insertWork(ids.proposedWork, "proposed", ids.ownerPerson);
  await insertWork(ids.wrongCustodianWork, "ready", ids.nonOwnerPerson);
  await insertWork(ids.leasedWork, "leased", null, ids.worker);
  await insertWork(ids.workDriftWork, "ready", ids.ownerPerson);
  await insertWork(ids.policyDriftWork, "ready", ids.ownerPerson);
  await insertWork(ids.grantDriftWork, "ready", ids.ownerPerson);
  await insertWork(ids.rollbackWork, "ready", ids.ownerPerson);
  await insertWork(
    ids.receiptRaceWorkA,
    "ready",
    ids.ownerPerson,
    null,
    ids.receiptRaceWorkspaceA,
  );
  await insertWork(
    ids.receiptRaceWorkB,
    "ready",
    ids.ownerPerson,
    null,
    ids.receiptRaceWorkspaceB,
  );

  const goodPolicyDefinition = {
    version: 1,
    capability: "workspace.core-surface.select",
    rule: "exact-compiled-surface",
  };
  const policyDriftDefinition = {
    version: 1,
    capability: "workspace.core-surface.select",
    rule: "drift-test",
  };
  await admin.query(
    `insert into public.policies
       (id, installation_id, workspace_id, name, version, definition,
        content_sha256, created_by_person_id)
     values
       ($1, $4, $5, 'Synthetic core-surface selection', 1, $6::jsonb, $7, $8),
       ($2, $4, $5, 'Synthetic invalid core-surface selection', 1, $6::jsonb,
        $9, $8),
       ($3, $4, $5, 'Synthetic drifting core-surface selection', 1,
        $10::jsonb, $11, $8)`,
    [
      ids.goodPolicy,
      ids.badPolicy,
      ids.policyDriftPolicy,
      bootstrap.installationId,
      ids.workspace,
      JSON.stringify(goodPolicyDefinition),
      canonicalSha256(goodPolicyDefinition).slice("sha256:".length),
      ids.ownerPerson,
      "0".repeat(64),
      JSON.stringify(policyDriftDefinition),
      canonicalSha256(policyDriftDefinition).slice("sha256:".length),
    ],
  );
  await admin.query(
    `insert into public.policies
       (id, installation_id, workspace_id, name, version, definition,
        content_sha256, created_by_person_id)
     values
       ($1, $3, $4, 'Synthetic receipt identity race A', 1, $5::jsonb,
        $6, $7),
       ($2, $3, $8, 'Synthetic receipt identity race B', 1, $5::jsonb,
        $6, $7)`,
    [
      ids.receiptRacePolicyA,
      ids.receiptRacePolicyB,
      bootstrap.installationId,
      ids.receiptRaceWorkspaceA,
      JSON.stringify(goodPolicyDefinition),
      canonicalSha256(goodPolicyDefinition).slice("sha256:".length),
      ids.ownerPerson,
      ids.receiptRaceWorkspaceB,
    ],
  );

  const insertGrant = async (options: {
    id: string;
    workId: string;
    policyId?: string;
    personId?: string;
    capability?: string;
    mode?: "observe" | "modify";
    expiresAt?: string | null;
    workspaceId?: string;
  }): Promise<void> => {
    await admin.query(
      `insert into public.capability_grants
         (id, installation_id, workspace_id, policy_id, principal_kind,
          person_id, worker_id, capability, mode, work_id, expires_at,
          granted_by_person_id, granted_at)
       values
         ($1, $2, $3, $4, 'person', $5, null, $6, $7, $8,
          $9::timestamptz, $10, clock_timestamp() - interval '2 hours')`,
      [
        options.id,
        bootstrap.installationId,
        options.workspaceId ?? ids.workspace,
        options.policyId ?? ids.goodPolicy,
        options.personId ?? ids.ownerPerson,
        options.capability ?? "workspace.core-surface.select",
        options.mode ?? "modify",
        options.workId,
        options.expiresAt ?? null,
        ids.ownerPerson,
      ],
    );
  };
  await insertGrant({ id: ids.goodGrant, workId: ids.validWork });
  await insertGrant({
    id: ids.wrongPrincipalGrant,
    workId: ids.validWork,
    personId: ids.nonOwnerPerson,
  });
  await insertGrant({ id: ids.wrongWorkGrant, workId: ids.proposedWork });
  await insertGrant({
    id: ids.wrongCapabilityGrant,
    workId: ids.validWork,
    capability: "workspace.module.observe",
  });
  await insertGrant({
    id: ids.wrongModeGrant,
    workId: ids.validWork,
    mode: "observe",
  });
  await insertGrant({
    id: ids.expiredGrant,
    workId: ids.validWork,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await insertGrant({ id: ids.revokedGrant, workId: ids.validWork });
  await insertGrant({
    id: ids.badPolicyGrant,
    workId: ids.validWork,
    policyId: ids.badPolicy,
  });
  await insertGrant({ id: ids.proposedWorkGrant, workId: ids.proposedWork });
  await insertGrant({
    id: ids.wrongCustodianGrant,
    workId: ids.wrongCustodianWork,
  });
  await insertGrant({ id: ids.leasedWorkGrant, workId: ids.leasedWork });
  await insertGrant({ id: ids.workDriftGrant, workId: ids.workDriftWork });
  await insertGrant({
    id: ids.policyDriftGrant,
    workId: ids.policyDriftWork,
    policyId: ids.policyDriftPolicy,
  });
  await insertGrant({ id: ids.grantDriftGrant, workId: ids.grantDriftWork });
  await insertGrant({ id: ids.rollbackGrant, workId: ids.rollbackWork });
  await insertGrant({
    id: ids.receiptRaceGrantA,
    workId: ids.receiptRaceWorkA,
    policyId: ids.receiptRacePolicyA,
    workspaceId: ids.receiptRaceWorkspaceA,
  });
  await insertGrant({
    id: ids.receiptRaceGrantB,
    workId: ids.receiptRaceWorkB,
    policyId: ids.receiptRacePolicyB,
    workspaceId: ids.receiptRaceWorkspaceB,
  });
  await admin.query(
    `insert into public.capability_grant_revocations
       (installation_id, workspace_id, grant_id, revoked_by_person_id,
        reason, revoked_at)
     values ($1, $2, $3, $4, 'Synthetic revoked core-surface selection grant',
             clock_timestamp())`,
    [
      bootstrap.installationId,
      ids.workspace,
      ids.revokedGrant,
      ids.ownerPerson,
    ],
  );

  const emptyPreferences = {
    defaultCoreSurfaceId: null,
    coreSurfaces: [],
  } as const;
  const activePreferences = {
    defaultCoreSurfaceId: "command",
    coreSurfaces: [
      { id: "command", navigationOrder: 10 },
      { id: "tasks", navigationOrder: 20 },
    ],
  } as const;
  const emptySurface: WorkspaceCoreSurface =
    deriveWorkspaceCoreSurface(emptyPreferences);
  const activeSurface: WorkspaceCoreSurface =
    deriveWorkspaceCoreSurface(activePreferences);
  const emptySurfaceHash = await hashWorkspaceCoreSurface(emptySurface);
  const activeSurfaceHash = await hashWorkspaceCoreSurface(activeSurface);
  const personalSurfaceBefore = await admin.query<{
    surface: unknown;
    receipt_id: string | null;
    receipt_hash: string | null;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            core_surface_selection_receipt_id::text as receipt_id,
            core_surface_selection_receipt_hash as receipt_hash
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, otherWorkspaceId],
  );

  const createSql = `select public.create_workspace_core_surface_selection_approval(
    $1, $2, $3, $4, $5, $6::text, $7::text, $8::jsonb, $9::jsonb,
    $10::timestamptz
  ) as creation`;
  const applySql = `select public.apply_workspace_core_surface_selection(
    $1, $2, $3, $4
  ) as result`;
  const expiry = (milliseconds = 60 * 60 * 1_000): string =>
    new Date(Date.now() + milliseconds).toISOString();
  const signedOwner =
    (
      subjectId = ids.ownerAuth,
      authTime = Math.floor(Date.now() / 1_000),
      options: Parameters<typeof setWorkspaceStepUpContext>[5] = {},
      installationId = bootstrap.installationId,
      workspaceId = ids.workspace,
    ) =>
    (client: Client): Promise<void> =>
      setWorkspaceStepUpContext(
        client,
        installationId,
        workspaceId,
        subjectId,
        authTime,
        options,
      );
  const creationValues = (options: {
    approvalId: string;
    workId?: string;
    capabilityGrantId?: string;
    compiledRegistrySha256?: string;
    expectedCurrentSurfaceSha256?: string;
    expectedPredecessorCoreSurfaceSelectionReceipt?: unknown;
    targetPreferences?: unknown;
    expiresAt?: string;
    installationId?: string;
    workspaceId?: string;
  }): unknown[] => [
    options.approvalId,
    options.installationId ?? bootstrap.installationId,
    options.workspaceId ?? ids.workspace,
    options.workId ?? ids.validWork,
    options.capabilityGrantId ?? ids.goodGrant,
    options.compiledRegistrySha256 ??
      workspaceCompiledCoreSurfaceRegistrySha256,
    options.expectedCurrentSurfaceSha256 ?? emptySurfaceHash,
    options.expectedPredecessorCoreSurfaceSelectionReceipt === undefined
      ? null
      : options.expectedPredecessorCoreSurfaceSelectionReceipt,
    JSON.stringify(options.targetPreferences ?? activePreferences),
    options.expiresAt ?? expiry(),
  ];
  const createApproval = async (
    options: Parameters<typeof creationValues>[0],
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<WorkspaceCoreSurfaceSelectionApprovalCreation> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      async (client) => {
        const result = await client.query<{ creation: unknown }>(
          createSql,
          creationValues(options),
        );
        return parseWorkspaceCoreSurfaceSelectionApprovalCreation(
          result.rows[0]?.creation,
        );
      },
    );
  const denyCreate = (
    label: string,
    options: Parameters<typeof creationValues>[0],
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<void> =>
    expectRuntimeSqlState(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      createSql,
      creationValues(options),
      "P0001",
      label,
    );
  const applySelection = async (
    creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
    receiptId: string,
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<WorkspaceCoreSurfaceSelectionReceipt> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      async (client) => {
        const result = await client.query<{ result: unknown }>(applySql, [
          receiptId,
          creation.approval.approvalId,
          creation.approval.binding.vortonInstallationId,
          creation.approval.binding.workspaceId,
        ]);
        const bundle = result.rows[0]?.result as
          { receipt?: unknown } | undefined;
        return parseWorkspaceCoreSurfaceSelectionReceipt(
          bundle?.receipt,
          creation,
        );
      },
    );
  const denyApply = (
    label: string,
    creation: WorkspaceCoreSurfaceSelectionApprovalCreation,
    receiptId = randomUUID(),
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<void> =>
    expectRuntimeSqlState(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      applySql,
      [
        receiptId,
        creation.approval.approvalId,
        creation.approval.binding.vortonInstallationId,
        creation.approval.binding.workspaceId,
      ],
      "P0001",
      label,
    );
  const withoutRuntimeContextKey = async (
    operation: () => Promise<void>,
  ): Promise<void> => {
    const key = await admin.query<{
      role_name: string;
      secret: Buffer;
      created_at: Date;
    }>(
      `delete from aubos_private.runtime_context_keys
        where role_name = $1
        returning role_name::text, secret, created_at`,
      [bootstrap.runtimeDatabaseRole],
    );
    const removedKey = key.rows[0];
    requireCondition(
      removedKey,
      "Synthetic runtime context key was unavailable for missing-key proof",
    );
    try {
      await operation();
    } finally {
      await admin.query(
        `insert into aubos_private.runtime_context_keys
           (role_name, secret, created_at)
         values ($1, $2, $3)`,
        [removedKey.role_name, removedKey.secret, removedKey.created_at],
      );
    }
  };

  const legacySurfaceState = await admin.query<{
    surface: unknown;
    surface_hash: string;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            public.vorton_module_lifecycle_hash(
              public.workspace_core_surface_document($1, $2)
            ) as surface_hash`,
    [legacyCoreSurfaceInstallationId, legacyCoreSurfaceWorkspaceId],
  );
  const legacySurfaceHash = legacySurfaceState.rows[0]?.surface_hash;
  requireCondition(
    legacySurfaceHash,
    "Legacy core-surface fixture did not expose an exact preimage hash",
  );
  const signedLegacyOwner = signedOwner(
    legacyCoreSurfaceOwnerAuthUserId,
    Math.floor(Date.now() / 1_000),
    {},
    legacyCoreSurfaceInstallationId,
    legacyCoreSurfaceWorkspaceId,
  );
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "authenticated",
    signedLegacyOwner,
    createSql,
    [
      randomUUID(),
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceWorkspaceId,
      randomUUID(),
      randomUUID(),
      workspaceCompiledCoreSurfaceRegistrySha256,
      legacySurfaceHash,
      null,
      JSON.stringify(activePreferences),
      expiry(),
    ],
    "P0001",
    "Unreconciled legacy core surface approval",
  );
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "authenticated",
    signedLegacyOwner,
    applySql,
    [
      randomUUID(),
      randomUUID(),
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceWorkspaceId,
    ],
    "P0001",
    "Unreconciled legacy core surface application",
  );
  await verifyLegacyCoreSurfaceUnchangedAfterAuthorityMigration(admin);

  // Current presentation attribution belongs to the installation person, not
  // to mutable workspace membership. Existing revocation-ledger retention is
  // a separate audit contract, so this fixture deliberately has no revocation.
  await admin.query(
    `delete from public.workspace_memberships
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceWorkspaceId,
      legacyCoreSurfaceOwnerPersonId,
    ],
  );
  const unpinnedAttribution = await admin.query<{
    memberships: string;
    attributed_rows: string;
  }>(
    `select
       (select count(*)::text from public.workspace_memberships
         where installation_id = $1 and workspace_id = $2 and person_id = $3)
         as memberships,
       (select count(*)::text from public.workspace_module_activations
         where installation_id = $1 and workspace_id = $2
           and created_by_person_id = $3) as attributed_rows`,
    [
      legacyCoreSurfaceInstallationId,
      legacyCoreSurfaceWorkspaceId,
      legacyCoreSurfaceOwnerPersonId,
    ],
  );
  requireCondition(
    unpinnedAttribution.rows[0]?.memberships === "0" &&
      unpinnedAttribution.rows[0]?.attributed_rows === "2",
    "Current core-surface attribution still pinned workspace membership",
  );
  await verifyLegacyCoreSurfaceUnchangedAfterAuthorityMigration(admin);

  for (const [label, setup] of [
    [
      "Unsigned core-surface selection base context",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        baseSignature: "unsigned",
      }),
    ],
    [
      "Forged core-surface selection base context",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        baseSignature: "forged",
      }),
    ],
    [
      "Unsigned core-surface selection step-up context",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        stepUpSignature: "unsigned",
      }),
    ],
    [
      "Forged core-surface selection step-up context",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        stepUpSignature: "forged",
      }),
    ],
    [
      "AAL1 core-surface selection context",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        aal: "aal1",
      }),
    ],
    [
      "Stale core-surface selection AAL2",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000) - 601),
    ],
    [
      "Future core-surface selection AAL2",
      signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000) + 60),
    ],
    ["Core-surface selection by non-owner", signedOwner(ids.nonOwnerAuth)],
    [
      "Core-surface selection by revoked owner",
      signedOwner(ids.revokedOwnerAuth),
    ],
    [
      "Core-surface selection by person without membership",
      signedOwner(ids.noMembershipAuth),
    ],
    [
      "Core-surface selection with wrong signed workspace",
      signedOwner(
        ids.ownerAuth,
        Math.floor(Date.now() / 1_000),
        {},
        bootstrap.installationId,
        ids.outOfBandWorkspace,
      ),
    ],
    [
      "Core-surface selection with wrong signed installation",
      signedOwner(
        ids.ownerAuth,
        Math.floor(Date.now() / 1_000),
        {},
        otherInstallationId,
        ids.workspace,
      ),
    ],
  ] as const) {
    await denyCreate(label, { approvalId: randomUUID() }, setup);
  }

  const nonexistentWorkspaceId = randomUUID();
  const forgedContext = (workspaceId: string) =>
    signedOwner(
      ids.ownerAuth,
      Math.floor(Date.now() / 1_000),
      { baseSignature: "forged" },
      bootstrap.installationId,
      workspaceId,
    );
  for (const [label, workspaceId] of [
    ["existing workspace create existence oracle", ids.workspace],
    ["nonexistent workspace create existence oracle", nonexistentWorkspaceId],
  ] as const) {
    await expectRuntimeSqlStateAndMessage(
      runtimeDatabaseUrl,
      "authenticated",
      forgedContext(workspaceId),
      createSql,
      creationValues({ approvalId: randomUUID(), workspaceId }),
      "P0001",
      "Signed recent workspace-person AAL2 is required",
      label,
    );
  }
  for (const [label, workspaceId] of [
    ["existing workspace apply existence oracle", ids.workspace],
    ["nonexistent workspace apply existence oracle", nonexistentWorkspaceId],
  ] as const) {
    await expectRuntimeSqlStateAndMessage(
      runtimeDatabaseUrl,
      "authenticated",
      forgedContext(workspaceId),
      applySql,
      [randomUUID(), randomUUID(), bootstrap.installationId, workspaceId],
      "P0001",
      "Signed recent workspace-person AAL2 is required",
      label,
    );
  }

  for (const [label, workId, capabilityGrantId] of [
    [
      "Wrong person core-surface selection grant",
      ids.validWork,
      ids.wrongPrincipalGrant,
    ],
    [
      "Wrong Work core-surface selection grant",
      ids.validWork,
      ids.wrongWorkGrant,
    ],
    [
      "Wrong core-surface selection capability",
      ids.validWork,
      ids.wrongCapabilityGrant,
    ],
    ["Wrong core-surface selection mode", ids.validWork, ids.wrongModeGrant],
    ["Expired core-surface selection grant", ids.validWork, ids.expiredGrant],
    ["Revoked core-surface selection grant", ids.validWork, ids.revokedGrant],
    [
      "Invalid core-surface selection Policy",
      ids.validWork,
      ids.badPolicyGrant,
    ],
    [
      "Proposed core-surface selection Work",
      ids.proposedWork,
      ids.proposedWorkGrant,
    ],
    [
      "Wrong-custodian core-surface selection Work",
      ids.wrongCustodianWork,
      ids.wrongCustodianGrant,
    ],
    ["Leased core-surface selection Work", ids.leasedWork, ids.leasedWorkGrant],
  ] as const) {
    await denyCreate(label, {
      approvalId: randomUUID(),
      workId,
      capabilityGrantId,
    });
  }

  for (const [label, targetPreferences] of [
    [
      "Core-surface selection default outside target preferences",
      { ...activePreferences, defaultCoreSurfaceId: "goals" },
    ],
    [
      "Unordered core-surface selection target preferences",
      {
        ...activePreferences,
        coreSurfaces: [...activePreferences.coreSurfaces].reverse(),
      },
    ],
    [
      "Duplicate core-surface selection navigation order",
      {
        ...activePreferences,
        coreSurfaces: activePreferences.coreSurfaces.map((surface) => ({
          ...surface,
          navigationOrder: 10,
        })),
      },
    ],
    [
      "Unsupported core-surface selection identity",
      {
        defaultCoreSurfaceId: "finance",
        coreSurfaces: [{ id: "finance", navigationOrder: 10 }],
      },
    ],
    [
      "Caller-supplied core-surface label injection",
      {
        defaultCoreSurfaceId: "factory",
        coreSurfaces: [
          { id: "factory", navigationOrder: 10, label: "Substituted" },
        ],
      },
    ],
    [
      "Caller-supplied presentation variant injection",
      {
        defaultCoreSurfaceId: "factory",
        coreSurfaces: [
          {
            id: "factory",
            navigationOrder: 10,
            presentationVariant: "standard",
          },
        ],
      },
    ],
  ] as const) {
    await denyCreate(label, { approvalId: randomUUID(), targetPreferences });
  }
  await denyCreate("Substituted compiled core-surface registry digest", {
    approvalId: randomUUID(),
    compiledRegistrySha256: canonicalSha256("substituted-registry"),
  });
  await denyCreate("Substituted current core-surface hash", {
    approvalId: randomUUID(),
    expectedCurrentSurfaceSha256: activeSurfaceHash,
  });
  await denyCreate("Genesis with invented predecessor", {
    approvalId: randomUUID(),
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: randomUUID(),
      receiptSha256: canonicalSha256("invented-predecessor"),
    },
  });
  await denyCreate("Core-surface selection with unchanged target surface", {
    approvalId: randomUUID(),
    targetPreferences: emptyPreferences,
  });
  await denyCreate("Core-surface selection approval identity reused as Work", {
    approvalId: ids.validWork,
  });
  await denyCreate("Core-surface selection approval identity reused as grant", {
    approvalId: ids.goodGrant,
  });
  await denyCreate(
    "Core-surface selection approval identity reused as Policy",
    {
      approvalId: ids.goodPolicy,
    },
  );
  await denyCreate("Core-surface selection Work identity reused as grant", {
    approvalId: randomUUID(),
    workId: ids.goodGrant,
    capabilityGrantId: ids.goodGrant,
  });
  const predecessorCollisionApprovalId = randomUUID();
  await denyCreate(
    "Core-surface selection predecessor reuses approval identity",
    {
      approvalId: predecessorCollisionApprovalId,
      expectedPredecessorCoreSurfaceSelectionReceipt: {
        receiptId: predecessorCollisionApprovalId,
        receiptSha256: canonicalSha256("predecessor-identity-collision"),
      },
    },
  );
  await denyCreate("Core-surface selection predecessor reuses current hash", {
    approvalId: randomUUID(),
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: randomUUID(),
      receiptSha256: emptySurfaceHash,
    },
  });
  await denyCreate("Core-surface selection predecessor reuses target hash", {
    approvalId: randomUUID(),
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: randomUUID(),
      receiptSha256: activeSurfaceHash,
    },
  });

  await admin.query(
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id)
     values ($1, $2, 'command', 'v1', 'Command Bridge', 10, 'standard', $3)`,
    [bootstrap.installationId, ids.outOfBandWorkspace, ids.ownerPerson],
  );
  await admin.query(
    `update public.workspaces set default_module_id = 'command'
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.outOfBandWorkspace],
  );
  const outOfBandSurface = {
    defaultModuleId: "command",
    modules: [activeSurface.modules[0]],
  };
  await denyCreate(
    "Out-of-band module rows retroactively blessed",
    {
      approvalId: randomUUID(),
      installationId: bootstrap.installationId,
      workspaceId: ids.outOfBandWorkspace,
      expectedCurrentSurfaceSha256:
        await hashWorkspaceCoreSurface(outOfBandSurface),
    },
    signedOwner(
      ids.ownerAuth,
      Math.floor(Date.now() / 1_000),
      {},
      bootstrap.installationId,
      ids.outOfBandWorkspace,
    ),
  );

  const tableCountsBefore = await admin.query<{
    approvals: string;
    approval_receipts: string;
    selection_receipts: string;
    records: string;
  }>(`select
    (select count(*)::text from public.workspace_core_surface_selection_approvals)
      as approvals,
    (select count(*)::text
       from public.workspace_core_surface_selection_approval_receipts)
      as approval_receipts,
    (select count(*)::text from public.workspace_core_surface_selection_receipts)
      as selection_receipts,
    (select count(*)::text from public.records) as records`);
  await admin.query(`
    create function public.vorton_test_fail_core_surface_selection_approval_receipt()
    returns trigger language plpgsql as $$
    begin
      raise exception 'Synthetic core-surface selection approval receipt failure';
    end
    $$;
    create trigger vorton_test_fail_core_surface_selection_approval_receipt
      before insert on public.workspace_core_surface_selection_approval_receipts
      for each row
      execute function public.vorton_test_fail_core_surface_selection_approval_receipt();
  `);
  try {
    await denyCreate(
      "Core-surface selection approval receipt insertion rollback",
      {
        approvalId: randomUUID(),
        expectedPredecessorCoreSurfaceSelectionReceipt: null,
      },
    );
  } finally {
    await admin.query(`
      drop trigger vorton_test_fail_core_surface_selection_approval_receipt
        on public.workspace_core_surface_selection_approval_receipts;
      drop function public.vorton_test_fail_core_surface_selection_approval_receipt();
    `);
  }
  const countsAfterFailedApproval = await admin.query<{
    approvals: string;
    approval_receipts: string;
    selection_receipts: string;
    records: string;
  }>(`select
    (select count(*)::text from public.workspace_core_surface_selection_approvals)
      as approvals,
    (select count(*)::text
       from public.workspace_core_surface_selection_approval_receipts)
      as approval_receipts,
    (select count(*)::text from public.workspace_core_surface_selection_receipts)
      as selection_receipts,
    (select count(*)::text from public.records) as records`);
  requireCondition(
    canonicalModuleLifecycleJson(countsAfterFailedApproval.rows[0]) ===
      canonicalModuleLifecycleJson(tableCountsBefore.rows[0]),
    "Failed core-surface selection approval did not roll back authority atomically",
  );
  const mainApprovalId = randomUUID();
  const mainCreation = await createApproval({
    approvalId: mainApprovalId,
    expiresAt: expiry(3_000),
    // Deliberately use JavaScript null, which node-postgres sends as SQL NULL.
    expectedPredecessorCoreSurfaceSelectionReceipt: null,
  });
  requireCondition(
    mainCreation.approval.binding.predecessorCoreSurfaceSelectionReceipt ===
      null &&
      mainCreation.approval.binding.realm === "organizational" &&
      mainCreation.approval.ownerPersonId === ids.ownerPerson &&
      mainCreation.approval.authority.personId === ids.ownerPerson,
    "Genesis approval did not derive exact owner, realm, or null lineage",
  );
  requireCondition(
    (await hashWorkspaceCoreSurfaceSelectionApprovalCore(
      mainCreation.approval,
    )) === mainCreation.approvalReceipt.approvalHash &&
      (await hashWorkspaceCoreSurfaceSelectionApprovalReceipt(
        mainCreation.approvalReceipt,
      )) === mainCreation.approvalReceipt.receiptHash &&
      (await hashWorkspaceCoreSurface(
        mainCreation.approval.binding.currentSurface,
      )) === mainCreation.approval.binding.currentSurfaceSha256 &&
      (await hashWorkspaceCoreSurface(
        mainCreation.approval.binding.targetSurface,
      )) === mainCreation.approval.binding.targetSurfaceSha256,
    "PostgreSQL core-surface selection approval hashes differ from TypeScript",
  );
  const persistedWork = await admin.query<{ snapshot: unknown }>(
    `select work_snapshot as snapshot
       from public.workspace_core_surface_selection_approvals
      where installation_id = $1 and workspace_id = $2 and approval_id = $3`,
    [bootstrap.installationId, ids.workspace, mainApprovalId],
  );
  requireCondition(
    (await hashWorkspaceCoreSurfaceSelectionWorkSnapshot(
      persistedWork.rows[0]?.snapshot,
    )) === mainCreation.approval.binding.workSnapshotSha256,
    "PostgreSQL core-surface selection Work snapshot hash differs from TypeScript",
  );
  const tableCountsAfterApproval = await admin.query<{
    approvals: string;
    approval_receipts: string;
    selection_receipts: string;
    records: string;
    module_rows: string;
    default_module_id: string | null;
    lineage_id: string | null;
  }>(
    `select
      (select count(*)::text from public.workspace_core_surface_selection_approvals)
        as approvals,
      (select count(*)::text
         from public.workspace_core_surface_selection_approval_receipts)
        as approval_receipts,
      (select count(*)::text from public.workspace_core_surface_selection_receipts)
        as selection_receipts,
      (select count(*)::text from public.records) as records,
      (select count(*)::text from public.workspace_module_activations
        where installation_id = $1 and workspace_id = $2) as module_rows,
      default_module_id,
      core_surface_selection_receipt_id::text as lineage_id
     from public.workspaces where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.workspace],
  );
  const approvedCounts = tableCountsAfterApproval.rows[0];
  requireCondition(
    Number(approvedCounts?.approvals) ===
      Number(tableCountsBefore.rows[0]?.approvals) + 1 &&
      Number(approvedCounts?.approval_receipts) ===
        Number(tableCountsBefore.rows[0]?.approval_receipts) + 1 &&
      approvedCounts?.selection_receipts ===
        tableCountsBefore.rows[0]?.selection_receipts &&
      Number(approvedCounts?.records) ===
        Number(tableCountsBefore.rows[0]?.records) + 1 &&
      approvedCounts?.module_rows === "0" &&
      approvedCounts.default_module_id === null &&
      approvedCounts.lineage_id === null,
    "Activation approval and no-effect receipt were not atomic or no-effect",
  );
  const exactApprovalReplay = await createApproval({
    approvalId: mainApprovalId,
    expiresAt: mainCreation.approval.expiresAt,
    expectedPredecessorCoreSurfaceSelectionReceipt: null,
  });
  requireCondition(
    canonicalModuleLifecycleJson(exactApprovalReplay) ===
      canonicalModuleLifecycleJson(mainCreation),
    "Exact core-surface selection approval retry drifted",
  );
  await denyCreate(
    "Conflicting immutable core-surface selection approval retry",
    {
      approvalId: mainApprovalId,
      expiresAt: mainCreation.approval.expiresAt,
      expectedPredecessorCoreSurfaceSelectionReceipt: null,
      targetPreferences: {
        defaultCoreSurfaceId: "tasks",
        coreSurfaces: activePreferences.coreSurfaces,
      },
    },
  );

  const receiptRaceCreationA = await createApproval(
    {
      approvalId: randomUUID(),
      workspaceId: ids.receiptRaceWorkspaceA,
      workId: ids.receiptRaceWorkA,
      capabilityGrantId: ids.receiptRaceGrantA,
      expectedCurrentSurfaceSha256: emptySurfaceHash,
      expectedPredecessorCoreSurfaceSelectionReceipt: null,
      targetPreferences: activePreferences,
    },
    signedOwner(
      ids.ownerAuth,
      Math.floor(Date.now() / 1_000),
      {},
      bootstrap.installationId,
      ids.receiptRaceWorkspaceA,
    ),
  );
  const receiptRaceCreationB = await createApproval(
    {
      approvalId: randomUUID(),
      workspaceId: ids.receiptRaceWorkspaceB,
      workId: ids.receiptRaceWorkB,
      capabilityGrantId: ids.receiptRaceGrantB,
      expectedCurrentSurfaceSha256: emptySurfaceHash,
      expectedPredecessorCoreSurfaceSelectionReceipt: null,
      targetPreferences: activePreferences,
    },
    signedOwner(
      ids.ownerAuth,
      Math.floor(Date.now() / 1_000),
      {},
      bootstrap.installationId,
      ids.receiptRaceWorkspaceB,
    ),
  );
  const receiptRaceSentinels = [randomUUID(), randomUUID()] as const;
  await admin.query(
    `insert into public.records
       (id, installation_id, workspace_id, kind, summary, payload,
        classification, actor_person_id)
     values
       ($1, $3, $4, 'evidence', 'Synthetic receipt race sentinel A.',
        '{"fixture":"receipt-race-sentinel-a"}'::jsonb, 'synthetic', $6),
       ($2, $3, $5, 'evidence', 'Synthetic receipt race sentinel B.',
        '{"fixture":"receipt-race-sentinel-b"}'::jsonb, 'synthetic', $6)`,
    [
      receiptRaceSentinels[0],
      receiptRaceSentinels[1],
      bootstrap.installationId,
      ids.receiptRaceWorkspaceA,
      ids.receiptRaceWorkspaceB,
      ids.ownerPerson,
    ],
  );
  const sharedCrossWorkspaceReceiptId = randomUUID();
  await admin.query(`
    create function public.vorton_test_delay_cross_workspace_receipt_race()
    returns trigger language plpgsql as $$
    begin
      perform pg_sleep(0.25);
      return new;
    end
    $$;
    create trigger vorton_test_delay_cross_workspace_receipt_race
      before insert on public.workspace_core_surface_selection_receipts
      for each row
      execute function public.vorton_test_delay_cross_workspace_receipt_race();
  `);
  let receiptRaceResults: PromiseSettledResult<WorkspaceCoreSurfaceSelectionReceipt>[];
  try {
    receiptRaceResults = await Promise.allSettled([
      applySelection(
        receiptRaceCreationA,
        sharedCrossWorkspaceReceiptId,
        signedOwner(
          ids.ownerAuth,
          Math.floor(Date.now() / 1_000),
          {},
          bootstrap.installationId,
          ids.receiptRaceWorkspaceA,
        ),
      ),
      applySelection(
        receiptRaceCreationB,
        sharedCrossWorkspaceReceiptId,
        signedOwner(
          ids.ownerAuth,
          Math.floor(Date.now() / 1_000),
          {},
          bootstrap.installationId,
          ids.receiptRaceWorkspaceB,
        ),
      ),
    ]);
  } finally {
    await admin.query(`
      drop trigger vorton_test_delay_cross_workspace_receipt_race
        on public.workspace_core_surface_selection_receipts;
      drop function public.vorton_test_delay_cross_workspace_receipt_race();
    `);
  }
  const successfulReceiptRace = receiptRaceResults.filter(
    (
      result,
    ): result is PromiseFulfilledResult<WorkspaceCoreSurfaceSelectionReceipt> =>
      result.status === "fulfilled",
  );
  const rejectedReceiptRace = receiptRaceResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  requireCondition(
    successfulReceiptRace.length === 1 &&
      rejectedReceiptRace.length === 1 &&
      (rejectedReceiptRace[0]?.reason as { code?: string } | undefined)
        ?.code === "P0001",
    "Cross-workspace receipt identity race did not return one success and one deliberate P0001",
  );
  const receiptRaceWinner = successfulReceiptRace[0]?.value;
  requireCondition(
    receiptRaceWinner,
    "Cross-workspace receipt identity race did not return a winning receipt",
  );
  const receiptRaceState = await admin.query<{
    workspace_id: string;
    surface: unknown;
    lineage_id: string | null;
    lineage_hash: string | null;
    receipt_count: string;
    sentinel_payload: unknown;
  }>(
    `select workspace.id::text as workspace_id,
            public.workspace_core_surface_document(
              workspace.installation_id, workspace.id
            ) as surface,
            workspace.core_surface_selection_receipt_id::text as lineage_id,
            workspace.core_surface_selection_receipt_hash as lineage_hash,
            (select count(*)::text
               from public.workspace_core_surface_selection_receipts receipt
              where receipt.installation_id = workspace.installation_id
                and receipt.workspace_id = workspace.id) as receipt_count,
            (select record.payload
               from public.records record
              where record.id = case
                when workspace.id = $2 then $4::uuid else $5::uuid
              end) as sentinel_payload
       from public.workspaces workspace
      where workspace.installation_id = $1
        and workspace.id in ($2, $3)
      order by workspace.id`,
    [
      bootstrap.installationId,
      ids.receiptRaceWorkspaceA,
      ids.receiptRaceWorkspaceB,
      receiptRaceSentinels[0],
      receiptRaceSentinels[1],
    ],
  );
  const winningRaceWorkspaceId = receiptRaceWinner.binding.workspaceId;
  for (const row of receiptRaceState.rows) {
    const isWinner = row.workspace_id === winningRaceWorkspaceId;
    requireCondition(
      canonicalModuleLifecycleJson(row.surface) ===
        canonicalModuleLifecycleJson(isWinner ? activeSurface : emptySurface) &&
        row.lineage_id === (isWinner ? sharedCrossWorkspaceReceiptId : null) &&
        row.lineage_hash ===
          (isWinner ? receiptRaceWinner.receiptHash : null) &&
        row.receipt_count === (isWinner ? "1" : "0") &&
        canonicalModuleLifecycleJson(row.sentinel_payload) ===
          canonicalModuleLifecycleJson({
            fixture:
              row.workspace_id === ids.receiptRaceWorkspaceA
                ? "receipt-race-sentinel-a"
                : "receipt-race-sentinel-b",
          }),
      "Cross-workspace receipt identity race did not roll back the loser atomically",
    );
  }
  const receiptRaceIdentityRows = await admin.query<{
    selection_receipts: string;
    records: string;
    record_workspace_id: string | null;
  }>(
    `select
       (select count(*)::text
          from public.workspace_core_surface_selection_receipts receipt
         where receipt.receipt_id = $1) as selection_receipts,
       (select count(*)::text
          from public.records record
         where record.id = $1) as records,
       (select record.workspace_id::text
          from public.records record
         where record.id = $1) as record_workspace_id`,
    [sharedCrossWorkspaceReceiptId],
  );
  requireCondition(
    receiptRaceIdentityRows.rows[0]?.selection_receipts === "1" &&
      receiptRaceIdentityRows.rows[0]?.records === "1" &&
      receiptRaceIdentityRows.rows[0]?.record_workspace_id ===
        winningRaceWorkspaceId,
    "Cross-workspace receipt identity race did not preserve one winning receipt and Record",
  );

  const hostileApplyContexts: ReadonlyArray<{
    label: string;
    setup: (client: Client) => Promise<void>;
  }> = [
    {
      label: "unsigned base context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        baseSignature: "unsigned",
      }),
    },
    {
      label: "forged base context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        baseSignature: "forged",
      }),
    },
    {
      label: "unsigned step-up context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        stepUpSignature: "unsigned",
      }),
    },
    {
      label: "forged step-up context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        stepUpSignature: "forged",
      }),
    },
    {
      label: "AAL1 context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000), {
        aal: "aal1",
      }),
    },
    {
      label: "stale AAL2 context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000) - 601),
    },
    {
      label: "future AAL2 context",
      setup: signedOwner(ids.ownerAuth, Math.floor(Date.now() / 1_000) + 60),
    },
    {
      label: "non-owner context",
      setup: signedOwner(ids.nonOwnerAuth),
    },
    {
      label: "wrong-workspace signed context",
      setup: signedOwner(
        ids.ownerAuth,
        Math.floor(Date.now() / 1_000),
        {},
        bootstrap.installationId,
        ids.outOfBandWorkspace,
      ),
    },
  ];
  for (const hostile of hostileApplyContexts) {
    await denyApply(
      `Core-surface selection apply with ${hostile.label}`,
      mainCreation,
      randomUUID(),
      hostile.setup,
    );
  }
  await withoutRuntimeContextKey(async () => {
    const workspaceValidators = await inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      signedOwner(),
      (client) =>
        client.query<{
          legacy_valid: boolean | null;
          workspace_valid: boolean | null;
        }>(
          `select
             public.aubos_runtime_context_valid(
               'person', $1::text, $2::text
             ) as legacy_valid,
             public.aubos_runtime_context_valid(
               'person', $1::text, $3::text, $2::text
             ) as workspace_valid`,
          [bootstrap.installationId, ids.ownerAuth, ids.workspace],
        ),
    );
    requireCondition(
      workspaceValidators.rows[0]?.legacy_valid === false &&
        workspaceValidators.rows[0]?.workspace_valid === false,
      "Missing runtime key did not make shared workspace validators literal false",
    );
    const installationValidator = await inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      (client) =>
        setSignedInstallationStepUpContext(
          client,
          bootstrap.installationId,
          ids.ownerAuth,
          Math.floor(Date.now() / 1_000),
        ),
      (client) =>
        client.query<{ valid: boolean | null }>(
          `select public.vorton_installation_step_up_context_valid(
             $1::text, $2::text
           ) as valid`,
          [bootstrap.installationId, ids.ownerAuth],
        ),
    );
    requireCondition(
      installationValidator.rows[0]?.valid === false,
      "Missing runtime key did not make installation validator literal false",
    );
    await denyCreate(
      "Core-surface selection approval with missing runtime key",
      {
        approvalId: randomUUID(),
      },
    );
    await denyApply(
      "Core-surface selection apply with missing runtime key",
      mainCreation,
    );
    await expectRuntimeSqlStateAndMessage(
      runtimeDatabaseUrl,
      "authenticated",
      signedOwner(),
      `select public.create_workspace_membership_revocation_approval(
         $1, $2, $3, $4, $5::public.person_kind, $6, $7, $8::timestamptz
       )`,
      [
        randomUUID(),
        bootstrap.installationId,
        ids.workspace,
        ids.nonOwnerPerson,
        "member",
        ids.validWork,
        ids.goodGrant,
        expiry(),
      ],
      "P0001",
      "Signed recent workspace-person AAL2 is required",
      "Prior workspace authority with missing runtime key",
    );
    await expectRuntimeSqlStateAndMessage(
      runtimeDatabaseUrl,
      "authenticated",
      (client) =>
        setSignedInstallationStepUpContext(
          client,
          bootstrap.installationId,
          ids.ownerAuth,
          Math.floor(Date.now() / 1_000),
        ),
      `select public.create_release_adoption_approval(
         $1, $2, $3, $4::jsonb, $5::timestamptz
       )`,
      [
        randomUUID(),
        bootstrap.installationId,
        canonicalSha256("missing-key-release-plan"),
        JSON.stringify({}),
        expiry(),
      ],
      "P0001",
      "Signed installation-person AAL2 context is required to approve release adoption",
      "Prior installation authority with missing runtime key",
    );
  });
  const duplicateGenesisCreation = await createApproval({
    approvalId: randomUUID(),
    expectedPredecessorCoreSurfaceSelectionReceipt: null,
  });

  const mainReceiptId = randomUUID();
  await denyApply(
    "Core-surface selection receipt reuses approval identity",
    mainCreation,
    mainCreation.approval.approvalId,
  );
  const [mainReceipt, concurrentMainReceipt] = await Promise.all([
    applySelection(mainCreation, mainReceiptId),
    applySelection(mainCreation, mainReceiptId),
  ]);
  requireCondition(
    canonicalModuleLifecycleJson(concurrentMainReceipt) ===
      canonicalModuleLifecycleJson(mainReceipt) &&
      (await hashWorkspaceCoreSurfaceSelectionReceipt(mainReceipt)) ===
        mainReceipt.receiptHash &&
      mainReceipt.preimageSurfaceSha256 === emptySurfaceHash &&
      mainReceipt.postimageSurfaceSha256 === activeSurfaceHash &&
      mainReceipt.predecessorCoreSurfaceSelectionReceipt === null &&
      mainReceipt.rowCounts.preimageCoreSurfaceRows === 0 &&
      mainReceipt.rowCounts.deletedCoreSurfaceRows === 0 &&
      mainReceipt.rowCounts.insertedCoreSurfaceRows === 2 &&
      mainReceipt.rowCounts.postimageCoreSurfaceRows === 2,
    "Applied core-surface selection receipt is not canonical or exact",
  );
  const installedSurface = await admin.query<{
    surface: unknown;
    receipt_id: string | null;
    receipt_hash: string | null;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            core_surface_selection_receipt_id::text as receipt_id,
            core_surface_selection_receipt_hash as receipt_hash
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.workspace],
  );
  requireCondition(
    canonicalModuleLifecycleJson(installedSurface.rows[0]?.surface) ===
      canonicalModuleLifecycleJson(activeSurface) &&
      installedSurface.rows[0]?.receipt_id === mainReceipt.receiptId &&
      installedSurface.rows[0]?.receipt_hash === mainReceipt.receiptHash,
    "Applied core surface or receipt lineage was not installed exactly",
  );
  await denyApply(
    "Duplicate genesis core-surface selection apply",
    duplicateGenesisCreation,
  );
  await admin.query(
    `update public.workspaces
        set default_module_id = null,
            core_surface_selection_receipt_id = null,
            core_surface_selection_receipt_hash = null
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.workspace],
  );
  await admin.query(
    `delete from public.workspace_module_activations
      where installation_id = $1 and workspace_id = $2`,
    [bootstrap.installationId, ids.workspace],
  );
  try {
    await denyApply(
      "Pending second genesis after out-of-band reset",
      duplicateGenesisCreation,
    );
    const deniedGenesisState = await admin.query<{
      surface: unknown;
      lineage_id: string | null;
      receipt_count: string;
    }>(
      `select public.workspace_core_surface_document($1, $2) as surface,
              core_surface_selection_receipt_id::text as lineage_id,
              (select count(*)::text
                 from public.workspace_core_surface_selection_receipts receipt
                where receipt.installation_id = $1
                  and receipt.workspace_id = $2
                  and receipt.approval_id = $3) as receipt_count
         from public.workspaces
        where installation_id = $1 and id = $2`,
      [
        bootstrap.installationId,
        ids.workspace,
        duplicateGenesisCreation.approval.approvalId,
      ],
    );
    requireCondition(
      canonicalModuleLifecycleJson(deniedGenesisState.rows[0]?.surface) ===
        canonicalModuleLifecycleJson(emptySurface) &&
        deniedGenesisState.rows[0]?.lineage_id === null &&
        deniedGenesisState.rows[0]?.receipt_count === "0",
      "Denied second genesis mutated the reset workspace",
    );
  } finally {
    await admin.query(
      `insert into public.workspace_module_activations
         (installation_id, workspace_id, module_id, contract_version, label,
          navigation_order, presentation_variant, created_by_person_id)
       values
         ($1, $2, 'command', 'v1', 'Command Bridge', 10, 'standard', $3),
         ($1, $2, 'tasks', 'v1', 'Tasks', 20, 'standard', $3)`,
      [bootstrap.installationId, ids.workspace, ids.ownerPerson],
    );
    await admin.query(
      `update public.workspaces
          set default_module_id = 'command',
              core_surface_selection_receipt_id = $3,
              core_surface_selection_receipt_hash = $4
        where installation_id = $1 and id = $2`,
      [
        bootstrap.installationId,
        ids.workspace,
        mainReceipt.receiptId,
        mainReceipt.receiptHash,
      ],
    );
  }

  const projectionLockCreation = await createApproval({
    approvalId: randomUUID(),
    workId: ids.rollbackWork,
    capabilityGrantId: ids.rollbackGrant,
    expectedCurrentSurfaceSha256: activeSurfaceHash,
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: mainReceipt.receiptId,
      receiptSha256: mainReceipt.receiptHash,
    },
    targetPreferences: emptyPreferences,
  });
  const projectionWriter = await connect(adminDatabaseUrl);
  try {
    await projectionWriter.query("begin");
    await projectionWriter.query(
      `update public.workspace_module_activations
          set label = 'Concurrent unreceipted Tasks drift'
        where installation_id = $1 and workspace_id = $2
          and module_id = 'tasks'`,
      [bootstrap.installationId, ids.workspace],
    );
    const serializedApply = denyApply(
      "Core-surface selection after serialized concurrent preimage drift",
      projectionLockCreation,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    await projectionWriter.query("commit");
    await serializedApply;
    const serializedDriftState = await admin.query<{
      label: string;
      receipt_count: string;
      lineage_id: string | null;
    }>(
      `select activation.label,
              (select count(*)::text
                 from public.workspace_core_surface_selection_receipts receipt
                where receipt.installation_id = $1
                  and receipt.workspace_id = $2
                  and receipt.approval_id = $3) as receipt_count,
              workspace.core_surface_selection_receipt_id::text as lineage_id
         from public.workspace_module_activations activation
         join public.workspaces workspace
           on workspace.installation_id = activation.installation_id
          and workspace.id = activation.workspace_id
        where activation.installation_id = $1
          and activation.workspace_id = $2
          and activation.module_id = 'tasks'`,
      [
        bootstrap.installationId,
        ids.workspace,
        projectionLockCreation.approval.approvalId,
      ],
    );
    requireCondition(
      serializedDriftState.rows[0]?.label ===
        "Concurrent unreceipted Tasks drift" &&
        serializedDriftState.rows[0]?.receipt_count === "0" &&
        serializedDriftState.rows[0]?.lineage_id === mainReceipt.receiptId,
      "Serialized projection drift was receipted as an approved preimage",
    );
  } catch (error) {
    await projectionWriter.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await projectionWriter.end();
    await admin.query(
      `update public.workspace_module_activations set label = 'Tasks'
        where installation_id = $1 and workspace_id = $2
          and module_id = 'tasks'`,
      [bootstrap.installationId, ids.workspace],
    );
  }
  for (const hostile of hostileApplyContexts) {
    await denyApply(
      `Core-surface selection replay with ${hostile.label}`,
      mainCreation,
      mainReceiptId,
      hostile.setup,
    );
  }
  await withoutRuntimeContextKey(() =>
    denyApply(
      "Core-surface selection replay with missing runtime key",
      mainCreation,
      mainReceiptId,
    ),
  );
  await admin.query(
    `update public.workspace_module_activations set label = 'Drifted Tasks'
      where installation_id = $1 and workspace_id = $2
        and module_id = 'tasks'`,
    [bootstrap.installationId, ids.workspace],
  );
  try {
    await denyApply(
      "Exact core-surface selection replay after unreceipted module-row drift",
      mainCreation,
      mainReceiptId,
    );
  } finally {
    await admin.query(
      `update public.workspace_module_activations set label = 'Tasks'
        where installation_id = $1 and workspace_id = $2
          and module_id = 'tasks'`,
      [bootstrap.installationId, ids.workspace],
    );
  }
  await admin.query(
    `update public.workspaces
        set core_surface_selection_receipt_id = null,
            core_surface_selection_receipt_hash = null
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.workspace],
  );
  try {
    await denyApply(
      "Exact core-surface selection replay after unreceipted lineage-pointer drift",
      mainCreation,
      mainReceiptId,
    );
  } finally {
    await admin.query(
      `update public.workspaces
          set core_surface_selection_receipt_id = $3,
              core_surface_selection_receipt_hash = $4
        where installation_id = $1 and id = $2`,
      [
        bootstrap.installationId,
        ids.workspace,
        mainReceipt.receiptId,
        mainReceipt.receiptHash,
      ],
    );
  }
  const personalSurfaceAfter = await admin.query<{
    surface: unknown;
    receipt_id: string | null;
    receipt_hash: string | null;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            core_surface_selection_receipt_id::text as receipt_id,
            core_surface_selection_receipt_hash as receipt_hash
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, otherWorkspaceId],
  );
  requireCondition(
    canonicalModuleLifecycleJson(personalSurfaceAfter.rows[0]) ===
      canonicalModuleLifecycleJson(personalSurfaceBefore.rows[0]),
    "Core-surface selection mutated a foreign workspace",
  );

  await new Promise((resolveWait) => setTimeout(resolveWait, 3_200));
  const expiredExactReplay = await applySelection(mainCreation, mainReceiptId);
  requireCondition(
    canonicalModuleLifecycleJson(expiredExactReplay) ===
      canonicalModuleLifecycleJson(mainReceipt),
    "Exact core-surface selection replay after expiry did not return one receipt",
  );
  await denyApply(
    "Conflicting core-surface selection receipt after authority expiry",
    mainCreation,
  );

  const driftCases: Array<{
    label: string;
    workId: string;
    grantId: string;
    mutate: () => Promise<void>;
    restore: () => Promise<void>;
  }> = [
    {
      label: "Core-surface selection Work snapshot drift",
      workId: ids.workDriftWork,
      grantId: ids.workDriftGrant,
      mutate: async () => {
        await admin.query(
          `update public.work set title = title || ' drift'
            where installation_id = $1 and workspace_id = $2 and id = $3`,
          [bootstrap.installationId, ids.workspace, ids.workDriftWork],
        );
      },
      restore: async () => {
        await admin.query(
          `update public.work set title = replace(title, ' drift', '')
            where installation_id = $1 and workspace_id = $2 and id = $3`,
          [bootstrap.installationId, ids.workspace, ids.workDriftWork],
        );
      },
    },
    {
      label: "Core-surface selection Policy drift",
      workId: ids.policyDriftWork,
      grantId: ids.policyDriftGrant,
      mutate: async () => {
        await admin.query(
          `update public.policies
              set definition = definition || '{"drift":true}'::jsonb
            where installation_id = $1 and workspace_id = $2 and id = $3`,
          [bootstrap.installationId, ids.workspace, ids.policyDriftPolicy],
        );
      },
      restore: async () => {
        await admin.query(
          `update public.policies set definition = definition - 'drift'
            where installation_id = $1 and workspace_id = $2 and id = $3`,
          [bootstrap.installationId, ids.workspace, ids.policyDriftPolicy],
        );
      },
    },
    {
      label: "Core-surface selection capability grant drift",
      workId: ids.grantDriftWork,
      grantId: ids.grantDriftGrant,
      mutate: async () => {
        await admin.query(
          `update public.capability_grants
              set expires_at = clock_timestamp() - interval '1 second'
            where installation_id = $1 and workspace_id = $2 and id = $3`,
          [bootstrap.installationId, ids.workspace, ids.grantDriftGrant],
        );
      },
      restore: async () => {
        await admin.query(
          `update public.capability_grants set expires_at = null
            where installation_id = $1 and workspace_id = $2 and id = $3`,
          [bootstrap.installationId, ids.workspace, ids.grantDriftGrant],
        );
      },
    },
  ];
  for (const drift of driftCases) {
    const creation = await createApproval({
      approvalId: randomUUID(),
      workId: drift.workId,
      capabilityGrantId: drift.grantId,
      expectedCurrentSurfaceSha256: activeSurfaceHash,
      expectedPredecessorCoreSurfaceSelectionReceipt: {
        receiptId: mainReceipt.receiptId,
        receiptSha256: mainReceipt.receiptHash,
      },
      targetPreferences: emptyPreferences,
    });
    await drift.mutate();
    try {
      await denyApply(drift.label, creation);
    } finally {
      await drift.restore();
    }
  }

  const rollbackCreation = await createApproval({
    approvalId: randomUUID(),
    workId: ids.rollbackWork,
    capabilityGrantId: ids.rollbackGrant,
    expectedCurrentSurfaceSha256: activeSurfaceHash,
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: mainReceipt.receiptId,
      receiptSha256: mainReceipt.receiptHash,
    },
    targetPreferences: emptyPreferences,
  });
  const pendingForkCreation = await createApproval({
    approvalId: randomUUID(),
    workId: ids.rollbackWork,
    capabilityGrantId: ids.rollbackGrant,
    expectedCurrentSurfaceSha256: activeSurfaceHash,
    expectedPredecessorCoreSurfaceSelectionReceipt: {
      receiptId: mainReceipt.receiptId,
      receiptSha256: mainReceipt.receiptHash,
    },
    targetPreferences: emptyPreferences,
  });
  await denyApply(
    "Core-surface selection receipt reuses predecessor identity",
    rollbackCreation,
    mainReceipt.receiptId,
  );
  const unrelatedRecordReceiptId = randomUUID();
  await admin.query(
    `insert into public.records
       (id, installation_id, workspace_id, work_id, kind, summary, payload,
        classification, actor_person_id)
     values ($1, $2, $3, $4, 'evidence',
             'Synthetic unrelated core-surface selection receipt collision.',
             '{"fixture":"unrelated-receipt-identity"}'::jsonb,
             'synthetic', $5)`,
    [
      unrelatedRecordReceiptId,
      bootstrap.installationId,
      ids.workspace,
      ids.rollbackWork,
      ids.ownerPerson,
    ],
  );
  const unrelatedRecordCollisionBefore = await admin.query<{
    surface: unknown;
    receipt_count: string;
    lineage_id: string | null;
    record_payload: unknown;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            (select count(*)::text
               from public.workspace_core_surface_selection_receipts receipt
              where receipt.installation_id = $1
                and receipt.workspace_id = $2
                and receipt.approval_id = $3) as receipt_count,
            core_surface_selection_receipt_id::text as lineage_id,
            (select payload
               from public.records record
              where record.installation_id = $1
                and record.workspace_id = $2
                and record.id = $4) as record_payload
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [
      bootstrap.installationId,
      ids.workspace,
      rollbackCreation.approval.approvalId,
      unrelatedRecordReceiptId,
    ],
  );
  await denyApply(
    "Core-surface selection receipt identity collides with unrelated Record",
    rollbackCreation,
    unrelatedRecordReceiptId,
  );
  const unrelatedRecordCollisionAfter = await admin.query<{
    surface: unknown;
    receipt_count: string;
    lineage_id: string | null;
    record_payload: unknown;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            (select count(*)::text
               from public.workspace_core_surface_selection_receipts receipt
              where receipt.installation_id = $1
                and receipt.workspace_id = $2
                and receipt.approval_id = $3) as receipt_count,
            core_surface_selection_receipt_id::text as lineage_id,
            (select payload
               from public.records record
              where record.installation_id = $1
                and record.workspace_id = $2
                and record.id = $4) as record_payload
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [
      bootstrap.installationId,
      ids.workspace,
      rollbackCreation.approval.approvalId,
      unrelatedRecordReceiptId,
    ],
  );
  requireCondition(
    canonicalModuleLifecycleJson(unrelatedRecordCollisionAfter.rows[0]) ===
      canonicalModuleLifecycleJson(unrelatedRecordCollisionBefore.rows[0]),
    "Unrelated Record receipt identity collision mutated core-surface selection state",
  );
  const foreignRecordReceiptId = randomUUID();
  await admin.query(
    `insert into public.records
       (id, installation_id, workspace_id, kind, summary, payload,
        classification, actor_person_id)
     values ($1, $2, $3, 'evidence',
             'Synthetic foreign-workspace core-surface selection receipt collision.',
             '{"fixture":"foreign-receipt-identity"}'::jsonb,
             'synthetic', $4)`,
    [
      foreignRecordReceiptId,
      bootstrap.installationId,
      ids.outOfBandWorkspace,
      ids.ownerPerson,
    ],
  );
  const foreignRecordCollisionBefore = await admin.query<{
    surface: unknown;
    receipt_count: string;
    lineage_id: string | null;
    foreign_record: unknown;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            (select count(*)::text
               from public.workspace_core_surface_selection_receipts receipt
              where receipt.installation_id = $1
                and receipt.workspace_id = $2
                and receipt.approval_id = $3) as receipt_count,
            core_surface_selection_receipt_id::text as lineage_id,
            (select jsonb_build_object(
                      'installationId', record.installation_id::text,
                      'workspaceId', record.workspace_id::text,
                      'payload', record.payload
                    )
               from public.records record
              where record.id = $4) as foreign_record
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [
      bootstrap.installationId,
      ids.workspace,
      rollbackCreation.approval.approvalId,
      foreignRecordReceiptId,
    ],
  );
  await denyApply(
    "Core-surface selection receipt identity collides with foreign-workspace Record",
    rollbackCreation,
    foreignRecordReceiptId,
  );
  const foreignRecordCollisionAfter = await admin.query<{
    surface: unknown;
    receipt_count: string;
    lineage_id: string | null;
    foreign_record: unknown;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            (select count(*)::text
               from public.workspace_core_surface_selection_receipts receipt
              where receipt.installation_id = $1
                and receipt.workspace_id = $2
                and receipt.approval_id = $3) as receipt_count,
            core_surface_selection_receipt_id::text as lineage_id,
            (select jsonb_build_object(
                      'installationId', record.installation_id::text,
                      'workspaceId', record.workspace_id::text,
                      'payload', record.payload
                    )
               from public.records record
              where record.id = $4) as foreign_record
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [
      bootstrap.installationId,
      ids.workspace,
      rollbackCreation.approval.approvalId,
      foreignRecordReceiptId,
    ],
  );
  requireCondition(
    canonicalModuleLifecycleJson(foreignRecordCollisionAfter.rows[0]) ===
      canonicalModuleLifecycleJson(foreignRecordCollisionBefore.rows[0]),
    "Foreign-workspace Record receipt identity collision mutated either workspace",
  );
  await admin.query(`
    create function public.vorton_test_fail_core_surface_selection_record_insert()
    returns trigger language plpgsql as $$
    begin
      raise exception 'Synthetic core-surface selection Record insertion failure';
    end
    $$;
    create trigger vorton_test_fail_core_surface_selection_record_insert
      before insert on public.records
      for each row
      when (new.summary = 'Applied workspace core-surface selection')
      execute function public.vorton_test_fail_core_surface_selection_record_insert();
  `);
  try {
    await denyApply(
      "Core-surface selection application Record insertion rollback",
      rollbackCreation,
    );
  } finally {
    await admin.query(`
      drop trigger vorton_test_fail_core_surface_selection_record_insert
        on public.records;
      drop function public.vorton_test_fail_core_surface_selection_record_insert();
    `);
  }
  const failedApplicationState = await admin.query<{
    surface: unknown;
    receipt_count: string;
    lineage_id: string | null;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            (select count(*)::text
               from public.workspace_core_surface_selection_receipts receipt
              where receipt.installation_id = $1
                and receipt.workspace_id = $2
                and receipt.approval_id = $3) as receipt_count,
            core_surface_selection_receipt_id::text as lineage_id
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [
      bootstrap.installationId,
      ids.workspace,
      rollbackCreation.approval.approvalId,
    ],
  );
  requireCondition(
    canonicalModuleLifecycleJson(failedApplicationState.rows[0]?.surface) ===
      canonicalModuleLifecycleJson(activeSurface) &&
      failedApplicationState.rows[0]?.receipt_count === "0" &&
      failedApplicationState.rows[0]?.lineage_id === mainReceipt.receiptId,
    "Failed core-surface selection did not roll back projection, receipt, and lineage atomically",
  );
  const conflictingRollbackReceipts = [randomUUID(), randomUUID()] as const;
  const conflictingRollbackResults = await Promise.allSettled(
    conflictingRollbackReceipts.map((receiptId) =>
      applySelection(rollbackCreation, receiptId),
    ),
  );
  const successfulRollbackResults = conflictingRollbackResults.filter(
    (
      result,
    ): result is PromiseFulfilledResult<WorkspaceCoreSurfaceSelectionReceipt> =>
      result.status === "fulfilled",
  );
  const rejectedRollbackResults = conflictingRollbackResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  requireCondition(
    successfulRollbackResults.length === 1 &&
      rejectedRollbackResults.length === 1 &&
      (rejectedRollbackResults[0]?.reason as { code?: string } | undefined)
        ?.code === "P0001",
    "Conflicting concurrent core-surface selection receipts did not elect exactly one immutable application",
  );
  const rollbackReceipt = successfulRollbackResults[0]?.value;
  requireCondition(
    rollbackReceipt,
    "Concurrent core-surface selection did not return the winning receipt",
  );
  requireCondition(
    canonicalModuleLifecycleJson(rollbackReceipt.preimageSurface) ===
      canonicalModuleLifecycleJson(activeSurface) &&
      canonicalModuleLifecycleJson(rollbackReceipt.postimageSurface) ===
        canonicalModuleLifecycleJson(emptySurface) &&
      rollbackReceipt.predecessorCoreSurfaceSelectionReceipt?.receiptId ===
        mainReceipt.receiptId &&
      rollbackReceipt.predecessorCoreSurfaceSelectionReceipt?.receiptSha256 ===
        mainReceipt.receiptHash,
    "Governed rollback did not restore the exact compiled preimage",
  );
  const rollbackState = await admin.query<{
    surface: unknown;
    receipt_id: string | null;
    receipt_hash: string | null;
  }>(
    `select public.workspace_core_surface_document($1, $2) as surface,
            core_surface_selection_receipt_id::text as receipt_id,
            core_surface_selection_receipt_hash as receipt_hash
       from public.workspaces
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.workspace],
  );
  requireCondition(
    canonicalModuleLifecycleJson(rollbackState.rows[0]?.surface) ===
      canonicalModuleLifecycleJson(emptySurface) &&
      rollbackState.rows[0]?.receipt_id === rollbackReceipt.receiptId &&
      rollbackState.rows[0]?.receipt_hash === rollbackReceipt.receiptHash,
    "Governed module-surface rollback did not advance exact lineage",
  );
  await admin.query(
    `insert into public.workspace_module_activations
       (installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id)
     values
       ($1, $2, 'command', 'v1', 'Command Bridge', 10, 'standard', $3),
       ($1, $2, 'tasks', 'v1', 'Tasks', 20, 'standard', $3)`,
    [bootstrap.installationId, ids.workspace, ids.ownerPerson],
  );
  await admin.query(
    `update public.workspaces
        set default_module_id = 'command',
            core_surface_selection_receipt_id = $3,
            core_surface_selection_receipt_hash = $4
      where installation_id = $1 and id = $2`,
    [
      bootstrap.installationId,
      ids.workspace,
      mainReceipt.receiptId,
      mainReceipt.receiptHash,
    ],
  );
  try {
    await denyApply(
      "Exact replay after out-of-band regression to nonterminal receipt",
      mainCreation,
      mainReceipt.receiptId,
    );
    await denyCreate("Stale core-surface selection lineage fork", {
      approvalId: randomUUID(),
      expectedCurrentSurfaceSha256: activeSurfaceHash,
      expectedPredecessorCoreSurfaceSelectionReceipt: {
        receiptId: mainReceipt.receiptId,
        receiptSha256: mainReceipt.receiptHash,
      },
      targetPreferences: emptyPreferences,
    });
    await denyApply(
      "Pending core-surface selection fork after out-of-band regression",
      pendingForkCreation,
    );
    const deniedPendingForkState = await admin.query<{
      surface: unknown;
      lineage_id: string | null;
      receipt_count: string;
    }>(
      `select public.workspace_core_surface_document($1, $2) as surface,
              core_surface_selection_receipt_id::text as lineage_id,
              (select count(*)::text
                 from public.workspace_core_surface_selection_receipts receipt
                where receipt.installation_id = $1
                  and receipt.workspace_id = $2
                  and receipt.approval_id = $3) as receipt_count
         from public.workspaces
        where installation_id = $1 and id = $2`,
      [
        bootstrap.installationId,
        ids.workspace,
        pendingForkCreation.approval.approvalId,
      ],
    );
    requireCondition(
      canonicalModuleLifecycleJson(deniedPendingForkState.rows[0]?.surface) ===
        canonicalModuleLifecycleJson(activeSurface) &&
        deniedPendingForkState.rows[0]?.lineage_id === mainReceipt.receiptId &&
        deniedPendingForkState.rows[0]?.receipt_count === "0",
      "Denied pending core-surface selection fork mutated regressed state",
    );
  } finally {
    await admin.query(
      `update public.workspaces
          set default_module_id = null,
              core_surface_selection_receipt_id = $3,
              core_surface_selection_receipt_hash = $4
        where installation_id = $1 and id = $2`,
      [
        bootstrap.installationId,
        ids.workspace,
        rollbackReceipt.receiptId,
        rollbackReceipt.receiptHash,
      ],
    );
    await admin.query(
      `delete from public.workspace_module_activations
        where installation_id = $1 and workspace_id = $2`,
      [bootstrap.installationId, ids.workspace],
    );
  }
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(),
    applySql,
    [
      mainReceipt.receiptId,
      rollbackCreation.approval.approvalId,
      bootstrap.installationId,
      ids.workspace,
    ],
    "P0001",
    "Cross-paired core-surface selection approval and receipt identities",
  );
  const historicalMainReplay = await applySelection(
    mainCreation,
    mainReceipt.receiptId,
  );
  requireCondition(
    canonicalModuleLifecycleJson(historicalMainReplay) ===
      canonicalModuleLifecycleJson(mainReceipt),
    "Historical exact core-surface selection replay failed after governed successor",
  );

  await expectSqlState(
    admin,
    `update public.workspace_core_surface_selection_approvals
        set binding = binding
      where installation_id = $1 and workspace_id = $2 and approval_id = $3`,
    [bootstrap.installationId, ids.workspace, mainApprovalId],
    "P0001",
    "Immutable core-surface selection approval update",
  );
  await expectSqlState(
    admin,
    `delete from public.workspace_core_surface_selection_approval_receipts
      where installation_id = $1 and workspace_id = $2 and approval_id = $3`,
    [bootstrap.installationId, ids.workspace, mainApprovalId],
    "P0001",
    "Immutable core-surface selection approval receipt delete",
  );
  await expectSqlState(
    admin,
    `update public.workspace_core_surface_selection_receipts
        set row_counts = row_counts
      where installation_id = $1 and workspace_id = $2 and receipt_id = $3`,
    [bootstrap.installationId, ids.workspace, mainReceipt.receiptId],
    "P0001",
    "Immutable core-surface selection application receipt update",
  );

  await admin.query(
    `update public.workspace_memberships set kind = 'owner'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, ids.workspace, ids.nonOwnerPerson],
  );
  await denyApply(
    "Core-surface selection replay by a different live owner",
    rollbackCreation,
    rollbackReceipt.receiptId,
    signedOwner(ids.nonOwnerAuth),
  );
  await admin.query(
    `update public.workspace_memberships set kind = 'member'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, ids.workspace, ids.nonOwnerPerson],
  );

  await admin.query(
    `update public.workspace_memberships set kind = 'member'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, ids.workspace, ids.ownerPerson],
  );
  await denyApply(
    "Exact core-surface selection replay after owner demotion",
    rollbackCreation,
    rollbackReceipt.receiptId,
  );
  await admin.query(
    `update public.workspace_memberships set kind = 'owner'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, ids.workspace, ids.ownerPerson],
  );
  await admin.query(
    `insert into public.workspace_membership_revocations
       (installation_id, workspace_id, person_id, revoked_by_person_id,
        revoked_at)
     values ($1, $2, $3, $3,
             date_trunc('milliseconds', clock_timestamp()))`,
    [bootstrap.installationId, ids.workspace, ids.ownerPerson],
  );
  await denyApply(
    "Exact core-surface selection replay after owner revocation",
    rollbackCreation,
    rollbackReceipt.receiptId,
  );

  for (const [role, setup] of [
    ["authenticated", signedOwner(ids.nonOwnerAuth)],
    [
      "aubos_worker",
      (client: Client) =>
        setSignedContext(
          client,
          "worker",
          bootstrap.installationId,
          ids.workspace,
          bootstrap.workerId,
          randomUUID(),
        ),
    ],
  ] as const) {
    await expectRuntimeDenied(
      runtimeDatabaseUrl,
      role,
      setup,
      "select count(*) from public.workspace_core_surface_selection_approvals",
      [],
      `${role} direct core-surface selection approval read`,
    );
    await expectRuntimeDenied(
      runtimeDatabaseUrl,
      role,
      setup,
      "insert into public.workspace_core_surface_selection_receipts default values",
      [],
      `${role} direct core-surface selection receipt write`,
    );
  }
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(ids.nonOwnerAuth),
    `update public.workspaces set default_module_id = null
      where installation_id = $1 and id = $2`,
    [bootstrap.installationId, ids.workspace],
    "Authenticated direct default-module mutation",
  );
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "aubos_worker",
    (client) =>
      setSignedContext(
        client,
        "worker",
        bootstrap.installationId,
        ids.workspace,
        bootstrap.workerId,
        randomUUID(),
      ),
    createSql,
    creationValues({ approvalId: randomUUID() }),
    "42501",
    "Worker core-surface selection route",
  );

  const applicationRecords = await admin.query<{
    count: string;
    distinct_payloads: string;
  }>(
    `select count(*)::text as count,
            count(distinct payload)::text as distinct_payloads
       from public.records
      where installation_id = $1 and workspace_id = $2
        and kind = 'receipt'
        and summary = 'Applied workspace core-surface selection'`,
    [bootstrap.installationId, ids.workspace],
  );
  requireCondition(
    applicationRecords.rows[0]?.count === "2" &&
      applicationRecords.rows[0]?.distinct_payloads === "2",
    "Exact replay created an extra core-surface selection receipt or Record",
  );

  // A second transaction cannot mutate the workspace while application holds
  // the workspace row lock. This is the serialization seam for authority and
  // projection changes.
  const lockOwner = await connect(adminDatabaseUrl);
  const lockContender = await connect(adminDatabaseUrl);
  try {
    await lockOwner.query("begin");
    await lockOwner.query(
      `select 1 from public.workspaces
        where installation_id = $1 and id = $2 for update`,
      [bootstrap.installationId, ids.workspace],
    );
    await lockContender.query("begin");
    await lockContender.query("set local lock_timeout = '100ms'");
    await expectSqlState(
      lockContender,
      `update public.workspaces set display_name = display_name
        where installation_id = $1 and id = $2`,
      [bootstrap.installationId, ids.workspace],
      "55P03",
      "Workspace core-surface selection serialization",
    );
    await lockContender.query("rollback");
    await lockOwner.query("commit");
  } catch (error) {
    await lockOwner.query("rollback").catch(() => undefined);
    await lockContender.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await lockOwner.end();
    await lockContender.end();
  }
}

async function proveWorkspaceMembershipRevocationBoundary(
  admin: Client,
  adminDatabaseUrl: string,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  const ids = {
    noMembershipAuth: randomUUID(),
    noMembershipPerson: randomUUID(),
    nonOwnerAuth: randomUUID(),
    nonOwnerPerson: randomUUID(),
    revokedOwnerAuth: randomUUID(),
    revokedOwnerPerson: randomUUID(),
    secondOwnerAuth: randomUUID(),
    secondOwnerPerson: randomUUID(),
    targetAuth: randomUUID(),
    targetPerson: randomUUID(),
    revokedTargetAuth: randomUUID(),
    revokedTargetPerson: randomUUID(),
    externalTargetAuth: randomUUID(),
    externalTargetPerson: randomUUID(),
    finalOwnerWorkspace: randomUUID(),
    validWork: randomUUID(),
    otherWork: randomUUID(),
    proposedWork: randomUUID(),
    wrongCustodianWork: randomUUID(),
    leasedWork: randomUUID(),
    snapshotDriftWork: randomUUID(),
    policyDriftWork: randomUUID(),
    grantExpiryDriftWork: randomUUID(),
    grantRevocationDriftWork: randomUUID(),
    goodPolicy: randomUUID(),
    badPolicy: randomUUID(),
    policyDriftPolicy: randomUUID(),
    goodGrant: randomUUID(),
    wrongPrincipalGrant: randomUUID(),
    wrongWorkGrant: randomUUID(),
    wrongCapabilityGrant: randomUUID(),
    wrongModeGrant: randomUUID(),
    expiredGrant: randomUUID(),
    revokedGrant: randomUUID(),
    badPolicyGrant: randomUUID(),
    proposedWorkGrant: randomUUID(),
    wrongCustodianGrant: randomUUID(),
    leasedWorkGrant: randomUUID(),
    snapshotDriftGrant: randomUUID(),
    policyDriftGrant: randomUUID(),
    grantExpiryDriftGrant: randomUUID(),
    grantRevocationDriftGrant: randomUUID(),
    memoryRetrieveGrant: randomUUID(),
  };

  await admin.query(
    `insert into auth.users (id, email) values
       ($1, 'revocation-no-membership@synthetic.invalid'),
       ($2, 'revocation-non-owner@synthetic.invalid'),
       ($3, 'revocation-revoked-owner@synthetic.invalid'),
       ($4, 'revocation-second-owner@synthetic.invalid'),
       ($5, 'revocation-target@synthetic.invalid'),
       ($6, 'revocation-revoked-target@synthetic.invalid'),
       ($7, 'revocation-external-target@synthetic.invalid')`,
    [
      ids.noMembershipAuth,
      ids.nonOwnerAuth,
      ids.revokedOwnerAuth,
      ids.secondOwnerAuth,
      ids.targetAuth,
      ids.revokedTargetAuth,
      ids.externalTargetAuth,
    ],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values
       ($1, $15, $2, 'Synthetic revocation person without membership', 'member'),
       ($3, $15, $4, 'Synthetic revocation non-owner', 'member'),
       ($5, $15, $6, 'Synthetic revoked revocation owner', 'owner'),
       ($7, $15, $8, 'Synthetic second revocation owner', 'owner'),
       ($9, $15, $10, 'Synthetic revocation target', 'member'),
       ($11, $15, $12, 'Synthetic revoked revocation target', 'member'),
       ($13, $15, $14, 'Synthetic externally revoked target', 'member')`,
    [
      ids.noMembershipPerson,
      ids.noMembershipAuth,
      ids.nonOwnerPerson,
      ids.nonOwnerAuth,
      ids.revokedOwnerPerson,
      ids.revokedOwnerAuth,
      ids.secondOwnerPerson,
      ids.secondOwnerAuth,
      ids.targetPerson,
      ids.targetAuth,
      ids.revokedTargetPerson,
      ids.revokedTargetAuth,
      ids.externalTargetPerson,
      ids.externalTargetAuth,
      bootstrap.installationId,
    ],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values
       ($1, $2, $3, 'member'),
       ($1, $2, $4, 'owner'),
       ($1, $2, $5, 'owner'),
       ($1, $2, $6, 'member'),
       ($1, $2, $7, 'member'),
       ($1, $2, $8, 'member')`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.nonOwnerPerson,
      ids.revokedOwnerPerson,
      ids.secondOwnerPerson,
      ids.targetPerson,
      ids.revokedTargetPerson,
      ids.externalTargetPerson,
    ],
  );
  await admin.query(
    `insert into public.workspaces
       (id, installation_id, slug, display_name, realm, created_by_person_id)
     values ($1, $2, $3, 'Synthetic final-owner boundary',
             'organizational', $4)`,
    [
      ids.finalOwnerWorkspace,
      bootstrap.installationId,
      `final-owner-${ids.finalOwnerWorkspace.slice(0, 8)}`,
      ids.secondOwnerPerson,
    ],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values ($1, $2, $3, 'owner')`,
    [bootstrap.installationId, ids.finalOwnerWorkspace, ids.secondOwnerPerson],
  );
  await admin.query(
    `insert into public.workspace_membership_revocations
       (installation_id, workspace_id, person_id, revoked_by_person_id,
        revoked_at)
     values
       ($1, $2, $3, $5, date_trunc('milliseconds', clock_timestamp())),
       ($1, $2, $4, $5, date_trunc('milliseconds', clock_timestamp()))`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.revokedOwnerPerson,
      ids.revokedTargetPerson,
      ownerPersonId,
    ],
  );

  const insertWork = async (
    id: string,
    state: "proposed" | "ready" | "leased",
    custodianPersonId: string | null,
    custodianWorkerId: string | null = null,
  ): Promise<void> => {
    await admin.query(
      `insert into public.work
         (id, installation_id, workspace_id, title, requested_outcome,
          acceptance_criteria, state, priority, requested_by_person_id,
          custodian_person_id, custodian_worker_id, lease_expires_at,
          created_at, updated_at)
       values
         ($1, $2, $3, $4, $5, $6::jsonb, $7::public.work_state, 90, $8, $9, $10,
          case when $7::text = 'leased'
               then clock_timestamp() + interval '1 hour'
               else null end,
          '2026-08-31T17:30:00.123456Z'::timestamptz,
          '2026-08-31T17:45:00.654321Z'::timestamptz)`,
      [
        id,
        bootstrap.installationId,
        bootstrap.workspaceId,
        `Govern membership revocation ${id.slice(0, 8)}`,
        "Remove one exact membership while preserving an owner",
        JSON.stringify([
          "Use the exact workspace scoped grant",
          "Leave every foreign workspace untouched",
        ]),
        state,
        ownerPersonId,
        custodianPersonId,
        custodianWorkerId,
      ],
    );
  };
  await insertWork(ids.validWork, "ready", ownerPersonId);
  await insertWork(ids.otherWork, "ready", ownerPersonId);
  await insertWork(ids.proposedWork, "proposed", ownerPersonId);
  await insertWork(ids.wrongCustodianWork, "ready", ids.targetPerson);
  await insertWork(ids.leasedWork, "leased", null, bootstrap.workerId);
  await insertWork(ids.snapshotDriftWork, "ready", ownerPersonId);
  await insertWork(ids.policyDriftWork, "ready", ownerPersonId);
  await insertWork(ids.grantExpiryDriftWork, "ready", ownerPersonId);
  await insertWork(ids.grantRevocationDriftWork, "ready", ownerPersonId);

  const goodPolicyDefinition = {
    version: 1,
    capability: "workspace.membership.revoke",
    rule: "exact-ready-work",
  };
  const policyDriftDefinition = {
    version: 1,
    capability: "workspace.membership.revoke",
    rule: "drift-test",
  };
  await admin.query(
    `insert into public.policies
       (id, installation_id, workspace_id, name, version, definition,
        content_sha256, created_by_person_id)
     values
       ($1, $4, $5, 'Synthetic membership revocation', 1, $6::jsonb, $7, $8),
       ($2, $4, $5, 'Synthetic invalid membership revocation', 1, $6::jsonb,
        $9, $8),
       ($3, $4, $5, 'Synthetic drifting membership revocation', 1,
        $10::jsonb, $11, $8)`,
    [
      ids.goodPolicy,
      ids.badPolicy,
      ids.policyDriftPolicy,
      bootstrap.installationId,
      bootstrap.workspaceId,
      JSON.stringify(goodPolicyDefinition),
      canonicalSha256(goodPolicyDefinition).slice("sha256:".length),
      ownerPersonId,
      "0".repeat(64),
      JSON.stringify(policyDriftDefinition),
      canonicalSha256(policyDriftDefinition).slice("sha256:".length),
    ],
  );

  const insertGrant = async (options: {
    id: string;
    workId: string | null;
    policyId?: string;
    personId?: string;
    capability?: string;
    mode?: "observe" | "modify";
    expiresAt?: string | null;
  }): Promise<void> => {
    await admin.query(
      `insert into public.capability_grants
         (id, installation_id, workspace_id, policy_id, principal_kind,
          person_id, worker_id, capability, mode, work_id, expires_at,
          granted_by_person_id, granted_at)
       values
         ($1, $2, $3, $4, 'person', $5, null, $6, $7, $8,
          $9::timestamptz, $10, clock_timestamp() - interval '2 hours')`,
      [
        options.id,
        bootstrap.installationId,
        bootstrap.workspaceId,
        options.policyId ?? ids.goodPolicy,
        options.personId ?? ownerPersonId,
        options.capability ?? "workspace.membership.revoke",
        options.mode ?? "modify",
        options.workId,
        options.expiresAt ?? null,
        ownerPersonId,
      ],
    );
  };
  await insertGrant({ id: ids.goodGrant, workId: ids.validWork });
  await insertGrant({
    id: ids.wrongPrincipalGrant,
    workId: ids.validWork,
    personId: ids.targetPerson,
  });
  await insertGrant({ id: ids.wrongWorkGrant, workId: ids.otherWork });
  await insertGrant({
    id: ids.wrongCapabilityGrant,
    workId: ids.validWork,
    capability: "workspace.membership.invite",
  });
  await insertGrant({
    id: ids.wrongModeGrant,
    workId: ids.validWork,
    mode: "observe",
  });
  await insertGrant({
    id: ids.expiredGrant,
    workId: ids.validWork,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await insertGrant({ id: ids.revokedGrant, workId: ids.validWork });
  await insertGrant({
    id: ids.badPolicyGrant,
    workId: ids.validWork,
    policyId: ids.badPolicy,
  });
  await insertGrant({ id: ids.proposedWorkGrant, workId: ids.proposedWork });
  await insertGrant({
    id: ids.wrongCustodianGrant,
    workId: ids.wrongCustodianWork,
  });
  await insertGrant({ id: ids.leasedWorkGrant, workId: ids.leasedWork });
  await insertGrant({
    id: ids.snapshotDriftGrant,
    workId: ids.snapshotDriftWork,
  });
  await insertGrant({
    id: ids.policyDriftGrant,
    workId: ids.policyDriftWork,
    policyId: ids.policyDriftPolicy,
  });
  await insertGrant({
    id: ids.grantExpiryDriftGrant,
    workId: ids.grantExpiryDriftWork,
  });
  await insertGrant({
    id: ids.grantRevocationDriftGrant,
    workId: ids.grantRevocationDriftWork,
  });
  await insertGrant({
    id: ids.memoryRetrieveGrant,
    workId: null,
    personId: ids.targetPerson,
    capability: "memory.retrieve",
    mode: "observe",
  });
  await admin.query(
    `insert into public.capability_grant_revocations
       (installation_id, workspace_id, grant_id, revoked_by_person_id,
        reason, revoked_at)
     values ($1, $2, $3, $4, 'Synthetic revoked grant', clock_timestamp())`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.revokedGrant,
      ownerPersonId,
    ],
  );

  const approvalSql = `select public.create_workspace_membership_revocation_approval(
    $1, $2, $3, $4, $5::public.person_kind, $6, $7, $8::timestamptz
  ) as creation`;
  const applySql = `select public.apply_workspace_membership_revocation(
    $1, $2, $3, $4
  ) as result`;
  const expiry = (): string =>
    new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  const signedOwner =
    (
      subjectId = ownerAuthUserId,
      authTime = Math.floor(Date.now() / 1_000),
      options: Parameters<typeof setWorkspaceStepUpContext>[5] = {},
    ) =>
    (client: Client): Promise<void> =>
      setWorkspaceStepUpContext(
        client,
        bootstrap.installationId,
        bootstrap.workspaceId,
        subjectId,
        authTime,
        options,
      );
  const approvalValues = (options: {
    approvalId: string;
    targetPersonId?: string;
    expectedTargetKind?: "owner" | "member";
    workId?: string;
    capabilityGrantId?: string;
    expiresAt?: string;
    installationId?: string;
    workspaceId?: string;
  }): unknown[] => [
    options.approvalId,
    options.installationId ?? bootstrap.installationId,
    options.workspaceId ?? bootstrap.workspaceId,
    options.targetPersonId ?? ids.targetPerson,
    options.expectedTargetKind ?? "member",
    options.workId ?? ids.validWork,
    options.capabilityGrantId ?? ids.goodGrant,
    options.expiresAt ?? expiry(),
  ];
  const createApproval = async (
    options: Parameters<typeof approvalValues>[0],
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<WorkspaceMembershipRevocationApprovalCreation> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      async (client) => {
        const result = await client.query<{ creation: unknown }>(
          approvalSql,
          approvalValues(options),
        );
        return parseWorkspaceMembershipRevocationApprovalCreation(
          result.rows[0]?.creation,
        );
      },
    );
  const denyApproval = (
    label: string,
    options: Parameters<typeof approvalValues>[0],
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<void> =>
    expectRuntimeSqlState(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      approvalSql,
      approvalValues(options),
      "P0001",
      label,
    );
  const denyApply = (
    label: string,
    approvalId: string,
    receiptId = randomUUID(),
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<void> =>
    expectRuntimeSqlState(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      applySql,
      [receiptId, approvalId, bootstrap.installationId, bootstrap.workspaceId],
      "P0001",
      label,
    );

  const defaultApproval = (): Parameters<typeof approvalValues>[0] => ({
    approvalId: randomUUID(),
  });
  for (const [label, setup] of [
    [
      "Unsigned revocation base context",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000), {
        baseSignature: "unsigned",
      }),
    ],
    [
      "Forged revocation base context",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000), {
        baseSignature: "forged",
      }),
    ],
    [
      "Unsigned revocation step-up context",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000), {
        stepUpSignature: "unsigned",
      }),
    ],
    [
      "Forged revocation step-up context",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000), {
        stepUpSignature: "forged",
      }),
    ],
    [
      "Future revocation AAL2",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000) + 60),
    ],
    [
      "Stale revocation AAL2",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000) - 601),
    ],
    [
      "AAL1 revocation context",
      signedOwner(ownerAuthUserId, Math.floor(Date.now() / 1_000), {
        aal: "aal1",
      }),
    ],
  ] as const) {
    await denyApproval(label, defaultApproval(), setup);
  }
  await denyApproval(
    "Wrong-installation signed revocation context",
    defaultApproval(),
    (client) =>
      setWorkspaceStepUpContext(
        client,
        otherInstallationId,
        bootstrap.workspaceId,
        ownerAuthUserId,
        Math.floor(Date.now() / 1_000),
      ),
  );
  await denyApproval(
    "Wrong-workspace signed revocation context",
    defaultApproval(),
    (client) =>
      setWorkspaceStepUpContext(
        client,
        bootstrap.installationId,
        otherWorkspaceId,
        ownerAuthUserId,
        Math.floor(Date.now() / 1_000),
      ),
  );
  await denyApproval(
    "Unknown signed revocation subject",
    defaultApproval(),
    signedOwner(randomUUID()),
  );
  await denyApproval(
    "Revocation subject without membership",
    defaultApproval(),
    signedOwner(ids.noMembershipAuth),
  );
  await denyApproval(
    "Non-owner revocation actor",
    defaultApproval(),
    signedOwner(ids.nonOwnerAuth),
  );
  await denyApproval(
    "Revoked revocation actor",
    defaultApproval(),
    signedOwner(ids.revokedOwnerAuth),
  );
  await denyApproval("Self revocation", {
    approvalId: randomUUID(),
    targetPersonId: ownerPersonId,
    expectedTargetKind: "owner",
  });
  await denyApproval("Missing revocation target", {
    approvalId: randomUUID(),
    targetPersonId: randomUUID(),
  });
  await denyApproval("Revoked revocation target", {
    approvalId: randomUUID(),
    targetPersonId: ids.revokedTargetPerson,
  });
  await denyApproval("Revocation target kind substitution", {
    approvalId: randomUUID(),
    expectedTargetKind: "owner",
  });
  await denyApproval("Wrong revocation installation path", {
    approvalId: randomUUID(),
    installationId: otherInstallationId,
  });
  await denyApproval("Wrong revocation workspace path", {
    approvalId: randomUUID(),
    workspaceId: otherWorkspaceId,
  });
  for (const [label, workId, capabilityGrantId] of [
    ["Revocation Work is not ready", ids.proposedWork, ids.proposedWorkGrant],
    [
      "Revocation Work has the wrong custodian",
      ids.wrongCustodianWork,
      ids.wrongCustodianGrant,
    ],
    ["Revocation Work has a worker lease", ids.leasedWork, ids.leasedWorkGrant],
  ] as const) {
    await denyApproval(label, {
      approvalId: randomUUID(),
      workId,
      capabilityGrantId,
    });
  }
  for (const [label, capabilityGrantId] of [
    ["Revocation grant has the wrong principal", ids.wrongPrincipalGrant],
    ["Revocation grant has the wrong Work", ids.wrongWorkGrant],
    ["Revocation grant has the wrong capability", ids.wrongCapabilityGrant],
    ["Revocation grant has the wrong mode", ids.wrongModeGrant],
    ["Revocation grant is expired", ids.expiredGrant],
    ["Revocation grant is revoked", ids.revokedGrant],
    ["Revocation Policy digest is invalid", ids.badPolicyGrant],
  ] as const) {
    await denyApproval(label, {
      approvalId: randomUUID(),
      capabilityGrantId,
    });
  }

  const fixedWorkVector = {
    id: "10000000-0000-4000-8000-000000000005",
    vortonInstallationId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    title: "Revoke one synthetic membership",
    requestedOutcome: "Remove one exact membership while preserving an owner",
    acceptanceCriteria: [
      "Use the exact workspace scoped grant",
      "Leave every foreign workspace untouched",
    ],
    state: "ready" as const,
    priority: 90,
    parentWorkId: null,
    requestedByPersonId: "10000000-0000-4000-8000-000000000006",
    custodianPersonId: "10000000-0000-4000-8000-000000000003",
    custodianWorkerId: null,
    leaseExpiresAt: null,
    createdAt: "2026-08-31T17:30:00.123456Z",
    updatedAt: "2026-08-31T17:45:00.654321Z",
  };
  const fixedWorkHash =
    "sha256:4aa0bf8ea6f823480aecb0446160e5faccdd53b0c46b7018bd05ccde7b9b1e4b";
  requireCondition(
    (await hashWorkspaceMembershipRevocationWorkSnapshot(fixedWorkVector)) ===
      fixedWorkHash,
    "TypeScript workspace revocation Work vector changed",
  );
  const fixedSqlVector = await admin.query<{ digest: string }>(
    "select public.vorton_module_lifecycle_hash($1::jsonb) as digest",
    [JSON.stringify(fixedWorkVector)],
  );
  requireCondition(
    fixedSqlVector.rows[0]?.digest === fixedWorkHash,
    "PostgreSQL and TypeScript workspace revocation Work vectors diverged",
  );

  for (const role of ["anon", "authenticated", "aubos_worker"] as const) {
    for (const table of [
      "workspace_membership_revocation_approvals",
      "workspace_membership_revocation_approval_receipts",
      "workspace_membership_revocation_receipts",
    ]) {
      await expectRuntimeDenied(
        runtimeDatabaseUrl,
        role,
        async () => undefined,
        `select count(*) from public.${table}`,
        [],
        `${role} direct ${table} read`,
      );
      await expectRuntimeDenied(
        runtimeDatabaseUrl,
        role,
        async () => undefined,
        `insert into public.${table} default values`,
        [],
        `${role} direct ${table} write`,
      );
    }
  }
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(),
    `select public.workspace_membership_revocation_work_snapshot(
       candidate
     ) from public.work candidate
       where candidate.installation_id = $1
         and candidate.workspace_id = $2 and candidate.id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, ids.validWork],
    "Authenticated revocation hash helper execution",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(),
    "select public.revoke_workspace_membership($1, $2, $3)",
    [bootstrap.installationId, bootstrap.workspaceId, ids.targetPerson],
    "Authenticated hostile-proof revocation helper execution",
  );

  const actorLockApprovalId = randomUUID();
  const actorLockExpiry = expiry();
  const approvalClient = await connect(runtimeDatabaseUrl);
  const actorRevocationClient = await connect(adminDatabaseUrl);
  let actorLockCreation: WorkspaceMembershipRevocationApprovalCreation;
  try {
    await approvalClient.query("begin");
    await setWorkspaceStepUpContext(
      approvalClient,
      bootstrap.installationId,
      bootstrap.workspaceId,
      ownerAuthUserId,
      Math.floor(Date.now() / 1_000),
    );
    await approvalClient.query("set local role authenticated");
    const approvalResult = await approvalClient.query<{ creation: unknown }>(
      approvalSql,
      approvalValues({
        approvalId: actorLockApprovalId,
        expiresAt: actorLockExpiry,
      }),
    );
    actorLockCreation =
      await parseWorkspaceMembershipRevocationApprovalCreation(
        approvalResult.rows[0]?.creation,
      );

    await actorRevocationClient.query("begin");
    let actorRevocationSettled = false;
    const actorRevocation = actorRevocationClient
      .query(
        `insert into public.workspace_membership_revocations
           (installation_id, workspace_id, person_id, revoked_by_person_id,
            revoked_at)
         values ($1, $2, $3, $4,
                 date_trunc('milliseconds', clock_timestamp()))`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerPersonId,
          ids.secondOwnerPerson,
        ],
      )
      .finally(() => {
        actorRevocationSettled = true;
      });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    requireCondition(
      !actorRevocationSettled,
      "Revocation approval did not hold the actor membership row",
    );
    await approvalClient.query("commit");
    await actorRevocation;
    await actorRevocationClient.query("rollback");
  } catch (error) {
    await approvalClient.query("rollback").catch(() => undefined);
    await actorRevocationClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await approvalClient.end();
    await actorRevocationClient.end();
  }

  requireCondition(
    (await hashWorkspaceMembershipRevocationApprovalCore(
      actorLockCreation.approval,
    )) === actorLockCreation.approvalReceipt.approvalHash,
    "PostgreSQL revocation approval hash differs from TypeScript",
  );
  requireCondition(
    (await hashWorkspaceMembershipRevocationApprovalReceipt(
      actorLockCreation.approvalReceipt,
    )) === actorLockCreation.approvalReceipt.receiptHash,
    "PostgreSQL revocation approval receipt hash differs from TypeScript",
  );
  requireCondition(
    actorLockCreation.approval.approvalReceiptId ===
      actorLockCreation.approvalReceipt.receiptId &&
      actorLockCreation.approval.approvalReceiptSha256 ===
        actorLockCreation.approvalReceipt.receiptHash &&
      actorLockCreation.approvalReceipt.effects.approvalCreated &&
      !actorLockCreation.approvalReceipt.effects.approvalConsumed &&
      !actorLockCreation.approvalReceipt.effects.targetMembershipRevoked &&
      !actorLockCreation.approvalReceipt.effects.targetMembershipMutated,
    "Atomic revocation approval receipt is detached or claims an effect",
  );
  const persistedApproval = await admin.query<{
    approval_hash: string;
    approval_record_id: string;
    approval_receipt_id: string;
    approval_receipt_hash: string;
    record_kind: string;
    record_summary: string;
    record_payload: unknown;
    ledger_count: string;
    execution_receipt_count: string;
  }>(
    `select approval.approval_hash,
            approval.approval_record_id::text,
            receipt.receipt_id::text as approval_receipt_id,
            receipt.receipt_hash as approval_receipt_hash,
            record.kind::text as record_kind,
            record.summary as record_summary,
            record.payload as record_payload,
            (select count(*)::text
               from public.workspace_membership_revocations revocation
              where revocation.installation_id = approval.installation_id
                and revocation.workspace_id = approval.workspace_id
                and revocation.person_id = approval.target_person_id)
              as ledger_count,
            (select count(*)::text
               from public.workspace_membership_revocation_receipts execution
              where execution.installation_id = approval.installation_id
                and execution.workspace_id = approval.workspace_id
                and execution.approval_id = approval.approval_id)
              as execution_receipt_count
       from public.workspace_membership_revocation_approvals approval
       join public.workspace_membership_revocation_approval_receipts receipt
         on receipt.installation_id = approval.installation_id
        and receipt.workspace_id = approval.workspace_id
        and receipt.approval_id = approval.approval_id
       join public.records record
         on record.installation_id = approval.installation_id
        and record.workspace_id = approval.workspace_id
        and record.id = approval.approval_record_id
      where approval.installation_id = $1
        and approval.workspace_id = $2
        and approval.approval_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, actorLockApprovalId],
  );
  const storedApproval = persistedApproval.rows[0];
  requireCondition(
    storedApproval?.approval_hash ===
      actorLockCreation.approvalReceipt.approvalHash &&
      storedApproval.approval_record_id ===
        actorLockCreation.approval.approvalRecordId &&
      storedApproval.approval_receipt_id ===
        actorLockCreation.approvalReceipt.receiptId &&
      storedApproval.approval_receipt_hash ===
        actorLockCreation.approvalReceipt.receiptHash &&
      storedApproval.record_kind === "approval" &&
      storedApproval.record_summary ===
        "Approved workspace membership revocation" &&
      canonicalModuleLifecycleJson(storedApproval.record_payload) ===
        canonicalModuleLifecycleJson(actorLockCreation.approval) &&
      storedApproval.ledger_count === "0" &&
      storedApproval.execution_receipt_count === "0",
    "Revocation approval, no-effect receipt, and Record were not atomic",
  );
  const actorLockReplay = await createApproval({
    approvalId: actorLockApprovalId,
    expiresAt: actorLockExpiry,
  });
  requireCondition(
    canonicalModuleLifecycleJson(actorLockReplay) ===
      canonicalModuleLifecycleJson(actorLockCreation),
    "Exact revocation approval replay changed immutable authority",
  );
  await denyApproval("Conflicting revocation approval replay", {
    approvalId: actorLockApprovalId,
    targetPersonId: ids.externalTargetPerson,
    expiresAt: actorLockExpiry,
  });

  const snapshotDriftApproval = await createApproval({
    approvalId: randomUUID(),
    workId: ids.snapshotDriftWork,
    capabilityGrantId: ids.snapshotDriftGrant,
  });
  await admin.query(
    `update public.work
        set title = title || ' drift',
            updated_at = updated_at + interval '1 microsecond'
      where installation_id = $1 and workspace_id = $2 and id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, ids.snapshotDriftWork],
  );
  await denyApply(
    "Revocation Work snapshot drift",
    snapshotDriftApproval.approval.approvalId,
  );

  const policyDriftApproval = await createApproval({
    approvalId: randomUUID(),
    workId: ids.policyDriftWork,
    capabilityGrantId: ids.policyDriftGrant,
  });
  const changedPolicy = {
    ...policyDriftDefinition,
    rule: "changed-after-approval",
  };
  await admin.query(
    `update public.policies
        set definition = $1::jsonb, content_sha256 = $2
      where installation_id = $3 and workspace_id = $4 and id = $5`,
    [
      JSON.stringify(changedPolicy),
      canonicalSha256(changedPolicy).slice("sha256:".length),
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.policyDriftPolicy,
    ],
  );
  await denyApply(
    "Revocation Policy drift after approval",
    policyDriftApproval.approval.approvalId,
  );

  const grantExpiryApproval = await createApproval({
    approvalId: randomUUID(),
    workId: ids.grantExpiryDriftWork,
    capabilityGrantId: ids.grantExpiryDriftGrant,
  });
  await admin.query(
    `update public.capability_grants
        set expires_at = clock_timestamp() - interval '1 second'
      where installation_id = $1 and workspace_id = $2 and id = $3`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.grantExpiryDriftGrant,
    ],
  );
  await denyApply(
    "Revocation grant expiry after approval",
    grantExpiryApproval.approval.approvalId,
  );

  const grantRevocationApproval = await createApproval({
    approvalId: randomUUID(),
    workId: ids.grantRevocationDriftWork,
    capabilityGrantId: ids.grantRevocationDriftGrant,
  });
  await admin.query(
    `insert into public.capability_grant_revocations
       (installation_id, workspace_id, grant_id, revoked_by_person_id,
        reason, revoked_at)
     values ($1, $2, $3, $4, 'Synthetic post-approval revocation',
             clock_timestamp())`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.grantRevocationDriftGrant,
      ownerPersonId,
    ],
  );
  await denyApply(
    "Revocation grant revocation after approval",
    grantRevocationApproval.approval.approvalId,
  );

  const externalConflictApproval = await createApproval({
    approvalId: randomUUID(),
    targetPersonId: ids.externalTargetPerson,
  });
  await admin.query(
    `insert into public.workspace_membership_revocations
       (installation_id, workspace_id, person_id, revoked_by_person_id,
        revoked_at)
     values ($1, $2, $3, $4,
             date_trunc('milliseconds', clock_timestamp()))`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.externalTargetPerson,
      ownerPersonId,
    ],
  );
  await denyApply(
    "External administrator revocation without product receipt",
    externalConflictApproval.approval.approvalId,
  );
  const externalConflictState = await admin.query<{
    execution_count: string;
    ledger_count: string;
  }>(
    `select
       (select count(*)::text
          from public.workspace_membership_revocation_receipts receipt
         where receipt.installation_id = $1
           and receipt.workspace_id = $2
           and receipt.approval_id = $3) as execution_count,
       (select count(*)::text
          from public.workspace_membership_revocations revocation
         where revocation.installation_id = $1
           and revocation.workspace_id = $2
           and revocation.person_id = $4) as ledger_count`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      externalConflictApproval.approval.approvalId,
      ids.externalTargetPerson,
    ],
  );
  requireCondition(
    externalConflictState.rows[0]?.execution_count === "0" &&
      externalConflictState.rows[0]?.ledger_count === "1",
    "External revocation was incorrectly blessed with a product receipt",
  );

  const crossWorkspaceState = async (): Promise<unknown> =>
    (
      await admin.query<{ state: unknown }>(
        `select jsonb_build_object(
          'memberships', (select count(*)
            from public.workspace_memberships where installation_id = $1
              and workspace_id = $2),
          'revocations', (select count(*)
            from public.workspace_membership_revocations
           where installation_id = $1 and workspace_id = $2),
          'work', (select count(*) from public.work
            where installation_id = $1 and workspace_id = $2),
          'records', (select count(*) from public.records
            where installation_id = $1 and workspace_id = $2),
          'grants', (select count(*) from public.capability_grants
            where installation_id = $1 and workspace_id = $2)
        ) as state`,
        [bootstrap.installationId, otherWorkspaceId],
      )
    ).rows[0]?.state;
  const foreignWorkspaceBefore = await crossWorkspaceState();

  const targetAuthority = async (): Promise<{
    contextPersonId: string | null;
    memoryCount: string;
  }> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      (client) =>
        setSignedContext(
          client,
          "person",
          bootstrap.installationId,
          bootstrap.workspaceId,
          ids.targetAuth,
        ),
      async (client) => {
        const result = await client.query<{
          context_person_id: string | null;
          memory_count: string;
        }>(
          `select
             public.current_workspace_person_id($1, $2)::text
               as context_person_id,
             (select count(*)::text
                from public.resolve_context_gateway_memory_bank(
                  $1, $2, 'retrieve', null
                )) as memory_count`,
          [bootstrap.installationId, bootstrap.workspaceId],
        );
        return {
          contextPersonId: result.rows[0]?.context_person_id ?? null,
          memoryCount: result.rows[0]?.memory_count ?? "missing",
        };
      },
    );
  const targetAuthorityBefore = await targetAuthority();
  requireCondition(
    targetAuthorityBefore.contextPersonId === ids.targetPerson &&
      targetAuthorityBefore.memoryCount === "1",
    "Live target did not hold its synthetic bootstrap and Context Gateway authority",
  );

  const mainApprovalId = randomUUID();
  const mainApproval = await createApproval({ approvalId: mainApprovalId });
  const mainReceiptId = randomUUID();
  const applyClient = await connect(runtimeDatabaseUrl);
  const grantRevocationClient = await connect(adminDatabaseUrl);
  let mainResult: unknown;
  try {
    await applyClient.query("begin");
    await setWorkspaceStepUpContext(
      applyClient,
      bootstrap.installationId,
      bootstrap.workspaceId,
      ownerAuthUserId,
      Math.floor(Date.now() / 1_000),
    );
    await applyClient.query("set local role authenticated");
    const application = await applyClient.query<{ result: unknown }>(applySql, [
      mainReceiptId,
      mainApprovalId,
      bootstrap.installationId,
      bootstrap.workspaceId,
    ]);
    mainResult = application.rows[0]?.result;

    await grantRevocationClient.query("begin");
    let grantRevocationSettled = false;
    const grantRevocation = grantRevocationClient
      .query(
        `insert into public.capability_grant_revocations
           (installation_id, workspace_id, grant_id, revoked_by_person_id,
            reason, revoked_at)
         values ($1, $2, $3, $4,
                 'Synthetic concurrent revocation', clock_timestamp())`,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          ids.goodGrant,
          ids.secondOwnerPerson,
        ],
      )
      .finally(() => {
        grantRevocationSettled = true;
      });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    requireCondition(
      !grantRevocationSettled,
      "Revocation apply did not hold the capability grant row",
    );
    await applyClient.query("commit");
    await grantRevocation;
    await grantRevocationClient.query("rollback");
  } catch (error) {
    await applyClient.query("rollback").catch(() => undefined);
    await grantRevocationClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await applyClient.end();
    await grantRevocationClient.end();
  }

  requireCondition(
    mainResult && typeof mainResult === "object",
    "Revocation apply did not return its authority bundle",
  );
  const mainBundle = mainResult as Record<string, unknown>;
  const parsedMainCreation =
    await parseWorkspaceMembershipRevocationApprovalCreation({
      approval: mainBundle.approval,
      approvalReceipt: mainBundle.approvalReceipt,
    });
  const mainReceipt: WorkspaceMembershipRevocationReceipt =
    await parseWorkspaceMembershipRevocationReceipt(
      mainBundle.receipt,
      parsedMainCreation,
    );
  requireCondition(
    canonicalModuleLifecycleJson(parsedMainCreation) ===
      canonicalModuleLifecycleJson(mainApproval),
    "Revocation apply returned detached approval authority",
  );
  requireCondition(
    (await hashWorkspaceMembershipRevocationReceipt(mainReceipt)) ===
      mainReceipt.receiptHash &&
      mainReceipt.approvalConsumptionCount === 1 &&
      mainReceipt.effects.targetMembershipRevoked &&
      !mainReceipt.effects.workMutated &&
      !mainReceipt.effects.policyMutated &&
      !mainReceipt.effects.capabilityGrantMutated,
    "PostgreSQL revocation execution receipt differs from TypeScript or claims foreign effects",
  );

  const persistedApplication = await admin.query<{
    ledger_count: string;
    receipt_count: string;
    record_count: string;
    person_count: string;
    ledger_id: string;
    record_payload: unknown;
    record_kind: string;
    record_summary: string;
    work_snapshot_hash: string;
  }>(
    `select
       (select count(*)::text
          from public.workspace_membership_revocations revocation
         where revocation.installation_id = $1
           and revocation.workspace_id = $2
           and revocation.person_id = $3) as ledger_count,
       (select count(*)::text
          from public.workspace_membership_revocation_receipts receipt
         where receipt.installation_id = $1
           and receipt.workspace_id = $2
           and receipt.approval_id = $4) as receipt_count,
       (select count(*)::text from public.records record
         where record.installation_id = $1 and record.workspace_id = $2
           and record.id = $5) as record_count,
       (select count(*)::text from public.people person
         where person.installation_id = $1 and person.id = $3) as person_count,
       revocation.id::text as ledger_id,
       record.payload as record_payload,
       record.kind::text as record_kind,
       record.summary as record_summary,
       approval.work_snapshot_hash
      from public.workspace_membership_revocations revocation
      join public.workspace_membership_revocation_receipts receipt
        on receipt.membership_revocation_id = revocation.id
      join public.workspace_membership_revocation_approvals approval
        on approval.installation_id = receipt.installation_id
       and approval.workspace_id = receipt.workspace_id
       and approval.approval_id = receipt.approval_id
      join public.records record
        on record.installation_id = receipt.installation_id
       and record.workspace_id = receipt.workspace_id
       and record.id = receipt.receipt_id
     where revocation.installation_id = $1 and revocation.workspace_id = $2
       and revocation.person_id = $3 and receipt.approval_id = $4`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ids.targetPerson,
      mainApprovalId,
      mainReceiptId,
    ],
  );
  const storedApplication = persistedApplication.rows[0];
  requireCondition(
    storedApplication?.ledger_count === "1" &&
      storedApplication.receipt_count === "1" &&
      storedApplication.record_count === "1" &&
      storedApplication.person_count === "1" &&
      storedApplication.ledger_id === mainReceipt.membershipRevocationId &&
      storedApplication.record_kind === "receipt" &&
      storedApplication.record_summary ===
        "Applied workspace membership revocation" &&
      canonicalModuleLifecycleJson(storedApplication.record_payload) ===
        canonicalModuleLifecycleJson(mainReceipt) &&
      storedApplication.work_snapshot_hash ===
        mainApproval.approval.binding.workSnapshotSha256,
    "Membership revocation ledger, receipt, and Record were not one exact atomic effect",
  );

  const replayResult = await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(),
    async (client) =>
      (
        await client.query<{ result: unknown }>(applySql, [
          mainReceiptId,
          mainApprovalId,
          bootstrap.installationId,
          bootstrap.workspaceId,
        ])
      ).rows[0]?.result,
  );
  requireCondition(
    canonicalModuleLifecycleJson(replayResult) ===
      canonicalModuleLifecycleJson(mainResult),
    "Exact revocation replay did not return the immutable bundle",
  );
  await denyApply(
    "Conflicting revocation receipt replay",
    mainApprovalId,
    randomUUID(),
  );

  const expiringApprovalId = randomUUID();
  const expiringReceiptId = randomUUID();
  const expiringApprovalExpiresAt = new Date(Date.now() + 5_000).toISOString();
  await createApproval({
    approvalId: expiringApprovalId,
    targetPersonId: ids.nonOwnerPerson,
    expiresAt: expiringApprovalExpiresAt,
  });
  const expiringResult = await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(),
    async (client) =>
      (
        await client.query<{ result: unknown }>(applySql, [
          expiringReceiptId,
          expiringApprovalId,
          bootstrap.installationId,
          bootstrap.workspaceId,
        ])
      ).rows[0]?.result,
  );
  const expiryWaitMilliseconds = Math.max(
    0,
    Date.parse(expiringApprovalExpiresAt) - Date.now() + 150,
  );
  await new Promise((resolveDelay) =>
    setTimeout(resolveDelay, expiryWaitMilliseconds),
  );
  requireCondition(
    Date.now() > Date.parse(expiringApprovalExpiresAt),
    "Bounded revocation replay test did not cross approval expiry",
  );
  const expiredReplayResult = await inRuntimeTransaction(
    runtimeDatabaseUrl,
    "authenticated",
    signedOwner(),
    async (client) =>
      (
        await client.query<{ result: unknown }>(applySql, [
          expiringReceiptId,
          expiringApprovalId,
          bootstrap.installationId,
          bootstrap.workspaceId,
        ])
      ).rows[0]?.result,
  );
  requireCondition(
    canonicalModuleLifecycleJson(expiredReplayResult) ===
      canonicalModuleLifecycleJson(expiringResult),
    "Exact completed revocation replay changed after approval expiry",
  );
  await denyApply(
    "Conflicting revocation receipt after approval expiry",
    expiringApprovalId,
    randomUUID(),
  );

  await expectSqlState(
    admin,
    `update public.workspace_membership_revocation_approvals
        set binding = binding where installation_id = $1
          and workspace_id = $2 and approval_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, mainApprovalId],
    "P0001",
    "Immutable membership revocation approval update",
  );
  await expectSqlState(
    admin,
    `delete from public.workspace_membership_revocation_approval_receipts
      where installation_id = $1 and workspace_id = $2 and approval_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, mainApprovalId],
    "P0001",
    "Immutable membership revocation approval receipt delete",
  );
  await expectSqlState(
    admin,
    `update public.workspace_membership_revocation_receipts
        set effects = effects where installation_id = $1
          and workspace_id = $2 and approval_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, mainApprovalId],
    "P0001",
    "Immutable membership revocation execution receipt update",
  );

  const targetAuthorityAfter = await targetAuthority();
  requireCondition(
    targetAuthorityAfter.contextPersonId === null &&
      targetAuthorityAfter.memoryCount === "0",
    "Revoked target retained bootstrap or Context Gateway authority",
  );

  const liveOwnerCountBeforeActorRevocation = await admin.query<{
    count: string;
  }>(
    `select count(*)::text as count
       from public.workspace_memberships membership
      where membership.installation_id = $1 and membership.workspace_id = $2
        and membership.kind = 'owner'
        and public.workspace_membership_is_live(
          membership.installation_id, membership.workspace_id,
          membership.person_id
        )`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  await admin.query(
    `insert into public.workspace_membership_revocations
       (installation_id, workspace_id, person_id, revoked_by_person_id,
        revoked_at)
     values ($1, $2, $3, $4,
             date_trunc('milliseconds', clock_timestamp()))`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      ownerPersonId,
      ids.secondOwnerPerson,
    ],
  );
  await denyApply(
    "Exact revocation replay by a revoked original owner",
    mainApprovalId,
    mainReceiptId,
  );
  const remainingOwnerCount = await admin.query<{ count: string }>(
    `select count(*)::text as count
       from public.workspace_memberships membership
      where membership.installation_id = $1 and membership.workspace_id = $2
        and membership.kind = 'owner'
        and public.workspace_membership_is_live(
          membership.installation_id, membership.workspace_id,
          membership.person_id
        )`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  requireCondition(
    Number(remainingOwnerCount.rows[0]?.count) ===
      Number(liveOwnerCountBeforeActorRevocation.rows[0]?.count) - 1 &&
      Number(remainingOwnerCount.rows[0]?.count) >= 1,
    "Synthetic revocation proof did not preserve live owner continuity",
  );
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "authenticated",
    (client) =>
      setWorkspaceStepUpContext(
        client,
        bootstrap.installationId,
        ids.finalOwnerWorkspace,
        ids.secondOwnerAuth,
        Math.floor(Date.now() / 1_000),
      ),
    approvalSql,
    [
      randomUUID(),
      bootstrap.installationId,
      ids.finalOwnerWorkspace,
      ids.secondOwnerPerson,
      "owner",
      randomUUID(),
      randomUUID(),
      expiry(),
    ],
    "P0001",
    "Final live owner revocation",
  );

  requireCondition(
    canonicalModuleLifecycleJson(await crossWorkspaceState()) ===
      canonicalModuleLifecycleJson(foreignWorkspaceBefore),
    "Membership revocation proof mutated the foreign workspace",
  );
}

async function proveModuleLifecycleApprovalBoundary(
  admin: Client,
  adminDatabaseUrl: string,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  const noMembershipAuthUserId = randomUUID();
  const noMembershipPersonId = randomUUID();
  const nonOwnerAuthUserId = randomUUID();
  const nonOwnerPersonId = randomUUID();
  const revokedOwnerAuthUserId = randomUUID();
  const revokedOwnerPersonId = randomUUID();
  const serializedOwnerAuthUserId = randomUUID();
  const serializedOwnerPersonId = randomUUID();
  await admin.query(
    `insert into auth.users (id, email) values
       ($1, 'lifecycle-no-membership@synthetic.invalid'),
       ($2, 'lifecycle-non-owner@synthetic.invalid'),
       ($3, 'lifecycle-revoked-owner@synthetic.invalid'),
       ($4, 'lifecycle-serialized-owner@synthetic.invalid')`,
    [
      noMembershipAuthUserId,
      nonOwnerAuthUserId,
      revokedOwnerAuthUserId,
      serializedOwnerAuthUserId,
    ],
  );
  await admin.query(
    `insert into public.people
       (id, installation_id, auth_user_id, display_name, kind)
     values
       ($1, $5, $2, 'Synthetic lifecycle person without membership', 'owner'),
       ($3, $5, $4, 'Synthetic lifecycle non-owner member', 'owner'),
       ($6, $5, $7, 'Synthetic lifecycle revoked owner', 'owner'),
       ($8, $5, $9, 'Synthetic lifecycle serialized owner', 'owner')`,
    [
      noMembershipPersonId,
      noMembershipAuthUserId,
      nonOwnerPersonId,
      nonOwnerAuthUserId,
      bootstrap.installationId,
      revokedOwnerPersonId,
      revokedOwnerAuthUserId,
      serializedOwnerPersonId,
      serializedOwnerAuthUserId,
    ],
  );
  await admin.query(
    `insert into public.workspace_memberships
       (installation_id, workspace_id, person_id, kind)
     values
       ($1, $2, $3, 'member'),
       ($1, $2, $4, 'owner'),
       ($1, $2, $5, 'owner')`,
    [
      bootstrap.installationId,
      bootstrap.workspaceId,
      nonOwnerPersonId,
      revokedOwnerPersonId,
      serializedOwnerPersonId,
    ],
  );
  await admin.query(
    `delete from public.workspace_memberships
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, revokedOwnerPersonId],
  );

  const syntheticDigest = (label: string): string =>
    `sha256:${createHash("sha256").update(label).digest("hex")}`;
  const receiptReference = (label: string) => ({
    receiptId: randomUUID(),
    receiptSha256: syntheticDigest(label),
  });
  const lifecycleBinding = (
    target: Record<string, unknown>,
    sequence: number,
    overrides: Partial<{
      vortonInstallationId: string;
      workspaceId: string;
      realm: "personal" | "organizational";
    }> = {},
  ): Record<string, unknown> => ({
    vortonInstallationId:
      overrides.vortonInstallationId ?? bootstrap.installationId,
    workspaceId: overrides.workspaceId ?? bootstrap.workspaceId,
    realm: overrides.realm ?? "organizational",
    module: "tasks",
    sequence,
    migrationPlanHash: syntheticDigest(`plan-${String(sequence)}`),
    sourceSnapshotSha256: syntheticDigest(`source-${String(sequence)}`),
    targetPreimageSha256: syntheticDigest(`preimage-${String(sequence)}`),
    targetPostimageSha256: syntheticDigest(`postimage-${String(sequence)}`),
    target,
  });
  const cloneBinding = (
    binding: Record<string, unknown>,
  ): Record<string, unknown> => structuredClone(binding);
  const expiration = (millisecondsFromNow = 60 * 60 * 1_000): string =>
    new Date(Date.now() + millisecondsFromNow).toISOString();
  const createApprovalSql = `select public.create_module_lifecycle_action_approval(
    $1, $2, $3, $4::jsonb, $5::timestamptz
  ) as creation`;
  const signedOwner =
    (subjectId = ownerAuthUserId, authTime = Math.floor(Date.now() / 1_000)) =>
    (client: Client): Promise<void> =>
      setWorkspaceStepUpContext(
        client,
        bootstrap.installationId,
        bootstrap.workspaceId,
        subjectId,
        authTime,
      );
  const createApproval = async (
    approvalId: string,
    binding: Record<string, unknown>,
    expiresAt: string,
    subjectId = ownerAuthUserId,
  ): Promise<ModuleLifecycleApprovalCreation> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      signedOwner(subjectId),
      async (client) => {
        const result = await client.query<{ creation: unknown }>(
          createApprovalSql,
          [
            approvalId,
            bootstrap.installationId,
            bootstrap.workspaceId,
            JSON.stringify(binding),
            expiresAt,
          ],
        );
        return parseModuleLifecycleApprovalCreation(result.rows[0]?.creation);
      },
    );
  const denyApproval = (
    label: string,
    approvalId: string,
    binding: Record<string, unknown>,
    expiresAt: string,
    setup: (client: Client) => Promise<void> = signedOwner(),
  ): Promise<void> =>
    expectRuntimeSqlState(
      runtimeDatabaseUrl,
      "authenticated",
      setup,
      createApprovalSql,
      [
        approvalId,
        bootstrap.installationId,
        bootstrap.workspaceId,
        JSON.stringify(binding),
        expiresAt,
      ],
      "P0001",
      label,
    );
  const tableCounts = async (): Promise<Map<string, string>> => {
    const tables = await admin.query<{ tablename: string }>(
      `select tablename
         from pg_tables
        where schemaname = 'public'
        order by tablename`,
    );
    const counts = new Map<string, string>();
    for (const { tablename } of tables.rows) {
      const quoted = `"${tablename.replaceAll('"', '""')}"`;
      const result = await admin.query<{ count: string }>(
        `select count(*)::text as count from public.${quoted}`,
      );
      counts.set(tablename, result.rows[0]?.count ?? "missing");
    }
    return counts;
  };
  const baselineCounts = await tableCounts();
  const successfulApprovalIds: string[] = [];

  const backupBinding = lifecycleBinding(
    {
      action: "backup",
      backupId: randomUUID(),
      storageObjectKey: "tasks/sequence-1/preimage.json",
      encryptionKeyBindingId: randomUUID(),
    },
    1,
  );
  const defaultExpiry = expiration();
  const hostileContextCases: Array<{
    label: string;
    setup: (client: Client) => Promise<void>;
  }> = [
    {
      label: "Unsigned workspace lifecycle base context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
          { baseSignature: "unsigned" },
        ),
    },
    {
      label: "Forged workspace lifecycle base context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
          { baseSignature: "forged" },
        ),
    },
    {
      label: "Unsigned workspace lifecycle step-up context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
          { stepUpSignature: "unsigned" },
        ),
    },
    {
      label: "Forged workspace lifecycle step-up context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
          { stepUpSignature: "forged" },
        ),
    },
    {
      label: "Wrong-installation signed lifecycle context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          otherInstallationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
        ),
    },
    {
      label: "Wrong-workspace signed lifecycle context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          otherWorkspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
        ),
    },
    {
      label: "Future workspace lifecycle AAL2",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000) + 120,
        ),
    },
    {
      label: "Stale workspace lifecycle AAL2",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000) - 601,
        ),
    },
    {
      label: "AAL1 workspace lifecycle context",
      setup: (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1_000),
          { aal: "aal1" },
        ),
    },
  ];
  for (const { label, setup } of hostileContextCases) {
    await denyApproval(
      label,
      randomUUID(),
      backupBinding,
      defaultExpiry,
      setup,
    );
  }

  await denyApproval(
    "Unknown lifecycle subject",
    randomUUID(),
    backupBinding,
    defaultExpiry,
    signedOwner(randomUUID()),
  );
  await denyApproval(
    "Lifecycle subject without workspace membership",
    randomUUID(),
    backupBinding,
    defaultExpiry,
    signedOwner(noMembershipAuthUserId),
  );
  await denyApproval(
    "Lifecycle non-owner workspace member",
    randomUUID(),
    backupBinding,
    defaultExpiry,
    signedOwner(nonOwnerAuthUserId),
  );
  await denyApproval(
    "Revoked lifecycle workspace owner",
    randomUUID(),
    backupBinding,
    defaultExpiry,
    signedOwner(revokedOwnerAuthUserId),
  );
  await denyApproval(
    "Lifecycle binding with wrong installation",
    randomUUID(),
    lifecycleBinding(backupBinding.target as Record<string, unknown>, 2, {
      vortonInstallationId: otherInstallationId,
    }),
    defaultExpiry,
  );
  await denyApproval(
    "Lifecycle binding with wrong workspace",
    randomUUID(),
    lifecycleBinding(backupBinding.target as Record<string, unknown>, 3, {
      workspaceId: otherWorkspaceId,
    }),
    defaultExpiry,
  );
  await denyApproval(
    "Lifecycle binding with wrong realm",
    randomUUID(),
    lifecycleBinding(backupBinding.target as Record<string, unknown>, 4, {
      realm: "personal",
    }),
    defaultExpiry,
  );
  await denyApproval(
    "Lifecycle binding with unknown action",
    randomUUID(),
    lifecycleBinding({ action: "publish" }, 5),
    defaultExpiry,
  );
  const microsecondExpiry = `${defaultExpiry.slice(0, -1)}123Z`;
  await denyApproval(
    "Microsecond-precision lifecycle expiry",
    randomUUID(),
    backupBinding,
    microsecondExpiry,
  );

  const canonicalVector = {
    z: null,
    a: {
      timestamp: "2026-08-30T12:00:00.000Z",
      uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      integer: 42,
      array: [3, "x", false],
      nested: { b: 2, a: 1 },
    },
  };
  const expectedCanonicalVector =
    '{"a":{"array":[3,"x",false],"integer":42,"nested":{"a":1,"b":2},"timestamp":"2026-08-30T12:00:00.000Z","uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"z":null}';
  const expectedCanonicalDigest =
    "sha256:12b1b0f57cff0749342d1d85bdd5ec6fcbb5f024209ca22b408e31959e5e8c6e";
  requireCondition(
    canonicalModuleLifecycleJson(canonicalVector) === expectedCanonicalVector,
    "TypeScript lifecycle canonical vector changed",
  );
  requireCondition(
    (await moduleLifecycleCanonicalSha256(canonicalVector)) ===
      expectedCanonicalDigest,
    "TypeScript lifecycle canonical vector hash changed",
  );
  const sqlVector = await admin.query<{ canonical: string; digest: string }>(
    `select public.vorton_canonical_jsonb($1::jsonb) as canonical,
            public.vorton_module_lifecycle_hash($1::jsonb) as digest`,
    [JSON.stringify(canonicalVector)],
  );
  requireCondition(
    sqlVector.rows[0]?.canonical === expectedCanonicalVector &&
      sqlVector.rows[0]?.digest === expectedCanonicalDigest,
    "PostgreSQL and TypeScript lifecycle canonical vectors diverged",
  );

  const backupApprovalId = randomUUID();
  const backupCreation = await createApproval(
    backupApprovalId,
    backupBinding,
    defaultExpiry,
  );
  successfulApprovalIds.push(backupApprovalId);
  requireCondition(
    (await hashModuleLifecycleApprovalCore(backupCreation.approval)) ===
      backupCreation.receipt.approvalHash,
    "PostgreSQL lifecycle approvalHash differs from TypeScript",
  );
  requireCondition(
    (await hashModuleLifecycleApprovalReceipt(backupCreation.receipt)) ===
      backupCreation.receipt.receiptHash,
    "PostgreSQL lifecycle receiptHash differs from TypeScript",
  );
  requireCondition(
    backupCreation.approval.approvalReceiptId ===
      backupCreation.receipt.receiptId &&
      backupCreation.approval.approvalReceiptSha256 ===
        backupCreation.receipt.receiptHash &&
      Object.values(backupCreation.receipt.effects).every(
        (effect) => effect === false,
      ),
    "Atomic lifecycle approval receipt claims an effect or mismatches approval",
  );
  const persistedBackup = await admin.query<{
    approval_hash: string;
    approval_record_id: string;
    approval_receipt_id: string;
    receipt_hash: string;
    record_kind: string;
    record_payload: unknown;
    record_summary: string;
    record_classification: string;
    record_actor_person_id: string;
    record_work_id: string | null;
  }>(
    `select approval.approval_hash,
            approval.approval_record_id::text,
            receipt.receipt_id::text as approval_receipt_id,
            receipt.receipt_hash,
            record.kind::text as record_kind,
            record.payload as record_payload,
            record.summary as record_summary,
            record.classification::text as record_classification,
            record.actor_person_id::text as record_actor_person_id,
            record.work_id::text as record_work_id
       from public.module_lifecycle_action_approvals approval
       join public.module_lifecycle_approval_receipts receipt
         on receipt.installation_id = approval.installation_id
        and receipt.workspace_id = approval.workspace_id
        and receipt.approval_id = approval.approval_id
       join public.records record
         on record.installation_id = approval.installation_id
        and record.workspace_id = approval.workspace_id
        and record.id = approval.approval_record_id
      where approval.installation_id = $1
        and approval.workspace_id = $2
        and approval.approval_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, backupApprovalId],
  );
  const persisted = persistedBackup.rows[0];
  requireCondition(
    persisted?.approval_hash === backupCreation.receipt.approvalHash &&
      persisted.receipt_hash === backupCreation.receipt.receiptHash &&
      persisted.approval_record_id ===
        backupCreation.approval.approvalRecordId &&
      persisted.approval_receipt_id === backupCreation.receipt.receiptId &&
      persisted.record_kind === "approval" &&
      persisted.record_summary ===
        "Approved exact module lifecycle backup action" &&
      persisted.record_classification === "internal" &&
      persisted.record_actor_person_id === ownerPersonId &&
      persisted.record_work_id === null &&
      canonicalModuleLifecycleJson(persisted.record_payload) ===
        canonicalModuleLifecycleJson(backupCreation.approval),
    "Lifecycle approval, receipt, and authoritative Record were not atomic",
  );
  const exactBackupReplay = await createApproval(
    backupApprovalId,
    backupBinding,
    defaultExpiry,
  );
  requireCondition(
    canonicalModuleLifecycleJson(exactBackupReplay) ===
      canonicalModuleLifecycleJson(backupCreation),
    "Exact lifecycle approval replay did not return immutable authority",
  );
  const conflictingBackup = cloneBinding(backupBinding);
  conflictingBackup.sequence = 2;
  await denyApproval(
    "Conflicting lifecycle approval replay",
    backupApprovalId,
    conflictingBackup,
    defaultExpiry,
  );
  await admin.query(
    `update public.workspace_memberships set kind = 'member'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
  );
  try {
    await denyApproval(
      "Exact lifecycle replay after owner revocation",
      backupApprovalId,
      backupBinding,
      defaultExpiry,
    );
  } finally {
    await admin.query(
      `update public.workspace_memberships set kind = 'owner'
        where installation_id = $1 and workspace_id = $2 and person_id = $3`,
      [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
    );
  }

  const backupReceipt = receiptReference("action-backup-receipt");
  const recoveryBinding = lifecycleBinding(
    {
      action: "recovery",
      recoveryId: randomUUID(),
      recoveryNamespace: "tasks-recovery",
      backupReceipt,
    },
    6,
  );
  const recoveryApprovalId = randomUUID();
  await createApproval(recoveryApprovalId, recoveryBinding, expiration());
  successfulApprovalIds.push(recoveryApprovalId);
  await denyApproval(
    "Lifecycle approval ID reused as prerequisite receipt identity",
    backupReceipt.receiptId,
    recoveryBinding,
    expiration(),
  );

  const recoveryReceipt = receiptReference("action-recovery-receipt");
  const deletionBinding = lifecycleBinding(
    {
      action: "deletion",
      mode: "controlled-fixture",
      rehearsalId: randomUUID(),
      controlledFixtureId: randomUUID(),
      productionDeletion: false,
      noProductionRecords: true,
      backupReceipt,
      recoveryReceipt,
      surfaces: {
        database: true,
        storage: true,
        memory: true,
        search: true,
        backups: true,
      },
    },
    7,
  );
  const deletionApprovalId = randomUUID();
  await createApproval(deletionApprovalId, deletionBinding, expiration());
  successfulApprovalIds.push(deletionApprovalId);

  const deletionReceipt = receiptReference("action-deletion-receipt");
  const rollbackBinding = lifecycleBinding(
    {
      action: "rollback",
      rollbackId: randomUUID(),
      rollbackNamespace: "tasks-rollback",
      backupReceipt,
      recoveryReceipt,
      deletionRehearsalReceipt: deletionReceipt,
    },
    8,
  );
  const rollbackApprovalId = randomUUID();
  await createApproval(rollbackApprovalId, rollbackBinding, expiration());
  successfulApprovalIds.push(rollbackApprovalId);

  const duplicatePrerequisiteId = cloneBinding(deletionBinding);
  const duplicateIdTarget = duplicatePrerequisiteId.target as Record<
    string,
    unknown
  >;
  duplicateIdTarget.recoveryReceipt = duplicateIdTarget.backupReceipt;
  await denyApproval(
    "Duplicate lifecycle prerequisite receipt identity",
    randomUUID(),
    duplicatePrerequisiteId,
    expiration(),
  );
  const duplicatePrerequisiteDigest = cloneBinding(deletionBinding);
  const duplicateDigestTarget = duplicatePrerequisiteDigest.target as {
    backupReceipt: { receiptSha256: unknown };
    recoveryReceipt: { receiptSha256: unknown };
  };
  duplicateDigestTarget.recoveryReceipt.receiptSha256 =
    duplicateDigestTarget.backupReceipt.receiptSha256;
  await denyApproval(
    "Duplicate lifecycle prerequisite receipt digest",
    randomUUID(),
    duplicatePrerequisiteDigest,
    expiration(),
  );
  const identityHelpers = await admin.query<{
    approval_record_collision_denied: boolean;
    approval_receipt_collision_denied: boolean;
    approval_digest_collision_denied: boolean;
  }>(
    `select
       not public.vorton_module_lifecycle_identities_distinct(
         $1, $2, $3, $4::jsonb
       ) as approval_record_collision_denied,
       not public.vorton_module_lifecycle_identities_distinct(
         $5, $6, $7, $4::jsonb
       ) as approval_receipt_collision_denied,
       not public.vorton_module_lifecycle_receipt_hash_distinct(
         $8, $4::jsonb
       ) as approval_digest_collision_denied`,
    [
      randomUUID(),
      backupReceipt.receiptId,
      randomUUID(),
      JSON.stringify(recoveryBinding),
      randomUUID(),
      randomUUID(),
      backupReceipt.receiptId,
      backupReceipt.receiptSha256,
    ],
  );
  requireCondition(
    identityHelpers.rows[0]?.approval_record_collision_denied &&
      identityHelpers.rows[0]?.approval_receipt_collision_denied &&
      identityHelpers.rows[0]?.approval_digest_collision_denied,
    "PostgreSQL lifecycle identity or digest collision helper accepted reuse",
  );

  await expectSqlState(
    admin,
    `update public.module_lifecycle_action_approvals
        set binding = binding where installation_id = $1 and approval_id = $2`,
    [bootstrap.installationId, backupApprovalId],
    "P0001",
    "Immutable lifecycle approval update",
  );
  await expectSqlState(
    admin,
    `delete from public.module_lifecycle_approval_receipts
      where installation_id = $1 and approval_id = $2`,
    [bootstrap.installationId, backupApprovalId],
    "P0001",
    "Immutable lifecycle approval receipt delete",
  );

  const expectRoleSqlState = async (
    role: "anon" | "authenticated" | "aubos_worker",
    sql: string,
    values: unknown[],
    label: string,
  ): Promise<void> => {
    const client = await connect(adminDatabaseUrl);
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      await expectSqlState(client, sql, values, "42501", label);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  };
  for (const role of ["anon", "authenticated", "aubos_worker"] as const) {
    await expectRoleSqlState(
      role,
      "select count(*) from public.module_lifecycle_action_approvals",
      [],
      `${role} direct lifecycle approval read`,
    );
    await expectRoleSqlState(
      role,
      "insert into public.module_lifecycle_approval_receipts default values",
      [],
      `${role} direct lifecycle receipt write`,
    );
    await expectRoleSqlState(
      role,
      "select public.vorton_module_lifecycle_hash('{}'::jsonb)",
      [],
      `${role} lifecycle helper execution`,
    );
  }
  for (const role of ["anon", "aubos_worker"] as const) {
    await expectRoleSqlState(
      role,
      createApprovalSql,
      [
        randomUUID(),
        bootstrap.installationId,
        bootstrap.workspaceId,
        JSON.stringify(backupBinding),
        expiration(),
      ],
      `${role} lifecycle approval function execution`,
    );
  }

  const assertApprovalAbsent = async (
    approvalId: string,
    recordsBefore: string,
    label: string,
  ): Promise<void> => {
    const result = await admin.query<{
      approvals: string;
      receipts: string;
      records: string;
    }>(
      `select
         (select count(*)::text from public.module_lifecycle_action_approvals
           where approval_id = $1) as approvals,
         (select count(*)::text from public.module_lifecycle_approval_receipts
           where approval_id = $1) as receipts,
         (select count(*)::text from public.records) as records`,
      [approvalId],
    );
    requireCondition(
      result.rows[0]?.approvals === "0" &&
        result.rows[0]?.receipts === "0" &&
        result.rows[0]?.records === recordsBefore,
      `${label} did not roll back approval, receipt, and Record atomically`,
    );
  };
  const recordsBeforeReceiptFailure = (
    await admin.query<{ count: string }>(
      "select count(*)::text as count from public.records",
    )
  ).rows[0]?.count;
  requireCondition(
    recordsBeforeReceiptFailure,
    "PostgreSQL did not count Records before receipt failure",
  );
  await admin.query(`
    create function public.vorton_test_fail_lifecycle_receipt_insert()
    returns trigger language plpgsql as $$
    begin
      raise exception 'Synthetic lifecycle receipt insertion failure';
    end
    $$;
    create trigger vorton_test_fail_lifecycle_receipt_insert
      before insert on public.module_lifecycle_approval_receipts
      for each row execute function public.vorton_test_fail_lifecycle_receipt_insert();
  `);
  const receiptFailureApprovalId = randomUUID();
  try {
    await denyApproval(
      "Synthetic lifecycle receipt insertion rollback",
      receiptFailureApprovalId,
      backupBinding,
      expiration(),
    );
  } finally {
    await admin.query(`
      drop trigger vorton_test_fail_lifecycle_receipt_insert
        on public.module_lifecycle_approval_receipts;
      drop function public.vorton_test_fail_lifecycle_receipt_insert();
    `);
  }
  await assertApprovalAbsent(
    receiptFailureApprovalId,
    recordsBeforeReceiptFailure,
    "Lifecycle receipt insertion failure",
  );

  const recordsBeforeRecordFailure = (
    await admin.query<{ count: string }>(
      "select count(*)::text as count from public.records",
    )
  ).rows[0]?.count;
  requireCondition(
    recordsBeforeRecordFailure,
    "PostgreSQL did not count Records before Record failure",
  );
  await admin.query(`
    create function public.vorton_test_fail_lifecycle_record_insert()
    returns trigger language plpgsql as $$
    begin
      raise exception 'Synthetic lifecycle Record insertion failure';
    end
    $$;
    create trigger vorton_test_fail_lifecycle_record_insert
      before insert on public.records
      for each row
      when (new.summary like 'Approved exact module lifecycle %')
      execute function public.vorton_test_fail_lifecycle_record_insert();
  `);
  const recordFailureApprovalId = randomUUID();
  try {
    await denyApproval(
      "Synthetic lifecycle Record insertion rollback",
      recordFailureApprovalId,
      backupBinding,
      expiration(),
    );
  } finally {
    await admin.query(`
      drop trigger vorton_test_fail_lifecycle_record_insert on public.records;
      drop function public.vorton_test_fail_lifecycle_record_insert();
    `);
  }
  await assertApprovalAbsent(
    recordFailureApprovalId,
    recordsBeforeRecordFailure,
    "Lifecycle Record insertion failure",
  );

  const serializedApprovalId = randomUUID();
  const serializedExpiry = expiration();
  const approvalClient = await connect(runtimeDatabaseUrl);
  const membershipClient = await connect(adminDatabaseUrl);
  let serializedCreation: ModuleLifecycleApprovalCreation | undefined;
  try {
    await approvalClient.query("begin");
    await setWorkspaceStepUpContext(
      approvalClient,
      bootstrap.installationId,
      bootstrap.workspaceId,
      serializedOwnerAuthUserId,
      Math.floor(Date.now() / 1_000),
    );
    await approvalClient.query("set local role authenticated");
    const creation = await approvalClient.query<{ creation: unknown }>(
      createApprovalSql,
      [
        serializedApprovalId,
        bootstrap.installationId,
        bootstrap.workspaceId,
        JSON.stringify(backupBinding),
        serializedExpiry,
      ],
    );
    serializedCreation = await parseModuleLifecycleApprovalCreation(
      creation.rows[0]?.creation,
    );

    for (const [label, sql] of [
      [
        "Lifecycle owner demotion serialization",
        `update public.workspace_memberships set kind = 'member'
          where installation_id = $1 and workspace_id = $2 and person_id = $3`,
      ],
      [
        "Lifecycle owner deletion serialization",
        `delete from public.workspace_memberships
          where installation_id = $1 and workspace_id = $2 and person_id = $3`,
      ],
    ] as const) {
      await membershipClient.query("begin");
      await membershipClient.query("set local lock_timeout = '100ms'");
      await expectSqlState(
        membershipClient,
        sql,
        [
          bootstrap.installationId,
          bootstrap.workspaceId,
          serializedOwnerPersonId,
        ],
        "55P03",
        label,
      );
      await membershipClient.query("rollback");
    }
    await approvalClient.query("commit");
  } catch (error) {
    await approvalClient.query("rollback").catch(() => undefined);
    await membershipClient.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await approvalClient.end();
    await membershipClient.end();
  }
  requireCondition(
    serializedCreation,
    "Serialized lifecycle approval was not returned",
  );
  successfulApprovalIds.push(serializedApprovalId);
  await admin.query(
    `delete from public.workspace_memberships
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, serializedOwnerPersonId],
  );
  try {
    await denyApproval(
      "Exact lifecycle replay after membership deletion",
      serializedApprovalId,
      backupBinding,
      serializedExpiry,
      signedOwner(serializedOwnerAuthUserId),
    );
  } finally {
    await admin.query(
      `insert into public.workspace_memberships
         (installation_id, workspace_id, person_id, kind)
       values ($1, $2, $3, 'owner')`,
      [
        bootstrap.installationId,
        bootstrap.workspaceId,
        serializedOwnerPersonId,
      ],
    );
  }

  const finalCounts = await tableCounts();
  for (const [table, before] of baselineCounts) {
    const after = finalCounts.get(table);
    if (table === "module_lifecycle_action_approvals") {
      requireCondition(
        Number(after) - Number(before) === successfulApprovalIds.length,
        "Lifecycle approval count does not match successful authority events",
      );
    } else if (table === "module_lifecycle_approval_receipts") {
      requireCondition(
        Number(after) - Number(before) === successfulApprovalIds.length,
        "Lifecycle approval receipt count does not match approvals",
      );
    } else if (table === "records") {
      requireCondition(
        Number(after) - Number(before) === successfulApprovalIds.length,
        "Lifecycle approval did not write exactly one Record per approval",
      );
    } else {
      requireCondition(
        after === before,
        `Lifecycle approval unexpectedly mutated public.${table}`,
      );
    }
  }
  const actionReceiptTable = await admin.query<{ present: boolean }>(
    `select to_regclass('public.module_lifecycle_action_receipts') is not null
      as present`,
  );
  requireCondition(
    actionReceiptTable.rows[0]?.present,
    "Module lifecycle action-consumption ledger is missing",
  );
  const actionState = await admin.query<{ commands: string; receipts: string }>(
    `select
       (select count(*)::text from public.module_lifecycle_action_commands)
         as commands,
       (select count(*)::text from public.module_lifecycle_action_receipts)
         as receipts`,
  );
  requireCondition(
    actionState.rows[0]?.commands === "0" &&
      actionState.rows[0]?.receipts === "0",
    "Approval creation unexpectedly consumed or executed an action",
  );
}

async function proveModuleLifecycleExecutionBoundary(
  admin: Client,
  runtimeDatabaseUrl: string,
  bootstrap: BootstrapResult,
  ownerPersonId: string,
): Promise<void> {
  const admissionCredentialId = randomUUID();
  const finalizationCredentialId = randomUUID();
  const policy = await admin.query<{ id: string }>(
    `select id::text from public.policies
      where installation_id = $1 and workspace_id = $2
      order by created_at limit 1`,
    [bootstrap.installationId, bootstrap.workspaceId],
  );
  const policyId = policy.rows[0]?.id;
  requireCondition(policyId, "Lifecycle execution Policy is missing");
  await admin.query(
    `update public.work
        set state = 'leased', custodian_worker_id = $1,
            lease_expires_at = clock_timestamp() + interval '10 minutes'
      where installation_id = $2 and workspace_id = $3 and id = $4`,
    [
      bootstrap.workerId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
    ],
  );
  const grants = new Map<string, string>();
  const grantKey = (
    action: "backup" | "recovery" | "deletion" | "rollback",
    proofScope: "controlled-synthetic" | "workspace-production",
  ): string => `${action}:${proofScope}`;
  for (const action of [
    "backup",
    "recovery",
    "deletion",
    "rollback",
  ] as const) {
    const grantId = randomUUID();
    grants.set(grantKey(action, "controlled-synthetic"), grantId);
    await admin.query(
      `insert into public.capability_grants (
         id, installation_id, workspace_id, policy_id, principal_kind,
         worker_id, capability, mode, work_id, expires_at,
         granted_by_person_id
       ) values ($1, $2, $3, $4, 'worker', $5, $6, 'modify', $7,
                 clock_timestamp() + interval '10 minutes', $8)`,
      [
        grantId,
        bootstrap.installationId,
        bootstrap.workspaceId,
        policyId,
        bootstrap.workerId,
        `module.lifecycle.${action}.controlled-synthetic`,
        bootstrap.workId,
        ownerPersonId,
      ],
    );
  }
  await admin.query(
    `insert into public.worker_credentials (
       id, installation_id, workspace_id, worker_id, token_hash, token_hint,
       issued_at, expires_at, issued_by_person_id
     ) values
       ($1, $3, $4, $5,
        extensions.digest(convert_to($1::uuid::text, 'UTF8'), 'sha256'),
        'lifecycle-admit', clock_timestamp(),
        clock_timestamp() + interval '10 minutes', $6),
       ($2, $3, $4, $5,
        extensions.digest(convert_to($2::uuid::text, 'UTF8'), 'sha256'),
        'lifecycle-final', clock_timestamp(),
        clock_timestamp() + interval '10 minutes', $6)`,
    [
      admissionCredentialId,
      finalizationCredentialId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
      ownerPersonId,
    ],
  );

  const digest = (label: string): string =>
    `sha256:${createHash("sha256").update(label).digest("hex")}`;
  const common = {
    vortonInstallationId: bootstrap.installationId,
    workspaceId: bootstrap.workspaceId,
    realm: "organizational" as const,
    module: "tasks",
    sequence: 100,
    migrationPlanHash: digest("execution-plan"),
    sourceSnapshotSha256: digest("execution-source"),
    targetPreimageSha256: digest("execution-preimage"),
    targetPostimageSha256: digest("execution-postimage"),
  };
  const createApproval = (
    binding: Record<string, unknown>,
    validFor = "10 minutes",
  ): Promise<ModuleLifecycleApprovalCreation> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "authenticated",
      (client) =>
        setWorkspaceStepUpContext(
          client,
          bootstrap.installationId,
          bootstrap.workspaceId,
          ownerAuthUserId,
          Math.floor(Date.now() / 1000),
        ),
      async (client) => {
        const result = await client.query<{ creation: unknown }>(
          `select public.create_module_lifecycle_action_approval(
             $1, $2, $3, $4::jsonb,
             date_trunc('milliseconds', clock_timestamp() + $5::interval)
           ) as creation`,
          [
            randomUUID(),
            bootstrap.installationId,
            bootstrap.workspaceId,
            JSON.stringify(binding),
            validFor,
          ],
        );
        return parseModuleLifecycleApprovalCreation(result.rows[0]?.creation);
      },
    );
  const consumeSql = `select public.consume_module_lifecycle_action_approval_live(
    $1, $2, $3, $4, $5, $6
  ) as creation`;
  const finalizeSql = `select public.finalize_module_lifecycle_action_live(
    $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb
  ) as completion`;
  const signedWorkerContext =
    (
      credentialId = admissionCredentialId,
      installationId = bootstrap.installationId,
      workspaceId = bootstrap.workspaceId,
      workerId = bootstrap.workerId,
    ) =>
    (client: Client) =>
      setSignedContext(
        client,
        "worker",
        installationId,
        workspaceId,
        workerId,
        credentialId,
      );
  const expectConsumeDenied = (
    label: string,
    approval: ModuleLifecycleApprovalCreation,
    setup = signedWorkerContext(),
    commandId = randomUUID(),
    installationId = bootstrap.installationId,
    workspaceId = bootstrap.workspaceId,
    workId = bootstrap.workId,
    proofScope:
      "controlled-synthetic" | "workspace-production" = "controlled-synthetic",
  ) =>
    expectRuntimeSqlState(
      runtimeDatabaseUrl,
      "aubos_worker",
      setup,
      consumeSql,
      [
        commandId,
        approval.approval.approvalId,
        installationId,
        workspaceId,
        workId,
        proofScope,
      ],
      "P0001",
      label,
    );
  const consume = (
    approval: ModuleLifecycleApprovalCreation,
    commandId = randomUUID(),
    credentialId = admissionCredentialId,
    proofScope:
      "controlled-synthetic" | "workspace-production" = "controlled-synthetic",
  ) =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "aubos_worker",
      (client) =>
        setSignedContext(
          client,
          "worker",
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workerId,
          credentialId,
        ),
      async (client) => {
        const result = await client.query<{ creation: unknown }>(consumeSql, [
          commandId,
          approval.approval.approvalId,
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workId,
          proofScope,
        ]);
        return parseModuleLifecycleActionCommandCreation(
          result.rows[0]?.creation,
        );
      },
    );
  const finalize = (
    command: Awaited<ReturnType<typeof consume>>,
    outcome: Record<string, unknown>,
    effects: Record<string, unknown>,
    evidence: Record<string, unknown>,
    receiptId = randomUUID(),
  ): Promise<ModuleLifecycleActionCompletion> =>
    inRuntimeTransaction(
      runtimeDatabaseUrl,
      "aubos_worker",
      (client) =>
        setSignedContext(
          client,
          "worker",
          bootstrap.installationId,
          bootstrap.workspaceId,
          bootstrap.workerId,
          finalizationCredentialId,
        ),
      async (client) => {
        const result = await client.query<{ completion: unknown }>(
          finalizeSql,
          [
            receiptId,
            command.command.commandId,
            bootstrap.installationId,
            bootstrap.workspaceId,
            JSON.stringify(outcome),
            JSON.stringify(effects),
            JSON.stringify(evidence),
          ],
        );
        return parseModuleLifecycleActionCompletion(result.rows[0]?.completion);
      },
    );
  const successOutcome = { status: "succeeded", code: "completed" };
  const successEffects = (mutationBoundary: string) => ({
    approvalConsumed: true,
    actionAttempted: true,
    actionCompleted: true,
    productionModuleDataMutated: false,
    otherWorkspaceMutated: false,
    mutationBoundary,
  });

  const backupApproval = await createApproval({
    ...common,
    target: {
      action: "backup",
      backupId: randomUUID(),
      storageObjectKey: "tasks/execution/preimage.json",
      encryptionKeyBindingId: randomUUID(),
    },
  });
  const backupCommand = await consume(backupApproval);
  requireCondition(
    (await hashModuleLifecycleActionCommand(backupCommand.command)) ===
      backupCommand.command.commandHash,
    "PostgreSQL lifecycle command hash differs from TypeScript",
  );
  const backupEffects = successEffects("workspace-backup-artifact");
  const backupEvidence = {
    action: "backup",
    capturedAt: backupCommand.command.consumedAt,
    recordCount: 3,
    capturedStateSha256: common.targetPreimageSha256,
    manifestSha256: digest("execution-backup-manifest"),
    encryptedArtifactSha256: digest("execution-backup-artifact"),
    encryptedAtRest: true,
    workspaceKeyBound: true,
    workspaceStorageBound: true,
    otherWorkspaceAccessDenied: true,
  };
  const backupCompletion = await finalize(
    backupCommand,
    successOutcome,
    backupEffects,
    backupEvidence,
  );
  requireCondition(
    (await hashModuleLifecycleActionReceipt(backupCompletion.actionReceipt)) ===
      backupCompletion.actionReceipt.receiptHash,
    "PostgreSQL lifecycle action receipt hash differs from TypeScript",
  );

  const backupReference = {
    receiptId: backupCompletion.actionReceipt.receiptId,
    receiptSha256: backupCompletion.actionReceipt.receiptHash,
  };
  const recoveryApproval = await createApproval({
    ...common,
    target: {
      action: "recovery",
      recoveryId: randomUUID(),
      recoveryNamespace: "tasks-recovery-proof",
      backupReceipt: backupReference,
    },
  });
  const recoveryCommand = await consume(recoveryApproval);
  const recoveryCompletion = await finalize(
    recoveryCommand,
    successOutcome,
    successEffects("isolated-recovery-namespace"),
    {
      action: "recovery",
      isolatedNamespaceSha256: digest("execution-recovery-namespace"),
      restoredRecordCount: 3,
      restoredStateSha256: common.targetPreimageSha256,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      recoveryNamespaceDeleted: true,
    },
  );

  const recoveryReference = {
    receiptId: recoveryCompletion.actionReceipt.receiptId,
    receiptSha256: recoveryCompletion.actionReceipt.receiptHash,
  };
  const controlledFixtureId = randomUUID();
  const deletionApproval = await createApproval({
    ...common,
    target: {
      action: "deletion",
      mode: "controlled-fixture",
      rehearsalId: randomUUID(),
      controlledFixtureId,
      productionDeletion: false,
      noProductionRecords: true,
      backupReceipt: backupReference,
      recoveryReceipt: recoveryReference,
      surfaces: {
        database: true,
        storage: true,
        memory: true,
        search: true,
        backups: true,
      },
    },
  });
  const deletionCommand = await consume(deletionApproval);
  const deletionCompletion = await finalize(
    deletionCommand,
    successOutcome,
    successEffects("controlled-fixture"),
    {
      action: "deletion",
      mode: "controlled-fixture",
      controlledFixtureId,
      deletionManifestSha256: digest("execution-deletion-manifest"),
      productionRecordsDeleted: 0,
      residualCounts: {
        databaseRows: 0,
        storageObjects: 0,
        memoryFragments: 0,
        searchDocuments: 0,
        backupObjects: 0,
      },
      postDeletionRetrievalDenied: true,
      otherWorkspaceMutationCount: 0,
    },
  );

  const deletionReference = {
    receiptId: deletionCompletion.actionReceipt.receiptId,
    receiptSha256: deletionCompletion.actionReceipt.receiptHash,
  };
  const rollbackApproval = await createApproval({
    ...common,
    target: {
      action: "rollback",
      rollbackId: randomUUID(),
      rollbackNamespace: "tasks-rollback-proof",
      backupReceipt: backupReference,
      recoveryReceipt: recoveryReference,
      deletionRehearsalReceipt: deletionReference,
    },
  });
  const rollbackCommand = await consume(rollbackApproval);
  await finalize(
    rollbackCommand,
    successOutcome,
    successEffects("isolated-rollback-namespace"),
    {
      action: "rollback",
      fromPostimageSha256: common.targetPostimageSha256,
      restoredPreimageSha256: common.targetPreimageSha256,
      replayedPostimageSha256: common.targetPostimageSha256,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      rollbackNamespaceDeleted: true,
    },
  );

  const syntheticOnlyProductionApproval = await createApproval({
    ...common,
    target: {
      action: "backup",
      backupId: randomUUID(),
      storageObjectKey: "tasks/execution/scope-escalation-preimage.json",
      encryptionKeyBindingId: randomUUID(),
    },
  });
  await expectConsumeDenied(
    "synthetic lifecycle capability cannot select production proof scope",
    syntheticOnlyProductionApproval,
    signedWorkerContext(),
    randomUUID(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    bootstrap.workId,
    "workspace-production",
  );

  for (const action of ["backup", "recovery", "rollback"] as const) {
    const grantId = randomUUID();
    grants.set(grantKey(action, "workspace-production"), grantId);
    await admin.query(
      `insert into public.capability_grants (
         id, installation_id, workspace_id, policy_id, principal_kind,
         worker_id, capability, mode, work_id, expires_at,
         granted_by_person_id
       ) values ($1, $2, $3, $4, 'worker', $5, $6, 'modify', $7,
                 clock_timestamp() + interval '10 minutes', $8)`,
      [
        grantId,
        bootstrap.installationId,
        bootstrap.workspaceId,
        policyId,
        bootstrap.workerId,
        `module.lifecycle.${action}.workspace-production`,
        bootstrap.workId,
        ownerPersonId,
      ],
    );
  }

  const productionBackupApproval = await createApproval({
    ...common,
    target: {
      action: "backup",
      backupId: randomUUID(),
      storageObjectKey: "tasks/execution/production-preimage.json",
      encryptionKeyBindingId: randomUUID(),
    },
  });
  const productionBackupCommand = await consume(
    productionBackupApproval,
    randomUUID(),
    admissionCredentialId,
    "workspace-production",
  );
  const productionBackupCompletion = await finalize(
    productionBackupCommand,
    successOutcome,
    successEffects("workspace-backup-artifact"),
    {
      action: "backup",
      capturedAt: productionBackupCommand.command.consumedAt,
      recordCount: 4,
      capturedStateSha256: common.targetPreimageSha256,
      manifestSha256: digest("production-backup-manifest"),
      encryptedArtifactSha256: digest("production-backup-artifact"),
      encryptedAtRest: true,
      workspaceKeyBound: true,
      workspaceStorageBound: true,
      otherWorkspaceAccessDenied: true,
    },
  );
  const productionBackupReference = {
    receiptId: productionBackupCompletion.actionReceipt.receiptId,
    receiptSha256: productionBackupCompletion.actionReceipt.receiptHash,
  };
  const productionRecoveryApproval = await createApproval({
    ...common,
    target: {
      action: "recovery",
      recoveryId: randomUUID(),
      recoveryNamespace: "tasks-production-recovery-proof",
      backupReceipt: productionBackupReference,
    },
  });
  const productionRecoveryCommand = await consume(
    productionRecoveryApproval,
    randomUUID(),
    admissionCredentialId,
    "workspace-production",
  );
  const productionRecoveryCompletion = await finalize(
    productionRecoveryCommand,
    successOutcome,
    successEffects("isolated-recovery-namespace"),
    {
      action: "recovery",
      isolatedNamespaceSha256: digest("production-recovery-namespace"),
      restoredRecordCount: 4,
      restoredStateSha256: common.targetPreimageSha256,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      recoveryNamespaceDeleted: true,
    },
  );
  const productionRecoveryReference = {
    receiptId: productionRecoveryCompletion.actionReceipt.receiptId,
    receiptSha256: productionRecoveryCompletion.actionReceipt.receiptHash,
  };
  const productionFixtureId = randomUUID();
  const productionDeletionApproval = await createApproval({
    ...common,
    target: {
      action: "deletion",
      mode: "controlled-fixture",
      rehearsalId: randomUUID(),
      controlledFixtureId: productionFixtureId,
      productionDeletion: false,
      noProductionRecords: true,
      backupReceipt: productionBackupReference,
      recoveryReceipt: productionRecoveryReference,
      surfaces: {
        database: true,
        storage: true,
        memory: true,
        search: true,
        backups: true,
      },
    },
  });
  const productionDeletionCommand = await consume(productionDeletionApproval);
  const productionDeletionCompletion = await finalize(
    productionDeletionCommand,
    successOutcome,
    successEffects("controlled-fixture"),
    {
      action: "deletion",
      mode: "controlled-fixture",
      controlledFixtureId: productionFixtureId,
      deletionManifestSha256: digest("production-deletion-manifest"),
      productionRecordsDeleted: 0,
      residualCounts: {
        databaseRows: 0,
        storageObjects: 0,
        memoryFragments: 0,
        searchDocuments: 0,
        backupObjects: 0,
      },
      postDeletionRetrievalDenied: true,
      otherWorkspaceMutationCount: 0,
    },
  );
  const productionDeletionReference = {
    receiptId: productionDeletionCompletion.actionReceipt.receiptId,
    receiptSha256: productionDeletionCompletion.actionReceipt.receiptHash,
  };
  const productionRollbackApproval = await createApproval({
    ...common,
    target: {
      action: "rollback",
      rollbackId: randomUUID(),
      rollbackNamespace: "tasks-production-rollback-proof",
      backupReceipt: productionBackupReference,
      recoveryReceipt: productionRecoveryReference,
      deletionRehearsalReceipt: productionDeletionReference,
    },
  });
  const productionRollbackCommand = await consume(
    productionRollbackApproval,
    randomUUID(),
    admissionCredentialId,
    "workspace-production",
  );
  await finalize(
    productionRollbackCommand,
    successOutcome,
    successEffects("isolated-rollback-namespace"),
    {
      action: "rollback",
      fromPostimageSha256: common.targetPostimageSha256,
      restoredPreimageSha256: common.targetPreimageSha256,
      replayedPostimageSha256: common.targetPostimageSha256,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      rollbackNamespaceDeleted: true,
    },
  );

  const wrongScopeRecoveryApproval = await createApproval({
    ...common,
    target: {
      action: "recovery",
      recoveryId: randomUUID(),
      recoveryNamespace: "tasks-wrong-scope-recovery-proof",
      backupReceipt: productionBackupReference,
    },
  });
  await expectConsumeDenied(
    "lifecycle recovery predecessor proof scope substitution",
    wrongScopeRecoveryApproval,
  );

  const hostileBackupBinding = {
    ...common,
    target: {
      action: "backup",
      backupId: randomUUID(),
      storageObjectKey: "tasks/execution/hostile-preimage.json",
      encryptionKeyBindingId: randomUUID(),
    },
  };
  const forgedApproval = await createApproval(hostileBackupBinding);
  const forgedWorkerContext = async (client: Client): Promise<void> => {
    await setSignedContext(
      client,
      "worker",
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workerId,
      admissionCredentialId,
    );
    await client.query(
      "select set_config('aubos.context_signature', $1, true)",
      ["0".repeat(64)],
    );
  };
  await expectConsumeDenied(
    "forged lifecycle worker context",
    forgedApproval,
    forgedWorkerContext,
  );
  await expectConsumeDenied(
    "wrong lifecycle workspace",
    forgedApproval,
    signedWorkerContext(
      admissionCredentialId,
      bootstrap.installationId,
      otherWorkspaceId,
    ),
    randomUUID(),
    bootstrap.installationId,
    otherWorkspaceId,
  );
  await expectConsumeDenied(
    "wrong lifecycle Vorton installation",
    forgedApproval,
    signedWorkerContext(
      admissionCredentialId,
      otherInstallationId,
      bootstrap.workspaceId,
    ),
    randomUUID(),
    otherInstallationId,
    bootstrap.workspaceId,
  );
  await expectConsumeDenied(
    "wrong lifecycle worker",
    forgedApproval,
    signedWorkerContext(
      admissionCredentialId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      otherWorkerId,
    ),
  );
  await expectConsumeDenied(
    "wrong lifecycle credential",
    forgedApproval,
    signedWorkerContext(randomUUID()),
  );
  await expectConsumeDenied(
    "wrong lifecycle Work custody",
    forgedApproval,
    signedWorkerContext(),
    randomUUID(),
    bootstrap.installationId,
    bootstrap.workspaceId,
    otherWorkId,
  );

  const expiredApproval = await createApproval(
    hostileBackupBinding,
    "1 second",
  );
  await expectConsumeDenied(
    "expired lifecycle approval",
    expiredApproval,
    async (client) => {
      await signedWorkerContext()(client);
      await client.query("select pg_sleep(1.05)");
    },
  );

  const substitutedRecoveryApproval = await createApproval({
    ...common,
    target: {
      action: "recovery",
      recoveryId: randomUUID(),
      recoveryNamespace: "tasks-substituted-recovery-proof",
      backupReceipt: {
        receiptId: randomUUID(),
        receiptSha256: digest("substituted-backup-receipt"),
      },
    },
  });
  await expectConsumeDenied(
    "lifecycle predecessor receipt substitution",
    substitutedRecoveryApproval,
  );

  const concurrentApproval = await createApproval({
    ...hostileBackupBinding,
    target: {
      ...hostileBackupBinding.target,
      backupId: randomUUID(),
    },
  });
  const concurrentCommandId = randomUUID();
  const [concurrentLeft, concurrentRight] = await Promise.all([
    consume(concurrentApproval, concurrentCommandId),
    consume(concurrentApproval, concurrentCommandId),
  ]);
  requireCondition(
    canonicalModuleLifecycleJson(concurrentLeft) ===
      canonicalModuleLifecycleJson(concurrentRight) &&
      concurrentLeft.command.approvalConsumptionCount === 1,
    "Concurrent lifecycle consumption did not converge on one command",
  );
  const responseLossReplay = await consume(
    concurrentApproval,
    concurrentCommandId,
  );
  requireCondition(
    canonicalModuleLifecycleJson(responseLossReplay) ===
      canonicalModuleLifecycleJson(concurrentLeft),
    "Lifecycle command response-loss replay changed the command",
  );
  await expectConsumeDenied(
    "conflicting lifecycle consumption replay",
    concurrentApproval,
  );

  await admin.query(
    `update public.workspace_memberships set kind = 'member'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
  );
  await expectConsumeDenied(
    "lifecycle replay after original owner revocation",
    concurrentApproval,
    signedWorkerContext(),
    concurrentCommandId,
  );
  await admin.query(
    `update public.workspace_memberships set kind = 'owner'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
  );

  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorkerContext(finalizationCredentialId),
    finalizeSql,
    [
      randomUUID(),
      concurrentLeft.command.commandId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      JSON.stringify(successOutcome),
      JSON.stringify(successEffects("workspace-backup-artifact")),
      JSON.stringify({
        ...backupEvidence,
        capturedAt: concurrentLeft.command.consumedAt,
        capturedStateSha256: common.targetPreimageSha256,
        recordCount: -1,
      }),
    ],
    "P0001",
    "invalid lifecycle action evidence",
  );
  const invalidResultState = await admin.query<{ receipts: string }>(
    `select count(*)::text as receipts
       from public.module_lifecycle_action_receipts
      where command_id = $1`,
    [concurrentLeft.command.commandId],
  );
  requireCondition(
    invalidResultState.rows[0]?.receipts === "0",
    "Invalid lifecycle result left a partial receipt",
  );
  const failureCompletion = await finalize(
    concurrentLeft,
    {
      status: "failed",
      code: "synthetic-verification-failure",
      stage: "verification",
      retryDisposition: "new-approval-required",
    },
    {
      approvalConsumed: true,
      actionAttempted: true,
      actionCompleted: false,
      authorizedTargetMutation: "none",
      productionModuleDataMutation: "none",
      otherWorkspaceMutation: "none",
      quarantined: true,
    },
    {
      action: "backup",
      failureEvidenceSha256: digest("synthetic-verification-failure"),
      lastSafeCheckpoint: "approval-consumed",
    },
  );
  requireCondition(
    failureCompletion.actionReceipt.outcome.status === "failed" &&
      (await hashModuleLifecycleActionReceipt(
        failureCompletion.actionReceipt,
      )) === failureCompletion.actionReceipt.receiptHash,
    "Failed lifecycle action was not recorded as an exact immutable receipt",
  );

  await admin.query(
    `update public.workspace_memberships set kind = 'member'
      where installation_id = $1 and workspace_id = $2 and person_id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
  );
  try {
    const replayedCompletion = await finalize(
      backupCommand,
      successOutcome,
      backupEffects,
      backupEvidence,
      backupCompletion.actionReceipt.receiptId,
    );
    requireCondition(
      canonicalModuleLifecycleJson(replayedCompletion) ===
        canonicalModuleLifecycleJson(backupCompletion),
      "Completed lifecycle receipt replay changed after owner revocation",
    );
  } finally {
    await admin.query(
      `update public.workspace_memberships set kind = 'owner'
        where installation_id = $1 and workspace_id = $2 and person_id = $3`,
      [bootstrap.installationId, bootstrap.workspaceId, ownerPersonId],
    );
  }
  await expectRuntimeSqlState(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorkerContext(finalizationCredentialId),
    finalizeSql,
    [
      randomUUID(),
      backupCommand.command.commandId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      JSON.stringify(successOutcome),
      JSON.stringify(backupEffects),
      JSON.stringify(backupEvidence),
    ],
    "P0001",
    "conflicting lifecycle action receipt replay",
  );

  const duplicateGrantId = randomUUID();
  await admin.query(
    `insert into public.capability_grants (
       id, installation_id, workspace_id, policy_id, principal_kind,
       worker_id, capability, mode, work_id, expires_at,
       granted_by_person_id
     ) values ($1, $2, $3, $4, 'worker', $5,
               'module.lifecycle.backup.controlled-synthetic', 'modify', $6,
               clock_timestamp() + interval '10 minutes', $7)`,
    [
      duplicateGrantId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      policyId,
      bootstrap.workerId,
      bootstrap.workId,
      ownerPersonId,
    ],
  );
  const ambiguousGrantApproval = await createApproval({
    ...hostileBackupBinding,
    target: {
      ...hostileBackupBinding.target,
      backupId: randomUUID(),
    },
  });
  await expectConsumeDenied(
    "ambiguous lifecycle capability grant",
    ambiguousGrantApproval,
  );
  await admin.query("delete from public.capability_grants where id = $1", [
    duplicateGrantId,
  ]);

  const backupGrantId = grants.get(grantKey("backup", "controlled-synthetic"));
  requireCondition(backupGrantId, "Lifecycle backup grant is missing");
  const grantRevocationId = randomUUID();
  await admin.query(
    `insert into public.capability_grant_revocations (
       id, installation_id, workspace_id, grant_id,
       revoked_by_person_id, reason
     ) values ($1, $2, $3, $4, $5, 'Synthetic hostile proof')`,
    [
      grantRevocationId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      backupGrantId,
      ownerPersonId,
    ],
  );
  const revokedGrantApproval = await createApproval({
    ...hostileBackupBinding,
    target: {
      ...hostileBackupBinding.target,
      backupId: randomUUID(),
    },
  });
  await expectConsumeDenied(
    "revoked lifecycle capability grant",
    revokedGrantApproval,
  );
  await admin.query(
    "delete from public.capability_grant_revocations where id = $1",
    [grantRevocationId],
  );

  const credentialRevocationId = randomUUID();
  await admin.query(
    `insert into public.worker_credential_revocations (
       id, installation_id, workspace_id, credential_id,
       revoked_by_person_id, reason
     ) values ($1, $2, $3, $4, $5, 'Synthetic hostile proof')`,
    [
      credentialRevocationId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      admissionCredentialId,
      ownerPersonId,
    ],
  );
  const revokedCredentialApproval = await createApproval({
    ...hostileBackupBinding,
    target: {
      ...hostileBackupBinding.target,
      backupId: randomUUID(),
    },
  });
  await expectConsumeDenied(
    "revoked lifecycle worker credential",
    revokedCredentialApproval,
  );
  await admin.query(
    "delete from public.worker_credential_revocations where id = $1",
    [credentialRevocationId],
  );

  const postAuthorityApproval = await createApproval({
    ...hostileBackupBinding,
    target: {
      ...hostileBackupBinding.target,
      backupId: randomUUID(),
      storageObjectKey: "tasks/execution/post-authority-preimage.json",
    },
  });
  const postAuthorityCommand = await consume(postAuthorityApproval);
  const postAuthorityGrantRevocationId = randomUUID();
  await admin.query(
    `update public.work
        set state = 'ready', custodian_worker_id = null,
            lease_expires_at = null
      where installation_id = $1 and workspace_id = $2 and id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, bootstrap.workId],
  );
  await admin.query(
    `insert into public.capability_grant_revocations (
       id, installation_id, workspace_id, grant_id,
       revoked_by_person_id, reason
     ) values ($1, $2, $3, $4, $5,
               'Synthetic post-admission finalization proof')`,
    [
      postAuthorityGrantRevocationId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      backupGrantId,
      ownerPersonId,
    ],
  );
  const postAuthorityCompletion = await finalize(
    postAuthorityCommand,
    successOutcome,
    successEffects("workspace-backup-artifact"),
    {
      action: "backup",
      capturedAt: postAuthorityCommand.command.consumedAt,
      recordCount: 5,
      capturedStateSha256: common.targetPreimageSha256,
      manifestSha256: digest("post-authority-backup-manifest"),
      encryptedArtifactSha256: digest("post-authority-backup-artifact"),
      encryptedAtRest: true,
      workspaceKeyBound: true,
      workspaceStorageBound: true,
      otherWorkspaceAccessDenied: true,
    },
  );
  requireCondition(
    postAuthorityCompletion.actionReceipt.outcome.status === "succeeded" &&
      postAuthorityCompletion.actionReceipt.executor.finalization
        .credentialId === finalizationCredentialId &&
      postAuthorityCompletion.actionReceipt.executor.admission
        .capabilityGrantId === backupGrantId,
    "Lifecycle finalization incorrectly required renewed Work or grant authority",
  );
  await admin.query(
    "delete from public.capability_grant_revocations where id = $1",
    [postAuthorityGrantRevocationId],
  );

  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorkerContext(),
    "select * from public.module_lifecycle_action_commands",
    [],
    "direct lifecycle command read",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorkerContext(),
    "select * from public.module_lifecycle_action_receipts",
    [],
    "direct lifecycle receipt read",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorkerContext(),
    `select public.consume_module_lifecycle_action_approval(
       $1, $2, $3, $4, $5, $6
     )`,
    [
      randomUUID(),
      backupApproval.approval.approvalId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      bootstrap.workId,
      "controlled-synthetic",
    ],
    "unguarded lifecycle consume entrypoint",
  );
  await expectRuntimeDenied(
    runtimeDatabaseUrl,
    "aubos_worker",
    signedWorkerContext(finalizationCredentialId),
    `select public.finalize_module_lifecycle_action(
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb
     )`,
    [
      backupCompletion.actionReceipt.receiptId,
      backupCommand.command.commandId,
      bootstrap.installationId,
      bootstrap.workspaceId,
      JSON.stringify(successOutcome),
      JSON.stringify(backupEffects),
      JSON.stringify(backupEvidence),
    ],
    "unguarded lifecycle finalize entrypoint",
  );
  await expectSqlState(
    admin,
    `update public.module_lifecycle_action_commands
        set proof_scope = 'workspace-production'
      where command_id = $1`,
    [backupCommand.command.commandId],
    "P0001",
    "lifecycle command mutation",
  );
  await expectSqlState(
    admin,
    "delete from public.module_lifecycle_action_receipts where receipt_id = $1",
    [backupCompletion.actionReceipt.receiptId],
    "P0001",
    "lifecycle receipt deletion",
  );

  await admin.query(
    `update public.work set state = 'ready', custodian_worker_id = null,
        lease_expires_at = null
      where installation_id = $1 and workspace_id = $2 and id = $3`,
    [bootstrap.installationId, bootstrap.workspaceId, bootstrap.workId],
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
    const ownerPersonId = await seedAuthorityFixtures(
      admin,
      adminDatabaseUrl,
      runtimeDatabaseUrl,
      bootstrap,
    );
    await proveWorkspaceResourceCoexistence(admin, bootstrap, ownerPersonId);
    await proveContextGatewayMemoryBankAuthority(
      admin,
      runtimeDatabaseUrl,
      bootstrap,
      ownerPersonId,
    );
    await proveWorkspaceMemoryBankIdentity(admin, bootstrap);
    await proveWorkspaceModuleProjectionBoundary(
      admin,
      runtimeDatabaseUrl,
      bootstrap,
      ownerPersonId,
    );
    await proveWorkspaceCoreSurfaceSelectionBoundary(
      admin,
      adminDatabaseUrl,
      runtimeDatabaseUrl,
      bootstrap,
    );
    await proveModuleLifecycleApprovalBoundary(
      admin,
      adminDatabaseUrl,
      runtimeDatabaseUrl,
      bootstrap,
      ownerPersonId,
    );
    await proveModuleLifecycleExecutionBoundary(
      admin,
      runtimeDatabaseUrl,
      bootstrap,
      ownerPersonId,
    );
    await provePersonBoundary(runtimeDatabaseUrl, bootstrap, ownerPersonId);
    await proveWorkerBoundary(runtimeDatabaseUrl, bootstrap, ownerPersonId);
    await proveCouncilResolverFrozenEvidenceRead(runtimeDatabaseUrl, bootstrap);
    await proveCouncilBoundary(admin, runtimeDatabaseUrl, bootstrap);
    await proveWorkspaceMembershipRevocationBoundary(
      admin,
      adminDatabaseUrl,
      runtimeDatabaseUrl,
      bootstrap,
      ownerPersonId,
    );

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
            memoryBankExternalIdentityWorkspaceBound: true,
            memoryBankLegacyIdentityPreservedUntilExplicitReconciliation: true,
            memoryBankLegacyIdentityRequiresExplicitRemediation: true,
            workspaceModuleProjectionEmptyPersonalFailsClosed: true,
            workspaceModuleProjectionExactTuplesAndDefaultBound: true,
            workspaceModuleProjectionInvalidStateDenied: true,
            workspaceModuleProjectionRuntimeMutationDenied: true,
            workspaceModuleProjectionRlsLiveMembershipBound: true,
            workspaceModuleProjectionForeignAndRevokedAccessDenied: true,
            workspaceCoreSurfaceSelectionUnsignedAndForgedContextsDenied: true,
            workspaceCoreSurfaceSelectionTargetExistenceHiddenBeforeContext: true,
            workspaceCoreSurfaceSelectionMissingRuntimeKeyFailsClosed: true,
            workspaceCoreSurfaceSelectionLiveOwnerAndRecentAal2Required: true,
            workspaceCoreSurfaceSelectionApplyAndReplayStepUpRevalidated: true,
            workspaceCoreSurfaceSelectionWorkPolicyAndGrantBound: true,
            workspaceCoreSurfaceSelectionCompiledRegistryDerived: true,
            workspaceCoreSurfaceSelectionSurfaceAndLineageExact: true,
            workspaceCoreSurfaceSelectionLegacyStateUnchangedAndUnblessed: true,
            workspaceCoreSurfaceSelectionProjectionAttributionDoesNotPinMembership: true,
            workspaceCoreSurfaceSelectionApprovalReceiptAndRecordAtomic: true,
            workspaceCoreSurfaceSelectionHashesCrossLanguageCanonical: true,
            workspaceCoreSurfaceSelectionAppliedExactlyOnce: true,
            workspaceCoreSurfaceSelectionConcurrentExactApplyConvergesOnce: true,
            workspaceCoreSurfaceSelectionConcurrentConflictingApplyDenied: true,
            workspaceCoreSurfaceSelectionReplayExactAndLiveOwnerBound: true,
            workspaceCoreSurfaceSelectionExactReplaySurvivesExpiry: true,
            workspaceCoreSurfaceSelectionHistoricalReplayFollowsLineage: true,
            workspaceCoreSurfaceSelectionUnreceiptedDriftDenied: true,
            workspaceCoreSurfaceSelectionLineageTerminalAndLinear: true,
            workspaceCoreSurfaceSelectionTablesPrivateAndImmutable: true,
            workspaceCoreSurfaceSelectionAuthorityChangesSerialized: true,
            workspaceCoreSurfaceSelectionCrossWorkspaceMutationDenied: true,
            workspaceCoreSurfaceSelectionRollbackRestoresExactPreimage: true,
            contextGatewayBankAuthorityPostgresResolved: true,
            contextGatewayPersonAndWorkerCapabilitiesExplicit: true,
            contextGatewayWorkerCredentialFreshAndLive: true,
            contextGatewayWorkerClassificationCeilingBound: true,
            contextGatewaySyntheticCeilingRejectsPublicSource: true,
            contextGatewayPublicCeilingPermitsSyntheticSource: true,
            contextGatewayRolesAndHealthNonAuthoritative: true,
            contextGatewayOperationCapabilityMappingFixed: true,
            contextGatewayAnonymousExecutionDenied: true,
            contextGatewaySourceProjectionAnonymousExecutionDenied: true,
            contextGatewayDirectMemoryTableReadsDenied: true,
            contextGatewayFutureAndRevokedGrantsDenied: true,
            contextGatewaySourceProjectionRevocationLive: true,
            contextGatewayWorkspaceMembershipRevocationLedgerLive: true,
            contextGatewayUngovernedMembershipRevocationDenied: true,
            contextGatewayNoBankLegacyAndCrossWorkspaceDenied: true,
            contextGatewayResolutionHasNoMemoryEffects: true,
            installationScopedReleaseAdoptionApprovalConsumed: true,
            releaseAdoptionExactReleaseSubstitutionsDenied: true,
            releaseAdoptionReceiptHashCanonicalAndImmutable: true,
            releaseAdoptionExactReplaySurvivesOwnerDemotion: true,
            releaseAdoptionConcurrentExactApplyConvergesOnce: true,
            releaseAdoptionExactReplaySurvivesExpiry: true,
            installationScopedWorkspaceApprovalConsumed: true,
            unsignedWorkspaceCreationStepUpDenied: true,
            workspaceApplyOwnerDemotionSerialized: true,
            workspaceCreationExactReplaySurvivesOwnerDemotion: true,
            emptyWorkspaceAdditionReceiptBound: true,
            moduleLifecycleUnsignedAndForgedContextsDenied: true,
            moduleLifecycleWorkspaceOwnerRevocationLive: true,
            moduleLifecycleRecentAal2Bound: true,
            moduleLifecycleMillisecondExpiryExact: true,
            moduleLifecycleApprovalReceiptAndRecordAtomic: true,
            moduleLifecycleHashesCrossLanguageCanonical: true,
            moduleLifecycleIdentityAndDigestReuseDenied: true,
            moduleLifecycleAuthorityAppendOnly: true,
            moduleLifecycleDirectAccessAndHelpersDenied: true,
            moduleLifecycleConflictingReplayDenied: true,
            moduleLifecycleMembershipMutationSerialized: true,
            moduleLifecycleFailureRollsBackAtomically: true,
            moduleLifecycleApprovalHasNoActionEffects: true,
            moduleLifecycleExecutionApprovalConsumedExactlyOnce: true,
            moduleLifecycleExecutionCommandAndReceiptAtomic: true,
            moduleLifecycleExecutionPredecessorChainExact: true,
            moduleLifecycleExecutionHashesCrossLanguageCanonical: true,
            moduleLifecycleExecutionControlledDeletionOnly: true,
            moduleLifecycleExecutionMixedScopeRollbackExact: true,
            moduleLifecycleExecutionHostileAuthorityDenied: true,
            moduleLifecycleExecutionProofScopeCapabilityBound: true,
            moduleLifecycleExecutionCrossInstallationDenied: true,
            moduleLifecycleExecutionConcurrentConsumptionConvergesOnce: true,
            moduleLifecycleExecutionFinalizationSurvivesAuthorityExpiry: true,
            moduleLifecycleExecutionResponseLossReplayExact: true,
            moduleLifecycleExecutionTablesPrivateAndImmutable: true,
            membershipRevocationUnsignedAndForgedContextsDenied: true,
            membershipRevocationLiveOwnerAndRecentAal2Required: true,
            membershipRevocationTargetAndFinalOwnerBound: true,
            membershipRevocationWorkPolicyAndGrantBound: true,
            membershipRevocationApprovalReceiptAndRecordAtomic: true,
            membershipRevocationHashesCrossLanguageCanonical: true,
            membershipRevocationTablesPrivateAndImmutable: true,
            membershipRevocationAuthorityRacesSerialized: true,
            membershipRevocationAppliedExactlyOnce: true,
            membershipRevocationReplayExactAndLiveOwnerBound: true,
            membershipRevocationExactReplaySurvivesExpiry: true,
            membershipRevocationExternalLedgerConflictDenied: true,
            membershipRevocationImmediatelyRevokesRuntimeAuthority: true,
            membershipRevocationCrossWorkspaceMutationDenied: true,
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
