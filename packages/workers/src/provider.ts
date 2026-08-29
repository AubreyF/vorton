import type {
  DataClassification,
  ExecutiveWorkerJob,
  ExecutiveWorkerJobRequest,
} from "@aubos/contracts";

/**
 * Providers produce bounded recommendations. They cannot write AubOS records,
 * grant capabilities, approve decisions, create Work, or invoke external tools.
 */
export interface ExecutiveWorkerProvider {
  readonly provider: string;
  readonly model: string;
  readonly dataClassificationCeiling: DataClassification;
  submit(request: ExecutiveWorkerJobRequest): Promise<ExecutiveWorkerJob>;
  retrieve(job: ExecutiveWorkerJob): Promise<ExecutiveWorkerJob>;
}

const classificationRank: Record<
  Exclude<DataClassification, "synthetic">,
  number
> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

export function assertEvidenceWithinCeiling(
  evidence: ExecutiveWorkerJobRequest["evidence"],
  ceiling: DataClassification,
): void {
  const exceeds = evidence.some((item) => {
    if (item.classification === "synthetic") return false;
    if (ceiling === "synthetic") return true;
    return (
      classificationRank[item.classification] > classificationRank[ceiling]
    );
  });
  if (exceeds) {
    throw new Error(
      "Evidence classification exceeds the worker provider ceiling",
    );
  }
}
