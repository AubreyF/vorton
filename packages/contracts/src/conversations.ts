import { z } from "zod";

import {
  admissionStateSchema,
  installationRealmSchema,
  sourceBoundarySchema,
  sourceCitationSchema,
} from "./memory.js";
import { dataClassificationSchema } from "./kernel.js";

export const transcriptProviderSchema = z.enum(["google-meet", "omi"]);

export const transcriptUtteranceSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  speaker: z.string().min(1).nullable(),
  text: z.string(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
});

export const transcriptRevisionSchema = z
  .object({
    id: z.string().uuid(),
    installationId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    installationRealm: installationRealmSchema,
    connectionId: z.string().uuid(),
    provider: transcriptProviderSchema,
    providerObjectId: z.string().min(1),
    revisionHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().nullable(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    participants: z.array(z.string().min(1)),
    utterances: z.array(transcriptUtteranceSchema),
    rawSourcePointer: z.string().min(1).nullable(),
    providerObservedAt: z.string().datetime(),
    ingestedAt: z.string().datetime(),
    adapterVersion: z.string().min(1),
    classification: dataClassificationSchema,
    completeness: z.enum(["complete", "partial", "unavailable"]),
    boundary: sourceBoundarySchema,
    admissionState: admissionStateSchema,
    deletedAt: z.string().datetime().nullable(),
    supersedesRevisionId: z.string().uuid().nullable(),
    citations: z.array(sourceCitationSchema).min(1),
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
        message: "mixed or cross-realm transcripts must be quarantined",
      });
    }
    revision.citations.forEach((citation, index) => {
      if (
        citation.sourceRevisionId !== revision.id ||
        citation.revisionHash !== revision.revisionHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["citations", index],
          message: "citation must resolve to this exact transcript revision",
        });
      }
    });
  });

export type TranscriptProvider = z.infer<typeof transcriptProviderSchema>;
export type TranscriptUtterance = z.infer<typeof transcriptUtteranceSchema>;
export type TranscriptRevision = z.infer<typeof transcriptRevisionSchema>;
