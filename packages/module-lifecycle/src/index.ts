import {
  canonicalModuleLifecycleJson,
  moduleLifecycleActionCommandSchema,
  moduleLifecycleCanonicalSha256,
  hashModuleLifecycleActionCommand,
  parseModuleLifecycleActionReceipt,
  type ModuleLifecycleActionCommand,
  type ModuleLifecycleActionEvidence,
  type ModuleLifecycleActionReceipt,
} from "@vorton/contracts";

export interface LifecycleStorageScope {
  vortonInstallationId: string;
  workspaceId: string;
}

export interface LifecycleBlob {
  bytes: Uint8Array;
  sha256: string;
}

export interface ModuleLifecycleBlobStore {
  put(input: {
    scope: LifecycleStorageScope;
    objectKey: string;
    bytes: Uint8Array;
    idempotencyKey: string;
  }): Promise<{ sha256: string }>;
  get(
    scope: LifecycleStorageScope,
    objectKey: string,
  ): Promise<LifecycleBlob | null>;
}

export interface ModuleLifecycleKeyResolver {
  resolveAes256GcmKey(input: {
    scope: LifecycleStorageScope;
    encryptionKeyBindingId: string;
  }): Promise<CryptoKey>;
}

export type LifecyclePredecessorDocuments = Partial<
  Record<"backup" | "recovery" | "deletion", ModuleLifecycleActionReceipt>
>;

export interface ModuleLifecycleExecutionContext {
  predecessorReceipts: LifecyclePredecessorDocuments;
  simulateInterruption?: "before-effect" | "after-effect-before-response";
}

export interface ModuleLifecycleExecutionResult {
  proofScope: "controlled-synthetic";
  evidence: ModuleLifecycleActionEvidence;
  evidenceSha256: string;
  completedAt: string;
}

export type ModuleLifecycleReconciliation =
  | { status: "not-started" }
  | { status: "completed"; result: ModuleLifecycleExecutionResult };

export interface ModuleLifecycleAdapter {
  execute(
    command: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
  ): Promise<ModuleLifecycleExecutionResult>;
  reconcile(
    command: ModuleLifecycleActionCommand,
  ): Promise<ModuleLifecycleReconciliation>;
}

export class SyntheticLifecycleInterruptionError extends Error {
  constructor(
    readonly phase: "before-effect" | "after-effect-before-response",
  ) {
    super(`Controlled synthetic lifecycle interruption: ${phase}`);
  }
}

function scopeKey(scope: LifecycleStorageScope): string {
  return `${scope.vortonInstallationId}\u0000${scope.workspaceId}`;
}

function copy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

/**
 * A workspace-fenced in-memory object store for controlled fixtures. It is not
 * a production storage adapter and cannot satisfy a workspace-production receipt.
 */
export class ControlledSyntheticBlobStore implements ModuleLifecycleBlobStore {
  readonly #objects = new Map<string, Map<string, LifecycleBlob>>();
  readonly #commands = new Map<string, { objectKey: string; sha256: string }>();

  async put(input: {
    scope: LifecycleStorageScope;
    objectKey: string;
    bytes: Uint8Array;
    idempotencyKey: string;
  }): Promise<{ sha256: string }> {
    const sha256 = await rawSha256(input.bytes);
    const commandKey = `${scopeKey(input.scope)}\u0000${input.idempotencyKey}`;
    const previous = this.#commands.get(commandKey);
    if (
      previous &&
      (previous.objectKey !== input.objectKey || previous.sha256 !== sha256)
    ) {
      throw new Error(
        "Synthetic lifecycle object retry conflicts with prior effect",
      );
    }
    const objects = this.#objects.get(scopeKey(input.scope)) ?? new Map();
    const existing = objects.get(input.objectKey);
    if (existing && existing.sha256 !== sha256) {
      throw new Error(
        "Synthetic lifecycle object key already has different bytes",
      );
    }
    objects.set(input.objectKey, { bytes: copy(input.bytes), sha256 });
    this.#objects.set(scopeKey(input.scope), objects);
    this.#commands.set(commandKey, { objectKey: input.objectKey, sha256 });
    return { sha256 };
  }

