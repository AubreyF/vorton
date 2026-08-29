begin;

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aubos_worker') then
    create role aubos_worker nologin noinherit;
  end if;
end
$$;

create type public.person_kind as enum ('owner', 'member');
create type public.worker_health as enum ('healthy', 'degraded', 'offline');
create type public.work_state as enum (
  'proposed', 'ready', 'leased', 'blocked', 'review', 'completed', 'cancelled'
);
create type public.capability_mode as enum (
  'observe', 'diagnose', 'recommend', 'modify', 'approve', 'publish', 'verify'
);
create type public.principal_kind as enum ('person', 'worker');
create type public.record_kind as enum (
  'evidence', 'proposal', 'decision', 'approval', 'receipt', 'outcome', 'learning'
);
create type public.data_classification as enum (
  'public', 'internal', 'confidential', 'restricted', 'synthetic'
);

create table public.installations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]*$'),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  kind public.person_kind not null default 'member',
  created_at timestamptz not null default now(),
  unique (installation_id, auth_user_id),
  unique (installation_id, id)
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  provider text not null,
  billing_realm text not null,
  host text not null,
  runtime text not null,
  model text not null,
  advertised_capabilities text[] not null default '{}',
  data_classification_ceiling public.data_classification not null,
  isolation text not null,
  network_policy text not null,
  health public.worker_health not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (installation_id, name),
  unique (installation_id, id)
);

