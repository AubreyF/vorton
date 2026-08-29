import { describe, expect, it } from "vitest";

import { readWorkerEnvironment } from "./env.js";

const base = {
  AUBOS_WORKER_SHARED_SECRET: "s".repeat(32),
  AUBOS_WORKER_PROVIDER: "openai-responses",
  AUBOS_OPENAI_MODEL: "explicit-synthetic-model",
  AUBOS_OPENAI_API_KEY: "synthetic-key-not-used",
};

const codex = {
  AUBOS_WORKER_SHARED_SECRET: "s".repeat(32),
  AUBOS_WORKER_PROVIDER: "codex-subscription",
  AUBOS_CODEX_MODEL: "explicit-synthetic-model",
  AUBOS_CODEX_HOME: "/data/codex",
  AUBOS_CODEX_WORKDIR: "/var/empty/aubos-worker",
  AUBOS_CODEX_REASONING_EFFORT: "high",
  AUBOS_CODEX_EXECUTION_TIMEOUT_MS: "900000",
};

describe("worker environment", () => {
  it("requires an explicitly supported provider and model", () => {
    expect(() =>
      readWorkerEnvironment({ ...base, AUBOS_WORKER_PROVIDER: "" }),
    ).toThrow("AUBOS_WORKER_PROVIDER is required");
    expect(() =>
      readWorkerEnvironment({
        ...base,
        AUBOS_WORKER_PROVIDER: "implicit-default",
      }),
    ).toThrow("must be explicitly set");
    expect(() =>
      readWorkerEnvironment({ ...base, AUBOS_OPENAI_MODEL: "" }),
    ).toThrow("AUBOS_OPENAI_MODEL is required");
  });

  it("keeps provider response storage off by default", () => {
    expect(readWorkerEnvironment(base).storeResponses).toBe(false);
    expect(() =>
      readWorkerEnvironment({ ...base, AUBOS_OPENAI_STORE_RESPONSES: "yes" }),
    ).toThrow("exactly true or false");
  });

  it("accepts a fully explicit ChatGPT subscription worker", () => {
    expect(readWorkerEnvironment(codex)).toMatchObject({
      provider: "codex-subscription",
      model: "explicit-synthetic-model",
      codexHome: "/data/codex",
      codexPath: "codex",
      codexWorkdir: "/var/empty/aubos-worker",
      codexReasoningEffort: "high",
      codexExecutionTimeoutMs: 900000,
      storeResponses: false,
      classificationCeiling: "internal",
    });
  });

  it("fails closed on ambiguous subscription auth configuration", () => {
    expect(() =>
      readWorkerEnvironment({ ...codex, AUBOS_CODEX_HOME: "relative/path" }),
    ).toThrow("AUBOS_CODEX_HOME must be an absolute path");
    expect(() =>
      readWorkerEnvironment({
        ...codex,
        AUBOS_CODEX_REASONING_EFFORT: "maximum-ish",
      }),
    ).toThrow("AUBOS_CODEX_REASONING_EFFORT must be");
    expect(() =>
      readWorkerEnvironment({
        ...codex,
        AUBOS_CODEX_EXECUTION_TIMEOUT_MS: "1800001",
      }),
    ).toThrow("must be from 60000 through 1800000");
    expect(() =>
      readWorkerEnvironment({
        ...codex,
        AUBOS_CODEX_EXECUTION_TIMEOUT_MS: "900000.5",
      }),
    ).toThrow("must be an integer");
    for (const name of ["AUBOS_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) {
      expect(() =>
        readWorkerEnvironment({ ...codex, [name]: "must-not-be-present" }),
      ).toThrow(`must not receive API billing secret ${name}`);
    }
  });
});
