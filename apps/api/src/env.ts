import {
  dataClassificationSchema,
  type DataClassification,
} from "@aubos/contracts";

export interface ApiEnvironment {
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databaseContextSigningSecret: string;
  supabaseProjectRef: string;
  supabaseUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtJwksUrl: string;
  workerUrl: string;
  workerSharedSecret: string;
  workerProvider: string;
  workerModel: string;
  workerClassificationCeiling: DataClassification;
  release: string;
  allowedOrigin: string;
  hindsightUrl: string;
  hindsightApiKey: string;
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
  const value = env[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}

function url(value: string, name: string, protocols: string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  return parsed;
}

export function readApiEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ApiEnvironment {
  const projectRef = required(env, "AUBOS_SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error(
      "AUBOS_SUPABASE_PROJECT_REF must be a 20 character Supabase project ref",
    );
  }
  const supabaseUrl = url(
    required(env, "AUBOS_SUPABASE_URL"),
    "AUBOS_SUPABASE_URL",
    ["https:"],
  );
  const issuer = url(
    required(env, "AUBOS_SUPABASE_JWT_ISSUER"),
    "AUBOS_SUPABASE_JWT_ISSUER",
    ["https:"],
  );
  const jwks = url(
    required(env, "AUBOS_SUPABASE_JWKS_URL"),
    "AUBOS_SUPABASE_JWKS_URL",
    ["https:"],
  );
  const expectedHost = `${projectRef}.supabase.co`;
  const expectedOrigin = `https://${expectedHost}`;
  if (
    supabaseUrl.toString().replace(/\/$/, "") !== expectedOrigin ||
    issuer.toString().replace(/\/$/, "") !== `${expectedOrigin}/auth/v1` ||
    jwks.toString() !== `${expectedOrigin}/auth/v1/.well-known/jwks.json`
  ) {
    throw new Error(
      "Supabase URL, JWT issuer, and JWKS URL must exactly match AUBOS_SUPABASE_PROJECT_REF",
    );
  }
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const secret = required(env, "AUBOS_WORKER_SHARED_SECRET");
  if (secret.length < 32)
    throw new Error(
      "AUBOS_WORKER_SHARED_SECRET must contain at least 32 characters",
    );
  const workerUrl = url(required(env, "AUBOS_WORKER_URL"), "AUBOS_WORKER_URL", [
    "http:",
    "https:",
  ]);
  const allowedOrigin = url(
    required(env, "AUBOS_ALLOWED_ORIGIN"),
    "AUBOS_ALLOWED_ORIGIN",
    ["https:"],
  );
  const hindsightUrl = url(
    required(env, "AUBOS_HINDSIGHT_URL"),
    "AUBOS_HINDSIGHT_URL",
    ["http:", "https:"],
  );
  const databaseContextSigningSecret = required(
    env,
    "AUBOS_DATABASE_CONTEXT_SIGNING_SECRET",
  );
  if (databaseContextSigningSecret.length < 32) {
    throw new Error(
      "AUBOS_DATABASE_CONTEXT_SIGNING_SECRET must contain at least 32 characters",
    );
  }
  return {
    port,
    databaseUrl: required(env, "AUBOS_DATABASE_URL"),
    databaseSsl: exactBoolean(env, "AUBOS_DATABASE_SSL", true),
    databaseContextSigningSecret,
    supabaseProjectRef: projectRef,
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ""),
    jwtIssuer: issuer.toString().replace(/\/$/, ""),
    jwtAudience: required(env, "AUBOS_SUPABASE_JWT_AUDIENCE"),
    jwtJwksUrl: jwks.toString(),
    workerUrl: workerUrl.toString().replace(/\/$/, ""),
    workerSharedSecret: secret,
    workerProvider: required(env, "AUBOS_WORKER_PROVIDER"),
    workerModel: required(env, "AUBOS_WORKER_MODEL"),
    workerClassificationCeiling: dataClassificationSchema.parse(
      env.AUBOS_WORKER_CLASSIFICATION_CEILING ?? "internal",
    ),
    release:
      env.FLY_IMAGE_REF?.trim() || env.AUBOS_RELEASE?.trim() || "development",
    allowedOrigin: allowedOrigin.origin,
    hindsightUrl: hindsightUrl.toString().replace(/\/$/, ""),
    hindsightApiKey: required(env, "AUBOS_HINDSIGHT_API_KEY"),
  };
}
