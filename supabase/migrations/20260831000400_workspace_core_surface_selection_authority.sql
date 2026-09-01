-- Governed workspace core-surface selection authority.
--
-- Approval and application are separate same-person operations. Both require
-- a signed workspace-person context with recent AAL2, a live owner membership,
-- exact ready person-custodied Work, and the exact Work-scoped capability.
-- Empty plus no predecessor receipt is the only genesis state. Every later
-- surface is chained to the exact immutable receipt that installed it.

begin;

-- Migration 00300 published this table and one Freed-specific Factory
-- presentation value before governed receipt lineage existed. Keep both the
-- table name and those exact historical rows as bounded compatibility state.
-- The authority functions below accept only the generic read-only tuple and
-- reject every nonempty projection without an exact governed receipt. A later
-- receipt-bound installation upgrade must reconcile legacy rows explicitly.
-- This migration never rewrites or retroactively blesses them.

alter table public.workspace_module_activations
  drop constraint workspace_module_activations_supported_tuple;

-- Selection keeps installation-scoped person attribution, but current
-- presentation state must not pin a mutable workspace membership. Existing
-- revocation-ledger retention rules remain a separate membership-audit
-- contract and are not widened here.
alter table public.workspace_module_activations
  drop constraint workspace_module_activations_creator_fk,
  add constraint workspace_module_activations_creator_fk
    foreign key (installation_id, created_by_person_id)
    references public.people(installation_id, id) on delete restrict;

alter table public.workspace_module_activations
  add constraint workspace_module_activations_supported_tuple check (
    contract_version = 'v1'
    and (
      module_id in (
        'command', 'opportunities', 'goals', 'tasks', 'tools', 'admin'
      ) and presentation_variant = 'standard'
      or module_id = 'factory' and presentation_variant = 'read-only'
    )
  ) not valid;

comment on table public.workspace_module_activations is
  'Published legacy-named projection for seven compiled workspace core surfaces. Historical freed-read-only rows remain unreconciled compatibility state; governed selection accepts only read-only. Rows grant presentation only, never generic module or execution authority.';

-- A scalar SQL function whose SELECT finds no runtime-key row returns NULL,
-- even when the projected expression itself is coalesced. Older callers use
-- `if not validator(...)`; in PL/pgSQL, `if not null` does not enter the denial
-- branch. Keep the shared validators total so a missing key fails closed for
-- both this authority plane and every previously published caller.
create or replace function public.aubos_runtime_context_valid(
  expected_kind text,
  expected_installation text,
  expected_subject text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, extensions, aubos_private
as $$
  select coalesce((
    select coalesce(
      current_setting('aubos.context_kind', true) = expected_kind
      and current_setting('aubos.installation_id', true) =
        expected_installation
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
  ), false)
$$;

create or replace function public.aubos_runtime_context_valid(
  expected_kind text,
  expected_installation text,
  expected_workspace text,
  expected_subject text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, extensions, aubos_private
as $$
  select coalesce((
    select coalesce(
      current_setting('aubos.context_kind', true) = expected_kind
      and current_setting('aubos.installation_id', true) =
        expected_installation
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
  ), false)
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
  select coalesce((
    select coalesce(
      expected_installation
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and expected_workspace
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and expected_subject
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and current_setting('vorton.context_kind', true) = 'person'
      and current_setting('vorton.installation_id', true) =
        expected_installation
      and current_setting('vorton.workspace_id', true) = expected_workspace
      and current_setting('vorton.subject_id', true) = expected_subject
      and current_setting('vorton.credential_id', true) = ''
      and current_setting('vorton.context_signature', true) = encode(
        extensions.hmac(
          convert_to(
            txid_current()::text || '|person|' || expected_installation ||
            '|' || expected_workspace || '|' || expected_subject || '|',
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
            current_setting(
              'vorton.workspace_step_up_auth_time', true
            )::bigint
          ) <= approved_at
          and approved_at <= to_timestamp(
            current_setting(
              'vorton.workspace_step_up_auth_time', true
            )::bigint
          ) + interval '10 minutes'
        else false
      end
      and current_setting('vorton.workspace_step_up_signature', true) =
        encode(
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
  ), false)
$$;

create or replace function public.vorton_installation_step_up_context_valid(
  expected_installation text,
  expected_subject text
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public, aubos_private
as $$
  select coalesce((
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
  ), false)
$$;

alter table public.workspaces
  add column core_surface_selection_receipt_id uuid,
  add column core_surface_selection_receipt_hash text
    check (
      core_surface_selection_receipt_hash is null
      or core_surface_selection_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
    ),
  add constraint workspaces_core_surface_selection_lineage_pair check (
    (core_surface_selection_receipt_id is null) =
      (core_surface_selection_receipt_hash is null)
  );

create function public.workspace_compiled_core_surface_registry_document()
returns jsonb
language sql immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.compiled-core-surface-registry.v1',
    'surfaces', jsonb_build_array(
      jsonb_build_object(
        'id', 'command', 'contractVersion', 'v1',
        'label', 'Command Bridge', 'presentationVariant', 'standard'
      ),
      jsonb_build_object(
        'id', 'opportunities', 'contractVersion', 'v1',
        'label', 'Opportunities', 'presentationVariant', 'standard'
      ),
      jsonb_build_object(
        'id', 'goals', 'contractVersion', 'v1',
        'label', 'Goals', 'presentationVariant', 'standard'
      ),
      jsonb_build_object(
        'id', 'tasks', 'contractVersion', 'v1',
        'label', 'Tasks', 'presentationVariant', 'standard'
      ),
      jsonb_build_object(
        'id', 'tools', 'contractVersion', 'v1',
        'label', 'Tools', 'presentationVariant', 'standard'
      ),
      jsonb_build_object(
        'id', 'factory', 'contractVersion', 'v1',
        'label', 'Factory', 'presentationVariant', 'read-only'
      ),
      jsonb_build_object(
        'id', 'admin', 'contractVersion', 'v1',
        'label', 'Admin', 'presentationVariant', 'standard'
      )
    )
  )
$$;

do $$
begin
  if public.vorton_module_lifecycle_hash(
      public.workspace_compiled_core_surface_registry_document()
    ) <> 'sha256:f9ae99ad9b8a053f5fb3915e94efd130f6c5d9a00b4abc6037a0c4e73368bd93'
  then
    raise exception 'Compiled core-surface registry digest drifted';
  end if;
end
$$;

create function public.normalize_workspace_core_surface_preferences(value jsonb)
returns jsonb
language plpgsql immutable strict
set search_path = pg_catalog
as $$
declare
  item jsonb;
  item_id text;
  item_order_text text;
  item_order_numeric numeric;
  item_order integer;
  default_surface text;
  surface_count integer;
  surface_ids text[] := array[]::text[];
  navigation_orders integer[] := array[]::integer[];
  normalized_surfaces jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(value) <> 'object'
    or not value ?& array['defaultCoreSurfaceId', 'coreSurfaces']
    or (select count(*) from jsonb_object_keys(value)) <> 2
    or jsonb_typeof(value->'coreSurfaces') <> 'array'
  then
    raise exception 'Workspace core-surface preferences have an invalid shape';
  end if;

  surface_count := jsonb_array_length(value->'coreSurfaces');
  if surface_count > 7 then
    raise exception 'Workspace core-surface preferences exceed the registry';
  end if;

  if value->'defaultCoreSurfaceId' = 'null'::jsonb then
    default_surface := null;
  elsif jsonb_typeof(value->'defaultCoreSurfaceId') = 'string'
    and value->>'defaultCoreSurfaceId' in (
      'command', 'opportunities', 'goals', 'tasks', 'tools', 'factory', 'admin'
    )
  then
    default_surface := value->>'defaultCoreSurfaceId';
  else
    raise exception 'Workspace default core-surface preference is invalid';
  end if;

  for item in
    select entry from jsonb_array_elements(value->'coreSurfaces') entry
  loop
    if jsonb_typeof(item) <> 'object'
      or not item ?& array['id', 'navigationOrder']
      or (select count(*) from jsonb_object_keys(item)) <> 2
      or jsonb_typeof(item->'id') <> 'string'
      or jsonb_typeof(item->'navigationOrder') <> 'number'
    then
      raise exception 'Workspace core-surface preference has an invalid shape';
    end if;
    item_id := item->>'id';
    item_order_text := item->>'navigationOrder';
    item_order_numeric := item_order_text::numeric;
    if item_id not in (
        'command', 'opportunities', 'goals', 'tasks', 'tools', 'factory', 'admin'
      )
      or item_order_numeric <> trunc(item_order_numeric)
      or item_order_numeric < 0
      or item_order_numeric > 10000
    then
      raise exception 'Workspace core-surface preference is invalid';
    end if;
    item_order := item_order_numeric::integer;
    if item_id = any(surface_ids) or item_order = any(navigation_orders) then
      raise exception 'Workspace core-surface preferences must be unique';
    end if;
    surface_ids := array_append(surface_ids, item_id);
    navigation_orders := array_append(navigation_orders, item_order);
  end loop;

  if surface_count = 0 and default_surface is not null then
    raise exception 'Empty core-surface preferences require a null default';
  end if;
  if surface_count > 0 and (
      default_surface is null or not default_surface = any(surface_ids)
    )
  then
    raise exception 'Core-surface default must be a selected registry entry';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', entry->>'id',
      'navigationOrder', (entry->>'navigationOrder')::integer
    ) order by (entry->>'navigationOrder')::integer, entry->>'id'
  ), '[]'::jsonb)
    into normalized_surfaces
    from jsonb_array_elements(value->'coreSurfaces') entry;

  return jsonb_build_object(
    'defaultCoreSurfaceId', case when default_surface is null then 'null'::jsonb
      else to_jsonb(default_surface) end,
    'coreSurfaces', normalized_surfaces
  );
end
$$;

create function public.derive_workspace_core_surface(value jsonb)
returns jsonb
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  preferences jsonb;
  derived_modules jsonb;
begin
  preferences := public.normalize_workspace_core_surface_preferences(value);
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', entry->>'id',
      'contractVersion', 'v1',
      'label', case entry->>'id'
        when 'command' then 'Command Bridge'
        when 'opportunities' then 'Opportunities'
        when 'goals' then 'Goals'
        when 'tasks' then 'Tasks'
        when 'tools' then 'Tools'
        when 'factory' then 'Factory'
        when 'admin' then 'Admin'
      end,
      'navigationOrder', (entry->>'navigationOrder')::integer,
      'presentationVariant', case when entry->>'id' = 'factory'
        then 'read-only' else 'standard' end
    ) order by (entry->>'navigationOrder')::integer, entry->>'id'
  ), '[]'::jsonb)
    into derived_modules
    from jsonb_array_elements(preferences->'coreSurfaces') entry;

  return jsonb_build_object(
    'defaultModuleId', preferences->'defaultCoreSurfaceId',
    'modules', derived_modules
  );
end
$$;

create function public.normalize_workspace_core_surface(value jsonb)
returns jsonb
language plpgsql immutable strict
set search_path = pg_catalog
as $$
declare
  item jsonb;
  item_id text;
  item_version text;
  item_label text;
  item_order_text text;
  item_order_numeric numeric;
  item_order integer;
  item_variant text;
  expected_label text;
  expected_variant text;
  default_module text;
  module_count integer;
  module_ids text[] := array[]::text[];
  navigation_orders integer[] := array[]::integer[];
  normalized_modules jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(value) <> 'object'
    or not value ?& array['defaultModuleId', 'modules']
    or (select count(*) from jsonb_object_keys(value)) <> 2
    or jsonb_typeof(value->'modules') <> 'array'
  then
    raise exception 'Workspace core surface must have exact default and modules fields';
  end if;

  module_count := jsonb_array_length(value->'modules');
  if module_count > 7 then
    raise exception 'Workspace core surface exceeds the supported surface count';
  end if;

  if value->'defaultModuleId' = 'null'::jsonb then
    default_module := null;
  elsif jsonb_typeof(value->'defaultModuleId') = 'string'
    and value->>'defaultModuleId' in (
      'command', 'opportunities', 'goals', 'tasks', 'tools', 'factory', 'admin'
    )
  then
    default_module := value->>'defaultModuleId';
  else
    raise exception 'Workspace default core surface is invalid';
  end if;

  for item in select entry from jsonb_array_elements(value->'modules') entry
  loop
    if jsonb_typeof(item) <> 'object'
      or not item ?& array[
        'id', 'contractVersion', 'label', 'navigationOrder',
        'presentationVariant'
      ]
      or (select count(*) from jsonb_object_keys(item)) <> 5
      or jsonb_typeof(item->'id') <> 'string'
      or jsonb_typeof(item->'contractVersion') <> 'string'
      or jsonb_typeof(item->'label') <> 'string'
      or jsonb_typeof(item->'navigationOrder') <> 'number'
      or jsonb_typeof(item->'presentationVariant') <> 'string'
    then
      raise exception 'Workspace core-surface tuple has an invalid shape';
    end if;

    item_id := item->>'id';
    item_version := item->>'contractVersion';
    item_label := item->>'label';
    item_order_text := item->>'navigationOrder';
    item_order_numeric := item_order_text::numeric;
    item_variant := item->>'presentationVariant';

    if item_order_numeric <> trunc(item_order_numeric)
      or item_order_numeric < 0
      or item_order_numeric > 10000
    then
      raise exception 'Workspace core-surface navigation order is invalid';
    end if;
    item_order := item_order_numeric::integer;
    expected_label := case item_id
      when 'command' then 'Command Bridge'
      when 'opportunities' then 'Opportunities'
      when 'goals' then 'Goals'
      when 'tasks' then 'Tasks'
      when 'tools' then 'Tools'
      when 'factory' then 'Factory'
      when 'admin' then 'Admin'
    end;
    expected_variant := case when item_id = 'factory'
      then 'read-only' else 'standard' end;
    if item_version <> 'v1'
      or expected_label is null
      or item_label <> expected_label
      or item_variant <> expected_variant
    then
      raise exception 'Unsupported workspace core-surface tuple';
    end if;
    if item_id = any(module_ids) then
      raise exception 'Workspace core-surface identifiers must be unique';
    end if;
    if item_order = any(navigation_orders) then
      raise exception 'Workspace core-surface navigation orders must be unique';
    end if;
    module_ids := array_append(module_ids, item_id);
    navigation_orders := array_append(navigation_orders, item_order);
  end loop;

  if module_count = 0 and default_module is not null then
    raise exception 'An empty core surface requires a null default';
  end if;
  if module_count > 0 and default_module is null then
    raise exception 'A nonempty core surface requires a default';
  end if;
  if default_module is not null and not default_module = any(module_ids) then
    raise exception 'Workspace default core surface must be selected';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', entry->>'id',
      'contractVersion', entry->>'contractVersion',
      'label', entry->>'label',
      'navigationOrder', (entry->>'navigationOrder')::integer,
      'presentationVariant', entry->>'presentationVariant'
    ) order by (entry->>'navigationOrder')::integer, entry->>'id'
  ), '[]'::jsonb)
    into normalized_modules
    from jsonb_array_elements(value->'modules') entry;

  return jsonb_build_object(
    'defaultModuleId', case when default_module is null then 'null'::jsonb
      else to_jsonb(default_module) end,
    'modules', normalized_modules
  );
