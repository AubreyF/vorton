import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const canonicalSemver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
const immutableOciReference = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[a-f0-9]{64}$/,
  );
const immutableGhcrReference = z
  .string()
  .regex(
    /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)+@sha256:[a-f0-9]{64}$/,
  );
const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value
        .split("/")
        .some(
          (segment) => segment === ".." || segment === "." || segment === "",
        ),
    "must be a normalized relative path",
  );

function requiresWorkspaceReleaseEvidence(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 4;
}

const workspaceIsolationEvidenceSchema = z
  .object({
    contract: z.literal("vorton.workspace-isolation-proof.v1"),
    proof: z
      .object({
        path: relativePath,
        digest: sha256Digest,
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: relativePath,
            digest: sha256Digest,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const installationManifestSchema = z.object({
  apiVersion: z.literal("vorton.dev/v1alpha1"),
  kind: z.literal("Installation"),
  metadata: z.object({
    name: identifier,
  }),
  spec: z.object({
    realm: z.enum(["personal", "organizational"]),
    release: z.object({
      channel: z.enum(["pinned", "stable", "canary"]),
      version: canonicalSemver,
    }),
    modules: z.array(identifier).min(1),
    deployment: z.object({
      provider: z.literal("fly"),
      region: identifier,
    }),
    authority: z.object({
      canonicalRecords: z.literal("supabase-postgres"),
      derivedMemory: z.literal("hindsight"),
    }),
    factory: z.object({
      mode: z.literal("read-only"),
    }),
    tools: z.object({
      installed: z.array(identifier),
      examples: z.array(
        z.object({
          name: z.string().min(1),
          installed: z.literal(false),
        }),
      ),
    }),
    secrets: z.record(identifier, z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  }),
});

export type InstallationManifest = z.infer<typeof installationManifestSchema>;

export const releaseManifestSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(["candidate", "released"]),
    version: canonicalSemver,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    createdAt: z.string().datetime(),
    cliVersion: canonicalSemver,
    contracts: z
      .object({
        host: z.number().int().positive(),
        module: z.number().int().positive(),
        worker: z.number().int().positive(),
        workspace: z.literal(1).optional(),
      })
      .strict(),
    coreMigrationHead: z.string().min(1),
    evidence: z
      .object({ workspaceIsolation: workspaceIsolationEvidenceSchema })
      .strict()
      .optional(),
    images: z.record(
      identifier,
      z
        .object({
          reference: immutableOciReference,
          digest: sha256Digest,
        })
        .strict(),
    ),
    managedFiles: z
      .array(
        z
          .object({
            path: relativePath,
            template: relativePath,
            digest: sha256Digest,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const releasedImageNames = Object.keys(manifest.images).sort();
    const requiredReleasedImageNames =
      manifest.schemaVersion === 1
        ? ["control-plane", "worker"]
        : ["control-plane", "web", "worker"];
    if (
      manifest.status === "released" &&
      (releasedImageNames.length !== requiredReleasedImageNames.length ||
        releasedImageNames.some(
          (name, index) => name !== requiredReleasedImageNames[index],
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["images"],
        message: `released schema v${manifest.schemaVersion} manifests must contain exactly ${requiredReleasedImageNames.join(
          ", ",
        )} images`,
      });
    }
    for (const [name, image] of Object.entries(manifest.images)) {
      if (!image.reference.endsWith(`@${image.digest}`)) {
        context.addIssue({
          code: "custom",
          path: ["images", name, "reference"],
          message: "OCI references must be pinned to their declared digest",
        });
      }
      if (
        manifest.status === "released" &&
        !immutableGhcrReference.safeParse(image.reference).success
      ) {
        context.addIssue({
          code: "custom",
          path: ["images", name, "reference"],
          message: "released OCI references must use lowercase GHCR paths",
        });
      }
    }

    const paths = manifest.managedFiles.map((file) => file.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        path: ["managedFiles"],
        message: "managed file paths must be unique",
      });
    }

    const workspaceRelease = requiresWorkspaceReleaseEvidence(manifest.version);
    if (workspaceRelease && manifest.contracts.workspace !== 1) {
      context.addIssue({
        code: "custom",
        path: ["contracts", "workspace"],
        message:
          "Vorton 0.4.0 and later releases require workspace contract v1",
      });
    }
    if (workspaceRelease && !manifest.evidence?.workspaceIsolation) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "workspaceIsolation"],
        message:
          "Vorton 0.4.0 and later releases require workspace isolation evidence",
      });
    }
    if (
      workspaceRelease &&
      !/^[0-9]{14}_[a-z0-9_]+$/.test(manifest.coreMigrationHead)
    ) {
      context.addIssue({
        code: "custom",
        path: ["coreMigrationHead"],
        message:
          "Vorton 0.4.0 and later migration heads must be canonical basenames without .sql",
      });
    }

    const workspaceEvidence = manifest.evidence?.workspaceIsolation;
    if (workspaceEvidence) {
      const evidencePaths = [
        workspaceEvidence.proof.path,
        ...workspaceEvidence.files.map((file) => file.path),
      ];
      if (new Set(evidencePaths).size !== evidencePaths.length) {
        context.addIssue({
          code: "custom",
          path: ["evidence", "workspaceIsolation"],
          message: "workspace evidence paths must be unique",
        });
      }
      const evidenceDigests = workspaceEvidence.files.map(
        (file) => file.digest,
      );
      if (new Set(evidenceDigests).size !== evidenceDigests.length) {
        context.addIssue({
          code: "custom",
          path: ["evidence", "workspaceIsolation", "files"],
          message: "workspace evidence digests must be unique",
        });
      }
    }
  });

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const installationLockSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: z
      .object({
        version: canonicalSemver,
        sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
        manifestDigest: sha256Digest,
      })
      .strict(),
    images: z.record(
      identifier,
      z
        .object({
          reference: z.string().min(1),
          digest: sha256Digest,
        })
        .strict(),
    ),
    contracts: z
      .object({
        host: z.number().int().positive(),
        module: z.number().int().positive(),
        worker: z.number().int().positive(),
        workspace: z.literal(1).optional(),
      })
      .strict(),
    coreMigrationHead: z.string().min(1),
    managedFiles: z.record(z.string().min(1), sha256Digest),
    lastUpgradeEdge: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((lock, context) => {
    if (
      requiresWorkspaceReleaseEvidence(lock.release.version) &&
      lock.contracts.workspace !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["contracts", "workspace"],
        message:
          "Vorton 0.4.0 and later installation locks require workspace contract v1",
      });
    }
    if (
      requiresWorkspaceReleaseEvidence(lock.release.version) &&
      !/^[0-9]{14}_[a-z0-9_]+$/.test(lock.coreMigrationHead)
    ) {
      context.addIssue({
        code: "custom",
        path: ["coreMigrationHead"],
        message:
          "Vorton 0.4.0 and later migration heads must be canonical basenames without .sql",
      });
    }
  });

export type InstallationLock = z.infer<typeof installationLockSchema>;
