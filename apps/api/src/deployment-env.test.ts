import { describe, expect, it } from "vitest";

import { validateRuntimeEnvironment } from "../../../deploy/fly/runtime/validate-environment.js";

const valid = {
  AUBOS_DATABASE_URL:
    "postgresql://authority:synthetic@authority.example/aubos",
  HINDSIGHT_API_DATABASE_URL:
    "postgresql://memory:synthetic@memory.example/hindsight",
  HINDSIGHT_API_TENANT_EXTENSION:
    "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
  HINDSIGHT_API_TENANT_API_KEY: "synthetic-tenant-key",
  HINDSIGHT_API_LLM_API_KEY: "synthetic-model-key",
  HINDSIGHT_API_LLM_PROVIDER: "openai",
  HINDSIGHT_API_LLM_MODEL: "explicit-model",
  HINDSIGHT_API_EMBEDDINGS_PROVIDER: "openai",
  HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: "text-embedding-3-small",
  HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: "synthetic-embedding-key",
  HINDSIGHT_API_RERANKER_PROVIDER: "rrf",
  HINDSIGHT_API_WORKER_ID: "installation-memory-1",
  HINDSIGHT_API_MCP_ENABLED: "false",
  AUBOS_WORKER_PROVIDER: "openai-responses",
  AUBOS_WORKER_MODEL: "explicit-model",
  AUBOS_OPENAI_MODEL: "explicit-model",
  AUBOS_OPENAI_STORE_RESPONSES: "false",
  AUBOS_ALLOWED_ORIGIN: "https://control.aubos.example",
};

describe("combined deployment environment", () => {
  it("accepts separate authoritative and derived databases", () => {
    expect(() => validateRuntimeEnvironment(valid)).not.toThrow();
  });

  it("rejects a shared authority and Hindsight database", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        HINDSIGHT_API_DATABASE_URL: valid.AUBOS_DATABASE_URL,
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

  it("requires the API worker boundary and OpenAI worker to use one exact model", () => {
    expect(() =>
      validateRuntimeEnvironment({
        ...valid,
        AUBOS_OPENAI_MODEL: "different-model",
      }),
    ).toThrow("must exactly match");
  });
});
