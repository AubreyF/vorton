import { describe, expect, it } from "vitest";

import { readAubosWorkspaceAdditionConfig } from "./add-aubos-workspace.js";
import {
  addWorkspaceToExistingInstallation,
  buildWorkspaceAdditionPlan,
  readWorkspaceAdditionAuthority,
  readWorkspaceAdditionConfig,
  type WorkspaceAdditionAuthority,
  type WorkspaceAdditionConfig,
  workspaceAdditionProtocol,
} from "./add-workspace.js";

const nowSeconds = 1_788_148_800;
const installationId = "11111111-1111-4111-8111-111111111111";
const personId = "22222222-2222-4222-8222-222222222222";
const authUserId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "44444444-4444-4444-8444-444444444444";
const approvalId = "77777777-7777-4777-8777-777777777777";
const receiptId = "88888888-8888-4888-8888-888888888888";
const adoptionReceiptId = "99999999-9999-4999-8999-999999999999";

const adoptedRelease: WorkspaceAdditionConfig["adoptedRelease"] = {
  adoptionReceiptId,
  adoptionReceiptSha256: `sha256:${"c".repeat(64)}`,
  receiptPlane: "installation-postgres",
  manifestSha256: `sha256:${"d".repeat(64)}`,
  sourceCommit: "a".repeat(40),
  migrationHead: "20260830000200_workspace_creation_authority",
  workspaceIsolationProofSha256: `sha256:${"e".repeat(64)}`,
  workspaceIsolationProofHash: `sha256:${"f".repeat(64)}`,
  status: "adopted",
  adoptedAt: "2026-08-30T20:00:00.000Z",
};

function releaseEnvironment(): NodeJS.ProcessEnv {
  return {
    VORTON_ADD_WORKSPACE_RELEASE_ADOPTION_RECEIPT_ID: adoptionReceiptId,
    VORTON_ADD_WORKSPACE_RELEASE_ADOPTION_RECEIPT_SHA256:
      adoptedRelease.adoptionReceiptSha256,
    VORTON_ADD_WORKSPACE_RELEASE_MANIFEST_SHA256: adoptedRelease.manifestSha256,
    VORTON_ADD_WORKSPACE_RELEASE_SOURCE_COMMIT: adoptedRelease.sourceCommit,
    VORTON_ADD_WORKSPACE_RELEASE_MIGRATION_HEAD: adoptedRelease.migrationHead,
    VORTON_ADD_WORKSPACE_ISOLATION_PROOF_SHA256:
      adoptedRelease.workspaceIsolationProofSha256,
    VORTON_ADD_WORKSPACE_ISOLATION_PROOF_HASH:
      adoptedRelease.workspaceIsolationProofHash,
    VORTON_ADD_WORKSPACE_RELEASE_ADOPTED_AT: adoptedRelease.adoptedAt,
  };
}

const config: WorkspaceAdditionConfig = {
  installationId,
  personId,
  authUserId,
  workspaceId,
  workspaceSlug: "aubos",
  workspaceDisplayName: "AubOS cloud",
  workspaceRealm: "personal",
  adoptedRelease,
};

function authority(): WorkspaceAdditionAuthority {
  return {
    approvalId,
    receiptId,
    expectedWorkspacePlanSha256:
      buildWorkspaceAdditionPlan(config).workspacePlanSha256,
  };
}

class WorkspaceDatabaseFixture {
  identityValid = true;
  workspaceExists = false;
  membershipExists = false;
  membershipKind = "owner";
  receiptExists = false;
  approvalAuthTime = nowSeconds - 60;
  ordinaryWorkspaceRows = "0";
  readonly statements: string[] = [];

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[]; rowCount: number }> {
    this.statements.push(text);
    const normalized = text.replace(/\s+/g, " ").trim();
    let rows: unknown[] = [];
    if (normalized.includes("from public.workspace_creation_receipts")) {
      rows = this.receiptExists
        ? [
            {
              id: receiptId,
              approval_id: approvalId,
              workspace_id: workspaceId,
              owner_person_id: personId,
              release_adoption_receipt_id: adoptionReceiptId,
              release_adoption_receipt_sha256:
                adoptedRelease.adoptionReceiptSha256,
              source_commit: adoptedRelease.sourceCommit,
              workspace_plan_sha256:
                buildWorkspaceAdditionPlan(config).workspacePlanSha256,
            },
          ]
        : [];
    } else if (
      normalized.startsWith("select exists(select 1 from public.workspaces")
    ) {
      rows = [{ exists: this.workspaceExists }];
    } else if (normalized.includes("public.apply_workspace_creation")) {
      if (!this.identityValid) {
        throw new Error("Live installation owner authority is required");
      }
      if (nowSeconds - this.approvalAuthTime > 600) {
        throw new Error("Exact live workspace creation approval is required");
      }
      this.workspaceExists = true;
      this.membershipExists = true;
      this.receiptExists = true;
      rows = [{ id: receiptId }];
    } else if (
      normalized.startsWith("select installation_id::text as installation_id")
    ) {
      rows = this.workspaceExists
        ? [
            {
              installation_id: installationId,
              slug: "aubos",
              display_name: "AubOS cloud",
              realm: "personal",
              created_by_person_id: personId,
            },
          ]
        : [];
    } else if (normalized.startsWith("select kind::text as kind")) {
      rows = this.membershipExists ? [{ kind: this.membershipKind }] : [];
    } else if (normalized.includes("from information_schema.columns")) {
      rows = [
        { table_name: "memory_banks" },
        { table_name: "records" },
        { table_name: "workers" },
      ];
    } else if (normalized.startsWith("select count(*)::text as count")) {
      expect(values).toEqual([workspaceId]);
      rows = [{ count: this.ordinaryWorkspaceRows }];
    }
    return { rows: rows as Row[], rowCount: rows.length };
  }
}

