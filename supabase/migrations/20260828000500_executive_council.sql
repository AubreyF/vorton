begin;

create or replace function public.worker_has_assigned_role(
  target_role_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.worker_role_assignments assignment
     where assignment.installation_id = public.current_installation_id()
       and assignment.worker_id = public.current_worker_id()
       and assignment.role_id = target_role_id
  )
$$;

revoke all on function public.worker_has_assigned_role(uuid) from public;
grant execute on function public.worker_has_assigned_role(uuid) to aubos_worker;

alter table public.records
  add constraint records_council_contribution_shape check (
    not (payload ? 'councilProtocol')
    or (
      payload ->> 'councilProtocol' = 'vorton.executive-council.v1'
      and work_id is not null
      and actor_worker_id is not null
      and actor_person_id is null
      and supersedes_record_id is null
      and payload ->> 'authority' = 'none'
      and (payload ->> 'councilRoleId') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(payload -> 'inputRecordIds') = 'array'
      and jsonb_array_length(payload -> 'inputRecordIds') between 1 and 32
      and jsonb_typeof(payload -> 'evidenceRecordIds') = 'array'
      and jsonb_array_length(payload -> 'evidenceRecordIds') between 1 and 20
      and jsonb_typeof(payload -> 'peerRecordIds') = 'array'
      and jsonb_array_length(payload -> 'peerRecordIds') between 0 and 10
      and jsonb_typeof(payload -> 'providerJob') = 'object'
      and payload #>> '{providerJob,store}' = 'false'
      and payload #>> '{providerJob,background}' = 'false'
      and (payload ->> 'workUpdatedAt')::timestamptz is not null
      and (payload ->> 'workInputSha256') ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(payload -> 'recommendation') = 'object'
      and (
        (kind = 'proposal' and payload ->> 'councilPhase' in ('proposal', 'synthesis'))
        or (kind = 'review' and payload ->> 'councilPhase' = 'review')
      )
    )
  );

create unique index records_council_phase_role_fence
  on public.records (
    installation_id,
    work_id,
    (payload ->> 'councilProtocol'),
    (payload ->> 'councilPhase'),
    (payload ->> 'councilRoleId')
  )
  where payload ->> 'councilProtocol' = 'vorton.executive-council.v1';

alter table public.worker_runs
  add constraint worker_runs_council_context_shape check (
    not (metadata ? 'council_protocol')
    or (
      metadata ->> 'council_protocol' = 'vorton.executive-council.v1'
      and metadata ->> 'authority' = 'none'
      and metadata ->> 'council_phase' in ('proposal', 'review', 'synthesis')
      and (metadata ->> 'council_role_id') ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and jsonb_typeof(metadata -> 'input_record_ids') = 'array'
      and jsonb_array_length(metadata -> 'input_record_ids') between 1 and 32
      and (metadata ->> 'work_updated_at')::timestamptz is not null
      and (metadata ->> 'work_input_sha256') ~ '^[a-f0-9]{64}$'
      and not store
      and not background
    )
  );

create unique index worker_runs_council_active_phase_role_fence
  on public.worker_runs (
    installation_id,
    work_id,
    (metadata ->> 'council_protocol'),
    (metadata ->> 'council_phase'),
    (metadata ->> 'council_role_id')
  )
  where metadata ->> 'council_protocol' = 'vorton.executive-council.v1'
    and status in ('queued', 'in_progress', 'completed');

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

revoke all on function public.council_work_revision_matches(uuid, timestamptz, text) from public;
grant execute on function public.council_work_revision_matches(uuid, timestamptz, text) to aubos_worker;

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

revoke all on function public.council_completed_run_matches(
  uuid, uuid, text, text, text, text, jsonb, text, text
) from public;
grant execute on function public.council_completed_run_matches(
  uuid, uuid, text, text, text, text, jsonb, text, text
) to aubos_worker;

drop policy if exists records_worker_insert on public.records;
create policy records_worker_insert on public.records for insert to aubos_worker
  with check (
    installation_id = public.current_installation_id()
    and actor_worker_id = public.current_worker_id()
    and actor_person_id is null
    and kind not in ('approval', 'decision')
    and supersedes_record_id is null
    and public.worker_can_read_classification(classification)
    and (
      (kind = 'review'
        and public.worker_has_capability('executive.review', 'recommend', work_id))
      or (kind <> 'review' and (
        kind <> 'proposal'
        or public.worker_has_capability('executive.propose', 'recommend', work_id)
      ))
    )
    and (
      not (payload ? 'councilProtocol')
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
      )
    )
  );

drop policy if exists worker_runs_worker_insert on public.worker_runs;
create policy worker_runs_worker_insert on public.worker_runs for insert to aubos_worker
  with check (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
    and public.worker_has_assigned_role(role_id)
    and (
      not (metadata ? 'council_protocol')
      or public.council_work_revision_matches(
        work_id,
        (metadata ->> 'work_updated_at')::timestamptz,
        metadata ->> 'work_input_sha256'
      )
    )
    and (
      (metadata ->> 'council_phase' = 'review'
        and public.worker_has_capability('executive.review', 'recommend', work_id))
      or (coalesce(metadata ->> 'council_phase', 'proposal') <> 'review'
        and public.worker_has_capability('executive.propose', 'recommend', work_id))
    )
  );

drop policy if exists worker_runs_worker_update on public.worker_runs;
create policy worker_runs_worker_update on public.worker_runs for update to aubos_worker
  using (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
    and (
      public.worker_has_capability('executive.propose', 'recommend', work_id)
      or public.worker_has_capability('executive.review', 'recommend', work_id)
    )
  )
  with check (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
  );

comment on index public.records_council_phase_role_fence is
  'Exactly one durable advisory contribution per council phase and role.';

comment on index public.worker_runs_council_active_phase_role_fence is
  'One queued, in-progress, or completed provider attempt per council phase and role.';

grant update (provider_job_id) on public.worker_runs to aubos_worker;

commit;
