import { describe, expect, it } from "vitest";
import {
  moduleLifecycleApprovalCoreSchema,
  moduleLifecycleCanonicalSha256,
  type ModuleLifecycleActionApprovalRequest,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import { StepUpAuthenticationError } from "./auth.js";
import {
  DatabaseModuleLifecycleAuthority,
  ModuleLifecycleAuthorityConflictError,
  ModuleLifecycleAuthorityForbiddenError,
  ModuleLifecycleAuthorityInputError,
  ModuleLifecycleAuthorityIntegrityError,
  requireModuleLifecycleRecentAal2,
} from "./module-lifecycle-authority.js";

const ids = {
  approval: "11111111-1111-4111-8111-111111111111",
  installation: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  owner: "44444444-4444-4444-8444-444444444444",
  backup: "55555555-5555-4555-8555-555555555555",
  encryptionKey: "66666666-6666-4666-8666-666666666666",
  approvalRecord: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  approvalReceipt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  authUser: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const request: ModuleLifecycleActionApprovalRequest = {
  approvalId: ids.approval,
  binding: {
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    realm: "personal",
    module: "tasks",
    sequence: 1,
    migrationPlanHash: digest("1"),
    sourceSnapshotSha256: digest("2"),
    targetPreimageSha256: digest("3"),
    targetPostimageSha256: digest("4"),
    target: {
      action: "backup",
      backupId: ids.backup,
      storageObjectKey: "tasks/sequence-1/preimage.enc",
      encryptionKeyBindingId: ids.encryptionKey,
    },
  },
  expiresAt: "2026-08-30T13:00:00.000Z",
};

async function approvalCreation(
  exactRequest: ModuleLifecycleActionApprovalRequest = request,
) {
  const core = moduleLifecycleApprovalCoreSchema.parse({
    contract: "vorton.module-lifecycle-action-approval.v1",
    approvalId: exactRequest.approvalId,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    ownerPersonId: ids.owner,
    binding: exactRequest.binding,
    approvedAt: "2026-08-30T12:00:00.000Z",
    expiresAt: exactRequest.expiresAt,
    aal2VerifiedAt: "2026-08-30T11:55:00.000Z",
    assuranceLevel: "aal2",
    workspaceMembershipVerifiedAt: "2026-08-30T12:00:00.000Z",
    scope: {
      action: exactRequest.binding.target.action,
      moduleOnly: true,
      otherWorkspaceMutation: false,
      productionDeletion: false,
    },
    rolesGrantAuthority: false,
  });
  const approvalHash = await moduleLifecycleCanonicalSha256(core);
  const receiptWithoutHash = {
    contract: "vorton.module-lifecycle-approval-receipt.v1" as const,
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres" as const,
    approvalId: exactRequest.approvalId,
    approvalHash,
    binding: exactRequest.binding,
    action: exactRequest.binding.target.action,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    approvedAt: core.approvedAt,
    createdAt: core.approvedAt,
    liveMembershipCheckedAt: core.approvedAt,
    aal2VerifiedAt: core.aal2VerifiedAt,
    assuranceLevel: "aal2" as const,
    effects: {
      actionExecuted: false as const,
      approvalConsumed: false as const,
      workspaceMutated: false as const,
      moduleDataMutated: false as const,
      externalSystemMutated: false as const,
    },
  };
  const receiptHash = await moduleLifecycleCanonicalSha256(receiptWithoutHash);
  return {
    approval: {
      ...core,
      approvalReceiptId: ids.approvalReceipt,
      approvalReceiptSha256: receiptHash,
    },
    receipt: { ...receiptWithoutHash, receiptHash },
  };
}

const recentIdentity = () => ({
  authUserId: ids.authUser,
  aal: "aal2" as const,
  authTime: Math.floor(Date.now() / 1_000) - 60,
});

describe("module lifecycle approval database adapter", () => {
  it("creates and verifies both atomic documents inside a signed workspace transaction", async () => {
    const contexts: unknown[] = [];
    const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
    const creation = await approvalCreation();
    const database = {
      asWorkspacePersonWithStepUp: async (
        context: unknown,
        work: (transaction: {
          query: (sql: string, values: readonly unknown[]) => Promise<unknown>;
        }) => Promise<unknown>,
      ) => {
        contexts.push(context);
        return work({
          query: async (sql, values) => {
            queries.push({ sql, values });
            return { rows: [{ creation }], rowCount: 1 };
          },
        });
      },
    } as unknown as Database;
    const identity = recentIdentity();

    await expect(
      new DatabaseModuleLifecycleAuthority(database).approve(
        ids.installation,
        ids.workspace,
        request,
        identity,
      ),
    ).resolves.toEqual(creation);
    expect(contexts).toEqual([
      {
        authUserId: ids.authUser,
        vortonInstallationId: ids.installation,
        workspaceId: ids.workspace,
        aal: "aal2",
        authTime: identity.authTime,
      },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain(
      "public.create_module_lifecycle_action_approval",
    );
    expect(queries[0]?.values).toEqual([
      request.approvalId,
      ids.installation,
      ids.workspace,
      request.binding,
      request.expiresAt,
    ]);
  });

  it("requires AAL2 at or before now and no more than ten minutes old", async () => {
    const now = Math.floor(Date.now() / 1_000);
    expect(() =>
      requireModuleLifecycleRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: now },
        now,
      ),
    ).not.toThrow();
    for (const identity of [
      { authUserId: ids.authUser, aal: "aal1" as const, authTime: now },
      { authUserId: ids.authUser, aal: "aal2" as const, authTime: undefined },
      { authUserId: ids.authUser, aal: "aal2" as const, authTime: now + 1 },
      { authUserId: ids.authUser, aal: "aal2" as const, authTime: now - 601 },
    ]) {
      expect(() => requireModuleLifecycleRecentAal2(identity, now)).toThrow(
        StepUpAuthenticationError,
      );
    }
  });

  it("rejects invalid or cross-workspace input before opening a transaction", async () => {
    let entered = 0;
    const database = {
      asWorkspacePersonWithStepUp: async () => {
        entered += 1;
      },
    } as unknown as Database;
    const authority = new DatabaseModuleLifecycleAuthority(database);
    for (const candidate of [
      {
        ...request,
        approvalId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      {
        ...request,
        binding: { ...request.binding, workspaceId: crypto.randomUUID() },
      },
      {
        ...request,
        binding: {
          ...request.binding,
          target: { ...request.binding.target, action: "rehearsal" },
        },
      },
    ]) {
      await expect(
        authority.approve(
          ids.installation,
          ids.workspace,
          candidate as ModuleLifecycleActionApprovalRequest,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(ModuleLifecycleAuthorityInputError);
    }
    expect(entered).toBe(0);
  });

  it("rolls back malformed, hash-invalid, or request-spliced database results", async () => {
    const valid = await approvalCreation();
    const crossBound = await approvalCreation({
      ...request,
      binding: { ...request.binding, module: "notes" },
    });
    const invalidResults = [
      {
        rows: [{ creation: { contract: "not-a-lifecycle-creation" } }],
        rowCount: 1,
      },
      {
        rows: [
          {
            creation: {
              ...valid,
              approval: {
                ...valid.approval,
                approvalReceiptSha256: digest("f"),
              },
              receipt: { ...valid.receipt, receiptHash: digest("f") },
            },
          },
        ],
        rowCount: 1,
      },
      { rows: [{ creation: crossBound }], rowCount: 1 },
      {
        rows: [{ creation: valid }, { creation: valid }],
        rowCount: 2,
      },
    ];
    const committed: unknown[] = [];

    for (const invalidResult of invalidResults) {
      const database = {
        asWorkspacePersonWithStepUp: async (
          _context: unknown,
          work: (transaction: {
            query: () => Promise<unknown>;
          }) => Promise<unknown>,
        ) => {
          const staged = { approvalId: request.approvalId };
          const result = await work({
            query: async () => invalidResult,
          });
          committed.push(staged);
          return result;
        },
      } as unknown as Database;
      await expect(
        new DatabaseModuleLifecycleAuthority(database).approve(
          ids.installation,
          ids.workspace,
          request,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(ModuleLifecycleAuthorityIntegrityError);
    }
    expect(committed).toEqual([]);
  });

  it("maps only the named database authority failures", async () => {
    const cases = [
      [
        "Signed workspace-person AAL2 context is required to approve module lifecycle action",
        ModuleLifecycleAuthorityForbiddenError,
      ],
      [
        "Exact module lifecycle binding is invalid",
        ModuleLifecycleAuthorityInputError,
      ],
      [
        "Module lifecycle approval retry conflicts with immutable authority",
        ModuleLifecycleAuthorityConflictError,
      ],
    ] as const;
    for (const [message, ErrorClass] of cases) {
      const database = {
        asWorkspacePersonWithStepUp: async () => {
          throw Object.assign(new Error(message), { code: "P0001" });
        },
      } as unknown as Database;
      await expect(
        new DatabaseModuleLifecycleAuthority(database).approve(
          ids.installation,
          ids.workspace,
          request,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(ErrorClass);
    }

    const internal = Object.assign(new Error("Unexpected lifecycle failure"), {
      code: "P0001",
    });
    const database = {
      asWorkspacePersonWithStepUp: async () => {
        throw internal;
      },
    } as unknown as Database;
    await expect(
      new DatabaseModuleLifecycleAuthority(database).approve(
        ids.installation,
        ids.workspace,
        request,
        recentIdentity(),
      ),
    ).rejects.toBe(internal);
  });
});
