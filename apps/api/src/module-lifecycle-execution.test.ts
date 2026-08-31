import { describe, expect, it } from "vitest";

import {
  hashModuleLifecycleActionCommand,
  hashModuleLifecycleActionReceipt,
  hashModuleLifecycleApprovalReceipt,
  moduleLifecycleCanonicalSha256,
  moduleLifecycleApprovalCoreSchema,
  type ModuleLifecycleActionCommandCreation,
  type ModuleLifecycleActionCompletion,
} from "@vorton/contracts";
import type { Database, SqlExecutor, WorkerContext } from "@vorton/database";
import type { AuthenticatedWorkerCredential } from "@vorton/kernel";

import {
  DatabaseModuleLifecycleExecution,
  ModuleLifecycleExecutionConflictError,
  ModuleLifecycleExecutionForbiddenError,
  ModuleLifecycleExecutionIntegrityError,
} from "./module-lifecycle-execution.js";

const ids = {
  approval: "11111111-1111-4111-8111-111111111111",
  approvalRecord: "12121212-1212-4212-8212-121212121212",
  approvalReceipt: "13131313-1313-4313-8313-131313131313",
  installation: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  owner: "44444444-4444-4444-8444-444444444444",
  worker: "55555555-5555-4555-8555-555555555555",
  credential: "66666666-6666-4666-8666-666666666666",
  rotatedCredential: "67676767-6767-4767-8767-676767676767",
  otherWorker: "56565656-5656-4656-8656-565656565656",
  work: "77777777-7777-4777-8777-777777777777",
  policy: "88888888-8888-4888-8888-888888888888",
  grant: "99999999-9999-4999-8999-999999999999",
  command: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  receipt: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  backup: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  key: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const consumedAt = "2026-08-31T18:00:00.000Z";
const executedAt = "2026-08-31T18:01:00.000Z";

const worker: AuthenticatedWorkerCredential = {
  credentialId: ids.credential,
  installationId: ids.installation,
  workspaceId: ids.workspace,
  workerId: ids.worker,
  expiresAt: "2026-08-31T18:10:00.000Z",
};

async function artifacts(): Promise<{
  creation: ModuleLifecycleActionCommandCreation;
  completion: ModuleLifecycleActionCompletion;
}> {
  const binding = {
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    realm: "personal" as const,
    module: "tasks",
    sequence: 1,
    migrationPlanHash: digest("1"),
    sourceSnapshotSha256: digest("2"),
    targetPreimageSha256: digest("3"),
    targetPostimageSha256: digest("4"),
    target: {
      action: "backup" as const,
      backupId: ids.backup,
      storageObjectKey: "controlled/tasks/preimage.enc",
      encryptionKeyBindingId: ids.key,
    },
  };
  const approvalCore = moduleLifecycleApprovalCoreSchema.parse({
    contract: "vorton.module-lifecycle-action-approval.v1",
    approvalId: ids.approval,
    approvalRecordId: ids.approvalRecord,
    approvalPlane: "workspace-postgres",
    ownerPersonId: ids.owner,
    binding,
    approvedAt: "2026-08-31T17:55:00.000Z",
    expiresAt: "2026-08-31T18:30:00.000Z",
    aal2VerifiedAt: "2026-08-31T17:50:00.000Z",
    assuranceLevel: "aal2",
    workspaceMembershipVerifiedAt: "2026-08-31T17:55:00.000Z",
    scope: {
      action: "backup",
      moduleOnly: true,
      otherWorkspaceMutation: false,
      productionDeletion: false,
    },
    rolesGrantAuthority: false,
  });
  const approvalHash = await moduleLifecycleCanonicalSha256(approvalCore);
  const approvalReceiptCore = {
    contract: "vorton.module-lifecycle-approval-receipt.v1" as const,
    receiptId: ids.approvalReceipt,
    receiptPlane: "workspace-postgres" as const,
    approvalId: ids.approval,
    approvalHash,
    binding,
    action: "backup" as const,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    approvedAt: approvalCore.approvedAt,
    createdAt: approvalCore.approvedAt,
    liveMembershipCheckedAt: approvalCore.approvedAt,
    aal2VerifiedAt: approvalCore.aal2VerifiedAt,
    assuranceLevel: "aal2" as const,
    effects: {
      actionExecuted: false as const,
      approvalConsumed: false as const,
      workspaceMutated: false as const,
      moduleDataMutated: false as const,
      externalSystemMutated: false as const,
    },
  };
  const approvalReceiptSha256 = await hashModuleLifecycleApprovalReceipt({
    ...approvalReceiptCore,
    receiptHash: digest("5"),
  });
  const approval = {
    ...approvalCore,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256,
  };
  const approvalReceipt = {
    ...approvalReceiptCore,
    receiptHash: approvalReceiptSha256,
  };
  const executor = {
    kind: "worker" as const,
    workerId: ids.worker,
    workId: ids.work,
    policyId: ids.policy,
    admission: {
      credentialId: ids.credential,
      capabilityGrantId: ids.grant,
      liveAuthorityCheckedAt: consumedAt,
    },
    rolesGrantAuthority: false as const,
  };
  const commandDraft = {
    contract: "vorton.module-lifecycle-action-command.v1" as const,
    commandId: ids.command,
    commandPlane: "workspace-postgres" as const,
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256,
    approvalHash,
    binding,
    action: "backup" as const,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    proofScope: "controlled-synthetic" as const,
    executor,
    approvalConsumptionCount: 1 as const,
    consumedAt,
    idempotencyKey: ids.command,
    predecessorReceipts: { action: "backup" as const },
    effects: {
      approvalConsumed: true as const,
      actionExecuted: false as const,
      workspaceMutated: false as const,
      moduleDataMutated: false as const,
      externalSystemMutated: false as const,
    },
    commandHash: digest("6"),
  };
  const command = {
    ...commandDraft,
    commandHash: await hashModuleLifecycleActionCommand(commandDraft),
  };
  const outcome = { status: "succeeded" as const, code: "completed" as const };
  const effects = {
    approvalConsumed: true as const,
    actionAttempted: true as const,
    actionCompleted: true as const,
    productionModuleDataMutated: false as const,
    otherWorkspaceMutated: false as const,
    mutationBoundary: "workspace-backup-artifact" as const,
  };
  const evidence = {
    action: "backup" as const,
    capturedAt: consumedAt,
    recordCount: 4,
    capturedStateSha256: binding.targetPreimageSha256,
    manifestSha256: digest("7"),
    encryptedArtifactSha256: digest("8"),
    encryptedAtRest: true as const,
    workspaceKeyBound: true as const,
    workspaceStorageBound: true as const,
    otherWorkspaceAccessDenied: true as const,
  };
  const receiptDraft = {
    contract: "vorton.module-lifecycle-action-receipt.v1" as const,
    receiptId: ids.receipt,
    receiptPlane: "workspace-postgres" as const,
    commandId: ids.command,
    commandHash: command.commandHash,
    idempotencyKey: ids.command,
    approvalId: ids.approval,
    approvalReceiptId: ids.approvalReceipt,
    approvalReceiptSha256,
    approvalHash,
    binding,
    action: "backup" as const,
    vortonInstallationId: ids.installation,
    workspaceId: ids.workspace,
    ownerPersonId: ids.owner,
    proofScope: "controlled-synthetic" as const,
    executor: {
      ...executor,
      finalization: {
        credentialId: ids.credential,
        liveAuthorityCheckedAt: executedAt,
      },
    },
    approvalConsumptionCount: 1 as const,
    consumedAt,
    executedAt,
    predecessorReceipts: { action: "backup" as const },
    outcome,
    effects,
    evidence,
    receiptHash: digest("9"),
  };
  const actionReceipt = {
    ...receiptDraft,
    receiptHash: await hashModuleLifecycleActionReceipt(receiptDraft),
  };
  return {
    creation: { approval, approvalReceipt, command },
    completion: {
      approval,
      approvalReceipt,
      command,
      predecessorReceiptDocuments: { action: "backup" },
      actionReceipt,
    },
  };
}

function databaseReturning(
  value: unknown,
  error?: Error,
): {
  database: Database;
  contexts: WorkerContext[];
  queries: Array<{ text: string; values: readonly unknown[] | undefined }>;
} {
  const contexts: WorkerContext[] = [];
  const queries: Array<{
    text: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const database = {
    asWorker: async <T>(
      context: WorkerContext,
      work: (transaction: SqlExecutor) => Promise<T>,
    ) => {
      contexts.push(context);
      const transaction = {
        query: async (text: string, values?: readonly unknown[]) => {
          queries.push({ text, values });
          if (error) throw error;
          return {
            rows: [
              text.includes("finalize_module_lifecycle_action")
                ? { completion: value }
                : { creation: value },
            ],
            rowCount: 1,
          };
        },
      } as unknown as SqlExecutor;
      return work(transaction);
    },
  } as unknown as Database;
  return { database, contexts, queries };
}

function pgError(message: string): Error {
  return Object.assign(new Error(message), { code: "P0001" });
}

describe("database module lifecycle execution", () => {
  it("consumes one exact approval inside a credential-bound worker transaction", async () => {
    const { creation } = await artifacts();
    const fixture = databaseReturning(creation);
    const execution = new DatabaseModuleLifecycleExecution(fixture.database);
    await expect(
      execution.consume(
        ids.installation,
        ids.workspace,
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        worker,
      ),
    ).resolves.toEqual(creation);
    expect(fixture.contexts).toEqual([
      {
        installationId: ids.installation,
        workspaceId: ids.workspace,
        workerId: ids.worker,
        credentialId: ids.credential,
      },
    ]);
    expect(fixture.queries[0]?.values).toEqual([
      ids.command,
      ids.approval,
      ids.installation,
      ids.workspace,
      ids.work,
      "controlled-synthetic",
    ]);
  });

  it("finalizes only the exact observed result inside the fresh worker context", async () => {
    const { completion } = await artifacts();
    const fixture = databaseReturning(completion);
    const execution = new DatabaseModuleLifecycleExecution(fixture.database);
    const request = {
      receiptId: ids.receipt,
      outcome: completion.actionReceipt.outcome,
      effects: completion.actionReceipt.effects,
      evidence: completion.actionReceipt.evidence,
    };
    await expect(
      execution.finalize(
        ids.installation,
        ids.workspace,
        ids.command,
        request,
        worker,
      ),
    ).resolves.toEqual(completion);
    expect(fixture.queries[0]?.values).toEqual([
      ids.receipt,
      ids.command,
      ids.installation,
      ids.workspace,
      request.outcome,
      request.effects,
      request.evidence,
    ]);
  });

  it("accepts exact command replay through a rotated credential for the same durable worker", async () => {
    const { creation } = await artifacts();
    const fixture = databaseReturning(creation);
    const execution = new DatabaseModuleLifecycleExecution(fixture.database);
    const rotatedWorker = {
      ...worker,
      credentialId: ids.rotatedCredential,
    };

    await expect(
      execution.consume(
        ids.installation,
        ids.workspace,
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        rotatedWorker,
      ),
    ).resolves.toEqual(creation);
    expect(fixture.contexts).toEqual([
      {
        installationId: ids.installation,
        workspaceId: ids.workspace,
        workerId: ids.worker,
        credentialId: ids.rotatedCredential,
      },
    ]);
    expect(creation.command.executor.admission.credentialId).toBe(
      ids.credential,
    );
  });

  it("accepts exact receipt replay through a rotated credential for the same durable worker", async () => {
    const { completion } = await artifacts();
    const fixture = databaseReturning(completion);
    const execution = new DatabaseModuleLifecycleExecution(fixture.database);
    const rotatedWorker = {
      ...worker,
      credentialId: ids.rotatedCredential,
    };

    await expect(
      execution.finalize(
        ids.installation,
        ids.workspace,
        ids.command,
        {
          receiptId: ids.receipt,
          outcome: completion.actionReceipt.outcome,
          effects: completion.actionReceipt.effects,
          evidence: completion.actionReceipt.evidence,
        },
        rotatedWorker,
      ),
    ).resolves.toEqual(completion);
    expect(fixture.contexts).toEqual([
      {
        installationId: ids.installation,
        workspaceId: ids.workspace,
        workerId: ids.worker,
        credentialId: ids.rotatedCredential,
      },
    ]);
    expect(completion.actionReceipt.executor.finalization.credentialId).toBe(
      ids.credential,
    );
  });

  it("rejects immutable command and receipt output attributed to another worker", async () => {
    const { creation, completion } = await artifacts();
    const otherWorker = { ...worker, workerId: ids.otherWorker };
    const consumeFixture = databaseReturning(creation);
    const finalizeFixture = databaseReturning(completion);

    await expect(
      new DatabaseModuleLifecycleExecution(consumeFixture.database).consume(
        ids.installation,
        ids.workspace,
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        otherWorker,
      ),
    ).rejects.toBeInstanceOf(ModuleLifecycleExecutionIntegrityError);

    await expect(
      new DatabaseModuleLifecycleExecution(finalizeFixture.database).finalize(
        ids.installation,
        ids.workspace,
        ids.command,
        {
          receiptId: ids.receipt,
          outcome: completion.actionReceipt.outcome,
          effects: completion.actionReceipt.effects,
          evidence: completion.actionReceipt.evidence,
        },
        otherWorker,
      ),
    ).rejects.toBeInstanceOf(ModuleLifecycleExecutionIntegrityError);
  });

  it("rejects cross-workspace credentials before opening a transaction", async () => {
    const { creation } = await artifacts();
    const fixture = databaseReturning(creation);
    const execution = new DatabaseModuleLifecycleExecution(fixture.database);
    await expect(
      execution.consume(
        ids.installation,
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ModuleLifecycleExecutionForbiddenError);
    expect(fixture.contexts).toHaveLength(0);
  });

  it("rejects malformed database authority before transaction commit", async () => {
    const fixture = databaseReturning({ contract: "forged" });
    const execution = new DatabaseModuleLifecycleExecution(fixture.database);
    await expect(
      execution.consume(
        ids.installation,
        ids.workspace,
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ModuleLifecycleExecutionIntegrityError);
  });

  it("maps only named PostgreSQL conflicts and authority failures", async () => {
    const conflicts = databaseReturning(
      null,
      pgError(
        "Lifecycle action command retry conflicts with immutable consumption",
      ),
    );
    await expect(
      new DatabaseModuleLifecycleExecution(conflicts.database).consume(
        ids.installation,
        ids.workspace,
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ModuleLifecycleExecutionConflictError);

    const forbidden = databaseReturning(
      null,
      pgError("Live lifecycle execution authority is unavailable"),
    );
    await expect(
      new DatabaseModuleLifecycleExecution(forbidden.database).consume(
        ids.installation,
        ids.workspace,
        ids.approval,
        {
          commandId: ids.command,
          workId: ids.work,
          proofScope: "controlled-synthetic",
        },
        worker,
      ),
    ).rejects.toBeInstanceOf(ModuleLifecycleExecutionForbiddenError);
  });
});