end
$$;

create function public.workspace_core_surface_document(
  target_installation_id uuid,
  target_workspace_id uuid
) returns jsonb
language sql stable strict
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'defaultModuleId', case when workspace.default_module_id is null
      then 'null'::jsonb else to_jsonb(workspace.default_module_id) end,
    'modules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', projection.module_id,
          'contractVersion', projection.contract_version,
          'label', projection.label,
          'navigationOrder', projection.navigation_order,
          'presentationVariant', projection.presentation_variant
        ) order by projection.navigation_order, projection.module_id
      )
        from public.workspace_module_activations projection
       where projection.installation_id = workspace.installation_id
         and projection.workspace_id = workspace.id
    ), '[]'::jsonb)
  )
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
$$;

create function public.workspace_core_surface_selection_work_snapshot(
  value public.work
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'id', value.id::text,
    'vortonInstallationId', value.installation_id::text,
    'workspaceId', value.workspace_id::text,
    'title', value.title,
    'requestedOutcome', value.requested_outcome,
    'acceptanceCriteria', value.acceptance_criteria,
    'state', value.state::text,
    'priority', value.priority,
    'parentWorkId', case when value.parent_work_id is null then null
      else to_jsonb(value.parent_work_id::text) end,
    'requestedByPersonId', case when value.requested_by_person_id is null
      then null else to_jsonb(value.requested_by_person_id::text) end,
    'custodianPersonId', value.custodian_person_id::text,
    'custodianWorkerId', 'null'::jsonb,
    'leaseExpiresAt', 'null'::jsonb,
    'createdAt', to_char(
      value.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'updatedAt', to_char(
      value.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  )
$$;

create table public.workspace_core_surface_selection_approvals (
  approval_record_id uuid primary key,
  approval_id uuid not null,
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  owner_person_id uuid not null,
  owner_membership_kind public.person_kind not null default 'owner',
  work_id uuid not null,
  work_snapshot jsonb not null,
  work_snapshot_hash text not null
    check (work_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_content_sha256 text not null
    check (policy_content_sha256 ~ '^[a-f0-9]{64}$'),
  capability_grant_id uuid not null,
  current_surface jsonb not null,
  current_surface_hash text not null
    check (current_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  predecessor_receipt_id uuid,
  predecessor_receipt_hash text
    check (
      predecessor_receipt_hash is null
      or predecessor_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
    ),
  target_surface jsonb not null,
  target_surface_hash text not null
    check (target_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  binding jsonb not null,
  authority jsonb not null,
  approval_plane text not null check (approval_plane = 'workspace-postgres'),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  owner_membership_verified_at timestamptz not null,
  policy_verified_at timestamptz not null,
  capability_grant_verified_at timestamptz not null,
  work_verified_at timestamptz not null,
  current_surface_verified_at timestamptz not null,
  scope jsonb not null,
  roles_grant_authority boolean not null check (not roles_grant_authority),
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null,
  constraint workspace_core_surface_selection_approvals_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_core_surface_selection_approvals_owner_person_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_core_surface_selection_approvals_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_approvals_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_approvals_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_approvals_record_fk
    foreign key (installation_id, workspace_id, approval_record_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint workspace_core_surface_selection_approvals_owner_kind check (
    owner_membership_kind = 'owner'
  ),
  constraint workspace_core_surface_selection_approvals_surface_check check (
    current_surface = public.normalize_workspace_core_surface(current_surface)
    and target_surface = public.normalize_workspace_core_surface(target_surface)
    and target_surface = public.derive_workspace_core_surface(
      binding->'targetPreferences'
    )
    and public.vorton_module_lifecycle_hash(current_surface) =
      current_surface_hash
    and public.vorton_module_lifecycle_hash(target_surface) =
      target_surface_hash
    and current_surface <> target_surface
    and current_surface_hash <> target_surface_hash
    and (
      (predecessor_receipt_id is null and predecessor_receipt_hash is null
        and jsonb_array_length(current_surface->'modules') = 0)
      or
      (predecessor_receipt_id is not null
        and predecessor_receipt_hash is not null)
    )
  ),
  constraint workspace_core_surface_selection_approvals_work_snapshot check (
    jsonb_typeof(work_snapshot) = 'object'
    and work_snapshot->>'id' = work_id::text
    and work_snapshot->>'vortonInstallationId' = installation_id::text
    and work_snapshot->>'workspaceId' = workspace_id::text
    and work_snapshot->>'state' = 'ready'
    and work_snapshot->>'custodianPersonId' = owner_person_id::text
    and work_snapshot->'custodianWorkerId' = 'null'::jsonb
    and work_snapshot->'leaseExpiresAt' = 'null'::jsonb
    and public.vorton_module_lifecycle_hash(work_snapshot) = work_snapshot_hash
  ),
  constraint workspace_core_surface_selection_approvals_binding_check check (
    binding = jsonb_build_object(
      'vortonInstallationId', installation_id::text,
      'workspaceId', workspace_id::text,
      'realm', realm::text,
      'workId', work_id::text,
      'workSnapshotSha256', work_snapshot_hash,
      'currentSurface', current_surface,
      'currentSurfaceSha256', current_surface_hash,
      'compiledRegistrySha256',
        'sha256:f9ae99ad9b8a053f5fb3915e94efd130f6c5d9a00b4abc6037a0c4e73368bd93',
      'predecessorCoreSurfaceSelectionReceipt',
        case when predecessor_receipt_id is null then 'null'::jsonb
          else jsonb_build_object(
            'receiptId', predecessor_receipt_id::text,
            'receiptSha256', predecessor_receipt_hash
          ) end,
      'targetPreferences', public.normalize_workspace_core_surface_preferences(
        binding->'targetPreferences'
      ),
      'targetSurface', target_surface,
      'targetSurfaceSha256', target_surface_hash
    )
  ),
  constraint workspace_core_surface_selection_approvals_authority_check check (
    authority = jsonb_build_object(
      'principalKind', 'person',
      'personId', owner_person_id::text,
      'workspaceMembershipKind', 'owner',
      'capability', 'workspace.core-surface.select',
      'mode', 'modify',
      'workId', work_id::text,
      'policyId', policy_id::text,
      'policySha256', 'sha256:' || policy_content_sha256,
      'capabilityGrantId', capability_grant_id::text,
      'workScoped', true,
      'rolesGrantAuthority', false
    )
  ),
  constraint workspace_core_surface_selection_approvals_time_check check (
    approved_at = date_trunc('milliseconds', approved_at)
    and expires_at = date_trunc('milliseconds', expires_at)
    and created_at = approved_at
    and owner_membership_verified_at = approved_at
    and policy_verified_at = approved_at
    and capability_grant_verified_at = approved_at
    and work_verified_at = approved_at
    and current_surface_verified_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
    and expires_at > approved_at
    and expires_at <= approved_at + interval '24 hours'
  ),
  constraint workspace_core_surface_selection_approvals_scope_check check (
    scope = '{
      "action": "workspace.core-surface.select",
      "compiledCoreSurfaceOnly": true,
      "defaultModuleProjectionOnly": true,
      "moduleReleaseAdmission": false,
      "infrastructureMutation": false,
      "otherWorkspaceRead": false,
      "otherWorkspaceMutation": false,
      "externalSystemMutation": false
    }'::jsonb
  ),
  constraint workspace_core_surface_selection_approvals_distinct_ids check (
    approval_id <> approval_record_id
    and approval_id <> work_id
    and approval_id <> policy_id
    and approval_id <> capability_grant_id
    and approval_record_id <> work_id
    and approval_record_id <> policy_id
    and approval_record_id <> capability_grant_id
    and work_id <> policy_id
    and work_id <> capability_grant_id
    and policy_id <> capability_grant_id
    and (predecessor_receipt_id is null or predecessor_receipt_id not in (
      approval_id, approval_record_id, work_id, policy_id,
      capability_grant_id
    ))
  ),
  constraint workspace_core_surface_selection_approvals_distinct_hashes check (
    work_snapshot_hash <> current_surface_hash
    and work_snapshot_hash <> target_surface_hash
    and work_snapshot_hash <> 'sha256:' || policy_content_sha256
    and current_surface_hash <> target_surface_hash
    and current_surface_hash <> 'sha256:' || policy_content_sha256
    and target_surface_hash <> 'sha256:' || policy_content_sha256
    and (predecessor_receipt_hash is null or predecessor_receipt_hash not in (
      work_snapshot_hash, current_surface_hash, target_surface_hash,
      'sha256:' || policy_content_sha256
    ))
  ),
  unique (installation_id, workspace_id, approval_id)
);

create function public.workspace_core_surface_selection_approval_core_document(
  value public.workspace_core_surface_selection_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-core-surface-selection-approval.v1',
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalPlane', value.approval_plane,
    'ownerPersonId', value.owner_person_id::text,
    'binding', value.binding,
    'authority', value.authority,
    'approvedAt', to_char(
      value.approved_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      value.expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'aal2VerifiedAt', to_char(
      value.aal2_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'assuranceLevel', value.assurance_level,
    'ownerMembershipVerifiedAt', to_char(
      value.owner_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'policyVerifiedAt', to_char(
      value.policy_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'capabilityGrantVerifiedAt', to_char(
      value.capability_grant_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'workVerifiedAt', to_char(
      value.work_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'currentSurfaceVerifiedAt', to_char(
      value.current_surface_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'scope', value.scope,
    'rolesGrantAuthority', value.roles_grant_authority
  )
$$;

create function public.derive_workspace_core_surface_selection_approval_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.work_snapshot_hash := public.vorton_module_lifecycle_hash(
    new.work_snapshot
  );
  new.current_surface_hash := public.vorton_module_lifecycle_hash(
    new.current_surface
  );
  new.target_surface_hash := public.vorton_module_lifecycle_hash(
    new.target_surface
  );
  new.approval_hash := public.vorton_module_lifecycle_hash(
    public.workspace_core_surface_selection_approval_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_core_surface_selection_approvals_derive_hash
before insert on public.workspace_core_surface_selection_approvals
for each row execute function
  public.derive_workspace_core_surface_selection_approval_hash();

create table public.workspace_core_surface_selection_approval_receipts (
  receipt_id uuid primary key,
  approval_record_id uuid not null,
  approval_id uuid not null,
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  owner_person_id uuid not null,
  work_id uuid not null,
  work_snapshot_hash text not null
    check (work_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_content_sha256 text not null
    check (policy_content_sha256 ~ '^[a-f0-9]{64}$'),
  capability_grant_id uuid not null,
  current_surface_hash text not null
    check (current_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  predecessor_receipt_id uuid,
  predecessor_receipt_hash text
    check (
      predecessor_receipt_hash is null
      or predecessor_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
    ),
  target_surface_hash text not null
    check (target_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  binding jsonb not null,
  authority jsonb not null,
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  receipt_plane text not null check (receipt_plane = 'workspace-postgres'),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  owner_membership_verified_at timestamptz not null,
  policy_verified_at timestamptz not null,
  capability_grant_verified_at timestamptz not null,
  work_verified_at timestamptz not null,
  current_surface_verified_at timestamptz not null,
  scope jsonb not null,
  roles_grant_authority boolean not null check (not roles_grant_authority),
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint workspace_core_surface_selection_approval_receipts_approval_fk
    foreign key (approval_record_id)
    references public.workspace_core_surface_selection_approvals(
      approval_record_id
    ) on delete restrict,
  constraint workspace_core_surface_selection_approval_receipts_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_core_surface_selection_approval_receipts_owner_person_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_core_surface_selection_approval_receipts_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_approval_receipts_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_approval_receipts_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_approval_receipts_time_check check (
    created_at = approved_at
    and owner_membership_verified_at = approved_at
    and policy_verified_at = approved_at
    and capability_grant_verified_at = approved_at
    and work_verified_at = approved_at
    and current_surface_verified_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
  ),
  constraint workspace_core_surface_selection_approval_receipts_effects_check check (
    effects = '{
      "approvalCreated": true,
      "approvalConsumed": false,
      "coreSurfaceProjectionMutated": false,
      "defaultCoreSurfaceProjectionMutated": false,
      "coreSurfaceSelectionLineageMutated": false,
      "moduleReleaseAdmitted": false,
      "infrastructureMutated": false,
      "otherWorkspaceRead": false,
      "otherWorkspaceMutation": false,
      "workMutated": false,
      "policyMutated": false,
      "capabilityGrantMutated": false,
      "externalSystemMutated": false,
      "artifactResolved": false,
      "artifactLoaded": false,
      "moduleRuntimeStarted": false,
      "moduleAdmitted": false,
      "moduleMigrated": false,
      "privateConsumerAuthorityGranted": false
    }'::jsonb
  ),
  constraint workspace_core_surface_selection_approval_receipts_distinct_ids check (
    receipt_id not in (
      approval_id, approval_record_id, work_id, policy_id,
      capability_grant_id
    )
    and (predecessor_receipt_id is null or predecessor_receipt_id not in (
      receipt_id, approval_id, approval_record_id, work_id, policy_id,
      capability_grant_id
    ))
  ),
  constraint workspace_core_surface_selection_approval_receipts_distinct_hashes check (
    receipt_hash not in (
      approval_hash, work_snapshot_hash, current_surface_hash,
      target_surface_hash, 'sha256:' || policy_content_sha256
    )
    and approval_hash not in (
      work_snapshot_hash, current_surface_hash, target_surface_hash,
      'sha256:' || policy_content_sha256
    )
    and (predecessor_receipt_hash is null or predecessor_receipt_hash not in (
      receipt_hash, approval_hash, work_snapshot_hash, current_surface_hash,
      target_surface_hash, 'sha256:' || policy_content_sha256
    ))
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (installation_id, workspace_id, receipt_id),
  unique (installation_id, workspace_id, receipt_id, receipt_hash),
  unique (approval_record_id),
  unique (receipt_id, approval_id, approval_hash, receipt_hash)
);

create function
  public.workspace_core_surface_selection_approval_receipt_core_document(
    value public.workspace_core_surface_selection_approval_receipts
  ) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-core-surface-selection-approval-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', value.receipt_plane,
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalHash', value.approval_hash,
    'ownerPersonId', value.owner_person_id::text,
    'binding', value.binding,
    'authority', value.authority,
    'approvedAt', to_char(
      value.approved_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      value.expires_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdAt', to_char(
      value.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'aal2VerifiedAt', to_char(
      value.aal2_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'assuranceLevel', value.assurance_level,
    'ownerMembershipVerifiedAt', to_char(
      value.owner_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'policyVerifiedAt', to_char(
      value.policy_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'capabilityGrantVerifiedAt', to_char(
      value.capability_grant_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'workVerifiedAt', to_char(
      value.work_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'currentSurfaceVerifiedAt', to_char(
      value.current_surface_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'scope', value.scope,
    'rolesGrantAuthority', value.roles_grant_authority,
    'effects', value.effects
  )
$$;

create function
  public.derive_workspace_core_surface_selection_approval_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  approval public.workspace_core_surface_selection_approvals;
begin
  select * into approval
    from public.workspace_core_surface_selection_approvals existing
   where existing.approval_record_id = new.approval_record_id;
  if approval.approval_record_id is null
    or new.approval_id is distinct from approval.approval_id
    or new.installation_id is distinct from approval.installation_id
    or new.workspace_id is distinct from approval.workspace_id
    or new.realm is distinct from approval.realm
    or new.owner_person_id is distinct from approval.owner_person_id
    or new.work_id is distinct from approval.work_id
    or new.work_snapshot_hash is distinct from approval.work_snapshot_hash
    or new.policy_id is distinct from approval.policy_id
    or new.policy_content_sha256 is distinct from
      approval.policy_content_sha256
    or new.capability_grant_id is distinct from
      approval.capability_grant_id
    or new.current_surface_hash is distinct from
      approval.current_surface_hash
    or new.predecessor_receipt_id is distinct from
      approval.predecessor_receipt_id
    or new.predecessor_receipt_hash is distinct from
      approval.predecessor_receipt_hash
    or new.target_surface_hash is distinct from approval.target_surface_hash
    or new.binding is distinct from approval.binding
    or new.authority is distinct from approval.authority
    or new.approval_hash is distinct from approval.approval_hash
    or new.approved_at is distinct from approval.approved_at
    or new.expires_at is distinct from approval.expires_at
    or new.aal2_verified_at is distinct from approval.aal2_verified_at
    or new.scope is distinct from approval.scope
    or new.roles_grant_authority is distinct from
      approval.roles_grant_authority
  then
    raise exception 'Workspace core-surface selection approval integrity failure';
  end if;
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.workspace_core_surface_selection_approval_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_core_surface_selection_approval_receipts_derive_hash
before insert on public.workspace_core_surface_selection_approval_receipts
for each row execute function
  public.derive_workspace_core_surface_selection_approval_receipt_hash();

create function public.workspace_core_surface_selection_approval_document(
  approval public.workspace_core_surface_selection_approvals,
  receipt public.workspace_core_surface_selection_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_core_surface_selection_approval_core_document(approval) ||
    jsonb_build_object(
      'approvalReceiptId', receipt.receipt_id::text,
      'approvalReceiptSha256', receipt.receipt_hash
    )
$$;

create function public.workspace_core_surface_selection_approval_receipt_document(
  value public.workspace_core_surface_selection_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_core_surface_selection_approval_receipt_core_document(
    value
  ) || jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create table public.workspace_core_surface_selection_receipts (
  receipt_id uuid primary key,
  approval_record_id uuid not null,
  approval_id uuid not null,
  approval_receipt_id uuid not null,
  approval_receipt_hash text not null
    check (approval_receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  owner_person_id uuid not null,
  work_id uuid not null,
  work_snapshot_hash text not null
    check (work_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_content_sha256 text not null
    check (policy_content_sha256 ~ '^[a-f0-9]{64}$'),
  capability_grant_id uuid not null,
  current_surface_hash text not null
    check (current_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  predecessor_receipt_id uuid,
  predecessor_receipt_hash text
    check (
      predecessor_receipt_hash is null
      or predecessor_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
    ),
  target_surface_hash text not null
    check (target_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  binding jsonb not null,
  authority jsonb not null,
  scope jsonb not null,
  approved_by_person_id uuid not null,
  applied_by_person_id uuid not null,
  approval_consumption_count integer not null
    check (approval_consumption_count = 1),
  approval_consumed_at timestamptz not null,
  applied_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  owner_membership_verified_at timestamptz not null,
  policy_verified_at timestamptz not null,
  capability_grant_verified_at timestamptz not null,
  work_snapshot_verified_at timestamptz not null,
  current_surface_verified_at timestamptz not null,
  preimage_surface jsonb not null,
  preimage_surface_hash text not null
    check (preimage_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  postimage_surface jsonb not null,
  postimage_surface_hash text not null
    check (postimage_surface_hash ~ '^sha256:[a-f0-9]{64}$'),
  row_counts jsonb not null,
  idempotency jsonb not null,
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint workspace_core_surface_selection_receipts_approval_fk
    foreign key (approval_record_id)
    references public.workspace_core_surface_selection_approvals(
      approval_record_id
    ) on delete restrict,
  constraint workspace_core_surface_selection_receipts_approval_receipt_fk
    foreign key (approval_receipt_id)
    references public.workspace_core_surface_selection_approval_receipts(
      receipt_id
    ) on delete restrict,
  constraint workspace_core_surface_selection_receipts_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_core_surface_selection_receipts_applier_person_fk
    foreign key (installation_id, applied_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_core_surface_selection_receipts_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_receipts_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_receipts_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_core_surface_selection_receipts_record_fk
    foreign key (installation_id, workspace_id, receipt_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint workspace_core_surface_selection_receipts_same_actor check (
    approved_by_person_id = owner_person_id
    and applied_by_person_id = owner_person_id
  ),
  constraint workspace_core_surface_selection_receipts_surface_check check (
    preimage_surface = public.normalize_workspace_core_surface(
      preimage_surface
    )
    and postimage_surface = public.normalize_workspace_core_surface(
      postimage_surface
    )
    and preimage_surface = binding->'currentSurface'
    and preimage_surface_hash = current_surface_hash
    and preimage_surface_hash = public.vorton_module_lifecycle_hash(
      preimage_surface
    )
    and postimage_surface = binding->'targetSurface'
    and postimage_surface_hash = target_surface_hash
    and postimage_surface_hash = public.vorton_module_lifecycle_hash(
      postimage_surface
    )
  ),
  constraint workspace_core_surface_selection_receipts_predecessor_check check (
    binding->'predecessorCoreSurfaceSelectionReceipt' =
      case when predecessor_receipt_id is null then 'null'::jsonb
        else jsonb_build_object(
          'receiptId', predecessor_receipt_id::text,
          'receiptSha256', predecessor_receipt_hash
        ) end
  ),
  constraint workspace_core_surface_selection_receipts_time_check check (
    approval_consumed_at = date_trunc('milliseconds', approval_consumed_at)
    and applied_at = approval_consumed_at
    and owner_membership_verified_at = applied_at
    and policy_verified_at = applied_at
    and capability_grant_verified_at = applied_at
    and work_snapshot_verified_at = applied_at
    and current_surface_verified_at = applied_at
    and aal2_verified_at <= applied_at
    and applied_at <= aal2_verified_at + interval '10 minutes'
  ),
  constraint workspace_core_surface_selection_receipts_row_counts_check check (
    row_counts = jsonb_build_object(
      'preimageCoreSurfaceRows', jsonb_array_length(preimage_surface->'modules'),
      'deletedCoreSurfaceRows', jsonb_array_length(preimage_surface->'modules'),
      'insertedCoreSurfaceRows', jsonb_array_length(postimage_surface->'modules'),
      'postimageCoreSurfaceRows', jsonb_array_length(postimage_surface->'modules'),
      'defaultCoreSurfaceRowsUpdated', 1,
      'coreSurfaceSelectionLineageRowsUpdated', 1,
      'otherWorkspaceRowsRead', 0,
      'otherWorkspaceRowsMutated', 0
    )
  ),
  constraint workspace_core_surface_selection_receipts_idempotency_check check (
    idempotency = jsonb_build_object(
      'key', receipt_id::text,
      'exactReplayReturnsSameReceipt', true,
      'conflictingReplayDenied', true,
      'additionalProjectionMutationsOnReplay', 0
    )
  ),
  constraint workspace_core_surface_selection_receipts_effects_check check (
    effects = '{
      "approvalConsumed": true,
      "coreSurfaceProjectionReplaced": true,
      "defaultCoreSurfaceProjectionReplaced": true,
      "coreSurfaceSelectionLineageAdvanced": true,
      "moduleReleaseAdmitted": false,
      "infrastructureMutated": false,
      "otherWorkspaceRead": false,
      "otherWorkspaceMutation": false,
      "workMutated": false,
      "policyMutated": false,
      "capabilityGrantMutated": false,
      "externalSystemMutated": false,
      "artifactResolved": false,
      "artifactLoaded": false,
      "moduleRuntimeStarted": false,
      "moduleAdmitted": false,
      "moduleMigrated": false,
      "privateConsumerAuthorityGranted": false
    }'::jsonb
  ),
  constraint workspace_core_surface_selection_receipts_distinct_ids check (
    receipt_id not in (
      approval_id, approval_record_id, approval_receipt_id, work_id,
      policy_id, capability_grant_id
    )
    and (predecessor_receipt_id is null or predecessor_receipt_id not in (
      receipt_id, approval_id, approval_record_id, approval_receipt_id,
      work_id, policy_id, capability_grant_id
    ))
  ),
  constraint workspace_core_surface_selection_receipts_distinct_hashes check (
    receipt_hash not in (
      approval_receipt_hash, approval_hash, work_snapshot_hash,
      current_surface_hash, target_surface_hash,
      'sha256:' || policy_content_sha256
    )
    and approval_receipt_hash not in (
      approval_hash, work_snapshot_hash, current_surface_hash,
      target_surface_hash, 'sha256:' || policy_content_sha256
    )
    and (predecessor_receipt_hash is null or predecessor_receipt_hash not in (
      receipt_hash, approval_receipt_hash, approval_hash, work_snapshot_hash,
      current_surface_hash, target_surface_hash,
      'sha256:' || policy_content_sha256
    ))
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (installation_id, workspace_id, receipt_id),
  unique (installation_id, workspace_id, receipt_id, receipt_hash),
  constraint workspace_core_surface_selection_receipts_linear_successor unique (
    installation_id, workspace_id, predecessor_receipt_id,
    predecessor_receipt_hash
  ),
  unique (approval_receipt_id)
);

create unique index workspace_core_surface_selection_receipts_one_genesis_idx
  on public.workspace_core_surface_selection_receipts(
    installation_id, workspace_id
  )
  where predecessor_receipt_id is null
    and predecessor_receipt_hash is null;

alter table public.workspaces
  add constraint workspaces_core_surface_selection_lineage_fk
    foreign key (
      installation_id, id, core_surface_selection_receipt_id,
      core_surface_selection_receipt_hash
    ) references public.workspace_core_surface_selection_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict deferrable initially deferred;

alter table public.workspace_core_surface_selection_approvals
  add constraint workspace_core_surface_selection_approvals_predecessor_fk
    foreign key (
      installation_id, workspace_id, predecessor_receipt_id,
      predecessor_receipt_hash
    ) references public.workspace_core_surface_selection_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict;

alter table public.workspace_core_surface_selection_receipts
  add constraint workspace_core_surface_selection_receipts_predecessor_fk
    foreign key (
      installation_id, workspace_id, predecessor_receipt_id,
      predecessor_receipt_hash
    ) references public.workspace_core_surface_selection_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict;

create function public.workspace_core_surface_selection_receipt_core_document(
  value public.workspace_core_surface_selection_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-core-surface-selection-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', 'workspace-postgres',
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalReceiptId', value.approval_receipt_id::text,
    'approvalReceiptSha256', value.approval_receipt_hash,
    'approvalHash', value.approval_hash,
    'binding', value.binding,
    'authority', value.authority,
    'scope', value.scope,
    'approvedByPersonId', value.approved_by_person_id::text,
    'appliedByPersonId', value.applied_by_person_id::text,
    'approvalConsumptionCount', value.approval_consumption_count,
    'approvalConsumedAt', to_char(
      value.approval_consumed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'appliedAt', to_char(
      value.applied_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'aal2VerifiedAt', to_char(
      value.aal2_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'assuranceLevel', value.assurance_level,
    'ownerMembershipVerifiedAt', to_char(
      value.owner_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'policyVerifiedAt', to_char(
      value.policy_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'capabilityGrantVerifiedAt', to_char(
      value.capability_grant_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'workSnapshotVerifiedAt', to_char(
      value.work_snapshot_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'currentSurfaceVerifiedAt', to_char(
      value.current_surface_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'predecessorCoreSurfaceSelectionReceipt',
      case when value.predecessor_receipt_id is null then 'null'::jsonb
        else jsonb_build_object(
          'receiptId', value.predecessor_receipt_id::text,
          'receiptSha256', value.predecessor_receipt_hash
        ) end,
    'preimageSurface', value.preimage_surface,
    'preimageSurfaceSha256', value.preimage_surface_hash,
    'postimageSurface', value.postimage_surface,
    'postimageSurfaceSha256', value.postimage_surface_hash,
    'rowCounts', value.row_counts,
    'idempotency', value.idempotency,
    'effects', value.effects
  )
$$;

create function public.derive_workspace_core_surface_selection_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  approval public.workspace_core_surface_selection_approvals;
  approval_receipt public.workspace_core_surface_selection_approval_receipts;
begin
  select * into approval
    from public.workspace_core_surface_selection_approvals existing
   where existing.approval_record_id = new.approval_record_id;
  select * into approval_receipt
    from public.workspace_core_surface_selection_approval_receipts existing
   where existing.receipt_id = new.approval_receipt_id;
  if approval.approval_record_id is null
    or approval_receipt.receipt_id is null
    or new.approval_id is distinct from approval.approval_id
    or new.approval_receipt_id is distinct from approval_receipt.receipt_id
    or new.approval_receipt_hash is distinct from
      approval_receipt.receipt_hash
    or new.approval_hash is distinct from approval.approval_hash
    or approval_receipt.approval_hash is distinct from approval.approval_hash
    or new.installation_id is distinct from approval.installation_id
    or new.installation_id is distinct from approval_receipt.installation_id
    or new.workspace_id is distinct from approval.workspace_id
    or new.workspace_id is distinct from approval_receipt.workspace_id
    or new.realm is distinct from approval.realm
    or new.realm is distinct from approval_receipt.realm
    or new.owner_person_id is distinct from approval.owner_person_id
    or new.owner_person_id is distinct from approval_receipt.owner_person_id
    or new.work_id is distinct from approval.work_id
    or new.work_id is distinct from approval_receipt.work_id
    or new.work_snapshot_hash is distinct from approval.work_snapshot_hash
    or new.work_snapshot_hash is distinct from
      approval_receipt.work_snapshot_hash
    or new.policy_id is distinct from approval.policy_id
    or new.policy_id is distinct from approval_receipt.policy_id
    or new.policy_content_sha256 is distinct from
      approval.policy_content_sha256
    or new.policy_content_sha256 is distinct from
      approval_receipt.policy_content_sha256
    or new.capability_grant_id is distinct from
      approval.capability_grant_id
    or new.capability_grant_id is distinct from
      approval_receipt.capability_grant_id
    or new.current_surface_hash is distinct from
      approval.current_surface_hash
    or new.current_surface_hash is distinct from
      approval_receipt.current_surface_hash
    or new.predecessor_receipt_id is distinct from
      approval.predecessor_receipt_id
    or new.predecessor_receipt_id is distinct from
      approval_receipt.predecessor_receipt_id
    or new.predecessor_receipt_hash is distinct from
      approval.predecessor_receipt_hash
    or new.predecessor_receipt_hash is distinct from
      approval_receipt.predecessor_receipt_hash
    or new.target_surface_hash is distinct from approval.target_surface_hash
    or new.target_surface_hash is distinct from
      approval_receipt.target_surface_hash
    or new.binding is distinct from approval.binding
    or new.binding is distinct from approval_receipt.binding
    or new.authority is distinct from approval.authority
    or new.authority is distinct from approval_receipt.authority
    or new.scope is distinct from approval.scope
    or new.approved_by_person_id is distinct from approval.owner_person_id
    or new.approved_by_person_id is distinct from
      approval_receipt.owner_person_id
  then
    raise exception 'Workspace core-surface selection approval integrity failure';
  end if;
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.workspace_core_surface_selection_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_core_surface_selection_receipts_derive_hash
before insert on public.workspace_core_surface_selection_receipts
for each row execute function
  public.derive_workspace_core_surface_selection_receipt_hash();

create function public.workspace_core_surface_selection_receipt_document(
  value public.workspace_core_surface_selection_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_core_surface_selection_receipt_core_document(value) ||
    jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.reject_workspace_core_surface_selection_authority_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Workspace core-surface selection authority is append-only';
end
$$;

create trigger workspace_core_surface_selection_approvals_append_only
before update or delete on public.workspace_core_surface_selection_approvals
for each row execute function
  public.reject_workspace_core_surface_selection_authority_mutation();

create trigger workspace_core_surface_selection_approval_receipts_append_only
before update or delete on public.workspace_core_surface_selection_approval_receipts
for each row execute function
  public.reject_workspace_core_surface_selection_authority_mutation();

create trigger workspace_core_surface_selection_receipts_append_only
before update or delete on public.workspace_core_surface_selection_receipts
for each row execute function
  public.reject_workspace_core_surface_selection_authority_mutation();

create function public.create_workspace_core_surface_selection_approval(
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  target_work_id uuid,
  target_capability_grant_id uuid,
  expected_compiled_registry_hash text,
  expected_current_surface_hash text,
  expected_predecessor_core_surface_selection_receipt jsonb,
  requested_target_preferences jsonb,
  target_expires_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  subject_text text := current_setting('vorton.subject_id', true);
  subject_auth_user_id uuid;
  actor_person_id_value uuid;
  actor_membership_kind_value public.person_kind;
  workspace_row public.workspaces;
  work_row public.work;
  grant_row public.capability_grants;
  policy_row public.policies;
  predecessor_receipt public.workspace_core_surface_selection_receipts;
  approval public.workspace_core_surface_selection_approvals;
  receipt public.workspace_core_surface_selection_approval_receipts;
  approval_record public.records;
  approved_at_value timestamptz;
  aal2_verified_at_value timestamptz;
  work_snapshot_value jsonb;
  work_snapshot_hash_value text;
  current_surface_value jsonb;
  current_surface_hash_value text;
  predecessor_reference_value jsonb;
  expected_predecessor_reference_value jsonb;
  expected_predecessor_receipt_id_value uuid;
  expected_predecessor_receipt_hash_value text;
  target_preferences_value jsonb;
  target_surface_value jsonb;
  target_surface_hash_value text;
  binding_value jsonb;
  authority_value jsonb;
  scope_value jsonb := '{
    "action": "workspace.core-surface.select",
    "compiledCoreSurfaceOnly": true,
    "defaultModuleProjectionOnly": true,
    "moduleReleaseAdmission": false,
    "infrastructureMutation": false,
    "otherWorkspaceRead": false,
    "otherWorkspaceMutation": false,
    "externalSystemMutation": false
  }'::jsonb;
  effects_value jsonb := '{
    "approvalCreated": true,
    "approvalConsumed": false,
    "coreSurfaceProjectionMutated": false,
    "defaultCoreSurfaceProjectionMutated": false,
    "coreSurfaceSelectionLineageMutated": false,
    "moduleReleaseAdmitted": false,
    "infrastructureMutated": false,
    "otherWorkspaceRead": false,
    "otherWorkspaceMutation": false,
    "workMutated": false,
    "policyMutated": false,
    "capabilityGrantMutated": false,
    "externalSystemMutated": false,
    "artifactResolved": false,
    "artifactLoaded": false,
    "moduleRuntimeStarted": false,
    "moduleAdmitted": false,
    "moduleMigrated": false,
    "privateConsumerAuthorityGranted": false
  }'::jsonb;
  approval_record_id_value uuid;
  approval_receipt_id_value uuid;
  generation_attempt integer;
  generated_distinct_ids boolean := false;
begin
  -- node-postgres binds JavaScript null as SQL NULL. Normalize that public API
  -- shape to the canonical JSON null used by the signed authority document.
  expected_predecessor_reference_value := coalesce(
    expected_predecessor_core_surface_selection_receipt,
    'null'::jsonb
  );
  if target_approval_id is null
    or target_installation_id is null
    or target_workspace_id is null
    or target_work_id is null
    or target_capability_grant_id is null
    or expected_compiled_registry_hash is null
    or expected_compiled_registry_hash <>
      'sha256:f9ae99ad9b8a053f5fb3915e94efd130f6c5d9a00b4abc6037a0c4e73368bd93'
    or expected_current_surface_hash is null
    or expected_current_surface_hash !~ '^sha256:[a-f0-9]{64}$'
    or requested_target_preferences is null
    or target_expires_at is null
    or target_expires_at is distinct from date_trunc(
      'milliseconds', target_expires_at
    )
    or subject_text is null
    or subject_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Exact workspace core-surface selection approval request is invalid';
  end if;
  if expected_predecessor_reference_value <> 'null'::jsonb
    and not public.vorton_module_lifecycle_receipt_reference_valid(
      expected_predecessor_reference_value
    )
  then
    raise exception 'Expected predecessor core-surface selection receipt is invalid';
  end if;
  if expected_predecessor_reference_value <> 'null'::jsonb then
    expected_predecessor_receipt_id_value :=
      (expected_predecessor_reference_value->>'receiptId')::uuid;
    expected_predecessor_receipt_hash_value :=
      expected_predecessor_reference_value->>'receiptSha256';
  end if;
  subject_auth_user_id := subject_text::uuid;
  target_preferences_value :=
    public.normalize_workspace_core_surface_preferences(
      requested_target_preferences
    );
  if target_preferences_value <> requested_target_preferences then
    raise exception 'Target workspace core-surface preferences are not canonically ordered';
  end if;
  target_surface_value := public.derive_workspace_core_surface(
    target_preferences_value
  );
  target_surface_hash_value := public.vorton_module_lifecycle_hash(
    target_surface_value
  );
  if target_approval_id in (target_work_id, target_capability_grant_id)
    or target_work_id = target_capability_grant_id
    or expected_predecessor_receipt_id_value is not null and (
      expected_predecessor_receipt_id_value in (
        target_approval_id, target_work_id, target_capability_grant_id
      )
    )
    or expected_current_surface_hash = target_surface_hash_value
    or expected_predecessor_receipt_hash_value is not null and (
      expected_predecessor_receipt_hash_value in (
        expected_current_surface_hash, target_surface_hash_value
      )
    )
  then
    raise exception 'Workspace core-surface selection request reuses an authority identity or hash';
  end if;

  -- Authenticate the signed workspace-person step-up envelope before any
  -- target-workspace lookup. Otherwise distinct missing-workspace errors turn
  -- this security-definer function into an existence oracle.
  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) is not true then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;

  -- The workspace row is the first authority lock and the shared lock order
  -- for every create and apply. A per-approval advisory lock before this row
  -- permits multi-call transactions to deadlock in opposite approval order.
  select * into workspace_row
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
   for update;
  if workspace_row.id is null then
    raise exception 'Target workspace does not exist';
  end if;

  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) is not true then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;

  -- The published projection table predates this governed authority seam.
  -- Lock its current rows after the parent workspace and in deterministic
  -- order so no out-of-band tuple update can change the approved preimage.
  perform projection.module_id
    from public.workspace_module_activations projection
   where projection.installation_id = target_installation_id
     and projection.workspace_id = target_workspace_id
   order by projection.module_id
   for update;

  select person.id, membership.kind
    into actor_person_id_value, actor_membership_kind_value
    from public.people person
    join public.workspace_memberships membership
      on membership.installation_id = person.installation_id
     and membership.person_id = person.id
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_auth_user_id
     and membership.workspace_id = target_workspace_id
     and membership.kind = 'owner'
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     )
   for share of person
   for update of membership;
  if actor_person_id_value is null then
    raise exception 'A live workspace owner is required to approve core-surface selection';
  end if;

  -- An exact approval retry is read-only and returns the immutable documents.
  select * into approval
    from public.workspace_core_surface_selection_approvals existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id;
  if approval.approval_record_id is not null then
    if approval.owner_person_id is distinct from actor_person_id_value
      or approval.work_id is distinct from target_work_id
      or approval.capability_grant_id is distinct from
        target_capability_grant_id
      or approval.current_surface_hash is distinct from
        expected_current_surface_hash
      or approval.predecessor_receipt_id is distinct from
        expected_predecessor_receipt_id_value
      or approval.predecessor_receipt_hash is distinct from
        expected_predecessor_receipt_hash_value
      or approval.binding->>'compiledRegistrySha256' is distinct from
        expected_compiled_registry_hash
      or approval.binding->'targetPreferences' is distinct from
        target_preferences_value
      or approval.target_surface is distinct from target_surface_value
      or approval.expires_at is distinct from target_expires_at
    then
      raise exception 'Core-surface selection approval retry conflicts with immutable authority';
    end if;
    select * into receipt
      from public.workspace_core_surface_selection_approval_receipts existing
     where existing.installation_id = approval.installation_id
       and existing.workspace_id = approval.workspace_id
       and existing.approval_id = approval.approval_id;
    select * into approval_record
      from public.records existing
     where existing.installation_id = approval.installation_id
       and existing.workspace_id = approval.workspace_id
       and existing.id = approval.approval_record_id;
    if receipt.receipt_id is null
      or approval.approval_hash <> public.vorton_module_lifecycle_hash(
        public.workspace_core_surface_selection_approval_core_document(approval)
      )
      or receipt.approval_hash <> approval.approval_hash
      or receipt.receipt_hash <> public.vorton_module_lifecycle_hash(
        public.workspace_core_surface_selection_approval_receipt_core_document(
          receipt
        )
      )
      or approval_record.id is null
      or approval_record.kind <> 'approval'
      or approval_record.work_id <> approval.work_id
      or approval_record.summary <> 'Approved workspace core-surface selection'
      or approval_record.payload <>
        public.workspace_core_surface_selection_approval_document(
          approval, receipt
        )
      or approval_record.source_uri is not null
      or approval_record.classification <> 'internal'
      or approval_record.actor_person_id <> approval.owner_person_id
      or approval_record.actor_worker_id is not null
      or approval_record.supersedes_record_id is not null
      or approval_record.created_at <> approval.approved_at
    then
      raise exception 'Workspace core-surface selection approval integrity failure';
    end if;
    return jsonb_build_object(
      'approval', public.workspace_core_surface_selection_approval_document(
        approval, receipt
      ),
      'approvalReceipt',
        public.workspace_core_surface_selection_approval_receipt_document(receipt)
    );
  end if;

  current_surface_value := public.workspace_core_surface_document(
    target_installation_id, target_workspace_id
  );
  if current_surface_value is null
    or current_surface_value <>
      public.normalize_workspace_core_surface(current_surface_value)
  then
    raise exception 'Current workspace core surface is invalid';
  end if;
  current_surface_hash_value := public.vorton_module_lifecycle_hash(
    current_surface_value
  );
  if current_surface_hash_value <> expected_current_surface_hash then
    raise exception 'Expected current workspace core-surface hash does not match';
  end if;
  if current_surface_hash_value = target_surface_hash_value
    or current_surface_value = target_surface_value
  then
    raise exception 'Core-surface selection must change the exact compiled surface';
  end if;

  if workspace_row.core_surface_selection_receipt_id is null then
    if workspace_row.core_surface_selection_receipt_hash is not null
      or jsonb_array_length(current_surface_value->'modules') <> 0
      or expected_predecessor_reference_value <> 'null'::jsonb
      or exists (
        select 1 from public.workspace_core_surface_selection_receipts historical
         where historical.installation_id = target_installation_id
           and historical.workspace_id = target_workspace_id
      )
    then
      raise exception 'Current workspace core surface lacks exact receipt lineage';
    end if;
    predecessor_reference_value := 'null'::jsonb;
  else
    select * into predecessor_receipt
      from public.workspace_core_surface_selection_receipts existing
     where existing.installation_id = target_installation_id
       and existing.workspace_id = target_workspace_id
       and existing.receipt_id = workspace_row.core_surface_selection_receipt_id
       and existing.receipt_hash = workspace_row.core_surface_selection_receipt_hash
     for share;
    predecessor_reference_value := jsonb_build_object(
      'receiptId', workspace_row.core_surface_selection_receipt_id::text,
      'receiptSha256', workspace_row.core_surface_selection_receipt_hash
    );
    if predecessor_receipt.receipt_id is null
      or predecessor_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_core_surface_selection_receipt_core_document(
            predecessor_receipt
          )
        )
      or predecessor_receipt.postimage_surface <> current_surface_value
      or predecessor_receipt.postimage_surface_hash <>
        current_surface_hash_value
      or exists (
        select 1
          from public.workspace_core_surface_selection_receipts successor
         where successor.installation_id = target_installation_id
           and successor.workspace_id = target_workspace_id
           and successor.predecessor_receipt_id =
             workspace_row.core_surface_selection_receipt_id
           and successor.predecessor_receipt_hash =
             workspace_row.core_surface_selection_receipt_hash
      )
      or expected_predecessor_reference_value <>
        predecessor_reference_value
    then
      raise exception 'Current workspace core surface lacks exact receipt lineage';
    end if;
  end if;

  select * into work_row
    from public.work candidate
   where candidate.installation_id = target_installation_id
     and candidate.workspace_id = target_workspace_id
     and candidate.id = target_work_id
   for update;
  if work_row.id is null
    or work_row.state <> 'ready'
    or work_row.custodian_person_id is distinct from actor_person_id_value
    or work_row.custodian_worker_id is not null
    or work_row.lease_expires_at is not null
    or work_row.title <> trim(work_row.title)
    or work_row.requested_outcome <> trim(work_row.requested_outcome)
    or work_row.updated_at < work_row.created_at
    or exists (
      select 1 from jsonb_array_elements(work_row.acceptance_criteria) item
       where jsonb_typeof(item) <> 'string'
          or item #>> '{}' = ''
          or item #>> '{}' <> trim(item #>> '{}')
    )
  then
    raise exception 'Exact ready person-custodied Work is required';
  end if;
  work_snapshot_value :=
    public.workspace_core_surface_selection_work_snapshot(work_row);
  work_snapshot_hash_value := public.vorton_module_lifecycle_hash(
    work_snapshot_value
  );

  select * into grant_row
    from public.capability_grants candidate
   where candidate.installation_id = target_installation_id
     and candidate.workspace_id = target_workspace_id
     and candidate.id = target_capability_grant_id
   for update;
  if grant_row.id is null then
    raise exception 'Exact Work-scoped capability grant does not exist';
  end if;
  select * into policy_row
    from public.policies candidate
   where candidate.installation_id = grant_row.installation_id
     and candidate.workspace_id = grant_row.workspace_id
     and candidate.id = grant_row.policy_id
   for share;

  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) is not true then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;
  aal2_verified_at_value := to_timestamp(
    current_setting('vorton.workspace_step_up_auth_time', true)::bigint
  );
  if target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
  then
    raise exception 'Core-surface selection approval expiry must be within 24 hours';
  end if;
  if grant_row.principal_kind <> 'person'
    or grant_row.person_id is distinct from actor_person_id_value
    or grant_row.worker_id is not null
    or grant_row.capability <> 'workspace.core-surface.select'
    or grant_row.mode <> 'modify'
    or grant_row.work_id is distinct from target_work_id
    or grant_row.granted_at > approved_at_value
    or grant_row.expires_at is not null
      and grant_row.expires_at <= approved_at_value
    or exists (
      select 1 from public.capability_grant_revocations revocation
       where revocation.installation_id = grant_row.installation_id
         and revocation.workspace_id = grant_row.workspace_id
         and revocation.grant_id = grant_row.id
    )
    or policy_row.id is null
    or policy_row.content_sha256 <> encode(
      extensions.digest(
        convert_to(public.vorton_canonical_jsonb(policy_row.definition), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  then
    raise exception 'Exact live person Work-scoped core-surface selection capability is required';
  end if;
  if target_approval_id = policy_row.id
    or target_work_id = policy_row.id
    or target_capability_grant_id = policy_row.id
    or expected_predecessor_receipt_id_value = policy_row.id
  then
    raise exception 'Workspace core-surface selection request reuses an authority identity or hash';
  end if;

  binding_value := jsonb_build_object(
    'vortonInstallationId', target_installation_id::text,
    'workspaceId', target_workspace_id::text,
    'realm', workspace_row.realm::text,
    'workId', work_row.id::text,
    'workSnapshotSha256', work_snapshot_hash_value,
    'currentSurface', current_surface_value,
    'currentSurfaceSha256', current_surface_hash_value,
    'compiledRegistrySha256', expected_compiled_registry_hash,
    'predecessorCoreSurfaceSelectionReceipt', predecessor_reference_value,
    'targetPreferences', target_preferences_value,
    'targetSurface', target_surface_value,
    'targetSurfaceSha256', target_surface_hash_value
  );
  authority_value := jsonb_build_object(
    'principalKind', 'person',
    'personId', actor_person_id_value::text,
    'workspaceMembershipKind', 'owner',
    'capability', 'workspace.core-surface.select',
    'mode', 'modify',
    'workId', work_row.id::text,
    'policyId', policy_row.id::text,
    'policySha256', 'sha256:' || policy_row.content_sha256,
    'capabilityGrantId', grant_row.id::text,
    'workScoped', true,
    'rolesGrantAuthority', false
  );

  for generation_attempt in 1..16 loop
    approval_record_id_value := gen_random_uuid();
    approval_receipt_id_value := gen_random_uuid();
    if cardinality(array[
        target_approval_id, approval_record_id_value,
        approval_receipt_id_value, work_row.id, policy_row.id, grant_row.id
      ]) = cardinality(array(
        select distinct identifier from unnest(array[
          target_approval_id, approval_record_id_value,
          approval_receipt_id_value, work_row.id, policy_row.id, grant_row.id
        ]) identifier
      )) and (
      expected_predecessor_receipt_id_value is null
      or approval_record_id_value <> expected_predecessor_receipt_id_value
        and approval_receipt_id_value <> expected_predecessor_receipt_id_value
      )
    then
      generated_distinct_ids := true;
      exit;
    end if;
  end loop;
  if not generated_distinct_ids then
    raise exception 'Workspace core-surface selection request reuses an authority identity or hash';
  end if;

  insert into public.workspace_core_surface_selection_approvals (
    approval_record_id, approval_id, installation_id, workspace_id, realm,
    owner_person_id, owner_membership_kind, work_id, work_snapshot,
    work_snapshot_hash, policy_id, policy_content_sha256,
    capability_grant_id, current_surface, current_surface_hash,
    predecessor_receipt_id, predecessor_receipt_hash, target_surface,
    target_surface_hash, binding, authority, approval_plane, approved_at,
    expires_at, aal2_verified_at, assurance_level,
    owner_membership_verified_at, policy_verified_at,
    capability_grant_verified_at, work_verified_at,
    current_surface_verified_at, scope, roles_grant_authority,
    approval_hash, created_at
  ) values (
    approval_record_id_value, target_approval_id, target_installation_id,
    target_workspace_id, workspace_row.realm, actor_person_id_value, 'owner',
    work_row.id, work_snapshot_value, work_snapshot_hash_value,
    policy_row.id, policy_row.content_sha256, grant_row.id,
    current_surface_value, current_surface_hash_value,
    workspace_row.core_surface_selection_receipt_id,
    workspace_row.core_surface_selection_receipt_hash, target_surface_value,
    target_surface_hash_value, binding_value, authority_value,
    'workspace-postgres', approved_at_value, target_expires_at,
    aal2_verified_at_value, 'aal2', approved_at_value, approved_at_value,
    approved_at_value, approved_at_value, approved_at_value, scope_value,
    false, 'sha256:' || repeat('0', 64), approved_at_value
  ) returning * into approval;

  insert into public.workspace_core_surface_selection_approval_receipts (
    receipt_id, approval_record_id, approval_id, installation_id,
    workspace_id, realm, owner_person_id, work_id, work_snapshot_hash,
    policy_id, policy_content_sha256, capability_grant_id,
    current_surface_hash, predecessor_receipt_id,
    predecessor_receipt_hash, target_surface_hash, binding, authority,
    approval_hash, receipt_plane, approved_at, expires_at, created_at,
    aal2_verified_at, assurance_level, owner_membership_verified_at,
    policy_verified_at, capability_grant_verified_at, work_verified_at,
    current_surface_verified_at, scope, roles_grant_authority, effects,
    receipt_hash
  ) values (
    approval_receipt_id_value, approval.approval_record_id,
    approval.approval_id, approval.installation_id, approval.workspace_id,
    approval.realm, approval.owner_person_id, approval.work_id,
    approval.work_snapshot_hash, approval.policy_id,
    approval.policy_content_sha256, approval.capability_grant_id,
    approval.current_surface_hash, approval.predecessor_receipt_id,
    approval.predecessor_receipt_hash, approval.target_surface_hash,
    approval.binding, approval.authority, approval.approval_hash,
    'workspace-postgres', approval.approved_at, approval.expires_at,
    approval.approved_at, approval.aal2_verified_at, 'aal2',
    approval.approved_at, approval.approved_at, approval.approved_at,
    approval.approved_at, approval.approved_at, approval.scope, false,
    effects_value, 'sha256:' || repeat('0', 64)
  ) returning * into receipt;

  insert into public.records (
    id, installation_id, workspace_id, work_id, kind, summary, payload,
    source_uri, classification, actor_person_id, actor_worker_id,
    supersedes_record_id, created_at
  ) values (
    approval.approval_record_id, approval.installation_id,
    approval.workspace_id, approval.work_id, 'approval',
    'Approved workspace core-surface selection',
    public.workspace_core_surface_selection_approval_document(approval, receipt),
    null, 'internal', approval.owner_person_id, null, null,
    approval.approved_at
  );

  return jsonb_build_object(
    'approval', public.workspace_core_surface_selection_approval_document(
      approval, receipt
    ),
    'approvalReceipt',
      public.workspace_core_surface_selection_approval_receipt_document(receipt)
  );
end
$$;

create function public.apply_workspace_core_surface_selection(
  target_receipt_id uuid,
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  subject_text text := current_setting('vorton.subject_id', true);
  subject_auth_user_id uuid;
  actor_person_id_value uuid;
  actor_membership_kind_value public.person_kind;
  workspace_row public.workspaces;
  approval public.workspace_core_surface_selection_approvals;
  approval_receipt public.workspace_core_surface_selection_approval_receipts;
  execution_receipt public.workspace_core_surface_selection_receipts;
  lineage_receipt public.workspace_core_surface_selection_receipts;
  approval_record public.records;
  execution_record public.records;
  work_row public.work;
  grant_row public.capability_grants;
  policy_row public.policies;
  current_work_snapshot jsonb;
  current_work_snapshot_hash text;
  current_surface_value jsonb;
  current_surface_hash_value text;
  resulting_surface_value jsonb;
  resulting_surface_hash_value text;
  predecessor_reference_value jsonb;
  applied_at_value timestamptz;
  aal2_verified_at_value timestamptz;
  deleted_row_count integer;
  inserted_row_count integer;
  module_item jsonb;
  idempotency_value jsonb;
  row_counts_value jsonb;
  replayed_receipt_is_ancestor boolean;
  violated_constraint_name text;
  effects_value jsonb := '{
    "approvalConsumed": true,
    "coreSurfaceProjectionReplaced": true,
    "defaultCoreSurfaceProjectionReplaced": true,
    "coreSurfaceSelectionLineageAdvanced": true,
    "moduleReleaseAdmitted": false,
    "infrastructureMutated": false,
    "otherWorkspaceRead": false,
    "otherWorkspaceMutation": false,
    "workMutated": false,
    "policyMutated": false,
    "capabilityGrantMutated": false,
    "externalSystemMutated": false,
    "artifactResolved": false,
    "artifactLoaded": false,
    "moduleRuntimeStarted": false,
    "moduleAdmitted": false,
    "moduleMigrated": false,
    "privateConsumerAuthorityGranted": false
  }'::jsonb;
begin
  if target_receipt_id is null
    or target_approval_id is null
    or target_installation_id is null
    or target_workspace_id is null
    or subject_text is null
    or subject_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Exact workspace core-surface selection apply request is invalid';
  end if;
  subject_auth_user_id := subject_text::uuid;

  -- Authenticate the signed workspace-person step-up envelope before any
  -- target-workspace lookup so existent and nonexistent targets fail alike.
  applied_at_value := date_trunc('milliseconds', clock_timestamp());
  if public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    applied_at_value
  ) is not true then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;

  -- Workspace first is the shared serialization order for every surface apply.
  select * into workspace_row
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
   for update;
  if workspace_row.id is null then
    raise exception 'Target workspace does not exist';
  end if;

  applied_at_value := date_trunc('milliseconds', clock_timestamp());
  if public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    applied_at_value
  ) is not true then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;
  perform projection.module_id
    from public.workspace_module_activations projection
   where projection.installation_id = target_installation_id
     and projection.workspace_id = target_workspace_id
   order by projection.module_id
   for update;
  select person.id, membership.kind
    into actor_person_id_value, actor_membership_kind_value
    from public.people person
    join public.workspace_memberships membership
      on membership.installation_id = person.installation_id
     and membership.person_id = person.id
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_auth_user_id
     and membership.workspace_id = target_workspace_id
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     )
   for share of person
   for update of membership;
  if actor_person_id_value is null then
    raise exception 'A live workspace owner is required to apply or replay core-surface selection';
  end if;
  if actor_membership_kind_value <> 'owner' then
    raise exception 'The same live workspace owner must apply or replay core-surface selection';
  end if;

  -- A completed exact retry is historical reconciliation. It precedes the
  -- expiry check but still requires the original live owner and fresh AAL2.
  select * into execution_receipt
    from public.workspace_core_surface_selection_receipts existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id
   for share;
  if execution_receipt.receipt_id is null then
    select * into execution_receipt
      from public.workspace_core_surface_selection_receipts existing
     where existing.installation_id = target_installation_id
       and existing.workspace_id = target_workspace_id
       and existing.receipt_id = target_receipt_id
     for share;
  end if;
  if execution_receipt.receipt_id is not null then
    if execution_receipt.receipt_id <> target_receipt_id
      or execution_receipt.approval_id <> target_approval_id
    then
      raise exception 'Core-surface selection receipt retry conflicts with immutable application';
    end if;
    if execution_receipt.applied_by_person_id <> actor_person_id_value then
      raise exception 'The same live workspace owner must apply or replay core-surface selection';
    end if;
    select * into approval
      from public.workspace_core_surface_selection_approvals existing
     where existing.installation_id = execution_receipt.installation_id
       and existing.workspace_id = execution_receipt.workspace_id
       and existing.approval_id = execution_receipt.approval_id;
    select * into approval_receipt
      from public.workspace_core_surface_selection_approval_receipts existing
     where existing.installation_id = execution_receipt.installation_id
       and existing.workspace_id = execution_receipt.workspace_id
       and existing.approval_id = execution_receipt.approval_id;
    select * into approval_record
      from public.records existing
     where existing.installation_id = approval.installation_id
       and existing.workspace_id = approval.workspace_id
       and existing.id = approval.approval_record_id;
    select * into execution_record
      from public.records existing
     where existing.installation_id = execution_receipt.installation_id
       and existing.workspace_id = execution_receipt.workspace_id
       and existing.id = execution_receipt.receipt_id;
    resulting_surface_value := public.workspace_core_surface_document(
      target_installation_id, target_workspace_id
    );
    resulting_surface_hash_value := public.vorton_module_lifecycle_hash(
      resulting_surface_value
    );
    select * into lineage_receipt
      from public.workspace_core_surface_selection_receipts existing
     where existing.installation_id = target_installation_id
       and existing.workspace_id = target_workspace_id
       and existing.receipt_id = workspace_row.core_surface_selection_receipt_id
       and existing.receipt_hash = workspace_row.core_surface_selection_receipt_hash
     for share;
    select exists (
      with recursive lineage as (
        select current_receipt.receipt_id,
               current_receipt.receipt_hash,
               current_receipt.predecessor_receipt_id,
               current_receipt.predecessor_receipt_hash
          from public.workspace_core_surface_selection_receipts current_receipt
         where current_receipt.installation_id = target_installation_id
           and current_receipt.workspace_id = target_workspace_id
           and current_receipt.receipt_id =
             workspace_row.core_surface_selection_receipt_id
           and current_receipt.receipt_hash =
             workspace_row.core_surface_selection_receipt_hash
        union all
        select predecessor.receipt_id,
               predecessor.receipt_hash,
               predecessor.predecessor_receipt_id,
               predecessor.predecessor_receipt_hash
          from lineage descendant
          join public.workspace_core_surface_selection_receipts predecessor
            on predecessor.installation_id = target_installation_id
           and predecessor.workspace_id = target_workspace_id
           and predecessor.receipt_id = descendant.predecessor_receipt_id
           and predecessor.receipt_hash = descendant.predecessor_receipt_hash
      )
      select 1 from lineage candidate
       where candidate.receipt_id = execution_receipt.receipt_id
         and candidate.receipt_hash = execution_receipt.receipt_hash
    ) into replayed_receipt_is_ancestor;
    if approval.approval_record_id is null
      or approval_receipt.receipt_id is null
      or approval.approval_hash <> public.vorton_module_lifecycle_hash(
        public.workspace_core_surface_selection_approval_core_document(approval)
      )
      or approval_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_core_surface_selection_approval_receipt_core_document(
            approval_receipt
          )
        )
      or execution_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_core_surface_selection_receipt_core_document(
            execution_receipt
          )
        )
      or approval_record.id is null
      or approval_record.payload <>
        public.workspace_core_surface_selection_approval_document(
          approval, approval_receipt
        )
      or execution_record.id is null
      or execution_record.kind <> 'receipt'
      or execution_record.work_id <> execution_receipt.work_id
      or execution_record.summary <> 'Applied workspace core-surface selection'
      or execution_record.payload <>
        public.workspace_core_surface_selection_receipt_document(
          execution_receipt
        )
      or execution_record.source_uri is not null
      or execution_record.classification <> 'internal'
      or execution_record.actor_person_id <>
        execution_receipt.applied_by_person_id
      or execution_record.actor_worker_id is not null
      or execution_record.supersedes_record_id is not null
      or execution_record.created_at <> execution_receipt.applied_at
      or lineage_receipt.receipt_id is null
      or lineage_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_core_surface_selection_receipt_core_document(
            lineage_receipt
          )
        )
      or exists (
        select 1
          from public.workspace_core_surface_selection_receipts successor
         where successor.installation_id = target_installation_id
           and successor.workspace_id = target_workspace_id
           and successor.predecessor_receipt_id =
             workspace_row.core_surface_selection_receipt_id
           and successor.predecessor_receipt_hash =
             workspace_row.core_surface_selection_receipt_hash
      )
      or resulting_surface_value is distinct from
        lineage_receipt.postimage_surface
      or resulting_surface_hash_value is distinct from
        lineage_receipt.postimage_surface_hash
      or not replayed_receipt_is_ancestor
    then
      raise exception 'Workspace core-surface selection completed receipt integrity failure';
    end if;
    return jsonb_build_object(
      'approval', public.workspace_core_surface_selection_approval_document(
        approval, approval_receipt
      ),
      'approvalReceipt',
        public.workspace_core_surface_selection_approval_receipt_document(
          approval_receipt
        ),
      'receipt', public.workspace_core_surface_selection_receipt_document(
        execution_receipt
      )
    );
  end if;

  select * into approval
    from public.workspace_core_surface_selection_approvals existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id
   for update;
  if approval.approval_record_id is null then
    raise exception 'Exact workspace core-surface selection approval does not exist';
  end if;
  if approval.owner_person_id <> actor_person_id_value then
    raise exception 'The same live workspace owner must apply or replay core-surface selection';
  end if;
  if target_receipt_id in (
    approval.approval_id, approval.approval_record_id, approval.work_id,
    approval.policy_id, approval.capability_grant_id
  ) or target_receipt_id = approval.predecessor_receipt_id then
    raise exception 'Core-surface selection receipt identity conflicts with authority';
  end if;
  select * into approval_receipt
    from public.workspace_core_surface_selection_approval_receipts existing
   where existing.installation_id = approval.installation_id
     and existing.workspace_id = approval.workspace_id
     and existing.approval_id = approval.approval_id
   for update;
  if approval_receipt.receipt_id is null
    or approval_receipt.receipt_id = target_receipt_id
  then
    raise exception 'Exact no-effect core-surface selection approval receipt is unavailable';
  end if;

  current_surface_value := public.workspace_core_surface_document(
    approval.installation_id, approval.workspace_id
  );
  current_surface_hash_value := public.vorton_module_lifecycle_hash(
    current_surface_value
  );
  predecessor_reference_value := case
    when workspace_row.core_surface_selection_receipt_id is null then 'null'::jsonb
    else jsonb_build_object(
      'receiptId', workspace_row.core_surface_selection_receipt_id::text,
      'receiptSha256', workspace_row.core_surface_selection_receipt_hash
    )
  end;
  if current_surface_value is distinct from approval.current_surface
    or current_surface_hash_value <> approval.current_surface_hash
    or workspace_row.core_surface_selection_receipt_id is distinct from
      approval.predecessor_receipt_id
    or workspace_row.core_surface_selection_receipt_hash is distinct from
      approval.predecessor_receipt_hash
    or predecessor_reference_value <>
      approval.binding->'predecessorCoreSurfaceSelectionReceipt'
  then
    raise exception 'Current workspace core surface changed after approval';
  end if;

  -- An approval binds the terminal receipt visible at creation. Revalidate
  -- that terminality immediately before mutation. This closes both a reset to
  -- an old valid head and a reset to empty genesis without relying on unique
  -- constraints to classify an already-issued fork.
  if approval.predecessor_receipt_id is null then
    if exists (
      select 1
        from public.workspace_core_surface_selection_receipts historical
       where historical.installation_id = approval.installation_id
         and historical.workspace_id = approval.workspace_id
    ) then
      raise exception 'Approved workspace core-surface selection predecessor is no longer terminal';
    end if;
  else
    select * into lineage_receipt
      from public.workspace_core_surface_selection_receipts existing
     where existing.installation_id = approval.installation_id
       and existing.workspace_id = approval.workspace_id
       and existing.receipt_id = approval.predecessor_receipt_id
       and existing.receipt_hash = approval.predecessor_receipt_hash
     for share;
    if lineage_receipt.receipt_id is null
      or lineage_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_core_surface_selection_receipt_core_document(
            lineage_receipt
          )
        )
      or lineage_receipt.postimage_surface is distinct from
        current_surface_value
      or lineage_receipt.postimage_surface_hash is distinct from
        current_surface_hash_value
      or exists (
        select 1
          from public.workspace_core_surface_selection_receipts successor
         where successor.installation_id = approval.installation_id
           and successor.workspace_id = approval.workspace_id
           and successor.predecessor_receipt_id =
             approval.predecessor_receipt_id
           and successor.predecessor_receipt_hash =
             approval.predecessor_receipt_hash
      )
    then
      raise exception 'Approved workspace core-surface selection predecessor is no longer terminal';
    end if;
  end if;

  select * into work_row
    from public.work candidate
   where candidate.installation_id = approval.installation_id
     and candidate.workspace_id = approval.workspace_id
     and candidate.id = approval.work_id
   for update;
  current_work_snapshot :=
    public.workspace_core_surface_selection_work_snapshot(work_row);
  current_work_snapshot_hash := public.vorton_module_lifecycle_hash(
    current_work_snapshot
  );
  select * into grant_row
    from public.capability_grants candidate
   where candidate.installation_id = approval.installation_id
     and candidate.workspace_id = approval.workspace_id
     and candidate.id = approval.capability_grant_id
   for update;
  select * into policy_row
    from public.policies candidate
   where candidate.installation_id = approval.installation_id
     and candidate.workspace_id = approval.workspace_id
     and candidate.id = approval.policy_id
   for share;

  applied_at_value := date_trunc('milliseconds', clock_timestamp());
  if public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    applied_at_value
  ) is not true then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;
  aal2_verified_at_value := to_timestamp(
    current_setting('vorton.workspace_step_up_auth_time', true)::bigint
  );
  if approval.expires_at <= applied_at_value
    or approval.approved_at > applied_at_value
    or work_row.id is null
    or work_row.state <> 'ready'
    or work_row.custodian_person_id is distinct from actor_person_id_value
    or work_row.custodian_worker_id is not null
    or work_row.lease_expires_at is not null
    or current_work_snapshot is distinct from approval.work_snapshot
    or current_work_snapshot_hash <> approval.work_snapshot_hash
    or grant_row.id is null
    or grant_row.policy_id <> approval.policy_id
    or grant_row.principal_kind <> 'person'
    or grant_row.person_id is distinct from actor_person_id_value
    or grant_row.worker_id is not null
    or grant_row.capability <> 'workspace.core-surface.select'
    or grant_row.mode <> 'modify'
    or grant_row.work_id is distinct from approval.work_id
    or grant_row.granted_at > applied_at_value
    or grant_row.expires_at is not null
      and grant_row.expires_at <= applied_at_value
    or exists (
      select 1 from public.capability_grant_revocations revocation
       where revocation.installation_id = grant_row.installation_id
         and revocation.workspace_id = grant_row.workspace_id
         and revocation.grant_id = grant_row.id
    )
    or policy_row.id is null
    or policy_row.content_sha256 <> approval.policy_content_sha256
    or policy_row.content_sha256 <> encode(
      extensions.digest(
        convert_to(public.vorton_canonical_jsonb(policy_row.definition), 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  then
    raise exception 'Approved Work, Policy, or capability authority changed';
  end if;
  if approval.approval_hash <> public.vorton_module_lifecycle_hash(
      public.workspace_core_surface_selection_approval_core_document(approval)
    )
    or approval_receipt.approval_hash <> approval.approval_hash
    or approval_receipt.receipt_hash <>
      public.vorton_module_lifecycle_hash(
        public.workspace_core_surface_selection_approval_receipt_core_document(
          approval_receipt
        )
      )
  then
    raise exception 'Workspace core-surface selection approval integrity failure';
  end if;
  select * into approval_record
    from public.records existing
   where existing.installation_id = approval.installation_id
     and existing.workspace_id = approval.workspace_id
     and existing.id = approval.approval_record_id;
  if approval_record.id is null
    or approval_record.kind <> 'approval'
    or approval_record.work_id <> approval.work_id
    or approval_record.summary <> 'Approved workspace core-surface selection'
    or approval_record.payload <>
      public.workspace_core_surface_selection_approval_document(
        approval, approval_receipt
      )
    or approval_record.source_uri is not null
    or approval_record.classification <> 'internal'
    or approval_record.actor_person_id <> approval.owner_person_id
    or approval_record.actor_worker_id is not null
    or approval_record.supersedes_record_id is not null
    or approval_record.created_at <> approval.approved_at
  then
    raise exception 'Workspace core-surface selection approval Record integrity failure';
  end if;

  -- The complete projection, receipt, Record, and lineage transition is one
  -- exception subtransaction. A caller-selected receipt UUID can race with a
  -- different workspace's global receipt or Record identity. Do not pre-read
  -- any foreign authority plane. Translate only the exact caller-selected
  -- identity constraints and let the subtransaction roll every attempted
  -- effect back before returning the generic P0001 conflict boundary.
  begin
    update public.workspaces
       set default_module_id = null
     where installation_id = approval.installation_id
       and id = approval.workspace_id;
    delete from public.workspace_module_activations
     where installation_id = approval.installation_id
       and workspace_id = approval.workspace_id;
    get diagnostics deleted_row_count = row_count;

    inserted_row_count := 0;
    for module_item in
      select item
        from jsonb_array_elements(approval.target_surface->'modules') item
    loop
      insert into public.workspace_module_activations (
        installation_id, workspace_id, module_id, contract_version, label,
        navigation_order, presentation_variant, created_by_person_id,
        created_at
      ) values (
        approval.installation_id, approval.workspace_id,
        module_item->>'id', module_item->>'contractVersion',
        module_item->>'label', (module_item->>'navigationOrder')::integer,
        module_item->>'presentationVariant', actor_person_id_value,
        applied_at_value
      );
      inserted_row_count := inserted_row_count + 1;
    end loop;
    update public.workspaces
       set default_module_id = case
         when approval.target_surface->'defaultModuleId' = 'null'::jsonb
           then null
         else approval.target_surface->>'defaultModuleId'
       end
     where installation_id = approval.installation_id
       and id = approval.workspace_id;

    resulting_surface_value := public.workspace_core_surface_document(
      approval.installation_id, approval.workspace_id
    );
    resulting_surface_hash_value := public.vorton_module_lifecycle_hash(
      resulting_surface_value
    );
    if deleted_row_count <> jsonb_array_length(
        approval.current_surface->'modules'
      )
      or inserted_row_count <> jsonb_array_length(
        approval.target_surface->'modules'
      )
      or resulting_surface_value <> approval.target_surface
      or resulting_surface_hash_value <> approval.target_surface_hash
    then
      raise exception 'Exact workspace core-surface projection replacement failed';
    end if;

    idempotency_value := jsonb_build_object(
      'key', target_receipt_id::text,
      'exactReplayReturnsSameReceipt', true,
      'conflictingReplayDenied', true,
      'additionalProjectionMutationsOnReplay', 0
    );
    row_counts_value := jsonb_build_object(
      'preimageCoreSurfaceRows', deleted_row_count,
      'deletedCoreSurfaceRows', deleted_row_count,
      'insertedCoreSurfaceRows', inserted_row_count,
      'postimageCoreSurfaceRows', inserted_row_count,
      'defaultCoreSurfaceRowsUpdated', 1,
      'coreSurfaceSelectionLineageRowsUpdated', 1,
      'otherWorkspaceRowsRead', 0,
      'otherWorkspaceRowsMutated', 0
    );
    insert into public.workspace_core_surface_selection_receipts (
    receipt_id, approval_record_id, approval_id, approval_receipt_id,
    approval_receipt_hash, approval_hash, installation_id, workspace_id,
    realm, owner_person_id, work_id, work_snapshot_hash, policy_id,
    policy_content_sha256, capability_grant_id, current_surface_hash,
    predecessor_receipt_id, predecessor_receipt_hash, target_surface_hash,
    binding, authority, scope, approved_by_person_id, applied_by_person_id,
    approval_consumption_count, approval_consumed_at, applied_at,
    aal2_verified_at, assurance_level, owner_membership_verified_at,
    policy_verified_at, capability_grant_verified_at,
    work_snapshot_verified_at, current_surface_verified_at,
    preimage_surface, preimage_surface_hash, postimage_surface,
    postimage_surface_hash, row_counts, idempotency, effects, receipt_hash
  ) values (
    target_receipt_id, approval.approval_record_id, approval.approval_id,
    approval_receipt.receipt_id, approval_receipt.receipt_hash,
    approval.approval_hash, approval.installation_id,
    approval.workspace_id, approval.realm, approval.owner_person_id,
    approval.work_id, approval.work_snapshot_hash, approval.policy_id,
    approval.policy_content_sha256, approval.capability_grant_id,
    approval.current_surface_hash, approval.predecessor_receipt_id,
    approval.predecessor_receipt_hash, approval.target_surface_hash,
    approval.binding, approval.authority, approval.scope,
    approval.owner_person_id, actor_person_id_value, 1, applied_at_value,
    applied_at_value, aal2_verified_at_value, 'aal2', applied_at_value,
    applied_at_value, applied_at_value, applied_at_value, applied_at_value,
    approval.current_surface, approval.current_surface_hash,
    approval.target_surface, approval.target_surface_hash,
    row_counts_value, idempotency_value, effects_value,
    'sha256:' || repeat('0', 64)
    ) returning * into execution_receipt;

    insert into public.records (
      id, installation_id, workspace_id, work_id, kind, summary, payload,
      source_uri, classification, actor_person_id, actor_worker_id,
      supersedes_record_id, created_at
    ) values (
      execution_receipt.receipt_id, execution_receipt.installation_id,
      execution_receipt.workspace_id, execution_receipt.work_id, 'receipt',
      'Applied workspace core-surface selection',
      public.workspace_core_surface_selection_receipt_document(execution_receipt),
      null, 'internal', execution_receipt.applied_by_person_id, null, null,
      execution_receipt.applied_at
    );

    update public.workspaces
       set core_surface_selection_receipt_id = execution_receipt.receipt_id,
           core_surface_selection_receipt_hash = execution_receipt.receipt_hash
     where installation_id = execution_receipt.installation_id
       and id = execution_receipt.workspace_id;
  exception
    when unique_violation then
      get stacked diagnostics
        violated_constraint_name = constraint_name;
      if violated_constraint_name in (
        'workspace_core_surface_selection_receipts_pkey',
        'records_pkey',
        'records_installation_id_id_key'
      ) then
        raise exception 'Core-surface selection receipt identity conflicts with authority';
      end if;
      raise;
  end;

  return jsonb_build_object(
    'approval', public.workspace_core_surface_selection_approval_document(
      approval, approval_receipt
    ),
    'approvalReceipt',
      public.workspace_core_surface_selection_approval_receipt_document(
        approval_receipt
      ),
    'receipt', public.workspace_core_surface_selection_receipt_document(
      execution_receipt
    )
  );
end
$$;

comment on table public.workspace_core_surface_selection_approvals is
  'Immutable same-person workspace-owner approval bound to exact ready Work, Policy, capability grant, current receipt-lined surface, target surface, and recent signed AAL2.';
comment on table public.workspace_core_surface_selection_approval_receipts is
  'Immutable no-effect receipt created atomically with governed workspace core-surface selection approval.';
comment on table public.workspace_core_surface_selection_receipts is
  'Immutable receipt for one atomically consumed approval and one exact workspace core-surface projection replacement.';
comment on column public.workspaces.core_surface_selection_receipt_id is
  'Exact immutable receipt that installed the current compiled core surface; null only for an untouched empty genesis surface.';

alter table public.workspace_core_surface_selection_approvals
  enable row level security;
alter table public.workspace_core_surface_selection_approval_receipts
  enable row level security;
alter table public.workspace_core_surface_selection_receipts
  enable row level security;

revoke all on table public.workspace_core_surface_selection_approvals,
  public.workspace_core_surface_selection_approval_receipts,
  public.workspace_core_surface_selection_receipts
from public, anon, authenticated, aubos_worker;

revoke all on function public.workspace_compiled_core_surface_registry_document()
from public, anon, authenticated, aubos_worker;
revoke all on function public.normalize_workspace_core_surface_preferences(jsonb)
from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_workspace_core_surface(jsonb)
from public, anon, authenticated, aubos_worker;
revoke all on function public.normalize_workspace_core_surface(jsonb)
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_core_surface_document(uuid, uuid)
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_core_surface_selection_work_snapshot(
  public.work
) from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_core_surface_selection_approval_core_document(
  public.workspace_core_surface_selection_approvals
) from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_workspace_core_surface_selection_approval_hash()
from public, anon, authenticated, aubos_worker;
revoke all on function
  public.workspace_core_surface_selection_approval_receipt_core_document(
    public.workspace_core_surface_selection_approval_receipts
  ) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.derive_workspace_core_surface_selection_approval_receipt_hash()
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_core_surface_selection_approval_document(
  public.workspace_core_surface_selection_approvals,
  public.workspace_core_surface_selection_approval_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.workspace_core_surface_selection_approval_receipt_document(
    public.workspace_core_surface_selection_approval_receipts
  ) from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_core_surface_selection_receipt_core_document(
  public.workspace_core_surface_selection_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_workspace_core_surface_selection_receipt_hash()
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_core_surface_selection_receipt_document(
  public.workspace_core_surface_selection_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.reject_workspace_core_surface_selection_authority_mutation()
from public, anon, authenticated, aubos_worker;

revoke all on function public.create_workspace_core_surface_selection_approval(
  uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, timestamptz
) from public, anon, authenticated, aubos_worker;
grant execute on function public.create_workspace_core_surface_selection_approval(
  uuid, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, timestamptz
) to authenticated;

revoke all on function public.apply_workspace_core_surface_selection(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, aubos_worker;
grant execute on function public.apply_workspace_core_surface_selection(
  uuid, uuid, uuid, uuid
) to authenticated;

commit;
