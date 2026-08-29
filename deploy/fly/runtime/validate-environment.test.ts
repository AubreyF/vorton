import { describe, expect, it } from "vitest";

import { validateRuntimeEnvironment } from "./validate-environment.js";

function environment(): NodeJS.ProcessEnv {
  return {
    AUBOS_DATABASE_URL:
      "postgresql://aubos_runtime:synthetic@authority.example.test/aubos",
    AUBOS_DATABASE_CONTEXT_SIGNING_SECRET: "c".repeat(32),
    HINDSIGHT_API_DATABASE_URL:
      "postgresql://hindsight:synthetic@memory.example.test/hindsight",
    AUBOS_ALLOWED_ORIGIN: "https://control.example.test",
    AUBOS_WORKER_PROVIDER: "openai-responses",
    AUBOS_WORKER_MODEL: "explicit-model",
    AUBOS_OPENAI_MODEL: "explicit-model",
    AUBOS_OPENAI_STORE_RESPONSES: "false",
    HINDSIGHT_API_TENANT_EXTENSION:
      "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    HINDSIGHT_API_TENANT_API_KEY: "synthetic-tenant-key",
    HINDSIGHT_API_LLM_API_KEY: "synthetic-llm-key",
    HINDSIGHT_API_LLM_PROVIDER: "openai",
    HINDSIGHT_API_LLM_MODEL: "explicit-memory-model",
    HINDSIGHT_API_EMBEDDINGS_PROVIDER: "openai",
    HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: "explicit-embedding-model",
    HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: "synthetic-embedding-key",
    HINDSIGHT_API_RERANKER_PROVIDER: "rrf",
    HINDSIGHT_API_WORKER_ID: "stable-worker-1",
    HINDSIGHT_API_MCP_ENABLED: "false",
  };
}

describe("Fly runtime environment", () => {
  it("accepts the isolated authority and memory configuration", () => {
    expect(() => validateRuntimeEnvironment(environment())).not.toThrow();
  });

  it("requires a separate context-signing secret", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_DATABASE_CONTEXT_SIGNING_SECRET: "short",
      }),
    ).toThrow("at least 32 characters");
  });
});
