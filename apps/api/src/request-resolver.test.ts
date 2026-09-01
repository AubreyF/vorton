import { describe, expect, it, vi } from "vitest";
import type { Database, SqlExecutor } from "@vorton/database";

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
  authUserId: "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5", // gitleaks:allow
};

class FakeDatabase {
  results: Array<Array<Record<string, unknown>>> = [];
  statements: string[] = [];
  parameters: unknown[][] = [];
  asAdministrator<T>(
    work: (transaction: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row>(text: string, values: unknown[] = []) => {
        this.statements.push(text);
        this.parameters.push(values);
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

function proposalRows(): Array<Array<Record<string, unknown>>> {
  return [
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
          workspace_default_module_id: "command",
          core_surface_selection_receipt_id:
            "11111111-1111-4111-8111-111111111111",
          core_surface_selection_receipt_hash: `sha256:${"1".repeat(64)}`,
          workspace_realm: "organizational",
          person_kind: "owner",
        },
      ],
      [
        {
          installation_id: input.installationId,
          workspace_id: input.workspaceId,
          module_id: "command",
          contract_version: "v1",
          label: "Command Bridge",
          navigation_order: 10,
          presentation_variant: "standard",
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
              moduleSurface: {
                defaultModuleId: "command",
                modules: [
                  {
                    id: "command",
                    contractVersion: "v1",
                    label: "Command Bridge",
                    navigationOrder: 10,
                    presentationVariant: "standard",
                  },
                ],
              },
              coreSurfaceSelectionReceipt: {
                receiptId: "11111111-1111-4111-8111-111111111111",
                receiptSha256: `sha256:${"1".repeat(64)}`,
              },
              coreSurfaceState: "selected",
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
    expect(database.statements[1]).toContain(
      "from public.workspace_module_activations activation",
    );
    expect(database.statements[2]).toContain("from public.work work");
    expect(database.statements[3]).toContain("executive.propose");
    expect(database.statements[3]).toContain(
      "policy.definition ->> 'protocol' is distinct from $4",
    );
  });

  it("projects an empty workspace surface without inheriting installation modules", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          installation_id: input.installationId,
          installation_slug: "vorton",
          installation_display_name: "Vorton",
          workspace_id: input.workspaceId,
          workspace_slug: "aubos",
          workspace_display_name: "AubOS",
          workspace_default_module_id: null,
          core_surface_selection_receipt_id: null,
          core_surface_selection_receipt_hash: null,
          workspace_realm: "personal",
          person_kind: "owner",
        },
      ],
      [],
      [],
      [],
      [],
    ];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
    );

