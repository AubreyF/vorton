import { z } from "zod";

export const factoryAuthorityOwnerSchema = z.enum([
  "github",
  "repository-execution",
  "aubos",
]);

export const factoryAuthorityMapSchema = z.object({
  ticket: factoryAuthorityOwnerSchema,
  claim: factoryAuthorityOwnerSchema,
  lease: factoryAuthorityOwnerSchema,
  branch: factoryAuthorityOwnerSchema,
  pullRequest: factoryAuthorityOwnerSchema,
  checks: factoryAuthorityOwnerSchema,
  publication: factoryAuthorityOwnerSchema,
  recovery: factoryAuthorityOwnerSchema,
});

export const factoryReconciliationCursorSchema = z.object({
  provider: z.string().min(1),
  repository: z.string().min(1),
  observedAt: z.string().datetime(),
  ticketRevision: z.string().min(1),
  executionRevision: z.string().min(1),
});

export const factoryReconciliationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  installationWorkId: z.string().min(1),
  repositoryTicketId: z.string().min(1),
  outcome: z.enum(["observed", "blocked", "authority-conflict"]),
  sourceHead: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable(),
  cursor: factoryReconciliationCursorSchema,
  authority: factoryAuthorityMapSchema,
  blockers: z.array(z.string()),
});

export type FactoryAuthorityMap = z.infer<typeof factoryAuthorityMapSchema>;
export type FactoryReconciliationCursor = z.infer<
  typeof factoryReconciliationCursorSchema
>;
export type FactoryReconciliationReceipt = z.infer<
  typeof factoryReconciliationReceiptSchema
>;
