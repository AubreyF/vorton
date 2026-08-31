import { describe, expect, it } from "vitest";

import type { Database, SqlExecutor } from "@vorton/database";

import type {
  MemoryAuthoritySubject,
  MemoryBankAuthorityRequest,
} from "./index.js";
import {
  DatabaseMemoryBankAuthorityResolver,
  MemoryBankAuthorityDeniedError,
  MemoryBankAuthorityIntegrityError,
} from "./database-authority.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const credentialId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const authUserId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const personId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const workId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const capabilityGrantId = "12345678-1234-4234-8234-123456789abc";
const bankId = `personal:${installationId}:${workspaceId}:lineage-v2`;

const personRequest: MemoryBankAuthorityRequest = {
  operation: "retrieve",
  installationId,
  workspaceId,
  installationRealm: "personal",
  workId,
};
const personSubject: MemoryAuthoritySubject = { kind: "person", authUserId };

function authorityRow(
  overrides: Partial<{
    external_bank_id: string;
    installation_realm: "personal" | "organizational";
    principal_kind: "person" | "worker";
    principal_id: string;
    context_subject_id: string;
    capability_grant_id: string;
    capability: string;
    capability_mode: "observe" | "modify";
    data_classification_ceiling:
      "public" | "internal" | "confidential" | "restricted" | "synthetic";
  }> = {},
) {
  return {
    external_bank_id: bankId,
    installation_realm: "personal" as const,
    principal_kind: "person" as const,
    principal_id: personId,
    context_subject_id: authUserId,
    capability_grant_id: capabilityGrantId,
    capability: "memory.retrieve",
    capability_mode: "observe" as const,
    data_classification_ceiling: "restricted" as const,
    ...overrides,
  };
}

function sourceMaterialRow(
  overrides: Partial<{
    source_revision_id: string;
    classification:
      "public" | "internal" | "confidential" | "restricted" | "synthetic";
    source_uri: string;
    revision_hash: string;
    locator: string;
    external_bank_id: string;
    data_classification_ceiling:
      "public" | "internal" | "confidential" | "restricted" | "synthetic";
  }> = {},
) {
  return {
    source_revision_id: "11111111-1111-4111-a111-111111111111",
    classification: "restricted" as const,
    source_uri: "urn:vorton:synthetic:source",
    revision_hash: "a".repeat(64),
    locator: "fixture:1",
    external_bank_id: bankId,
    data_classification_ceiling: "restricted" as const,
    ...overrides,
  };
}

function fixture(
  rows: Array<Record<string, unknown>> = [authorityRow()],
  rowCount = rows.length,
  subject: MemoryAuthoritySubject = personSubject,
) {
  const contexts: Array<{ kind: string; value: unknown }> = [];
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const transaction = {
    query: async (text: string, values?: readonly unknown[]) => {
      queries.push({ text, values });
      return { rows, rowCount };
    },
  } as unknown as SqlExecutor;
  const database = {
    asPerson: async (context: unknown, work: (sql: SqlExecutor) => unknown) => {
      contexts.push({ kind: "person", value: context });
      return work(transaction);
    },
    asWorker: async (context: unknown, work: (sql: SqlExecutor) => unknown) => {
      contexts.push({ kind: "worker", value: context });
      return work(transaction);
    },
  } as unknown as Database;
  return {
    contexts,
    queries,
    resolver: new DatabaseMemoryBankAuthorityResolver(database, subject),
  };
}

