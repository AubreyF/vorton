begin;

create table public.workspace_membership_revocations (
  installation_id uuid not null,
  workspace_id uuid not null,
  person_id uuid not null,
  revoked_by_person_id uuid not null,
  revoked_at timestamptz not null default clock_timestamp(),
  constraint workspace_membership_revocations_membership_fk
    foreign key (installation_id, workspace_id, person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id)
    on delete restrict,
  constraint workspace_membership_revocations_actor_fk
    foreign key (installation_id, workspace_id, revoked_by_person_id)
    references public.workspace_memberships(installation_id, workspace_id, person_id)
    on delete restrict,
  primary key (installation_id, workspace_id, person_id)
);

comment on table public.workspace_membership_revocations is
  'Append-only live revocation ledger. Historical workspace memberships remain addressable by existing authority and audit foreign keys, but a revoked membership grants no current access.';

create function public.reject_workspace_membership_revocation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Workspace membership revocations are append-only';
end
$$;

create trigger workspace_membership_revocations_append_only
before update or delete on public.workspace_membership_revocations
for each row execute function public.reject_workspace_membership_revocation_mutation();

create function public.workspace_membership_is_live(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_person_id uuid
) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.workspace_memberships membership
     where membership.installation_id = target_installation_id
       and membership.workspace_id = target_workspace_id
       and membership.person_id = target_person_id
       and not exists (
         select 1
           from public.workspace_membership_revocations revocation
          where revocation.installation_id = membership.installation_id
            and revocation.workspace_id = membership.workspace_id
            and revocation.person_id = membership.person_id
       )
  )
$$;

create or replace function public.current_workspace_person_id(
  target_installation_id uuid,
  target_workspace_id uuid
) returns uuid
language sql stable security definer set search_path = pg_catalog, public
as $$
  select person.id
  from public.people person
  join public.workspace_memberships membership
    on membership.installation_id = person.installation_id
   and membership.person_id = person.id
  where person.installation_id = target_installation_id
    and membership.workspace_id = target_workspace_id
    and person.auth_user_id = nullif(current_setting('aubos.subject_id', true), '')::uuid
    and public.workspace_membership_is_live(
      membership.installation_id, membership.workspace_id,
      membership.person_id
    )
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

