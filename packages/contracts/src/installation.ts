import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
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
      !value.split("/").some((segment) => segment === ".." || segment === ""),
    "must be a normalized relative path",
  );

export const installationManifestSchema = z.object({
  apiVersion: z.literal("aubos.dev/v1alpha1"),
  kind: z.literal("Installation"),
  metadata: z.object({
    name: identifier,
  }),
  spec: z.object({
    realm: z.enum(["personal", "organizational"]),
    release: z.object({
      channel: z.enum(["pinned", "stable", "canary"]),
      version: z.string().min(1),
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
    schemaVersion: z.literal(1),
    status: z.enum(["candidate", "released"]),
    version: z.string().min(1),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    createdAt: z.string().datetime(),
    cliVersion: z.string().min(1),
    contracts: z.object({
      host: z.number().int().positive(),
      module: z.number().int().positive(),
      worker: z.number().int().positive(),
    }),
    coreMigrationHead: z.string().min(1),
    images: z.record(
      identifier,
      z.object({
        reference: immutableGhcrReference,
        digest: sha256Digest,
      }),
    ),
    managedFiles: z
      .array(
        z.object({
          path: relativePath,
          template: relativePath,
          digest: sha256Digest,
        }),
      )
      .min(1),
  })
  .superRefine((manifest, context) => {
    const releasedImageNames = Object.keys(manifest.images).sort();
    if (
      manifest.status === "released" &&
      (releasedImageNames.length !== 2 ||
        releasedImageNames[0] !== "control-plane" ||
        releasedImageNames[1] !== "worker")
    ) {
      context.addIssue({
        code: "custom",
        path: ["images"],
        message:
          "released manifests must contain exactly control-plane and worker images",
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
    }

    const paths = manifest.managedFiles.map((file) => file.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        path: ["managedFiles"],
        message: "managed file paths must be unique",
      });
    }
  });

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const installationLockSchema = z.object({
  schemaVersion: z.literal(1),
  release: z.object({
    version: z.string().min(1),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    manifestDigest: sha256Digest,
  }),
  images: z.record(
    identifier,
    z.object({
      reference: z.string().min(1),
      digest: sha256Digest,
    }),
  ),
  contracts: z.object({
    host: z.number().int().positive(),
    module: z.number().int().positive(),
    worker: z.number().int().positive(),
  }),
  coreMigrationHead: z.string().min(1),
  managedFiles: z.record(z.string().min(1), sha256Digest),
  lastUpgradeEdge: z.string().min(1).nullable(),
});

export type InstallationLock = z.infer<typeof installationLockSchema>;
