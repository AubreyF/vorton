import { describe, expect, it } from "vitest";

import {
  buildBootstrapPlan,
  provisionRuntimeRole,
  readBootstrapConfig,
  readBootstrapSecrets,
} from "./provision.js";

const authUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";

function environment(): NodeJS.ProcessEnv {
  return {
    VORTON_BOOTSTRAP_AUTH_USER_ID: authUserId,
    VORTON_WORKER_PROVIDER: "openai-responses",
    VORTON_WORKER_MODEL: "gpt-5.4",
    VORTON_OPENAI_MODEL: "gpt-5.4",
    VORTON_WORKER_CLASSIFICATION_CEILING: "internal",
    VORTON_OPENAI_CLASSIFICATION_CEILING: "internal",
  };
}

function codexEnvironment(): NodeJS.ProcessEnv {
  return {
    VORTON_BOOTSTRAP_AUTH_USER_ID: authUserId,
    VORTON_WORKER_PROVIDER: "codex-subscription",
    VORTON_WORKER_MODEL: "gpt-5.6-terra",
    VORTON_CODEX_MODEL: "gpt-5.6-terra",
    VORTON_CODEX_REASONING_EFFORT: "high",
    VORTON_WORKER_CLASSIFICATION_CEILING: "internal",
    VORTON_CODEX_CLASSIFICATION_CEILING: "internal",
  };
}