create or replace function public.vorton_workspace_step_up_context_valid(
  expected_installation text,
  expected_workspace text,
  expected_subject text,
  approved_at timestamptz
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, extensions, aubos_private
as $$
  select coalesce(
    expected_installation
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and expected_workspace
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and expected_subject
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and current_setting('vorton.context_kind', true) = 'person'
    and current_setting('vorton.installation_id', true) = expected_installation
    and current_setting('vorton.workspace_id', true) = expected_workspace
    and current_setting('vorton.subject_id', true) = expected_subject
    and current_setting('vorton.credential_id', true) = ''
    and current_setting('vorton.context_signature', true) = encode(
      extensions.hmac(
        convert_to(
          txid_current()::text || '|person|' || expected_installation || '|' ||
          expected_workspace || '|' || expected_subject || '|',
          'UTF8'
        ),
        context_key.secret,
        'sha256'
      ),
      'hex'
    )
    and current_setting('vorton.workspace_step_up_aal', true) = 'aal2'
    and case
      when current_setting('vorton.workspace_step_up_auth_time', true)
        ~ '^[0-9]{10}$'
      then
        to_timestamp(
          current_setting('vorton.workspace_step_up_auth_time', true)::bigint
        ) <= approved_at
        and approved_at <= to_timestamp(
          current_setting('vorton.workspace_step_up_auth_time', true)::bigint
        ) + interval '10 minutes'
      else false
    end
    and current_setting('vorton.workspace_step_up_signature', true) = encode(
      extensions.hmac(
        convert_to(
          txid_current()::text || '|workspace-person|' ||
          expected_installation || '|' || expected_workspace || '|' ||
          expected_subject || '|aal2|' ||
          current_setting('vorton.workspace_step_up_auth_time', true),
          'UTF8'
        ),
        context_key.secret,
        'sha256'
      ),
      'hex'
    )
    and exists (
      select 1
        from public.people person
        join public.workspace_memberships membership
          on membership.installation_id = person.installation_id
         and membership.person_id = person.id
       where person.installation_id = expected_installation::uuid
         and membership.workspace_id = expected_workspace::uuid
         and person.auth_user_id = expected_subject::uuid
         and public.workspace_membership_is_live(
           membership.installation_id,
           membership.workspace_id,
           membership.person_id
         )
    ),
    false
  )
  from aubos_private.runtime_context_keys context_key
  where context_key.role_name = session_user
$$;

create function public.revoke_workspace_membership(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_person_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_person_id uuid;
  target_kind public.person_kind;
  active_owner_count integer;
  evaluated_at timestamptz;
  subject_text text := current_setting('aubos.subject_id', true);
begin
  perform 1
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
   for update;
  if not found then
    raise exception 'Target workspace does not exist';
  end if;

  evaluated_at := date_trunc('milliseconds', clock_timestamp());
  if subject_text is null
     or not public.vorton_workspace_step_up_context_valid(
       target_installation_id::text,
       target_workspace_id::text,
       subject_text,
       evaluated_at
     ) then
    raise exception 'Recent signed workspace-owner AAL2 is required';
  end if;

  actor_person_id := public.current_workspace_person_id(
    target_installation_id, target_workspace_id
  );
  if actor_person_id is null
     or not public.is_workspace_owner(
       target_installation_id, target_workspace_id
     ) then
    raise exception 'A live workspace owner is required';
  end if;

  select membership.kind
    into target_kind
    from public.workspace_memberships membership
   where membership.installation_id = target_installation_id
     and membership.workspace_id = target_workspace_id
     and membership.person_id = target_person_id
   for update;
  if target_kind is null then
    raise exception 'Target workspace membership does not exist';
  end if;

  if exists (
    select 1
      from public.workspace_membership_revocations revocation
     where revocation.installation_id = target_installation_id
       and revocation.workspace_id = target_workspace_id
       and revocation.person_id = target_person_id
  ) then
    return;
  end if;

  if target_kind = 'owner' then
    select count(*)
      into active_owner_count
      from public.workspace_memberships membership
     where membership.installation_id = target_installation_id
       and membership.workspace_id = target_workspace_id
       and membership.kind = 'owner'
       and not exists (
         select 1
           from public.workspace_membership_revocations revocation
          where revocation.installation_id = membership.installation_id
            and revocation.workspace_id = membership.workspace_id
            and revocation.person_id = membership.person_id
       );
    if active_owner_count <= 1 then
      raise exception 'The final live workspace owner cannot be revoked';
    end if;
  end if;

  insert into public.workspace_membership_revocations (
    installation_id, workspace_id, person_id, revoked_by_person_id
  ) values (
    target_installation_id, target_workspace_id, target_person_id,
    actor_person_id
  );
end
$$;

alter table public.workspace_membership_revocations enable row level security;

revoke all on table public.workspace_membership_revocations
from public, anon, authenticated, aubos_worker;
revoke all on function public.reject_workspace_membership_revocation_mutation()
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_membership_is_live(uuid, uuid, uuid)
from public, anon, authenticated, aubos_worker;
revoke all on function public.revoke_workspace_membership(uuid, uuid, uuid)
from public, anon, authenticated, aubos_worker;

comment on function public.revoke_workspace_membership(uuid, uuid, uuid) is
  'Administrator-only hostile-proof primitive. Product membership revocation requires a separate governed Work, capability, approval, and receipt contract.';

create function public.require_live_module_lifecycle_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1
    from public.workspaces workspace
   where workspace.installation_id = new.installation_id
     and workspace.id = new.workspace_id
   for share;
  if not found then
    raise exception 'Module lifecycle workspace does not exist';
  end if;

  if not exists (
    select 1
      from public.workspace_memberships membership
     where membership.installation_id = new.installation_id
       and membership.workspace_id = new.workspace_id
       and membership.person_id = new.owner_person_id
       and membership.kind = 'owner'
       and public.workspace_membership_is_live(
         membership.installation_id,
         membership.workspace_id,
         membership.person_id
       )
  ) then
    raise exception 'Live original owner membership is required for lifecycle transition';
  end if;
  return new;
end
$$;

create trigger module_lifecycle_approvals_require_live_owner
before insert on public.module_lifecycle_action_approvals
for each row execute function public.require_live_module_lifecycle_owner();

create trigger module_lifecycle_commands_require_live_owner
before insert on public.module_lifecycle_action_commands
for each row execute function public.require_live_module_lifecycle_owner();

create trigger module_lifecycle_receipts_require_live_owner
before insert on public.module_lifecycle_action_receipts
for each row execute function public.require_live_module_lifecycle_owner();

create function public.assert_live_module_lifecycle_approval_owner(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_approval_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  worker_text text := current_setting('aubos.subject_id', true);
  owner_id uuid;
begin
  if worker_text is null
     or not public.aubos_runtime_context_valid(
       'worker', target_installation_id::text, target_workspace_id::text,
       worker_text
     ) then
    raise exception 'Signed worker context is required for lifecycle owner check';
  end if;

  perform 1
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
   for share;
  if not found then
    raise exception 'Module lifecycle workspace does not exist';
  end if;

  select approval.owner_person_id
    into owner_id
    from public.module_lifecycle_action_approvals approval
   where approval.installation_id = target_installation_id
     and approval.workspace_id = target_workspace_id
     and approval.approval_id = target_approval_id;
  if owner_id is null
     or not exists (
       select 1
         from public.workspace_memberships membership
        where membership.installation_id = target_installation_id
          and membership.workspace_id = target_workspace_id
          and membership.person_id = owner_id
          and membership.kind = 'owner'
          and public.workspace_membership_is_live(
            membership.installation_id,
            membership.workspace_id,
            membership.person_id
          )
     ) then
    raise exception 'Live original owner membership is required for lifecycle transition';
  end if;
end
$$;

create function public.assert_live_module_lifecycle_command_owner(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_command_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  approval_id_value uuid;
begin
  select command.approval_id
    into approval_id_value
    from public.module_lifecycle_action_commands command
   where command.installation_id = target_installation_id
     and command.workspace_id = target_workspace_id
     and command.command_id = target_command_id;
  if approval_id_value is null then
    raise exception 'Exact lifecycle action command is unavailable to this worker';
  end if;
  perform public.assert_live_module_lifecycle_approval_owner(
    target_installation_id, target_workspace_id, approval_id_value
  );
end
$$;

revoke all on function public.require_live_module_lifecycle_owner()
from public, anon, authenticated, aubos_worker;
revoke all on function public.assert_live_module_lifecycle_approval_owner(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.assert_live_module_lifecycle_approval_owner(
  uuid, uuid, uuid
) to aubos_worker;
revoke all on function public.assert_live_module_lifecycle_command_owner(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.assert_live_module_lifecycle_command_owner(
  uuid, uuid, uuid
) to aubos_worker;

create function public.consume_module_lifecycle_action_approval_live(
  target_command_id uuid,
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  target_work_id uuid,
  exact_proof_scope text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A completed command is immutable reconciliation. Every transition that
  -- could still create a command or receipt must share the workspace lock
  -- domain with membership revocation and recheck the original owner.
  if not exists (
    select 1
      from public.module_lifecycle_action_receipts receipt
     where receipt.installation_id = target_installation_id
       and receipt.workspace_id = target_workspace_id
       and receipt.command_id = target_command_id
  ) then
    perform public.assert_live_module_lifecycle_approval_owner(
      target_installation_id, target_workspace_id, target_approval_id
    );
  end if;

  return public.consume_module_lifecycle_action_approval(
    target_command_id,
    target_approval_id,
    target_installation_id,
    target_workspace_id,
    target_work_id,
    exact_proof_scope
  );
end
$$;

create function public.finalize_module_lifecycle_action_live(
  target_receipt_id uuid,
  target_command_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  exact_outcome jsonb,
  exact_effects jsonb,
  exact_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Exact immutable receipt replay is read-only. First finalization remains a
  -- privileged transition and is serialized against owner revocation.
  if not exists (
    select 1
      from public.module_lifecycle_action_receipts receipt
     where receipt.installation_id = target_installation_id
       and receipt.workspace_id = target_workspace_id
       and receipt.command_id = target_command_id
       and receipt.receipt_id = target_receipt_id
  ) then
    perform public.assert_live_module_lifecycle_command_owner(
      target_installation_id, target_workspace_id, target_command_id
    );
  end if;

  return public.finalize_module_lifecycle_action(
    target_receipt_id,
    target_command_id,
    target_installation_id,
    target_workspace_id,
    exact_outcome,
    exact_effects,
    exact_evidence
  );
end
$$;

revoke all on function public.consume_module_lifecycle_action_approval(
  uuid, uuid, uuid, uuid, uuid, text
) from aubos_worker;
revoke all on function public.finalize_module_lifecycle_action(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) from aubos_worker;
revoke all on function public.consume_module_lifecycle_action_approval_live(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.consume_module_lifecycle_action_approval_live(
  uuid, uuid, uuid, uuid, uuid, text
) to aubos_worker;
revoke all on function public.finalize_module_lifecycle_action_live(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_module_lifecycle_action_live(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) to aubos_worker;

revoke update (data_classification_ceiling)
on public.workers from aubos_worker;

create or replace function public.worker_can_read_classification(
  target_classification public.data_classification
) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$
  select case worker.data_classification_ceiling
    when 'restricted' then true
    when 'confidential' then
      target_classification in ('public', 'internal', 'confidential', 'synthetic')
    when 'internal' then
      target_classification in ('public', 'internal', 'synthetic')
    when 'public' then target_classification in ('public', 'synthetic')
    when 'synthetic' then target_classification = 'synthetic'
    else false
  end
  from public.workers worker
  where worker.installation_id = public.current_installation_id()
    and worker.workspace_id = public.current_workspace_id()
    and worker.id = public.current_worker_id()
$$;

create type public.context_gateway_operation as enum (
  'retain', 'consolidate', 'retrieve', 'invalidate'
);

create function public.resolve_context_gateway_memory_bank(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_operation public.context_gateway_operation,
  target_work_id uuid default null
) returns table (
  external_bank_id text,
  installation_realm public.installation_realm,
  principal_kind public.principal_kind,
  principal_id uuid,
  context_subject_id uuid,
  capability_grant_id uuid,
  capability text,
  capability_mode public.capability_mode,
  data_classification_ceiling public.data_classification
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  evaluated_at timestamptz := clock_timestamp();
  context_kind_value text := current_setting('aubos.context_kind', true);
  subject_value text := current_setting('aubos.subject_id', true);
  credential_value text := current_setting('aubos.credential_id', true);
  required_capability text;
  required_mode public.capability_mode;
  actor_kind public.principal_kind;
  actor_id uuid;
  credential_id_value uuid;
  grant_id_value uuid;
  bank_external_id text;
  bank_realm public.installation_realm;
  classification_ceiling_value public.data_classification;
begin
  if target_installation_id is null
     or target_workspace_id is null
     or target_operation is null then
    return;
  end if;

  required_capability := case target_operation
    when 'retrieve' then 'memory.retrieve'
    when 'retain' then 'memory.retain'
    when 'consolidate' then 'memory.consolidate'
    when 'invalidate' then 'memory.invalidate'
  end;
  required_mode := case target_operation
    when 'retrieve' then 'observe'::public.capability_mode
    else 'modify'::public.capability_mode
  end;

  if target_work_id is not null and not exists (
    select 1
    from public.work work_row
    where work_row.installation_id = target_installation_id
      and work_row.workspace_id = target_workspace_id
      and work_row.id = target_work_id
  ) then
    return;
  end if;

  if subject_value is null or subject_value !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;

  if context_kind_value = 'person' then
    if not public.aubos_runtime_context_valid(
      'person', target_installation_id::text, target_workspace_id::text,
      subject_value
    ) then
      return;
    end if;

    actor_id := public.current_workspace_person_id(
      target_installation_id, target_workspace_id
    );
    if actor_id is null then
      return;
    end if;
    actor_kind := 'person';
    classification_ceiling_value := 'restricted';

    select grant_row.id
      into grant_id_value
      from public.capability_grants grant_row
      where grant_row.installation_id = target_installation_id
        and grant_row.workspace_id = target_workspace_id
        and grant_row.principal_kind = 'person'
        and grant_row.person_id = actor_id
        and grant_row.capability = required_capability
        and grant_row.mode = required_mode
        and grant_row.granted_at <= evaluated_at
        and (grant_row.expires_at is null or grant_row.expires_at > evaluated_at)
        and (grant_row.work_id is null or grant_row.work_id = target_work_id)
        and not exists (
          select 1
          from public.capability_grant_revocations revocation
          where revocation.installation_id = grant_row.installation_id
            and revocation.workspace_id = grant_row.workspace_id
            and revocation.grant_id = grant_row.id
        )
      order by grant_row.id
      limit 1;
  elsif context_kind_value = 'worker' then
    if credential_value is null
       or credential_value !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not public.aubos_runtime_context_valid(
         'worker', target_installation_id::text, target_workspace_id::text,
         subject_value
       ) then
      return;
    end if;

    actor_id := public.current_worker_id();
    credential_id_value := credential_value::uuid;
    if actor_id is null then
      return;
    end if;
    select worker.data_classification_ceiling
      into classification_ceiling_value
      from public.worker_credentials credential
      join public.workers worker
        on worker.installation_id = credential.installation_id
       and worker.workspace_id = credential.workspace_id
       and worker.id = credential.worker_id
      where credential.installation_id = target_installation_id
        and credential.workspace_id = target_workspace_id
        and credential.worker_id = actor_id
        and credential.id = credential_id_value
        and credential.issued_at <= evaluated_at
        and credential.expires_at > evaluated_at
        and not exists (
          select 1
          from public.worker_credential_revocations revocation
          where revocation.installation_id = credential.installation_id
            and revocation.workspace_id = credential.workspace_id
            and revocation.credential_id = credential.id
        )
      limit 1;
    if classification_ceiling_value is null then
      return;
    end if;
    actor_kind := 'worker';

    select grant_row.id
      into grant_id_value
      from public.capability_grants grant_row
      where grant_row.installation_id = target_installation_id
        and grant_row.workspace_id = target_workspace_id
        and grant_row.principal_kind = 'worker'
        and grant_row.worker_id = actor_id
        and grant_row.capability = required_capability
        and grant_row.mode = required_mode
        and grant_row.granted_at <= evaluated_at
        and (grant_row.expires_at is null or grant_row.expires_at > evaluated_at)
        and (grant_row.work_id is null or grant_row.work_id = target_work_id)
        and not exists (
          select 1
          from public.capability_grant_revocations revocation
          where revocation.installation_id = grant_row.installation_id
            and revocation.workspace_id = grant_row.workspace_id
            and revocation.grant_id = grant_row.id
        )
      order by grant_row.id
      limit 1;
  else
    return;
  end if;

  if grant_id_value is null then
    return;
  end if;

  select bank.external_bank_id, workspace.realm
    into bank_external_id, bank_realm
  from public.workspaces workspace
  join public.memory_banks bank
    on bank.installation_id = workspace.installation_id
   and bank.workspace_id = workspace.id
   and bank.installation_realm = workspace.realm
  where workspace.installation_id = target_installation_id
    and workspace.id = target_workspace_id
    and bank.adapter = 'hindsight'
    and bank.external_bank_id =
      workspace.realm::text || ':' || target_installation_id::text || ':'
      || target_workspace_id::text || ':lineage-v2';

  if bank_external_id is null then
    return;
  end if;

  external_bank_id := bank_external_id;
  installation_realm := bank_realm;
  principal_kind := actor_kind;
  principal_id := actor_id;
  context_subject_id := subject_value::uuid;
  capability_grant_id := grant_id_value;
  capability := required_capability;
  capability_mode := required_mode;
  data_classification_ceiling := classification_ceiling_value;
  return next;
end
$$;

comment on function public.resolve_context_gateway_memory_bank(
  uuid, uuid, public.context_gateway_operation, uuid
) is
  'Read-only Context Gateway authorization. PostgreSQL resolves live principal, credential, capability, workspace realm, and canonical Hindsight bank identity. The function creates no bank, memory, receipt, or external effect.';

revoke all on function public.resolve_context_gateway_memory_bank(
  uuid, uuid, public.context_gateway_operation, uuid
) from public, anon;
grant execute on function public.resolve_context_gateway_memory_bank(
  uuid, uuid, public.context_gateway_operation, uuid
) to authenticated, aubos_worker;

create function public.resolve_context_gateway_source_material(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_realm public.installation_realm,
  target_work_id uuid,
  target_source_revision_ids uuid[]
) returns table (
  source_revision_id uuid,
  classification public.data_classification,
  source_uri text,
  revision_hash text,
  locator text,
  external_bank_id text,
  data_classification_ceiling public.data_classification
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  authority_record record;
begin
  if target_installation_id is null
     or target_workspace_id is null
     or target_realm is null
     or target_source_revision_ids is null
     or cardinality(target_source_revision_ids) = 0
     or cardinality(target_source_revision_ids) > 256
     or array_position(target_source_revision_ids, null) is not null
     or (
       select count(distinct source_id)
       from unnest(target_source_revision_ids) source_id
     ) <> cardinality(target_source_revision_ids) then
    return;
  end if;

  select * into authority_record
  from public.resolve_context_gateway_memory_bank(
    target_installation_id,
    target_workspace_id,
    'retrieve'::public.context_gateway_operation,
    target_work_id
  );
  if not found or authority_record.installation_realm <> target_realm then
    return;
  end if;

  return query
  select revision.id,
         revision.classification,
         citation.source_uri,
         citation.revision_hash,
         citation.locator,
         authority_record.external_bank_id,
         authority_record.data_classification_ceiling
    from public.transcript_revisions revision
    join public.memory_candidates candidate
      on candidate.installation_id = revision.installation_id
     and candidate.workspace_id = revision.workspace_id
     and candidate.installation_realm = revision.installation_realm
     and candidate.source_revision_id = revision.id
     and candidate.admission_state = 'admitted'
    join public.memory_banks bank
      on bank.installation_id = candidate.installation_id
     and bank.workspace_id = candidate.workspace_id
     and bank.installation_realm = candidate.installation_realm
     and bank.id = candidate.bank_id
     and bank.adapter = 'hindsight'
     and bank.external_bank_id = authority_record.external_bank_id
    join public.source_citations citation
      on citation.installation_id = revision.installation_id
     and citation.workspace_id = revision.workspace_id
     and citation.installation_realm = revision.installation_realm
     and citation.transcript_revision_id = revision.id
   where revision.installation_id = target_installation_id
     and revision.workspace_id = target_workspace_id
     and revision.installation_realm = target_realm
     and revision.id = any(target_source_revision_ids)
     and revision.deleted_at is null
     and revision.boundary = target_realm::text::public.source_boundary
     and revision.admission_state = 'admitted'
     and case authority_record.data_classification_ceiling
       when 'restricted'::public.data_classification then true
       when 'confidential'::public.data_classification then
         revision.classification in ('public', 'internal', 'confidential', 'synthetic')
       when 'internal'::public.data_classification then
         revision.classification in ('public', 'internal', 'synthetic')
       when 'public'::public.data_classification then
         revision.classification in ('public', 'synthetic')
       when 'synthetic'::public.data_classification then
         revision.classification = 'synthetic'
     end
     and not exists (
       select 1
       from public.transcript_revisions successor
       where successor.installation_id = revision.installation_id
         and successor.workspace_id = revision.workspace_id
         and successor.installation_realm = revision.installation_realm
         and successor.supersedes_revision_id = revision.id
     )
   order by revision.id, citation.locator;
end
$$;

comment on function public.resolve_context_gateway_source_material(
  uuid, uuid, public.installation_realm, uuid, uuid[]
) is
  'Read-only, capability-gated source provenance for Context Gateway retrieval. The projection exposes no transcript text, storage locator, credential, Policy, approval, or authority mutation surface.';

revoke all on function public.resolve_context_gateway_source_material(
  uuid, uuid, public.installation_realm, uuid, uuid[]
) from public, anon;
grant execute on function public.resolve_context_gateway_source_material(
  uuid, uuid, public.installation_realm, uuid, uuid[]
) to authenticated, aubos_worker;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_connections', 'transcript_revisions', 'transcript_utterances',
    'source_citations', 'memory_banks', 'memory_candidates', 'derived_memories',
    'consolidation_lineage', 'retrieval_receipts',
    'retrieval_receipt_results'
  ] loop
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_member_select', table_name
    );
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_workspace_member_select', table_name
    );
  end loop;
end
$$;

drop policy if exists retrieval_results_member_select
on public.retrieval_receipt_results;

revoke select on public.source_connections, public.transcript_revisions,
  public.transcript_utterances, public.source_citations, public.memory_banks,
  public.memory_candidates, public.derived_memories,
  public.consolidation_lineage, public.retrieval_receipts,
  public.retrieval_receipt_results from authenticated;

comment on type public.context_gateway_operation is
  'Direct authenticated reads of memory tables are forbidden. Server code must use capability-gated Context Gateway projections and must never expose database or object locators through membership alone.';

commit;
