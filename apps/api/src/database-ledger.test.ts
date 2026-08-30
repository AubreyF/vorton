import { describe, expect, it } from "vitest";

import type { Database, SqlExecutor } from "@vorton/database";

import { DatabaseExecutiveLedger } from "./database-ledger.js";

const person = {
  installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
};
const worker = {
  installationId: person.installationId,
  workerId: "b5611dc4-07e4-4388-a7d0-ddf7bb452499",
};

function fixture() {
  const contexts: string[] = [];
  const queryCalls: string[] = [];
  const executor: SqlExecutor = {
    query: async <Row>(text: string) => {
      queryCalls.push(text);
      const rows = [
        {
          id: "4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8",
          installation_id: person.installationId,
          work_id: null,
          kind: "evidence",
          summary: "Synthetic evidence",
          payload: {},
          actor_person_id: "7fb46f09-3894-4c24-933c-77c7a403341c",
          actor_worker_id: null,
          supersedes_record_id: null,
        },
      ] as Row[];
      return { rows, rowCount: rows.length };
    },
  };
  const run = (
    name: string,
    operation: (transaction: SqlExecutor) => Promise<unknown>,
  ) => {
    contexts.push(name);
    return operation(executor);
  };
  const database = {
    asPerson: (
      _context: typeof person,
      operation: (transaction: SqlExecutor) => Promise<unknown>,
    ) => run("person", operation),
    asWorker: (
      _context: typeof worker,
      operation: (transaction: SqlExecutor) => Promise<unknown>,
    ) => run("worker", operation),
  } as unknown as Database;
  return {
    ledger: new DatabaseExecutiveLedger(database),
    contexts,
    queryCalls,
  };
}

describe("database executive ledger authority", () => {
  it("routes human and worker records through their RLS transactions", async () => {
    const test = fixture();
    await test.ledger.getRecord("4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8", person);
    await test.ledger.getRecord("4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8", worker);
    expect(test.contexts).toEqual(["person", "worker"]);
  });

  it("has no administrator fallback when context is absent", async () => {
    const test = fixture();
    expect(() =>
      test.ledger.getRecord("4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8"),
    ).toThrow("verified person or scoped worker context");
    expect(test.queryCalls).toHaveLength(0);
  });
});
