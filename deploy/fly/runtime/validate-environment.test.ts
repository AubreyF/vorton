import { describe, expect, it } from "vitest";

import { validateRuntimeEnvironment } from "./validate-environment.js";

function environment(): NodeJS.ProcessEnv {
  return {
    AUBOS_DATABASE_URL:
      "postgresql://aubos_runtime:synthetic@authority.example.test/aubos",
    AUBOS_DATABASE_CONTEXT_SIGNING_SECRET: "c".repeat(32),
    HINDSIGHT_API_DATABASE_URL:
      "postgresql://hindsight:synthetic@memory.example.test/hindsight",
    HINDSIGHT_API_DATABASE_BACKEND: "postgresql",
    HINDSIGHT_ENABLE_API: "true",
    HINDSIGHT_ENABLE_CP: "false",
    HINDSIGHT_API_HOST: "::",
    AUBOS_ALLOWED_ORIGIN: "https://control.example.test",
    AUBOS_WORKER_PROVIDER: "codex-subscription",
    AUBOS_WORKER_MODEL: "explicit-model",
    AUBOS_WORKER_CLASSIFICATION_CEILING: "internal",
    AUBOS_WORKER_REQUEST_TIMEOUT_MS: "930000",
    AUBOS_CODEX_MODEL: "explicit-model",
    AUBOS_CODEX_CLASSIFICATION_CEILING: "internal",
    AUBOS_CODEX_REASONING_EFFORT: "high",
    AUBOS_CODEX_EXECUTION_TIMEOUT_MS: "900000",
    AUBOS_CODEX_HOME: "/data/codex",
    AUBOS_CODEX_WORKDIR: "/var/empty/aubos-worker",
    HINDSIGHT_API_TENANT_EXTENSION:
      "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    HINDSIGHT_API_TENANT_API_KEY: "synthetic-tenant-key",
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

  it("rejects API billing and ambiguous paths for a subscription worker", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_OPENAI_API_KEY: "must-not-be-present",
      }),
    ).toThrow("must not receive API billing secret AUBOS_OPENAI_API_KEY");
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        OPENAI_API_KEY: "must-not-be-present",
      }),
    ).toThrow("must not receive API billing secret OPENAI_API_KEY");
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_CODEX_HOME: "relative",
      }),
    ).toThrow("must be an absolute path");
  });

  it("requires Hindsight to listen on Fly private IPv6", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        HINDSIGHT_API_HOST: "0.0.0.0",
      }),
    ).toThrow("Fly private IPv6");
  });

  it("requires a bounded API margin beyond Codex execution", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_WORKER_REQUEST_TIMEOUT_MS: "900000",
      }),
    ).toThrow("must exceed AUBOS_CODEX_EXECUTION_TIMEOUT_MS");
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_WORKER_REQUEST_TIMEOUT_MS: "960001",
      }),
    ).toThrow("must exceed AUBOS_CODEX_EXECUTION_TIMEOUT_MS");
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_CODEX_EXECUTION_TIMEOUT_MS: "1800001",
        AUBOS_WORKER_REQUEST_TIMEOUT_MS: "1830001",
      }),
    ).toThrow("must be from 60000 through 1800000");
  });

  it("requires the API and subscription worker classification ceilings to match", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        AUBOS_CODEX_CLASSIFICATION_CEILING: "restricted",
      }),
    ).toThrow(
      "AUBOS_WORKER_CLASSIFICATION_CEILING must exactly match AUBOS_CODEX_CLASSIFICATION_CEILING",
    );
  });

  it.each([
    ["HINDSIGHT_ENABLE_API", "false", "API must be enabled"],
    [
      "HINDSIGHT_ENABLE_CP",
      "true",
      "unauthenticated Control Plane must be disabled",
    ],
    [
      "HINDSIGHT_API_WORKER_ENABLED",
      "false",
      "consolidation worker must be enabled",
    ],
    ["HINDSIGHT_API_DATABASE_BACKEND", "postgres", "PostgreSQL backend"],
    ["HINDSIGHT_API_LLM_PROVIDER", "openai", "provider openai-codex"],
    ["HINDSIGHT_API_LLM_MODEL", "gpt-other", "pinned Codex model"],
    ["HINDSIGHT_API_LLM_REASONING_EFFORT", "high", "effort must be low"],
    ["HINDSIGHT_API_LLM_MAX_CONCURRENT", "2", "concurrency must be one"],
    ["HINDSIGHT_API_LLM_STRICT_SCHEMA", "false", "must be strict"],
    [
      "HINDSIGHT_API_CONSOLIDATION_LLM_PROVIDER",
      "none",
      "explicitly use openai-codex",
    ],
    [
      "HINDSIGHT_API_CONSOLIDATION_LLM_MODEL",
      "gpt-other",
      "pinned Codex model",
    ],
    [
      "HINDSIGHT_API_CONSOLIDATION_LLM_PARALLELISM",
      "2",
      "parallelism must be one",
    ],
    [
      "HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP",
      "true",
      "migrations must be disabled",
    ],
    ["HINDSIGHT_API_ENABLE_BANK_LLM_HEALTH", "false", "health must be enabled"],
    ["HINDSIGHT_API_EMBEDDINGS_PROVIDER", "openai", "local embeddings"],
    [
      "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL",
      "sentence-transformers/all-MiniLM-L6-v2",
      "pinned local BGE embedder",
    ],
    ["HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU", "false", "forced to CPU"],
    ["HINDSIGHT_API_RERANKER_PROVIDER", "local", "rrf reranker"],
    ["HINDSIGHT_API_ENABLE_OBSERVATIONS", "false", "must be enabled"],
    ["HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION", "false", "must be enabled"],
  ])(
    "rejects a drifted Hindsight subscription setting %s",
    (name, value, message) => {
      expect(() =>
        validateRuntimeEnvironment({ ...environment(), [name]: value }),
      ).toThrow(message);
    },
  );

  it.each([
    "HINDSIGHT_API_LLM_API_KEY",
    "HINDSIGHT_API_CONSOLIDATION_LLM_API_KEY",
    "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
    "HINDSIGHT_API_LLM_DEFAULT_HEADERS",
  ])("rejects an unnecessary provider secret %s", (name) => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        [name]: "unexpected-key",
      }),
    ).toThrow("must not receive");
  });

  it.each([
    "HINDSIGHT_API_RETAIN_LLM_PROVIDER",
    "HINDSIGHT_API_RETAIN_LLM_MODEL",
    "HINDSIGHT_API_RETAIN_LLM_BASE_URL",
    "HINDSIGHT_API_REFLECT_LLM_PROVIDER",
    "HINDSIGHT_API_REFLECT_LLM_MODEL",
    "HINDSIGHT_API_REFLECT_LLM_BASE_URL",
  ])("rejects an operation-specific routing override %s", (name) => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        [name]: "unexpected-override",
      }),
    ).toThrow("must not override operation routing");
  });

  it.each([
    "HINDSIGHT_API_LLM_STRATEGY",
    "HINDSIGHT_API_CONSOLIDATION_LLM_STRATEGY",
    "HINDSIGHT_API_LLM_1_PROVIDER",
  ])("rejects multi-LLM routing configuration %s", (name) => {
    expect(() =>
      validateRuntimeEnvironment({ ...environment(), [name]: "unexpected" }),
    ).toThrow("must not configure indexed or multi-LLM routing");
  });

  it("requires a dedicated absolute Hindsight Codex auth cache", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        CODEX_HOME: "relative",
      }),
    ).toThrow("Hindsight CODEX_HOME must be an absolute path");
    expect(() =>
      validateRuntimeEnvironment({
        ...environment(),
        CODEX_HOME: environment().AUBOS_CODEX_HOME,
      }),
    ).toThrow("separate CODEX_HOME auth caches");
  });
});
