import { Database } from "@vorton/database";
import { DatabaseExecutiveAuthorityVerifier } from "@vorton/executive";
import { HttpHindsightAdapter } from "@vorton/memory";

import { createSupabaseIdentityVerifier } from "./auth.js";
import { DatabaseExecutiveCouncilResolver } from "./council-resolver.js";
import { DatabaseExecutiveLedger } from "./database-ledger.js";
import { DatabaseWorkerRunRecorder } from "./database-worker-runs.js";
import { DatabaseInstallationAuthority } from "./installation-authority.js";
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
// Server-only construction. Derived memory never participates in authority checks.
const hindsight = new HttpHindsightAdapter({
  baseUrl: env.hindsightUrl,
  apiKey: env.hindsightApiKey,
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
    hindsight,
    (error) =>
      console.warn(
        "Vorton derived memory recall is unavailable; continuing with authoritative evidence only",
        error,
      ),
  ),
  workerRuns: new DatabaseWorkerRunRecorder(database),
  councilResolver: new DatabaseExecutiveCouncilResolver(database, worker),
  installationAuthority: new DatabaseInstallationAuthority(database),
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
