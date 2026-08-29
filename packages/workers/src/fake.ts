import {
  executiveRecommendationSchema,
  executiveWorkerJobRequestSchema,
  executiveWorkerJobSchema,
  type ExecutiveRecommendation,
  type ExecutiveWorkerJob,
  type ExecutiveWorkerJobRequest,
} from "@aubos/contracts";

import {
  assertRequestWithinCeiling,
  type ExecutiveWorkerProvider,
} from "./provider.js";

export interface FakeExecutiveWorkerConfig {
  recommendation?: ExecutiveRecommendation;
}

export class FakeExecutiveWorkerAdapter implements ExecutiveWorkerProvider {
  readonly provider = "deterministic-fake";
  readonly model = "synthetic-executive-v1";
  readonly dataClassificationCeiling = "synthetic" as const;
  readonly #recommendation?: ExecutiveRecommendation;
  #sequence = 0;

  constructor(config: FakeExecutiveWorkerConfig = {}) {
    this.#recommendation = config.recommendation
      ? executiveRecommendationSchema.parse(config.recommendation)
      : undefined;
  }

  submit(rawRequest: ExecutiveWorkerJobRequest): Promise<ExecutiveWorkerJob> {
    const request = executiveWorkerJobRequestSchema.parse(rawRequest);
    assertRequestWithinCeiling(request, this.dataClassificationCeiling);
    this.#sequence += 1;
    const firstEvidence = request.evidence[0];
    const recommendation =
      this.#recommendation ??
      executiveRecommendationSchema.parse({
        summary: `Review ${request.objective}`,
        evidenceRecordIds: request.evidence.map((item) => item.recordId),
        alternatives: [
          {
            title: "Run the bounded synthetic check",
            description: "Use only the supplied synthetic evidence.",
            expectedOutcome: "A reviewable receipt is produced.",
            risks: ["The synthetic evidence may omit a material condition."],
          },
        ],
        recommendedAction: {
          title: "Run synthetic check",
          description: `Check ${firstEvidence?.summary ?? "the supplied evidence"}.`,
          capability: "executive.synthetic.check",
          mode: "diagnose",
          externalEffect: false,
        },
        confidence: 0.7,
        uncertainties: ["No non-synthetic sources were consulted."],
      });
    return Promise.resolve(
      executiveWorkerJobSchema.parse({
        jobId: `fake-job-${String(this.#sequence).padStart(4, "0")}`,
        provider: this.provider,
        model: this.model,
        status: "completed",
        store: false,
        background: request.background,
        installationId: request.installationId,
        workId: request.workId,
        workerId: request.workerId,
        recommendation,
      }),
    );
  }

  retrieve(job: ExecutiveWorkerJob): Promise<ExecutiveWorkerJob> {
    return Promise.resolve(executiveWorkerJobSchema.parse(job));
  }
}
