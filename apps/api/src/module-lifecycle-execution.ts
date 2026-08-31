import {
  canonicalModuleLifecycleJson,
  moduleLifecycleActionConsumeRequestSchema,
  moduleLifecycleActionFinalizeRequestSchema,
  parseModuleLifecycleActionCommandCreation,
  parseModuleLifecycleActionCompletion,
  type ModuleLifecycleActionCommandCreation,
  type ModuleLifecycleActionCompletion,
  type ModuleLifecycleActionConsumeRequest,
  type ModuleLifecycleActionFinalizeRequest,
} from "@vorton/contracts";
import type { Database } from "@vorton/database";
import type { AuthenticatedWorkerCredential } from "@vorton/kernel";

export class ModuleLifecycleExecutionInputError extends Error {}
export class ModuleLifecycleExecutionForbiddenError extends Error {}
export class ModuleLifecycleExecutionConflictError extends Error {}
export class ModuleLifecycleExecutionIntegrityError extends Error {}

const forbiddenDatabaseErrors = new Set([
  "Signed credentialed worker context is required to consume lifecycle approval",
  "Live worker credential is required to consume lifecycle approval",
  "Exactly one live Work-scoped lifecycle capability grant is required",
  "Live lifecycle execution authority is unavailable",
  "Signed credentialed worker context is required to finalize lifecycle action",
  "Fresh live worker credential is required to finalize lifecycle action",
  "Exact lifecycle action command is unavailable to this worker",
  "Signed worker context is required for lifecycle owner check",
  "Live original owner membership is required for lifecycle transition",
]);
const inputDatabaseErrors = new Set([
  "Exact module lifecycle approval does not exist",
  "Lifecycle predecessor receipt chain is invalid",
  "Exact lifecycle action result is invalid",
]);
const conflictDatabaseErrors = new Set([
  "Lifecycle action command retry conflicts with immutable consumption",
  "Lifecycle action receipt retry conflicts with immutable result",
]);
const integrityDatabaseErrors = new Set([
  "Lifecycle action command Record integrity failure",
  "Lifecycle approval receipt integrity failure",
  "Lifecycle approval Record integrity failure",
  "Lifecycle action receipt Record integrity failure",
  "Module lifecycle predecessor receipt integrity failure",
]);

function classifyDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const code =
    error && typeof error === "object" && "code" in error
      ? Reflect.get(error, "code")
      : undefined;
  if (code !== "P0001") throw error;
  if (forbiddenDatabaseErrors.has(message)) {
    throw new ModuleLifecycleExecutionForbiddenError(
      "Live worker authority is required for this lifecycle transition",
    );
  }
  if (inputDatabaseErrors.has(message)) {
    throw new ModuleLifecycleExecutionInputError(
      "The lifecycle execution request is invalid",
    );
  }
  if (conflictDatabaseErrors.has(message)) {
    throw new ModuleLifecycleExecutionConflictError(
      "The lifecycle transition conflicts with immutable execution state",
    );
  }
  if (integrityDatabaseErrors.has(message)) {
    throw new ModuleLifecycleExecutionIntegrityError(
      "Lifecycle execution authority failed its integrity check",
    );
  }
  throw error;
}

function assertWorkerPath(
  installationId: string,
  workspaceId: string,
  worker: AuthenticatedWorkerCredential,
): void {
  if (
    worker.installationId !== installationId ||
    worker.workspaceId !== workspaceId
  ) {
    throw new ModuleLifecycleExecutionForbiddenError(
      "The worker credential cannot cross its installation or workspace",
    );
  }
}

function databaseWorkerContext(worker: AuthenticatedWorkerCredential) {
  return {
    installationId: worker.installationId,
    workspaceId: worker.workspaceId,
    workerId: worker.workerId,
    credentialId: worker.credentialId,
  };
}

export class DatabaseModuleLifecycleExecution {
  constructor(private readonly database: Database) {}

