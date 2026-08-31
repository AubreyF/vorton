import { describe, expect, it } from "vitest";

import {
  hashModuleLifecycleActionCommand,
  hashModuleLifecycleActionReceipt,
  type ModuleLifecycleActionCommand,
  type ModuleLifecycleActionEvidence,
  type ModuleLifecycleActionPredecessors,
  type ModuleLifecycleActionReceipt,
  type ModuleLifecycleActionTarget,
} from "@vorton/contracts";

import {
  ControlledSyntheticBlobStore,
  ControlledSyntheticLifecycleAdapter,
  SyntheticLifecycleInterruptionError,
} from "./index.js";

const installationId = id(1);
const workspaceId = id(2);
const ownerPersonId = id(3);
const workerId = id(4);
const workId = id(5);
const policyId = id(6);
const preimage = digest(1);
const postimage = digest(2);
function timestamp(second: number, milliseconds = 0): string {
  return new Date(
    Date.UTC(2026, 7, 31, 18, 0, second, milliseconds),
  ).toISOString();
}

function id(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function digest(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function reference(receipt: ModuleLifecycleActionReceipt) {
  return { receiptId: receipt.receiptId, receiptSha256: receipt.receiptHash };
}

function targetFor(
  action: "backup" | "recovery" | "deletion" | "rollback",
  prior: ModuleLifecycleActionReceipt[],
): ModuleLifecycleActionTarget {
  if (action === "backup") {
    return {
      action,
      backupId: id(20),
      storageObjectKey: "synthetic/module/backup.bin",
      encryptionKeyBindingId: id(21),
    };
  }
  if (action === "recovery") {
    return {
      action,
      recoveryId: id(22),
      recoveryNamespace: "synthetic-recovery",
      backupReceipt: reference(prior[0]!),
    };
  }
  if (action === "deletion") {
    return {
      action,
      mode: "controlled-fixture",
      rehearsalId: id(23),
      controlledFixtureId: id(24),
      productionDeletion: false,
      noProductionRecords: true,
      backupReceipt: reference(prior[0]!),
      recoveryReceipt: reference(prior[1]!),
      surfaces: {
        database: true,
        storage: true,
        memory: true,
        search: true,
        backups: true,
      },
    };
  }
  return {
    action,
    rollbackId: id(25),
    rollbackNamespace: "synthetic-rollback",
    backupReceipt: reference(prior[0]!),
    recoveryReceipt: reference(prior[1]!),
    deletionRehearsalReceipt: reference(prior[2]!),
  };
}

function predecessorsFor(
  action: "backup" | "recovery" | "deletion" | "rollback",
  prior: ModuleLifecycleActionReceipt[],
): ModuleLifecycleActionPredecessors {
  if (action === "backup") return { action };
  if (action === "recovery") {
    return { action, backup: reference(prior[0]!) };
  }
  if (action === "deletion") {
    return {
      action,
      backup: reference(prior[0]!),
      recovery: reference(prior[1]!),
    };
  }
  return {
    action,
    backup: reference(prior[0]!),
    recovery: reference(prior[1]!),
    deletion: reference(prior[2]!),
  };
}

async function commandFor(
  action: "backup" | "recovery" | "deletion" | "rollback",
  seed: number,
  prior: ModuleLifecycleActionReceipt[] = [],
  overrides: Partial<ModuleLifecycleActionCommand> = {},
): Promise<ModuleLifecycleActionCommand> {
  const commandId = overrides.commandId ?? id(100 + seed);
  const exactConsumedAt = overrides.consumedAt ?? timestamp(seed);
  const binding = {
    vortonInstallationId: installationId,
    workspaceId,
    realm: "personal" as const,
    module: "tasks",
    sequence: 1,
    migrationPlanHash: digest(10),
    sourceSnapshotSha256: digest(11),
    targetPreimageSha256: preimage,
    targetPostimageSha256: postimage,
    target: targetFor(action, prior),
  };
  const draft: ModuleLifecycleActionCommand = {
    contract: "vorton.module-lifecycle-action-command.v1",
    commandId,
    commandPlane: "workspace-postgres",
    approvalId: id(200 + seed),
    approvalReceiptId: id(300 + seed),
    approvalReceiptSha256: digest(300 + seed),
    approvalHash: digest(200 + seed),
    binding,
    action,
    vortonInstallationId: installationId,
    workspaceId,
    ownerPersonId,
    proofScope: "controlled-synthetic",
    executor: {
      kind: "worker",
      workerId,
      workId,
      policyId,
      admission: {
        credentialId: id(400 + seed),
        capabilityGrantId: id(500 + seed),
        liveAuthorityCheckedAt: exactConsumedAt,
      },
      rolesGrantAuthority: false,
    },
    approvalConsumptionCount: 1,
    consumedAt: exactConsumedAt,
    idempotencyKey: commandId,
    predecessorReceipts: predecessorsFor(action, prior),
    effects: {
      approvalConsumed: true,
      actionExecuted: false,
      workspaceMutated: false,
      moduleDataMutated: false,
      externalSystemMutated: false,
    },
    commandHash: digest(900 + seed),
    ...overrides,
  };
  return {
    ...draft,
    commandHash: await hashModuleLifecycleActionCommand(draft),
  };
}

function successEffects(action: ModuleLifecycleActionCommand["action"]) {
  return {
    approvalConsumed: true as const,
    actionAttempted: true as const,
    actionCompleted: true as const,
    productionModuleDataMutated: false as const,
    otherWorkspaceMutated: false as const,
    mutationBoundary:
      action === "backup"
        ? ("workspace-backup-artifact" as const)
        : action === "recovery"
          ? ("isolated-recovery-namespace" as const)
          : action === "deletion"
            ? ("controlled-fixture" as const)
            : ("isolated-rollback-namespace" as const),
  };
}

async function receiptFor(
  command: ModuleLifecycleActionCommand,
  evidence: ModuleLifecycleActionEvidence,
  seed: number,
): Promise<ModuleLifecycleActionReceipt> {
  const exactExecutedAt = timestamp(seed, 100);
  const draft: ModuleLifecycleActionReceipt = {
    contract: "vorton.module-lifecycle-action-receipt.v1",
    receiptId: id(600 + seed),
    receiptPlane: "workspace-postgres",
    commandId: command.commandId,
    commandHash: command.commandHash,
    idempotencyKey: command.idempotencyKey,
    approvalId: command.approvalId,
    approvalReceiptId: command.approvalReceiptId,
    approvalReceiptSha256: command.approvalReceiptSha256,
    approvalHash: command.approvalHash,
    binding: command.binding,
    action: command.action,
    vortonInstallationId: command.vortonInstallationId,
    workspaceId: command.workspaceId,
    ownerPersonId: command.ownerPersonId,
    proofScope: command.proofScope,
    executor: {
      ...command.executor,
      finalization: {
        credentialId: id(700 + seed),
        liveAuthorityCheckedAt: exactExecutedAt,
      },
    },
    approvalConsumptionCount: 1,
    consumedAt: command.consumedAt,
    executedAt: exactExecutedAt,
    predecessorReceipts: command.predecessorReceipts,
    outcome: { status: "succeeded", code: "completed" },
    effects: successEffects(command.action),
    evidence,
    receiptHash: digest(800 + seed),
  };
  return {
    ...draft,
    receiptHash: await hashModuleLifecycleActionReceipt(draft),
  };
}

function adapter() {
  let tick = 1;
  return new ControlledSyntheticLifecycleAdapter({
    fixture: {
      classification: "synthetic",
      vortonInstallationId: installationId,
      workspaceId,
      module: "tasks",
      recordCount: 7,
      preimageSha256: preimage,
      postimageSha256: postimage,
      controlledDeletionFixtureIds: [id(24)],
    },
    now: () => new Date(timestamp(tick++, 100)),
  });
}

describe("controlled synthetic lifecycle adapter", () => {
  it("executes and reconciles the complete four-action fixture chain", async () => {
    const current = adapter();
    const backupCommand = await commandFor("backup", 1);
    const backupResult = await current.execute(backupCommand, {
      predecessorReceipts: {},
    });
    expect(backupResult).toMatchObject({
      proofScope: "controlled-synthetic",
      evidence: {
        action: "backup",
        recordCount: 7,
        capturedStateSha256: preimage,
        encryptedAtRest: true,
      },
    });
    const backupReceipt = await receiptFor(
      backupCommand,
      backupResult.evidence,
      1,
    );

    const recoveryCommand = await commandFor("recovery", 2, [backupReceipt]);
    const recoveryResult = await current.execute(recoveryCommand, {
      predecessorReceipts: { backup: backupReceipt },
    });
    expect(recoveryResult.evidence).toMatchObject({
      action: "recovery",
      restoredRecordCount: 7,
      restoredStateSha256: preimage,
      productionNamespaceMutated: false,
      recoveryNamespaceDeleted: true,
    });
    const recoveryReceipt = await receiptFor(
      recoveryCommand,
      recoveryResult.evidence,
      2,
    );

    const deletionCommand = await commandFor("deletion", 3, [
      backupReceipt,
      recoveryReceipt,
    ]);
    const deletionResult = await current.execute(deletionCommand, {
      predecessorReceipts: {
        backup: backupReceipt,
        recovery: recoveryReceipt,
      },
    });
    expect(deletionResult.evidence).toMatchObject({
      action: "deletion",
      controlledFixtureId: id(24),
      productionRecordsDeleted: 0,
      postDeletionRetrievalDenied: true,
      residualCounts: {
        databaseRows: 0,
        storageObjects: 0,
        memoryFragments: 0,
        searchDocuments: 0,
        backupObjects: 0,
      },
    });
    const deletionReceipt = await receiptFor(
      deletionCommand,
      deletionResult.evidence,
      3,
    );

    const rollbackCommand = await commandFor("rollback", 4, [
      backupReceipt,
      recoveryReceipt,
      deletionReceipt,
    ]);
    const rollbackResult = await current.execute(rollbackCommand, {
      predecessorReceipts: {
        backup: backupReceipt,
        recovery: recoveryReceipt,
        deletion: deletionReceipt,
      },
    });
    expect(rollbackResult.evidence).toEqual({
      action: "rollback",
      fromPostimageSha256: postimage,
      restoredPreimageSha256: preimage,
      replayedPostimageSha256: postimage,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      rollbackNamespaceDeleted: true,
    });
    await expect(current.reconcile(rollbackCommand)).resolves.toEqual({
      status: "completed",
      result: rollbackResult,
    });
  });

  it("resumes response loss without repeating or conflicting the effect", async () => {
    const current = adapter();
    const command = await commandFor("backup", 5);
    await expect(
      current.execute(command, {
        predecessorReceipts: {},
        simulateInterruption: "after-effect-before-response",
      }),
    ).rejects.toMatchObject({ phase: "after-effect-before-response" });
    const reconciled = await current.reconcile(command);
    expect(reconciled.status).toBe("completed");
    await expect(
      current.execute(command, { predecessorReceipts: {} }),
    ).resolves.toEqual(
      reconciled.status === "completed" ? reconciled.result : undefined,
    );

    const conflicting = await commandFor("backup", 5, [], {
      commandId: command.commandId,
      executor: { ...command.executor, workId: id(999) },
    });
    await expect(
      current.execute(conflicting, { predecessorReceipts: {} }),
    ).rejects.toThrow("conflicts with prior effect");
  });

  it("serializes concurrent execution of the same exact command", async () => {
    const current = adapter();
    const command = await commandFor("backup", 51);
    const [first, second] = await Promise.all([
      current.execute(command, { predecessorReceipts: {} }),
      current.execute(command, { predecessorReceipts: {} }),
    ]);
    expect(second).toEqual(first);
    await expect(current.reconcile(command)).resolves.toEqual({
      status: "completed",
      result: first,
    });
  });

  it("keeps a pre-effect interruption unstarted and retryable", async () => {
    const current = adapter();
    const command = await commandFor("backup", 6);
    await expect(
      current.execute(command, {
        predecessorReceipts: {},
        simulateInterruption: "before-effect",
      }),
    ).rejects.toBeInstanceOf(SyntheticLifecycleInterruptionError);
    await expect(current.reconcile(command)).resolves.toEqual({
      status: "not-started",
    });
    await expect(
      current.execute(command, { predecessorReceipts: {} }),
    ).resolves.toMatchObject({ evidence: { action: "backup" } });
  });

  it("rejects production scope and commands outside the exact fixture", async () => {
    const current = adapter();
    const production = await commandFor("backup", 7, [], {
      proofScope: "workspace-production",
    });
    await expect(
      current.execute(production, { predecessorReceipts: {} }),
    ).rejects.toThrow("cannot satisfy workspace-production");

    const otherWorkspace = await commandFor("backup", 8, [], {
      workspaceId: id(888),
      binding: {
        ...(await commandFor("backup", 80)).binding,
        workspaceId: id(888),
      },
    });
    await expect(
      current.execute(otherWorkspace, { predecessorReceipts: {} }),
    ).rejects.toThrow("outside the controlled fixture boundary");
  });

  it("fails closed when a predecessor document is missing or substituted", async () => {
    const current = adapter();
    const backupCommand = await commandFor("backup", 9);
    const backupResult = await current.execute(backupCommand, {
      predecessorReceipts: {},
    });
    const backupReceipt = await receiptFor(
      backupCommand,
      backupResult.evidence,
      9,
    );
    const recoveryCommand = await commandFor("recovery", 10, [backupReceipt]);
    await expect(
      current.execute(recoveryCommand, { predecessorReceipts: {} }),
    ).rejects.toThrow("backup predecessor is required");

    const substitute = structuredClone(backupReceipt);
    substitute.receiptId = id(999);
    substitute.receiptHash = await hashModuleLifecycleActionReceipt(substitute);
    await expect(
      current.execute(recoveryCommand, {
        predecessorReceipts: { backup: substitute },
      }),
    ).rejects.toThrow("does not match command");
  });

  it("rejects a validly hashed but transitive predecessor substitution", async () => {
    const current = adapter();
    const backupCommand = await commandFor("backup", 11);
    const backupResult = await current.execute(backupCommand, {
      predecessorReceipts: {},
    });
    const backup = await receiptFor(backupCommand, backupResult.evidence, 11);

    const substituteBackupCommand = await commandFor("backup", 12);
    if (
      backupResult.evidence.action !== "backup" ||
      !("capturedAt" in backupResult.evidence)
    ) {
      throw new Error("Expected backup evidence");
    }
    const substituteBackup = await receiptFor(
      substituteBackupCommand,
      { ...backupResult.evidence, capturedAt: timestamp(12) },
      12,
    );
    const recoveryCommand = await commandFor("recovery", 13, [
      substituteBackup,
    ]);
    const recovery = await receiptFor(
      recoveryCommand,
      {
        action: "recovery",
        isolatedNamespaceSha256: digest(90),
        restoredRecordCount: 7,
        restoredStateSha256: preimage,
        productionNamespaceMutated: false,
        otherWorkspaceMutationCount: 0,
        recoveryNamespaceDeleted: true,
      },
      13,
    );
    const deletionCommand = await commandFor("deletion", 14, [
      backup,
      recovery,
    ]);
    await expect(
      current.execute(deletionCommand, {
        predecessorReceipts: { backup, recovery },
      }),
    ).rejects.toThrow("recovery predecessor chain is invalid");
  });

  it("rejects a recovery receipt whose restored count disagrees with its backup", async () => {
    const current = adapter();
    const backupCommand = await commandFor("backup", 15);
    const backupResult = await current.execute(backupCommand, {
      predecessorReceipts: {},
    });
    const backup = await receiptFor(backupCommand, backupResult.evidence, 15);
    const recoveryCommand = await commandFor("recovery", 16, [backup]);
    const recovery = await receiptFor(
      recoveryCommand,
      {
        action: "recovery",
        isolatedNamespaceSha256: digest(91),
        restoredRecordCount: 8,
        restoredStateSha256: preimage,
        productionNamespaceMutated: false,
        otherWorkspaceMutationCount: 0,
        recoveryNamespaceDeleted: true,
      },
      16,
    );
    const deletionCommand = await commandFor("deletion", 17, [
      backup,
      recovery,
    ]);

    await expect(
      current.execute(deletionCommand, {
        predecessorReceipts: { backup, recovery },
      }),
    ).rejects.toThrow("recovery predecessor chain is invalid");
  });
});

describe("controlled synthetic blob store", () => {
  it("fences object bytes and idempotency by installation and workspace", async () => {
    const store = new ControlledSyntheticBlobStore();
    const scope = { vortonInstallationId: installationId, workspaceId };
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put({
      scope,
      objectKey: "fixture.bin",
      bytes,
      idempotencyKey: id(1),
    });
    await expect(store.get(scope, "fixture.bin")).resolves.toMatchObject({
      bytes,
    });
    await expect(
      store.get({ ...scope, workspaceId: id(999) }, "fixture.bin"),
    ).resolves.toBeNull();
    await expect(
      store.put({
        scope,
        objectKey: "fixture.bin",
        bytes: new Uint8Array([9]),
        idempotencyKey: id(1),
      }),
    ).rejects.toThrow("retry conflicts");
  });
});
