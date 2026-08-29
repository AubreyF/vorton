import { z } from "zod";

export const recordKindSchema = z.enum([
  "evidence",
  "proposal",
  "decision",
  "approval",
  "receipt",
  "outcome",
  "learning",
]);

export const workStateSchema = z.enum([
  "proposed",
  "ready",
  "leased",
  "blocked",
  "review",
  "completed",
  "cancelled",
]);

export const capabilityModeSchema = z.enum([
  "observe",
  "diagnose",
  "recommend",
  "modify",
  "approve",
  "publish",
  "verify",
]);

export const principalKindSchema = z.enum(["person", "worker"]);

export const personKindSchema = z.enum(["owner", "member"]);

export const dataClassificationSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "restricted",
  "synthetic",
]);

export const recordActorSchema = z
  .object({
    personId: z.string().uuid().optional(),
    workerId: z.string().uuid().optional(),
  })
  .refine((actor) => Boolean(actor.personId) !== Boolean(actor.workerId), {
    message: "A record must have exactly one person or worker actor",
  });

export const workInputSchema = z.object({
  installationId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  requestedOutcome: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).default([]),
  parentWorkId: z.string().uuid().nullable().default(null),
  priority: z.number().int().min(0).max(100).default(50),
});

export const recordInputSchema = z.object({
  installationId: z.string().uuid(),
  workId: z.string().uuid().nullable().default(null),
  kind: recordKindSchema,
  summary: z.string().trim().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  sourceUri: z.string().url().nullable().default(null),
  classification: dataClassificationSchema.default("internal"),
  supersedesRecordId: z.string().uuid().nullable().default(null),
});

export const capabilityGrantInputSchema = z.object({
  installationId: z.string().uuid(),
  policyId: z.string().uuid(),
  principalKind: principalKindSchema,
  principalId: z.string().uuid(),
  capability: z.string().trim().min(1),
  mode: capabilityModeSchema,
  workId: z.string().uuid().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
});

export const workerAdvertisementSchema = z.object({
  workerId: z.string().uuid(),
  installationId: z.string().uuid(),
  provider: z.string().min(1),
  billingRealm: z.string().min(1),
  host: z.string().min(1),
  runtime: z.string().min(1),
  model: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  dataClassificationCeiling: dataClassificationSchema,
  isolation: z.string().min(1),
  networkPolicy: z.string().min(1),
  health: z.enum(["healthy", "degraded", "offline"]),
});

export type WorkerAdvertisement = z.infer<typeof workerAdvertisementSchema>;
export type DataClassification = z.infer<typeof dataClassificationSchema>;
export type WorkInput = z.infer<typeof workInputSchema>;
export type RecordInput = z.infer<typeof recordInputSchema>;
export type CapabilityGrantInput = z.infer<typeof capabilityGrantInputSchema>;
