import { describe, expect, it } from "vitest";

import { FakeExecutiveWorkerAdapter } from "@vorton/workers";

import { ExecutiveWorkflow, InMemoryExecutiveLedger } from "./workflow.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const ownerId = "7fb46f09-3894-4c24-933c-77c7a403341c";
const ownerAuthUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const analysisWorkId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const policyId = "d37f356b-6297-4cd1-902d-c2755423a612";
const grantId = "4156f0af-e62f-4b16-a7bc-97c8301c2e2f";

const authorityVerifier = {
  resolvePerson: async (input: { authUserId: string }) => {
    if (input.authUserId !== ownerAuthUserId) {
      throw new Error("Owner authority is required");
    }
    return ownerId;
  },
  assertApplicable: async (input: {
    authority: { policyId: string; capabilityGrantId: string };
  }) => {
    if (
      input.authority.policyId !== policyId ||
      input.authority.capabilityGrantId !== grantId
    ) {
      throw new Error("Policy or capability grant is not applicable");
    }
  },
};

function ids() {
  const values = [
    "4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8",
    "ff013774-9440-41bf-a021-722f4f08c3e4",
    "70749dc0-85f2-4a60-8a7d-f5e6f2d02b16",
    "9fc18b4a-cff7-4762-806f-7406e743d492",
    "4ca5148f-288a-4a59-90dc-1d03cc67ea5c",
    "555e60e9-7173-4d23-83e4-f23cf472458c",
    "40e7c933-f559-4459-837a-da34b27d4fc3",
    "e64565bd-322f-466f-92ca-c67638d6ef4e",
    "7da3b2ca-6532-4f52-827a-1cd238a408ed",
  ];
  return () => {
    const next = values.shift();
    if (!next) throw new Error("Synthetic ID fixture exhausted");
    return next;
  };
}

describe("governed executive workflow", () => {
  it("traces evidence through quarantined candidate learning", async () => {
    const ledger = new InMemoryExecutiveLedger(ids());
    const workflow = new ExecutiveWorkflow({
      ledger,
      worker: new FakeExecutiveWorkerAdapter(),
      authorityVerifier,
    });
    const evidence = await workflow.recordEvidence({
      installationId,
      summary: "Synthetic coolant pressure stayed within the fixture range.",
      sourceUri: null,
      classification: "synthetic",
      actor: { kind: "person", id: ownerId },
    });
    const { job, proposal } = await workflow.startProposal({
      installationId,
      workId: analysisWorkId,
      workerId,
      role: {
        roleId: policyId,
        name: "Strategic reviewer",
        version: 1,
        contentSha256: "a".repeat(64),
        skillMarkdown: "# Strategic reviewer\n\nRecommend. Never execute.",
      },
      objective: "Assess the synthetic coolant evidence",
      evidence: [
        {
          recordId: evidence.id,
          summary: evidence.summary,
          sourceUri: null,
          classification: "synthetic",
        },
      ],
      background: false,
    });
    expect(job.store).toBe(false);
    expect(proposal?.actor).toEqual({ kind: "worker", id: workerId });

    const review = await workflow.review({
      proposalRecordId: proposal!.id,
      reviewer: { installationId, authUserId: ownerAuthUserId },
      summary: "The bounded check is proportionate.",
      disposition: "support",
    });
    const decision = await workflow.decide({
      reviewRecordId: review.id,
      decisionMaker: { installationId, authUserId: ownerAuthUserId },
      summary: "Authorize only the synthetic diagnostic.",
      classification: "owner-required",
    });
    const approval = await workflow.approve({
      decisionRecordId: decision.id,
      approver: { installationId, authUserId: ownerAuthUserId },
      summary: "Approved for the synthetic fixture only.",
    });
    const work = await workflow.createExecutionWork({
      requester: { installationId, authUserId: ownerAuthUserId },
      approvalRecordId: approval.id,
      authority: {
        policyId,
        capabilityGrantId: grantId,
        approvalRecordId: approval.id,
        executorWorkerId: workerId,
        capability: "executive.synthetic.check",
        mode: "diagnose",
      },
      title: "Run the synthetic coolant check",
      requestedOutcome: "Produce an inspectable diagnostic receipt.",
      acceptanceCriteria: ["No external system is contacted."],
    });
    const receipt = await workflow.recordReceipt({
      work,
      workerId,
      summary: "Synthetic check completed.",
      artifacts: [{ uri: "urn:vorton:synthetic:coolant-receipt" }],
    });
    const outcome = await workflow.recordOutcome({
      receiptRecordId: receipt.id,
      observer: { kind: "person", id: ownerId },
      summary: "The check met its bounded intent.",
      comparedWithIntent: "All acceptance criteria passed.",
    });
    const learning = await workflow.createCandidateLearning({
      outcomeRecordId: outcome.id,
      actor: { kind: "worker", id: workerId },
      summary: "Candidate: retain the pressure-range check.",
      claim: "The synthetic range check was useful in this fixture.",
    });

    expect(ledger.records.map((record) => record.kind)).toEqual([
      "evidence",
      "proposal",
      "review",
      "decision",
      "approval",
      "receipt",
      "outcome",
      "learning",
    ]);
    expect(ledger.work).toHaveLength(1);
    expect(learning.payload).toMatchObject({
      admissionState: "candidate",
      quarantine: true,
    });
  });

  it("refuses Work when capability and approved recommendation do not match", async () => {
    const ledger = new InMemoryExecutiveLedger(ids());
    const workflow = new ExecutiveWorkflow({
      ledger,
      worker: new FakeExecutiveWorkerAdapter(),
      authorityVerifier,
    });
    const evidence = await workflow.recordEvidence({
      installationId,
      summary: "Synthetic evidence",
      sourceUri: null,
      classification: "synthetic",
      actor: { kind: "person", id: ownerId },
    });
    const { proposal } = await workflow.startProposal({
      installationId,
      workId: analysisWorkId,
      workerId,
      role: {
        roleId: policyId,
        name: "Reviewer",
        version: 1,
        contentSha256: "b".repeat(64),
        skillMarkdown: "# Reviewer",
      },
      objective: "Review evidence",
      evidence: [
        {
          recordId: evidence.id,
          summary: evidence.summary,
          sourceUri: null,
          classification: "synthetic",
        },
      ],
      background: false,
    });
    const review = await workflow.review({
      proposalRecordId: proposal!.id,
      reviewer: { installationId, authUserId: ownerAuthUserId },
      summary: "Supported",
      disposition: "support",
    });
    const decision = await workflow.decide({
      reviewRecordId: review.id,
      decisionMaker: { installationId, authUserId: ownerAuthUserId },
      summary: "Proceed",
      classification: "policy-authorized",
    });
    const approval = await workflow.approve({
      decisionRecordId: decision.id,
      approver: { installationId, authUserId: ownerAuthUserId },
      summary: "Approved",
    });

    await expect(
      workflow.createExecutionWork({
        requester: { installationId, authUserId: ownerAuthUserId },
        approvalRecordId: approval.id,
        authority: {
          policyId,
          capabilityGrantId: grantId,
          approvalRecordId: approval.id,
          executorWorkerId: workerId,
          capability: "executive.synthetic.publish",
          mode: "publish",
        },
        title: "Wrongly broadened Work",
        requestedOutcome: "This must fail.",
        acceptanceCriteria: [],
      }),
    ).rejects.toThrow("does not match the approved action");
    expect(ledger.work).toEqual([]);
  });
});
