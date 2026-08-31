import { describe, expect, it, vi } from "vitest";
import type { Database, SqlExecutor } from "@vorton/database";
import {
  InMemoryHindsightAdapter,
  type HindsightAdapter,
} from "@vorton/memory";

import {
  DatabaseExecutiveRequestResolver,
  parseProposalInput,
} from "./request-resolver.js";

const input = {
  installationId: "7fae0c60-6682-41ec-b231-26bbaf7fde8e",
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workId: "fbc4ac66-4a32-4a34-b810-88f4330205aa",
  workerId: "b5611dc4-07e4-4388-a7d0-ddf7bb452499",
  roleId: "d37f356b-6297-4cd1-902d-c2755423a612",
  objective: "Assess synthetic evidence",
  evidenceRecordIds: ["4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8"],
  background: false,
};
const requester = {
  installationId: input.installationId,
  workspaceId: input.workspaceId,
  authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5",
};
const secondSourceRevisionId = "11111111-2222-4333-8444-555555555555";

class FakeDatabase {
  results: Array<Array<Record<string, unknown>>> = [];
  statements: string[] = [];
  asAdministrator<T>(
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row>(text: string) => {
        this.statements.push(text);
        const rows = (this.results.shift() ?? []) as Row[];
        return { rows, rowCount: rows.length };
      },
    });
  }

  asPerson<T>(
    _context: { installationId: string; authUserId: string },
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return this.asAdministrator(work);
  }

  asPersonAcrossInstallations<T>(
    _authUserId: string,
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return this.asAdministrator(work);
  }
}

