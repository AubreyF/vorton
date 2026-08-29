import { describe, expect, it } from "vitest";

import type { Database, SqlExecutor } from "@aubos/database";

import { WorkerRunsService } from "./runs.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workId = "7fb46f09-3894-4c24-933c-77c7a403341c";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const credentialId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const roleId = "d37f356b-6297-4cd1-902d-c2755423a612";

class FakeDatabase {
  readonly statements: Array<{ text: string; values?: readonly unknown[] }> =
    [];
  responses: Array<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }> = [];

  asWorker<T>(
    _context: unknown,
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row>(text: string, values?: readonly unknown[]) => {
        this.statements.push({ text, values });
        return (this.responses.shift() ?? { rows: [], rowCount: 1 }) as {
          rows: Row[];
          rowCount: number | null;
        };
      },
    });
  }
}

const context = { installationId, workerId, credentialId };
const request = {
  installationId,
  workId,
  workerId,
  role: {
    roleId,
    name: "Synthetic reviewer",
    version: 1,
    contentSha256: "a".repeat(64),
    skillMarkdown: "# Synthetic reviewer",
  },
  objective: "Review the fixture",
  evidence: [
    {
      recordId: "4156f0af-e62f-4b16-a7bc-97c8301c2e2f",
      summary: "Synthetic evidence",
      sourceUri: null,
      classification: "synthetic" as const,
    },
  ],
  background: false,
};
const job = {
  jobId: "fake-job-0001",
  provider: "deterministic-fake",
  model: "synthetic-executive-v1",
  status: "completed" as const,
  store: false,
  background: false,
  installationId,
  workId,
  workerId,
  recommendation: {
    summary: "Inspect the fixture.",
    evidenceRecordIds: [request.evidence[0]!.recordId],
    alternatives: [
      {
        title: "Inspect",
        description: "Inspect the fixture.",
        expectedOutcome: "A receipt exists.",
        risks: [],
      },
    ],
    recommendedAction: {
      title: "Inspect",
      description: "Inspect the fixture.",
      capability: "executive.synthetic.check",
      mode: "diagnose" as const,
      externalEffect: false,
    },
    confidence: 0.7,
    uncertainties: [],
  },
};

describe("worker run persistence", () => {
  it("records provider identity without model output or personal metadata", async () => {
    const database = new FakeDatabase();
    database.responses.push({
      rows: [{ id: "4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8" }],
      rowCount: 1,
    });
    await new WorkerRunsService(
      database as unknown as Database,
    ).recordSubmitted(context, request, job);

    const statement = database.statements[0];
    expect(statement?.text).toContain("insert into public.worker_runs");
    expect(statement?.text).not.toContain("recommendation");
    expect(statement?.values).not.toContain(job.recommendation);
    expect(String(statement?.values?.[10])).not.toContain("Synthetic reviewer");
  });

  it("updates only status and error through the narrow service", async () => {
    const database = new FakeDatabase();
    database.responses.push({ rows: [], rowCount: 1 });
    await new WorkerRunsService(database as unknown as Database).updateStatus(
      context,
      job,
    );
    expect(database.statements[0]?.text).toContain(
      "set status = $4, error = $5",
    );
    expect(database.statements[0]?.text).not.toContain("recommendation");
  });
});
