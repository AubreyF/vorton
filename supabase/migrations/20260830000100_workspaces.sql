begin;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]*$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  realm public.installation_realm not null,
  created_by_person_id uuid not null,
  created_at timestamptz not null default now(),
  constraint workspaces_creator_fk foreign key (installation_id, created_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  unique (installation_id, slug),
  unique (installation_id, id),
  unique (installation_id, id, realm)
);

comment on table public.workspaces is
  'Logical authority, privacy, memory, storage, worker, event, and audit boundary inside one physical Vorton installation.';

create table public.workspace_memberships (
  installation_id uuid not null,
  workspace_id uuid not null,
  person_id uuid not null,
  kind public.person_kind not null,
  created_at timestamptz not null default now(),
  constraint workspace_memberships_workspace_fk foreign key (installation_id, workspace_id)
    references public.workspaces(installation_id, id) on delete restrict,
  constraint workspace_memberships_person_fk foreign key (installation_id, person_id)
    references public.people(installation_id, id) on delete restrict,
  primary key (workspace_id, person_id),
  unique (installation_id, workspace_id, person_id)
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workers', 'worker_credentials', 'worker_credential_revocations', 'roles',
    'worker_role_assignments', 'work', 'work_dependencies', 'policies',
    'capability_grants', 'capability_grant_revocations', 'records',
    'source_connections', 'transcript_revisions', 'transcript_utterances',
    'source_citations', 'memory_banks', 'memory_candidates', 'derived_memories',
    'consolidation_lineage', 'retrieval_receipts',
    'retrieval_receipt_results', 'worker_runs'
  ] loop
    execute format('alter table public.%I add column workspace_id uuid', table_name);
    execute format(
      'alter table public.%I add constraint %I check (workspace_id is not null) not valid',
      table_name, table_name || '_workspace_assigned'
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (installation_id, workspace_id) references public.workspaces(installation_id, id) on delete restrict not valid',
      table_name, table_name || '_workspace_fk'
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workers', 'worker_credentials', 'worker_credential_revocations', 'roles',
    'worker_role_assignments', 'work', 'policies', 'capability_grants',
    'capability_grant_revocations', 'records', 'source_connections',
    'transcript_revisions', 'source_citations', 'memory_banks',
    'memory_candidates', 'derived_memories', 'consolidation_lineage',
    'retrieval_receipts', 'worker_runs'
  ] loop
    execute format(
      'alter table public.%I add constraint %I unique (installation_id, workspace_id, id)',
      table_name, table_name || '_workspace_identity'
    );
  end loop;
end
$$;

-- Workspace realm, not the physical installation, is the source and memory
-- boundary. The legacy installation realm remains migration metadata only.
alter table public.source_connections
  drop constraint source_connections_installation_fk,
  add constraint source_connections_workspace_realm_fk
    foreign key (installation_id, workspace_id, installation_realm)
    references public.workspaces(installation_id, id, realm) not valid;

alter table public.memory_banks
  drop constraint memory_banks_installation_fk,
  add constraint memory_banks_workspace_realm_fk
    foreign key (installation_id, workspace_id, installation_realm)
    references public.workspaces(installation_id, id, realm) not valid;

comment on column public.installations.realm is
  'Legacy migration metadata only. Workspace realm is authoritative for source, memory, and custody boundaries.';

-- Resource identity is workspace scoped. Keeping the legacy installation wide
-- constraints would prevent equivalent resources in isolated workspaces.
alter table public.workers
  drop constraint workers_installation_id_name_key,
  add constraint workers_workspace_name_key
    unique (installation_id, workspace_id, name);

alter table public.roles
  drop constraint roles_installation_id_name_version_key,
  add constraint roles_workspace_name_version_key
    unique (installation_id, workspace_id, name, version);

alter table public.policies
  drop constraint policies_installation_id_name_version_key,
  add constraint policies_workspace_name_version_key
    unique (installation_id, workspace_id, name, version);

alter table public.memory_banks
  drop constraint memory_banks_installation_id_key,
  add constraint memory_banks_workspace_key
    unique (installation_id, workspace_id);