describe("database memory bank authority resolver", () => {
  it("resolves person authority inside the exact signed workspace context", async () => {
    const { resolver, contexts, queries } = fixture();

    await expect(resolver.resolve(personRequest)).resolves.toEqual({
      bank: {
        id: bankId,
        installationId,
        workspaceId,
        realm: "personal",
      },
      principalKind: "person",
      principalId: personId,
      contextSubjectId: authUserId,
      capabilityGrantId,
      capability: "memory.retrieve",
      capabilityMode: "observe",
      dataClassificationCeiling: "restricted",
    });
    expect(contexts).toEqual([
      {
        kind: "person",
        value: { authUserId, installationId, workspaceId },
      },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain(
      "public.resolve_context_gateway_memory_bank",
    );
    expect(queries[0]?.values).toEqual([
      installationId,
      workspaceId,
      "retrieve",
      workId,
    ]);
  });

  it("binds worker authority to the exact credential and operation", async () => {
    const request: MemoryBankAuthorityRequest = {
      ...personRequest,
      operation: "invalidate",
      workId: null,
    };
    const { resolver, contexts } = fixture(
      [
        authorityRow({
          principal_kind: "worker",
          principal_id: workerId,
          context_subject_id: workerId,
          capability: "memory.invalidate",
          capability_mode: "modify",
          data_classification_ceiling: "internal",
        }),
      ],
      1,
      { kind: "worker", workerId, credentialId },
    );

    await expect(resolver.resolve(request)).resolves.toMatchObject({
      bank: { id: bankId },
      principalKind: "worker",
      principalId: workerId,
      contextSubjectId: workerId,
      capabilityGrantId,
      capability: "memory.invalidate",
      capabilityMode: "modify",
      dataClassificationCeiling: "internal",
    });
    expect(contexts).toEqual([
      {
        kind: "worker",
        value: { workerId, credentialId, installationId, workspaceId },
      },
    ]);
  });

  it("rejects an empty worker credential before opening a transaction", async () => {
    const { resolver, contexts, queries } = fixture([authorityRow()], 1, {
      kind: "worker",
      workerId,
      credentialId: "",
    });
    await expect(resolver.resolve(personRequest)).rejects.toBeInstanceOf(
      MemoryBankAuthorityDeniedError,
    );
    expect(contexts).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("fails closed when PostgreSQL denies or omits authority", async () => {
    const denied = Object.assign(new Error("denied"), { code: "P0001" });
    const database = {
      asPerson: async () => {
        throw denied;
      },
    } as unknown as Database;
    await expect(
      new DatabaseMemoryBankAuthorityResolver(database, personSubject).resolve(
        personRequest,
      ),
    ).rejects.toBeInstanceOf(MemoryBankAuthorityDeniedError);
    await expect(
      fixture([], 0).resolver.resolve(personRequest),
    ).rejects.toBeInstanceOf(MemoryBankAuthorityDeniedError);
  });

  it("rejects ambiguous or substituted authority rows", async () => {
    const invalidRows = [
      [authorityRow(), authorityRow()],
      [
        authorityRow({
          external_bank_id: `personal:${installationId}:${workerId}:lineage-v2`,
        }),
      ],
      [authorityRow({ installation_realm: "organizational" })],
      [authorityRow({ principal_kind: "worker", principal_id: workerId })],
      [authorityRow({ context_subject_id: workerId })],
      [authorityRow({ capability: "memory.retain" })],
      [authorityRow({ capability_mode: "modify" })],
      [authorityRow({ data_classification_ceiling: "unknown" as never })],
      [{ ...authorityRow(), extra_field: "substitution" }],
      [authorityRow({ principal_id: "NOT-A-UUID" })],
      [authorityRow({ capability_grant_id: "NOT-A-UUID" })],
    ];
    for (const rows of invalidRows) {
      await expect(
        fixture(rows).resolver.resolve(personRequest),
      ).rejects.toBeInstanceOf(MemoryBankAuthorityIntegrityError);
    }
  });

  it("rejects a substituted worker identity", async () => {
    const { resolver } = fixture(
      [
        authorityRow({
          principal_kind: "worker",
          principal_id: personId,
          context_subject_id: workerId,
          capability: "memory.retain",
          capability_mode: "modify",
        }),
      ],
      1,
      { kind: "worker", workerId, credentialId },
    );
    await expect(
      resolver.resolve({
        ...personRequest,
        operation: "retain",
      }),
    ).rejects.toBeInstanceOf(MemoryBankAuthorityIntegrityError);
  });

  it("resolves source material only through the capability-gated projection", async () => {
    const row = sourceMaterialRow();
    const { resolver, queries } = fixture([row]);

    await expect(
      resolver.resolveSourceMaterial({
        ...personRequest,
        sourceRevisionIds: [row.source_revision_id],
      }),
    ).resolves.toEqual([
      {
        sourceRevisionId: row.source_revision_id,
        classification: "restricted",
        revisionHash: row.revision_hash,
        citations: [
          {
            sourceRevisionId: row.source_revision_id,
            sourceUri: row.source_uri,
            revisionHash: row.revision_hash,
            locator: row.locator,
          },
        ],
        dataClassificationCeiling: "restricted",
      },
    ]);
    expect(queries[0]?.text).toContain(
      "public.resolve_context_gateway_source_material",
    );
    expect(queries[0]?.values).toEqual([
      installationId,
      workspaceId,
      "personal",
      workId,
      [row.source_revision_id],
    ]);
  });

  it("preserves every canonical citation while grouping source revisions", async () => {
    const first = sourceMaterialRow({ locator: "fixture:1" });
    const second = sourceMaterialRow({
      source_uri: "urn:vorton:synthetic:second-source",
      locator: "fixture:2",
    });
    await expect(
      fixture([first, second]).resolver.resolveSourceMaterial({
        ...personRequest,
        sourceRevisionIds: [first.source_revision_id],
      }),
    ).resolves.toEqual([
      {
        sourceRevisionId: first.source_revision_id,
        classification: "restricted",
        revisionHash: first.revision_hash,
        citations: [
          {
            sourceRevisionId: first.source_revision_id,
            sourceUri: first.source_uri,
            revisionHash: first.revision_hash,
            locator: "fixture:1",
          },
          {
            sourceRevisionId: first.source_revision_id,
            sourceUri: second.source_uri,
            revisionHash: first.revision_hash,
            locator: "fixture:2",
          },
        ],
        dataClassificationCeiling: "restricted",
      },
    ]);
  });

  it("rejects malformed, substituted, or above-ceiling source material", async () => {
    const invalidRows = [
      [sourceMaterialRow({ external_bank_id: "substituted-bank" })],
      [sourceMaterialRow({ source_revision_id: "NOT-A-UUID" })],
      [sourceMaterialRow({ revision_hash: "not-a-hash" })],
      [
        sourceMaterialRow({
          classification: "restricted",
          data_classification_ceiling: "public",
        }),
      ],
      [{ ...sourceMaterialRow(), extra_field: "substitution" }],
    ];
    for (const rows of invalidRows) {
      await expect(
        fixture(rows).resolver.resolveSourceMaterial({
          ...personRequest,
          sourceRevisionIds: ["11111111-1111-4111-a111-111111111111"],
        }),
      ).rejects.toBeInstanceOf(MemoryBankAuthorityIntegrityError);
    }
  });

  it("rejects incomplete source provenance instead of accepting a subset", async () => {
    const requested = [
      "11111111-1111-4111-a111-111111111111",
      "22222222-2222-4222-a222-222222222222",
    ];
    await expect(
      fixture([sourceMaterialRow()]).resolver.resolveSourceMaterial({
        ...personRequest,
        sourceRevisionIds: requested,
      }),
    ).rejects.toBeInstanceOf(MemoryBankAuthorityIntegrityError);
  });

  it("rejects unbounded, duplicate, or invalid source revision requests", async () => {
    const { resolver, queries } = fixture([sourceMaterialRow()]);
    for (const sourceRevisionIds of [
      [],
      [
        "11111111-1111-4111-a111-111111111111",
        "11111111-1111-4111-a111-111111111111",
      ],
      ["NOT-A-UUID"],
    ]) {
      await expect(
        resolver.resolveSourceMaterial({
          ...personRequest,
          sourceRevisionIds,
        }),
      ).rejects.toBeInstanceOf(MemoryBankAuthorityIntegrityError);
    }
    await expect(
      resolver.resolveSourceMaterial({
        ...personRequest,
        operation: "retain",
        sourceRevisionIds: ["11111111-1111-4111-a111-111111111111"],
      }),
    ).rejects.toBeInstanceOf(MemoryBankAuthorityIntegrityError);
    expect(queries).toEqual([]);
  });
});
