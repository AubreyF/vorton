begin;

create type public.installation_realm as enum ('personal', 'organizational');
create type public.source_boundary as enum ('personal', 'organizational', 'mixed');
create type public.admission_state as enum ('pending', 'admitted', 'quarantined', 'rejected');
create type public.transcript_provider as enum ('google-meet', 'omi');
create type public.source_completeness as enum ('complete', 'partial', 'unavailable');

alter table public.installations
  add column realm public.installation_realm not null default 'organizational',
  add unique (id, realm);

create table public.source_connections (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  provider public.transcript_provider not null,
  external_account_id text not null check (length(trim(external_account_id)) > 0),
  credential_reference text not null check (length(trim(credential_reference)) > 0),
  poll_overlap_seconds integer not null check (poll_overlap_seconds between 0 and 86400),
  requests_per_minute integer not null check (requests_per_minute > 0),
  page_size integer not null check (page_size > 0),
  max_pages_per_poll integer not null check (max_pages_per_poll > 0),
  backoff_base_seconds integer not null check (backoff_base_seconds > 0),
  backoff_max_seconds integer not null check (backoff_max_seconds >= backoff_base_seconds),
  watermark timestamptz not null,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  next_poll_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint source_connections_installation_fk
    foreign key (installation_id, installation_realm)
    references public.installations(id, realm) on delete restrict,
  unique (installation_id, provider, external_account_id),
  unique (installation_id, installation_realm, id)
);

comment on table public.source_connections is
  'Read-only polling configuration. credential_reference points to installation-scoped secret storage and never contains a credential.';

create table public.transcript_revisions (
  id uuid primary key,
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  connection_id uuid not null,
  provider public.transcript_provider not null,
  provider_object_id text not null check (length(trim(provider_object_id)) > 0),
  revision_hash text not null check (revision_hash ~ '^[a-f0-9]{64}$'),
  title text,
  started_at timestamptz not null,
  ended_at timestamptz,
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants) = 'array'),
  raw_source_pointer text,
  provider_observed_at timestamptz not null,
  ingested_at timestamptz not null,
  adapter_version text not null check (length(trim(adapter_version)) > 0),
  classification public.data_classification not null,
  completeness public.source_completeness not null,
  boundary public.source_boundary not null,
  admission_state public.admission_state not null,
  deleted_at timestamptz,
  supersedes_revision_id uuid,
  constraint transcript_revisions_connection_fk
    foreign key (installation_id, installation_realm, connection_id)
    references public.source_connections(installation_id, installation_realm, id) on delete restrict,
  constraint transcript_revisions_supersedes_fk
    foreign key (installation_id, installation_realm, supersedes_revision_id)
    references public.transcript_revisions(installation_id, installation_realm, id) on delete restrict,
  constraint transcript_revisions_not_self_superseding check (id <> supersedes_revision_id),
  constraint transcript_revisions_quarantine_crossing check (
    admission_state = 'quarantined'
    or (
      boundary <> 'mixed'
      and boundary::text = installation_realm::text
    )
  ),
  unique (installation_id, provider, provider_object_id, revision_hash),
  unique (installation_id, installation_realm, id),
  unique (installation_id, installation_realm, id, revision_hash)
);

create table public.transcript_utterances (
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  transcript_revision_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  speaker text,
  utterance_text text not null,
  started_at timestamptz,
  ended_at timestamptz,
  constraint transcript_utterances_revision_fk
    foreign key (installation_id, installation_realm, transcript_revision_id)
    references public.transcript_revisions(installation_id, installation_realm, id) on delete restrict,
  primary key (transcript_revision_id, ordinal)
);

create table public.source_citations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  transcript_revision_id uuid not null,
  source_uri text not null check (length(trim(source_uri)) > 0),
  revision_hash text not null check (revision_hash ~ '^[a-f0-9]{64}$'),
  locator text not null check (length(trim(locator)) > 0),
  constraint source_citations_revision_fk
    foreign key (installation_id, installation_realm, transcript_revision_id, revision_hash)
    references public.transcript_revisions(installation_id, installation_realm, id, revision_hash) on delete restrict,
  unique (transcript_revision_id, locator),
  unique (installation_id, installation_realm, id)
);

