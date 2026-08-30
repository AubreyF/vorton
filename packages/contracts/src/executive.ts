import { z } from "zod";

import { capabilityModeSchema, dataClassificationSchema } from "./kernel.js";
import { retrievedContextSchema } from "./memory.js";

const uuid = z.string().uuid();

export const decisionClassificationSchema = z.enum([
  "advisory",
  "delegated",
  "owner-required",
  "policy-authorized",
  "prohibited",
  "one-way",
]);

export const executiveStageSchema = z.enum([
  "evidence",
  "proposal",
  "review",
  "decision",
  "approval",
  "work",
  "receipt",
  "outcome",
  "candidate-learning",
]);

export const recommendedActionSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(8_000),
  capability: z.string().trim().min(1).max(240),
  mode: capabilityModeSchema,
  externalEffect: z.boolean(),
});

export const executiveAlternativeSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(8_000),
  expectedOutcome: z.string().trim().min(1).max(4_000),
  risks: z.array(z.string().trim().min(1).max(2_000)).max(20),
});

export const executiveRecommendationSchema = z.object({
  summary: z.string().trim().min(1).max(8_000),
  evidenceRecordIds: z.array(uuid).min(1).max(100),
  alternatives: z.array(executiveAlternativeSchema).min(1).max(10),
  recommendedAction: recommendedActionSchema,
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string().trim().min(1).max(2_000)).max(20),
});

export const executiveCouncilProtocolSchema = z.literal(
  "vorton.executive-council.v1",
);

export const executiveCouncilContributionPhaseSchema = z.enum([
  "proposal",
  "review",
  "synthesis",
]);

export const executiveCouncilPeerContextSchema = z.object({
  recordId: uuid,
  kind: z.enum(["proposal", "review"]),
  phase: z.enum(["proposal", "review"]),
  roleId: uuid,
  roleName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(8_000),
  recommendation: executiveRecommendationSchema,
  trust: z.literal("untrusted"),
  authority: z.literal("none"),
});

export const executiveCouncilContextSchema = z
  .object({
    protocol: executiveCouncilProtocolSchema,
    phase: executiveCouncilContributionPhaseSchema,
    roleId: uuid,
    workUpdatedAt: z.string().datetime({ offset: true }),
    workInputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    inputRecordIds: z.array(uuid).min(1).max(32),
    peerContext: z.array(executiveCouncilPeerContextSchema).max(10),
    authority: z.literal("none"),
  })
  .superRefine((context, issue) => {
    const peerIds = context.peerContext.map((peer) => peer.recordId);
    if (new Set(peerIds).size !== peerIds.length) {
      issue.addIssue({
        code: "custom",
        path: ["peerContext"],
        message: "Council peer records must be unique",
      });
    }
    if (
      context.peerContext.some(
        (peer) => !context.inputRecordIds.includes(peer.recordId),
      )
    ) {
      issue.addIssue({
        code: "custom",
        path: ["inputRecordIds"],
        message: "Council input records must include every peer record",
      });
    }
    if (context.phase === "proposal" && context.peerContext.length !== 0) {
      issue.addIssue({
        code: "custom",
        path: ["peerContext"],
        message: "Independent proposals cannot receive peer context",
      });
    }
    if (
      context.phase === "review" &&
      (context.peerContext.length !== 4 ||
        new Set(context.peerContext.map((peer) => peer.roleId)).size !== 4 ||
        context.peerContext.some(
          (peer) => peer.phase !== "proposal" || peer.roleId === context.roleId,
        ))
    ) {
      issue.addIssue({
        code: "custom",
        path: ["peerContext"],
        message: "Council review requires exactly four other-role proposals",
      });
    }
    if (context.phase === "synthesis") {
      const proposals = context.peerContext.filter(
        (peer) => peer.phase === "proposal",
      );
      const reviews = context.peerContext.filter(
        (peer) => peer.phase === "review",
      );
      const proposalRoles = new Set(proposals.map((peer) => peer.roleId));
      const reviewRoles = new Set(reviews.map((peer) => peer.roleId));
      if (
        proposals.length !== 5 ||
        reviews.length !== 5 ||
        proposalRoles.size !== 5 ||
        reviewRoles.size !== 5 ||
        [...proposalRoles].some((roleId) => !reviewRoles.has(roleId))
      ) {
        issue.addIssue({
          code: "custom",
          path: ["peerContext"],
          message:
            "Council synthesis requires all five proposals and all five reviews",
        });
      }
    }
  });

export const executiveRoleSchema = z.object({
  roleId: uuid,
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  skillMarkdown: z.string().trim().min(1).max(32_000),
});

export const executiveEvidenceSchema = z.object({
  recordId: uuid,
  summary: z.string().trim().min(1).max(8_000),
  sourceUri: z.string().url().max(2_048).nullable(),
  classification: dataClassificationSchema,
});