describe("add workspace to existing installation", () => {
  it("builds a deterministic no-effect plan for an empty AubOS workspace", () => {
    const first = buildWorkspaceAdditionPlan(config);
    const second = buildWorkspaceAdditionPlan(config);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      protocol: workspaceAdditionProtocol,
      operation: "add-workspace-to-existing-installation",
      installation: { id: installationId, create: false },
      owner: { personId, authUserId, create: false },
      workspace: {
        id: workspaceId,
        slug: "aubos",
        displayName: "AubOS cloud",
        realm: "personal",
        membership: "owner",
      },
      creates: {
        workspaces: 1,
        workspaceMemberships: 1,
        installationReceipts: 1,
        allOtherWorkspaceScopedRows: 0,
        infrastructureStacks: 0,
      },
      effects: "none",
    });
    expect(first.workspacePlanSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects drift from the exact AubOS empty-workspace contract", () => {
    const env = {
      VORTON_ADD_WORKSPACE_INSTALLATION_ID: installationId,
      VORTON_ADD_WORKSPACE_PERSON_ID: personId,
      VORTON_ADD_WORKSPACE_AUTH_USER_ID: authUserId,
      VORTON_ADD_WORKSPACE_ID: workspaceId,
      VORTON_ADD_WORKSPACE_SLUG: "freedos",
      VORTON_ADD_WORKSPACE_DISPLAY_NAME: "AubOS cloud",
      VORTON_ADD_WORKSPACE_REALM: "personal",
      ...releaseEnvironment(),
    };
    expect(() => readAubosWorkspaceAdditionConfig(env)).toThrow(
      "must be exactly aubos",
    );
    expect(() => readWorkspaceAdditionAuthority(env)).toThrow(
      "VORTON_ADD_WORKSPACE_APPROVAL_ID is required",
    );
  });

  it("keeps the core workspace-birth primitive generic", () => {
    const parsed = readWorkspaceAdditionConfig({
      VORTON_ADD_WORKSPACE_INSTALLATION_ID: installationId,
      VORTON_ADD_WORKSPACE_PERSON_ID: personId,
      VORTON_ADD_WORKSPACE_AUTH_USER_ID: authUserId,
      VORTON_ADD_WORKSPACE_ID: workspaceId,
      VORTON_ADD_WORKSPACE_SLUG: "genii",
      VORTON_ADD_WORKSPACE_DISPLAY_NAME: "Genii",
      VORTON_ADD_WORKSPACE_REALM: "organizational",
      ...releaseEnvironment(),
    });
    expect(parsed).toMatchObject({
      workspaceSlug: "genii",
      workspaceDisplayName: "Genii",
      workspaceRealm: "organizational",
    });
  });

  it("creates only the workspace and owner membership after exact recent AAL2 approval", async () => {
    const database = new WorkspaceDatabaseFixture();
    const first = await addWorkspaceToExistingInstallation(
      database,
      config,
      authority(),
    );
    expect(first.status).toBe("applied");
    expect(database.workspaceExists).toBe(true);
    expect(database.membershipExists).toBe(true);
    expect(database.receiptExists).toBe(true);
    const applies = database.statements.filter((statement) =>
      statement.includes("public.apply_workspace_creation"),
    );
    expect(applies).toHaveLength(1);

    database.approvalAuthTime = nowSeconds - 601;
    database.ordinaryWorkspaceRows = "1";
    database.identityValid = false;
    database.membershipKind = "member";
    const replay = await addWorkspaceToExistingInstallation(
      database,
      config,
      authority(),
    );
    expect(replay.status).toBe("already-applied");
    expect(
      database.statements.filter((statement) =>
        statement.includes("public.apply_workspace_creation"),
      ),
    ).toHaveLength(1);
  });

  it("fails before mutation for stale or plan-mismatched approval", async () => {
    const stale = new WorkspaceDatabaseFixture();
    stale.approvalAuthTime = nowSeconds - 601;
    await expect(
      addWorkspaceToExistingInstallation(stale, config, authority()),
    ).rejects.toThrow("Exact live workspace creation approval is required");
    expect(stale.workspaceExists).toBe(false);

    const mismatched = new WorkspaceDatabaseFixture();
    await expect(
      addWorkspaceToExistingInstallation(mismatched, config, {
        ...authority(),
        expectedWorkspacePlanSha256: `sha256:${"d".repeat(64)}`,
      }),
    ).rejects.toThrow("plan digest does not match");
    expect(mismatched.workspaceExists).toBe(false);
  });
});
