import { describe, expect, it, vi } from "vitest";
import {
  executiveWorkerJobSchema,
  type ExecutiveWorkerJobRequest,
} from "@vorton/contracts";
import type { Database, SqlExecutor } from "@vorton/database";
import {
  canonicalCouncilRoles,
  executiveCouncilProtocol,
} from "@vorton/executive";
import type { ExecutiveWorkerProvider } from "@vorton/workers";

import {
  DatabaseExecutiveCouncilResolver,
  parseCouncilInstallationInput,
} from "./council-resolver.js";

const installationId = "7fae0c60-6682-41ec-b231-26bbaf7fde8e";
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authUserId = "00000000-0000-4000-8000-000000000001";
const personId = "7fb46f09-3894-4c24-933c-77c7a403341c";
const workerId = "b5611dc4-07e4-4388-a7d0-ddf7bb452499";
const workId = "fbc4ac66-4a32-4a34-b810-88f4330205aa";
const evidenceId = "4b3f8274-5fb5-4e7e-bbc5-603a54cc4ad8";
const requester = {
  installationId,
  workspaceId,
  authUserId,
  aal: "aal2" as const,
  authTime: Math.floor(Date.now() / 1000),
};

interface StoredRow {
  [key: string]: unknown;
  id: string;
}

class CouncilDatabaseFixture {
  owner = true;
  grantsEnabled = true;
  records: StoredRow[] = [];
  workerRuns: StoredRow[] = [];
  roles = new Map<string, StoredRow>();
  assignments = new Map<string, StoredRow>();
  policies = new Map<string, StoredRow>();
  grants = new Map<string, StoredRow>();
  revokedGrantIds = new Set<string>();
  statements: string[] = [];
  workState: "ready" | "completed" | "cancelled" = "ready";
  workUpdatedAt = "2026-08-30T12:00:00.000Z";
  workInputSha256 = "c".repeat(64);
  readonly worker = {
    id: workerId,
    name: "Executive Recommendation Worker",
    provider: "deterministic-council",
    model: "synthetic-council-v1",
  };

