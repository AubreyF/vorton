-- Retry-safe authenticated approval entrypoints. Apply remains administrative only.

begin;

create or replace function public.vorton_release_adoption_release_valid(value jsonb)
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
    and value->>'version' ~ '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
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

alter table public.release_adoption_approvals
  drop constraint if exists release_adoption_approvals_release_check;
alter table public.release_adoption_approvals
  add constraint release_adoption_approvals_release_check
  check (public.vorton_release_adoption_release_valid(release));

alter table public.release_adoption_receipts
  add constraint release_adoption_receipts_release_check
  check (public.vorton_release_adoption_release_valid(release));

alter table public.release_adoption_approvals
  drop constraint release_adoption_approvals_time_check;
alter table public.release_adoption_approvals
  add constraint release_adoption_approvals_time_check check (
    expires_at > approved_at
    and expires_at <= approved_at + interval '24 hours'
    and aal2_verified_at <= approved_at + interval '1 minute'
    and approved_at <= aal2_verified_at + interval '10 minutes'
    and installation_owner_verified_at = approved_at
  );

alter table public.workspace_creation_receipts
  add constraint workspace_creation_receipts_distinct_ids
  check (id <> approval_id);

create or replace function public.release_adoption_approval_document(
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
    'release', value.release,
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

create function public.workspace_creation_approval_document(
  value public.workspace_creation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-creation-approval.v1',
    'approvalId', value.id::text,
    'approvalPlane', 'installation-postgres',
    'installationId', value.installation_id::text,
    'approvedByPersonId', value.owner_person_id::text,
    'workspace', jsonb_build_object(
      'id', value.target_workspace_id::text,
      'slug', value.target_slug,
      'displayName', value.target_display_name,
      'realm', value.target_realm::text
    ),
    'adoptedRelease', jsonb_build_object(
      'adoptionReceiptId', value.release_adoption_receipt_id::text,
      'adoptionReceiptSha256', value.release_adoption_receipt_sha256,
      'receiptPlane', 'installation-postgres',
      'manifestSha256', value.release_manifest_sha256,
      'sourceCommit', value.source_commit,
      'migrationHead', value.migration_head,
      'workspaceIsolationProofSha256', value.workspace_isolation_proof_sha256,
      'workspaceIsolationProofHash', value.workspace_isolation_proof_hash,
      'status', 'adopted',
      'adoptedAt', to_char(value.release_adopted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'workspacePlanSha256', value.workspace_plan_sha256,
    'scope', value.scope,
    'assuranceLevel', value.aal,
    'aal2VerifiedAt', to_char(value.auth_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approvedAt', to_char(value.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', to_char(value.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

revoke all on function public.release_adoption_approval_document(
  public.release_adoption_approvals
) from public, anon, authenticated, aubos_worker;
revoke all on function public.release_adoption_receipt_document(
  public.release_adoption_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_creation_approval_document(
  public.workspace_creation_approvals
) from public, anon, authenticated, aubos_worker;

revoke execute on function public.create_release_adoption_approval(
  uuid, text, jsonb, timestamptz
) from authenticated;
revoke execute on function public.create_workspace_creation_approval(
  uuid, uuid, text, text, public.installation_realm, uuid, text, text
) from authenticated;

create function public.create_release_adoption_approval(
  target_approval_id uuid,
  target_installation_id uuid,
  target_plan_hash text,
  exact_release jsonb,
  target_expires_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  subject_id uuid := nullif(current_setting('aubos.subject_id', true), '')::uuid;
  subject_auth_time timestamptz;
  owner_id uuid;
  approved_at_value timestamptz := date_trunc('milliseconds', clock_timestamp());
  approval public.release_adoption_approvals;
begin
  if subject_id is null or not public.vorton_installation_step_up_context_valid(
    target_installation_id::text, subject_id::text
  ) then
    raise exception 'Signed installation-person AAL2 context is required to approve release adoption';
  end if;
  subject_auth_time := to_timestamp(current_setting('vorton.auth_time', true)::bigint);
  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':release-approval:' || target_approval_id::text, 0
  ));
  select * into approval from public.release_adoption_approvals
   where installation_id = target_installation_id and id = target_approval_id;
  if approval.id is not null then
    select id into owner_id from public.people
     where installation_id = target_installation_id
       and auth_user_id = subject_id and id = approval.owner_person_id;
    if owner_id is null or approval.plan_hash <> target_plan_hash
      or approval.release <> exact_release or approval.expires_at <> target_expires_at
    then raise exception 'Release adoption approval retry conflicts with immutable authority'; end if;
    return public.release_adoption_approval_document(approval);
  end if;

  select id into owner_id from public.people
   where installation_id = target_installation_id
     and auth_user_id = subject_id and kind = 'owner' for share;
  if owner_id is null then raise exception 'Installation owner authority is required'; end if;
  if target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
  then raise exception 'Release adoption approval expiry must be within 24 hours'; end if;
  if not public.vorton_release_adoption_release_valid(exact_release) then
    raise exception 'Release adoption approval requires the complete exact release object';
  end if;

  insert into public.release_adoption_approvals (
    id, installation_id, owner_person_id, approval_plane, plan_hash, release,
    manifest_sha256, archive_sha256, source_commit, approved_at, expires_at,
    aal2_verified_at, assurance_level, installation_owner_verified_at, scope
  ) values (
    target_approval_id, target_installation_id, owner_id, 'installation-postgres',
    target_plan_hash, exact_release, exact_release->>'manifestSha256',
    exact_release->>'archiveSha256', exact_release->>'sourceCommit',
    approved_at_value, target_expires_at, subject_auth_time, 'aal2', approved_at_value,
    '{"adoptRelease":true,"installRelease":false,"mutateInstallation":false,"createWorkspace":false,"createInfrastructure":false,"inspectFreedos":false,"personalSourceRead":false,"dataMigration":false}'::jsonb
  ) returning * into approval;
  return public.release_adoption_approval_document(approval);
end
$$;

create function public.create_workspace_creation_approval(
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  target_slug text,
  target_display_name text,
  target_realm public.installation_realm,
  target_release_adoption_receipt_id uuid,
  target_release_adoption_receipt_sha256 text,
  target_workspace_plan_sha256 text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  subject_id uuid := nullif(current_setting('aubos.subject_id', true), '')::uuid;
  subject_auth_time timestamptz;
  owner_id uuid;
  adopted_release public.release_adoption_receipts;
  approval public.workspace_creation_approvals;
begin
  if subject_id is null or not public.vorton_installation_step_up_context_valid(
    target_installation_id::text, subject_id::text
  ) then raise exception 'Signed installation-person AAL2 context is required to approve workspace creation'; end if;
  subject_auth_time := to_timestamp(current_setting('vorton.auth_time', true)::bigint);
  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':workspace-approval:' || target_approval_id::text, 0
  ));
  select * into approval from public.workspace_creation_approvals
   where installation_id = target_installation_id and id = target_approval_id;
  if approval.id is not null then
    select id into owner_id from public.people
     where installation_id = target_installation_id
       and auth_user_id = subject_id and id = approval.owner_person_id;
    if owner_id is null or approval.target_workspace_id <> target_workspace_id
      or approval.target_slug <> target_slug
      or approval.target_display_name <> target_display_name
      or approval.target_realm <> target_realm
      or approval.release_adoption_receipt_id <> target_release_adoption_receipt_id
      or approval.release_adoption_receipt_sha256 <> target_release_adoption_receipt_sha256
      or approval.workspace_plan_sha256 <> target_workspace_plan_sha256
    then raise exception 'Workspace creation approval retry conflicts with immutable authority'; end if;
    return public.workspace_creation_approval_document(approval);
  end if;

  select id into owner_id from public.people
   where installation_id = target_installation_id
     and auth_user_id = subject_id and kind = 'owner' for share;
  if owner_id is null then raise exception 'Installation owner authority is required'; end if;
  select * into adopted_release from public.release_adoption_receipts
   where installation_id = target_installation_id
     and id = target_release_adoption_receipt_id
     and receipt_hash = target_release_adoption_receipt_sha256 and status = 'adopted';
  if adopted_release.id is null then
    raise exception 'Exact installation-scoped release adoption receipt is required';
  end if;

  insert into public.workspace_creation_approvals (
    id, installation_id, owner_person_id, target_workspace_id, target_slug,
    target_display_name, target_realm, release_adoption_receipt_id,
    release_adoption_receipt_sha256, release_manifest_sha256, source_commit,
    migration_head, workspace_isolation_proof_sha256,
    workspace_isolation_proof_hash, release_adopted_at,
    workspace_plan_sha256, scope, aal, auth_time, expires_at
  ) values (
    target_approval_id, target_installation_id, owner_id, target_workspace_id,
    target_slug, target_display_name, target_realm, adopted_release.id,
    adopted_release.receipt_hash, adopted_release.release->>'manifestSha256',
    adopted_release.release->>'sourceCommit', adopted_release.release->>'coreMigrationHead',
    adopted_release.release->>'workspaceIsolationProofSha256',
    adopted_release.release->>'workspaceIsolationProofHash', adopted_release.adopted_at,
    target_workspace_plan_sha256, 'workspace.create', 'aal2', subject_auth_time,
    least(now() + interval '10 minutes', subject_auth_time + interval '10 minutes')
  ) returning * into approval;
  return public.workspace_creation_approval_document(approval);
end
$$;

revoke all on function public.create_release_adoption_approval(
  uuid, uuid, text, jsonb, timestamptz
) from public, anon, aubos_worker;
grant execute on function public.create_release_adoption_approval(
  uuid, uuid, text, jsonb, timestamptz
) to authenticated;
revoke all on function public.create_workspace_creation_approval(
  uuid, uuid, uuid, text, text, public.installation_realm, uuid, text, text
) from public, anon, aubos_worker;
grant execute on function public.create_workspace_creation_approval(
  uuid, uuid, uuid, text, text, public.installation_realm, uuid, text, text
) to authenticated;

commit;
