import { describe, expect, it } from "vitest";

import {
  recordActorSchema,
  recordInputSchema,
  installationManifestSchema,
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

  it("requires exactly one attributable record actor", () => {
    expect(
      recordActorSchema.safeParse({
        personId: "7fb46f09-3894-4c24-933c-77c7a403341c",
      }).success,
    ).toBe(true);
    expect(recordActorSchema.safeParse({}).success).toBe(false);
    expect(
      recordActorSchema.safeParse({
        personId: "7fb46f09-3894-4c24-933c-77c7a403341c",
        workerId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
      }).success,
    ).toBe(false);
  });

  it("accepts a synthetic append-only record payload", () => {
    expect(
      recordInputSchema.safeParse({
        installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
        kind: "evidence",
        summary: "Synthetic worker completed an offline check.",
        payload: { fixture: true },
        classification: "synthetic",
      }).success,
    ).toBe(true);
  });
});
