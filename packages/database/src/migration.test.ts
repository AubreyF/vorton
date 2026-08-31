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
const workspaceMigrationUrl = new URL(
  "../../../supabase/migrations/20260830000100_workspaces.sql",
  import.meta.url,
);
const workspaceCreationAuthorityMigrationUrl = new URL(
  "../../../supabase/migrations/20260830000200_workspace_creation_authority.sql",
  import.meta.url,
);
const installationAuthorityApiMigrationUrl = new URL(
  "../../../supabase/migrations/20260830000300_installation_authority_api.sql",
  import.meta.url,
);
const moduleLifecycleAuthorityMigrationUrl = new URL(
  "../../../supabase/migrations/20260830000400_module_lifecycle_authority.sql",
  import.meta.url,
);
const moduleLifecycleExecutionMigrationUrl = new URL(
  "../../../supabase/migrations/20260830000500_module_lifecycle_execution.sql",
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

describe("workspace migration contract", () => {
  it("makes workspace realm authoritative for sources and memory banks", async () => {
    const sql = await readFile(workspaceMigrationUrl, "utf8");
    expect(sql).toContain("source_connections_workspace_realm_fk");
    expect(sql).toContain("memory_banks_workspace_realm_fk");
    expect(sql).toContain(
      "references public.workspaces(installation_id, id, realm) not valid",
    );
    expect(sql).toContain("drop constraint source_connections_installation_fk");
    expect(sql).toContain("drop constraint memory_banks_installation_fk");
    expect(sql).toContain("Workspace realm is authoritative");
  });

  it("replaces installation wide resource names with workspace identity", async () => {
    const sql = await readFile(workspaceMigrationUrl, "utf8");
    for (const constraint of [
      "workers_installation_id_name_key",
      "roles_installation_id_name_version_key",
      "policies_installation_id_name_version_key",
      "memory_banks_installation_id_key",
    ]) {
      expect(sql).toContain(`drop constraint ${constraint}`);
    }
    expect(sql).toContain("unique (installation_id, workspace_id, name)");
    expect(sql).toContain(
      "unique (installation_id, workspace_id, name, version)",
    );
    expect(sql).toContain("unique (installation_id, workspace_id)");
  });
});

describe("workspace creation authority migration contract", () => {
  it("uses an installation-scoped recent-AAL2 approval and immutable receipt", async () => {
    const sql = await readFile(workspaceCreationAuthorityMigrationUrl, "utf8");
    expect(sql).toContain("create table public.workspace_creation_approvals");
    expect(sql).toContain("create table public.workspace_creation_receipts");
    expect(sql).toContain("scope = 'workspace.create'");
    expect(sql).toContain("aal = 'aal2'");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("workspace_creation_receipts_approval_fk");
    expect(sql).toContain(
      "release_adoption_receipt_id, release_adoption_receipt_sha256",
    );
    expect(sql).not.toContain(
      "workspace_creation_receipts_owner_membership_fk",
    );
    expect(sql).toContain("without freezing later membership governance");
    expect(sql).toContain("create function public.apply_workspace_creation");
    expect(sql).toContain("approval.target_slug");
    expect(sql).toContain("approval.target_display_name");
    expect(sql).toContain("approval.target_realm");
    expect(sql).toContain("approval.expires_at <= clock_timestamp()");
    expect(sql).toContain("person.kind = 'owner'");
    expect(sql).toContain("unique (installation_id, approval_id)");
    expect(sql).toContain(
      "Release adoption and workspace creation approvals and receipts are append-only",
    );
    expect(sql).toContain("create table public.release_adoption_approvals");
    expect(sql).toContain("create table public.release_adoption_receipts");
    expect(sql).toContain("create function public.apply_release_adoption");
    expect(sql).toContain("exact_release <> approval.release");
    expect(sql).toContain("vorton_canonical_jsonb(receipt_document)");
    expect(sql).toContain('order by entry.key collate "C"');
    expect(sql).toContain(
      "Release adoption receipt ID must differ from approval ID",
    );
    expect(sql).toContain("image.key !~ '^[a-z][a-z0-9-]*$'");
    expect(sql).toContain("image.value is null");
    expect(sql).toContain("jsonb_typeof(value->'version') = 'string'");
    expect(sql).toContain("jsonb_typeof(value->'sourceCommit') = 'string'");
    expect(sql).toContain("check (id <> approval_id)");
    expect(sql).toContain("receipt.source_commit <> approval.source_commit");
    expect(sql).toContain("workspaceIsolationProofSha256");
    expect(sql).toContain("workspaceIsolationProofHash");
    expect(sql).toContain("for share");
  });

  it("records approval without consulting an existing workspace membership", async () => {
    const sql = await readFile(workspaceCreationAuthorityMigrationUrl, "utf8");
    expect(sql).toContain("create_workspace_creation_approval");
    expect(sql).toContain("person.kind = 'owner'");
    expect(sql).not.toContain("join public.workspace_memberships");
    expect(sql).toContain(
      "Signed installation-person AAL2 context is required to approve workspace creation",
    );
    expect(sql).toContain("vorton_installation_step_up_context_valid");
    expect(sql).toContain("vorton.step_up_signature");
    expect(sql).toContain("revoke select, insert, update, delete");
    expect(sql).not.toContain(
      "grant select on public.workspace_creation_approvals",
    );
  });
});

describe("installation authority API migration contract", () => {
  it("exposes retry-safe approval only and keeps apply private", async () => {
    const sql = await readFile(installationAuthorityApiMigrationUrl, "utf8");
    expect(sql.trimStart()).toMatch(
      /^-- Retry-safe authenticated approval entrypoints[^\n]*\n\nbegin;/,
    );
    expect(sql.trimEnd()).toMatch(/commit;$/);
    expect(sql).toContain("target_approval_id uuid");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("approval retry conflicts with immutable authority");
    expect(sql).toContain("'release', value.release");
    expect(sql).toContain("workspace_creation_approval_document");
    expect(sql).toContain("workspace_creation_receipts_distinct_ids");
    expect(sql).toContain("release_adoption_receipts_release_check");
    expect(sql).toContain(
      "aal2_verified_at <= approved_at + interval '1 minute'",
    );
    expect(sql).toContain("[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*");
    expect(sql).toContain(
      "revoke execute on function public.create_release_adoption_approval",
    );
    expect(sql).not.toContain("grant execute on function public.apply_");
    expect(sql).not.toContain("workspace_memberships");
  });
});

describe("module lifecycle authority migration contract", () => {
  it("matches the contract canonical JSON and SHA-256 vector", async () => {
    const sql = await readFile(moduleLifecycleAuthorityMigrationUrl, "utf8");
    const canonical =
      '{"a":{"array":[3,"x",false],"integer":42,"nested":{"a":1,"b":2},"timestamp":"2026-08-30T12:00:00.000Z","uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"z":null}';
    const digest =
      "sha256:12b1b0f57cff0749342d1d85bdd5ec6fcbb5f024209ca22b408e31959e5e8c6e";

    expect(sql).toContain(canonical);
    expect(sql).toContain(digest);
    expect(sql).toContain("vorton_canonical_jsonb(value)");
  });

  it("binds exact workspace-owner AAL2 authority and atomic no-effect receipts", async () => {
    const sql = await readFile(moduleLifecycleAuthorityMigrationUrl, "utf8");

    expect(sql).toContain("create type public.module_lifecycle_action as enum");
    for (const action of ["backup", "recovery", "deletion", "rollback"]) {
      expect(sql).toContain(`'${action}'`);
    }
    expect(sql).toContain("vorton_module_lifecycle_binding_valid");
    expect(sql).toContain("object_key !~ '^[a-z0-9._/-]+$'");
    expect(sql).toContain("vorton_workspace_step_up_context_valid");
    expect(sql).toContain("|workspace-person|");
    expect(sql).toContain(") <= approved_at");
    expect(sql).toContain("+ interval '10 minutes'");
    expect(sql).toContain("membership.kind = 'owner'");
    expect(sql).toContain("for share of membership, workspace, person");
    expect(sql).toContain(
      "approval time and recheck AAL2 only after the live owner rows are locked",
    );
    expect(sql).toContain("gen_random_uuid()");
    expect(sql).toContain("for identifier_generation_attempt in 1..16 loop");
    expect(sql).toContain(
      "target_approval_id::text =\n      exact_binding#>>'{target,backupReceipt,receiptId}'",
    );
    expect(sql).toContain("module_lifecycle_approvals_distinct_ids");
    expect(sql).toContain("module_lifecycle_approvals_record_fk");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain(
      "alter table public.records drop constraint records_workspace_person_fk",
    );
    expect(sql).toContain("module_lifecycle_approval_receipts_distinct_ids");
    expect(sql).toContain("module_lifecycle_approval_receipts_distinct_hashes");
    expect(sql).toContain('approvalConsumed": false');
    expect(sql).toContain(
      "insert into public.module_lifecycle_action_approvals",
    );
    expect(sql).toContain(
      "insert into public.module_lifecycle_approval_receipts",
    );
    expect(sql).toContain("insert into public.records");
    expect(sql).toContain(
      "public.module_lifecycle_approval_document(approval, receipt)",
    );
    expect(sql).toContain("approval_record.kind is distinct from 'approval'");
    expect(sql).not.toContain("module_lifecycle_approvals_membership_fk");
    expect(sql).not.toContain("create function public.consume_");
    expect(sql).not.toContain("create function public.execute_");
  });

  it("keeps exact replay live, immutable, and narrowly granted", async () => {
    const sql = await readFile(moduleLifecycleAuthorityMigrationUrl, "utf8");

    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("approval.binding is distinct from exact_binding");
    expect(sql).toContain(
      "approval.expires_at is distinct from target_expires_at",
    );
    expect(sql).toContain("target_expires_at is distinct from date_trunc(");
    expect(sql).toContain(
      "Module lifecycle approval retry conflicts with immutable authority",
    );
    expect(sql).toContain(
      "Signed workspace-person AAL2 context is required to approve module lifecycle action",
    );
    expect(sql).toContain(
      "Live workspace owner authority is required to approve module lifecycle action",
    );
    expect(sql).toContain("Exact module lifecycle binding is invalid");
    expect(sql).toContain(
      "Module lifecycle binding does not match workspace authority",
    );
    expect(sql).toContain(
      "Module lifecycle approvals and approval-creation receipts are append-only",
    );
    expect(sql).toContain(
      "alter table public.module_lifecycle_action_approvals enable row level security",
    );
    expect(sql).toContain(
      "alter table public.module_lifecycle_approval_receipts enable row level security",
    );
    expect(sql).toContain(
      "revoke all on table public.module_lifecycle_action_approvals",
    );
    expect(sql).toContain(
      "grant execute on function public.create_module_lifecycle_action_approval",
    );
    expect(sql).not.toContain(
      "grant select on public.module_lifecycle_action_approvals",
    );
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });
});

describe("module lifecycle execution migration contract", () => {
  it("separates immutable approval consumption from action finalization", async () => {
    const sql = await readFile(moduleLifecycleExecutionMigrationUrl, "utf8");

    expect(sql).toContain("vorton.module-lifecycle-action-command.v1");
    expect(sql).toContain("vorton.module-lifecycle-action-receipt.v1");
    expect(sql).toContain(
      "insert into public.module_lifecycle_action_commands",
    );
    expect(sql).toContain(
      "insert into public.module_lifecycle_action_receipts",
    );
    expect(sql).toContain("approvalConsumptionCount', 1");
    expect(sql).toContain('"actionExecuted": false');
    expect(sql).toContain("Lifecycle action command retry conflicts");
    expect(sql).toContain("Lifecycle action receipt retry conflicts");
    expect(sql).toContain(
      "Module lifecycle commands and action receipts are append-only",
    );
  });

  it("requires live worker custody and exact action-specific authority", async () => {
    const sql = await readFile(moduleLifecycleExecutionMigrationUrl, "utf8");

    expect(sql).toContain("aubos_runtime_context_valid(");
    expect(sql).toContain("Live worker credential is required");
    expect(sql).toContain("work_row.state <> 'leased'");
    expect(sql).toContain("work_row.custodian_worker_id <> worker_id_value");
    expect(sql).toContain(
      "'module.lifecycle.' || approval.action::text\n       || '.' || exact_proof_scope",
    );
    expect(sql).toContain("candidate.mode = 'modify'");
    expect(sql).toContain("active_grant_count <> 1");
    expect(sql).toContain("owner_membership.kind <> 'owner'");
    expect(sql).toContain("approval.expires_at <= consumed_at_value");
    expect(sql).toContain("Fresh live worker credential is required");
  });

  it("allows production rollback only through a controlled deletion rehearsal", async () => {
    const sql = await readFile(moduleLifecycleExecutionMigrationUrl, "utf8");

    expect(sql).toContain("backup.proof_scope <> target_proof_scope");
    expect(sql).toContain("recovery.proof_scope <> target_proof_scope");
    expect(sql).toContain("deletion.proof_scope <> 'controlled-synthetic'");
    expect(sql).toContain(
      "Deletion rehearsal requires controlled synthetic proof scope",
    );
  });

  it("keeps tables private and exposes only the two worker operations", async () => {
    const sql = await readFile(moduleLifecycleExecutionMigrationUrl, "utf8");

    expect(sql).toContain(
      "alter table public.module_lifecycle_action_commands enable row level security",
    );
    expect(sql).toContain(
      "alter table public.module_lifecycle_action_receipts enable row level security",
    );
    expect(sql).toContain(
      "revoke all on table public.module_lifecycle_action_commands",
    );
    expect(sql).toContain(
      "grant execute on function public.consume_module_lifecycle_action_approval",
    );
    expect(sql).toContain(
      "grant execute on function public.finalize_module_lifecycle_action",
    );
    expect(sql).not.toContain(
      "grant select on public.module_lifecycle_action_commands",
    );
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });
});
