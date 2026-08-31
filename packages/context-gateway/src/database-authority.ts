import type { QueryResultRow } from "pg";

import type { DataClassification, SourceCitation } from "@vorton/contracts";
import type { Database, SqlExecutor } from "@vorton/database";
import { workspaceHindsightBank } from "@vorton/memory";

import type {
  MemoryBankAuthorityRequest,
  MemoryBankAuthorityResolver,
  MemoryAuthoritySubject,
  MemoryGatewayOperation,
  ResolvedMemoryBankAuthority,
} from "./index.js";

export class MemoryBankAuthorityDeniedError extends Error {}
export class MemoryBankAuthorityIntegrityError extends Error {}

interface MemoryBankAuthorityRow {
  external_bank_id: string;
  installation_realm: "personal" | "organizational";
  principal_kind: "person" | "worker";
  principal_id: string;
  context_subject_id: string;
  capability_grant_id: string;
  capability: string;
  capability_mode: "observe" | "modify";
  data_classification_ceiling: DataClassification;
}

export interface MemorySourceMaterial {
  sourceRevisionId: string;
  classification: DataClassification;
  revisionHash: string;
  citations: SourceCitation[];
  dataClassificationCeiling: DataClassification;
}

interface MemorySourceMaterialRow {
  source_revision_id: string;
  classification: DataClassification;
  source_uri: string;
  revision_hash: string;
  locator: string;
  external_bank_id: string;
  data_classification_ceiling: DataClassification;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const memoryAuthorityRowKeys = [
  "capability",
  "capability_grant_id",
  "capability_mode",
  "context_subject_id",
  "data_classification_ceiling",
  "external_bank_id",
  "installation_realm",
  "principal_id",
  "principal_kind",
];
const memorySourceMaterialRowKeys = [
  "classification",
  "data_classification_ceiling",
  "external_bank_id",
  "locator",
  "revision_hash",
  "source_revision_id",
  "source_uri",
];
const revisionHashPattern = /^[0-9a-f]{64}$/;
const dataClassifications: DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
  "synthetic",
];

const operationAuthority: Record<
  MemoryGatewayOperation,
  { capability: string; mode: "observe" | "modify" }
> = {
  retrieve: { capability: "memory.retrieve", mode: "observe" },
  retain: { capability: "memory.retain", mode: "modify" },
  consolidate: { capability: "memory.consolidate", mode: "modify" },
  invalidate: { capability: "memory.invalidate", mode: "modify" },
};

function isPostgresDenial(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    Reflect.get(error, "code") === "P0001",
  );
}

/**
 * Resolves the external memory bank only after PostgreSQL verifies the signed
 * actor context, live workspace authority, credential state, capability, Work
 * scope, workspace realm, and canonical bank binding.
 */
export class DatabaseMemoryBankAuthorityResolver implements MemoryBankAuthorityResolver {
  readonly #subject: MemoryAuthoritySubject;

  /**
   * The subject must come from verified server authentication or a verified
   * worker credential result. Operation payloads never carry identity fields.
   */
  constructor(
    private readonly database: Database,
    subject: MemoryAuthoritySubject,
  ) {
    this.#subject = structuredClone(subject);
  }

