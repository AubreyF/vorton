import { describe, expect, it } from "vitest";

import { readApiEnvironment } from "./env.js";

const base = {
  AUBOS_DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5432/aubos",
  AUBOS_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  AUBOS_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  AUBOS_SUPABASE_JWT_ISSUER: "https://abcdefghijklmnopqrst.supabase.co/auth/v1",
  AUBOS_SUPABASE_JWT_AUDIENCE: "authenticated",
  AUBOS_SUPABASE_JWKS_URL:
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1/.well-known/jwks.json",
  AUBOS_WORKER_URL: "http://aubos-worker.internal:8080",
  AUBOS_WORKER_SHARED_SECRET: "s".repeat(32),
  AUBOS_WORKER_PROVIDER: "openai-responses",
  AUBOS_WORKER_MODEL: "explicit-synthetic-model",
  AUBOS_ALLOWED_ORIGIN: "https://control.aubos.example",
  AUBOS_HINDSIGHT_URL: "http://aubos-hindsight.internal:8888",
  AUBOS_HINDSIGHT_API_KEY: "synthetic-hindsight-key",
};

describe("API environment", () => {
  it("fails closed when the provider model is not configured", () => {
    expect(() =>
      readApiEnvironment({ ...base, AUBOS_WORKER_MODEL: "" }),
    ).toThrow("AUBOS_WORKER_MODEL is required");
  });

  it("rejects JWT configuration for a different Supabase project", () => {
    expect(() =>
      readApiEnvironment({
        ...base,
        AUBOS_SUPABASE_JWT_ISSUER: "https://wrong-project.supabase.co/auth/v1",
      }),
    ).toThrow("exactly match");
    expect(() =>
      readApiEnvironment({
        ...base,
        AUBOS_SUPABASE_JWT_ISSUER:
          "https://abcdefghijklmnopqrst.supabase.co/forged",
      }),
    ).toThrow("exactly match");
  });
});
