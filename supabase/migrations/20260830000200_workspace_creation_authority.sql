begin;

create function public.vorton_canonical_jsonb(value jsonb)
returns text
language sql immutable strict
set search_path = pg_catalog
as $$
  select case jsonb_typeof(value)
    when 'object' then '{' || coalesce((
      select string_agg(to_jsonb(entry.key)::text || ':' || public.vorton_canonical_jsonb(entry.value), ',' order by entry.key collate "C")
      from jsonb_each(value) entry
    ), '') || '}'
    when 'array' then '[' || coalesce((
      select string_agg(public.vorton_canonical_jsonb(entry.value), ',' order by entry.ordinality)
      from jsonb_array_elements(value) with ordinality entry(value, ordinality)
    ), '') || ']'
    else value::text
  end
$$;

create function public.vorton_release_adoption_release_valid(value jsonb)
returns boolean
language sql immutable strict
set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
    and (select count(*) from jsonb_object_keys(value)) = 8
    and value ?& array[
      'version', 'sourceCommit', 'manifestSha256', 'archiveSha256',
      'coreMigrationHead', 'workspaceIsolationProofSha256',
      'workspaceIsolationProofHash', 'imageDigests'
    ]
    and jsonb_typeof(value->'version') = 'string'
    and length(value->>'version') > 0
    and jsonb_typeof(value->'sourceCommit') = 'string'
    and value->>'sourceCommit' ~ '^[a-f0-9]{40}$'
    and value->>'manifestSha256' ~ '^sha256:[a-f0-9]{64}$'
    and value->>'archiveSha256' ~ '^sha256:[a-f0-9]{64}$'
    and value->>'coreMigrationHead' ~ '^\d{14}_[a-z0-9_]+$'
    and value->>'workspaceIsolationProofSha256' ~ '^sha256:[a-f0-9]{64}$'
    and value->>'workspaceIsolationProofHash' ~ '^sha256:[a-f0-9]{64}$'
    and value->>'workspaceIsolationProofSha256' <> value->>'workspaceIsolationProofHash'
    and jsonb_typeof(value->'imageDigests') = 'object'
    and (select count(*) from jsonb_each_text(value->'imageDigests')) > 0
    and not exists (
      select 1 from jsonb_each_text(value->'imageDigests') image
      where image.key !~ '^[a-z][a-z0-9-]*$'
         or image.value is null
         or image.value !~ '^sha256:[a-f0-9]{64}$'
    ),
    false
  )
$$;

