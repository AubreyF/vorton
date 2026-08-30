import {
  dataClassificationSchema,
  type DataClassification,
} from "@vorton/contracts";

export interface ApiEnvironment {
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databaseSslCa: string | undefined;
  databaseContextSigningSecret: string;
  supabaseProjectRef: string;
  supabaseUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtJwksUrl: string;
  workerUrl: string;
  workerSharedSecret: string;
  workerProvider: "openai-responses" | "codex-subscription";
  workerModel: string;
  workerClassificationCeiling: DataClassification;
  workerRequestTimeoutMs: number;
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

function transitionalSecret(
  env: NodeJS.ProcessEnv,
  currentName: string,
  legacyName: string,
): string {
  const current = env[currentName]?.trim();
  if (current) return current;
  const legacy = env[legacyName]?.trim();
  if (legacy) return legacy;
  throw new Error(`${currentName} is required`);
}

function optionalTransitionalSecret(
  env: NodeJS.ProcessEnv,
  currentName: string,
  legacyName: string,
): string | undefined {
  return env[currentName]?.trim() || env[legacyName]?.trim() || undefined;
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

function boundedInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(raw);
  if (value < minimum || value > maximum) {
    throw new Error(
      `${name} must be from ${String(minimum)} through ${String(maximum)}`,
    );
  }
  return value;
}

function optionalCertificateAuthority(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const encoded = env[name]?.trim();
  if (!encoded) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${name} must be canonical base64`);
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (
    !decoded.startsWith("-----BEGIN CERTIFICATE-----") ||
    !decoded.endsWith("-----END CERTIFICATE-----")
  ) {
    throw new Error(`${name} must decode to a PEM certificate authority`);
  }
  return `${decoded}\n`;
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

function privateFlyServiceUrl(value: string, name: string, port: number): URL {
  const parsed = url(value, name, ["http:", "https:"]);
  if (
    parsed.protocol !== "http:" ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.internal$/.test(parsed.hostname) ||
    parsed.port !== String(port) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      `${name} must be exactly http://<fly-app>.internal:${String(port)}`,
    );
  }
  return parsed;
}

export function readApiEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ApiEnvironment {
  const projectRef = required(env, "VORTON_SUPABASE_PROJECT_REF");
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error(
      "VORTON_SUPABASE_PROJECT_REF must be a 20 character Supabase project ref",
    );
  }
  const supabaseUrl = url(
    required(env, "VORTON_SUPABASE_URL"),
    "VORTON_SUPABASE_URL",
    ["https:"],
  );
  const issuer = url(
    required(env, "VORTON_SUPABASE_JWT_ISSUER"),
    "VORTON_SUPABASE_JWT_ISSUER",
    ["https:"],
  );
  const jwks = url(
    required(env, "VORTON_SUPABASE_JWKS_URL"),
    "VORTON_SUPABASE_JWKS_URL",
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
      "Supabase URL, JWT issuer, and JWKS URL must exactly match VORTON_SUPABASE_PROJECT_REF",
    );
  }
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const secret = transitionalSecret(
    env,
    "VORTON_WORKER_SHARED_SECRET",
    "AUBOS_WORKER_SHARED_SECRET",
  );
  if (secret.length < 32)
    throw new Error(
      "VORTON_WORKER_SHARED_SECRET must contain at least 32 characters",
    );
  const workerUrl = privateFlyServiceUrl(
    required(env, "VORTON_WORKER_URL"),
    "VORTON_WORKER_URL",
    8080,
  );
  const allowedOrigin = url(
    required(env, "VORTON_ALLOWED_ORIGIN"),
    "VORTON_ALLOWED_ORIGIN",
    ["https:"],
  );
  const hindsightUrl = privateFlyServiceUrl(
    required(env, "VORTON_HINDSIGHT_URL"),
    "VORTON_HINDSIGHT_URL",
    8888,
  );
  const databaseContextSigningSecret = transitionalSecret(
    env,
    "VORTON_DATABASE_CONTEXT_SIGNING_SECRET",
    "AUBOS_DATABASE_CONTEXT_SIGNING_SECRET",
  );
  if (databaseContextSigningSecret.length < 32) {
    throw new Error(
      "VORTON_DATABASE_CONTEXT_SIGNING_SECRET must contain at least 32 characters",
    );
  }
  const workerProvider = required(env, "VORTON_WORKER_PROVIDER");
  if (
    workerProvider !== "openai-responses" &&
    workerProvider !== "codex-subscription"
  ) {
    throw new Error(
      "VORTON_WORKER_PROVIDER must be openai-responses or codex-subscription",
    );
  }
  for (const name of ["VORTON_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) {
    if (env[name]?.trim()) {
      throw new Error(
        `The Vorton API must not receive provider billing secret ${name}`,
      );
    }
  }
  return {
    port,
    databaseUrl: transitionalSecret(
      env,
      "VORTON_DATABASE_URL",
      "AUBOS_DATABASE_URL",
    ),
    databaseSsl: exactBoolean(env, "VORTON_DATABASE_SSL", true),
    databaseSslCa: optionalCertificateAuthority(
      {
        VORTON_DATABASE_SSL_CA_BASE64: optionalTransitionalSecret(
          env,
          "VORTON_DATABASE_SSL_CA_BASE64",
          "AUBOS_DATABASE_SSL_CA_BASE64",
        ),
      },
      "VORTON_DATABASE_SSL_CA_BASE64",
    ),
    databaseContextSigningSecret,
    supabaseProjectRef: projectRef,
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ""),
    jwtIssuer: issuer.toString().replace(/\/$/, ""),
    jwtAudience: required(env, "VORTON_SUPABASE_JWT_AUDIENCE"),
    jwtJwksUrl: jwks.toString(),
    workerUrl: workerUrl.toString().replace(/\/$/, ""),
    workerSharedSecret: secret,
    workerProvider,
    workerModel: required(env, "VORTON_WORKER_MODEL"),
    workerClassificationCeiling: dataClassificationSchema.parse(
      env.VORTON_WORKER_CLASSIFICATION_CEILING ?? "internal",
    ),
    workerRequestTimeoutMs: boundedInteger(
      env,
      "VORTON_WORKER_REQUEST_TIMEOUT_MS",
      60_000,
      1_860_000,
    ),
    release:
      env.FLY_IMAGE_REF?.trim() || env.VORTON_RELEASE?.trim() || "development",
    allowedOrigin: allowedOrigin.origin,
    hindsightUrl: hindsightUrl.toString().replace(/\/$/, ""),
    hindsightApiKey: transitionalSecret(
      env,
      "VORTON_HINDSIGHT_API_KEY",
      "AUBOS_HINDSIGHT_API_KEY",
    ),
  };
}
