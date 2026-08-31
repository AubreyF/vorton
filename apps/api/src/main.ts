import { Database } from "@vorton/database";
import { DatabaseExecutiveAuthorityVerifier } from "@vorton/executive";
import { WorkersService } from "@vorton/kernel";

import { createSupabaseIdentityVerifier } from "./auth.js";
import { DatabaseExecutiveCouncilResolver } from "./council-resolver.js";
import { DatabaseExecutiveLedger } from "./database-ledger.js";
import { DatabaseWorkerRunRecorder } from "./database-worker-runs.js";
import { DatabaseInstallationAuthority } from "./installation-authority.js";
import { DatabaseModuleLifecycleAuthority } from "./module-lifecycle-authority.js";
import { DatabaseModuleLifecycleExecution } from "./module-lifecycle-execution.js";
import { readApiEnvironment } from "./env.js";
import { RemoteExecutiveWorkerAdapter } from "./remote-worker.js";
import { DatabaseExecutiveRequestResolver } from "./request-resolver.js";
import { createApiServer } from "./server.js";

const env = readApiEnvironment();
const database = new Database({
  contextSigningSecret: env.databaseContextSigningSecret,
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl
    ? {
        rejectUnauthorized: true,
        ...(env.databaseSslCa ? { ca: env.databaseSslCa } : {}),
      }
    : undefined,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  application_name: "vorton-api",
});
const ledger = new DatabaseExecutiveLedger(database);
const worker = new RemoteExecutiveWorkerAdapter({
  url: env.workerUrl,
  secret: env.workerSharedSecret,
  provider: env.workerProvider,
  model: env.workerModel,
  dataClassificationCeiling: env.workerClassificationCeiling,
  requestTimeoutMs: env.workerRequestTimeoutMs,
});
const server = createApiServer({
  database,
  ledger,
  authorityVerifier: new DatabaseExecutiveAuthorityVerifier(database),
  identityVerifier: createSupabaseIdentityVerifier({
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    jwksUrl: env.jwtJwksUrl,
  }),
  worker,
  requestResolver: new DatabaseExecutiveRequestResolver(
    database,
    worker.provider,
    worker.model,
  ),
  workerRuns: new DatabaseWorkerRunRecorder(database),
  councilResolver: new DatabaseExecutiveCouncilResolver(database, worker),
  installationAuthority: new DatabaseInstallationAuthority(database),
  moduleLifecycleAuthority: new DatabaseModuleLifecycleAuthority(database),
  moduleLifecycleExecution: new DatabaseModuleLifecycleExecution(database),
  workerCredentialVerifier: new WorkersService(database),
  release: env.release,
  allowedOrigin: env.allowedOrigin,
});

server.listen(env.port, "0.0.0.0", () => {
  console.log(`Vorton API listening on port ${String(env.port)}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Vorton API received ${signal}`);
  server.close();
  await database.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
