import { describe, expect, it } from "vitest";

import {
  releaseAdoptionApprovalDocumentSchema,
  releaseAdoptionApprovalRequestSchema,
  releaseAdoptionReleaseSchema,
  workspaceCreationApprovalDocumentSchema,
  workspaceCreationApprovalRequestSchema,
  workspaceCreationReceiptDocumentSchema,
} from "./installation-authority.js";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const uppercaseId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const release = {
  version: "1.0.0",
  sourceCommit: "a".repeat(40),
  manifestSha256: digest("1"),
  archiveSha256: digest("2"),
  coreMigrationHead: "20260830000300_installation_authority_api",
  workspaceIsolationProofSha256: digest("3"),
  workspaceIsolationProofHash: digest("4"),
  imageDigests: { api: digest("5") },
};

describe("installation authority contracts", () => {
  it("accepts strict release and workspace approval requests", () => {
    expect(
      releaseAdoptionApprovalRequestSchema.parse({
        approvalId: id,
        planHash: digest("6"),
        release,
        expiresAt: "2026-08-30T12:30:00.000Z",
      }),
    ).toBeTruthy();
    expect(
      workspaceCreationApprovalRequestSchema.parse({
        approvalId: id,
        workspace: {
          id: otherId,
          slug: "aubos",
          displayName: "AubOS cloud",
          realm: "personal",
        },
        releaseAdoptionReceiptId: otherId,
        releaseAdoptionReceiptSha256: digest("7"),
        workspacePlanSha256: digest("8"),
      }),
    ).toBeTruthy();
  });

  it("rejects unknown fields and substituted proof identities", () => {
    expect(() =>
      releaseAdoptionApprovalRequestSchema.parse({
        approvalId: id,
        planHash: digest("6"),
        release: {
          ...release,
          workspaceIsolationProofHash: release.workspaceIsolationProofSha256,
        },
        expiresAt: "2026-08-30T12:30:00.000Z",
        workspaceId: otherId,
      }),
    ).toThrow();
  });

  it("rejects noncanonical uppercase UUIDs at every request identity", () => {
    const releaseRequest = {
      approvalId: id,
      planHash: digest("6"),
      release,
      expiresAt: "2026-08-30T12:30:00.000Z",
    };
    expect(() =>
      releaseAdoptionApprovalRequestSchema.parse({
        ...releaseRequest,
        approvalId: uppercaseId,
      }),
    ).toThrow();
    const workspaceRequest = {
      approvalId: id,
      workspace: {
        id: otherId,
        slug: "aubos",
        displayName: "AubOS cloud",
        realm: "personal",
      },
      releaseAdoptionReceiptId: otherId,
      releaseAdoptionReceiptSha256: digest("7"),
      workspacePlanSha256: digest("8"),
    };
    for (const candidate of [
      { ...workspaceRequest, approvalId: uppercaseId },
      {
        ...workspaceRequest,
        workspace: {
          ...workspaceRequest.workspace,
          id: uppercaseId,
        },
      },
      {
        ...workspaceRequest,
        releaseAdoptionReceiptId: uppercaseId,
      },
    ]) {
      expect(() =>
        workspaceCreationApprovalRequestSchema.parse(candidate),
      ).toThrow();
    }
  });

  it("uses the carrier canonical SemVer grammar", () => {
    for (const version of ["1.2.3-1a", "1.2.3+build.7"]) {
      expect(
        releaseAdoptionReleaseSchema.parse({ ...release, version }),
      ).toBeTruthy();
    }
    for (const version of ["0.04.0", "1.2.3-01"]) {
      expect(() =>
        releaseAdoptionReleaseSchema.parse({ ...release, version }),
      ).toThrow();
    }
  });

  it("cross-checks release projections and bounded timestamps", () => {
    const document = {
      contract: "vorton.release-adoption-approval.v1",
      approvalId: id,
      approvalPlane: "installation-postgres",
      installationId: otherId,
      approvedByPersonId: id,
      planHash: digest("6"),
      release,
      manifestSha256: release.manifestSha256,
      archiveSha256: release.archiveSha256,
      sourceCommit: release.sourceCommit,
      approvedAt: "2026-08-30T12:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
      assuranceLevel: "aal2",
      installationOwnerVerifiedAt: "2026-08-30T12:00:00.000Z",
      scope: {
        adoptRelease: true,
        installRelease: false,
        mutateInstallation: false,
        createWorkspace: false,
        createInfrastructure: false,
        inspectFreedos: false,
        personalSourceRead: false,
        dataMigration: false,
      },
    };
    expect(releaseAdoptionApprovalDocumentSchema.parse(document)).toBeTruthy();
    expect(
      releaseAdoptionApprovalDocumentSchema.parse({
        ...document,
        aal2VerifiedAt: "2026-08-30T12:00:30.000Z",
      }),
    ).toBeTruthy();
    expect(() =>
      releaseAdoptionApprovalDocumentSchema.parse({
        ...document,
        aal2VerifiedAt: "2026-08-30T12:01:01.000Z",
      }),
    ).toThrow();
    expect(() =>
      releaseAdoptionApprovalDocumentSchema.parse({
        ...document,
        manifestSha256: digest("9"),
      }),
    ).toThrow();
  });

  it("requires exact adopted release projection in workspace documents", () => {
    const document = {
      contract: "vorton.workspace-creation-approval.v1",
      approvalId: id,
      approvalPlane: "installation-postgres",
      installationId: otherId,
      approvedByPersonId: id,
      workspace: {
        id: otherId,
        slug: "aubos",
        displayName: "AubOS cloud",
        realm: "personal",
      },
      adoptedRelease: {
        adoptionReceiptId: otherId,
        adoptionReceiptSha256: digest("7"),
        receiptPlane: "installation-postgres",
        manifestSha256: release.manifestSha256,
        sourceCommit: release.sourceCommit,
        migrationHead: release.coreMigrationHead,
        workspaceIsolationProofSha256: release.workspaceIsolationProofSha256,
        workspaceIsolationProofHash: release.workspaceIsolationProofHash,
        status: "adopted",
        adoptedAt: "2026-08-30T11:00:00.000Z",
      },
      workspacePlanSha256: digest("8"),
      scope: "workspace.create",
      assuranceLevel: "aal2",
      aal2VerifiedAt: "2026-08-30T12:00:00.000Z",
      approvedAt: "2026-08-30T12:00:01.000Z",
      expiresAt: "2026-08-30T12:10:00.000Z",
    };
    expect(
      workspaceCreationApprovalDocumentSchema.parse(document),
    ).toBeTruthy();
    expect(() =>
      workspaceCreationApprovalDocumentSchema.parse({
        ...document,
        adoptedRelease: {
          ...document.adoptedRelease,
          status: "pending",
        },
      }),
    ).toThrow();
  });

  it("requires workspace receipt identity to differ from approval identity", () => {
    expect(() =>
      workspaceCreationReceiptDocumentSchema.parse({
        contract: "vorton.workspace-creation-receipt.v1",
        receiptId: id,
        receiptPlane: "installation-postgres",
        installationId: otherId,
        approvalId: id,
        workspaceId: otherId,
        ownerPersonId: id,
        releaseAdoptionReceiptId: otherId,
        releaseAdoptionReceiptSha256: digest("7"),
        sourceCommit: release.sourceCommit,
        workspacePlanSha256: digest("8"),
        status: "created",
        createdAt: "2026-08-30T12:00:00.000Z",
        approvalConsumedAt: "2026-08-30T12:00:00.000Z",
        approvalConsumptionCount: 1,
      }),
    ).toThrow();
  });
});
