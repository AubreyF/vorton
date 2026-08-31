import { createHmac } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { Database } from "./index.js";

describe("database authority context", () => {
  it("binds a verified person to the current transaction before entering the RLS role", async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        statements.push({ text, values });
        if (text.includes("txid_current()")) {
          return { rows: [{ id: "4242" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = new Pool();
    Object.defineProperty(pool, "connect", { value: async () => client });
    Object.defineProperty(pool, "end", { value: async () => undefined });
    const secret = "context-secret-that-is-at-least-32-characters";
    const database = new Database(pool, secret);
    const context = {
      installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
    };

    await database.asPerson(context, async (transaction) => {
      await transaction.query("select public.current_person_id($1)", [
        context.installationId,
      ]);
    });

    const envelopeIndex = statements.findIndex((item) =>
      item.text.includes("aubos.context_signature"),
    );
    const roleIndex = statements.findIndex(
      (item) => item.text === "set local role authenticated",
    );
    expect(envelopeIndex).toBeGreaterThan(-1);
    expect(statements[envelopeIndex]?.text).toContain(
      "set_config('aubos.installation_id', $2, true)",
    );
    expect(statements[envelopeIndex]?.text).toContain(
      "set_config('vorton.installation_id', $2, true)",
    );
    expect(roleIndex).toBeGreaterThan(envelopeIndex);
    expect(statements[envelopeIndex]?.values?.[5]).toBe(
      createHmac("sha256", secret)
        .update(
          `4242|person|${context.installationId}|${context.workspaceId}|${context.authUserId}|`,
        )
        .digest("hex"),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("refuses to construct a runtime database without a separate context key", () => {
    expect(() => new Database(new Pool(), "short")).toThrow(
      "at least 32 characters",
    );
  });

  it("binds installation step-up AAL and auth time into a separate transaction signature", async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        statements.push({ text, values });
        return text.includes("txid_current()")
          ? { rows: [{ id: "5252" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = new Pool();
    Object.defineProperty(pool, "connect", { value: async () => client });
    Object.defineProperty(pool, "end", { value: async () => undefined });
    const secret = "context-secret-that-is-at-least-32-characters";
    const database = new Database(pool, secret);
    const context = {
      installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
      authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
      aal: "aal2" as const,
      authTime: 1_788_148_800,
    };

    await database.asInstallationPersonWithStepUp(context, async () => {});

    const stepUp = statements.find((item) =>
      item.text.includes("vorton.step_up_signature"),
    );
    expect(stepUp?.values).toEqual([
      "aal2",
      String(context.authTime),
      createHmac("sha256", secret)
        .update(
          `5252|installation-person|${context.installationId}|${context.authUserId}|aal2|${String(context.authTime)}`,
        )
        .digest("hex"),
    ]);
  });

  it("composes a workspace person context with a separately signed recent-AAL2 envelope", async () => {
    const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client = {
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        statements.push({ text, values });
        return text.includes("txid_current()")
          ? { rows: [{ id: "6262" }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const pool = new Pool();
    Object.defineProperty(pool, "connect", { value: async () => client });
    Object.defineProperty(pool, "end", { value: async () => undefined });
    const secret = "context-secret-that-is-at-least-32-characters";
    const database = new Database(pool, secret);
    const context = {
      vortonInstallationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
      aal: "aal2" as const,
      authTime: 1_788_148_900,
    };

    await database.asWorkspacePersonWithStepUp(context, async (transaction) => {
      await transaction.query("select public.lifecycle_approval_fixture()");
    });

    const baseEnvelopeIndex = statements.findIndex((item) =>
      item.text.includes("aubos.context_signature"),
    );
    const stepUpIndex = statements.findIndex((item) =>
      item.text.includes("vorton.workspace_step_up_signature"),
    );
    const roleIndex = statements.findIndex(
      (item) => item.text === "set local role authenticated",
    );
    const jwtClaimsIndex = statements.findIndex((item) =>
      item.text.includes("request.jwt.claims"),
    );
    const workIndex = statements.findIndex(
      (item) => item.text === "select public.lifecycle_approval_fixture()",
    );

    expect(baseEnvelopeIndex).toBeGreaterThan(-1);
    expect(stepUpIndex).toBeGreaterThan(baseEnvelopeIndex);
    expect(roleIndex).toBeGreaterThan(stepUpIndex);
    expect(jwtClaimsIndex).toBeGreaterThan(roleIndex);
    expect(workIndex).toBeGreaterThan(jwtClaimsIndex);
    expect(statements[baseEnvelopeIndex]?.values).toEqual([
      "person",
      context.vortonInstallationId,
      context.workspaceId,
      context.authUserId,
      "",
      createHmac("sha256", secret)
        .update(
          `6262|person|${context.vortonInstallationId}|${context.workspaceId}|${context.authUserId}|`,
        )
        .digest("hex"),
    ]);
    expect(statements[stepUpIndex]?.values).toEqual([
      "aal2",
      String(context.authTime),
      createHmac("sha256", secret)
        .update(
          `6262|workspace-person|${context.vortonInstallationId}|${context.workspaceId}|${context.authUserId}|aal2|${String(context.authTime)}`,
        )
        .digest("hex"),
    ]);
    expect(statements[stepUpIndex]?.text).not.toContain("person_id");
    expect(statements[stepUpIndex]?.text).toContain(
      "vorton.workspace_step_up_auth_time",
    );
    expect(statements[stepUpIndex]?.text).not.toContain(
      "vorton.step_up_signature",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects a caller-provided person ID before opening a transaction", async () => {
    const connect = vi.fn();
    const pool = new Pool();
    Object.defineProperty(pool, "connect", { value: connect });
    Object.defineProperty(pool, "end", { value: async () => undefined });
    const database = new Database(
      pool,
      "context-secret-that-is-at-least-32-characters",
    );
    const claimedPersonContext = {
      vortonInstallationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      personId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
      aal: "aal2" as const,
      authTime: 1_788_148_900,
    };

    await expect(
      database.asWorkspacePersonWithStepUp(
        claimedPersonContext,
        async () => undefined,
      ),
    ).rejects.toThrow("must not provide personId");
    expect(connect).not.toHaveBeenCalled();
  });
});