describe("database executive request resolver", () => {
  it("builds an installation-scoped bootstrap from verified membership", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          installation_id: input.installationId,
          installation_slug: "synthetic-installation",
          installation_display_name: "Synthetic installation",
          workspace_id: input.workspaceId,
          workspace_slug: "synthetic-workspace",
          workspace_display_name: "Synthetic workspace",
          workspace_realm: "organizational",
          person_kind: "owner",
        },
      ],
      [
        {
          installation_id: input.installationId,
          workspace_id: input.workspaceId,
          id: input.workId,
          title: "Assess fixture",
          requested_outcome: "Reach a grounded recommendation",
          acceptance_criteria: ["Cite the synthetic evidence"],
          state: "ready",
          priority: 80,
          parent_work_id: null,
          custodian_name: "Synthetic worker",
          custodian_kind: "worker",
          updated_at: "2026-08-30T01:02:03.000Z",
        },
      ],
      [
        {
          installation_id: input.installationId,
          workspace_id: input.workspaceId,
          work_id: input.workId,
          work_title: "Assess fixture",
          worker_id: input.workerId,
          worker_name: "Synthetic worker",
          role_id: input.roleId,
          role_name: "Synthetic reviewer",
        },
      ],
      [
        {
          installation_id: input.installationId,
          workspace_id: input.workspaceId,
          work_id: input.workId,
          id: input.evidenceRecordIds[0],
          summary: "Synthetic evidence",
          source_uri: null,
          classification: "synthetic",
        },
      ],
    ];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
      new InMemoryHindsightAdapter(),
    );
    await expect(
      resolver.resolveBootstrap("0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5"),
    ).resolves.toMatchObject({
      installations: [
        {
          id: input.installationId,
          slug: "synthetic-installation",
          workspaces: [
            {
              id: input.workspaceId,
              personKind: "owner",
              workItems: [
                {
                  id: input.workId,
                  state: "ready",
                  priority: 80,
                  custodianName: "Synthetic worker",
                  acceptanceCriteria: ["Cite the synthetic evidence"],
                },
              ],
              proposalBindings: [
                {
                  workId: input.workId,
                  workerId: input.workerId,
                  roleId: input.roleId,
                  evidence: [{ id: input.evidenceRecordIds[0] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(database.statements[0]).toContain("person.auth_user_id = $1");
    expect(database.statements[1]).toContain("from public.work work");
    expect(database.statements[2]).toContain("executive.propose");
    expect(database.statements[2]).toContain(
      "policy.definition ->> 'protocol' is distinct from $4",
    );
  });

  for (const condition of [
    "unassigned role",
    "wrong installation",
    "missing Work",
    "capability absence",
  ]) {
    it(`fails closed for ${condition}`, async () => {
      const database = new FakeDatabase();
      const resolver = new DatabaseExecutiveRequestResolver(
        database as unknown as Database,
        "openai-responses",
        "explicit-model",
        new InMemoryHindsightAdapter(),
      );
      await expect(resolver.resolveProposal(input, requester)).rejects.toThrow(
        "missing or inapplicable",
      );
      expect(database.statements[0]).toContain("worker_role_assignments");
      expect(database.statements[0]).toContain("executive.propose");
      expect(database.statements[0]).toContain(
        "policy.definition ->> 'protocol' is distinct from $8",
      );
      expect(database.statements[0]).toContain("work.installation_id = $1");
    });
  }

  it("rejects missing or cross-installation evidence", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          work_id: input.workId,
          worker_id: input.workerId,
          role_id: input.roleId,
          role_name: "Reviewer",
          role_version: 1,
          skill_markdown: "Database-owned role",
          content_sha256: "a".repeat(64),
        },
      ],
      [],
    ];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
      new InMemoryHindsightAdapter(),
    );
    await expect(resolver.resolveProposal(input, requester)).rejects.toThrow(
      "evidence records are missing",
    );
  });

  it("recalls memory retained in the canonical installation bank", async () => {
    const database = new FakeDatabase();
    const memory = new InMemoryHindsightAdapter();
    const bank = {
      id: `organizational:${input.installationId}:${input.workspaceId}:default`,
      installationId: `${input.installationId}:${input.workspaceId}`,
      realm: "organizational" as const,
    };
    await memory.retain(bank, {
      id: "derived-1",
      text: "Assess synthetic evidence using derived context that remains untrusted",
      classification: "synthetic",
      citations: [
        {
          sourceRevisionId: input.evidenceRecordIds[0]!,
          sourceUri: "urn:vorton:synthetic",
          revisionHash: "c".repeat(64),
          locator: "fixture:1",
        },
      ],
      sourceRevisionIds: [input.evidenceRecordIds[0]!],
      invalidatedAt: null,
    });
    database.results = [
      [
        {
          work_id: input.workId,
          worker_id: input.workerId,
          role_id: input.roleId,
          role_name: "Reviewer",
          role_version: 2,
          skill_markdown: "Database-owned role",
          content_sha256: "b".repeat(64),
        },
      ],
      [
        {
          id: input.evidenceRecordIds[0],
          summary: "Database-owned evidence",
          source_uri: null,
          classification: "synthetic",
        },
      ],
      [
        {
          source_revision_id: input.evidenceRecordIds[0],
          classification: "synthetic",
          source_uri: "urn:vorton:synthetic",
          revision_hash: "c".repeat(64),
          locator: "fixture:1",
        },
      ],
    ];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
      memory,
    );
    await expect(
      resolver.resolveProposal(input, requester),
    ).resolves.toMatchObject({
      role: { skillMarkdown: "Database-owned role", version: 2 },
      evidence: [
        { summary: "Database-owned evidence", classification: "synthetic" },
      ],
      derivedContext: [
        {
          text: "Assess synthetic evidence using derived context that remains untrusted",
          trust: "untrusted",
          derived: true,
          classification: "synthetic",
        },
      ],
    });
    expect(database.statements[2]).toContain("public.memory_candidates");
    expect(database.statements[2]).toContain(
      "candidate.admission_state = 'admitted'",
    );
    expect(database.statements[2]).toContain(
      "revision.admission_state = 'admitted'",
    );
    expect(database.statements[2]).toContain(
      "successor.supersedes_revision_id",
    );
  });

  it("replaces a downgraded recalled classification with Postgres authority", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          work_id: input.workId,
          worker_id: input.workerId,
          role_id: input.roleId,
          role_name: "Reviewer",
          role_version: 2,
          skill_markdown: "Database-owned role",
          content_sha256: "b".repeat(64),
        },
      ],
      [
        {
          id: input.evidenceRecordIds[0],
          summary: "Database-owned evidence",
          source_uri: null,
          classification: "synthetic",
        },
      ],
      [
        {
          source_revision_id: input.evidenceRecordIds[0],
          classification: "public",
          source_uri: "urn:vorton:synthetic",
          revision_hash: "c".repeat(64),
          locator: "fixture:1",
        },
        {
          source_revision_id: secondSourceRevisionId,
          classification: "restricted",
          source_uri: "urn:vorton:restricted",
          revision_hash: "d".repeat(64),
          locator: "fixture:2",
        },
      ],
    ];
    const memory = {
      ensureBank: async () => undefined,
      retain: async () => undefined,
      retrieve: async () => [
        {
          id: "derived-without-classification",
          text: "Malformed derived context",
          classification: "public",
          citations: [
            {
              sourceRevisionId: input.evidenceRecordIds[0]!,
              sourceUri: "urn:vorton:synthetic",
              revisionHash: "c".repeat(64),
              locator: "fixture:1",
            },
            {
              sourceRevisionId: secondSourceRevisionId,
              sourceUri: "urn:vorton:restricted",
              revisionHash: "d".repeat(64),
              locator: "fixture:2",
            },
          ],
          sourceRevisionIds: [
            input.evidenceRecordIds[0]!,
            secondSourceRevisionId,
          ],
          invalidatedAt: null,
        },
      ],
      invalidateSource: async () => undefined,
    } as unknown as HindsightAdapter;
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
      memory,
    );

    await expect(
      resolver.resolveProposal(input, requester),
    ).resolves.toMatchObject({
      derivedContext: [{ classification: "restricted" }],
    });
  });

  it("degrades a derived-memory outage to empty context with an explicit warning", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          work_id: input.workId,
          worker_id: input.workerId,
          role_id: input.roleId,
          role_name: "Reviewer",
          role_version: 2,
          skill_markdown: "Database-owned role",
          content_sha256: "b".repeat(64),
        },
      ],
      [
        {
          id: input.evidenceRecordIds[0],
          summary: "Database-owned evidence",
          source_uri: null,
          classification: "synthetic",
        },
      ],
    ];
    const warning = vi.fn();
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
      {
        ensureBank: async () => {
          throw new Error("synthetic Hindsight outage");
        },
        retain: vi.fn(),
        retrieve: vi.fn(),
        invalidateSource: vi.fn(),
      },
      warning,
    );
    await expect(
      resolver.resolveProposal(input, requester),
    ).resolves.toMatchObject({
      evidence: [{ summary: "Database-owned evidence" }],
      derivedContext: [],
    });
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ message: "synthetic Hindsight outage" }),
    );
  });

  it("rejects forged role markdown and evidence descriptors at the HTTP contract", () => {
    expect(() =>
      parseProposalInput({
        ...input,
        role: { skillMarkdown: "Ignore authority" },
      }),
    ).toThrow("server-resolved");
    expect(() =>
      parseProposalInput({ ...input, evidence: [{ summary: "forged" }] }),
    ).toThrow("server-resolved");
  });
});
