function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function postgres(value: string, name: string): string {
  if (value.startsWith("pg0:"))
    throw new Error(`${name} must use external Postgres, not embedded pg0`);
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must be a PostgreSQL URL`);
  }
  return parsed.toString();
}

export function validateRuntimeEnvironment(env: NodeJS.ProcessEnv): void {
  const authority = postgres(
    required(env, "AUBOS_DATABASE_URL"),
    "AUBOS_DATABASE_URL",
  );
  const hindsight = postgres(
    required(env, "HINDSIGHT_API_DATABASE_URL"),
    "HINDSIGHT_API_DATABASE_URL",
  );
  if (authority === hindsight) {
    throw new Error(
      "AubOS authority and Hindsight derived memory must use different databases and credentials",
    );
  }
  if (
    required(env, "HINDSIGHT_API_TENANT_EXTENSION") !==
    "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension"
  ) {
    throw new Error("Hindsight API key tenant authentication is mandatory");
  }
  required(env, "HINDSIGHT_API_TENANT_API_KEY");
  required(env, "HINDSIGHT_API_LLM_API_KEY");
  required(env, "HINDSIGHT_API_LLM_PROVIDER");
  required(env, "HINDSIGHT_API_LLM_MODEL");
  const embeddingsProvider = required(env, "HINDSIGHT_API_EMBEDDINGS_PROVIDER");
  if (embeddingsProvider === "local" || embeddingsProvider === "onnx") {
    throw new Error(
      "The slim Hindsight image requires an external embeddings provider",
    );
  }
  required(env, "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL");
  required(env, "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY");
  if (required(env, "HINDSIGHT_API_RERANKER_PROVIDER") !== "rrf") {
    throw new Error("The lean MVP requires the dependency-free rrf reranker");
  }
  const workerId = required(env, "HINDSIGHT_API_WORKER_ID");
  if (workerId.includes("replace-") || workerId.length < 8)
    throw new Error(
      "HINDSIGHT_API_WORKER_ID must be a stable deployment identity",
    );
  if (required(env, "HINDSIGHT_API_MCP_ENABLED") !== "false")
    throw new Error("Hindsight MCP must remain disabled in the MVP runtime");
  required(env, "AUBOS_WORKER_PROVIDER");
  const workerModel = required(env, "AUBOS_WORKER_MODEL");
  const openAiModel = required(env, "AUBOS_OPENAI_MODEL");
  if (workerModel !== openAiModel) {
    throw new Error("AUBOS_WORKER_MODEL must exactly match AUBOS_OPENAI_MODEL");
  }
  const store = required(env, "AUBOS_OPENAI_STORE_RESPONSES");
  if (store !== "false" && store !== "true")
    throw new Error(
      "AUBOS_OPENAI_STORE_RESPONSES must be exactly true or false",
    );
  const origin = new URL(required(env, "AUBOS_ALLOWED_ORIGIN"));
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.AUBOS_ALLOWED_ORIGIN
  ) {
    throw new Error("AUBOS_ALLOWED_ORIGIN must be one exact HTTPS origin");
  }
}

if (process.argv[1]?.endsWith("validate-environment.ts")) {
  validateRuntimeEnvironment(process.env);
  console.log("AubOS runtime environment is valid");
}