  async resolve(
    request: MemoryBankAuthorityRequest,
  ): Promise<ResolvedMemoryBankAuthority> {
    try {
      const result = await this.#withActor(request, (transaction) =>
        transaction.query<QueryResultRow>(
          `select external_bank_id, installation_realm, principal_kind,
                  principal_id, context_subject_id, capability_grant_id,
                  capability,
                  capability_mode, data_classification_ceiling
             from public.resolve_context_gateway_memory_bank(
               $1::uuid,
               $2::uuid,
               $3::public.context_gateway_operation,
               $4::uuid
             )`,
          [
            request.installationId,
            request.workspaceId,
            request.operation,
            request.workId,
          ],
        ),
      );

      if (result.rowCount === 0 || result.rows.length === 0) {
        throw new MemoryBankAuthorityDeniedError(
          "Live memory bank authority is required",
        );
      }
      if (result.rowCount !== 1 || result.rows.length !== 1) {
        throw new MemoryBankAuthorityIntegrityError(
          "PostgreSQL returned ambiguous memory bank authority",
        );
      }

      const rawRow = result.rows[0];
      if (!rawRow) {
        throw new MemoryBankAuthorityIntegrityError(
          "PostgreSQL omitted memory bank authority",
        );
      }
      const row = parseMemoryBankAuthorityRow(rawRow);
      const expectedAuthority = operationAuthority[request.operation];
      const expectedPrincipalKind = this.#subject.kind;
      const expectedSubjectId =
        this.#subject.kind === "person"
          ? this.#subject.authUserId
          : this.#subject.workerId;
      const canonical = workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      );
      if (
        row.installation_realm !== request.installationRealm ||
        row.external_bank_id !== canonical.id ||
        row.principal_kind !== expectedPrincipalKind ||
        row.context_subject_id !== expectedSubjectId ||
        (this.#subject.kind === "worker" &&
          row.principal_id !== this.#subject.workerId) ||
        row.capability !== expectedAuthority.capability ||
        row.capability_mode !== expectedAuthority.mode
      ) {
        throw new MemoryBankAuthorityIntegrityError(
          "PostgreSQL memory bank authority violated its exact request binding",
        );
      }
      return {
        bank: canonical,
        principalKind: row.principal_kind,
        principalId: row.principal_id,
        contextSubjectId: row.context_subject_id,
        capabilityGrantId: row.capability_grant_id,
        capability: row.capability,
        capabilityMode: row.capability_mode,
        dataClassificationCeiling: row.data_classification_ceiling,
      };
    } catch (error) {
      if (isPostgresDenial(error)) {
        throw new MemoryBankAuthorityDeniedError(
          "Live memory bank authority is required",
        );
      }
      throw error;
    }
  }

  /**
   * Resolves canonical source provenance only through the same live retrieve
   * capability boundary. Direct memory-table reads remain forbidden.
   */
  async resolveSourceMaterial(
    request: MemoryBankAuthorityRequest & {
      sourceRevisionIds: string[];
    },
  ): Promise<MemorySourceMaterial[]> {
    const sourceRevisionIds = structuredClone(request.sourceRevisionIds);
    if (
      request.operation !== "retrieve" ||
      sourceRevisionIds.length === 0 ||
      sourceRevisionIds.length > 256 ||
      new Set(sourceRevisionIds).size !== sourceRevisionIds.length ||
      sourceRevisionIds.some((id) => !uuidPattern.test(id))
    ) {
      throw new MemoryBankAuthorityIntegrityError(
        "Source material requires one to 256 distinct canonical revision IDs",
      );
    }
    try {
      const result = await this.#withActor(request, (transaction) =>
        transaction.query<QueryResultRow>(
          `select source_revision_id, classification, source_uri,
                  revision_hash, locator, external_bank_id,
                  data_classification_ceiling
             from public.resolve_context_gateway_source_material(
               $1::uuid,
               $2::uuid,
               $3::public.installation_realm,
               $4::uuid,
               $5::uuid[]
             )`,
          [
            request.installationId,
            request.workspaceId,
            request.installationRealm,
            request.workId,
            sourceRevisionIds,
          ],
        ),
      );
      const canonical = workspaceHindsightBank(
        request.installationId,
        request.workspaceId,
        request.installationRealm,
      );
      const requestedIds = new Set(sourceRevisionIds);
      const materialByRevision = new Map<string, MemorySourceMaterial>();
      for (const rawRow of result.rows) {
        const row = parseMemorySourceMaterialRow(rawRow);
        if (
          row.external_bank_id !== canonical.id ||
          !requestedIds.has(row.source_revision_id)
        ) {
          throw new MemoryBankAuthorityIntegrityError(
            "PostgreSQL source material violated its exact request binding",
          );
        }
        if (
          !classificationAllows(
            row.data_classification_ceiling,
            row.classification,
          )
        ) {
          throw new MemoryBankAuthorityIntegrityError(
            "PostgreSQL exposed memory source material above its authority ceiling",
          );
        }
        const existing = materialByRevision.get(row.source_revision_id);
        if (existing) {
          if (
            existing.classification !== row.classification ||
            existing.revisionHash !== row.revision_hash ||
            existing.dataClassificationCeiling !==
              row.data_classification_ceiling ||
            existing.citations.some(
              (citation) => citation.locator === row.locator,
            )
          ) {
            throw new MemoryBankAuthorityIntegrityError(
              "PostgreSQL returned inconsistent memory source provenance",
            );
          }
          existing.citations.push({
            sourceRevisionId: row.source_revision_id,
            sourceUri: row.source_uri,
            revisionHash: row.revision_hash,
            locator: row.locator,
          });
        } else {
          materialByRevision.set(row.source_revision_id, {
            sourceRevisionId: row.source_revision_id,
            classification: row.classification,
            revisionHash: row.revision_hash,
            citations: [
              {
                sourceRevisionId: row.source_revision_id,
                sourceUri: row.source_uri,
                revisionHash: row.revision_hash,
                locator: row.locator,
              },
            ],
            dataClassificationCeiling: row.data_classification_ceiling,
          });
        }
      }
      if (materialByRevision.size !== sourceRevisionIds.length) {
        throw new MemoryBankAuthorityIntegrityError(
          "PostgreSQL did not resolve every requested source revision",
        );
      }
      return sourceRevisionIds.map((sourceRevisionId) => {
        const material = materialByRevision.get(sourceRevisionId);
        if (!material) {
          throw new MemoryBankAuthorityIntegrityError(
            "PostgreSQL did not resolve every requested source revision",
          );
        }
        return material;
      });
    } catch (error) {
      if (isPostgresDenial(error)) {
        throw new MemoryBankAuthorityDeniedError(
          "Live memory source authority is required",
        );
      }
      throw error;
    }
  }

  #withActor<T>(
    request: MemoryBankAuthorityRequest,
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (this.#subject.kind === "person") {
      return this.database.asPerson(
        {
          authUserId: this.#subject.authUserId,
          installationId: request.installationId,
          workspaceId: request.workspaceId,
        },
        work,
      );
    }
    if (!this.#subject.credentialId.trim()) {
      throw new MemoryBankAuthorityDeniedError(
        "A live worker credential is required for memory bank authority",
      );
    }
    return this.database.asWorker(
      {
        workerId: this.#subject.workerId,
        credentialId: this.#subject.credentialId,
        installationId: request.installationId,
        workspaceId: request.workspaceId,
      },
      work,
    );
  }
}