describe("first-install bootstrap", () => {
  it("produces a deterministic, secret-free, recommendation-only plan", async () => {
    const first = buildBootstrapPlan(await readBootstrapConfig(environment()));
    const second = buildBootstrapPlan(await readBootstrapConfig(environment()));
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(authUserId);
    expect(JSON.stringify(first)).not.toContain("password");
    expect(first).toMatchObject({
      installation: { realm: "organizational" },
      authOwner: { authUserId: "[provided]", kind: "owner" },
      executiveBinding: {
        provider: "openai-responses",
        capability: "executive.propose",
        mode: "recommend",
      },
      effects: "none",
    });
  });

  it("fails closed on provider, model, and classification drift", async () => {
    await expect(
      readBootstrapConfig({
        ...environment(),
        VORTON_WORKER_PROVIDER: "synthetic",
      }),
    ).rejects.toThrow("openai-responses or codex-subscription");
    await expect(
      readBootstrapConfig({
        ...environment(),
        VORTON_OPENAI_MODEL: "another-model",
      }),
    ).rejects.toThrow("must exactly match");
    await expect(
      readBootstrapConfig({
        ...environment(),
        VORTON_BOOTSTRAP_EVIDENCE_CLASSIFICATION: "restricted",
      }),
    ).rejects.toThrow("exceeds");
  });

  it("binds a subscription worker to the owner-delegated billing realm", async () => {
    const config = await readBootstrapConfig(codexEnvironment());
    expect(config).toMatchObject({
      provider: "codex-subscription",
      billingRealm: "owner-delegated",
      model: "gpt-5.6-terra",
    });
    expect(buildBootstrapPlan(config)).toMatchObject({
      executiveBinding: {
        provider: "codex-subscription",
        billingRealm: "owner-delegated",
        model: "gpt-5.6-terra",
      },
    });
    await expect(
      readBootstrapConfig({
        ...codexEnvironment(),
        VORTON_CODEX_REASONING_EFFORT: "unbounded",
      }),
    ).rejects.toThrow("VORTON_CODEX_REASONING_EFFORT must be");
  });

  it("requires bootstrap and runtime database secrets only for apply", () => {
    expect(() => readBootstrapSecrets({})).toThrow(
      "VORTON_BOOTSTRAP_DATABASE_URL is required",
    );
    expect(() =>
      readBootstrapSecrets({
        VORTON_BOOTSTRAP_DATABASE_URL:
          "postgresql://admin@example.invalid/vorton",
        VORTON_BOOTSTRAP_RUNTIME_DATABASE_PASSWORD: "short",
        VORTON_BOOTSTRAP_CONTEXT_SIGNING_SECRET: "c".repeat(32),
      }),
    ).toThrow("at least 32 characters");
  });

  it("defaults bootstrap database TLS on and accepts only an explicit local opt-out", () => {
    const secrets = {
      VORTON_BOOTSTRAP_DATABASE_URL:
        "postgresql://admin@example.invalid/vorton",
      VORTON_BOOTSTRAP_RUNTIME_DATABASE_PASSWORD: "p".repeat(32),
      VORTON_BOOTSTRAP_CONTEXT_SIGNING_SECRET: "c".repeat(32),
    };
    expect(readBootstrapSecrets(secrets).administratorDatabaseSsl).toBe(true);
    expect(
      readBootstrapSecrets({
        ...secrets,
        VORTON_BOOTSTRAP_DATABASE_SSL: "false",
      }).administratorDatabaseSsl,
    ).toBe(false);
    expect(() =>
      readBootstrapSecrets({
        ...secrets,
        VORTON_BOOTSTRAP_DATABASE_SSL: "disabled",
      }),
    ).toThrow("must be exactly true or false");
  });

  it("provisions an RLS-bound runtime role without rotating an existing password", async () => {
    const statements: string[] = [];
    const client = {
      async query<Row>(
        text: string,
      ): Promise<{ rows: Row[]; rowCount: number }> {
        statements.push(text);
        if (text.startsWith("select current_user")) {
          return {
            rows: [
              {
                current_user: "bootstrap_admin",
                rolsuper: false,
                rolcreaterole: true,
                can_grant_authenticated: true,
                can_grant_worker: true,
                can_write_context_keys: true,
              } as Row,
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("select quote_ident")) {
          return {
            rows: [
              {
                identifier: '"aubos_runtime"',
                password: "'[secret]'",
              } as Row,
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("select exists")) {
          return { rows: [{ exists: false } as Row], rowCount: 1 };
        }
        if (text.startsWith("select current_database")) {
          return { rows: [{ name: "postgres" } as Row], rowCount: 1 };
        }
        if (text.startsWith("select secret =")) {
          return { rows: [{ matches: true } as Row], rowCount: 1 };
        }
        if (text.startsWith("select role.rolcanlogin")) {
          return {
            rows: [
              {
                rolcanlogin: true,
                rolinherit: false,
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolreplication: false,
                rolbypassrls: false,
                authenticatedMembership: true,
                workerMembership: true,
                unexpectedMembership: false,
                directTablePrivileges: false,
                ownsObjects: false,
              } as Row,
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await provisionRuntimeRole(
      client,
      "aubos_runtime",
      "x".repeat(32),
      "c".repeat(32),
    );
    const sql = statements.join("\n");
    expect(sql).toContain("nobypassrls");
    expect(sql).toContain("grant authenticated, aubos_worker");
    expect(sql).not.toContain("grant select on public.");
    expect(sql).not.toContain("grant insert on public.");
    expect(sql).not.toContain("grant update on");
    expect(sql).not.toContain("grant delete on");
    expect(sql).not.toContain("auth.users");
  });

  it("rejects runtime role identifier injection", async () => {
    await expect(
      provisionRuntimeRole(
        { query: async () => ({ rows: [], rowCount: 0 }) },
        'runtime"; drop role postgres; select "',
        "x".repeat(32),
        "c".repeat(32),
      ),
    ).rejects.toThrow("lowercase PostgreSQL identifier");
  });

  it("preserves the password and context key on idempotent replay", async () => {
    const statements: string[] = [];
    const client = {
      async query<Row>(
        text: string,
      ): Promise<{ rows: Row[]; rowCount: number }> {
        statements.push(text);
        if (text.startsWith("select current_user")) {
          return {
            rows: [
              {
                current_user: "bootstrap_admin",
                rolsuper: true,
                rolcreaterole: true,
                can_grant_authenticated: true,
                can_grant_worker: true,
                can_write_context_keys: true,
              } as Row,
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("select quote_ident")) {
          return {
            rows: [
              {
                identifier: '"aubos_runtime"',
                password: "'[new-secret]'",
              } as Row,
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("select exists")) {
          return { rows: [{ exists: true } as Row], rowCount: 1 };
        }
        if (text.startsWith("select current_database")) {
          return { rows: [{ name: "postgres" } as Row], rowCount: 1 };
        }
        if (text.startsWith("select secret =")) {
          return { rows: [{ matches: true } as Row], rowCount: 1 };
        }
        if (text.startsWith("select role.rolcanlogin")) {
          return {
            rows: [
              {
                rolcanlogin: true,
                rolinherit: false,
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
                rolreplication: false,
                rolbypassrls: false,
                authenticatedMembership: true,
                workerMembership: true,
                unexpectedMembership: false,
                directTablePrivileges: false,
                ownsObjects: false,
              } as Row,
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await provisionRuntimeRole(
      client,
      "aubos_runtime",
      "new-password-that-must-not-be-applied",
      "existing-context-key-that-is-long-enough",
    );
    const alter = statements.find((statement) =>
      statement.startsWith("alter role"),
    );
    expect(alter).toContain("nobypassrls");
    expect(alter).not.toContain("password");
    expect(alter).not.toContain("new-secret");
  });
});
