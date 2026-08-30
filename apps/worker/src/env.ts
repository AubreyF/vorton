import {
  dataClassificationSchema,
  type DataClassification,
} from "@vorton/contracts";

export interface WorkerEnvironment {
  port: number;
  sharedSecret: string;
  provider: "openai-responses" | "codex-subscription";
  model: string;
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  storeResponses: boolean;
  classificationCeiling: DataClassification;
  codexHome?: string;
  codexPath?: string;
  codexWorkdir?: string;
  codexAuthJson?: string;
  codexExecutionTimeoutMs?: number;
  codexReasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  release: string;
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

export function readWorkerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): WorkerEnvironment {
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const secret = required(env, "VORTON_WORKER_SHARED_SECRET");
  if (secret.length < 32)
    throw new Error(
      "VORTON_WORKER_SHARED_SECRET must contain at least 32 characters",
    );
  const provider = required(env, "VORTON_WORKER_PROVIDER");
  if (provider !== "openai-responses" && provider !== "codex-subscription") {
    throw new Error(
      "VORTON_WORKER_PROVIDER must be explicitly set to openai-responses or codex-subscription",
    );
  }
  const common = {
    port,
    sharedSecret: secret,
    provider,
    release:
      env.FLY_IMAGE_REF?.trim() || env.VORTON_RELEASE?.trim() || "development",
  };
  if (provider === "openai-responses") {
    const baseUrl = new URL(
      env.VORTON_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    );
    if (baseUrl.protocol !== "https:")
      throw new Error("VORTON_OPENAI_BASE_URL must use https");
    return {
      ...common,
      provider,
      model: required(env, "VORTON_OPENAI_MODEL"),
      openAiApiKey: required(env, "VORTON_OPENAI_API_KEY"),
      openAiBaseUrl: baseUrl.toString().replace(/\/$/, ""),
      storeResponses: exactBoolean(env, "VORTON_OPENAI_STORE_RESPONSES", false),
      classificationCeiling: dataClassificationSchema.parse(
        env.VORTON_OPENAI_CLASSIFICATION_CEILING ?? "internal",
      ),
    };
  }

  const codexHome = required(env, "VORTON_CODEX_HOME");
  if (!codexHome.startsWith("/")) {
    throw new Error("VORTON_CODEX_HOME must be an absolute path");
  }
  const codexWorkdir = required(env, "VORTON_CODEX_WORKDIR");
  if (!codexWorkdir.startsWith("/")) {
    throw new Error("VORTON_CODEX_WORKDIR must be an absolute path");
  }
  const reasoningEffort = required(env, "VORTON_CODEX_REASONING_EFFORT");
  if (
    !["low", "medium", "high", "xhigh", "max", "ultra"].includes(
      reasoningEffort,
    )
  ) {
    throw new Error(
      "VORTON_CODEX_REASONING_EFFORT must be low, medium, high, xhigh, max, or ultra",
    );
  }
  for (const name of ["VORTON_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) {
    if (env[name]?.trim()) {
      throw new Error(
        `A Codex subscription worker must not receive API billing secret ${name}`,
      );
    }
  }
  return {
    ...common,
    provider,
    model: required(env, "VORTON_CODEX_MODEL"),
    storeResponses: false,
    classificationCeiling: dataClassificationSchema.parse(
      env.VORTON_CODEX_CLASSIFICATION_CEILING ?? "internal",
    ),
    codexHome,
    codexPath: env.VORTON_CODEX_PATH?.trim() || "codex",
    codexWorkdir,
    codexAuthJson: env.VORTON_CODEX_AUTH_JSON,
    codexExecutionTimeoutMs: boundedInteger(
      env,
      "VORTON_CODEX_EXECUTION_TIMEOUT_MS",
      60_000,
      1_800_000,
    ),
    codexReasoningEffort: reasoningEffort as
      "low" | "medium" | "high" | "xhigh" | "max" | "ultra",
  };
}
