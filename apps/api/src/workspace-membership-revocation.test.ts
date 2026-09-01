import { describe, expect, it } from "vitest";

import {
  hashWorkspaceMembershipRevocationApprovalCore,
  hashWorkspaceMembershipRevocationApprovalReceipt,
  hashWorkspaceMembershipRevocationReceipt,
  type WorkspaceMembershipRevocationApprovalCreation,
  type WorkspaceMembershipRevocationApprovalRequest,
  type WorkspaceMembershipRevocationReceipt,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";

import { StepUpAuthenticationError } from "./auth.js";
import {
  DatabaseWorkspaceMembershipRevocationAuthority,
  WorkspaceMembershipRevocationConflictError,
  WorkspaceMembershipRevocationForbiddenError,
  WorkspaceMembershipRevocationInputError,
  WorkspaceMembershipRevocationIntegrityError,
  requireWorkspaceMembershipRevocationRecentAal2,
} from "./workspace-membership-revocation.js";

const ids = {
  installation: "10000000-0000-4000-8000-000000000001",
  workspace: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  target: "10000000-0000-4000-8000-000000000004",
  work: "10000000-0000-4000-8000-000000000005",
  policy: "10000000-0000-4000-8000-000000000006",
  grant: "10000000-0000-4000-8000-000000000007",
  approval: "10000000-0000-4000-8000-000000000008",
  approvalRecord: "10000000-0000-4000-8000-000000000009",
  approvalReceipt: "10000000-0000-4000-8000-00000000000a",
  revocation: "10000000-0000-4000-8000-00000000000b",
  receipt: "10000000-0000-4000-8000-00000000000c",
  authUser: "10000000-0000-4000-8000-00000000000d",
  otherInstallation: "20000000-0000-4000-8000-000000000001",
  otherWorkspace: "20000000-0000-4000-8000-000000000002",
  otherTarget: "20000000-0000-4000-8000-000000000003",
  otherWork: "20000000-0000-4000-8000-000000000004",
  otherGrant: "20000000-0000-4000-8000-000000000005",
  otherApproval: "20000000-0000-4000-8000-000000000006",
  otherReceipt: "20000000-0000-4000-8000-000000000007",
} as const;

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const approvedAt = "2026-08-31T18:00:00.000Z";
const aal2VerifiedAt = "2026-08-31T17:55:00.000Z";
const expiresAt = "2026-09-01T18:00:00.000Z";
const appliedAt = "2026-08-31T18:05:00.000Z";

const approvalRequest: WorkspaceMembershipRevocationApprovalRequest = {
  approvalId: ids.approval,
  targetPersonId: ids.target,
  expectedTargetKind: "member",
  workId: ids.work,
  capabilityGrantId: ids.grant,
  expiresAt,
};

interface CreationOptions {
  installationId?: string;
  workspaceId?: string;
  approvalId?: string;
  targetPersonId?: string;
  targetPersonKind?: "owner" | "member";
  workId?: string;
  capabilityGrantId?: string;
  expiresAt?: string;
}

async function makeApprovalCreation(
  options: CreationOptions = {},
): Promise<WorkspaceMembershipRevocationApprovalCreation> {
  const installationId = options.installationId ?? ids.installation;
  const workspaceId = options.workspaceId ?? ids.workspace;
  const approvalId = options.approvalId ?? ids.approval;
  const targetPersonId = options.targetPersonId ?? ids.target;
  const targetPersonKind = options.targetPersonKind ?? "member";
  const workId = options.workId ?? ids.work;
  const capabilityGrantId = options.capabilityGrantId ?? ids.grant;
  const exactExpiresAt = options.expiresAt ?? expiresAt;
  const binding = {
    vortonInstallationId: installationId,
    workspaceId,
    realm: "organizational" as const,
    targetPersonId,
    targetPersonKind,
    workId,
    workSnapshotSha256: digest("1"),
  };
  const authority = {
    principalKind: "person" as const,
    personId: ids.actor,
    workspaceMembershipKind: "owner" as const,
    capability: "workspace.membership.revoke" as const,
    mode: "modify" as const,
    workId,
    policyId: ids.policy,
    policySha256: digest("2"),
    capabilityGrantId,
    workScoped: true as const,
    rolesGrantAuthority: false as const,
  };
  const approvalCore = {
    contract: "vorton.workspace-membership-revocation-approval.v1" as const,
    approvalId,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres" as const,
    actorPersonId: ids.actor,
    binding,
    authority,
    approvedAt,
    expiresAt: exactExpiresAt,
    aal2VerifiedAt,
    assuranceLevel: "aal2" as const,
    actorMembershipVerifiedAt: approvedAt,
    targetMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    ownerContinuityAtApproval: {
      checkedAt: approvedAt,
      liveOwnerCount: targetPersonKind === "owner" ? 2 : 1,
    },
    scope: {
      action: "workspace.membership.revoke" as const,
      targetMembershipOnly: true as const,
      selfRevocation: false as const,
      personDeletion: false as const,
      workspaceDeletion: false as const,
      otherMembershipMutation: false as const,
      otherWorkspaceRead: false as const,
      otherWorkspaceMutation: false as const,
      externalSystemMutation: false as const,
    },
  };
  const approvalHash = await hashWorkspaceMembershipRevocationApprovalCore({
    ...approvalCore,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256: digest("f"),
  });
  const approvalReceiptCore = {
    contract:
      "vorton.workspace-membership-revocation-approval-receipt.v1" as const,
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres" as const,
    approvalId,
    approvalRecordId: ids.approvalRecord,
    approvalHash,
    actorPersonId: ids.actor,
    binding,
    authority,
    approvedAt,
    createdAt: approvedAt,
    aal2VerifiedAt,
    assuranceLevel: "aal2" as const,
    actorMembershipVerifiedAt: approvedAt,
    targetMembershipVerifiedAt: approvedAt,
    policyVerifiedAt: approvedAt,
    capabilityGrantVerifiedAt: approvedAt,
    workVerifiedAt: approvedAt,
    ownerContinuityVerifiedAt: approvedAt,
    effects: {
      approvalCreated: true as const,
      approvalConsumed: false as const,
      targetMembershipRevoked: false as const,
      targetMembershipMutated: false as const,
      targetPersonDeleted: false as const,
      workspaceDeleted: false as const,
      otherMembershipMutated: false as const,
      otherPersonMutated: false as const,
      otherWorkspaceRead: false as const,
      otherWorkspaceMutation: false as const,
      workMutated: false as const,
      policyMutated: false as const,
      capabilityGrantMutated: false as const,
      externalSystemMutated: false as const,
    },
  };
  const approvalReceiptSha256 =
    await hashWorkspaceMembershipRevocationApprovalReceipt({
      ...approvalReceiptCore,
      receiptHash: digest("e"),
    });
  return {
    approval: {
      ...approvalCore,
      approvalReceiptId: ids.approvalReceipt,
      approvalReceiptSha256,
    },
    approvalReceipt: {
      ...approvalReceiptCore,
      receiptHash: approvalReceiptSha256,
    },
  };
}

async function makeReceipt(
  creation: WorkspaceMembershipRevocationApprovalCreation,
  receiptId: string = ids.receipt,
): Promise<WorkspaceMembershipRevocationReceipt> {
  const approvalHash = await hashWorkspaceMembershipRevocationApprovalCore(
    creation.approval,
  );
  const approvalReceiptSha256 =
    await hashWorkspaceMembershipRevocationApprovalReceipt(
      creation.approvalReceipt,
    );
  const receiptCore = {
    contract: "vorton.workspace-membership-revocation-receipt.v1" as const,
    receiptId,
    receiptPlane: "workspace-postgres" as const,
    membershipRevocationId: ids.revocation,
    approvalId: creation.approval.approvalId,
    approvalRecordId: creation.approval.approvalRecordId,
    approvalReceiptId: creation.approval.approvalReceiptId,
    approvalReceiptSha256,
    approvalHash,
    binding: creation.approval.binding,
    authority: creation.approval.authority,
    approvedByPersonId: creation.approval.actorPersonId,
    appliedByPersonId: creation.approval.actorPersonId,
    approvalConsumptionCount: 1 as const,
    approvalConsumedAt: appliedAt,
    revokedAt: appliedAt,
    aal2VerifiedAt: approvedAt,
    assuranceLevel: "aal2" as const,
    actorMembershipVerifiedAt: appliedAt,
    targetMembershipVerifiedAt: appliedAt,
    policyVerifiedAt: appliedAt,
    capabilityGrantVerifiedAt: appliedAt,
    workSnapshotVerifiedAt: appliedAt,
    ownerContinuity: {
      checkedAt: appliedAt,
      liveOwnerCountBefore:
        creation.approval.binding.targetPersonKind === "owner" ? 2 : 1,
      liveOwnerCountAfter: 1,
      finalOwnerRevoked: false as const,
    },
    idempotency: {
      key: receiptId,
      exactReplayReturnsSameReceipt: true as const,
      conflictingReplayDenied: true as const,
      additionalRevocationsOnReplay: 0 as const,
    },
    effects: {
      targetMembershipRevoked: true as const,
      targetPersonDeleted: false as const,
      workspaceDeleted: false as const,
      otherMembershipMutated: false as const,
      otherPersonMutated: false as const,
      otherWorkspaceRead: false as const,
      otherWorkspaceMutation: false as const,
      workMutated: false as const,
      policyMutated: false as const,
      capabilityGrantMutated: false as const,
      externalSystemMutated: false as const,
    },
  };
  return {
    ...receiptCore,
    receiptHash: await hashWorkspaceMembershipRevocationReceipt({
      ...receiptCore,
      receiptHash: digest("d"),
    }),
  };
}

async function makeApplication(
  options: CreationOptions & { receiptId?: string } = {},
) {
  const creation = await makeApprovalCreation(options);
  return {
    ...creation,
    receipt: await makeReceipt(creation, options.receiptId),
  };
}

const recentIdentity = () => ({
  authUserId: ids.authUser,
  aal: "aal2" as const,
  authTime: Math.floor(Date.now() / 1_000) - 60,
});

function databaseReturning(
  column: "creation" | "application",
  value: unknown,
  captures?: {
    contexts: unknown[];
    queries: Array<{ sql: string; values: readonly unknown[] }>;
  },
): Database {
  return {
    asWorkspacePersonWithStepUp: async (
      context: unknown,
      work: (transaction: {
        query: (sql: string, values: readonly unknown[]) => Promise<unknown>;
      }) => Promise<unknown>,
    ) => {
      captures?.contexts.push(context);
      return work({
        query: async (sql, values) => {
          captures?.queries.push({ sql, values });
          return { rows: [{ [column]: value }], rowCount: 1 };
        },
      });
    },
  } as unknown as Database;
}

describe("workspace membership revocation database authority", () => {
  it("creates an approval inside the exact signed workspace-person AAL2 transaction", async () => {
    const creation = await makeApprovalCreation();
    const captures = {
      contexts: [] as unknown[],
      queries: [] as Array<{ sql: string; values: readonly unknown[] }>,
    };
    const identity = recentIdentity();
    const authority = new DatabaseWorkspaceMembershipRevocationAuthority(
      databaseReturning("creation", creation, captures),
    );

    await expect(
      authority.approve(
        ids.installation,
        ids.workspace,
        approvalRequest,
        identity,
      ),
    ).resolves.toEqual(creation);
    expect(captures.contexts).toEqual([
      {
        authUserId: ids.authUser,
        vortonInstallationId: ids.installation,
        workspaceId: ids.workspace,
        aal: "aal2",
        authTime: identity.authTime,
      },
    ]);
    expect(captures.queries).toHaveLength(1);
    expect(captures.queries[0]?.sql).toMatch(
      /public\.create_workspace_membership_revocation_approval\(\s*\$1::uuid, \$2::uuid, \$3::uuid, \$4::uuid,\s*\$5::public\.person_kind, \$6::uuid, \$7::uuid, \$8::timestamptz\s*\)/,
    );
    expect(captures.queries[0]?.values).toEqual([
      approvalRequest.approvalId,
      ids.installation,
      ids.workspace,
      approvalRequest.targetPersonId,
      approvalRequest.expectedTargetKind,
      approvalRequest.workId,
      approvalRequest.capabilityGrantId,
      approvalRequest.expiresAt,
    ]);
  });

  it("applies the exact approval inside a fresh signed workspace-person AAL2 transaction", async () => {
    const application = await makeApplication();
    const captures = {
      contexts: [] as unknown[],
      queries: [] as Array<{ sql: string; values: readonly unknown[] }>,
    };
    const identity = recentIdentity();
    const authority = new DatabaseWorkspaceMembershipRevocationAuthority(
      databaseReturning("application", application, captures),
    );

    await expect(
      authority.apply(
        ids.installation,
        ids.workspace,
        ids.approval,
        { receiptId: ids.receipt },
        identity,
      ),
    ).resolves.toEqual(application);
    expect(captures.contexts).toEqual([
      {
        authUserId: ids.authUser,
        vortonInstallationId: ids.installation,
        workspaceId: ids.workspace,
        aal: "aal2",
        authTime: identity.authTime,
      },
    ]);
    expect(captures.queries).toHaveLength(1);
    expect(captures.queries[0]?.sql).toMatch(
      /public\.apply_workspace_membership_revocation\(\s*\$1::uuid, \$2::uuid, \$3::uuid, \$4::uuid\s*\)/,
    );
    expect(captures.queries[0]?.values).toEqual([
      ids.receipt,
      ids.approval,
      ids.installation,
      ids.workspace,
    ]);
  });

  it("requires present, integer, current AAL2 before either database transaction", async () => {
    const now = Math.floor(Date.now() / 1_000);
    expect(() =>
      requireWorkspaceMembershipRevocationRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: now },
        now,
      ),
    ).not.toThrow();
    expect(() =>
      requireWorkspaceMembershipRevocationRecentAal2(
        { authUserId: ids.authUser, aal: "aal2", authTime: now - 600 },
        now,
      ),
    ).not.toThrow();

    const invalidIdentities = [
      { authUserId: ids.authUser, aal: "aal1" as const, authTime: now },
      {
        authUserId: ids.authUser,
        aal: "aal2" as const,
        authTime: undefined,
      },
      { authUserId: ids.authUser, aal: "aal2" as const, authTime: now + 1 },
      {
        authUserId: ids.authUser,
        aal: "aal2" as const,
        authTime: now - 601,
      },
      {
        authUserId: ids.authUser,
        aal: "aal2" as const,
        authTime: now - 0.5,
      },
    ];
    for (const identity of invalidIdentities) {
      expect(() =>
        requireWorkspaceMembershipRevocationRecentAal2(identity, now),
      ).toThrow(StepUpAuthenticationError);
    }

    let entered = 0;
    const database = {
      asWorkspacePersonWithStepUp: async () => {
        entered += 1;
      },
    } as unknown as Database;
    const authority = new DatabaseWorkspaceMembershipRevocationAuthority(
      database,
    );
    for (const authTime of [now + 60, now - 601]) {
      await expect(
        authority.approve(ids.installation, ids.workspace, approvalRequest, {
          authUserId: ids.authUser,
          aal: "aal2",
          authTime,
        }),
      ).rejects.toBeInstanceOf(StepUpAuthenticationError);
      await expect(
        authority.apply(
          ids.installation,
          ids.workspace,
          ids.approval,
          { receiptId: ids.receipt },
          { authUserId: ids.authUser, aal: "aal2", authTime },
        ),
      ).rejects.toBeInstanceOf(StepUpAuthenticationError);
    }
    expect(entered).toBe(0);
  });

  it("rejects malformed approval and apply bodies before opening a transaction", async () => {
    let entered = 0;
    const database = {
      asWorkspacePersonWithStepUp: async () => {
        entered += 1;
      },
    } as unknown as Database;
    const authority = new DatabaseWorkspaceMembershipRevocationAuthority(
      database,
    );
    for (const candidate of [
      {
        ...approvalRequest,
        approvalId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      { ...approvalRequest, expectedTargetKind: "administrator" },
      { ...approvalRequest, actorPersonId: ids.actor },
      { ...approvalRequest, expiresAt: "2026-09-01T18:00:00Z" },
    ]) {
      await expect(
        authority.approve(
          ids.installation,
          ids.workspace,
          candidate as WorkspaceMembershipRevocationApprovalRequest,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationInputError);
    }
    for (const candidate of [
      { receiptId: ids.receipt.toUpperCase() },
      { receiptId: ids.receipt, approvalId: ids.approval },
      {},
    ]) {
      await expect(
        authority.apply(
          ids.installation,
          ids.workspace,
          ids.approval,
          candidate as { receiptId: string },
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationInputError);
    }
    expect(entered).toBe(0);
  });

  it("rejects ambiguous, malformed, and hash-invalid approval database bundles", async () => {
    const valid = await makeApprovalCreation();
    const invalidResults = [
      { rows: [], rowCount: 0 },
      { rows: [{ creation: valid }, { creation: valid }], rowCount: 2 },
      { rows: [{ creation: null }], rowCount: 1 },
      {
        rows: [
          {
            creation: {
              ...valid,
              approvalReceipt: {
                ...valid.approvalReceipt,
                receiptHash: digest("9"),
              },
            },
          },
        ],
        rowCount: 1,
      },
    ];

    for (const result of invalidResults) {
      const database = {
        asWorkspacePersonWithStepUp: async (
          _context: unknown,
          work: (transaction: {
            query: () => Promise<unknown>;
          }) => Promise<unknown>,
        ) => work({ query: async () => result }),
      } as unknown as Database;
      await expect(
        new DatabaseWorkspaceMembershipRevocationAuthority(database).approve(
          ids.installation,
          ids.workspace,
          approvalRequest,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationIntegrityError);
    }
  });

  it("rejects valid database approvals that splice any request projection", async () => {
    const variants: CreationOptions[] = [
      { approvalId: ids.otherApproval },
      { installationId: ids.otherInstallation },
      { workspaceId: ids.otherWorkspace },
      { targetPersonId: ids.otherTarget },
      { targetPersonKind: "owner" },
      { workId: ids.otherWork },
      { capabilityGrantId: ids.otherGrant },
      { expiresAt: "2026-09-01T17:59:59.000Z" },
    ];
    for (const variant of variants) {
      const creation = await makeApprovalCreation(variant);
      const authority = new DatabaseWorkspaceMembershipRevocationAuthority(
        databaseReturning("creation", creation),
      );
      await expect(
        authority.approve(
          ids.installation,
          ids.workspace,
          approvalRequest,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationIntegrityError);
    }
  });

  it("rejects ambiguous, malformed, hash-invalid, and cross-chain application bundles", async () => {
    const valid = await makeApplication();
    const otherCreation = await makeApprovalCreation({
      approvalId: ids.otherApproval,
    });
    const invalidResults = [
      { rows: [], rowCount: 0 },
      { rows: [{ application: valid }, { application: valid }], rowCount: 2 },
      { rows: [{ application: null }], rowCount: 1 },
      {
        rows: [
          {
            application: {
              ...valid,
              receipt: { ...valid.receipt, receiptHash: digest("8") },
            },
          },
        ],
        rowCount: 1,
      },
      {
        rows: [
          {
            application: {
              ...otherCreation,
              receipt: valid.receipt,
            },
          },
        ],
        rowCount: 1,
      },
    ];
    for (const result of invalidResults) {
      const database = {
        asWorkspacePersonWithStepUp: async (
          _context: unknown,
          work: (transaction: {
            query: () => Promise<unknown>;
          }) => Promise<unknown>,
        ) => work({ query: async () => result }),
      } as unknown as Database;
      await expect(
        new DatabaseWorkspaceMembershipRevocationAuthority(database).apply(
          ids.installation,
          ids.workspace,
          ids.approval,
          { receiptId: ids.receipt },
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationIntegrityError);
    }
  });

  it("rejects valid database applications that splice any route or request projection", async () => {
    const variants: Array<CreationOptions & { receiptId?: string }> = [
      { approvalId: ids.otherApproval },
      { installationId: ids.otherInstallation },
      { workspaceId: ids.otherWorkspace },
      { receiptId: ids.otherReceipt },
    ];
    for (const variant of variants) {
      const application = await makeApplication(variant);
      const authority = new DatabaseWorkspaceMembershipRevocationAuthority(
        databaseReturning("application", application),
      );
      await expect(
        authority.apply(
          ids.installation,
          ids.workspace,
          ids.approval,
          { receiptId: ids.receipt },
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationIntegrityError);
    }
  });

  it("maps named P0001 failures and fails unknown authority errors closed", async () => {
    const cases = [
      [
        "Target workspace does not exist",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "Signed recent workspace-person AAL2 is required",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "A live workspace owner is required to approve revocation",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "A live workspace owner is required to apply or replay revocation",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "The same live workspace owner must apply or replay revocation",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "The same live workspace owner must approve and apply revocation",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "Exact ready person-custodied Work is required",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "Exact Work-scoped capability grant does not exist",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "Exact live person Work-scoped revocation capability is required",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "Approved Work, Policy, or capability authority changed",
        WorkspaceMembershipRevocationForbiddenError,
      ],
      [
        "Exact workspace membership revocation approval request is invalid",
        WorkspaceMembershipRevocationInputError,
      ],
      [
        "Exact workspace membership revocation apply request is invalid",
        WorkspaceMembershipRevocationInputError,
      ],
      [
        "Revocation approval expiry must be within 24 hours",
        WorkspaceMembershipRevocationInputError,
      ],
      [
        "Target membership kind does not match the approval request",
        WorkspaceMembershipRevocationInputError,
      ],
      ["Self-revocation is forbidden", WorkspaceMembershipRevocationInputError],
      [
        "Approval, Policy, and grant identities must be distinct",
        WorkspaceMembershipRevocationInputError,
      ],
      [
        "Revocation receipt identity conflicts with authority",
        WorkspaceMembershipRevocationInputError,
      ],
      [
        "Membership revocation approval retry conflicts with immutable authority",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "Membership revocation receipt retry conflicts with immutable application",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "Target live workspace membership does not exist",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "Exact target membership is no longer live",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "Exact membership revocation approval does not exist",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "Existing membership revocation lacks exact product receipt",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "The final live workspace owner cannot be revoked",
        WorkspaceMembershipRevocationConflictError,
      ],
      [
        "Workspace owner continuity changed during revocation",
        WorkspaceMembershipRevocationConflictError,
      ],
    ] as const;
    for (const [message, ErrorClass] of cases) {
      const database = {
        asWorkspacePersonWithStepUp: async () => {
          throw Object.assign(new Error(message), { code: "P0001" });
        },
      } as unknown as Database;
      await expect(
        new DatabaseWorkspaceMembershipRevocationAuthority(database).approve(
          ids.installation,
          ids.workspace,
          approvalRequest,
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(ErrorClass);
    }

    const unknownAuthorityFailure = Object.assign(
      new Error("Unknown revocation authority failure"),
      { code: "P0001" },
    );
    {
      const database = {
        asWorkspacePersonWithStepUp: async () => {
          throw unknownAuthorityFailure;
        },
      } as unknown as Database;
      await expect(
        new DatabaseWorkspaceMembershipRevocationAuthority(database).apply(
          ids.installation,
          ids.workspace,
          ids.approval,
          { receiptId: ids.receipt },
          recentIdentity(),
        ),
      ).rejects.toBeInstanceOf(WorkspaceMembershipRevocationIntegrityError);
    }

    for (const error of [
      Object.assign(new Error("Database connection failed"), {
        code: "08006",
      }),
      "non-error database failure",
    ]) {
      const database = {
        asWorkspacePersonWithStepUp: async () => {
          throw error;
        },
      } as unknown as Database;
      await expect(
        new DatabaseWorkspaceMembershipRevocationAuthority(database).apply(
          ids.installation,
          ids.workspace,
          ids.approval,
          { receiptId: ids.receipt },
          recentIdentity(),
        ),
      ).rejects.toBe(error);
    }
  });
});