    await expect(
      resolver.resolveBootstrap("0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5"),
    ).resolves.toMatchObject({
      installations: [
        {
          displayName: "Vorton",
          workspaces: [
            {
              displayName: "AubOS",
              realm: "personal",
              moduleSurface: { defaultModuleId: null, modules: [] },
              coreSurfaceSelectionReceipt: null,
              coreSurfaceState: "unconfigured",
              workItems: [],
              proposalBindings: [],
            },
          ],
        },
      ],
    });
  });

  it("fails closed when stored core-surface presentation drifts from the compiled registry", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          installation_id: input.installationId,
          installation_slug: "vorton",
          installation_display_name: "Vorton",
          workspace_id: input.workspaceId,
          workspace_slug: "freedos",
          workspace_display_name: "FreedOS",
          workspace_default_module_id: "factory",
          core_surface_selection_receipt_id:
            "11111111-1111-4111-8111-111111111111",
          core_surface_selection_receipt_hash: `sha256:${"1".repeat(64)}`,
          workspace_realm: "organizational",
          person_kind: "owner",
        },
      ],
      [
        {
          installation_id: input.installationId,
          workspace_id: input.workspaceId,
          module_id: "factory",
          contract_version: "v1",
          label: "Caller Factory",
          navigation_order: 10,
          presentation_variant: "read-only",
        },
      ],
      [],
      [],
      [],
    ];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
    );

    await expect(
      resolver.resolveBootstrap("0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5"),
    ).resolves.toMatchObject({
      installations: [
        {
          workspaces: [
            {
              coreSurfaceState: "invalid",
              moduleSurface: { defaultModuleId: null, modules: [] },
              coreSurfaceSelectionReceipt: null,
            },
          ],
        },
      ],
    });
  });

  it("marks legacy nonempty unlineaged surfaces as upgrade-required", async () => {
    const database = new FakeDatabase();
    database.results = [
      [
        {
          installation_id: input.installationId,
          installation_slug: "vorton",
          installation_display_name: "Vorton",
          workspace_id: input.workspaceId,
          workspace_slug: "freedos",
          workspace_display_name: "FreedOS",
          workspace_default_module_id: "factory",
          core_surface_selection_receipt_id: null,
          core_surface_selection_receipt_hash: null,
          workspace_realm: "organizational",
          person_kind: "owner",
        },
      ],
      [
        {
          installation_id: input.installationId,
          workspace_id: input.workspaceId,
          module_id: "factory",
          contract_version: "v1",
          label: "Factory",
          navigation_order: 10,
          presentation_variant: "freed-read-only",
        },
      ],
      [],
      [],
      [],
    ];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
    );

    await expect(
      resolver.resolveBootstrap("0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5"),
    ).resolves.toMatchObject({
      installations: [
        {
          workspaces: [
            {
              coreSurfaceState: "upgrade-required",
              moduleSurface: { defaultModuleId: null, modules: [] },
              coreSurfaceSelectionReceipt: null,
            },
          ],
        },
      ],
    });
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
    database.results = [proposalRows()[0]!, []];
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
    );
    await expect(resolver.resolveProposal(input, requester)).rejects.toThrow(
      "evidence records are missing",
    );
  });

  it("returns no derived context and cannot reach memory or Hindsight", async () => {
    const database = new FakeDatabase();
    database.results = proposalRows();
    const retrieve = vi.fn(() => {
      throw new Error("Hindsight must remain unreachable");
    });
    const memory = { retrieve };
    expect(DatabaseExecutiveRequestResolver.length).toBe(3);
    const resolver = Reflect.construct(DatabaseExecutiveRequestResolver, [
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
      memory,
    ]);

    await expect(
      resolver.resolveProposal(input, requester),
    ).resolves.toMatchObject({
      role: { skillMarkdown: "Database-owned role", version: 2 },
      evidence: [
        { summary: "Database-owned evidence", classification: "synthetic" },
      ],
      derivedContext: [],
    });
    expect(database.statements).toHaveLength(2);
    expect(database.statements.join("\n").toLowerCase()).not.toMatch(
      /memory_banks|transcript_revisions|memory_candidates|source_citations/,
    );
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects a requester context from another workspace", async () => {
    const database = new FakeDatabase();
    const resolver = new DatabaseExecutiveRequestResolver(
      database as unknown as Database,
      "openai-responses",
      "explicit-model",
    );
    await expect(
      resolver.resolveProposal(input, {
        ...requester,
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).rejects.toThrow("cannot cross workspaces");
    expect(database.statements).toHaveLength(0);
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

  it("rejects uppercase UUIDs at the HTTP contract", () => {
    for (const key of [
      "installationId",
      "workspaceId",
      "workId",
      "workerId",
      "roleId",
    ] as const) {
      expect(() =>
        parseProposalInput({ ...input, [key]: input[key].toUpperCase() }),
      ).toThrow(`${key} must be a lowercase canonical UUID`);
    }
    expect(() =>
      parseProposalInput({
        ...input,
        evidenceRecordIds: [input.evidenceRecordIds[0]!.toUpperCase()],
      }),
    ).toThrow("evidenceRecordIds must contain lowercase canonical UUIDs");
  });
});
