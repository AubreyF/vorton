begin;

create schema if not exists aubos_private;
revoke all on schema aubos_private from public, anon, authenticated, aubos_worker;

create table if not exists aubos_private.runtime_context_keys (
  role_name name primary key,
  secret bytea not null check (octet_length(secret) >= 32),
  created_at timestamptz not null default now()
);
revoke all on aubos_private.runtime_context_keys from public, anon, authenticated, aubos_worker;

create or replace function public.aubos_runtime_context_valid(
  expected_kind text,
  expected_installation text,
  expected_subject text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, aubos_private
as $$
  select coalesce(
    current_setting('aubos.context_kind', true) = expected_kind
    and current_setting('aubos.installation_id', true) = expected_installation
    and current_setting('aubos.subject_id', true) = expected_subject
    and current_setting('aubos.context_signature', true) = encode(
      extensions.hmac(
        convert_to(
          txid_current()::text || '|' || expected_kind || '|' ||
          expected_installation || '|' || expected_subject || '|' ||
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

revoke all on function public.aubos_runtime_context_valid(text, text, text) from public;
grant execute on function public.aubos_runtime_context_valid(text, text, text)
  to authenticated, aubos_worker;

create or replace function public.current_installation_id() returns uuid
language sql stable
as $$
  select case
    when public.aubos_runtime_context_valid(
      'worker',
      current_setting('aubos.installation_id', true),
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
      'worker',
      current_setting('aubos.installation_id', true),
      current_setting('aubos.subject_id', true)
    ) then nullif(current_setting('aubos.subject_id', true), '')::uuid
    else null
  end
$$;

create or replace function public.current_person_id(target_installation_id uuid) returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select person.id
  from public.people person
  where person.installation_id = target_installation_id
    and person.auth_user_id = nullif(current_setting('aubos.subject_id', true), '')::uuid
    and public.aubos_runtime_context_valid(
      'person',
      case
        when current_setting('aubos.installation_id', true) = '*'
          then '*'
        else target_installation_id::text
      end,
      current_setting('aubos.subject_id', true)
    )
$$;

create or replace function public.is_installation_member(target_installation_id uuid) returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select public.current_person_id(target_installation_id) is not null
$$;

create or replace function public.is_installation_owner(target_installation_id uuid) returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1 from public.people person
    where person.installation_id = target_installation_id
      and person.id = public.current_person_id(target_installation_id)
      and person.kind = 'owner'
  )
$$;

drop policy if exists records_worker_insert on public.records;
create policy records_worker_insert on public.records for insert to aubos_worker
  with check (
    installation_id = public.current_installation_id()
    and actor_worker_id = public.current_worker_id()
    and actor_person_id is null
    and kind not in ('approval', 'decision', 'review')
    and supersedes_record_id is null
    and public.worker_can_read_classification(classification)
    and (
      kind <> 'proposal'
      or public.worker_has_capability('executive.propose', 'recommend', work_id)
    )
  );

commit;