export const executiveWorkerJobRequestSchema = z
  .object({
    installationId: uuid,
    workId: uuid,
    workerId: uuid,
    role: executiveRoleSchema,
    objective: z.string().trim().min(1).max(8_000),
    evidence: z.array(executiveEvidenceSchema).min(1).max(20),
    derivedContext: z.array(retrievedContextSchema).max(20).optional(),
    council: executiveCouncilContextSchema.optional(),
    background: z.boolean().default(false),
  })
  .superRefine((request, issue) => {
    if (
      request.council &&
      new TextEncoder().encode(JSON.stringify(request)).byteLength > 192 * 1024
    ) {
      issue.addIssue({
        code: "custom",
        path: ["council"],
        message: "Council worker request exceeds the 192 KiB ingress ceiling",
      });
    }
  });

export const executiveCouncilRecordSchema = z.object({
  id: uuid,
  kind: z.enum(["proposal", "review"]),
  summary: z.string().trim().min(1),
  actorWorkerId: uuid,
  recommendation: executiveRecommendationSchema,
  phase: executiveCouncilContributionPhaseSchema,
  roleId: uuid,
  inputRecordIds: z.array(uuid).min(1).max(32),
  peerRecordIds: z.array(uuid).max(10),
  providerJob: z.object({
    id: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    store: z.boolean(),
    background: z.boolean(),
  }),
});

export const executiveCouncilStateSchema = z.object({
  protocol: executiveCouncilProtocolSchema,
  installationId: uuid,
  work: z.object({
    id: uuid,
    title: z.string().trim().min(1),
    requestedOutcome: z.string().trim().min(1),
    acceptanceCriteria: z.array(z.string()),
    state: z.enum([
      "proposed",
      "ready",
      "leased",
      "blocked",
      "review",
      "completed",
      "cancelled",
    ]),
  }),
  authority: z.literal("none"),
  phase: z.enum(["proposal", "review", "synthesis", "complete"]),
  nextStep: z
    .object({
      phase: executiveCouncilContributionPhaseSchema,
      roleId: uuid,
      roleName: z.string().trim().min(1),
    })
    .nullable(),
  counts: z.object({
    proposals: z.number().int().min(0).max(5),
    reviews: z.number().int().min(0).max(5),
    syntheses: z.number().int().min(0).max(1),
    total: z.number().int().min(0).max(11),
    required: z.literal(11),
  }),
  roles: z
    .array(
      z.object({
        roleId: uuid,
        workerId: uuid,
        name: z.string().trim().min(1),
        version: z.number().int().positive(),
        status: z.enum(["awaiting_proposal", "awaiting_review", "complete"]),
        proposal: executiveCouncilRecordSchema.nullable(),
        review: executiveCouncilRecordSchema.nullable(),
      }),
    )
    .length(5),
  synthesis: executiveCouncilRecordSchema.nullable(),
});

export const workerJobStatusSchema = z.enum([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "incomplete",
]);

export const executiveWorkerJobSchema = z.object({
  jobId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  status: workerJobStatusSchema,
  store: z.boolean(),
  background: z.boolean(),
  installationId: uuid,
  workId: uuid,
  workerId: uuid,
  recommendation: executiveRecommendationSchema.optional(),
  error: z.string().trim().min(1).optional(),
});

export const executionAuthoritySchema = z.object({
  policyId: uuid,
  capabilityGrantId: uuid,
  approvalRecordId: uuid,
  executorWorkerId: uuid,
  capability: z.string().trim().min(1),
  mode: capabilityModeSchema,
});

export type DecisionClassification = z.infer<
  typeof decisionClassificationSchema
>;
export type ExecutiveStage = z.infer<typeof executiveStageSchema>;
export type ExecutiveRecommendation = z.infer<
  typeof executiveRecommendationSchema
>;
export type ExecutiveEvidence = z.infer<typeof executiveEvidenceSchema>;
export type ExecutiveWorkerJobRequest = z.infer<
  typeof executiveWorkerJobRequestSchema
>;
export type ExecutiveWorkerJob = z.infer<typeof executiveWorkerJobSchema>;
export type WorkerJobStatus = z.infer<typeof workerJobStatusSchema>;
export type ExecutionAuthority = z.infer<typeof executionAuthoritySchema>;
export type ExecutiveCouncilContext = z.infer<
  typeof executiveCouncilContextSchema
>;
export type ExecutiveCouncilPeerContext = z.infer<
  typeof executiveCouncilPeerContextSchema
>;
export type ExecutiveCouncilRecord = z.infer<
  typeof executiveCouncilRecordSchema
>;
export type ExecutiveCouncilState = z.infer<typeof executiveCouncilStateSchema>;
