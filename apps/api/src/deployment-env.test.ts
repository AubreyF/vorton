import { describe, expect, it } from "vitest";

import { validateRuntimeEnvironment } from "../../../deploy/fly/runtime/validate-environment.js";

const valid = {
  VORTON_DATABASE_URL:
    "postgresql://authority:synthetic@authority.example/vorton",
  VORTON_DATABASE_CONTEXT_SIGNING_SECRET: "c".repeat(32),
  HINDSIGHT_API_DATABASE_URL:
    "postgresql://memory:synthetic@memory.example/hindsight",
  HINDSIGHT_API_TENANT_EXTENSION:
    "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
  HINDSIGHT_API_TENANT_API_KEY: "synthetic-tenant-key",
  HINDSIGHT_API_DATABASE_BACKEND: "postgresql",
  HINDSIGHT_ENABLE_API: "true",
  HINDSIGHT_ENABLE_CP: "false",
  HINDSIGHT_API_HOST: "::",
  HINDSIGHT_API_LLM_PROVIDER: "openai-codex",
  HINDSIGHT_API_LLM_MODEL: "gpt-5.4-mini",
  HINDSIGHT_API_LLM_REASONING_EFFORT: "low",
  HINDSIGHT_API_LLM_MAX_CONCURRENT: "1",
  HINDSIGHT_API_LLM_STRICT_SCHEMA: "true",
  HINDSIGHT_API_CONSOLIDATION_LLM_PROVIDER: "openai-codex",
  HINDSIGHT_API_CONSOLIDATION_LLM_MODEL: "gpt-5.4-mini",
  HINDSIGHT_API_CONSOLIDATION_LLM_REASONING_EFFORT: "low",
  HINDSIGHT_API_CONSOLIDATION_LLM_MAX_CONCURRENT: "1",
  HINDSIGHT_API_CONSOLIDATION_LLM_PARALLELISM: "1",
  HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP: "false",
  HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH: "true",
  CODEX_HOME: "/data/hindsight-codex",
  HINDSIGHT_API_EMBEDDINGS_PROVIDER: "local",
  HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL: "BAAI/bge-small-en-v1.5",
  HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU: "true",
  HINDSIGHT_API_RERANKER_PROVIDER: "rrf",
  HINDSIGHT_API_ENABLE_OBSERVATIONS: "true",
  HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION: "true",
  HINDSIGHT_API_WORKER_ENABLED: "true",
  HINDSIGHT_API_WORKER_ID: "installation-memory-1",
  HINDSIGHT_API_MCP_ENABLED: "false",
  VORTON_WORKER_PROVIDER: "codex-subscription",
  VORTON_WORKER_MODEL: "explicit-model",
  VORTON_WORKER_CLASSIFICATION_CEILING: "internal",
  VORTON_WORKER_REQUEST_TIMEOUT_MS: "930000",
  VORTON_CODEX_MODEL: "explicit-model",
  VORTON_CODEX_CLASSIFICATION_CEILING: "internal",
  VORTON_CODEX_REASONING_EFFORT: "high",
  VORTON_CODEX_EXECUTION_TIMEOUT_MS: "900000",
  VORTON_CODEX_HOME: "/data/codex",
  VORTON_CODEX_WORKDIR: "/var/empty/vorton-worker",
  VORTON_ALLOWED_ORIGIN: "https://control.vorton.example",
};

describe("combined deployment environment", () => {
  it("accepts separate authoritative and derived databases", () => {
    expect(() => validateRuntimeEnvironment(valid)).not.toThrow();
  });

  it("rejects a shared authority and Hindsight database", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        HINDSIGHT_API_DATABASE_URL: valid.VORTON_DATABASE_URL,
      }),
    ).toThrow("different databases");
  });

  it("requires Hindsight API auth and disables MCP", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        HINDSIGHT_API_TENANT_EXTENSION: "",
      }),
    ).toThrow("required");
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        HINDSIGHT_API_MCP_ENABLED: "true",
      }),
    ).toThrow("must remain disabled");
  });

  it("requires the API and Codex worker boundary to use one exact model", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        VORTON_CODEX_MODEL: "different-model",
      }),
    ).toThrow("must exactly match");
  });

  it("requires the API request timeout to outlive Codex execution", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        VORTON_WORKER_REQUEST_TIMEOUT_MS: "900000",
      }),
    ).toThrow("must exceed VORTON_CODEX_EXECUTION_TIMEOUT_MS");
  });
});
