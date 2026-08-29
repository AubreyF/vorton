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
  description: z.string().trim().min(1),
  capability: z.string().trim().min(1),
  mode: capabilityModeSchema,
  externalEffect: z.boolean(),
});

export const executiveAlternativeSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1),
  expectedOutcome: z.string().trim().min(1),
  risks: z.array(z.string().trim().min(1)),
});

export const executiveRecommendationSchema = z.object({
  summary: z.string().trim().min(1),
  evidenceRecordIds: z.array(uuid).min(1),
  alternatives: z.array(executiveAlternativeSchema).min(1),
  recommendedAction: recommendedActionSchema,
  confidence: z.number().min(0).max(1),
  uncertainties: z.array(z.string().trim().min(1)),
});

export const executiveRoleSchema = z.object({
  roleId: uuid,
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  skillMarkdown: z.string().trim().min(1),
});

export const executiveEvidenceSchema = z.object({
  recordId: uuid,
  summary: z.string().trim().min(1),
  sourceUri: z.string().url().nullable(),
  classification: dataClassificationSchema,
});

export const executiveWorkerJobRequestSchema = z.object({
  installationId: uuid,
  workId: uuid,
  workerId: uuid,
  role: executiveRoleSchema,
  objective: z.string().trim().min(1),
  evidence: z.array(executiveEvidenceSchema).min(1),
  derivedContext: z.array(retrievedContextSchema).optional(),
  background: z.boolean().default(false),
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
export type ExecutiveWorkerJobRequest = z.infer<
  typeof executiveWorkerJobRequestSchema
>;
export type ExecutiveWorkerJob = z.infer<typeof executiveWorkerJobSchema>;
export type WorkerJobStatus = z.infer<typeof workerJobStatusSchema>;
export type ExecutionAuthority = z.infer<typeof executionAuthoritySchema>;
