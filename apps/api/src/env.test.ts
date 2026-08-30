import { describe, expect, it } from "vitest";

import { readApiEnvironment } from "./env.js";

const base = {
  VORTON_DATABASE_URL: "postgresql://synthetic:synthetic@localhost:5432/vorton",
  VORTON_DATABASE_CONTEXT_SIGNING_SECRET: "c".repeat(32),
  VORTON_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  VORTON_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VORTON_SUPABASE_JWT_ISSUER:
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1",
  VORTON_SUPABASE_JWT_AUDIENCE: "authenticated",
  VORTON_SUPABASE_JWKS_URL:
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1/.well-known/jwks.json",
  VORTON_WORKER_URL: "http://vorton-worker.internal:8080",
  VORTON_WORKER_SHARED_SECRET: "s".repeat(32),
  VORTON_WORKER_PROVIDER: "openai-responses",
  VORTON_WORKER_MODEL: "explicit-synthetic-model",
  VORTON_WORKER_REQUEST_TIMEOUT_MS: "930000",
  VORTON_ALLOWED_ORIGIN: "https://control.vorton.example",
  VORTON_HINDSIGHT_URL: "http://vorton-hindsight.internal:8888",
  VORTON_HINDSIGHT_API_KEY: "synthetic-hindsight-key",
};

describe("API environment", () => {
  it("loads a base64-encoded database certificate authority", () => {
    const certificate = [
      "-----BEGIN CERTIFICATE-----",
      "c3ludGhldGljLWNh",
      "-----END CERTIFICATE-----",
      "",
    ].join("\n");
    expect(
      readApiEnvironment({
        ...base,
        VORTON_DATABASE_SSL_CA_BASE64:
          Buffer.from(certificate).toString("base64"),
      }).databaseSslCa,
    ).toBe(certificate);
  });

  it("rejects malformed database certificate authorities", () => {
    expect(() =>
      readApiEnvironment({
        ...base,
        VORTON_DATABASE_SSL_CA_BASE64:
          Buffer.from("not a certificate").toString("base64"),
      }),
    ).toThrow("must decode to a PEM certificate authority");
  });

  it("fails closed when the provider model is not configured", () => {
    expect(() =>
      readApiEnvironment({ ...base, VORTON_WORKER_MODEL: "" }),
    ).toThrow("VORTON_WORKER_MODEL is required");
  });

  it("rejects provider billing credentials at the API boundary", () => {
    for (const name of ["VORTON_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) {
      expect(() =>
        readApiEnvironment({
          ...base,
          VORTON_WORKER_PROVIDER: "codex-subscription",
          [name]: "must-not-be-present",
        }),
      ).toThrow(`must not receive provider billing secret ${name}`);
    }
  });

  it("rejects an unsupported worker provider", () => {
    expect(() =>
      readApiEnvironment({
        ...base,
        VORTON_WORKER_PROVIDER: "synthetic-provider",
      }),
    ).toThrow(
      "VORTON_WORKER_PROVIDER must be openai-responses or codex-subscription",
    );
  });

  it("requires a bounded worker request timeout", () => {
    expect(readApiEnvironment(base).workerRequestTimeoutMs).toBe(930000);
    expect(() =>
      readApiEnvironment({
        ...base,
        VORTON_WORKER_REQUEST_TIMEOUT_MS: "59000",
      }),
    ).toThrow("must be from 60000 through 1860000");
    expect(() =>
      readApiEnvironment({
        ...base,
        VORTON_WORKER_REQUEST_TIMEOUT_MS: "not-a-number",
      }),
    ).toThrow("must be an integer");
  });

  it("requires private Fly service URLs for worker and memory credentials", () => {
    expect(readApiEnvironment(base)).toMatchObject({
      workerUrl: "http://vorton-worker.internal:8080",
      hindsightUrl: "http://vorton-hindsight.internal:8888",
    });
    for (const [name, value] of [
      ["VORTON_WORKER_URL", "https://worker.example.test:8080"],
      ["VORTON_WORKER_URL", "http://vorton-worker.internal:8888"],
      ["VORTON_WORKER_URL", "http://vorton-worker.internal:8080/proxy"],
      ["VORTON_HINDSIGHT_URL", "http://memory.example.test:8888"],
      ["VORTON_HINDSIGHT_URL", "http://vorton-hindsight.internal:8080"],
      [
        "VORTON_HINDSIGHT_URL",
        "http://credential@vorton-hindsight.internal:8888",
      ],
    ] as const) {
      expect(() => readApiEnvironment({ ...base, [name]: value })).toThrow(
        `http://<fly-app>.internal:${name === "VORTON_WORKER_URL" ? "8080" : "8888"}`,
      );
    }
  });

  it("rejects JWT configuration for a different Supabase project", () => {
    expect(() =>
      readApiEnvironment({
        ...base,
        VORTON_SUPABASE_JWT_ISSUER: "https://wrong-project.supabase.co/auth/v1",
      }),
    ).toThrow("exactly match");
    expect(() =>
      readApiEnvironment({
        ...base,
        VORTON_SUPABASE_JWT_ISSUER:
          "https://abcdefghijklmnopqrst.supabase.co/forged",
      }),
    ).toThrow("exactly match");
  });
});
