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

export const workerAdvertisementSchema = z.object({
  workerId: z.string().uuid(),
  installationId: z.string().uuid(),
  provider: z.string().min(1),
  billingRealm: z.string().min(1),
  host: z.string().min(1),
  runtime: z.string().min(1),
  model: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  dataClassificationCeiling: z.string().min(1),
  isolation: z.string().min(1),
  networkPolicy: z.string().min(1),
  health: z.enum(["healthy", "degraded", "offline"]),
});

export type WorkerAdvertisement = z.infer<typeof workerAdvertisementSchema>;