  async get(
    scope: LifecycleStorageScope,
    objectKey: string,
  ): Promise<LifecycleBlob | null> {
    const stored = this.#objects.get(scopeKey(scope))?.get(objectKey);
    return stored ? { bytes: copy(stored.bytes), sha256: stored.sha256 } : null;
  }
}

/** Test-only deterministic key material, domain-separated by workspace. */
class ControlledSyntheticKeyResolver implements ModuleLifecycleKeyResolver {
  readonly #secret = crypto.getRandomValues(new Uint8Array(32));

  async resolveAes256GcmKey(input: {
    scope: LifecycleStorageScope;
    encryptionKeyBindingId: string;
  }): Promise<CryptoKey> {
    const domain = new TextEncoder().encode(
      canonicalModuleLifecycleJson({
        contract: "vorton.controlled-synthetic-key.v1",
        ...input.scope,
        encryptionKeyBindingId: input.encryptionKeyBindingId,
      }),
    );
    const seed = new Uint8Array(this.#secret.length + domain.length);
    seed.set(this.#secret);
    seed.set(domain, this.#secret.length);
    const bytes = await crypto.subtle.digest("SHA-256", seed);
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
}

export interface ControlledSyntheticFixture {
  classification: "synthetic";
  vortonInstallationId: string;
  workspaceId: string;
  module: string;
  recordCount: number;
  preimageSha256: string;
  postimageSha256: string;
  controlledDeletionFixtureIds: string[];
}

export interface ControlledSyntheticLifecycleAdapterOptions {
  fixture: ControlledSyntheticFixture;
  now?: () => Date;
}

/**
 * Deterministic protocol proof for controlled synthetic fixtures only. It never
 * accepts record contents, never performs network I/O, and never claims a
 * workspace-production lifecycle result.
 */
export class ControlledSyntheticLifecycleAdapter implements ModuleLifecycleAdapter {
  readonly #fixture: ControlledSyntheticFixture;
  readonly #blobStore: ModuleLifecycleBlobStore;
  readonly #keyResolver: ModuleLifecycleKeyResolver;
  readonly #now: () => Date;
  readonly #results = new Map<
    string,
    { commandHash: string; result: ModuleLifecycleExecutionResult }
  >();
  readonly #inFlight = new Map<
    string,
    { commandHash: string; execution: Promise<ModuleLifecycleExecutionResult> }
  >();
  readonly #deletionFixtures: Map<
    string,
    Map<"database" | "storage" | "memory" | "search" | "backups", Set<string>>
  >;
  readonly #isolatedNamespaces = new Map<
    string,
    { recordCount: number; stateSha256: string }
  >();
  readonly #targetCommands = new Map<
    string,
    { commandId: string; commandHash: string }
  >();

  constructor(options: ControlledSyntheticLifecycleAdapterOptions) {
    this.#fixture = structuredClone(options.fixture);
    if (
      this.#fixture.classification !== "synthetic" ||
      !Number.isSafeInteger(this.#fixture.recordCount) ||
      this.#fixture.recordCount < 0
    ) {
      throw new Error(
        "Controlled lifecycle adapter accepts synthetic counts only",
      );
    }
    this.#blobStore = new ControlledSyntheticBlobStore();
    this.#keyResolver = new ControlledSyntheticKeyResolver();
    this.#now = options.now ?? (() => new Date());
    this.#deletionFixtures = new Map(
      this.#fixture.controlledDeletionFixtureIds.map((id) => [
        id,
        new Map([
          ["database" as const, new Set([`${id}:database`])],
          ["storage" as const, new Set([`${id}:storage`])],
          ["memory" as const, new Set([`${id}:memory`])],
          ["search" as const, new Set([`${id}:search`])],
          ["backups" as const, new Set([`${id}:backups`])],
        ]),
      ]),
    );
  }

  async execute(
    input: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
  ): Promise<ModuleLifecycleExecutionResult> {
    const command = moduleLifecycleActionCommandSchema.parse(input);
    await this.#verifyCommandHash(command);
    this.#assertControlledFixture(command);
    const prior = this.#results.get(command.commandId);
    if (prior) {
      if (prior.commandHash !== command.commandHash) {
        throw new Error("Lifecycle command retry conflicts with prior effect");
      }
      return structuredClone(prior.result);
    }
    const active = this.#inFlight.get(command.commandId);
    if (active) {
      if (active.commandHash !== command.commandHash) {
        throw new Error("Lifecycle command conflicts with in-flight effect");
      }
      return structuredClone(await active.execution);
    }
    const execution = this.#executeOnce(command, context);
    this.#inFlight.set(command.commandId, {
      commandHash: command.commandHash,
      execution,
    });
    try {
      return structuredClone(await execution);
    } finally {
      const current = this.#inFlight.get(command.commandId);
      if (current?.execution === execution) {
        this.#inFlight.delete(command.commandId);
      }
    }
  }