create table public.memory_banks (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  adapter text not null check (adapter = 'hindsight'),
  external_bank_id text not null check (length(trim(external_bank_id)) > 0),
  database_locator text not null check (length(trim(database_locator)) > 0),
  object_bucket_locator text not null check (length(trim(object_bucket_locator)) > 0),
  created_at timestamptz not null default now(),
  constraint memory_banks_installation_fk
    foreign key (installation_id, installation_realm)
    references public.installations(id, realm) on delete restrict,
  unique (installation_id),
  unique (external_bank_id),
  unique (database_locator),
  unique (object_bucket_locator),
  unique (installation_id, installation_realm, id)
);

comment on table public.memory_banks is
  'Every installation receives distinct Hindsight, database, and object-bucket locators. Personal and organizational material never shares a bank or storage locator.';

create table public.memory_candidates (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  source_revision_id uuid not null,
  bank_id uuid,
  candidate_text text not null,
  admission_state public.admission_state not null,
  admitted_at timestamptz,
  rejected_at timestamptz,
  quarantined_at timestamptz,
  created_at timestamptz not null default now(),
  constraint memory_candidates_source_fk
    foreign key (installation_id, installation_realm, source_revision_id)
    references public.transcript_revisions(installation_id, installation_realm, id) on delete restrict,
  constraint memory_candidates_bank_fk
    foreign key (installation_id, installation_realm, bank_id)
    references public.memory_banks(installation_id, installation_realm, id) on delete restrict,
  constraint memory_candidates_admission_shape check (
    (admission_state = 'pending' and bank_id is null and admitted_at is null and rejected_at is null and quarantined_at is null)
    or (admission_state = 'admitted' and bank_id is not null and admitted_at is not null and rejected_at is null and quarantined_at is null)
    or (admission_state = 'rejected' and bank_id is null and rejected_at is not null and admitted_at is null and quarantined_at is null)
    or (admission_state = 'quarantined' and bank_id is null and quarantined_at is not null and admitted_at is null and rejected_at is null)
  ),
  unique (installation_id, source_revision_id),
  unique (installation_id, installation_realm, id)
);

create table public.derived_memories (
  id uuid primary key,
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  bank_id uuid not null,
  external_memory_id text not null check (length(trim(external_memory_id)) > 0),
  memory_text text not null,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  constraint derived_memories_bank_fk
    foreign key (installation_id, installation_realm, bank_id)
    references public.memory_banks(installation_id, installation_realm, id) on delete restrict,
  unique (bank_id, external_memory_id),
  unique (installation_id, installation_realm, id)
);

comment on table public.derived_memories is
  'Untrusted derived context only. Rows cannot create Records, decisions, approvals, Policies, capabilities, or Work.';

create table public.consolidation_lineage (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  derived_memory_id uuid not null,
  source_revision_id uuid not null,
  parent_memory_id uuid,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz,
  constraint consolidation_lineage_memory_fk
    foreign key (installation_id, installation_realm, derived_memory_id)
    references public.derived_memories(installation_id, installation_realm, id) on delete restrict,
  constraint consolidation_lineage_source_fk
    foreign key (installation_id, installation_realm, source_revision_id)
    references public.transcript_revisions(installation_id, installation_realm, id) on delete restrict,
  constraint consolidation_lineage_parent_fk
    foreign key (installation_id, installation_realm, parent_memory_id)
    references public.derived_memories(installation_id, installation_realm, id) on delete restrict
);

create unique index consolidation_lineage_root_unique
  on public.consolidation_lineage(derived_memory_id, source_revision_id)
  where parent_memory_id is null;
create unique index consolidation_lineage_parent_unique
  on public.consolidation_lineage(derived_memory_id, source_revision_id, parent_memory_id)
  where parent_memory_id is not null;

create table public.retrieval_receipts (
  id uuid primary key,
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  bank_id uuid not null,
  query_hash text not null check (query_hash ~ '^[a-f0-9]{64}$'),
  retrieved_at timestamptz not null,
  constraint retrieval_receipts_bank_fk
    foreign key (installation_id, installation_realm, bank_id)
    references public.memory_banks(installation_id, installation_realm, id) on delete restrict,
  unique (installation_id, installation_realm, id)
);

