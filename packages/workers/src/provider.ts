import type {
  DataClassification,
  ExecutiveWorkerJob,
  ExecutiveWorkerJobRequest,
} from "@vorton/contracts";

/**
 * Providers produce bounded recommendations. They cannot write Vorton records,
 * grant capabilities, approve decisions, create Work, or invoke external tools.
 */
export interface ExecutiveWorkerProvider {
  readonly provider: string;
  readonly model: string;
  readonly dataClassificationCeiling: DataClassification;
  /** True only when the provider retains submitted prompts or responses. */
  readonly storesResponses: boolean;
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

export function assertRequestWithinCeiling(
  request: Pick<ExecutiveWorkerJobRequest, "evidence" | "derivedContext">,
  ceiling: DataClassification,
): void {
  const classifiedItems = [
    ...request.evidence,
    ...(request.derivedContext ?? []),
  ];
  const exceeds = classifiedItems.some((item) => {
    if (item.classification === "synthetic") return false;
    if (ceiling === "synthetic") return true;
    return (
      classificationRank[item.classification] > classificationRank[ceiling]
    );
  });
  if (exceeds) {
    throw new Error(
      "Evidence or derived context classification exceeds the worker provider ceiling",
    );
  }
}