function parseMemoryBankAuthorityRow(value: unknown): MemoryBankAuthorityRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryBankAuthorityIntegrityError(
      "PostgreSQL returned malformed memory bank authority",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== memoryAuthorityRowKeys.length ||
    !keys.every((key, index) => key === memoryAuthorityRowKeys[index])
  ) {
    throw new MemoryBankAuthorityIntegrityError(
      "PostgreSQL returned unexpected memory bank authority fields",
    );
  }
  if (
    typeof record.external_bank_id !== "string" ||
    (record.installation_realm !== "personal" &&
      record.installation_realm !== "organizational") ||
    (record.principal_kind !== "person" &&
      record.principal_kind !== "worker") ||
    typeof record.principal_id !== "string" ||
    !uuidPattern.test(record.principal_id) ||
    typeof record.context_subject_id !== "string" ||
    !uuidPattern.test(record.context_subject_id) ||
    typeof record.capability_grant_id !== "string" ||
    !uuidPattern.test(record.capability_grant_id) ||
    typeof record.capability !== "string" ||
    (record.capability_mode !== "observe" &&
      record.capability_mode !== "modify") ||
    typeof record.data_classification_ceiling !== "string" ||
    !dataClassifications.includes(
      record.data_classification_ceiling as DataClassification,
    )
  ) {
    throw new MemoryBankAuthorityIntegrityError(
      "PostgreSQL returned invalid memory bank authority values",
    );
  }
  return record as unknown as MemoryBankAuthorityRow;
}

function parseMemorySourceMaterialRow(value: unknown): MemorySourceMaterialRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryBankAuthorityIntegrityError(
      "PostgreSQL returned malformed memory source material",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== memorySourceMaterialRowKeys.length ||
    !keys.every((key, index) => key === memorySourceMaterialRowKeys[index])
  ) {
    throw new MemoryBankAuthorityIntegrityError(
      "PostgreSQL returned unexpected memory source fields",
    );
  }
  if (
    typeof record.source_revision_id !== "string" ||
    !uuidPattern.test(record.source_revision_id) ||
    typeof record.classification !== "string" ||
    !dataClassifications.includes(
      record.classification as DataClassification,
    ) ||
    typeof record.source_uri !== "string" ||
    record.source_uri.length === 0 ||
    typeof record.revision_hash !== "string" ||
    !revisionHashPattern.test(record.revision_hash) ||
    typeof record.locator !== "string" ||
    record.locator.length === 0 ||
    typeof record.external_bank_id !== "string" ||
    typeof record.data_classification_ceiling !== "string" ||
    !dataClassifications.includes(
      record.data_classification_ceiling as DataClassification,
    )
  ) {
    throw new MemoryBankAuthorityIntegrityError(
      "PostgreSQL returned invalid memory source values",
    );
  }
  return record as unknown as MemorySourceMaterialRow;
}

function classificationAllows(
  ceiling: DataClassification,
  classification: DataClassification,
): boolean {
  switch (ceiling) {
    case "restricted":
      return true;
    case "confidential":
      return ["public", "internal", "confidential", "synthetic"].includes(
        classification,
      );
    case "internal":
      return ["public", "internal", "synthetic"].includes(classification);
    case "public":
      return classification === "public" || classification === "synthetic";
    case "synthetic":
      return classification === "synthetic";
  }
}
