-- Authoritative, workspace-scoped module presentation projection.
--
-- Runtime clients may render only the exact module tuples stored for the
-- selected live workspace. Hostnames and ingress branding are presentation
-- hints and never create an activation or select workspace authority.

begin;

create table public.workspace_module_activations (
  installation_id uuid not null,
  workspace_id uuid not null,
  module_id text not null check (module_id ~ '^[a-z][a-z0-9-]*$'),
  contract_version text not null check (contract_version ~ '^v[1-9][0-9]*$'),
  label text not null check (length(trim(label)) between 1 and 80),
  navigation_order integer not null check (navigation_order between 0 and 10000),
  presentation_variant text not null
    check (presentation_variant ~ '^[a-z][a-z0-9-]*$'),
  created_by_person_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint workspace_module_activations_workspace_fk
    foreign key (installation_id, workspace_id)
    references public.workspaces(installation_id, id) on delete restrict,
  constraint workspace_module_activations_creator_fk
    foreign key (installation_id, workspace_id, created_by_person_id)
    references public.workspace_memberships(
      installation_id, workspace_id, person_id
    ) on delete restrict,
  constraint workspace_module_activations_supported_tuple check (
    contract_version = 'v1'
    and (
      module_id in (
        'command', 'opportunities', 'goals', 'tasks', 'tools', 'admin'
      ) and presentation_variant = 'standard'
      or module_id = 'factory'
        and presentation_variant = 'freed-read-only'
    )
  ),
  primary key (installation_id, workspace_id, module_id),
  unique (installation_id, workspace_id, navigation_order)
);

comment on table public.workspace_module_activations is
  'Explicit workspace-owned module tuples projected into the control plane. Empty means no modules are enabled; no installation or hostname default is inferred.';

alter table public.workspaces
  add column default_module_id text
    check (
      default_module_id is null
      or default_module_id ~ '^[a-z][a-z0-9-]*$'
    ),
  add constraint workspaces_default_module_activation_fk
    foreign key (installation_id, id, default_module_id)
    references public.workspace_module_activations(
      installation_id, workspace_id, module_id
    ) on delete restrict deferrable initially deferred;

comment on column public.workspaces.default_module_id is
  'Explicit default within this workspace module surface. Null is the fail-closed empty or unconfigured state.';

alter table public.workspace_module_activations enable row level security;

create policy workspace_module_activations_member_select
  on public.workspace_module_activations
  for select to authenticated
  using (public.is_workspace_member(installation_id, workspace_id));

revoke all on table public.workspace_module_activations
  from public, anon, authenticated, aubos_worker;
grant select on public.workspace_module_activations to authenticated;

commit;