alter table public.worker_credentials
  add constraint worker_credentials_workspace_worker_fk
    foreign key (installation_id, workspace_id, worker_id)
    references public.workers(installation_id, workspace_id, id) not valid,
  add constraint worker_credentials_workspace_issuer_fk
    foreign key (installation_id, workspace_id, issued_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid;

alter table public.worker_credential_revocations
  add constraint worker_credential_revocations_workspace_credential_fk
    foreign key (installation_id, workspace_id, credential_id)
    references public.worker_credentials(installation_id, workspace_id, id) not valid,
  add constraint worker_credential_revocations_workspace_person_fk
    foreign key (installation_id, workspace_id, revoked_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid;

alter table public.roles
  add constraint roles_workspace_creator_fk
    foreign key (installation_id, workspace_id, created_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid;

alter table public.worker_role_assignments
  add constraint worker_roles_workspace_worker_fk
    foreign key (installation_id, workspace_id, worker_id)
    references public.workers(installation_id, workspace_id, id) not valid,
  add constraint worker_roles_workspace_role_fk
    foreign key (installation_id, workspace_id, role_id)
    references public.roles(installation_id, workspace_id, id) not valid,
  add constraint worker_roles_workspace_person_fk
    foreign key (installation_id, workspace_id, assigned_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid;

alter table public.work
  add constraint work_workspace_parent_fk
    foreign key (installation_id, workspace_id, parent_work_id)
    references public.work(installation_id, workspace_id, id) not valid,
  add constraint work_workspace_requester_fk
    foreign key (installation_id, workspace_id, requested_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid,
  add constraint work_workspace_person_custodian_fk
    foreign key (installation_id, workspace_id, custodian_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid,
  add constraint work_workspace_worker_custodian_fk
    foreign key (installation_id, workspace_id, custodian_worker_id)
    references public.workers(installation_id, workspace_id, id) not valid;

alter table public.work_dependencies
  add constraint work_dependencies_workspace_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id) not valid,
  add constraint work_dependencies_workspace_dependency_fk
    foreign key (installation_id, workspace_id, depends_on_work_id)
    references public.work(installation_id, workspace_id, id) not valid;

alter table public.policies
  add constraint policies_workspace_creator_fk
    foreign key (installation_id, workspace_id, created_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid;

alter table public.capability_grants
  add constraint grants_workspace_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id) not valid,
  add constraint grants_workspace_person_fk
    foreign key (installation_id, workspace_id, person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid,
  add constraint grants_workspace_worker_fk
    foreign key (installation_id, workspace_id, worker_id)
    references public.workers(installation_id, workspace_id, id) not valid,
  add constraint grants_workspace_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id) not valid,
  add constraint grants_workspace_granter_fk
    foreign key (installation_id, workspace_id, granted_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid;

alter table public.capability_grant_revocations
  add constraint grant_revocations_workspace_person_fk
    foreign key (installation_id, workspace_id, revoked_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid,
  add constraint grant_revocations_workspace_grant_fk
    foreign key (installation_id, workspace_id, grant_id)
    references public.capability_grants(installation_id, workspace_id, id) not valid;

alter table public.records
  add constraint records_workspace_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id) not valid,
  add constraint records_workspace_person_fk
    foreign key (installation_id, workspace_id, actor_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id) not valid,
  add constraint records_workspace_worker_fk
    foreign key (installation_id, workspace_id, actor_worker_id)
    references public.workers(installation_id, workspace_id, id) not valid,
  add constraint records_workspace_supersedes_fk
    foreign key (installation_id, workspace_id, supersedes_record_id)
    references public.records(installation_id, workspace_id, id) not valid;

alter table public.transcript_revisions
  add constraint transcript_revisions_workspace_connection_fk
    foreign key (installation_id, workspace_id, connection_id)
    references public.source_connections(installation_id, workspace_id, id) not valid,
  add constraint transcript_revisions_workspace_supersedes_fk
    foreign key (installation_id, workspace_id, supersedes_revision_id)
    references public.transcript_revisions(installation_id, workspace_id, id) not valid;

alter table public.transcript_utterances
  add constraint transcript_utterances_workspace_revision_fk
    foreign key (installation_id, workspace_id, transcript_revision_id)
    references public.transcript_revisions(installation_id, workspace_id, id) not valid;

alter table public.source_citations
  add constraint source_citations_workspace_revision_fk
    foreign key (installation_id, workspace_id, transcript_revision_id)
    references public.transcript_revisions(installation_id, workspace_id, id) not valid;

alter table public.memory_candidates
  add constraint memory_candidates_workspace_source_fk
    foreign key (installation_id, workspace_id, source_revision_id)
    references public.transcript_revisions(installation_id, workspace_id, id) not valid,
  add constraint memory_candidates_workspace_bank_fk
    foreign key (installation_id, workspace_id, bank_id)
    references public.memory_banks(installation_id, workspace_id, id) not valid;

alter table public.derived_memories
  add constraint derived_memories_workspace_bank_fk
    foreign key (installation_id, workspace_id, bank_id)
    references public.memory_banks(installation_id, workspace_id, id) not valid;

alter table public.consolidation_lineage
  add constraint consolidation_lineage_workspace_memory_fk
    foreign key (installation_id, workspace_id, derived_memory_id)
    references public.derived_memories(installation_id, workspace_id, id) not valid,
  add constraint consolidation_lineage_workspace_source_fk
    foreign key (installation_id, workspace_id, source_revision_id)
    references public.transcript_revisions(installation_id, workspace_id, id) not valid,
  add constraint consolidation_lineage_workspace_parent_fk
    foreign key (installation_id, workspace_id, parent_memory_id)
    references public.derived_memories(installation_id, workspace_id, id) not valid;

alter table public.retrieval_receipts
  add constraint retrieval_receipts_workspace_bank_fk
    foreign key (installation_id, workspace_id, bank_id)
    references public.memory_banks(installation_id, workspace_id, id) not valid;

alter table public.retrieval_receipt_results
  add constraint retrieval_results_workspace_receipt_fk
    foreign key (installation_id, workspace_id, receipt_id)
    references public.retrieval_receipts(installation_id, workspace_id, id) not valid,
  add constraint retrieval_results_workspace_memory_fk
    foreign key (installation_id, workspace_id, derived_memory_id)
    references public.derived_memories(installation_id, workspace_id, id) not valid;

alter table public.worker_runs
  add constraint worker_runs_workspace_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id) not valid,
  add constraint worker_runs_workspace_worker_fk
    foreign key (installation_id, workspace_id, worker_id)
    references public.workers(installation_id, workspace_id, id) not valid,
  add constraint worker_runs_workspace_role_fk
    foreign key (installation_id, workspace_id, role_id)
    references public.roles(installation_id, workspace_id, id) not valid;

create index workspace_memberships_person_idx
  on public.workspace_memberships(installation_id, person_id, workspace_id);
create index work_workspace_state_idx
  on public.work(installation_id, workspace_id, state, priority desc);
create index records_workspace_created_idx
  on public.records(installation_id, workspace_id, created_at desc);

create or replace function public.aubos_runtime_context_valid(
  expected_kind text,
  expected_installation text,
  expected_workspace text,
  expected_subject text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, aubos_private
as $$
  select coalesce(
    current_setting('aubos.context_kind', true) = expected_kind
    and current_setting('aubos.installation_id', true) = expected_installation
    and current_setting('vorton.workspace_id', true) = expected_workspace
    and current_setting('aubos.subject_id', true) = expected_subject
    and current_setting('aubos.context_signature', true) = encode(
      extensions.hmac(
        convert_to(
          txid_current()::text || '|' || expected_kind || '|' ||
          expected_installation || '|' || expected_workspace || '|' ||
          expected_subject || '|' ||
          coalesce(current_setting('aubos.credential_id', true), ''),
          'UTF8'
        ),
        context_key.secret,
        'sha256'
      ),
      'hex'
    ),
    false
  )
  from aubos_private.runtime_context_keys context_key
  where context_key.role_name = session_user
$$;

revoke all on function public.aubos_runtime_context_valid(text, text, text, text) from public;
grant execute on function public.aubos_runtime_context_valid(text, text, text, text)
  to authenticated, aubos_worker;

create function public.current_workspace_id() returns uuid
language sql stable
as $$
  select case
    when current_setting('vorton.workspace_id', true) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (
        public.aubos_runtime_context_valid(
          'person', current_setting('aubos.installation_id', true),
          current_setting('vorton.workspace_id', true),
          current_setting('aubos.subject_id', true)
        )
        or public.aubos_runtime_context_valid(
          'worker', current_setting('aubos.installation_id', true),
          current_setting('vorton.workspace_id', true),
          current_setting('aubos.subject_id', true)
        )
      )
    then current_setting('vorton.workspace_id', true)::uuid
    else null
  end
$$;

create or replace function public.current_installation_id() returns uuid
language sql stable
as $$
  select case
    when public.aubos_runtime_context_valid(
      current_setting('aubos.context_kind', true),
      current_setting('aubos.installation_id', true),
      current_setting('vorton.workspace_id', true),
      current_setting('aubos.subject_id', true)
    ) then nullif(current_setting('aubos.installation_id', true), '')::uuid
    else null
  end
$$;

create or replace function public.current_worker_id() returns uuid
language sql stable
as $$
  select case
    when public.aubos_runtime_context_valid(
      'worker', current_setting('aubos.installation_id', true),
      current_setting('vorton.workspace_id', true),
      current_setting('aubos.subject_id', true)
    ) then nullif(current_setting('aubos.subject_id', true), '')::uuid
    else null
  end
$$;

create function public.current_workspace_person_id(
  target_installation_id uuid,
  target_workspace_id uuid
) returns uuid
language sql stable security definer set search_path = public
as $$
  select person.id
  from public.people person
  join public.workspace_memberships membership
    on membership.installation_id = person.installation_id
   and membership.person_id = person.id
  where person.installation_id = target_installation_id
    and membership.workspace_id = target_workspace_id
    and person.auth_user_id = nullif(current_setting('aubos.subject_id', true), '')::uuid
    and (
      public.aubos_runtime_context_valid(
        'person', target_installation_id::text, target_workspace_id::text,
        current_setting('aubos.subject_id', true)
      )
      or public.aubos_runtime_context_valid(
        'person', '*', '*', current_setting('aubos.subject_id', true)
      )
    )
$$;

create function public.is_workspace_member(
  target_installation_id uuid,
  target_workspace_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_workspace_person_id(
    target_installation_id, target_workspace_id
  ) is not null
$$;

create function public.is_workspace_owner(
  target_installation_id uuid,
  target_workspace_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_memberships membership
    where membership.installation_id = target_installation_id
      and membership.workspace_id = target_workspace_id
      and membership.person_id = public.current_workspace_person_id(
        target_installation_id, target_workspace_id
      )
      and membership.kind = 'owner'
  )
$$;

create or replace function public.worker_has_capability(
  target_capability text,
  target_mode public.capability_mode,
  target_work_id uuid default null
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.capability_grants grant_row
    where grant_row.installation_id = public.current_installation_id()
      and grant_row.workspace_id = public.current_workspace_id()
      and grant_row.principal_kind = 'worker'
      and grant_row.worker_id = public.current_worker_id()
      and grant_row.capability = target_capability
      and grant_row.mode = target_mode
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (grant_row.work_id is null or grant_row.work_id = target_work_id)
      and not exists (
        select 1 from public.capability_grant_revocations revocation
        where revocation.installation_id = grant_row.installation_id
          and revocation.workspace_id = grant_row.workspace_id
          and revocation.grant_id = grant_row.id
      )
  )
$$;

create or replace function public.worker_can_read_classification(
  target_classification public.data_classification
) returns boolean
language sql stable security definer set search_path = public
as $$
  select case worker.data_classification_ceiling
    when 'restricted' then true
    when 'confidential' then target_classification in ('public', 'internal', 'confidential', 'synthetic')
    when 'internal' then target_classification in ('public', 'internal', 'synthetic')
    when 'public' then target_classification = 'public'
    when 'synthetic' then target_classification in ('public', 'synthetic')
    else false
  end
  from public.workers worker
  where worker.installation_id = public.current_installation_id()
    and worker.workspace_id = public.current_workspace_id()
    and worker.id = public.current_worker_id()
$$;

create or replace function public.worker_has_assigned_role(target_role_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.worker_role_assignments assignment
    where assignment.installation_id = public.current_installation_id()
      and assignment.workspace_id = public.current_workspace_id()
      and assignment.worker_id = public.current_worker_id()
      and assignment.role_id = target_role_id
  )
$$;

create or replace function public.worker_transition_work(
  target_work_id uuid,
  target_state public.work_state
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if target_state not in ('ready', 'blocked', 'review', 'cancelled') then
    raise exception 'Worker cannot transition Work to %', target_state;
  end if;
  update public.work
     set state = target_state, lease_expires_at = null
   where installation_id = public.current_installation_id()
     and workspace_id = public.current_workspace_id()
     and id = target_work_id
     and custodian_worker_id = public.current_worker_id();
  if not found then
    raise exception 'Worker does not hold custody of this Work';
  end if;
end
$$;

create or replace function public.validate_work_transition() returns trigger
language plpgsql
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'Work cannot move between workspaces';
  end if;
  if current_user = 'authenticated'
    and not public.is_workspace_owner(old.installation_id, old.workspace_id)
    and (
      new.installation_id is distinct from old.installation_id
      or new.title is distinct from old.title
      or new.requested_outcome is distinct from old.requested_outcome
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.priority is distinct from old.priority
      or new.parent_work_id is distinct from old.parent_work_id
      or new.requested_by_person_id is distinct from old.requested_by_person_id
      or new.custodian_person_id is distinct from old.custodian_person_id
      or new.custodian_worker_id is distinct from old.custodian_worker_id
      or new.lease_expires_at is distinct from old.lease_expires_at
    ) then
    raise exception 'Only a workspace owner may change Work authority or request fields';
  end if;
  if new.state = old.state then return new; end if;
  if not (
    (old.state = 'proposed' and new.state in ('ready', 'blocked', 'cancelled'))
    or (old.state = 'ready' and new.state in ('leased', 'blocked', 'cancelled'))
    or (old.state = 'leased' and new.state in ('ready', 'blocked', 'review', 'cancelled'))
    or (old.state = 'blocked' and new.state in ('ready', 'cancelled'))
    or (old.state = 'review' and new.state in ('leased', 'blocked', 'completed', 'cancelled'))
  ) then
    raise exception 'Invalid Work transition from % to %', old.state, new.state;
  end if;
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.council_work_revision_matches(
  target_work_id uuid,
  expected_updated_at timestamptz,
  expected_input_sha256 text
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.work work_row
     where work_row.installation_id = public.current_installation_id()
       and work_row.workspace_id = public.current_workspace_id()
       and work_row.id = target_work_id
       and work_row.updated_at = expected_updated_at
       and encode(extensions.digest(convert_to(jsonb_build_object(
         'id', work_row.id,
         'title', work_row.title,
         'requestedOutcome', work_row.requested_outcome,
         'acceptanceCriteria', work_row.acceptance_criteria,
         'state', work_row.state::text
       )::text, 'UTF8'), 'sha256'), 'hex') = expected_input_sha256
       and work_row.state in ('proposed', 'ready', 'blocked', 'review')
  )
$$;

create or replace function public.council_completed_run_matches(
  target_work_id uuid,
  target_role_id uuid,
  target_phase text,
  target_provider_job_id text,
  target_provider text,
  target_model text,
  target_input_record_ids jsonb,
  target_work_updated_at text,
  target_work_input_sha256 text
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.worker_runs run
     where run.installation_id = public.current_installation_id()
       and run.workspace_id = public.current_workspace_id()
       and run.work_id = target_work_id
       and run.worker_id = public.current_worker_id()
       and run.role_id = target_role_id
       and run.provider_job_id = target_provider_job_id
       and run.provider = target_provider
       and run.model = target_model
       and run.status = 'completed'
       and not run.store
       and not run.background
       and run.metadata ->> 'council_protocol' = 'vorton.executive-council.v1'
       and run.metadata ->> 'council_phase' = target_phase
       and run.metadata ->> 'council_role_id' = target_role_id::text
       and run.metadata -> 'input_record_ids' = target_input_record_ids
       and run.metadata ->> 'work_updated_at' = target_work_updated_at
       and run.metadata ->> 'work_input_sha256' = target_work_input_sha256
  )
$$;

create or replace function public.invalidate_memory_for_supersession() returns trigger
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
        and workspace_id = new.workspace_id
        and installation_realm = new.installation_realm
        and source_revision_id = invalidated_source_id
        and invalidated_at is null;
    update public.derived_memories memory
      set invalidated_at = new.ingested_at
      where memory.installation_id = new.installation_id
        and memory.workspace_id = new.workspace_id
        and memory.installation_realm = new.installation_realm
        and exists (
          select 1 from public.consolidation_lineage lineage
          where lineage.installation_id = memory.installation_id
            and lineage.workspace_id = memory.workspace_id
            and lineage.derived_memory_id = memory.id
            and lineage.source_revision_id = invalidated_source_id
        );
  end if;
  return new;
end
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

drop policy installations_member_select on public.installations;
drop policy people_member_select on public.people;
create policy installations_workspace_member_select on public.installations
  for select to authenticated using (
    exists (
      select 1 from public.workspaces workspace
      where workspace.installation_id = installations.id
        and public.is_workspace_member(workspace.installation_id, workspace.id)
    )
  );
create policy people_workspace_member_select on public.people
  for select to authenticated using (
    exists (
      select 1 from public.workspace_memberships membership
      where membership.installation_id = people.installation_id
        and membership.person_id = people.id
        and public.is_workspace_member(membership.installation_id, membership.workspace_id)
    )
  );
create policy workspaces_member_select on public.workspaces
  for select to authenticated using (
    public.is_workspace_member(installation_id, id)
  );
create policy workspace_memberships_member_select on public.workspace_memberships
  for select to authenticated using (
    public.is_workspace_member(installation_id, workspace_id)
  );

do $$
declare
  item record;
begin
  for item in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename not in ('installations', 'people', 'workspaces', 'workspace_memberships')
  loop
    execute format('drop policy %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
end
$$;

create policy workers_member_select on public.workers for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy workers_worker_select on public.workers for select to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and id = public.current_worker_id());
create policy workers_worker_update on public.workers for update to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and id = public.current_worker_id())
  with check (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and id = public.current_worker_id());

create policy roles_member_select on public.roles for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy roles_owner_insert on public.roles for insert to authenticated
  with check (public.is_workspace_owner(installation_id, workspace_id)
    and created_by_person_id = public.current_workspace_person_id(installation_id, workspace_id));
create policy worker_roles_member_select on public.worker_role_assignments for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy worker_roles_owner_insert on public.worker_role_assignments for insert to authenticated
  with check (public.is_workspace_owner(installation_id, workspace_id)
    and assigned_by_person_id = public.current_workspace_person_id(installation_id, workspace_id));

create policy work_member_select on public.work for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy work_member_insert on public.work for insert to authenticated
  with check (public.is_workspace_member(installation_id, workspace_id)
    and requested_by_person_id = public.current_workspace_person_id(installation_id, workspace_id));
create policy work_person_update on public.work for update to authenticated
  using (public.is_workspace_owner(installation_id, workspace_id)
    or custodian_person_id = public.current_workspace_person_id(installation_id, workspace_id))
  with check (public.is_workspace_member(installation_id, workspace_id));
create policy work_worker_select on public.work for select to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and custodian_worker_id = public.current_worker_id());
create policy work_dependencies_member_select on public.work_dependencies for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy work_dependencies_member_insert on public.work_dependencies for insert to authenticated
  with check (public.is_workspace_member(installation_id, workspace_id));

create policy policies_member_select on public.policies for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy policies_owner_insert on public.policies for insert to authenticated
  with check (public.is_workspace_owner(installation_id, workspace_id)
    and created_by_person_id = public.current_workspace_person_id(installation_id, workspace_id));
create policy grants_member_select on public.capability_grants for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy grants_worker_select on public.capability_grants for select to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and principal_kind = 'worker' and worker_id = public.current_worker_id());
create policy grants_owner_insert on public.capability_grants for insert to authenticated
  with check (public.is_workspace_owner(installation_id, workspace_id)
    and granted_by_person_id = public.current_workspace_person_id(installation_id, workspace_id));
create policy grant_revocations_member_select on public.capability_grant_revocations for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy grant_revocations_owner_insert on public.capability_grant_revocations for insert to authenticated
  with check (public.is_workspace_owner(installation_id, workspace_id)
    and revoked_by_person_id = public.current_workspace_person_id(installation_id, workspace_id));

create policy records_member_select on public.records for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy records_person_insert on public.records for insert to authenticated
  with check (public.is_workspace_member(installation_id, workspace_id)
    and actor_person_id = public.current_workspace_person_id(installation_id, workspace_id)
    and actor_worker_id is null
    and (kind not in ('approval', 'decision') or public.is_workspace_owner(installation_id, workspace_id)));
create policy records_worker_select on public.records for select to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and public.worker_can_read_classification(classification)
    and (actor_worker_id = public.current_worker_id() or exists (
      select 1 from public.work work_row
      where work_row.installation_id = records.installation_id
        and work_row.workspace_id = records.workspace_id
        and work_row.id = records.work_id
        and work_row.custodian_worker_id = public.current_worker_id()
    )));
create policy records_worker_insert on public.records for insert to aubos_worker
  with check (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and actor_worker_id = public.current_worker_id()
    and actor_person_id is null
    and kind not in ('approval', 'decision')
    and supersedes_record_id is null
    and public.worker_can_read_classification(classification)
    and ((kind = 'review' and public.worker_has_capability('executive.review', 'recommend', work_id))
      or (kind <> 'review' and (kind <> 'proposal'
        or public.worker_has_capability('executive.propose', 'recommend', work_id))))
    and (not (payload ? 'councilProtocol')
      or (
        public.worker_has_assigned_role((payload ->> 'councilRoleId')::uuid)
        and public.council_work_revision_matches(
          work_id,
          (payload ->> 'workUpdatedAt')::timestamptz,
          payload ->> 'workInputSha256'
        )
        and public.council_completed_run_matches(
          work_id,
          (payload ->> 'councilRoleId')::uuid,
          payload ->> 'councilPhase',
          payload #>> '{providerJob,id}',
          payload #>> '{providerJob,provider}',
          payload #>> '{providerJob,model}',
          payload -> 'inputRecordIds',
          payload ->> 'workUpdatedAt',
          payload ->> 'workInputSha256'
        )
      )));

create policy worker_runs_member_select on public.worker_runs for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));
create policy worker_runs_worker_select on public.worker_runs for select to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and worker_id = public.current_worker_id());
create policy worker_runs_worker_insert on public.worker_runs for insert to aubos_worker
  with check (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and worker_id = public.current_worker_id()
    and public.worker_has_assigned_role(role_id)
    and (not (metadata ? 'council_protocol')
      or public.council_work_revision_matches(
        work_id,
        (metadata ->> 'work_updated_at')::timestamptz,
        metadata ->> 'work_input_sha256'
      ))
    and ((metadata ->> 'council_phase' = 'review'
      and public.worker_has_capability('executive.review', 'recommend', work_id))
      or (coalesce(metadata ->> 'council_phase', 'proposal') <> 'review'
      and public.worker_has_capability('executive.propose', 'recommend', work_id))));
create policy worker_runs_worker_update on public.worker_runs for update to aubos_worker
  using (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and worker_id = public.current_worker_id()
    and (public.worker_has_capability('executive.propose', 'recommend', work_id)
      or public.worker_has_capability('executive.review', 'recommend', work_id)))
  with check (installation_id = public.current_installation_id()
    and workspace_id = public.current_workspace_id()
    and worker_id = public.current_worker_id());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_connections', 'transcript_revisions', 'transcript_utterances',
    'source_citations', 'memory_banks', 'memory_candidates', 'derived_memories',
    'consolidation_lineage', 'retrieval_receipts', 'retrieval_receipt_results'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(installation_id, workspace_id))',
      table_name || '_workspace_member_select', table_name
    );
  end loop;
end
$$;

grant select on public.workspaces, public.workspace_memberships to authenticated;

comment on constraint workers_workspace_assigned on public.workers is
  'NOT VALID preserves unknown legacy rows while enforcing explicit workspace assignment for every new row.';

commit;
