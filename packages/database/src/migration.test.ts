import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../supabase/migrations/20260828000100_kernel.sql",
  import.meta.url,
);
const executiveMigrationUrl = new URL(
  "../../../supabase/migrations/20260828000300_executive.sql",
  import.meta.url,
);
const memoryMigrationUrl = new URL(
  "../../../supabase/migrations/20260828000200_memory_conversations.sql",
  import.meta.url,
);
const memorySqlTestUrl = new URL(
  "../../../supabase/tests/memory_conversations.sql",
  import.meta.url,
);
const runtimeAuthorityMigrationUrl = new URL(
  "../../../supabase/migrations/20260828000400_runtime_authority.sql",
  import.meta.url,
);
const executiveCouncilMigrationUrl = new URL(
  "../../../supabase/migrations/20260828000500_executive_council.sql",
  import.meta.url,
);

describe("kernel migration contract", () => {
  it("enforces RLS on every kernel authority table", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "people",
      "workers",
      "worker_credentials",
      "roles",
      "work",
      "policies",
      "capability_grants",
      "records",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("keeps records immutable and worker credentials short-lived", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain(
      "Records are append-only; append a superseding record instead",
    );
    expect(sql).toContain("expires_at <= issued_at + interval '15 minutes'");
    expect(sql).toContain("Roles never grant capabilities or authority");
    expect(sql).toContain(
      "grant execute on function public.worker_transition_work",
    );
    expect(sql).not.toContain(
      "grant select, update on public.work to aubos_worker",
    );
  });

  it("does not provision people from editable Auth metadata", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toContain("raw_user_meta_data");
    expect(sql).toContain("revoke all on function public.provision_person");
  });
});

describe("executive migration contract", () => {
  it("stores provider job identity without giving model output authority", async () => {
    const sql = await readFile(executiveMigrationUrl, "utf8");
    expect(sql).toContain(
      "alter type public.record_kind add value if not exists 'review'",
    );
    expect(sql).toContain(
      "alter table public.worker_runs enable row level security",
    );
    expect(sql).toContain(
      "public.worker_has_capability('executive.propose', 'recommend', work_id)",
    );
    expect(sql).toContain("not background or store");
    expect(sql).toContain(
      "Model output grants no database or external action authority",
    );
    expect(sql).not.toContain("grant update on public.work to aubos_worker");
  });
});

describe("runtime authority migration contract", () => {
  it("requires a transaction-bound signature before RLS accepts claimed context", async () => {
    const sql = await readFile(runtimeAuthorityMigrationUrl, "utf8");
    expect(sql).toContain("aubos_private.runtime_context_keys");
    expect(sql).toContain("txid_current()::text");
    expect(sql).toContain("extensions.hmac(");
    expect(sql).toContain("where context_key.role_name = session_user");
    expect(sql).toContain("current_setting('aubos.context_signature', true)");
  });

  it("prevents a worker from appending human authority records", async () => {
    const sql = await readFile(runtimeAuthorityMigrationUrl, "utf8");
    expect(sql).toContain("kind not in ('approval', 'decision', 'review')");
    expect(sql).toContain(
      "public.worker_has_capability('executive.propose', 'recommend', work_id)",
    );
    expect(sql).toContain(
      "revoke all on aubos_private.runtime_context_keys from public, anon, authenticated, aubos_worker",
    );
  });
});

describe("executive council migration contract", () => {
  it("allows only capability-scoped worker proposals and reviews", async () => {
    const sql = await readFile(executiveCouncilMigrationUrl, "utf8");
    expect(sql).toContain("kind not in ('approval', 'decision')");
    expect(sql).toContain(
      "public.worker_has_capability('executive.propose', 'recommend', work_id)",
    );
    expect(sql).toContain(
      "public.worker_has_capability('executive.review', 'recommend', work_id)",
    );
    expect(sql).toContain("public.worker_has_assigned_role");
    expect(sql).not.toContain("grant update on public.work to aubos_worker");
  });

  it("fences one contribution and one completed run per phase and role", async () => {
    const sql = await readFile(executiveCouncilMigrationUrl, "utf8");
    expect(sql).toContain("records_council_phase_role_fence");
    expect(sql).toContain("worker_runs_council_active_phase_role_fence");
    expect(sql).toContain("vorton.executive-council.v1");
    expect(sql).toContain("payload ->> 'authority' = 'none'");
    expect(sql).toContain("metadata ->> 'authority' = 'none'");
    expect(sql).toContain("and not store");
    expect(sql).toContain("and not background");
    expect(sql).toContain("public.council_work_revision_matches");
    expect(sql).toContain("public.council_completed_run_matches");
    expect(sql).toContain(
      "run.metadata -> 'input_record_ids' = target_input_record_ids",
    );
    expect(sql).toContain(
      "run.metadata ->> 'work_input_sha256' = target_work_input_sha256",
    );
    expect(sql).toContain("'acceptanceCriteria', work_row.acceptance_criteria");
    expect(sql).toContain("status in ('queued', 'in_progress', 'completed')");
  });
});

describe("memory and conversations migration contract", () => {
  it("isolates banks and source rows by installation realm", async () => {
    const sql = await readFile(memoryMigrationUrl, "utf8");
    expect(sql).toContain("add column realm public.installation_realm,");
    expect(sql).toContain(
      "installations_realm_assigned check (realm is not null) not valid",
    );
    expect(sql).not.toContain("default 'organizational'");
    expect(sql).toContain("foreign key (installation_id, installation_realm)");
    expect(sql).toContain("unique (external_bank_id)");
    expect(sql).toContain("unique (database_locator)");
    expect(sql).toContain("unique (object_bucket_locator)");
    expect(sql).toContain("transcript_revisions_quarantine_crossing");
  });

  it("keeps canonical revisions immutable and memory non-authoritative", async () => {
    const sql = await readFile(memoryMigrationUrl, "utf8");
    expect(sql).toContain(
      "Canonical transcript revisions and utterances are immutable",
    );
    expect(sql).toContain("Untrusted derived context only");
    expect(sql).not.toContain("raw_audio");
    expect(sql).not.toContain("raw_video");
  });

  it("enables RLS for every Wave 2 table", async () => {
    const sql = await readFile(memoryMigrationUrl, "utf8");
    for (const table of [
      "source_connections",
      "transcript_revisions",
      "transcript_utterances",
      "source_citations",
      "memory_banks",
      "memory_candidates",
      "derived_memories",
      "consolidation_lineage",
      "retrieval_receipts",
      "retrieval_receipt_results",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
  });

  it("ships a synthetic SQL integration test for quarantine and propagation", async () => {
    const sql = await readFile(memorySqlTestUrl, "utf8");
    expect(sql).toContain("Supersession did not invalidate derived memory");
    expect(sql).toContain("Mixed source bypassed quarantine");
    expect(sql).toContain("Canonical transcript revision accepted mutation");
    expect(sql).toContain("New installation omitted an explicit realm");
    expect(sql).toContain("Unknown installation accepted a source connection");
  });
});
