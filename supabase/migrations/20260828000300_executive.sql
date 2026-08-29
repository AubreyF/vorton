begin;

alter type public.record_kind add value if not exists 'review' after 'proposal';

create type public.worker_job_status as enum (
  'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'
);

create table public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null,
  work_id uuid not null,
  worker_id uuid not null,
  role_id uuid not null,
  provider text not null check (length(trim(provider)) > 0),
  model text not null check (length(trim(model)) > 0),
  provider_job_id text not null check (length(trim(provider_job_id)) > 0),
  status public.worker_job_status not null,
  store boolean not null default false,
  background boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_runs_work_fk foreign key (installation_id, work_id)
    references public.work(installation_id, id) on delete restrict,
  constraint worker_runs_worker_fk foreign key (installation_id, worker_id)
    references public.workers(installation_id, id) on delete restrict,
  constraint worker_runs_role_fk foreign key (installation_id, role_id)
    references public.roles(installation_id, id) on delete restrict,
  constraint worker_runs_no_personal_metadata check (
    not (metadata ?| array['person_id', 'personId', 'user', 'email', 'name'])
  ),
  constraint worker_runs_background_storage check (not background or store),
  unique (provider, provider_job_id),
  unique (installation_id, id)
);

comment on table public.worker_runs is
  'Provider job identity and status only. Model output grants no database or external action authority.';

create index worker_runs_work_created_idx
  on public.worker_runs(work_id, created_at desc);
create index worker_runs_worker_status_idx
  on public.worker_runs(worker_id, status, updated_at desc);

create function public.touch_worker_run() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger worker_runs_touch_updated_at
before update on public.worker_runs
for each row execute function public.touch_worker_run();

alter table public.worker_runs enable row level security;

create policy worker_runs_member_select on public.worker_runs for select to authenticated
  using (public.is_installation_member(installation_id));
create policy worker_runs_worker_select on public.worker_runs for select to aubos_worker
  using (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
  );
create policy worker_runs_worker_insert on public.worker_runs for insert to aubos_worker
  with check (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
    and public.worker_has_capability('executive.propose', 'recommend', work_id)
  );
create policy worker_runs_worker_update on public.worker_runs for update to aubos_worker
  using (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
    and public.worker_has_capability('executive.propose', 'recommend', work_id)
  )
  with check (
    installation_id = public.current_installation_id()
    and worker_id = public.current_worker_id()
  );

grant select on public.worker_runs to authenticated;
grant select, insert on public.worker_runs to aubos_worker;
grant update (status, error) on public.worker_runs to aubos_worker;

commit;