  readonly executor: SqlExecutor = {
    query: async <Row>(text: string, values: readonly unknown[] = []) => {
      this.statements.push(text);
      const normalized = text.replace(/\s+/g, " ").trim();
      let rows: unknown[] = [];
      if (
        normalized.includes("from public.people") &&
        normalized.includes("auth_user_id")
      ) {
        const requestedInstallation = values[0];
        const requestedWorkspace = values[1];
        const requestedAuth = values[2];
        const ownerRequired = values[3];
        rows =
          requestedInstallation === installationId &&
          requestedWorkspace === workspaceId &&
          requestedAuth === authUserId &&
          (!ownerRequired || this.owner)
            ? [{ id: personId, kind: this.owner ? "owner" : "member" }]
            : [];
      } else if (
        normalized.includes("from public.work") &&
        normalized.includes("requested_outcome")
      ) {
        rows =
          values[0] === installationId &&
          values[1] === workspaceId &&
          values[2] === workId
            ? [
                {
                  id: workId,
                  title: "Set the synthetic operating priority",
                  requested_outcome: "Produce a bounded council synthesis",
                  acceptance_criteria: ["Preserve dissent"],
                  state: this.workState,
                  updated_at: this.workUpdatedAt,
                  input_sha256: this.workInputSha256,
                },
              ]
            : [];
      } else if (
        normalized.startsWith(
          "select id, name, provider, model from public.workers",
        )
      ) {
        rows =
          values[0] === installationId &&
          values[1] === workspaceId &&
          values[2] === this.worker.provider &&
          values[3] === this.worker.model
            ? [this.worker]
            : [];
      } else if (
        normalized.includes("from public.roles role") &&
        normalized.includes("worker_role_assignments assignment")
      ) {
        const names = values[2] as string[];
        rows = names.flatMap((name) => {
          const role = [...this.roles.values()].find(
            (candidate) => candidate.name === name,
          );
          if (!role) return [];
          const assignment = [...this.assignments.values()].find(
            (candidate) => candidate.role_id === role.id,
          );
          return assignment
            ? [
                {
                  id: role.id,
                  worker_id: assignment.worker_id,
                  name: role.name,
                  version: role.version,
                  skill_markdown: role.skill_markdown,
                  content_sha256: role.content_sha256,
                },
              ]
            : [];
        });
      } else if (normalized.startsWith("select grant_row.capability")) {
        rows = this.grantsEnabled
          ? [...this.grants.values()]
              .filter(
                (grant) =>
                  grant.installation_id === values[0] &&
                  grant.workspace_id === values[1] &&
                  grant.work_id === values[2] &&
                  grant.worker_id === values[3] &&
                  !this.revokedGrantIds.has(grant.id),
              )
              .map((grant) => ({ capability: grant.capability }))
          : [];
      } else if (
        normalized.includes("from public.records") &&
        normalized.includes("councilProtocol")
      ) {
        rows = this.records.filter(
          (record) =>
            record.installation_id === values[0] &&
            record.workspace_id === values[1] &&
            record.work_id === values[2] &&
            (record.payload as Record<string, unknown>).councilProtocol ===
              values[3],
        );
      } else if (
        normalized.includes("from public.records") &&
        normalized.includes("kind = 'evidence'")
      ) {
        const requestedIds = normalized.includes("id = any($3::uuid[])")
          ? (values[2] as string[] | undefined)
          : undefined;
        rows =
          values[0] === installationId &&
          values[1] === workspaceId &&
          (!requestedIds || requestedIds.includes(evidenceId))
            ? [
                {
                  id: evidenceId,
                  summary:
                    "Installation evidence shared with every council role",
                  source_uri: null,
                  classification: "synthetic",
                },
              ]
            : [];
      } else if (normalized.startsWith("insert into public.roles")) {
        const row = {
          id: values[0] as string,
          installation_id: values[1],
          workspace_id: values[2],
          name: values[3],
          version: values[4],
          skill_markdown: values[5],
          content_sha256: values[6],
          created_by_person_id: values[7],
        };
        if (![...this.roles.values()].some((item) => item.name === row.name)) {
          this.roles.set(row.id, row);
        }
      } else if (
        normalized.startsWith("insert into public.worker_role_assignments")
      ) {
        const row = {
          id: values[0] as string,
          installation_id: values[1],
          workspace_id: values[2],
          worker_id: values[3],
          role_id: values[4],
          assigned_by_person_id: values[5],
        };
        if (!this.assignments.has(row.id)) this.assignments.set(row.id, row);
      } else if (normalized.startsWith("insert into public.policies")) {
        const row = {
          id: values[0] as string,
          installation_id: values[1],
          workspace_id: values[2],
          name: "Executive council recommendation only",
          version: 1,
          definition: JSON.parse(values[3] as string),
          content_sha256: values[4],
          created_by_person_id: values[5],
        };
        if (!this.policies.has(row.id)) this.policies.set(row.id, row);
      } else if (
        normalized.startsWith("insert into public.capability_grants")
      ) {
        const row = {
          id: values[0] as string,
          installation_id: values[1],
          workspace_id: values[2],
          policy_id: values[3],
          principal_kind: "worker",
          person_id: null,
          worker_id: values[4],
          capability: values[5],
          mode: "recommend",
          work_id: values[6],
          expires_at: null,
          granted_by_person_id: values[7],
        };
        if (!this.grants.has(row.id)) this.grants.set(row.id, row);
      } else if (normalized.startsWith("select to_jsonb(selected)")) {
        const table = normalized.match(/from public\.([a-z_]+) where/)?.[1];
        const id = values[0] as string;
        const map =
          table === "roles"
            ? this.roles
            : table === "worker_role_assignments"
              ? this.assignments
              : table === "policies"
                ? this.policies
                : table === "capability_grants"
                  ? this.grants
                  : undefined;
        const candidate = map?.get(id);
        const value =
          candidate?.installation_id === values[1] &&
          candidate?.workspace_id === values[2]
            ? candidate
            : undefined;
        rows = value ? [{ value }] : [];
      } else if (
        normalized.startsWith("select exists(") &&
        normalized.includes("capability_grant_revocations")
      ) {
        rows = [{ revoked: this.revokedGrantIds.has(values[2] as string) }];
      } else if (normalized.startsWith("insert into public.worker_runs")) {
        const metadata = JSON.parse(values[8] as string) as Record<
          string,
          unknown
        >;
        const active = this.workerRuns.find(
          (run) =>
            ["queued", "in_progress", "completed"].includes(
              String(run.status),
            ) &&
            (run.metadata as Record<string, unknown>).council_phase ===
              metadata.council_phase &&
            (run.metadata as Record<string, unknown>).council_role_id ===
              metadata.council_role_id,
        );
        if (active) {
          throw Object.assign(new Error("duplicate council attempt"), {
            code: "23505",
          });
        }
        const row = {
          id: `90000000-0000-4000-8000-${String(this.workerRuns.length + 1).padStart(12, "0")}`,
          installation_id: values[0],
          workspace_id: values[1],
          work_id: values[2],
          worker_id: values[3],
          role_id: values[4],
          provider: values[5],
          model: values[6],
          provider_job_id: values[7],
          status: "in_progress",
          store: false,
          background: false,
          metadata,
          error: null,
        };
        this.workerRuns.push(row);
        rows = [{ id: row.id }];
      } else if (
        normalized.startsWith("update public.worker_runs") &&
        normalized.includes("provider_job_id = $2")
      ) {
        const row = this.workerRuns.find((run) => run.id === values[0]);
        if (row && ["queued", "in_progress"].includes(String(row.status))) {
          row.provider_job_id = values[1];
          row.status = values[2];
          row.error = values[3];
          rows = [{ id: row.id }];
        }
      } else if (
        normalized.startsWith("update public.worker_runs") &&
        normalized.includes("error = $2")
      ) {
        const row = this.workerRuns.find((run) => run.id === values[0]);
        if (row && ["queued", "in_progress"].includes(String(row.status))) {
          row.status = "failed";
          row.error = values[1];
          rows = [{ id: row.id }];
        }
      } else if (normalized.startsWith("insert into public.records")) {
        const payload = JSON.parse(values[5] as string) as Record<
          string,
          unknown
        >;
        if (payload.workUpdatedAt !== this.workUpdatedAt) {
          throw new Error("work revision changed");
        }
        this.records.push({
          id: `80000000-0000-4000-8000-${String(this.records.length + 1).padStart(12, "0")}`,
          installation_id: values[0],
          workspace_id: values[1],
          work_id: values[2],
          kind: values[3],
          summary: values[4],
          payload,
          actor_worker_id: values[7],
        });
      }
      return { rows: rows as Row[], rowCount: rows.length };
    },
  };

