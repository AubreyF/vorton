import { describe, expect, it } from "vitest";

import { readWorkerEnvironment } from "./env.js";

const base = {
  AUBOS_WORKER_SHARED_SECRET: "s".repeat(32),
  AUBOS_WORKER_PROVIDER: "openai-responses",
  AUBOS_OPENAI_MODEL: "explicit-synthetic-model",
  AUBOS_OPENAI_API_KEY: "synthetic-key-not-used",
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
});