create table public.retrieval_receipt_results (
  installation_id uuid not null,
  installation_realm public.installation_realm not null,
  receipt_id uuid not null,
  derived_memory_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  constraint retrieval_results_receipt_fk
    foreign key (installation_id, installation_realm, receipt_id)
    references public.retrieval_receipts(installation_id, installation_realm, id) on delete restrict,
  constraint retrieval_results_memory_fk
    foreign key (installation_id, installation_realm, derived_memory_id)
    references public.derived_memories(installation_id, installation_realm, id) on delete restrict,
  primary key (receipt_id, ordinal),
  unique (receipt_id, derived_memory_id)
);

create index transcript_revisions_poll_idx
  on public.transcript_revisions(connection_id, provider_observed_at desc);
create index transcript_revisions_active_idx
  on public.transcript_revisions(installation_id, provider, provider_object_id, ingested_at desc)
  where deleted_at is null;
create index consolidation_lineage_source_idx
  on public.consolidation_lineage(source_revision_id)
  where invalidated_at is null;

create function public.reject_canonical_revision_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'Canonical transcript revisions and utterances are immutable; append a superseding revision';
end
$$;

create trigger transcript_revisions_reject_update_delete
before update or delete on public.transcript_revisions
for each row execute function public.reject_canonical_revision_mutation();

create trigger transcript_utterances_reject_update_delete
before update or delete on public.transcript_utterances
for each row execute function public.reject_canonical_revision_mutation();

create function public.invalidate_memory_for_supersession() returns trigger
language plpgsql
as $$
declare
  invalidated_source_id uuid;
begin
  invalidated_source_id := new.supersedes_revision_id;
  if invalidated_source_id is not null then
    update public.consolidation_lineage
      set invalidated_at = new.ingested_at
      where installation_id = new.installation_id
        and installation_realm = new.installation_realm
        and source_revision_id = invalidated_source_id
        and invalidated_at is null;
    update public.derived_memories memory
      set invalidated_at = new.ingested_at
      where memory.installation_id = new.installation_id
        and memory.installation_realm = new.installation_realm
        and exists (
          select 1 from public.consolidation_lineage lineage
          where lineage.derived_memory_id = memory.id
            and lineage.source_revision_id = invalidated_source_id
        );
  end if;
  return new;
end
$$;

create trigger transcript_revisions_invalidate_superseded_memory
after insert on public.transcript_revisions
for each row execute function public.invalidate_memory_for_supersession();

comment on function public.invalidate_memory_for_supersession() is
  'Propagates append-only supersession and deletion revisions into derived-memory invalidation.';

alter table public.source_connections enable row level security;
alter table public.transcript_revisions enable row level security;
alter table public.transcript_utterances enable row level security;
alter table public.source_citations enable row level security;
alter table public.memory_banks enable row level security;
alter table public.memory_candidates enable row level security;
alter table public.derived_memories enable row level security;
alter table public.consolidation_lineage enable row level security;
alter table public.retrieval_receipts enable row level security;
alter table public.retrieval_receipt_results enable row level security;

create policy source_connections_member_select on public.source_connections for select to authenticated
  using (public.is_installation_member(installation_id));
create policy transcript_revisions_member_select on public.transcript_revisions for select to authenticated
  using (public.is_installation_member(installation_id));
create policy transcript_utterances_member_select on public.transcript_utterances for select to authenticated
  using (public.is_installation_member(installation_id));
create policy source_citations_member_select on public.source_citations for select to authenticated
  using (public.is_installation_member(installation_id));
create policy memory_banks_member_select on public.memory_banks for select to authenticated
  using (public.is_installation_member(installation_id));
create policy memory_candidates_member_select on public.memory_candidates for select to authenticated
  using (public.is_installation_member(installation_id));
create policy derived_memories_member_select on public.derived_memories for select to authenticated
  using (public.is_installation_member(installation_id));
create policy consolidation_lineage_member_select on public.consolidation_lineage for select to authenticated
  using (public.is_installation_member(installation_id));
create policy retrieval_receipts_member_select on public.retrieval_receipts for select to authenticated
  using (public.is_installation_member(installation_id));
create policy retrieval_results_member_select on public.retrieval_receipt_results for select to authenticated
  using (public.is_installation_member(installation_id));

grant select on public.source_connections, public.transcript_revisions,
  public.transcript_utterances, public.source_citations, public.memory_banks,
  public.memory_candidates, public.derived_memories, public.consolidation_lineage,
  public.retrieval_receipts, public.retrieval_receipt_results to authenticated;

commit;
