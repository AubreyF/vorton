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
    expect(roleIndex).toBeGreaterThan(envelopeIndex);
    expect(statements[envelopeIndex]?.values?.[4]).toBe(
      createHmac("sha256", secret)
        .update(`4242|person|${context.installationId}|${context.authUserId}|`)
        .digest("hex"),
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("refuses to construct a runtime database without a separate context key", () => {
    expect(() => new Database(new Pool(), "short")).toThrow(
      "at least 32 characters",
    );
  });
});
