import { describe, expect, it } from "vitest";

import { readWorkerEnvironment } from "./env.js";

const base = {
  VORTON_WORKER_SHARED_SECRET: "s".repeat(32),
  VORTON_WORKER_PROVIDER: "openai-responses",
  VORTON_OPENAI_MODEL: "explicit-synthetic-model",
  VORTON_OPENAI_API_KEY: "synthetic-key-not-used",
};

const codex = {
  VORTON_WORKER_SHARED_SECRET: "s".repeat(32),
  VORTON_WORKER_PROVIDER: "codex-subscription",
  VORTON_CODEX_MODEL: "explicit-synthetic-model",
  VORTON_CODEX_HOME: "/data/codex",
  VORTON_CODEX_WORKDIR: "/var/empty/vorton-worker",
  VORTON_CODEX_REASONING_EFFORT: "high",
  VORTON_CODEX_EXECUTION_TIMEOUT_MS: "900000",
};

describe("worker environment", () => {
  it("accepts only the isolated legacy shared secret during transition", () => {
    expect(
      readWorkerEnvironment({
        ...codex,
        VORTON_WORKER_SHARED_SECRET: undefined,
        AUBOS_WORKER_SHARED_SECRET: codex.VORTON_WORKER_SHARED_SECRET,
      }).sharedSecret,
    ).toBe(codex.VORTON_WORKER_SHARED_SECRET);
    expect(
      readWorkerEnvironment({
        ...codex,
        VORTON_WORKER_SHARED_SECRET: "v".repeat(32),
        AUBOS_WORKER_SHARED_SECRET: "a".repeat(32),
      }).sharedSecret,
    ).toBe("v".repeat(32));
  });

  it("requires an explicitly supported provider and model", () => {
    expect(() =>
      readWorkerEnvironment({ ...base, VORTON_WORKER_PROVIDER: "" }),
    ).toThrow("VORTON_WORKER_PROVIDER is required");
    expect(() =>
      readWorkerEnvironment({
        ...base,
        VORTON_WORKER_PROVIDER: "implicit-default",
      }),
    ).toThrow("must be explicitly set");
    expect(() =>
      readWorkerEnvironment({ ...base, VORTON_OPENAI_MODEL: "" }),
    ).toThrow("VORTON_OPENAI_MODEL is required");
  });

  it("keeps provider response storage off by default", () => {
    expect(readWorkerEnvironment(base).storeResponses).toBe(false);
    expect(() =>
      readWorkerEnvironment({ ...base, VORTON_OPENAI_STORE_RESPONSES: "yes" }),
    ).toThrow("exactly true or false");
  });

  it("accepts a fully explicit ChatGPT subscription worker", () => {
    expect(readWorkerEnvironment(codex)).toMatchObject({
      provider: "codex-subscription",
      model: "explicit-synthetic-model",
      codexHome: "/data/codex",
      codexPath: "codex",
      codexWorkdir: "/var/empty/vorton-worker",
      codexReasoningEffort: "high",
      codexExecutionTimeoutMs: 900000,
      storeResponses: false,
      classificationCeiling: "internal",
    });
  });

  it("fails closed on ambiguous subscription auth configuration", () => {
    expect(() =>
      readWorkerEnvironment({ ...codex, VORTON_CODEX_HOME: "relative/path" }),
    ).toThrow("VORTON_CODEX_HOME must be an absolute path");
    expect(() =>
      readWorkerEnvironment({
        ...codex,
        VORTON_CODEX_REASONING_EFFORT: "maximum-ish",
      }),
    ).toThrow("VORTON_CODEX_REASONING_EFFORT must be");
    expect(() =>
      readWorkerEnvironment({
        ...codex,
        VORTON_CODEX_EXECUTION_TIMEOUT_MS: "1800001",
      }),
    ).toThrow("must be from 60000 through 1800000");
    expect(() =>
      readWorkerEnvironment({
        ...codex,
        VORTON_CODEX_EXECUTION_TIMEOUT_MS: "900000.5",
      }),
    ).toThrow("must be an integer");
    for (const name of ["VORTON_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) {
      expect(() =>
        readWorkerEnvironment({ ...codex, [name]: "must-not-be-present" }),
      ).toThrow(`must not receive API billing secret ${name}`);
    }
  });
});
