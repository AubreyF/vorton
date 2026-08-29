import { describe, expect, it } from "vitest";

import {
  executiveRecommendationSchema,
  installationLockSchema,
  recordActorSchema,
  recordInputSchema,
  installationManifestSchema,
  retrievedContextSchema,
  releaseManifestSchema,
  transcriptRevisionSchema,
  workerAdvertisementSchema,
  factoryReconciliationReceiptSchema,
} from "./index.js";

describe("installation contracts", () => {
  it("accepts a synthetic installation manifest", () => {
    const result = installationManifestSchema.safeParse({
      apiVersion: "aubos.dev/v1alpha1",
      kind: "Installation",
      metadata: { name: "moonbase-lab" },
      spec: {
        realm: "organizational",
        release: { channel: "pinned", version: "0.1.0" },
        modules: ["tasks", "tools"],
        deployment: { provider: "fly", region: "sea" },
        authority: {
          canonicalRecords: "supabase-postgres",
          derivedMemory: "hindsight",
        },
        factory: { mode: "read-only" },
        tools: {
          installed: [],
          examples: [{ name: "Moonbase Triage", installed: false }],
        },
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

  it("accepts recommendations without mistaking them for authority", () => {
    const result = executiveRecommendationSchema.safeParse({
      summary: "Test a synthetic launch sequence.",
      evidenceRecordIds: ["7fb46f09-3894-4c24-933c-77c7a403341c"],
      alternatives: [
        {
          title: "Run the simulation",
          description: "Use the offline fixture.",
          expectedOutcome: "A comparable receipt exists.",
          risks: ["The fixture may be incomplete."],
        },
      ],
      recommendedAction: {
        title: "Run offline simulation",
        description: "Execute the synthetic launch fixture.",
        capability: "moonbase.simulation.run",
        mode: "modify",
        externalEffect: false,
      },
      confidence: 0.72,
      uncertainties: ["No live telemetry is connected."],
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("policyId");
    expect(result.data).not.toHaveProperty("capabilityGrantId");
  });

  it("marks retrieved memory as derived and untrusted", () => {
    expect(
      retrievedContextSchema.safeParse({
        text: "Synthetic context",
        trust: "untrusted",
        derived: true,
        citations: [
          {
            sourceRevisionId: "11111111-1111-4111-a111-111111111111",
            sourceUri: "synthetic://conversation/1",
            revisionHash: "a".repeat(64),
            locator: "utterance:0",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      retrievedContextSchema.safeParse({
        text: "Synthetic context",
        trust: "trusted",
        derived: true,
        citations: [],
      }).success,
    ).toBe(false);
  });

  it("accepts a provider-neutral synthetic transcript revision", () => {
    expect(
      transcriptRevisionSchema.safeParse({
        id: "11111111-1111-4111-a111-111111111111",
        installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
        installationRealm: "organizational",
        connectionId: "0dd9b2cc-b44c-4039-a1fc-5226b5d9bb06",
        provider: "google-meet",
        providerObjectId: "synthetic-meeting",
        revisionHash: "a".repeat(64),
        title: "Synthetic meeting",
        startedAt: "2026-08-28T11:00:00.000Z",
        endedAt: null,
        participants: ["Synthetic Ada"],
        utterances: [],
        rawSourcePointer: null,
        providerObservedAt: "2026-08-28T11:30:00.000Z",
        ingestedAt: "2026-08-28T12:00:00.000Z",
        adapterVersion: "fixture-v1",
        classification: "synthetic",
        completeness: "partial",
        boundary: "organizational",
        admissionState: "pending",
        deletedAt: null,
        supersedesRevisionId: null,
        citations: [
          {
            sourceRevisionId: "11111111-1111-4111-a111-111111111111",
            sourceUri: "google-meet://synthetic-meeting",
            revisionHash: "a".repeat(64),
            locator: "transcript",
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("binds Factory receipts to exact source and authority generations", () => {
    expect(
      factoryReconciliationReceiptSchema.safeParse({
        schemaVersion: 1,
        installationWorkId: "WORK-MOONBASE-42",
        repositoryTicketId: "github:moonbase-lab/launch-control#42",
        outcome: "blocked",
        sourceHead: "e8f63827e20c5f0625fe8ef505f3b95c8f310623",
        cursor: {
          provider: "github",
          repository: "moonbase-lab/launch-control",
          observedAt: "2026-08-29T00:33:00.000Z",
          ticketRevision: "issue-42@2026-08-28T20:56:36Z",
          executionRevision: "authority-generation-conflict",
        },
        authority: {
          ticket: "github",
          claim: "repository-execution",
          lease: "repository-execution",
          branch: "repository-execution",
          pullRequest: "repository-execution",
          checks: "github",
          publication: "repository-execution",
          recovery: "repository-execution",
        },
        blockers: ["authority_generation_conflict"],
      }).success,
    ).toBe(true);
  });
});