  asDatabase(): Database {
    return {
      asPerson: async <T>(
        _context: { installationId: string; authUserId: string },
        operation: (transaction: SqlExecutor) => Promise<T>,
      ) => operation(this.executor),
      asWorker: async <T>(
        _context: { installationId: string; workerId: string },
        operation: (transaction: SqlExecutor) => Promise<T>,
      ) => {
        const runsBefore = structuredClone(this.workerRuns);
        const recordsBefore = structuredClone(this.records);
        try {
          return await operation(this.executor);
        } catch (error) {
          this.workerRuns.splice(0, this.workerRuns.length, ...runsBefore);
          this.records.splice(0, this.records.length, ...recordsBefore);
          throw error;
        }
      },
    } as unknown as Database;
  }
}

class CouncilProviderFixture implements ExecutiveWorkerProvider {
  readonly provider = "deterministic-council";
  readonly model = "synthetic-council-v1";
  readonly dataClassificationCeiling = "synthetic" as const;
  storesResponses = false;
  readonly requests: ExecutiveWorkerJobRequest[] = [];
  failNext = false;
  throwNext = false;
  forgeEvidenceNext = false;
  gate: Promise<void> | undefined;
  onSubmit: (() => void) | undefined;

  async submit(request: ExecutiveWorkerJobRequest) {
    this.requests.push(request);
    this.onSubmit?.();
    if (this.gate) await this.gate;
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error("synthetic provider transport failure");
    }
    if (this.failNext) {
      this.failNext = false;
      return executiveWorkerJobSchema.parse({
        jobId: `council-job-${String(this.requests.length).padStart(2, "0")}`,
        provider: this.provider,
        model: this.model,
        status: "failed",
        store: false,
        background: false,
        installationId: request.installationId,
        workspaceId: request.workspaceId,
        workId: request.workId,
        workerId: request.workerId,
        error: "Provider output failed the structured recommendation boundary",
      });
    }
    const evidenceRecordIds = this.forgeEvidenceNext
      ? ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
      : request.evidence.map((item) => item.recordId);
    this.forgeEvidenceNext = false;
    return executiveWorkerJobSchema.parse({
      jobId: `council-job-${String(this.requests.length).padStart(2, "0")}`,
      provider: this.provider,
      model: this.model,
      status: "completed",
      store: false,
      background: false,
      installationId: request.installationId,
      workspaceId: request.workspaceId,
      workId: request.workId,
      workerId: request.workerId,
      recommendation: {
        summary:
          request.council?.phase === "proposal"
            ? "Independent role recommendation"
            : "Agreement, disagreement, and required revision remain explicit.",
        evidenceRecordIds,
        alternatives: [
          {
            title: "Bounded option",
            description: "Remain advisory.",
            expectedOutcome: "A reviewable recommendation.",
            risks: ["Evidence may be incomplete."],
          },
        ],
        recommendedAction: {
          title: "Open owner review",
          description: "Preserve owner authority.",
          capability: "executive.review",
          mode: "recommend",
          externalEffect: false,
        },
        confidence: 0.7,
        uncertainties: ["No outside sources were consulted."],
      },
    });
  }

  retrieve() {
    return Promise.reject(new Error("not supported"));
  }
}

