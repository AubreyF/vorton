function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
    required(env, "VORTON_DATABASE_URL"),
    "VORTON_DATABASE_URL",
  );
  const hindsight = postgres(
    required(env, "HINDSIGHT_API_DATABASE_URL"),
    "HINDSIGHT_API_DATABASE_URL",
  );
  if (authority === hindsight) {
    throw new Error(
      "Vorton authority and Hindsight derived memory must use different databases and credentials",
    );
  }
  if (required(env, "VORTON_DATABASE_CONTEXT_SIGNING_SECRET").length < 32) {
    throw new Error(
      "VORTON_DATABASE_CONTEXT_SIGNING_SECRET must contain at least 32 characters",
    );
  }
  if (
    required(env, "HINDSIGHT_API_TENANT_EXTENSION") !==
    "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension"
  ) {
    throw new Error("Hindsight API key tenant authentication is mandatory");
  }
  required(env, "HINDSIGHT_API_TENANT_API_KEY");
  if (required(env, "HINDSIGHT_API_DATABASE_BACKEND") !== "postgresql") {
    throw new Error("Hindsight must use its external PostgreSQL backend");
  }
  if (required(env, "HINDSIGHT_ENABLE_API") !== "true") {
    throw new Error("Hindsight API must be enabled");
  }
  if (required(env, "HINDSIGHT_ENABLE_CP") !== "false") {
    throw new Error("Hindsight unauthenticated Control Plane must be disabled");
  }
  if (required(env, "HINDSIGHT_API_WORKER_ENABLED") !== "true") {
    throw new Error("Hindsight consolidation worker must be enabled");
  }
  if (required(env, "HINDSIGHT_API_HOST") !== "::") {
    throw new Error("Hindsight must listen on Fly private IPv6 with host ::");
  }
  if (required(env, "HINDSIGHT_API_LLM_PROVIDER") !== "openai-codex") {
    throw new Error(
      "The subscription MVP requires Hindsight LLM provider openai-codex",
    );
  }
  if (required(env, "HINDSIGHT_API_LLM_MODEL") !== "gpt-5.4-mini") {
    throw new Error("Hindsight must use the pinned Codex model gpt-5.4-mini");
  }
  if (required(env, "HINDSIGHT_API_LLM_REASONING_EFFORT") !== "low") {
    throw new Error("Hindsight Codex reasoning effort must be low");
  }
  if (required(env, "HINDSIGHT_API_LLM_MAX_CONCURRENT") !== "1") {
    throw new Error("Hindsight Codex concurrency must be one");
  }
  if (required(env, "HINDSIGHT_API_LLM_STRICT_SCHEMA") !== "true") {
    throw new Error("Hindsight Codex structured output must be strict");
  }
  if (
    required(env, "HINDSIGHT_API_CONSOLIDATION_LLM_PROVIDER") !== "openai-codex"
  ) {
    throw new Error("Hindsight consolidation must explicitly use openai-codex");
  }
  if (
    required(env, "HINDSIGHT_API_CONSOLIDATION_LLM_MODEL") !== "gpt-5.4-mini"
  ) {
    throw new Error("Hindsight consolidation must use the pinned Codex model");
  }
  if (
    required(env, "HINDSIGHT_API_CONSOLIDATION_LLM_REASONING_EFFORT") !== "low"
  ) {
    throw new Error("Hindsight consolidation reasoning effort must be low");
  }
  if (required(env, "HINDSIGHT_API_CONSOLIDATION_LLM_MAX_CONCURRENT") !== "1") {
    throw new Error("Hindsight consolidation concurrency must be one");
  }
  if (required(env, "HINDSIGHT_API_CONSOLIDATION_LLM_PARALLELISM") !== "1") {
    throw new Error("Hindsight consolidation parallelism must be one");
  }
  if (required(env, "HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP") !== "false") {
    throw new Error("Hindsight runtime migrations must be disabled");
  }
  if (required(env, "HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH") !== "true") {
    throw new Error("Hindsight bank LLM health must be enabled");
  }
  const hindsightCodexHome = required(env, "CODEX_HOME");
  if (!hindsightCodexHome.startsWith("/")) {
    throw new Error("Hindsight CODEX_HOME must be an absolute path");
  }
  for (const name of [
    "HINDSIGHT_API_RETAIN_LLM_PROVIDER",
    "HINDSIGHT_API_RETAIN_LLM_MODEL",
    "HINDSIGHT_API_RETAIN_LLM_BASE_URL",
    "HINDSIGHT_API_REFLECT_LLM_PROVIDER",
    "HINDSIGHT_API_REFLECT_LLM_MODEL",
    "HINDSIGHT_API_REFLECT_LLM_BASE_URL",
    "HINDSIGHT_API_LLM_BASE_URL",
    "HINDSIGHT_API_CONSOLIDATION_LLM_BASE_URL",
  ] as const) {
    if (env[name]?.trim()) {
      throw new Error(
        "The Hindsight Codex subscription lane must not override operation routing",
      );
    }
  }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("HINDSIGHT_") || !value?.trim()) continue;
    if (
      name === "HINDSIGHT_API_DATABASE_URL" ||
      name === "HINDSIGHT_API_TENANT_API_KEY"
    ) {
      continue;
    }
    if (
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|SERVICE_ACCOUNT|DEFAULT_HEADERS)/.test(
        name,
      )
    ) {
      throw new Error(
        `The Hindsight Codex subscription lane must not receive credential-bearing variable ${name}`,
      );
    }
    if (
      /(?:^|_)LLM_(?:STRATEGY|LITELLMROUTER_CONFIG)$/.test(name) ||
      /(?:^|_)LLM_\d+_/.test(name)
    ) {
      throw new Error(
        `The Hindsight Codex subscription lane must not configure indexed or multi-LLM routing via ${name}`,
      );
    }
  }
  if (required(env, "HINDSIGHT_API_EMBEDDINGS_PROVIDER") !== "local") {
    throw new Error("The full Hindsight image must use local embeddings");
  }
  if (
    required(env, "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL") !==
    "BAAI/bge-small-en-v1.5"
  ) {
    throw new Error(
      "The subscription MVP requires the pinned local BGE embedder",
    );
  }
  if (required(env, "HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU") !== "true") {
    throw new Error("Local Hindsight embeddings must be forced to CPU");
  }
  if (env.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY?.trim()) {
    throw new Error(
      "The Hindsight Codex MVP must not receive an embeddings API key",
    );
  }
  if (required(env, "HINDSIGHT_API_RERANKER_PROVIDER") !== "rrf") {
    throw new Error("The lean MVP requires the dependency-free rrf reranker");
  }
  if (required(env, "HINDSIGHT_API_ENABLE_OBSERVATIONS") !== "true") {
    throw new Error(
      "Hindsight native observation consolidation must be enabled in the MVP",
    );
  }
  if (required(env, "HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION") !== "true") {
    throw new Error("Hindsight automatic consolidation must be enabled");
  }
  const workerId = required(env, "HINDSIGHT_API_WORKER_ID");
  if (workerId.includes("replace-") || workerId.length < 8)
    throw new Error(
      "HINDSIGHT_API_WORKER_ID must be a stable deployment identity",
    );
  if (required(env, "HINDSIGHT_API_MCP_ENABLED") !== "false")
    throw new Error("Hindsight MCP must remain disabled in the MVP runtime");
  const workerProvider = required(env, "VORTON_WORKER_PROVIDER");
  const workerModel = required(env, "VORTON_WORKER_MODEL");
  const workerRequestTimeoutMs = boundedInteger(
    env,
    "VORTON_WORKER_REQUEST_TIMEOUT_MS",
    60_000,
    1_860_000,
  );
  if (workerProvider === "openai-responses") {
    const openAiModel = required(env, "VORTON_OPENAI_MODEL");
    if (workerModel !== openAiModel) {
      throw new Error(
        "VORTON_WORKER_MODEL must exactly match VORTON_OPENAI_MODEL",
      );
    }
    const store = required(env, "VORTON_OPENAI_STORE_RESPONSES");
    if (store !== "false" && store !== "true")
      throw new Error(
        "VORTON_OPENAI_STORE_RESPONSES must be exactly true or false",
      );
  } else if (workerProvider === "codex-subscription") {
    if (workerModel !== required(env, "VORTON_CODEX_MODEL")) {
      throw new Error(
        "VORTON_WORKER_MODEL must exactly match VORTON_CODEX_MODEL",
      );
    }
    if (
      required(env, "VORTON_WORKER_CLASSIFICATION_CEILING") !==
      required(env, "VORTON_CODEX_CLASSIFICATION_CEILING")
    ) {
      throw new Error(
        "VORTON_WORKER_CLASSIFICATION_CEILING must exactly match VORTON_CODEX_CLASSIFICATION_CEILING",
      );
    }
    if (
      !["low", "medium", "high", "xhigh", "max", "ultra"].includes(
        required(env, "VORTON_CODEX_REASONING_EFFORT"),
      )
    ) {
      throw new Error("VORTON_CODEX_REASONING_EFFORT is not supported");
    }
    const executionTimeoutMs = boundedInteger(
      env,
      "VORTON_CODEX_EXECUTION_TIMEOUT_MS",
      60_000,
      1_800_000,
    );
    const requestMarginMs = workerRequestTimeoutMs - executionTimeoutMs;
    if (requestMarginMs < 10_000 || requestMarginMs > 60_000) {
      throw new Error(
        "VORTON_WORKER_REQUEST_TIMEOUT_MS must exceed VORTON_CODEX_EXECUTION_TIMEOUT_MS by 10000 through 60000 milliseconds",
      );
    }
    for (const name of ["VORTON_CODEX_HOME", "VORTON_CODEX_WORKDIR"] as const) {
      if (!required(env, name).startsWith("/")) {
        throw new Error(`${name} must be an absolute path`);
      }
    }
    if (hindsightCodexHome === required(env, "VORTON_CODEX_HOME")) {
      throw new Error(
        "Hindsight and the executive worker must use separate CODEX_HOME auth caches",
      );
    }
    for (const name of ["VORTON_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) {
      if (env[name]?.trim()) {
        throw new Error(
          `The subscription runtime must not receive API billing secret ${name}`,
        );
      }
    }
  } else {
    throw new Error(
      "VORTON_WORKER_PROVIDER must be openai-responses or codex-subscription",
    );
  }
  const origin = new URL(required(env, "VORTON_ALLOWED_ORIGIN"));
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.VORTON_ALLOWED_ORIGIN
  ) {
    throw new Error("VORTON_ALLOWED_ORIGIN must be one exact HTTPS origin");
  }
}

if (process.argv[1]?.endsWith("validate-environment.ts")) {
  validateRuntimeEnvironment(process.env);
  console.log("Vorton runtime environment is valid");
}