create table public.worker_credentials (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  worker_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  token_hint text not null check (length(token_hint) between 4 and 16),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  issued_by_person_id uuid,
  constraint worker_credentials_worker_fk foreign key (installation_id, worker_id)
    references public.workers(installation_id, id) on delete restrict,
  constraint worker_credentials_issuer_fk foreign key (installation_id, issued_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint worker_credentials_short_lived check (
    expires_at > issued_at and expires_at <= issued_at + interval '15 minutes'
  ),
  unique (installation_id, id)
);

create table public.worker_credential_revocations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  credential_id uuid not null,
  revoked_by_person_id uuid not null,
  reason text not null check (length(trim(reason)) > 0),
  revoked_at timestamptz not null default now(),
  constraint worker_credential_revocations_credential_fk foreign key (installation_id, credential_id)
    references public.worker_credentials(installation_id, id) on delete restrict,
  constraint worker_credential_revocations_person_fk foreign key (installation_id, revoked_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  unique (credential_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  version integer not null check (version > 0),
  skill_markdown text not null check (length(trim(skill_markdown)) > 0),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_person_id uuid not null,
  created_at timestamptz not null default now(),
  constraint roles_creator_fk foreign key (installation_id, created_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  unique (installation_id, name, version),
  unique (installation_id, id)
);

comment on table public.roles is
  'Versioned competence instructions. Roles never grant capabilities or authority.';

create table public.worker_role_assignments (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  worker_id uuid not null,
  role_id uuid not null,
  assigned_by_person_id uuid not null,
  assigned_at timestamptz not null default now(),
  constraint worker_role_assignments_worker_fk foreign key (installation_id, worker_id)
    references public.workers(installation_id, id) on delete restrict,
  constraint worker_role_assignments_role_fk foreign key (installation_id, role_id)
    references public.roles(installation_id, id) on delete restrict,
  constraint worker_role_assignments_person_fk foreign key (installation_id, assigned_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  unique (worker_id, role_id)
);

create table public.work (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 240),
  requested_outcome text not null check (length(trim(requested_outcome)) > 0),
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  state public.work_state not null default 'proposed',
  priority integer not null default 50 check (priority between 0 and 100),
  parent_work_id uuid,
  requested_by_person_id uuid,
  custodian_person_id uuid,
  custodian_worker_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_parent_fk foreign key (installation_id, parent_work_id)
    references public.work(installation_id, id) on delete restrict,
  constraint work_requester_fk foreign key (installation_id, requested_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint work_person_custodian_fk foreign key (installation_id, custodian_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint work_worker_custodian_fk foreign key (installation_id, custodian_worker_id)
    references public.workers(installation_id, id) on delete restrict,
  constraint work_one_custodian check (
    not (custodian_person_id is not null and custodian_worker_id is not null)
  ),
  constraint work_lease_shape check (
    (state = 'leased' and custodian_worker_id is not null and lease_expires_at is not null)
    or (state <> 'leased' and lease_expires_at is null)
  ),
  unique (installation_id, id)
);

create table public.work_dependencies (
  installation_id uuid not null,
  work_id uuid not null,
  depends_on_work_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (work_id, depends_on_work_id),
  constraint work_dependencies_work_fk foreign key (installation_id, work_id)
    references public.work(installation_id, id) on delete cascade,
  constraint work_dependencies_dependency_fk foreign key (installation_id, depends_on_work_id)
    references public.work(installation_id, id) on delete restrict,
  constraint work_dependencies_not_self check (work_id <> depends_on_work_id)
);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  version integer not null check (version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by_person_id uuid not null,
  created_at timestamptz not null default now(),
  constraint policies_creator_fk foreign key (installation_id, created_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  unique (installation_id, name, version),
  unique (installation_id, id)
);

create table public.capability_grants (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  policy_id uuid not null,
  principal_kind public.principal_kind not null,
  person_id uuid,
  worker_id uuid,
  capability text not null check (length(trim(capability)) > 0),
  mode public.capability_mode not null,
  work_id uuid,
  expires_at timestamptz,
  granted_by_person_id uuid not null,
  granted_at timestamptz not null default now(),
  constraint capability_grants_policy_fk foreign key (installation_id, policy_id)
    references public.policies(installation_id, id) on delete restrict,
  constraint capability_grants_person_fk foreign key (installation_id, person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint capability_grants_worker_fk foreign key (installation_id, worker_id)
    references public.workers(installation_id, id) on delete restrict,
  constraint capability_grants_work_fk foreign key (installation_id, work_id)
    references public.work(installation_id, id) on delete restrict,
  constraint capability_grants_grantor_fk foreign key (installation_id, granted_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint capability_grants_principal_shape check (
    (principal_kind = 'person' and person_id is not null and worker_id is null)
    or (principal_kind = 'worker' and worker_id is not null and person_id is null)
  ),
  unique (installation_id, id)
);

create table public.capability_grant_revocations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  grant_id uuid not null unique,
  revoked_by_person_id uuid not null,
  reason text not null check (length(trim(reason)) > 0),
  revoked_at timestamptz not null default now(),
  constraint capability_grant_revocations_person_fk foreign key (installation_id, revoked_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint capability_grant_revocations_grant_fk foreign key (installation_id, grant_id)
    references public.capability_grants(installation_id, id) on delete restrict
);

comment on table public.capability_grants is
  'Explicit policy authority. No role or role assignment is consulted when granting authority.';

create table public.records (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete restrict,
  work_id uuid,
  kind public.record_kind not null,
  summary text not null check (length(trim(summary)) > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source_uri text,
  classification public.data_classification not null default 'internal',
  actor_person_id uuid,
  actor_worker_id uuid,
  supersedes_record_id uuid,
  created_at timestamptz not null default now(),
  constraint records_work_fk foreign key (installation_id, work_id)
    references public.work(installation_id, id) on delete restrict,
  constraint records_person_fk foreign key (installation_id, actor_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint records_worker_fk foreign key (installation_id, actor_worker_id)
    references public.workers(installation_id, id) on delete restrict,
  constraint records_supersedes_fk foreign key (installation_id, supersedes_record_id)
    references public.records(installation_id, id) on delete restrict,
  constraint records_exactly_one_actor check (
    (actor_person_id is not null)::integer + (actor_worker_id is not null)::integer = 1
  ),
  constraint records_not_self_superseding check (id <> supersedes_record_id),
  unique (installation_id, id)
);

create index people_auth_user_idx on public.people(auth_user_id, installation_id);
create index workers_installation_health_idx on public.workers(installation_id, health);
create index worker_credentials_lookup_idx on public.worker_credentials(token_hash, expires_at);
create index work_installation_state_idx on public.work(installation_id, state, priority desc);
create index capability_grants_worker_idx on public.capability_grants(worker_id, capability, mode);
create index records_installation_created_idx on public.records(installation_id, created_at desc);
create index records_work_created_idx on public.records(work_id, created_at);

create function public.current_installation_id() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('aubos.installation_id', true), '')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'installation_id')::uuid
  )
$$;

create function public.current_worker_id() returns uuid
language sql stable
as $$
  select nullif(current_setting('aubos.worker_id', true), '')::uuid
$$;

create function public.current_person_id(target_installation_id uuid) returns uuid
language sql stable security definer set search_path = public, auth
as $$
  select id
  from public.people
  where installation_id = target_installation_id
    and auth_user_id = auth.uid()
$$;

create function public.is_installation_member(target_installation_id uuid) returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1 from public.people
    where installation_id = target_installation_id and auth_user_id = auth.uid()
  )
$$;

create function public.is_installation_owner(target_installation_id uuid) returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1 from public.people
    where installation_id = target_installation_id
      and auth_user_id = auth.uid()
      and kind = 'owner'
  )
$$;

create function public.worker_has_capability(
  target_capability text,
  target_mode public.capability_mode,
  target_work_id uuid default null
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.capability_grants grant_row
    where grant_row.installation_id = public.current_installation_id()
      and grant_row.principal_kind = 'worker'
      and grant_row.worker_id = public.current_worker_id()
      and grant_row.capability = target_capability
      and grant_row.mode = target_mode
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and (grant_row.work_id is null or grant_row.work_id = target_work_id)
      and not exists (
        select 1 from public.capability_grant_revocations revocation
        where revocation.grant_id = grant_row.id
      )
  )
$$;

create function public.worker_can_read_classification(
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
    and worker.id = public.current_worker_id()
$$;

create function public.worker_transition_work(
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
    and id = target_work_id
    and custodian_worker_id = public.current_worker_id();

  if not found then
    raise exception 'Worker does not hold custody of this Work';
  end if;
end
$$;

revoke all on function public.worker_transition_work(uuid, public.work_state) from public;
grant execute on function public.worker_transition_work(uuid, public.work_state) to aubos_worker;

create function public.provision_person(
  target_installation_id uuid,
  target_auth_user_id uuid,
  target_display_name text,
  target_kind public.person_kind default 'member'
) returns public.people
language plpgsql security definer set search_path = public, auth
as $$
declare
  provisioned public.people;
begin
  if not exists (select 1 from auth.users where id = target_auth_user_id) then
    raise exception 'Auth user does not exist';
  end if;

  insert into public.people (installation_id, auth_user_id, display_name, kind)
  values (target_installation_id, target_auth_user_id, target_display_name, target_kind)
  returning * into provisioned;
  return provisioned;
end
$$;

revoke all on function public.provision_person(uuid, uuid, text, public.person_kind) from public;
revoke all on function public.provision_person(uuid, uuid, text, public.person_kind) from anon, authenticated, aubos_worker;

create function public.reject_record_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'Records are append-only; append a superseding record instead';
end
$$;

create trigger records_reject_update_delete
before update or delete on public.records
for each row execute function public.reject_record_mutation();

create function public.validate_work_transition() returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
    and not public.is_installation_owner(old.installation_id)
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
    raise exception 'Only an installation owner may change Work authority or request fields';
  end if;

  if new.state = old.state then
    return new;
  end if;
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

create trigger work_validate_transition
before update on public.work
for each row execute function public.validate_work_transition();

alter table public.installations enable row level security;
alter table public.people enable row level security;
alter table public.workers enable row level security;
alter table public.worker_credentials enable row level security;
alter table public.worker_credential_revocations enable row level security;
alter table public.roles enable row level security;
alter table public.worker_role_assignments enable row level security;
alter table public.work enable row level security;
alter table public.work_dependencies enable row level security;
alter table public.policies enable row level security;
alter table public.capability_grants enable row level security;
alter table public.capability_grant_revocations enable row level security;
alter table public.records enable row level security;

create policy installations_member_select on public.installations for select to authenticated
  using (public.is_installation_member(id));
create policy people_member_select on public.people for select to authenticated
  using (public.is_installation_member(installation_id));
create policy workers_member_select on public.workers for select to authenticated
  using (public.is_installation_member(installation_id));
create policy workers_worker_select on public.workers for select to aubos_worker
  using (installation_id = public.current_installation_id() and id = public.current_worker_id());
create policy workers_worker_update on public.workers for update to aubos_worker
  using (installation_id = public.current_installation_id() and id = public.current_worker_id())
  with check (installation_id = public.current_installation_id() and id = public.current_worker_id());

create policy roles_member_select on public.roles for select to authenticated
  using (public.is_installation_member(installation_id));
create policy roles_owner_insert on public.roles for insert to authenticated
  with check (
    public.is_installation_owner(installation_id)
    and created_by_person_id = public.current_person_id(installation_id)
  );
create policy worker_roles_member_select on public.worker_role_assignments for select to authenticated
  using (public.is_installation_member(installation_id));
create policy worker_roles_owner_insert on public.worker_role_assignments for insert to authenticated
  with check (
    public.is_installation_owner(installation_id)
    and assigned_by_person_id = public.current_person_id(installation_id)
  );

create policy work_member_select on public.work for select to authenticated
  using (public.is_installation_member(installation_id));
create policy work_member_insert on public.work for insert to authenticated
  with check (
    public.is_installation_member(installation_id)
    and requested_by_person_id = public.current_person_id(installation_id)
  );
create policy work_person_update on public.work for update to authenticated
  using (
    public.is_installation_owner(installation_id)
    or custodian_person_id = public.current_person_id(installation_id)
  )
  with check (public.is_installation_member(installation_id));
create policy work_worker_select on public.work for select to aubos_worker
  using (
    installation_id = public.current_installation_id()
    and custodian_worker_id = public.current_worker_id()
  );
create policy work_dependencies_member_select on public.work_dependencies for select to authenticated
  using (public.is_installation_member(installation_id));
create policy work_dependencies_member_insert on public.work_dependencies for insert to authenticated
  with check (public.is_installation_member(installation_id));

create policy policies_member_select on public.policies for select to authenticated
  using (public.is_installation_member(installation_id));
create policy policies_owner_insert on public.policies for insert to authenticated
  with check (
    public.is_installation_owner(installation_id)
    and created_by_person_id = public.current_person_id(installation_id)
  );
create policy grants_member_select on public.capability_grants for select to authenticated
  using (public.is_installation_member(installation_id));
create policy grants_worker_select on public.capability_grants for select to aubos_worker
  using (
    installation_id = public.current_installation_id()
    and principal_kind = 'worker'
    and worker_id = public.current_worker_id()
  );
create policy grants_owner_insert on public.capability_grants for insert to authenticated
  with check (
    public.is_installation_owner(installation_id)
    and granted_by_person_id = public.current_person_id(installation_id)
  );
create policy grant_revocations_member_select on public.capability_grant_revocations for select to authenticated
  using (public.is_installation_member(installation_id));
create policy grant_revocations_owner_insert on public.capability_grant_revocations for insert to authenticated
  with check (
    public.is_installation_owner(installation_id)
    and revoked_by_person_id = public.current_person_id(installation_id)
  );

create policy records_member_select on public.records for select to authenticated
  using (public.is_installation_member(installation_id));
create policy records_person_insert on public.records for insert to authenticated
  with check (
    public.is_installation_member(installation_id)
    and actor_person_id = public.current_person_id(installation_id)
    and actor_worker_id is null
    and (kind not in ('approval', 'decision') or public.is_installation_owner(installation_id))
  );
create policy records_worker_select on public.records for select to aubos_worker
  using (
    installation_id = public.current_installation_id()
    and public.worker_can_read_classification(classification)
    and (
      actor_worker_id = public.current_worker_id()
      or exists (
        select 1 from public.work work_row
        where work_row.id = records.work_id
          and work_row.installation_id = records.installation_id
          and work_row.custodian_worker_id = public.current_worker_id()
      )
    )
  );
create policy records_worker_insert on public.records for insert to aubos_worker
  with check (
    installation_id = public.current_installation_id()
    and actor_worker_id = public.current_worker_id()
    and actor_person_id is null
    and kind not in ('approval', 'decision')
    and supersedes_record_id is null
    and public.worker_can_read_classification(classification)
  );

grant usage on schema public to authenticated, aubos_worker;
grant select on public.installations, public.people to authenticated;
grant select, insert on public.roles, public.worker_role_assignments to authenticated;
grant select on public.workers to authenticated;
grant select, insert, update on public.work to authenticated;
grant select, insert on public.work_dependencies to authenticated;
grant select, insert on public.policies, public.capability_grants, public.capability_grant_revocations to authenticated;
grant select, insert on public.records to authenticated;
grant select on public.workers to aubos_worker;
grant update (
  provider, billing_realm, host, runtime, model, advertised_capabilities,
  data_classification_ceiling, isolation, network_policy, health, last_seen_at
) on public.workers to aubos_worker;
grant select on public.work to aubos_worker;
grant select on public.capability_grants to aubos_worker;
grant select, insert on public.records to aubos_worker;

commit;
