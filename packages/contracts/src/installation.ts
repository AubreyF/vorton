import { z } from "zod";

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const installationManifestSchema = z.object({
  apiVersion: z.literal("aubos.dev/v1alpha1"),
  kind: z.literal("Installation"),
  metadata: z.object({
    name: identifier,
  }),
  spec: z.object({
    release: z.object({
      channel: z.enum(["pinned", "stable", "canary"]),
      version: z.string().min(1),
    }),
    modules: z.array(identifier).min(1),
    deployment: z.object({
      provider: z.literal("fly"),
      region: identifier,
    }),
    secrets: z.record(identifier, z.string().min(1)),
  }),
});

export type InstallationManifest = z.infer<typeof installationManifestSchema>;

export const installationLockSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  release: z.object({
    version: z.string().min(1),
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  images: z.record(identifier, z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  contracts: z.object({
    host: z.number().int().positive(),
    module: z.number().int().positive(),
    worker: z.number().int().positive(),
  }),
  coreMigrationHead: z.string().min(1),
  managedFiles: z.record(
    z.string().min(1),
    z.string().regex(/^sha256:[a-f0-9]{64}$/),
  ),
  lastUpgradeEdge: z.string().min(1).nullable(),
});

export type InstallationLock = z.infer<typeof installationLockSchema>;