create table public.release_adoption_approvals (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  owner_person_id uuid not null,
  approval_plane text not null check (approval_plane = 'installation-postgres'),
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  release jsonb not null check (public.vorton_release_adoption_release_valid(release)),
  manifest_sha256 text not null check (manifest_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  archive_sha256 text not null check (archive_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  installation_owner_verified_at timestamptz not null,
  scope jsonb not null,
  created_at timestamptz not null default now(),
  constraint release_adoption_approvals_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint release_adoption_approvals_time_check check (
    expires_at > approved_at
    and expires_at <= approved_at + interval '24 hours'
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
    and installation_owner_verified_at = approved_at
  ),
  constraint release_adoption_approvals_scope_check check (
    scope = '{"adoptRelease":true,"installRelease":false,"mutateInstallation":false,"createWorkspace":false,"createInfrastructure":false,"inspectFreedos":false,"personalSourceRead":false,"dataMigration":false}'::jsonb
  ),
  unique (installation_id, id),
  unique (installation_id, id, owner_person_id, plan_hash)
);

create table public.release_adoption_receipts (
  id uuid primary key,
  installation_id uuid not null references public.installations(id) on delete restrict,
  owner_person_id uuid not null,
  approval_id uuid not null,
  receipt_plane text not null check (receipt_plane = 'installation-postgres'),
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  release jsonb not null,
  status text not null check (status = 'adopted'),
  adopted_at timestamptz not null,
  approval_consumed_at timestamptz not null,
  approval_consumption_count integer not null check (approval_consumption_count = 1),
  state jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint release_adoption_receipts_approval_fk
    foreign key (installation_id, approval_id, owner_person_id, plan_hash)
    references public.release_adoption_approvals(installation_id, id, owner_person_id, plan_hash)
    on delete restrict,
  constraint release_adoption_receipts_time_check check (approval_consumed_at = adopted_at),
  constraint release_adoption_receipts_distinct_ids check (id <> approval_id),
  constraint release_adoption_receipts_state_check check (
    state = '{"installationMutated":false,"releaseInstalled":false,"workspaceCreated":false,"infrastructureCreated":false,"personalSourceRead":false,"dataMigrated":false,"freedosInspected":false}'::jsonb
  ),
  unique (installation_id, id),
  unique (installation_id, id, receipt_hash),
  unique (installation_id, approval_id)
);

comment on table public.release_adoption_approvals is
  'Installation-scoped recent-AAL2 approval to adopt one exact replanned Vorton release without installing it or mutating an installation.';
comment on table public.release_adoption_receipts is
  'Immutable installation-scoped receipt binding one consumed approval to the complete adopted release and both workspace-isolation proof identities.';

create function public.release_adoption_approval_document(
  value public.release_adoption_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.release-adoption-approval.v1',
    'approvalId', value.id::text,
    'approvalPlane', value.approval_plane,
    'installationId', value.installation_id::text,
    'approvedByPersonId', value.owner_person_id::text,
    'planHash', value.plan_hash,
    'manifestSha256', value.manifest_sha256,
    'archiveSha256', value.archive_sha256,
    'sourceCommit', value.source_commit,
    'approvedAt', to_char(value.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(value.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'aal2VerifiedAt', to_char(value.aal2_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'assuranceLevel', value.assurance_level,
    'installationOwnerVerifiedAt', to_char(value.installation_owner_verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'scope', value.scope
  )
$$;

create function public.release_adoption_receipt_document(
  value public.release_adoption_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.release-adoption-receipt.v1',
    'receiptId', value.id::text,
    'receiptPlane', value.receipt_plane,
    'installationId', value.installation_id::text,
    'ownerPersonId', value.owner_person_id::text,
    'approvalId', value.approval_id::text,
    'planHash', value.plan_hash,
    'release', value.release,
    'status', value.status,
    'adoptedAt', to_char(value.adopted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approvalConsumedAt', to_char(value.approval_consumed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approvalConsumptionCount', value.approval_consumption_count,
    'state', value.state,
    'receiptHash', value.receipt_hash
  )
$$;

create table public.workspace_creation_approvals (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  owner_person_id uuid not null,
  target_workspace_id uuid not null,
  target_slug text not null check (target_slug ~ '^[a-z][a-z0-9-]*$'),
  target_display_name text not null check (length(trim(target_display_name)) between 1 and 120),
  target_realm public.installation_realm not null,
  release_adoption_receipt_id uuid not null,
  release_adoption_receipt_sha256 text not null check (release_adoption_receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  release_manifest_sha256 text not null check (release_manifest_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  migration_head text not null check (migration_head ~ '^\d{14}_[a-z0-9_]+$'),
  workspace_isolation_proof_sha256 text not null check (workspace_isolation_proof_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  workspace_isolation_proof_hash text not null check (workspace_isolation_proof_hash ~ '^sha256:[a-f0-9]{64}$'),
  release_adopted_at timestamptz not null,
  workspace_plan_sha256 text not null check (workspace_plan_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  scope text not null check (scope = 'workspace.create'),
  aal text not null check (aal = 'aal2'),
  auth_time timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint workspace_creation_approvals_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_creation_approvals_release_receipt_fk
    foreign key (installation_id, release_adoption_receipt_id, release_adoption_receipt_sha256)
    references public.release_adoption_receipts(installation_id, id, receipt_hash)
    on delete restrict,
  constraint workspace_creation_approvals_distinct_proof_identities check (
    workspace_isolation_proof_sha256 <> workspace_isolation_proof_hash
  ),
  constraint workspace_creation_approvals_recent_window check (
    expires_at > created_at
    and expires_at <= auth_time + interval '10 minutes'
    and auth_time <= created_at + interval '1 minute'
    and created_at <= auth_time + interval '10 minutes'
  ),
  unique (installation_id, id),
  unique (
    installation_id, id, target_workspace_id, owner_person_id,
    release_adoption_receipt_id, release_adoption_receipt_sha256,
    source_commit, workspace_plan_sha256
  )
);

comment on table public.workspace_creation_approvals is
  'Installation-scoped, recent-AAL2 authority for creating one exact workspace before workspace-scoped authority can exist.';

create table public.workspace_creation_receipts (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  approval_id uuid not null,
  workspace_id uuid not null,
  owner_person_id uuid not null,
  release_adoption_receipt_id uuid not null,
  release_adoption_receipt_sha256 text not null check (release_adoption_receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  workspace_plan_sha256 text not null check (workspace_plan_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint workspace_creation_receipts_approval_fk
    foreign key (
      installation_id, approval_id, workspace_id, owner_person_id,
      release_adoption_receipt_id, release_adoption_receipt_sha256,
      source_commit, workspace_plan_sha256
    ) references public.workspace_creation_approvals(
      installation_id, id, target_workspace_id, owner_person_id,
      release_adoption_receipt_id, release_adoption_receipt_sha256,
      source_commit, workspace_plan_sha256
    ) on delete restrict,
  constraint workspace_creation_receipts_workspace_fk
    foreign key (installation_id, workspace_id)
    references public.workspaces(installation_id, id) on delete restrict,
  constraint workspace_creation_receipts_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  unique (installation_id, id),
  unique (installation_id, approval_id),
  unique (installation_id, workspace_id)
);

comment on table public.workspace_creation_receipts is
  'Installation-scoped receipt atomically consuming one approval to create one workspace and its initial owner membership without freezing later membership governance.';

create function public.reject_installation_authority_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Release adoption and workspace creation approvals and receipts are append-only';
end
$$;

create trigger release_adoption_approvals_reject_update_delete
before update or delete on public.release_adoption_approvals
for each row execute function public.reject_installation_authority_mutation();

create trigger release_adoption_receipts_reject_update_delete
before update or delete on public.release_adoption_receipts
for each row execute function public.reject_installation_authority_mutation();

create trigger workspace_creation_approvals_reject_update_delete
before update or delete on public.workspace_creation_approvals
for each row execute function public.reject_installation_authority_mutation();

create trigger workspace_creation_receipts_reject_update_delete
before update or delete on public.workspace_creation_receipts
for each row execute function public.reject_installation_authority_mutation();

create function public.vorton_installation_step_up_context_valid(
  expected_installation text,
  expected_subject text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, aubos_private
as $$
  select coalesce(
    public.aubos_runtime_context_valid(
      'person', expected_installation, '*', expected_subject
    )
    and current_setting('vorton.aal', true) = 'aal2'
    and current_setting('vorton.auth_time', true) ~ '^[0-9]{10}$'
    and to_timestamp(current_setting('vorton.auth_time', true)::bigint)
      between now() - interval '10 minutes' and now() + interval '1 minute'
    and current_setting('vorton.step_up_signature', true) = encode(
      extensions.hmac(
        convert_to(
          txid_current()::text || '|installation-person|' ||
          expected_installation || '|' || expected_subject || '|aal2|' ||
          current_setting('vorton.auth_time', true),
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

revoke all on function public.vorton_installation_step_up_context_valid(text, text)
  from public, anon, aubos_worker;
grant execute on function public.vorton_installation_step_up_context_valid(text, text)
  to authenticated;

create function public.create_release_adoption_approval(
  target_installation_id uuid,
  target_plan_hash text,
  exact_release jsonb,
  target_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  subject_id uuid;
  subject_auth_time timestamptz;
  owner_id uuid;
  approved_at_value timestamptz;
  approval public.release_adoption_approvals;
begin
  subject_id := nullif(current_setting('aubos.subject_id', true), '')::uuid;
  if subject_id is null or not public.vorton_installation_step_up_context_valid(
    target_installation_id::text, subject_id::text
  ) then
    raise exception 'Signed installation-person AAL2 context is required to approve release adoption';
  end if;
  subject_auth_time := to_timestamp(current_setting('vorton.auth_time', true)::bigint);
  approved_at_value := date_trunc('milliseconds', clock_timestamp());

  select person.id into owner_id
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_id
     and person.kind = 'owner'
   for share;
  if owner_id is null then
    raise exception 'Installation owner authority is required';
  end if;
  if target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
  then
    raise exception 'Release adoption approval expiry must be within 24 hours';
  end if;
  if not public.vorton_release_adoption_release_valid(exact_release) then
    raise exception 'Release adoption approval requires the complete exact release object';
  end if;

  insert into public.release_adoption_approvals (
    installation_id, owner_person_id, approval_plane, plan_hash, release,
    manifest_sha256, archive_sha256, source_commit, approved_at, expires_at,
    aal2_verified_at, assurance_level, installation_owner_verified_at, scope
  ) values (
    target_installation_id, owner_id, 'installation-postgres', target_plan_hash,
    exact_release, exact_release->>'manifestSha256',
    exact_release->>'archiveSha256', exact_release->>'sourceCommit',
    approved_at_value, target_expires_at, subject_auth_time, 'aal2',
    approved_at_value,
    '{"adoptRelease":true,"installRelease":false,"mutateInstallation":false,"createWorkspace":false,"createInfrastructure":false,"inspectFreedos":false,"personalSourceRead":false,"dataMigration":false}'::jsonb
  ) returning * into approval;
  return public.release_adoption_approval_document(approval);
end
$$;

revoke all on function public.create_release_adoption_approval(
  uuid, text, jsonb, timestamptz
) from public, anon, aubos_worker;
grant execute on function public.create_release_adoption_approval(
  uuid, text, jsonb, timestamptz
) to authenticated;

create function public.apply_release_adoption(
  target_installation_id uuid,
  target_approval_id uuid,
  target_receipt_id uuid,
  expected_plan_hash text,
  exact_release jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  approval public.release_adoption_approvals;
  receipt public.release_adoption_receipts;
  adopted_at_value timestamptz;
  state_value jsonb := '{"installationMutated":false,"releaseInstalled":false,"workspaceCreated":false,"infrastructureCreated":false,"personalSourceRead":false,"dataMigrated":false,"freedosInspected":false}'::jsonb;
  receipt_document jsonb;
  calculated_receipt_hash text;
begin
  if target_receipt_id = target_approval_id then
    raise exception 'Release adoption receipt ID must differ from approval ID';
  end if;
  select * into approval
    from public.release_adoption_approvals
   where installation_id = target_installation_id and id = target_approval_id
   for update;
  adopted_at_value := date_trunc('milliseconds', clock_timestamp());

  if approval.id is null
    or approval.plan_hash <> expected_plan_hash
  then
    raise exception 'Exact release adoption approval is required';
  end if;
  if exact_release <> approval.release then
    raise exception 'Release adoption release object differs from the approved release';
  end if;

  select * into receipt
    from public.release_adoption_receipts existing
   where existing.installation_id = target_installation_id
     and existing.approval_id = target_approval_id;
  if receipt.id is not null then
    if receipt.id <> target_receipt_id
      or receipt.owner_person_id <> approval.owner_person_id
      or receipt.plan_hash <> expected_plan_hash
      or receipt.release <> exact_release
    then
      raise exception 'Release adoption retry conflicts with the immutable receipt';
    end if;
    return public.release_adoption_receipt_document(receipt);
  end if;

  if approval.expires_at <= adopted_at_value then
    raise exception 'Unexpired release adoption approval is required';
  end if;

  perform 1
    from public.people person
   where person.installation_id = target_installation_id
     and person.id = approval.owner_person_id
     and person.kind = 'owner'
   for share;
  if not found then
    raise exception 'Live installation owner authority is required';
  end if;

  receipt_document := jsonb_build_object(
    'contract', 'vorton.release-adoption-receipt.v1',
    'receiptId', target_receipt_id::text,
    'receiptPlane', 'installation-postgres',
    'installationId', target_installation_id::text,
    'ownerPersonId', approval.owner_person_id::text,
    'approvalId', approval.id::text,
    'planHash', approval.plan_hash,
    'release', exact_release,
    'status', 'adopted',
    'adoptedAt', to_char(adopted_at_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approvalConsumedAt', to_char(adopted_at_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approvalConsumptionCount', 1,
    'state', state_value
  );
  calculated_receipt_hash := 'sha256:' || encode(
    extensions.digest(convert_to(public.vorton_canonical_jsonb(receipt_document), 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.release_adoption_receipts (
    id, installation_id, owner_person_id, approval_id, receipt_plane,
    plan_hash, release, status, adopted_at, approval_consumed_at,
    approval_consumption_count, state, receipt_hash
  ) values (
    target_receipt_id, target_installation_id, approval.owner_person_id,
    approval.id, 'installation-postgres', approval.plan_hash, exact_release,
    'adopted', adopted_at_value, adopted_at_value, 1, state_value,
    calculated_receipt_hash
  ) returning * into receipt;
  return public.release_adoption_receipt_document(receipt);
end
$$;

revoke all on function public.apply_release_adoption(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, aubos_worker;

create function public.create_workspace_creation_approval(
  target_installation_id uuid,
  target_workspace_id uuid,
  target_slug text,
  target_display_name text,
  target_realm public.installation_realm,
  target_release_adoption_receipt_id uuid,
  target_release_adoption_receipt_sha256 text,
  target_workspace_plan_sha256 text
) returns public.workspace_creation_approvals
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  subject_id uuid;
  subject_auth_time timestamptz;
  owner_id uuid;
  adopted_release public.release_adoption_receipts;
  approval public.workspace_creation_approvals;
begin
  subject_id := nullif(current_setting('aubos.subject_id', true), '')::uuid;
  if subject_id is null or not public.vorton_installation_step_up_context_valid(
    target_installation_id::text, subject_id::text
  )
  then
    raise exception 'Signed installation-person AAL2 context is required to approve workspace creation';
  end if;
  subject_auth_time := to_timestamp(
    current_setting('vorton.auth_time', true)::bigint
  );

  select person.id into owner_id
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_id
     and person.kind = 'owner'
   for share;
  if owner_id is null then
    raise exception 'Installation owner authority is required';
  end if;

  select * into adopted_release
    from public.release_adoption_receipts receipt
   where receipt.installation_id = target_installation_id
     and receipt.id = target_release_adoption_receipt_id
     and receipt.receipt_hash = target_release_adoption_receipt_sha256
     and receipt.status = 'adopted';
  if adopted_release.id is null then
    raise exception 'Exact installation-scoped release adoption receipt is required';
  end if;

  insert into public.workspace_creation_approvals (
    installation_id, owner_person_id, target_workspace_id, target_slug,
    target_display_name, target_realm, release_adoption_receipt_id,
    release_adoption_receipt_sha256, release_manifest_sha256, source_commit,
    migration_head, workspace_isolation_proof_sha256,
    workspace_isolation_proof_hash, release_adopted_at,
    workspace_plan_sha256, scope, aal, auth_time, expires_at
  ) values (
    target_installation_id, owner_id, target_workspace_id, target_slug,
    target_display_name, target_realm, adopted_release.id,
    adopted_release.receipt_hash, adopted_release.release->>'manifestSha256',
    adopted_release.release->>'sourceCommit',
    adopted_release.release->>'coreMigrationHead',
    adopted_release.release->>'workspaceIsolationProofSha256',
    adopted_release.release->>'workspaceIsolationProofHash',
    adopted_release.adopted_at, target_workspace_plan_sha256,
    'workspace.create', 'aal2', subject_auth_time,
    least(now() + interval '10 minutes', subject_auth_time + interval '10 minutes')
  ) returning * into approval;
  return approval;
end
$$;

revoke all on function public.create_workspace_creation_approval(
  uuid, uuid, text, text, public.installation_realm, uuid, text, text
) from public, anon, aubos_worker;
grant execute on function public.create_workspace_creation_approval(
  uuid, uuid, text, text, public.installation_realm, uuid, text, text
) to authenticated;

create function public.apply_workspace_creation(
  target_installation_id uuid,
  target_approval_id uuid,
  target_receipt_id uuid,
  expected_workspace_plan_sha256 text
) returns public.workspace_creation_receipts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  approval public.workspace_creation_approvals;
  receipt public.workspace_creation_receipts;
begin
  select * into approval
    from public.workspace_creation_approvals
   where installation_id = target_installation_id
     and id = target_approval_id
   for update;

  if approval.id is null
    or approval.scope <> 'workspace.create'
    or approval.aal <> 'aal2'
    or approval.workspace_plan_sha256 <> expected_workspace_plan_sha256
  then
    raise exception 'Exact workspace creation approval is required';
  end if;

  select * into receipt
    from public.workspace_creation_receipts existing
   where existing.installation_id = target_installation_id
     and existing.approval_id = target_approval_id;
  if receipt.id is not null then
    if receipt.id <> target_receipt_id
      or receipt.workspace_id <> approval.target_workspace_id
      or receipt.owner_person_id <> approval.owner_person_id
      or receipt.release_adoption_receipt_id <> approval.release_adoption_receipt_id
      or receipt.release_adoption_receipt_sha256 <> approval.release_adoption_receipt_sha256
      or receipt.source_commit <> approval.source_commit
      or receipt.workspace_plan_sha256 <> expected_workspace_plan_sha256
    then
      raise exception 'Workspace creation retry conflicts with the immutable receipt';
    end if;
    return receipt;
  end if;

  if approval.expires_at <= clock_timestamp()
    or approval.auth_time < clock_timestamp() - interval '10 minutes'
  then
    raise exception 'Live workspace creation approval is required';
  end if;

  perform 1
    from public.people person
   where person.installation_id = target_installation_id
     and person.id = approval.owner_person_id
     and person.kind = 'owner'
   for share;
  if not found then
    raise exception 'Live installation owner authority is required';
  end if;

  insert into public.workspaces (
    id, installation_id, slug, display_name, realm, created_by_person_id
  ) values (
    approval.target_workspace_id, approval.installation_id,
    approval.target_slug, approval.target_display_name,
    approval.target_realm, approval.owner_person_id
  );

  insert into public.workspace_memberships (
    installation_id, workspace_id, person_id, kind
  ) values (
    approval.installation_id, approval.target_workspace_id,
    approval.owner_person_id, 'owner'
  );

  insert into public.workspace_creation_receipts (
    id, installation_id, approval_id, workspace_id, owner_person_id,
    release_adoption_receipt_id, release_adoption_receipt_sha256,
    source_commit, workspace_plan_sha256
  ) values (
    target_receipt_id, approval.installation_id, approval.id,
    approval.target_workspace_id, approval.owner_person_id,
    approval.release_adoption_receipt_id,
    approval.release_adoption_receipt_sha256, approval.source_commit,
    approval.workspace_plan_sha256
  ) returning * into receipt;

  return receipt;
end
$$;

revoke all on function public.apply_workspace_creation(uuid, uuid, uuid, text)
  from public, anon, authenticated, aubos_worker;

alter table public.workspace_creation_approvals enable row level security;
alter table public.workspace_creation_receipts enable row level security;
alter table public.release_adoption_approvals enable row level security;
alter table public.release_adoption_receipts enable row level security;

revoke select, insert, update, delete on public.release_adoption_approvals,
  public.release_adoption_receipts, public.workspace_creation_approvals,
  public.workspace_creation_receipts from public, anon, authenticated, aubos_worker;

commit;
