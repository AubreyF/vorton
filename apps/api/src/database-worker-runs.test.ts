import { describe, expect, it, vi } from "vitest";
import type { Database } from "@vorton/database";

import { DatabaseWorkerRunRecorder } from "./database-worker-runs.js";

const request = {
  installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workId: "fbc4ac66-4a32-4a34-b810-88f4330205aa",
  workerId: "b5611dc4-07e4-4388-a7d0-ddf7bb452499",
  role: {
    roleId: "d37f356b-6297-4cd1-902d-c2755423a612",
    name: "Synthetic reviewer",
    version: 1,
    contentSha256: "a".repeat(64),
    skillMarkdown: "Recommend only.",
  },
  objective: "Assess synthetic evidence",
  evidence: [
    {
      recordId: "4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8",
      summary: "Synthetic evidence",
      sourceUri: null,
      classification: "synthetic" as const,
    },
  ],
  background: false,
};

function database(
  query = vi.fn(async () => ({ rows: [{ id: "run-1" }], rowCount: 1 })),
) {
  return {
    query,
    value: {
      asWorker: async (
        _context: { installationId: string; workerId: string },
        operation: (transaction: { query: typeof query }) => Promise<unknown>,
      ) => operation({ query }),
    } as unknown as Database,
  };
}

describe("database worker run recorder", () => {
  it("persists a verified stateless worker result from the API", async () => {
    const fixture = database();
    const recorder = new DatabaseWorkerRunRecorder(fixture.value);
    await expect(
      recorder.record(request, {
        jobId: "resp_synthetic",
        provider: "openai-responses",
        model: "configured-model",
        status: "completed",
        store: false,
        background: false,
        installationId: request.installationId,
        workspaceId: request.workspaceId,
        workId: request.workId,
        workerId: request.workerId,
        recommendation: {
          summary: "Recommend review.",
          evidenceRecordIds: [request.evidence[0]!.recordId],
          alternatives: [
            {
              title: "Inspect",
              description: "Inspect the fixture.",
              expectedOutcome: "A bounded receipt exists.",
              risks: [],
            },
          ],
          recommendedAction: {
            title: "Review",
            description: "Review only.",
            capability: "executive.synthetic.check",
            mode: "diagnose",
            externalEffect: false,
          },
          confidence: 0.5,
          uncertainties: [],
        },
      }),
    ).resolves.toBe("run-1");
    expect(fixture.query).toHaveBeenCalledOnce();
  });

  it("rejects a worker result that crosses installation boundaries before writing", async () => {
    const fixture = database();
    const recorder = new DatabaseWorkerRunRecorder(fixture.value);
    await expect(
      recorder.record(request, {
        jobId: "resp_forged",
        provider: "openai-responses",
        model: "configured-model",
        status: "failed",
        store: false,
        background: false,
        installationId: "a037f814-3572-4dcb-8a56-f2968c22bdcf",
        workspaceId: request.workspaceId,
        workId: request.workId,
        workerId: request.workerId,
        error: "forged boundary",
      }),
    ).rejects.toThrow("crossed its installation");
    expect(fixture.query).not.toHaveBeenCalled();
  });
});
