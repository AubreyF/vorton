import { describe, expect, it } from "vitest";
import type { Database } from "@vorton/database";

import {
  DatabaseInstallationAuthority,
  InstallationAuthorityForbiddenError,
  InstallationAuthorityInputError,
  InstallationAuthorityIntegrityError,
} from "./installation-authority.js";

const installationId = "11111111-1111-4111-8111-111111111111";
const approvalId = "22222222-2222-4222-8222-222222222222";
const personId = "33333333-3333-4333-8333-333333333333";
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

describe("installation authority database adapter", () => {
  it("enters the signed step-up transaction and cross-checks the exact release", async () => {
    const contexts: unknown[] = [];
    const authTime = Math.floor(Date.now() / 1000) - 60;
    const database = {
      asInstallationPersonWithStepUp: async (
        context: unknown,
        work: (transaction: {
          query: (sql: string, values: unknown[]) => Promise<unknown>;
        }) => Promise<unknown>,
      ) => {
        contexts.push(context);
        return work({
          query: async (_sql, values) => ({
            rows: [
              {
                document: {
                  contract: "vorton.release-adoption-approval.v1",
                  approvalId,
                  approvalPlane: "installation-postgres",
                  installationId,
                  approvedByPersonId: personId,
                  planHash: digest("6"),
                  release,
                  manifestSha256: release.manifestSha256,
                  archiveSha256: release.archiveSha256,
                  sourceCommit: release.sourceCommit,
                  approvedAt: "2026-08-30T12:00:00.000Z",
                  expiresAt: values[4],
                  aal2VerifiedAt: "2026-08-30T11:59:00.000Z",
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
                },
              },
            ],
            rowCount: 1,
          }),
        });
      },
    } as unknown as Database;
    const authority = new DatabaseInstallationAuthority(database);
    await expect(
      authority.approveRelease(
        installationId,
        {
          approvalId,
          planHash: digest("6"),
          release,
          expiresAt: "2026-08-30T13:00:00.000Z",
        },
        {
          authUserId: "44444444-4444-4444-8444-444444444444",
          aal: "aal2",
          authTime,
        },
      ),
    ).resolves.toMatchObject({ approvalId, installationId });
    expect(contexts).toEqual([
      {
        authUserId: "44444444-4444-4444-8444-444444444444",
        installationId,
        aal: "aal2",
        authTime,
      },
    ]);
  });

  it("rolls back when the database serializer is malformed or cross-bound", async () => {
    const committed: unknown[] = [];
    const validDocument = {
      contract: "vorton.release-adoption-approval.v1",
      approvalId,
      approvalPlane: "installation-postgres",
      installationId,
      approvedByPersonId: personId,
      planHash: digest("6"),
      release,
      manifestSha256: release.manifestSha256,
      archiveSha256: release.archiveSha256,
      sourceCommit: release.sourceCommit,
      approvedAt: "2026-08-30T12:00:00.000Z",
      expiresAt: "2026-08-30T13:00:00.000Z",
      aal2VerifiedAt: "2026-08-30T11:59:00.000Z",
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
    for (const document of [
      { contract: "wrong" },
      { ...validDocument, approvalId: crypto.randomUUID() },
    ]) {
      const database = {
        asInstallationPersonWithStepUp: async (
          _context: unknown,
          work: (transaction: {
            query: () => Promise<unknown>;
          }) => Promise<unknown>,
        ) => {
          const staged = { approvalId };
          const result = await work({
            query: async () => ({
              rows: [{ document }],
              rowCount: 1,
            }),
          });
          committed.push(staged);
          return result;
        },
      } as unknown as Database;
      await expect(
        new DatabaseInstallationAuthority(database).approveRelease(
          installationId,
          {
            approvalId,
            planHash: digest("6"),
            release,
            expiresAt: "2026-08-30T13:00:00.000Z",
          },
          {
            authUserId: personId,
            aal: "aal2",
            authTime: Math.floor(Date.now() / 1000) - 60,
          },
        ),
      ).rejects.toBeInstanceOf(InstallationAuthorityIntegrityError);
    }
    expect(committed).toEqual([]);
  });

  it("denies aal1, stale, and future identities before signing database context", async () => {
    let entered = 0;
    const database = {
      asInstallationPersonWithStepUp: async () => {
        entered += 1;
        throw new Error("must not enter database context");
      },
    } as unknown as Database;
    const authority = new DatabaseInstallationAuthority(database);
    const now = Math.floor(Date.now() / 1000);
    const request = {
      approvalId,
      planHash: digest("6"),
      release,
      expiresAt: "2026-08-30T13:00:00.000Z",
    };
    for (const identity of [
      { authUserId: personId, aal: "aal1" as const, authTime: now },
      { authUserId: personId, aal: "aal2" as const, authTime: now - 601 },
      { authUserId: personId, aal: "aal2" as const, authTime: now + 61 },
    ]) {
      await expect(
        authority.approveRelease(installationId, request, identity),
      ).rejects.toBeInstanceOf(InstallationAuthorityForbiddenError);
    }
    expect(entered).toBe(0);
  });

  it("rejects uppercase request UUIDs before entering database context", async () => {
    let entered = 0;
    const database = {
      asInstallationPersonWithStepUp: async () => {
        entered += 1;
      },
    } as unknown as Database;
    await expect(
      new DatabaseInstallationAuthority(database).approveRelease(
        installationId,
        {
          approvalId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          planHash: digest("6"),
          release,
          expiresAt: "2026-08-30T13:00:00.000Z",
        },
        {
          authUserId: personId,
          aal: "aal2",
          authTime: Math.floor(Date.now() / 1000) - 60,
        },
      ),
    ).rejects.toBeInstanceOf(InstallationAuthorityInputError);
    expect(entered).toBe(0);
  });

  it("does not misclassify unrelated internal approval errors", async () => {
    const database = {
      asInstallationPersonWithStepUp: async () => {
        throw new Error("internal approval cache exploded");
      },
    } as unknown as Database;
    await expect(
      new DatabaseInstallationAuthority(database).approveRelease(
        installationId,
        {
          approvalId,
          planHash: digest("6"),
          release,
          expiresAt: "2026-08-30T13:00:00.000Z",
        },
        {
          authUserId: personId,
          aal: "aal2",
          authTime: Math.floor(Date.now() / 1000) - 60,
        },
      ),
    ).rejects.toThrow("internal approval cache exploded");
  });
});