  async #executeOnce(
    command: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
  ): Promise<ModuleLifecycleExecutionResult> {
    if (context.simulateInterruption === "before-effect") {
      throw new SyntheticLifecycleInterruptionError("before-effect");
    }
    this.#claimTarget(command);

    const completedAt = this.#timestampAtOrAfter(command.consumedAt);
    const evidence = await this.#executeAction(command, context, completedAt);
    const result: ModuleLifecycleExecutionResult = {
      proofScope: "controlled-synthetic",
      evidence,
      evidenceSha256: await moduleLifecycleCanonicalSha256(evidence),
      completedAt,
    };
    this.#results.set(command.commandId, {
      commandHash: command.commandHash,
      result: structuredClone(result),
    });
    if (context.simulateInterruption === "after-effect-before-response") {
      throw new SyntheticLifecycleInterruptionError(
        "after-effect-before-response",
      );
    }
    return structuredClone(result);
  }

  async reconcile(
    input: ModuleLifecycleActionCommand,
  ): Promise<ModuleLifecycleReconciliation> {
    const command = moduleLifecycleActionCommandSchema.parse(input);
    await this.#verifyCommandHash(command);
    this.#assertControlledFixture(command);
    const stored = this.#results.get(command.commandId);
    if (!stored) return { status: "not-started" };
    if (stored.commandHash !== command.commandHash) {
      throw new Error("Lifecycle reconciliation conflicts with prior effect");
    }
    return { status: "completed", result: structuredClone(stored.result) };
  }

  async #executeAction(
    command: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
    completedAt: string,
  ): Promise<ModuleLifecycleActionEvidence> {
    switch (command.action) {
      case "backup":
        return this.#backup(command, completedAt);
      case "recovery":
        return await this.#recovery(command, context);
      case "deletion":
        return await this.#deletion(command, context);
      case "rollback":
        return await this.#rollback(command, context);
    }
  }

  async #backup(
    command: ModuleLifecycleActionCommand,
    capturedAt: string,
  ): Promise<ModuleLifecycleActionEvidence> {
    if (command.binding.target.action !== "backup") {
      throw new Error("Backup command target mismatch");
    }
    const scope = this.#scope(command);
    const manifest = {
      contract: "vorton.controlled-synthetic-backup-manifest.v1",
      proofScope: "controlled-synthetic",
      commandId: command.commandId,
      binding: command.binding,
      recordCount: this.#fixture.recordCount,
      capturedStateSha256: this.#fixture.preimageSha256,
    };
    const manifestBytes = new TextEncoder().encode(
      canonicalModuleLifecycleJson(manifest),
    );
    const manifestSha256 = await moduleLifecycleCanonicalSha256(manifest);
    const key = await this.#keyResolver.resolveAes256GcmKey({
      scope,
      encryptionKeyBindingId: command.binding.target.encryptionKeyBindingId,
    });
    const iv = await this.#commandIv(command.commandId);
    const additionalData = this.#artifactAdditionalData(
      command.commandId,
      scope,
      command.binding.target.storageObjectKey,
    );
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: exactArrayBuffer(iv),
          additionalData: exactArrayBuffer(additionalData),
        },
        key,
        exactArrayBuffer(manifestBytes),
      ),
    );
    const expectedArtifactSha256 = await rawSha256(encrypted);
    const stored = await this.#blobStore.put({
      scope,
      objectKey: command.binding.target.storageObjectKey,
      bytes: encrypted,
      idempotencyKey: command.idempotencyKey,
    });
    if (stored.sha256 !== expectedArtifactSha256) {
      throw new Error("Synthetic backup store reported the wrong digest");
    }
    const readback = await this.#blobStore.get(
      scope,
      command.binding.target.storageObjectKey,
    );
    if (
      !readback ||
      readback.sha256 !== expectedArtifactSha256 ||
      (await rawSha256(readback.bytes)) !== expectedArtifactSha256 ||
      !bytesEqual(readback.bytes, encrypted)
    ) {
      throw new Error("Synthetic backup postcondition could not be verified");
    }
    return {
      action: "backup",
      capturedAt,
      recordCount: this.#fixture.recordCount,
      capturedStateSha256: this.#fixture.preimageSha256,
      manifestSha256,
      encryptedArtifactSha256: stored.sha256,
      encryptedAtRest: true,
      workspaceKeyBound: true,
      workspaceStorageBound: true,
      otherWorkspaceAccessDenied: true,
    };
  }

  async #recovery(
    command: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
  ): Promise<ModuleLifecycleActionEvidence> {
    if (command.binding.target.action !== "recovery") {
      throw new Error("Recovery command target mismatch");
    }
    const backup = await this.#requirePredecessor(
      context,
      "backup",
      command.binding.target.backupReceipt,
      command,
    );
    if (
      backup.evidence.action !== "backup" ||
      !("recordCount" in backup.evidence)
    ) {
      throw new Error("Recovery requires the exact successful backup receipt");
    }
    const restored = await this.#readBackupManifest(backup);
    if (
      restored.recordCount !== backup.evidence.recordCount ||
      restored.capturedStateSha256 !== command.binding.targetPreimageSha256
    ) {
      throw new Error(
        "Synthetic recovery backup contents do not match authority",
      );
    }
    const namespaceKey = this.#namespaceKey(
      command,
      command.binding.target.recoveryNamespace,
    );
    if (this.#isolatedNamespaces.has(namespaceKey)) {
      throw new Error("Synthetic recovery namespace is not isolated");
    }
    this.#isolatedNamespaces.set(namespaceKey, {
      recordCount: restored.recordCount,
      stateSha256: restored.capturedStateSha256,
    });
    const recovered = this.#isolatedNamespaces.get(namespaceKey);
    if (
      !recovered ||
      recovered.recordCount !== restored.recordCount ||
      recovered.stateSha256 !== restored.capturedStateSha256
    ) {
      throw new Error("Synthetic recovery postcondition could not be verified");
    }
    this.#isolatedNamespaces.delete(namespaceKey);
    if (this.#isolatedNamespaces.has(namespaceKey)) {
      throw new Error("Synthetic recovery namespace could not be deleted");
    }
    return {
      action: "recovery",
      isolatedNamespaceSha256: await this.#namespaceSha256(
        command,
        command.binding.target.recoveryNamespace,
      ),
      restoredRecordCount: restored.recordCount,
      restoredStateSha256: restored.capturedStateSha256,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      recoveryNamespaceDeleted: true,
    };
  }

  async #deletion(
    command: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
  ): Promise<ModuleLifecycleActionEvidence> {
    if (command.binding.target.action !== "deletion") {
      throw new Error("Deletion command target mismatch");
    }
    const backup = await this.#requirePredecessor(
      context,
      "backup",
      command.binding.target.backupReceipt,
      command,
    );
    const recovery = await this.#requirePredecessor(
      context,
      "recovery",
      command.binding.target.recoveryReceipt,
      command,
    );
    this.#assertRecoveryChain(recovery, backup);
    const fixture = this.#deletionFixtures.get(
      command.binding.target.controlledFixtureId,
    );
    if (!fixture) {
      throw new Error("Controlled deletion fixture is not registered");
    }
    const surfacesBefore = Object.fromEntries(
      [...fixture.entries()].map(([surface, objects]) => [
        surface,
        objects.size,
      ]),
    );
    for (const objects of fixture.values()) objects.clear();
    const residualCounts = {
      databaseRows: fixture.get("database")?.size ?? -1,
      storageObjects: fixture.get("storage")?.size ?? -1,
      memoryFragments: fixture.get("memory")?.size ?? -1,
      searchDocuments: fixture.get("search")?.size ?? -1,
      backupObjects: fixture.get("backups")?.size ?? -1,
    };
    if (Object.values(residualCounts).some((count) => count !== 0)) {
      throw new Error(
        "Controlled deletion fixture still has retrievable state",
      );
    }
    const verifiedResidualCounts = {
      databaseRows: 0 as const,
      storageObjects: 0 as const,
      memoryFragments: 0 as const,
      searchDocuments: 0 as const,
      backupObjects: 0 as const,
    };
    return {
      action: "deletion",
      mode: "controlled-fixture",
      controlledFixtureId: command.binding.target.controlledFixtureId,
      deletionManifestSha256: await moduleLifecycleCanonicalSha256({
        contract: "vorton.controlled-synthetic-deletion-manifest.v1",
        commandId: command.commandId,
        controlledFixtureId: command.binding.target.controlledFixtureId,
        rehearsalId: command.binding.target.rehearsalId,
        surfacesBefore,
        surfacesAfter: residualCounts,
      }),
      productionRecordsDeleted: 0,
      residualCounts: verifiedResidualCounts,
      postDeletionRetrievalDenied: true,
      otherWorkspaceMutationCount: 0,
    };
  }

  async #rollback(
    command: ModuleLifecycleActionCommand,
    context: ModuleLifecycleExecutionContext,
  ): Promise<ModuleLifecycleActionEvidence> {
    if (command.binding.target.action !== "rollback") {
      throw new Error("Rollback command target mismatch");
    }
    const backup = await this.#requirePredecessor(
      context,
      "backup",
      command.binding.target.backupReceipt,
      command,
    );
    const recovery = await this.#requirePredecessor(
      context,
      "recovery",
      command.binding.target.recoveryReceipt,
      command,
    );
    const deletion = await this.#requirePredecessor(
      context,
      "deletion",
      command.binding.target.deletionRehearsalReceipt,
      command,
    );
    this.#assertRecoveryChain(recovery, backup);
    this.#assertDeletionChain(deletion, backup, recovery);
    const namespaceKey = this.#namespaceKey(
      command,
      command.binding.target.rollbackNamespace,
    );
    if (this.#isolatedNamespaces.has(namespaceKey)) {
      throw new Error("Synthetic rollback namespace is not isolated");
    }
    this.#isolatedNamespaces.set(namespaceKey, {
      recordCount: this.#fixture.recordCount,
      stateSha256: command.binding.targetPostimageSha256,
    });
    const namespace = this.#isolatedNamespaces.get(namespaceKey)!;
    namespace.stateSha256 = command.binding.targetPreimageSha256;
    if (namespace.stateSha256 !== command.binding.targetPreimageSha256) {
      throw new Error("Synthetic rollback could not restore the preimage");
    }
    namespace.stateSha256 = command.binding.targetPostimageSha256;
    if (namespace.stateSha256 !== command.binding.targetPostimageSha256) {
      throw new Error("Synthetic rollback could not replay the postimage");
    }
    this.#isolatedNamespaces.delete(namespaceKey);
    if (this.#isolatedNamespaces.has(namespaceKey)) {
      throw new Error("Synthetic rollback namespace could not be deleted");
    }
    return {
      action: "rollback",
      fromPostimageSha256: command.binding.targetPostimageSha256,
      restoredPreimageSha256: command.binding.targetPreimageSha256,
      replayedPostimageSha256: command.binding.targetPostimageSha256,
      productionNamespaceMutated: false,
      otherWorkspaceMutationCount: 0,
      rollbackNamespaceDeleted: true,
    };
  }

  #assertControlledFixture(command: ModuleLifecycleActionCommand): void {
    if (command.proofScope !== "controlled-synthetic") {
      throw new Error(
        "Controlled synthetic adapter cannot satisfy workspace-production evidence",
      );
    }
    if (
      command.vortonInstallationId !== this.#fixture.vortonInstallationId ||
      command.workspaceId !== this.#fixture.workspaceId ||
      command.binding.module !== this.#fixture.module ||
      command.binding.targetPreimageSha256 !== this.#fixture.preimageSha256 ||
      command.binding.targetPostimageSha256 !== this.#fixture.postimageSha256
    ) {
      throw new Error(
        "Lifecycle command is outside the controlled fixture boundary",
      );
    }
  }

  #scope(command: ModuleLifecycleActionCommand): LifecycleStorageScope {
    return {
      vortonInstallationId: command.vortonInstallationId,
      workspaceId: command.workspaceId,
    };
  }

  #claimTarget(command: ModuleLifecycleActionCommand): void {
    const target = command.binding.target;
    const targetId =
      target.action === "backup"
        ? target.backupId
        : target.action === "recovery"
          ? target.recoveryId
          : target.action === "deletion"
            ? target.rehearsalId
            : target.rollbackId;
    const keys = [`${target.action}\u0000${targetId}`];
    if (target.action === "deletion") {
      keys.push(`deletion-fixture\u0000${target.controlledFixtureId}`);
    }
    for (const key of keys) {
      const previous = this.#targetCommands.get(key);
      if (
        previous &&
        (previous.commandId !== command.commandId ||
          previous.commandHash !== command.commandHash)
      ) {
        throw new Error("Lifecycle target is already bound to another command");
      }
    }
    for (const key of keys) {
      this.#targetCommands.set(key, {
        commandId: command.commandId,
        commandHash: command.commandHash,
      });
    }
  }

  #assertRecoveryChain(
    recovery: ModuleLifecycleActionReceipt,
    backup: ModuleLifecycleActionReceipt,
  ): void {
    const predecessors = recovery.predecessorReceipts;
    if (
      predecessors.action !== "recovery" ||
      recovery.evidence.action !== "recovery" ||
      backup.evidence.action !== "backup" ||
      !("restoredRecordCount" in recovery.evidence) ||
      !("recordCount" in backup.evidence) ||
      recovery.evidence.restoredRecordCount !== backup.evidence.recordCount ||
      canonicalModuleLifecycleJson(predecessors.backup) !==
        canonicalModuleLifecycleJson({
          receiptId: backup.receiptId,
          receiptSha256: backup.receiptHash,
        })
    ) {
      throw new Error("Lifecycle recovery predecessor chain is invalid");
    }
  }

  #assertDeletionChain(
    deletion: ModuleLifecycleActionReceipt,
    backup: ModuleLifecycleActionReceipt,
    recovery: ModuleLifecycleActionReceipt,
  ): void {
    const predecessors = deletion.predecessorReceipts;
    if (
      predecessors.action !== "deletion" ||
      canonicalModuleLifecycleJson(predecessors.backup) !==
        canonicalModuleLifecycleJson({
          receiptId: backup.receiptId,
          receiptSha256: backup.receiptHash,
        }) ||
      canonicalModuleLifecycleJson(predecessors.recovery) !==
        canonicalModuleLifecycleJson({
          receiptId: recovery.receiptId,
          receiptSha256: recovery.receiptHash,
        })
    ) {
      throw new Error("Lifecycle deletion predecessor chain is invalid");
    }
  }

  async #readBackupManifest(receipt: ModuleLifecycleActionReceipt): Promise<{
    recordCount: number;
    capturedStateSha256: string;
  }> {
    const evidence = receipt.evidence;
    if (
      receipt.binding.target.action !== "backup" ||
      evidence.action !== "backup" ||
      !("encryptedArtifactSha256" in evidence)
    ) {
      throw new Error("Synthetic recovery requires backup evidence");
    }
    const scope = {
      vortonInstallationId: receipt.vortonInstallationId,
      workspaceId: receipt.workspaceId,
    };
    const objectKey = receipt.binding.target.storageObjectKey;
    const artifact = await this.#blobStore.get(scope, objectKey);
    if (
      !artifact ||
      artifact.sha256 !== evidence.encryptedArtifactSha256 ||
      (await rawSha256(artifact.bytes)) !== artifact.sha256
    ) {
      throw new Error("Synthetic recovery backup artifact is unavailable");
    }
    const key = await this.#keyResolver.resolveAes256GcmKey({
      scope,
      encryptionKeyBindingId: receipt.binding.target.encryptionKeyBindingId,
    });
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: exactArrayBuffer(await this.#commandIv(receipt.commandId)),
          additionalData: exactArrayBuffer(
            this.#artifactAdditionalData(receipt.commandId, scope, objectKey),
          ),
        },
        key,
        exactArrayBuffer(artifact.bytes),
      );
    } catch {
      throw new Error(
        "Synthetic recovery backup artifact failed authentication",
      );
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new Error("Synthetic recovery backup manifest is invalid");
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("Synthetic recovery backup manifest is invalid");
    }
    const candidate = manifest as Record<string, unknown>;
    const exactKeys = [
      "binding",
      "capturedStateSha256",
      "commandId",
      "contract",
      "proofScope",
      "recordCount",
    ];
    if (
      Object.keys(candidate).sort().join("\u0000") !==
        exactKeys.join("\u0000") ||
      candidate.contract !== "vorton.controlled-synthetic-backup-manifest.v1" ||
      candidate.proofScope !== "controlled-synthetic" ||
      candidate.commandId !== receipt.commandId ||
      !Number.isSafeInteger(candidate.recordCount) ||
      (candidate.recordCount as number) < 0 ||
      candidate.capturedStateSha256 !== evidence.capturedStateSha256 ||
      canonicalModuleLifecycleJson(candidate.binding) !==
        canonicalModuleLifecycleJson(receipt.binding) ||
      (await moduleLifecycleCanonicalSha256(candidate)) !==
        evidence.manifestSha256
    ) {
      throw new Error("Synthetic recovery backup manifest failed verification");
    }
    return {
      recordCount: candidate.recordCount as number,
      capturedStateSha256: candidate.capturedStateSha256 as string,
    };
  }

  async #requirePredecessor(
    context: ModuleLifecycleExecutionContext,
    action: "backup" | "recovery" | "deletion",
    reference: { receiptId: string; receiptSha256: string },
    command: ModuleLifecycleActionCommand,
  ): Promise<ModuleLifecycleActionReceipt> {
    const candidate = context.predecessorReceipts[action];
    if (!candidate) {
      throw new Error(`Lifecycle ${action} predecessor is required`);
    }
    const receipt = await parseModuleLifecycleActionReceipt(candidate);
    const expectedProofScope =
      action === "deletion" ? "controlled-synthetic" : command.proofScope;
    if (
      receipt.action !== action ||
      receipt.outcome.status !== "succeeded" ||
      receipt.proofScope !== expectedProofScope ||
      receipt.receiptId !== reference.receiptId ||
      receipt.receiptHash !== reference.receiptSha256 ||
      receipt.vortonInstallationId !== command.vortonInstallationId ||
      receipt.workspaceId !== command.workspaceId ||
      receipt.binding.realm !== command.binding.realm ||
      receipt.binding.module !== command.binding.module ||
      receipt.binding.sequence !== command.binding.sequence ||
      receipt.binding.migrationPlanHash !== command.binding.migrationPlanHash ||
      receipt.binding.sourceSnapshotSha256 !==
        command.binding.sourceSnapshotSha256 ||
      receipt.binding.targetPreimageSha256 !==
        command.binding.targetPreimageSha256 ||
      receipt.binding.targetPostimageSha256 !==
        command.binding.targetPostimageSha256 ||
      receipt.executedAt > command.consumedAt
    ) {
      throw new Error(`Lifecycle ${action} predecessor does not match command`);
    }
    return receipt;
  }

  async #verifyCommandHash(
    command: ModuleLifecycleActionCommand,
  ): Promise<void> {
    if (
      (await hashModuleLifecycleActionCommand(command)) !== command.commandHash
    ) {
      throw new Error("Lifecycle command hash is invalid");
    }
  }

  #timestampAtOrAfter(minimum: string): string {
    const value = this.#now().toISOString();
    return value < minimum ? minimum : value;
  }

  async #namespaceSha256(
    command: ModuleLifecycleActionCommand,
    namespace: string,
  ): Promise<string> {
    return moduleLifecycleCanonicalSha256({
      contract: "vorton.controlled-synthetic-namespace.v1",
      commandId: command.commandId,
      namespace,
    });
  }

  #namespaceKey(
    command: ModuleLifecycleActionCommand,
    namespace: string,
  ): string {
    return `${scopeKey(this.#scope(command))}\u0000${namespace}`;
  }

  async #commandIv(commandId: string): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(commandId),
      ),
    ).slice(0, 12);
  }

  #artifactAdditionalData(
    commandId: string,
    scope: LifecycleStorageScope,
    objectKey: string,
  ): Uint8Array {
    return new TextEncoder().encode(
      canonicalModuleLifecycleJson({
        contract: "vorton.controlled-synthetic-backup-aad.v1",
        commandId,
        ...scope,
        objectKey,
      }),
    );
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function rawSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}
