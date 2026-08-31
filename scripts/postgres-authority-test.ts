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
  moduleLifecycleCanonicalSha256,
  parseModuleLifecycleApprovalCreation,
  type ExecutiveWorkerJobRequest,
  type ModuleLifecycleApprovalCreation,
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
const ownerAuthUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const otherInstallationId = "36bb264a-668f-45a6-8da0-6e5cad3fc026";
const otherWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherWorkId = "02fb4603-57f1-4a04-a6f6-2d473af03f7b";
const otherWorkerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherRoleId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherPolicyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const organizationalBankId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const personalBankId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
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
    !actionReceiptTable.rows[0]?.present,
    "Approval creation unexpectedly installed an action-consumption ledger",
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
    await proveModuleLifecycleApprovalBoundary(
      admin,
      adminDatabaseUrl,
      runtimeDatabaseUrl,
      bootstrap,
      ownerPersonId,
    );
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