  async consume(
    installationId: string,
    workspaceId: string,
    approvalId: string,
    request: ModuleLifecycleActionConsumeRequest,
    worker: AuthenticatedWorkerCredential,
  ): Promise<ModuleLifecycleActionCommandCreation> {
    assertWorkerPath(installationId, workspaceId, worker);
    const exactRequest =
      moduleLifecycleActionConsumeRequestSchema.parse(request);
    try {
      return await this.database.asWorker(
        databaseWorkerContext(worker),
        async (transaction) => {
          const result = await transaction.query<{ creation: unknown }>(
            `select public.consume_module_lifecycle_action_approval_live(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text
             ) as creation`,
            [
              exactRequest.commandId,
              approvalId,
              installationId,
              workspaceId,
              exactRequest.workId,
              exactRequest.proofScope,
            ],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new ModuleLifecycleExecutionIntegrityError(
              "Database returned an ambiguous lifecycle command",
            );
          }
          let creation: ModuleLifecycleActionCommandCreation;
          try {
            creation = await parseModuleLifecycleActionCommandCreation(
              result.rows[0]?.creation,
            );
          } catch {
            throw new ModuleLifecycleExecutionIntegrityError(
              "Database returned an invalid lifecycle command",
            );
          }
          const command = creation.command;
          if (
            creation.approval.approvalId !== approvalId ||
            command.commandId !== exactRequest.commandId ||
            command.vortonInstallationId !== installationId ||
            command.workspaceId !== workspaceId ||
            command.executor.workerId !== worker.workerId ||
            command.executor.workId !== exactRequest.workId ||
            command.proofScope !== exactRequest.proofScope
          ) {
            throw new ModuleLifecycleExecutionIntegrityError(
              "Database lifecycle command crossed its exact worker request",
            );
          }
          return creation;
        },
      );
    } catch (error) {
      if (
        error instanceof ModuleLifecycleExecutionInputError ||
        error instanceof ModuleLifecycleExecutionForbiddenError ||
        error instanceof ModuleLifecycleExecutionConflictError ||
        error instanceof ModuleLifecycleExecutionIntegrityError
      ) {
        throw error;
      }
      classifyDatabaseError(error);
    }
  }

  async finalize(
    installationId: string,
    workspaceId: string,
    commandId: string,
    request: ModuleLifecycleActionFinalizeRequest,
    worker: AuthenticatedWorkerCredential,
  ): Promise<ModuleLifecycleActionCompletion> {
    assertWorkerPath(installationId, workspaceId, worker);
    const exactRequest =
      moduleLifecycleActionFinalizeRequestSchema.parse(request);
    try {
      return await this.database.asWorker(
        databaseWorkerContext(worker),
        async (transaction) => {
          const result = await transaction.query<{ completion: unknown }>(
            `select public.finalize_module_lifecycle_action_live(
               $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::jsonb, $6::jsonb, $7::jsonb
             ) as completion`,
            [
              exactRequest.receiptId,
              commandId,
              installationId,
              workspaceId,
              exactRequest.outcome,
              exactRequest.effects,
              exactRequest.evidence,
            ],
          );
          if (result.rowCount !== 1 || result.rows.length !== 1) {
            throw new ModuleLifecycleExecutionIntegrityError(
              "Database returned an ambiguous lifecycle result",
            );
          }
          let completion: ModuleLifecycleActionCompletion;
          try {
            completion = await parseModuleLifecycleActionCompletion(
              result.rows[0]?.completion,
            );
          } catch {
            throw new ModuleLifecycleExecutionIntegrityError(
              "Database returned an invalid lifecycle result",
            );
          }
          const receipt = completion.actionReceipt;
          if (
            completion.command.commandId !== commandId ||
            receipt.receiptId !== exactRequest.receiptId ||
            receipt.vortonInstallationId !== installationId ||
            receipt.workspaceId !== workspaceId ||
            receipt.executor.workerId !== worker.workerId ||
            canonicalModuleLifecycleJson(receipt.outcome) !==
              canonicalModuleLifecycleJson(exactRequest.outcome) ||
            canonicalModuleLifecycleJson(receipt.effects) !==
              canonicalModuleLifecycleJson(exactRequest.effects) ||
            canonicalModuleLifecycleJson(receipt.evidence) !==
              canonicalModuleLifecycleJson(exactRequest.evidence)
          ) {
            throw new ModuleLifecycleExecutionIntegrityError(
              "Database lifecycle result crossed its exact worker request",
            );
          }
          return completion;
        },
      );
    } catch (error) {
      if (
        error instanceof ModuleLifecycleExecutionInputError ||
        error instanceof ModuleLifecycleExecutionForbiddenError ||
        error instanceof ModuleLifecycleExecutionConflictError ||
        error instanceof ModuleLifecycleExecutionIntegrityError
      ) {
        throw error;
      }
      classifyDatabaseError(error);
    }
  }
}
