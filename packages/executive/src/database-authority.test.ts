import { describe, expect, it } from "vitest";

import type { Database, SqlExecutor } from "@vorton/database";

import { DatabaseExecutiveAuthorityVerifier } from "./database-authority.js";
import type { ExecutiveAuthorityVerification } from "./workflow.js";

class FakeDatabase {
  rows: Array<Record<string, unknown>> = [];
  statement: { text: string; values?: readonly unknown[] } | null = null;

  asPerson<T>(
    _context: { installationId: string; authUserId: string },
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row>(text: string, values?: readonly unknown[]) => {
        this.statement = { text, values };
        return { rows: this.rows as Row[], rowCount: this.rows.length };
      },
    });
  }
}

const verification = {
  installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  authority: {
    policyId: "d37f356b-6297-4cd1-902d-c2755423a612",
    capabilityGrantId: "4156f0af-e62f-4b16-a7bc-97c8301c2e2f",
    approvalRecordId: "4ca5148f-288a-4a59-90dc-1d03cc67ea5c",
    executorWorkerId: "b5611dc4-07e4-4388-a7d0-ddf7bb452499",
    capability: "executive.synthetic.check",
    mode: "diagnose" as const,
  },
  approval: { id: "approval" },
  decision: { id: "decision" },
  proposal: { id: "proposal", workId: "fbc4ac66-4a32-4a34-b810-88f4330205aa" },
  requester: {
    installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
  },
} as ExecutiveAuthorityVerification;

describe("database executive authority verifier", () => {
  it("requires owner authority for decisions and approvals", async () => {
    const database = new FakeDatabase();
    const verifier = new DatabaseExecutiveAuthorityVerifier(
      database as unknown as Database,
    );
    await expect(
      verifier.resolvePerson({
        installationId: verification.installationId,
        workspaceId: verification.workspaceId,
        authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
        requiredAuthority: "owner",
        operation: "approval",
      }),
    ).rejects.toThrow("Owner authority is required");

    database.rows = [{ id: "7fb46f09-3894-4c24-933c-77c7a403341c" }];
    await verifier.resolvePerson({
      installationId: verification.installationId,
      workspaceId: verification.workspaceId,
      authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
      requiredAuthority: "owner",
      operation: "decision",
    });
    expect(database.statement?.text).toContain("auth_user_id = $3");
  });

  it("checks Policy, grant, executor, scope, expiry, and revocation", async () => {
    const database = new FakeDatabase();
    database.rows = [{ grant_id: verification.authority.capabilityGrantId }];
    await new DatabaseExecutiveAuthorityVerifier(
      database as unknown as Database,
    ).assertApplicable(verification);

    expect(database.statement?.text).toContain("grant.worker_id = $5");
    expect(database.statement?.text).toContain("grant.expires_at > now()");
    expect(database.statement?.text).toContain("capability_grant_revocations");
    expect(database.statement?.values).toEqual([
      verification.installationId,
      verification.workspaceId,
      verification.authority.capabilityGrantId,
      verification.authority.policyId,
      verification.authority.executorWorkerId,
      verification.authority.capability,
      verification.authority.mode,
      verification.proposal.workId,
    ]);
  });

  it("fails closed when no applicable grant exists", async () => {
    const database = new FakeDatabase();
    await expect(
      new DatabaseExecutiveAuthorityVerifier(
        database as unknown as Database,
      ).assertApplicable(verification),
    ).rejects.toThrow(
      "missing, expired, revoked, out of scope, or inapplicable",
    );
  });
});