async function installedFixture() {
  const database = new CouncilDatabaseFixture();
  const provider = new CouncilProviderFixture();
  const resolver = new DatabaseExecutiveCouncilResolver(
    database.asDatabase(),
    provider,
  );
  const state = await resolver.install(workId, requester);
  return { database, provider, resolver, state };
}

describe("database executive council resolver", () => {
  it("installs five roles, one recommendation-only policy, and work-scoped grants idempotently", async () => {
    const fixture = await installedFixture();
    expect(fixture.state).toMatchObject({
      protocol: executiveCouncilProtocol,
      phase: "proposal",
      authority: "none",
      counts: { total: 0, required: 11 },
    });
    expect(fixture.database.roles).toHaveLength(5);
    expect(fixture.database.assignments).toHaveLength(5);
    expect(fixture.database.policies).toHaveLength(1);
    expect(
      [...fixture.database.grants.values()].map((grant) => grant.capability),
    ).toEqual(["executive.propose", "executive.review"]);

    await expect(fixture.resolver.install(workId, requester)).resolves.toEqual(
      fixture.state,
    );
    expect(fixture.database.roles).toHaveLength(5);
    const chiefExecutive = [...fixture.database.roles.values()].find(
      (role) => role.name === "Chief Executive Officer",
    )!;
    chiefExecutive.skill_markdown = "drifted role";
    await expect(fixture.resolver.install(workId, requester)).rejects.toThrow(
      "conflicting authoritative data",
    );
  });

  it("advances one model call at a time through exactly five proposals, five reviews, and one synthesis", async () => {
    const fixture = await installedFixture();
    let state = fixture.state;
    for (let index = 0; index < 11; index += 1) {
      state = await fixture.resolver.advance(workId, requester);
      expect(fixture.provider.requests).toHaveLength(index + 1);
    }
    expect(state).toMatchObject({
      phase: "complete",
      nextStep: null,
      authority: "none",
      counts: {
        proposals: 5,
        reviews: 5,
        syntheses: 1,
        total: 11,
        required: 11,
      },
    });
    expect(fixture.database.records).toHaveLength(11);
    expect(fixture.database.workerRuns).toHaveLength(11);
    expect(
      fixture.provider.requests
        .slice(0, 5)
        .every((request) => request.council?.peerContext.length === 0),
    ).toBe(true);
    expect(
      fixture.provider.requests
        .slice(5, 10)
        .every(
          (request) =>
            request.council?.phase === "review" &&
            request.council.peerContext.length === 4,
        ),
    ).toBe(true);
    expect(fixture.provider.requests[10]?.council).toMatchObject({
      phase: "synthesis",
      authority: "none",
    });
    expect(fixture.provider.requests[10]?.council?.peerContext).toHaveLength(
      10,
    );
    expect(
      fixture.provider.requests.every((request) =>
        request.evidence.every((item) => item.recordId === evidenceId),
      ),
    ).toBe(true);

    await expect(fixture.resolver.advance(workId, requester)).resolves.toEqual(
      state,
    );
    expect(fixture.provider.requests).toHaveLength(11);
  });

  it("fails closed for non-owner advance, installation crossing, and missing or revoked grants", async () => {
    const fixture = await installedFixture();
    fixture.database.owner = false;
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "owner authority is required",
    );
    expect(fixture.provider.requests).toHaveLength(0);
    await expect(
      fixture.resolver.get(workId, {
        installationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        workspaceId,
        authUserId,
      }),
    ).rejects.toThrow("membership is required");
    await expect(
      fixture.resolver.get(workId, {
        installationId,
        workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        authUserId,
      }),
    ).rejects.toThrow("membership is required");

    fixture.database.owner = true;
    fixture.database.grantsEnabled = false;
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "missing, expired, revoked, or out of scope",
    );
    expect(fixture.provider.requests).toHaveLength(0);
  });

  it("records a failed structured provider result without creating a contribution", async () => {
    const fixture = await installedFixture();
    fixture.provider.failNext = true;
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "did not return a completed recommendation",
    );
    expect(fixture.database.workerRuns).toHaveLength(1);
    expect(fixture.database.workerRuns[0]).toMatchObject({
      status: "failed",
      error: "Provider output failed the structured recommendation boundary",
    });
    expect(fixture.database.records).toHaveLength(0);

    await expect(
      fixture.resolver.advance(workId, requester),
    ).resolves.toMatchObject({
      counts: { proposals: 1, reviews: 0, syntheses: 0, total: 1 },
    });
    expect(fixture.database.workerRuns).toHaveLength(2);
    expect(fixture.database.records).toHaveLength(1);
  });

  it("reserves one durable attempt before provider I/O and suppresses a concurrent duplicate call", async () => {
    const fixture = await installedFixture();
    let release!: () => void;
    fixture.provider.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = fixture.resolver.advance(workId, requester);
    await vi.waitFor(() => expect(fixture.provider.requests).toHaveLength(1));

    const duplicate = await fixture.resolver.advance(workId, requester);
    expect(duplicate.counts.total).toBe(0);
    expect(fixture.provider.requests).toHaveLength(1);
    expect(fixture.database.workerRuns[0]).toMatchObject({
      status: "in_progress",
    });

    release();
    await expect(first).resolves.toMatchObject({ counts: { total: 1 } });
    expect(fixture.database.workerRuns[0]).toMatchObject({
      status: "completed",
      provider_job_id: "council-job-01",
    });
  });

  it("audits provider throws and forged evidence citations without creating contributions", async () => {
    const fixture = await installedFixture();
    fixture.provider.throwNext = true;
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "failed before returning a valid bounded job",
    );
    expect(fixture.database.workerRuns[0]).toMatchObject({
      status: "failed",
      error:
        "Council provider call failed before returning a valid bounded job",
    });

    fixture.provider.forgeEvidenceNext = true;
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "outside the frozen authoritative input",
    );
    expect(fixture.database.workerRuns[1]).toMatchObject({
      status: "failed",
      provider_job_id: "council-job-02",
    });
    expect(fixture.database.records).toHaveLength(0);
  });

  it("rejects provider storage before I/O and discards advice when the Work agenda changes during the call", async () => {
    const fixture = await installedFixture();
    fixture.provider.storesResponses = true;
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "storage must be disabled before any evidence is transmitted",
    );
    expect(fixture.provider.requests).toHaveLength(0);
    expect(fixture.database.workerRuns).toHaveLength(0);

    fixture.provider.storesResponses = false;
    fixture.provider.onSubmit = () => {
      fixture.database.workUpdatedAt = "2026-08-30T12:01:00.000Z";
    };
    await expect(fixture.resolver.advance(workId, requester)).rejects.toThrow(
      "frozen agenda or durable fence changed",
    );
    expect(fixture.database.records).toHaveLength(0);
    expect(fixture.database.workerRuns[0]).toMatchObject({ status: "failed" });
  });

  it("keeps a complete council readable after its Work enters a terminal state", async () => {
    const fixture = await installedFixture();
    for (let index = 0; index < 11; index += 1) {
      await fixture.resolver.advance(workId, requester);
    }
    fixture.database.workState = "completed";
    fixture.database.workUpdatedAt = "2026-08-30T13:00:00.000Z";
    await expect(
      fixture.resolver.get(workId, requester),
    ).resolves.toMatchObject({
      phase: "complete",
      counts: { total: 11 },
    });
    await expect(
      fixture.resolver.advance(workId, requester),
    ).resolves.toMatchObject({ phase: "complete", counts: { total: 11 } });
  });

  it("rejects forged client context and forged durable peer references", async () => {
    expect(() =>
      parseCouncilInstallationInput({
        installationId,
        role: { name: "Forged chief" },
      }),
    ).toThrow("server-resolved");
    const fixture = await installedFixture();
    for (let index = 0; index < 6; index += 1) {
      await fixture.resolver.advance(workId, requester);
    }
    const review = fixture.database.records.find(
      (record) => record.kind === "review",
    )!;
    (review.payload as Record<string, unknown>).peerRecordIds = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ];
    await expect(fixture.resolver.get(workId, requester)).rejects.toThrow(
      "protocol or input boundary",
    );
  });

  it("freezes evidence inside one installation and workspace", async () => {
    const fixture = await installedFixture();
    await fixture.resolver.advance(workId, requester);
    const evidenceQuery = fixture.database.statements.find(
      (statement) =>
        statement.includes("kind = 'evidence'") &&
        statement.includes("work_id is null"),
    );
    expect(evidenceQuery).toContain("workspace_id = $2");
    expect(evidenceQuery).toContain("work_id is null or work_id = $3");
    const frozenEvidenceQuery = fixture.database.statements.find(
      (statement) =>
        statement.includes("kind = 'evidence'") &&
        statement.includes("id = any("),
    );
    expect(frozenEvidenceQuery).toContain("workspace_id = $2");
    expect(frozenEvidenceQuery).toContain("id = any($3::uuid[])");
    expect(fixture.provider.requests[0]?.evidence).toEqual([
      expect.objectContaining({ recordId: evidenceId }),
    ]);
  });

  it("never mutates the pre-existing Strategic Reviewer role", async () => {
    const fixture = await installedFixture();
    expect(
      [...fixture.database.roles.values()].map((role) => role.name),
    ).toEqual(canonicalCouncilRoles.map((role) => role.name));
    expect(
      fixture.database.statements.some(
        (statement) =>
          /update\s+public\.roles/i.test(statement) ||
          statement.includes("Strategic Reviewer"),
      ),
    ).toBe(false);
  });
});
