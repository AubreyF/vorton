import { z } from "zod";

import { dataClassificationSchema, type DataClassification } from "./kernel.js";

export const installationRealmSchema = z.enum(["personal", "organizational"]);
export const sourceBoundarySchema = z.enum([
  "personal",
  "organizational",
  "mixed",
]);
export const admissionStateSchema = z.enum([
  "pending",
  "admitted",
  "quarantined",
  "rejected",
]);

export const sourceCitationSchema = z.object({
  sourceRevisionId: z.string().uuid(),
  sourceUri: z.string().min(1),
  revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().min(1),
});

export const sourceRevisionSchema = z
  .object({
    id: z.string().uuid(),
    installationId: z.string().uuid(),
    installationRealm: installationRealmSchema,
    sourceType: z.string().min(1),
    sourceObjectId: z.string().min(1),
    sourceUri: z.string().min(1),
    revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
    classification: dataClassificationSchema,
    boundary: sourceBoundarySchema,
    admissionState: admissionStateSchema,
    observedAt: z.string().datetime(),
    supersedesRevisionId: z.string().uuid().nullable(),
    deletedAt: z.string().datetime().nullable(),
  })
  .superRefine((revision, context) => {
    if (
      (revision.boundary === "mixed" ||
        revision.boundary !== revision.installationRealm) &&
      revision.admissionState !== "quarantined"
    ) {
      context.addIssue({
        code: "custom",
        path: ["admissionState"],
        message: "mixed or cross-realm sources must be quarantined",
      });
    }
  });

export const retrievedContextSchema = z.object({
  text: z.string(),
  trust: z.literal("untrusted"),
  derived: z.literal(true),
  classification: dataClassificationSchema,
  citations: z.array(sourceCitationSchema).min(1),
});

const classificationRank: Record<
  Exclude<DataClassification, "synthetic">,
  number
> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

/**
 * Derives the classification for material supported by multiple sources.
 * Synthetic remains synthetic only when every source is synthetic. Any real
 * source wins, and the most restrictive real source determines the result.
 */
export function deriveDataClassification(
  classifications: readonly DataClassification[],
): DataClassification {
  if (classifications.length === 0) {
    throw new Error(
      "Derived classification requires at least one supporting source",
    );
  }
  const realClassifications = classifications.filter(
    (classification) => classification !== "synthetic",
  );
  if (realClassifications.length === 0) return "synthetic";
  return realClassifications.reduce((mostRestrictive, classification) =>
    classificationRank[classification] > classificationRank[mostRestrictive]
      ? classification
      : mostRestrictive,
  );
}

export const retrievalReceiptSchema = z.object({
  id: z.string().uuid(),
  installationId: z.string().uuid(),
  bankId: z.string().min(1),
  queryHash: z.string().regex(/^[a-f0-9]{64}$/),
  resultIds: z.array(z.string().min(1)),
  sourceRevisionIds: z.array(z.string().uuid()),
  retrievedAt: z.string().datetime(),
});

export type InstallationRealm = z.infer<typeof installationRealmSchema>;
export type SourceBoundary = z.infer<typeof sourceBoundarySchema>;
export type AdmissionState = z.infer<typeof admissionStateSchema>;
export type SourceCitation = z.infer<typeof sourceCitationSchema>;
export type SourceRevision = z.infer<typeof sourceRevisionSchema>;
export type RetrievedContext = z.infer<typeof retrievedContextSchema>;
export type RetrievalReceipt = z.infer<typeof retrievalReceiptSchema>;
