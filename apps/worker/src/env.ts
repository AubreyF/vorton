import {
  dataClassificationSchema,
  type DataClassification,
} from "@aubos/contracts";

export interface WorkerEnvironment {
  port: number;
  sharedSecret: string;
  provider: "openai-responses";
  model: string;
  openAiApiKey: string;
  openAiBaseUrl: string;
  storeResponses: boolean;
  classificationCeiling: DataClassification;
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

export function readWorkerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): WorkerEnvironment {
  const port = Number(env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const secret = required(env, "AUBOS_WORKER_SHARED_SECRET");
  if (secret.length < 32)
    throw new Error(
      "AUBOS_WORKER_SHARED_SECRET must contain at least 32 characters",
    );
  const provider = required(env, "AUBOS_WORKER_PROVIDER");
  if (provider !== "openai-responses") {
    throw new Error(
      "AUBOS_WORKER_PROVIDER must be explicitly set to openai-responses",
    );
  }
  const baseUrl = new URL(
    env.AUBOS_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  );
  if (baseUrl.protocol !== "https:")
    throw new Error("AUBOS_OPENAI_BASE_URL must use https");
  return {
    port,
    sharedSecret: secret,
    provider,
    model: required(env, "AUBOS_OPENAI_MODEL"),
    openAiApiKey: required(env, "AUBOS_OPENAI_API_KEY"),
    openAiBaseUrl: baseUrl.toString().replace(/\/$/, ""),
    storeResponses: exactBoolean(env, "AUBOS_OPENAI_STORE_RESPONSES", false),
    classificationCeiling: dataClassificationSchema.parse(
      env.AUBOS_OPENAI_CLASSIFICATION_CEILING ?? "internal",
    ),
    release:
      env.FLY_IMAGE_REF?.trim() || env.AUBOS_RELEASE?.trim() || "development",
  };
}
