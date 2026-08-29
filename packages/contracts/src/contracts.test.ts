import { describe, expect, it } from "vitest";

import {
  installationLockSchema,
  installationManifestSchema,
  releaseManifestSchema,
  workerAdvertisementSchema,
} from "./index.js";

describe("installation contracts", () => {
  it("accepts a synthetic installation manifest", () => {
    const result = installationManifestSchema.safeParse({
      apiVersion: "aubos.dev/v1alpha1",
      kind: "Installation",
      metadata: { name: "moonbase-lab" },
      spec: {
        release: { channel: "pinned", version: "0.1.0" },
        modules: ["tasks", "tools"],
        deployment: { provider: "fly", region: "sea" },
        secrets: { "database-url": "AUBOS_DATABASE_URL" },
      },
    });

    expect(result.success).toBe(true);
  });

  it("requires OCI image references to match exact digests", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const result = releaseManifestSchema.safeParse({
      schemaVersion: 1,
      status: "candidate",
      version: "0.1.0",
      sourceCommit: "b".repeat(40),
      createdAt: "2026-08-28T00:00:00.000Z",
      cliVersion: "0.1.0",
      sdkVersion: "0.1.0",
      contracts: { host: 1, module: 1, worker: 1 },
      coreMigrationHead: "0001_kernel",
      images: {
        control: {
          reference: `ghcr.io/example/control@${digest}`,
          digest,
        },
      },
      managedFiles: [],
    });

    expect(result.success).toBe(true);
  });

  it("records immutable image identities in installation locks", () => {
    const digest = `sha256:${"c".repeat(64)}`;
    const result = installationLockSchema.safeParse({
      schemaVersion: 1,
      release: {
        version: "0.1.0",
        sourceCommit: "d".repeat(40),
        manifestDigest: digest,
      },
      images: {
        control: {
          reference: `ghcr.io/example/control@${digest}`,
          digest,
        },
      },
      contracts: { host: 1, module: 1, worker: 1 },
      coreMigrationHead: "0001_kernel",
      managedFiles: {},
      lastUpgradeEdge: null,
    });

    expect(result.success).toBe(true);
  });

  it("requires workers to identify their billing and isolation boundaries", () => {
    const result = workerAdvertisementSchema.safeParse({
      workerId: "7fb46f09-3894-4c24-933c-77c7a403341c",
      installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
      provider: "synthetic",
      billingRealm: "test-only",
      host: "moon-1",
      runtime: "container",
      model: "fixture",
      capabilities: ["observe"],
      dataClassificationCeiling: "synthetic",
      isolation: "ephemeral-container",
      networkPolicy: "deny-all",
      health: "healthy",
    });

    expect(result.success).toBe(true);
  });
});
