-- Governed installation-scoped reconciliation for historical compiled
-- core-surface projections that predate workspace receipt lineage.
--
-- This migration does not install a release and does not create workspace
-- selection authority. It converts only an exact recognized compatibility
-- preimage into the compiled registry projection, under installation-owner
-- approval, and records the transition in a generic workspace lineage.

begin;

create table public.workspace_core_surface_lineage_receipts (
  receipt_id uuid primary key,
  installation_id uuid not null,
  workspace_id uuid not null,
  receipt_kind text not null check (
    receipt_kind in ('workspace-selection', 'installation-reconciliation')
  ),
  predecessor_receipt_id uuid,
  predecessor_receipt_hash text check (
    predecessor_receipt_hash is null
    or predecessor_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  preimage_surface_hash text not null check (
    preimage_surface_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  postimage_surface_hash text not null check (
    postimage_surface_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  applied_at timestamptz not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint workspace_core_surface_lineage_receipts_workspace_fk
    foreign key (installation_id, workspace_id)
    references public.workspaces(installation_id, id) on delete restrict,
  constraint workspace_core_surface_lineage_receipts_predecessor_pair check (
    (predecessor_receipt_id is null) = (predecessor_receipt_hash is null)
  ),
  unique (installation_id, workspace_id, receipt_id),
  unique (installation_id, workspace_id, receipt_id, receipt_hash),
  constraint workspace_core_surface_lineage_receipts_linear_successor unique (
    installation_id, workspace_id, predecessor_receipt_id,
    predecessor_receipt_hash
  )
);

create unique index workspace_core_surface_lineage_receipts_one_genesis_idx
  on public.workspace_core_surface_lineage_receipts(
    installation_id, workspace_id
  )
  where predecessor_receipt_id is null
    and predecessor_receipt_hash is null;

alter table public.workspace_core_surface_lineage_receipts
  add constraint workspace_core_surface_lineage_receipts_predecessor_fk
    foreign key (
      installation_id, workspace_id, predecessor_receipt_id,
      predecessor_receipt_hash
    ) references public.workspace_core_surface_lineage_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict deferrable initially deferred;

insert into public.workspace_core_surface_lineage_receipts (
  receipt_id, installation_id, workspace_id, receipt_kind,
  predecessor_receipt_id, predecessor_receipt_hash,
  preimage_surface_hash, postimage_surface_hash, applied_at, receipt_hash
)
select receipt.receipt_id, receipt.installation_id, receipt.workspace_id,
       'workspace-selection', receipt.predecessor_receipt_id,
       receipt.predecessor_receipt_hash, receipt.preimage_surface_hash,
       receipt.postimage_surface_hash, receipt.applied_at, receipt.receipt_hash
  from public.workspace_core_surface_selection_receipts receipt;

alter table public.workspaces
  drop constraint workspaces_core_surface_selection_lineage_fk;
alter table public.workspace_core_surface_selection_approvals
  drop constraint workspace_core_surface_selection_approvals_predecessor_fk;
alter table public.workspace_core_surface_selection_receipts
  drop constraint workspace_core_surface_selection_receipts_predecessor_fk,
  drop constraint workspace_core_surface_selection_receipts_linear_successor;
drop index public.workspace_core_surface_selection_receipts_one_genesis_idx;

alter table public.workspaces
  add constraint workspaces_core_surface_selection_lineage_fk
    foreign key (
      installation_id, id, core_surface_selection_receipt_id,
      core_surface_selection_receipt_hash
    ) references public.workspace_core_surface_lineage_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict deferrable initially deferred;

alter table public.workspace_core_surface_selection_approvals
  add constraint workspace_core_surface_selection_approvals_predecessor_fk
    foreign key (
      installation_id, workspace_id, predecessor_receipt_id,
      predecessor_receipt_hash
    ) references public.workspace_core_surface_lineage_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict;

alter table public.workspace_core_surface_selection_receipts
  add constraint workspace_core_surface_selection_receipts_predecessor_fk
    foreign key (
      installation_id, workspace_id, predecessor_receipt_id,
      predecessor_receipt_hash
    ) references public.workspace_core_surface_lineage_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict,
  add constraint workspace_core_surface_selection_receipts_lineage_child_fk
    foreign key (
      installation_id, workspace_id, receipt_id, receipt_hash
    ) references public.workspace_core_surface_lineage_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict deferrable initially deferred;

create function public.record_workspace_core_surface_selection_lineage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.workspace_core_surface_lineage_receipts (
    receipt_id, installation_id, workspace_id, receipt_kind,
    predecessor_receipt_id, predecessor_receipt_hash,
    preimage_surface_hash, postimage_surface_hash, applied_at, receipt_hash
  ) values (
    new.receipt_id, new.installation_id, new.workspace_id,
    'workspace-selection', new.predecessor_receipt_id,
    new.predecessor_receipt_hash, new.preimage_surface_hash,
    new.postimage_surface_hash, new.applied_at, new.receipt_hash
  );
  return new;
end
$$;

create trigger workspace_core_surface_selection_receipts_record_lineage
after insert on public.workspace_core_surface_selection_receipts
for each row execute function
  public.record_workspace_core_surface_selection_lineage();

create trigger workspace_core_surface_lineage_receipts_append_only
before update or delete on public.workspace_core_surface_lineage_receipts
for each row execute function
  public.reject_workspace_core_surface_selection_authority_mutation();

create function public.vorton_legacy_core_surface_contract_document()
returns jsonb
language sql immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.legacy-compiled-core-surface.v1',
    'compatibilityOnly', true,
    'registryIds', jsonb_build_array(
      'command', 'opportunities', 'goals', 'tasks', 'tools', 'factory', 'admin'
    ),
    'historicalFactoryVariantSha256',
      public.vorton_module_lifecycle_hash(to_jsonb('freed-read-only'::text))
  )
$$;

create function public.vorton_legacy_workspace_core_surface_valid(value jsonb)
returns boolean
language plpgsql immutable strict
set search_path = pg_catalog
as $$
declare
  item jsonb;
  item_id text;
  expected_label text;
  module_ids text[] := array[]::text[];
  navigation_orders integer[] := array[]::integer[];
  default_module text;
  saw_legacy_factory boolean := false;
begin
  if jsonb_typeof(value) <> 'object'
    or not value ?& array['defaultModuleId', 'modules']
    or (select count(*) from jsonb_object_keys(value)) <> 2
    or jsonb_typeof(value->'modules') <> 'array'
    or jsonb_array_length(value->'modules') = 0
    or jsonb_array_length(value->'modules') > 7
    or jsonb_typeof(value->'defaultModuleId') <> 'string'
  then
    return false;
  end if;
  default_module := value->>'defaultModuleId';
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
      or (item->>'navigationOrder')::numeric < 0
      or (item->>'navigationOrder')::numeric > 10000
      or (item->>'navigationOrder')::numeric <>
        trunc((item->>'navigationOrder')::numeric)
    then
      return false;
    end if;
    item_id := item->>'id';
    expected_label := case item_id
      when 'command' then 'Command Bridge'
      when 'opportunities' then 'Opportunities'
      when 'goals' then 'Goals'
      when 'tasks' then 'Tasks'
      when 'tools' then 'Tools'
      when 'factory' then 'Factory'
      when 'admin' then 'Admin'
    end;
    if expected_label is null
      or item->>'contractVersion' <> 'v1'
      or item->>'label' <> expected_label
      or item_id = any(module_ids)
      or (item->>'navigationOrder')::integer = any(navigation_orders)
      or (case when item_id = 'factory'
        then item->>'presentationVariant' <> 'freed-read-only'
        else item->>'presentationVariant' <> 'standard'
      end)
    then
      return false;
    end if;
    saw_legacy_factory := saw_legacy_factory or item_id = 'factory';
    module_ids := array_append(module_ids, item_id);
    navigation_orders := array_append(
      navigation_orders, (item->>'navigationOrder')::integer
    );
  end loop;
  return saw_legacy_factory and default_module = any(module_ids);
exception when others then
  return false;
end
$$;

create function public.workspace_core_surface_preferences_from_legacy(
  target_surface jsonb
) returns jsonb
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  preferences jsonb;
begin
  if not public.vorton_legacy_workspace_core_surface_valid(target_surface) then
    raise exception 'Historical core-surface preimage is not recognized';
  end if;
  select jsonb_build_object(
    'defaultCoreSurfaceId', target_surface->'defaultModuleId',
    'coreSurfaces', jsonb_agg(
      jsonb_build_object(
        'id', item->>'id',
        'navigationOrder', (item->>'navigationOrder')::integer
      ) order by (item->>'navigationOrder')::integer, item->>'id'
    )
  ) into preferences
    from jsonb_array_elements(target_surface->'modules') item;
  return public.normalize_workspace_core_surface_preferences(preferences);
end
$$;

create function public.vorton_core_surface_reconciliation_uuid(value text)
returns uuid
language sql immutable strict
set search_path = pg_catalog, extensions
as $$
  select (
    substr(digest_hex, 1, 8) || '-' || substr(digest_hex, 9, 4) || '-' ||
    '5' || substr(digest_hex, 14, 3) || '-' ||
    '8' || substr(digest_hex, 18, 3) || '-' || substr(digest_hex, 21, 12)
  )::uuid
    from (
      select encode(digest(convert_to(value, 'UTF8'), 'sha256'), 'hex')
        as digest_hex
    ) hashed
$$;

alter table public.installations
  add column core_surface_reconciliation_receipt_id uuid,
  add column core_surface_reconciliation_receipt_hash text check (
    core_surface_reconciliation_receipt_hash is null
    or core_surface_reconciliation_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  add constraint installations_core_surface_reconciliation_lineage_pair check (
    (core_surface_reconciliation_receipt_id is null) =
      (core_surface_reconciliation_receipt_hash is null)
  );

create table public.installation_core_surface_reconciliation_approvals (
  approval_id uuid primary key,
  approval_receipt_id uuid not null unique,
  installation_id uuid not null references public.installations(id)
    on delete restrict,
  owner_person_id uuid not null,
  release_adoption_receipt_id uuid not null,
  release_adoption_receipt_hash text not null check (
    release_adoption_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  plan jsonb not null,
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  approval_plane text not null check (approval_plane = 'installation-postgres'),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  installation_owner_verified_at timestamptz not null,
  scope jsonb not null,
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null,
  constraint installation_core_surface_reconciliation_approvals_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint installation_core_surface_reconciliation_approvals_release_fk
    foreign key (
      installation_id, release_adoption_receipt_id,
      release_adoption_receipt_hash
    ) references public.release_adoption_receipts(
      installation_id, id, receipt_hash
    ) on delete restrict,
  constraint installation_core_surface_reconciliation_approvals_time_check check (
    approved_at = date_trunc('milliseconds', approved_at)
    and expires_at = date_trunc('milliseconds', expires_at)
    and created_at = approved_at
    and installation_owner_verified_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
    and expires_at > approved_at
    and expires_at <= approved_at + interval '24 hours'
  ),
  constraint installation_core_surface_reconciliation_approvals_scope_check check (
    scope = '{
      "compiledCoreSurfaceCompatibilityOnly": true,
      "workspaceProjectionMetadataRead": true,
      "workspaceProjectionMutated": true,
      "workspaceLineageMutated": true,
      "installationLineageMutated": true,
      "releaseInstalled": false,
      "releaseAdopted": false,
      "workspaceCreated": false,
      "workspaceAuthorityBorrowed": false,
      "workspaceBusinessDataRead": false,
      "workspaceBusinessDataMutated": false,
      "personalDataRead": false,
      "artifactResolved": false,
      "artifactLoaded": false,
      "moduleRuntimeStarted": false,
      "moduleAdmitted": false,
      "moduleMigrated": false,
      "infrastructureMutated": false,
      "externalSystemMutated": false,
      "privateConsumerAuthorityGranted": false
    }'::jsonb
  ),
  constraint installation_core_surface_reconciliation_approvals_distinct_ids check (
    approval_id <> approval_receipt_id
    and approval_id <> release_adoption_receipt_id
    and approval_receipt_id <> release_adoption_receipt_id
  ),
  constraint installation_core_surface_reconciliation_approvals_distinct_hashes check (
    approval_hash <> plan_hash
    and approval_hash <> release_adoption_receipt_hash
    and plan_hash <> release_adoption_receipt_hash
  ),
  unique (installation_id, approval_id),
  unique (installation_id, approval_id, plan_hash)
);

create table public.installation_core_surface_reconciliation_approval_receipts (
  receipt_id uuid primary key,
  approval_id uuid not null unique,
  installation_id uuid not null,
  owner_person_id uuid not null,
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  receipt_plane text not null check (receipt_plane = 'installation-postgres'),
  approved_at timestamptz not null,
  created_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  installation_owner_verified_at timestamptz not null,
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint install_surface_approval_receipts_approval_fk
    foreign key (installation_id, approval_id, plan_hash)
    references public.installation_core_surface_reconciliation_approvals(
      installation_id, approval_id, plan_hash
    ) on delete restrict,
  constraint install_surface_approval_receipts_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint install_surface_approval_receipts_time_check check (
    approved_at = created_at
    and installation_owner_verified_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
  ),
  constraint install_surface_approval_receipts_effects_check check (
    effects = '{
      "approvalCreated": true,
      "approvalConsumed": false,
      "installationReconciliationApplied": false,
      "workspaceProjectionMutated": false,
      "workspaceLineageMutated": false,
      "installationLineageMutated": false,
      "releaseInstalled": false,
      "releaseAdopted": false,
      "workspaceAuthorityBorrowed": false,
      "workspaceBusinessDataRead": false,
      "workspaceBusinessDataMutated": false,
      "externalSystemMutated": false
    }'::jsonb
  ),
  constraint install_surface_approval_receipts_distinct_ids check (
    receipt_id <> approval_id
  ),
  constraint install_surface_approval_receipts_distinct_hashes check (
    receipt_hash <> approval_hash and receipt_hash <> plan_hash
  ),
  unique (installation_id, receipt_id),
  unique (installation_id, receipt_id, receipt_hash)
);

create table public.installation_core_surface_reconciliation_receipts (
  receipt_id uuid primary key,
  approval_id uuid not null unique,
  approval_receipt_id uuid not null unique,
  approval_receipt_hash text not null check (
    approval_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  installation_id uuid not null,
  owner_person_id uuid not null,
  release_adoption_receipt_id uuid not null,
  release_adoption_receipt_hash text not null check (
    release_adoption_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  plan jsonb not null,
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  predecessor_receipt_id uuid,
  predecessor_receipt_hash text check (
    predecessor_receipt_hash is null
    or predecessor_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  workspace_receipts jsonb not null,
  preimage_inventory_hash text not null check (
    preimage_inventory_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  postimage_inventory_hash text not null check (
    postimage_inventory_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  postimage_inventory jsonb not null,
  transition_set_hash text not null check (
    transition_set_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  approved_by_person_id uuid not null,
  applied_by_person_id uuid not null,
  approval_consumption_count integer not null check (
    approval_consumption_count = 1
  ),
  approval_consumed_at timestamptz not null,
  applied_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  installation_owner_verified_at timestamptz not null,
  row_counts jsonb not null,
  idempotency jsonb not null,
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint installation_core_surface_reconciliation_receipts_approval_fk
    foreign key (installation_id, approval_id, plan_hash)
    references public.installation_core_surface_reconciliation_approvals(
      installation_id, approval_id, plan_hash
    ) on delete restrict,
  constraint installation_core_surface_reconciliation_receipts_approval_receipt_fk
    foreign key (
      installation_id, approval_receipt_id, approval_receipt_hash
    ) references public.installation_core_surface_reconciliation_approval_receipts(
      installation_id, receipt_id, receipt_hash
    ) on delete restrict,
  constraint installation_core_surface_reconciliation_receipts_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint installation_core_surface_reconciliation_receipts_release_fk
    foreign key (
      installation_id, release_adoption_receipt_id,
      release_adoption_receipt_hash
    ) references public.release_adoption_receipts(
      installation_id, id, receipt_hash
    ) on delete restrict,
  constraint installation_core_surface_reconciliation_receipts_predecessor_pair check (
    (predecessor_receipt_id is null) = (predecessor_receipt_hash is null)
  ),
  constraint installation_core_surface_reconciliation_receipts_actor_check check (
    approved_by_person_id = owner_person_id
    and applied_by_person_id = owner_person_id
  ),
  constraint installation_core_surface_reconciliation_receipts_time_check check (
    applied_at = date_trunc('milliseconds', applied_at)
    and approval_consumed_at = applied_at
    and installation_owner_verified_at = applied_at
    and aal2_verified_at <= applied_at
    and applied_at <= aal2_verified_at + interval '10 minutes'
  ),
  constraint installation_core_surface_reconciliation_receipts_workspace_refs check (
    jsonb_typeof(workspace_receipts) = 'array'
    and jsonb_array_length(workspace_receipts) > 0
  ),
  constraint installation_core_surface_reconciliation_receipts_distinct_ids check (
    receipt_id not in (approval_id, approval_receipt_id,
      release_adoption_receipt_id)
    and (predecessor_receipt_id is null or predecessor_receipt_id not in (
      receipt_id, approval_id, approval_receipt_id,
      release_adoption_receipt_id
    ))
  ),
  constraint installation_core_surface_reconciliation_receipts_distinct_hashes check (
    receipt_hash not in (
      approval_receipt_hash, approval_hash, plan_hash,
      release_adoption_receipt_hash, preimage_inventory_hash,
      postimage_inventory_hash, transition_set_hash
    )
  ),
  unique (installation_id, receipt_id),
  unique (installation_id, receipt_id, receipt_hash),
  constraint installation_core_surface_reconciliation_receipts_linear_successor unique (
    installation_id, predecessor_receipt_id, predecessor_receipt_hash
  )
);

create unique index installation_core_surface_reconciliation_one_genesis_idx
  on public.installation_core_surface_reconciliation_receipts(installation_id)
  where predecessor_receipt_id is null and predecessor_receipt_hash is null;

alter table public.installation_core_surface_reconciliation_receipts
  add constraint installation_core_surface_reconciliation_receipts_predecessor_fk
    foreign key (
      installation_id, predecessor_receipt_id, predecessor_receipt_hash
    ) references public.installation_core_surface_reconciliation_receipts(
      installation_id, receipt_id, receipt_hash
    ) on delete restrict;

alter table public.installations
  add constraint installations_core_surface_reconciliation_lineage_fk
    foreign key (
      id, core_surface_reconciliation_receipt_id,
      core_surface_reconciliation_receipt_hash
    ) references public.installation_core_surface_reconciliation_receipts(
      installation_id, receipt_id, receipt_hash
    ) on delete restrict deferrable initially deferred;

create table public.workspace_core_surface_reconciliation_receipts (
  receipt_id uuid primary key,
  installation_receipt_id uuid not null,
  approval_id uuid not null,
  approval_receipt_id uuid not null,
  approval_receipt_hash text not null check (
    approval_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  predecessor_receipt_id uuid,
  predecessor_receipt_hash text check (
    predecessor_receipt_hash is null
    or predecessor_receipt_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  preimage_surface jsonb not null,
  preimage_module_count integer not null check (
    preimage_module_count between 1 and 7
  ),
  preimage_surface_hash text not null check (
    preimage_surface_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  target_preferences jsonb not null,
  postimage_surface jsonb not null,
  postimage_surface_hash text not null check (
    postimage_surface_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  compiled_registry_hash text not null check (
    compiled_registry_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  legacy_projection_contract_hash text not null check (
    legacy_projection_contract_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  applied_by_person_id uuid not null,
  applied_at timestamptz not null,
  row_counts jsonb not null,
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint workspace_core_surface_reconciliation_receipts_installation_fk
    foreign key (installation_id, installation_receipt_id)
    references public.installation_core_surface_reconciliation_receipts(
      installation_id, receipt_id
    ) on delete restrict deferrable initially deferred,
  constraint workspace_core_surface_reconciliation_receipts_approval_fk
    foreign key (installation_id, approval_id, plan_hash)
    references public.installation_core_surface_reconciliation_approvals(
      installation_id, approval_id, plan_hash
    ) on delete restrict,
  constraint workspace_core_surface_reconciliation_receipts_approval_receipt_fk
    foreign key (
      installation_id, approval_receipt_id, approval_receipt_hash
    ) references public.installation_core_surface_reconciliation_approval_receipts(
      installation_id, receipt_id, receipt_hash
    ) on delete restrict,
  constraint workspace_core_surface_reconciliation_receipts_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_core_surface_reconciliation_receipts_person_fk
    foreign key (installation_id, applied_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_core_surface_reconciliation_receipts_predecessor_pair check (
    (predecessor_receipt_id is null) = (predecessor_receipt_hash is null)
  ),
  constraint workspace_core_surface_reconciliation_receipts_preimage_check check (
    public.vorton_legacy_workspace_core_surface_valid(preimage_surface)
    and preimage_module_count = jsonb_array_length(preimage_surface->'modules')
    and public.vorton_module_lifecycle_hash(preimage_surface) =
      preimage_surface_hash
  ),
  constraint workspace_core_surface_reconciliation_receipts_postimage_check check (
    target_preferences = public.normalize_workspace_core_surface_preferences(
      target_preferences
    )
    and postimage_surface = public.derive_workspace_core_surface(
      target_preferences
    )
    and public.vorton_module_lifecycle_hash(postimage_surface) =
      postimage_surface_hash
  ),
  constraint workspace_core_surface_reconciliation_receipts_time_check check (
    applied_at = date_trunc('milliseconds', applied_at)
  ),
  constraint workspace_core_surface_reconciliation_receipts_distinct check (
    preimage_surface <> postimage_surface
    and preimage_surface_hash <> postimage_surface_hash
  ),
  unique (installation_id, workspace_id, receipt_id),
  unique (installation_id, workspace_id, receipt_id, receipt_hash),
  unique (installation_receipt_id, workspace_id)
);

alter table public.workspace_core_surface_reconciliation_receipts
  add constraint workspace_core_surface_reconciliation_receipts_lineage_child_fk
    foreign key (
      installation_id, workspace_id, receipt_id, receipt_hash
    ) references public.workspace_core_surface_lineage_receipts(
      installation_id, workspace_id, receipt_id, receipt_hash
    ) on delete restrict deferrable initially deferred;

create function public.vorton_generic_workspace_core_surface_valid(value jsonb)
returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
begin
  return public.normalize_workspace_core_surface(value) = value;
exception when others then
  return false;
end
$$;

create function public.workspace_core_surface_authority_state(
  target_installation_id uuid,
  target_workspace_id uuid
) returns text
language plpgsql stable strict
set search_path = pg_catalog, public
as $$
declare
  workspace_row public.workspaces;
  surface_value jsonb;
  surface_hash_value text;
  lineage public.workspace_core_surface_lineage_receipts;
begin
  select * into workspace_row
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id;
  if workspace_row.id is null then
    return 'invalid';
  end if;
  surface_value := public.workspace_core_surface_document(
    target_installation_id, target_workspace_id
  );
  surface_hash_value := public.vorton_module_lifecycle_hash(surface_value);
  if jsonb_array_length(surface_value->'modules') = 0
    and workspace_row.default_module_id is null
    and workspace_row.core_surface_selection_receipt_id is null
    and not exists (
      select 1 from public.workspace_core_surface_lineage_receipts receipt
       where receipt.installation_id = target_installation_id
         and receipt.workspace_id = target_workspace_id
    )
  then
    return 'unconfigured';
  end if;
  if workspace_row.core_surface_selection_receipt_id is null
    and public.vorton_legacy_workspace_core_surface_valid(surface_value)
    and not exists (
      select 1 from public.workspace_core_surface_lineage_receipts receipt
       where receipt.installation_id = target_installation_id
         and receipt.workspace_id = target_workspace_id
    )
  then
    return 'legacy';
  end if;
  if workspace_row.core_surface_selection_receipt_id is not null
    and public.vorton_generic_workspace_core_surface_valid(surface_value)
  then
    select * into lineage
      from public.workspace_core_surface_lineage_receipts receipt
     where receipt.installation_id = target_installation_id
       and receipt.workspace_id = target_workspace_id
       and receipt.receipt_id = workspace_row.core_surface_selection_receipt_id
       and receipt.receipt_hash = workspace_row.core_surface_selection_receipt_hash;
    if lineage.receipt_id is not null
      and lineage.postimage_surface_hash = surface_hash_value
    then
      return 'selected';
    end if;
  end if;
  return 'invalid';
end
$$;

create function public.installation_core_surface_inventory_document(
  target_installation_id uuid
) returns jsonb
language plpgsql stable strict
set search_path = pg_catalog, public
as $$
declare
  workspace_row record;
  state_value text;
  surface_value jsonb;
  surface_hash_value text;
  workspace_items jsonb := '[]'::jsonb;
  inventory_core jsonb;
  unconfigured_count integer := 0;
  selected_count integer := 0;
  legacy_count integer := 0;
begin
  for workspace_row in
    select workspace.id, workspace.realm,
           workspace.core_surface_selection_receipt_id as head_id,
           workspace.core_surface_selection_receipt_hash as head_hash,
           lineage.receipt_kind as head_kind
      from public.workspaces workspace
      left join public.workspace_core_surface_lineage_receipts lineage
        on lineage.installation_id = workspace.installation_id
       and lineage.workspace_id = workspace.id
       and lineage.receipt_id = workspace.core_surface_selection_receipt_id
       and lineage.receipt_hash = workspace.core_surface_selection_receipt_hash
     where workspace.installation_id = target_installation_id
     order by workspace.id::text collate "C"
  loop
    state_value := public.workspace_core_surface_authority_state(
      target_installation_id, workspace_row.id
    );
    surface_value := public.workspace_core_surface_document(
      target_installation_id, workspace_row.id
    );
    surface_hash_value := public.vorton_module_lifecycle_hash(surface_value);
    unconfigured_count := unconfigured_count +
      case when state_value = 'unconfigured' then 1 else 0 end;
    selected_count := selected_count +
      case when state_value = 'selected' then 1 else 0 end;
    legacy_count := legacy_count +
      case when state_value = 'legacy' then 1 else 0 end;
    workspace_items := workspace_items || jsonb_build_array(
      jsonb_build_object(
        'workspaceId', workspace_row.id::text,
        'realm', workspace_row.realm::text,
        'state', case when state_value = 'legacy'
          then 'legacy-unreceipted' else state_value end,
        'moduleCount', jsonb_array_length(surface_value->'modules'),
        'surfaceSha256', surface_hash_value,
        'lineage', case when workspace_row.head_id is null
          then 'null'::jsonb
          else jsonb_build_object(
            'contract', case workspace_row.head_kind
              when 'workspace-selection'
                then 'vorton.workspace-core-surface-selection-receipt.v1'
              when 'installation-reconciliation'
                then 'vorton.workspace-core-surface-reconciliation-receipt.v1'
            end,
            'receiptId', workspace_row.head_id::text,
            'receiptSha256', workspace_row.head_hash
          ) end
      )
    );
  end loop;
  inventory_core := jsonb_build_object(
    'workspaceCount', jsonb_array_length(workspace_items),
    'unconfiguredWorkspaceCount', unconfigured_count,
    'selectedWorkspaceCount', selected_count,
    'legacyWorkspaceCount', legacy_count,
    'entries', workspace_items
  );
  return inventory_core || jsonb_build_object(
    'inventorySha256', public.vorton_module_lifecycle_hash(inventory_core)
  );
end
$$;

create function public.installation_core_surface_reconciliation_plan_document(
  target_installation_id uuid,
  target_release_adoption_receipt_id uuid,
  target_release_adoption_receipt_hash text
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  installation_row public.installations;
  release_receipt public.release_adoption_receipts;
  workspace_row record;
  state_value text;
  current_surface_value jsonb;
  target_preferences_value jsonb;
  target_surface_value jsonb;
  current_inventory jsonb;
  plan_core jsonb;
  transitions jsonb := '[]'::jsonb;
  affected_count integer := 0;
  invalid_count integer := 0;
  selected_count integer := 0;
  unconfigured_count integer := 0;
begin
  select * into installation_row
    from public.installations installation
   where installation.id = target_installation_id;
  if installation_row.id is null then
    raise exception 'Installation core-surface reconciliation target is unavailable';
  end if;
  select * into release_receipt
    from public.release_adoption_receipts receipt
   where receipt.installation_id = target_installation_id
     and receipt.id = target_release_adoption_receipt_id
     and receipt.receipt_hash = target_release_adoption_receipt_hash;
  if release_receipt.id is null
    or release_receipt.receipt_hash <>
      public.vorton_module_lifecycle_hash(
        public.release_adoption_receipt_document(release_receipt) -
          'receiptHash'
      )
  then
    raise exception 'Exact adopted Vorton release receipt is required';
  end if;
  if release_receipt.release->>'coreMigrationHead' <
    '20260831000500_installation_core_surface_reconciliation'
  then
    raise exception 'Adopted release does not carry reconciliation authority';
  end if;

  current_inventory := public.installation_core_surface_inventory_document(
    target_installation_id
  );
  for workspace_row in
    select workspace.id, workspace.realm
      from public.workspaces workspace
     where workspace.installation_id = target_installation_id
     order by workspace.id::text collate "C"
  loop
    state_value := public.workspace_core_surface_authority_state(
      target_installation_id, workspace_row.id
    );
    if state_value = 'legacy' then
      current_surface_value := public.workspace_core_surface_document(
        target_installation_id, workspace_row.id
      );
      target_preferences_value :=
        public.workspace_core_surface_preferences_from_legacy(
          current_surface_value
        );
      target_surface_value := public.derive_workspace_core_surface(
        target_preferences_value
      );
      transitions := transitions || jsonb_build_array(jsonb_build_object(
        'workspaceId', workspace_row.id::text,
        'realm', workspace_row.realm::text,
        'preimageModuleCount',
          jsonb_array_length(current_surface_value->'modules'),
        'preimageSurfaceSha256', public.vorton_module_lifecycle_hash(
          current_surface_value
        ),
        'targetSurface', target_surface_value,
        'targetSurfaceSha256', public.vorton_module_lifecycle_hash(
          target_surface_value
        )
      ));
      affected_count := affected_count + 1;
    elsif state_value = 'selected' then
      selected_count := selected_count + 1;
    elsif state_value = 'unconfigured' then
      unconfigured_count := unconfigured_count + 1;
    else
      invalid_count := invalid_count + 1;
    end if;
  end loop;
  if invalid_count > 0 then
    raise exception 'Installation contains an invalid core-surface projection';
  end if;
  if affected_count = 0 then
    raise exception 'Installation contains no eligible legacy core surface';
  end if;
  plan_core := jsonb_build_object(
    'contract', 'vorton.installation-core-surface-reconciliation-plan.v1',
    'operation', 'reconcile-legacy-compiled-core-surfaces',
    'vortonInstallationId', target_installation_id::text,
    'targetRelease', jsonb_build_object(
      'adoptionReceiptId', release_receipt.id::text,
      'adoptionReceiptSha256', release_receipt.receipt_hash,
      'receiptPlane', release_receipt.receipt_plane,
      'manifestSha256', release_receipt.release->>'manifestSha256',
      'sourceCommit', release_receipt.release->>'sourceCommit',
      'migrationHead', release_receipt.release->>'coreMigrationHead',
      'workspaceIsolationProofSha256',
        release_receipt.release->>'workspaceIsolationProofSha256',
      'workspaceIsolationProofHash',
        release_receipt.release->>'workspaceIsolationProofHash',
      'status', release_receipt.status,
      'adoptedAt', to_char(
        release_receipt.adopted_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ),
    'compiledRegistrySha256', public.vorton_module_lifecycle_hash(
      public.workspace_compiled_core_surface_registry_document()
    ),
    'legacyProjectionContractSha256', public.vorton_module_lifecycle_hash(
      public.vorton_legacy_core_surface_contract_document()
    ),
    'predecessorReconciliationReceipt', case
      when installation_row.core_surface_reconciliation_receipt_id is null
        then 'null'::jsonb
      else jsonb_build_object(
        'receiptId',
          installation_row.core_surface_reconciliation_receipt_id::text,
        'receiptSha256',
          installation_row.core_surface_reconciliation_receipt_hash
      ) end,
    'inventory', current_inventory,
    'transitions', transitions,
    'transitionSetSha256', public.vorton_module_lifecycle_hash(transitions),
    'limits', '{
      "compiledCoreSurfaceCompatibilityOnly": true,
      "workspaceProjectionMetadataRead": true,
      "workspaceProjectionMutated": true,
      "workspaceLineageMutated": true,
      "installationLineageMutated": true,
      "releaseInstalled": false,
      "releaseAdopted": false,
      "workspaceCreated": false,
      "workspaceBusinessDataRead": false,
      "workspaceBusinessDataMutated": false,
      "workspaceAuthorityBorrowed": false,
      "personalDataRead": false,
      "artifactResolved": false,
      "artifactLoaded": false,
      "moduleRuntimeStarted": false,
      "moduleAdmitted": false,
      "moduleMigrated": false,
      "infrastructureMutated": false,
      "externalSystemMutated": false,
      "privateConsumerAuthorityGranted": false
    }'::jsonb
  );
  return plan_core || jsonb_build_object(
    'planHash', public.vorton_module_lifecycle_hash(plan_core)
  );
end
$$;

create function public.installation_core_surface_reconciliation_binding_document(
  value public.installation_core_surface_reconciliation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'vortonInstallationId', value.installation_id::text,
    'planHash', value.plan_hash,
    'targetRelease', value.plan->'targetRelease',
    'compiledRegistrySha256', value.plan->>'compiledRegistrySha256',
    'legacyProjectionContractSha256',
      value.plan->>'legacyProjectionContractSha256',
    'predecessorReconciliationReceipt',
      value.plan->'predecessorReconciliationReceipt',
    'inventorySha256', value.plan#>>'{inventory,inventorySha256}',
    'transitionSetSha256', value.plan->>'transitionSetSha256',
    'workspaceCount', (value.plan#>>'{inventory,workspaceCount}')::integer,
    'legacyWorkspaceCount',
      (value.plan#>>'{inventory,legacyWorkspaceCount}')::integer
  )
$$;

create function public.installation_core_surface_reconciliation_authority_document(
  value public.installation_core_surface_reconciliation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'principalKind', 'person',
    'personId', value.owner_person_id::text,
    'installationPersonKind', 'owner',
    'signedInstallationPersonContext', true,
    'liveInstallationOwnerChecked', true,
    'workspaceAuthorityBorrowed', false,
    'rolesGrantAuthority', false
  )
$$;

create function public.installation_core_surface_reconciliation_approval_core_document(
  value public.installation_core_surface_reconciliation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.installation-core-surface-reconciliation-approval.v1',
    'approvalId', value.approval_id::text,
    'approvalPlane', value.approval_plane,
    'ownerPersonId', value.owner_person_id::text,
    'binding',
      public.installation_core_surface_reconciliation_binding_document(value),
    'authority',
      public.installation_core_surface_reconciliation_authority_document(value),
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
    'installationOwnerVerifiedAt', to_char(
      value.installation_owner_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'scope', value.scope,
    'rolesGrantAuthority', false
  )
$$;

create function public.derive_installation_core_surface_reconciliation_approval_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.plan_hash <> new.plan->>'planHash'
    or new.plan_hash <> public.vorton_module_lifecycle_hash(
      new.plan - 'planHash'
    )
  then
    raise exception 'Installation reconciliation plan hash is invalid';
  end if;
  new.approval_hash := public.vorton_module_lifecycle_hash(
    public.installation_core_surface_reconciliation_approval_core_document(new)
  );
  return new;
end
$$;

create trigger installation_core_surface_reconciliation_approvals_derive_hash
before insert on public.installation_core_surface_reconciliation_approvals
for each row execute function
  public.derive_installation_core_surface_reconciliation_approval_hash();

create function public.installation_core_surface_reconciliation_approval_receipt_core_document(
  value public.installation_core_surface_reconciliation_approval_receipts,
  approval public.installation_core_surface_reconciliation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract',
      'vorton.installation-core-surface-reconciliation-approval-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', value.receipt_plane,
    'approvalId', value.approval_id::text,
    'approvalHash', value.approval_hash,
    'ownerPersonId', value.owner_person_id::text,
    'binding',
      public.installation_core_surface_reconciliation_binding_document(approval),
    'authority',
      public.installation_core_surface_reconciliation_authority_document(approval),
    'approvedAt', to_char(
      value.approved_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'expiresAt', to_char(
      approval.expires_at at time zone 'UTC',
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
    'installationOwnerVerifiedAt', to_char(
      value.installation_owner_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'scope', approval.scope,
    'rolesGrantAuthority', false,
    'effects', value.effects
  )
$$;

create function public.derive_installation_core_surface_reconciliation_approval_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  approval public.installation_core_surface_reconciliation_approvals;
begin
  select * into approval
    from public.installation_core_surface_reconciliation_approvals existing
   where existing.installation_id = new.installation_id
     and existing.approval_id = new.approval_id;
  if approval.approval_id is null
    or new.receipt_id <> approval.approval_receipt_id
    or new.owner_person_id <> approval.owner_person_id
    or new.plan_hash <> approval.plan_hash
    or new.approval_hash <> approval.approval_hash
    or new.approved_at <> approval.approved_at
    or new.created_at <> approval.approved_at
    or new.aal2_verified_at <> approval.aal2_verified_at
    or new.assurance_level <> approval.assurance_level
    or new.installation_owner_verified_at <>
      approval.installation_owner_verified_at
  then
    raise exception 'Installation core-surface reconciliation approval receipt integrity failure';
  end if;
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.installation_core_surface_reconciliation_approval_receipt_core_document(
      new, approval
    )
  );
  return new;
end
$$;

create trigger installation_core_surface_reconciliation_approval_receipts_derive_hash
before insert on public.installation_core_surface_reconciliation_approval_receipts
for each row execute function
  public.derive_installation_core_surface_reconciliation_approval_receipt_hash();

create function public.installation_core_surface_reconciliation_approval_document(
  approval public.installation_core_surface_reconciliation_approvals,
  receipt public.installation_core_surface_reconciliation_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.installation_core_surface_reconciliation_approval_core_document(
    approval
  ) || jsonb_build_object(
    'approvalReceiptId', receipt.receipt_id::text,
    'approvalReceiptSha256', receipt.receipt_hash
  )
$$;

create function public.installation_core_surface_reconciliation_approval_receipt_document(
  value public.installation_core_surface_reconciliation_approval_receipts,
  approval public.installation_core_surface_reconciliation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.installation_core_surface_reconciliation_approval_receipt_core_document(
    value, approval
  ) || jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.read_installation_core_surface_reconciliation_plan(
  target_installation_id uuid,
  target_release_adoption_receipt_id uuid,
  target_release_adoption_receipt_hash text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  subject_text text := current_setting('vorton.subject_id', true);
  owner_person_id_value uuid;
begin
  if subject_text is null
    or public.vorton_installation_step_up_context_valid(
      target_installation_id::text, subject_text
    ) is not true
  then
    raise exception 'Signed recent installation-person AAL2 is required';
  end if;
  select person.id into owner_person_id_value
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_text::uuid
     and person.kind = 'owner'
   for share;
  if owner_person_id_value is null then
    raise exception 'Live installation owner authority is required';
  end if;
  return public.installation_core_surface_reconciliation_plan_document(
    target_installation_id, target_release_adoption_receipt_id,
    target_release_adoption_receipt_hash
  );
end
$$;

create function public.create_installation_core_surface_reconciliation_approval(
  target_approval_id uuid,
  target_installation_id uuid,
  expected_plan_hash text,
  target_expires_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  subject_text text := current_setting('vorton.subject_id', true);
  owner_person_id_value uuid;
  approved_at_value timestamptz;
  aal2_verified_at_value timestamptz;
  plan_value jsonb;
  candidate_plan jsonb;
  plan_hash_value text;
  target_approval_receipt_id uuid;
  target_release_adoption_receipt_id uuid;
  target_release_adoption_receipt_hash text;
  release_candidate public.release_adoption_receipts;
  matching_release_count integer := 0;
  approval public.installation_core_surface_reconciliation_approvals;
  approval_receipt
    public.installation_core_surface_reconciliation_approval_receipts;
  effects_value jsonb := '{
    "approvalCreated": true,
    "approvalConsumed": false,
    "installationReconciliationApplied": false,
    "workspaceProjectionMutated": false,
    "workspaceLineageMutated": false,
    "installationLineageMutated": false,
    "releaseInstalled": false,
    "releaseAdopted": false,
    "workspaceAuthorityBorrowed": false,
    "workspaceBusinessDataRead": false,
    "workspaceBusinessDataMutated": false,
    "externalSystemMutated": false
  }'::jsonb;
  scope_value jsonb := '{
    "compiledCoreSurfaceCompatibilityOnly": true,
    "workspaceProjectionMetadataRead": true,
    "workspaceProjectionMutated": true,
    "workspaceLineageMutated": true,
    "installationLineageMutated": true,
    "releaseInstalled": false,
    "releaseAdopted": false,
    "workspaceCreated": false,
    "workspaceAuthorityBorrowed": false,
    "workspaceBusinessDataRead": false,
    "workspaceBusinessDataMutated": false,
    "personalDataRead": false,
    "artifactResolved": false,
    "artifactLoaded": false,
    "moduleRuntimeStarted": false,
    "moduleAdmitted": false,
    "moduleMigrated": false,
    "infrastructureMutated": false,
    "externalSystemMutated": false,
    "privateConsumerAuthorityGranted": false
  }'::jsonb;
begin
  -- Authenticate the signed installation-person envelope and lock the live
  -- owner before reading any release or workspace projection. Otherwise this
  -- security-definer function becomes an installation and plan oracle.
  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if target_approval_id is null
    or target_installation_id is null
    or expected_plan_hash is null
    or expected_plan_hash !~ '^sha256:[a-f0-9]{64}$'
    or target_expires_at is null
    or target_expires_at <> date_trunc('milliseconds', target_expires_at)
    or target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
    or subject_text is null
    or subject_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or public.vorton_installation_step_up_context_valid(
      target_installation_id::text, subject_text
    ) is not true
  then
    raise exception 'Signed recent installation-owner authority is required';
  end if;
  select person.id into owner_person_id_value
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_text::uuid
     and person.kind = 'owner'
   for share;
  if owner_person_id_value is null then
    raise exception 'Signed recent installation-owner authority is required';
  end if;

  for release_candidate in
    select receipt.*
      from public.release_adoption_receipts receipt
     where receipt.installation_id = target_installation_id
       and receipt.status = 'adopted'
       and receipt.release->>'coreMigrationHead' >=
         '20260831000500_installation_core_surface_reconciliation'
     order by receipt.adopted_at desc, receipt.id::text collate "C"
  loop
    candidate_plan :=
      public.installation_core_surface_reconciliation_plan_document(
        target_installation_id, release_candidate.id,
        release_candidate.receipt_hash
      );
    if candidate_plan->>'planHash' = expected_plan_hash then
      matching_release_count := matching_release_count + 1;
      plan_value := candidate_plan;
      target_release_adoption_receipt_id := release_candidate.id;
      target_release_adoption_receipt_hash := release_candidate.receipt_hash;
    end if;
  end loop;
  if matching_release_count <> 1 then
    raise exception 'Exact installation reconciliation plan hash is required';
  end if;
  target_approval_receipt_id := public.vorton_core_surface_reconciliation_uuid(
    'installation-reconciliation-approval-receipt|' ||
    target_approval_id::text || '|' || expected_plan_hash
  );
  if target_approval_id in (
      target_approval_receipt_id, target_release_adoption_receipt_id
    )
    or target_approval_receipt_id = target_release_adoption_receipt_id
  then
    raise exception 'Installation reconciliation approval identities conflict';
  end if;
  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if target_expires_at <> date_trunc('milliseconds', target_expires_at)
    or target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
  then
    raise exception 'Installation reconciliation approval expiry is invalid';
  end if;
  if subject_text is null
    or public.vorton_installation_step_up_context_valid(
      target_installation_id::text, subject_text
    ) is not true
  then
    raise exception 'Signed recent installation-person AAL2 is required';
  end if;
  aal2_verified_at_value := to_timestamp(
    current_setting('vorton.auth_time', true)::bigint
  );
  select person.id into owner_person_id_value
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_text::uuid
     and person.kind = 'owner'
   for share;
  if owner_person_id_value is null then
    raise exception 'Live installation owner authority is required';
  end if;
  plan_hash_value := plan_value->>'planHash';
  if expected_plan_hash <> plan_hash_value then
    raise exception 'Exact installation reconciliation plan hash is required';
  end if;

  select * into approval
    from public.installation_core_surface_reconciliation_approvals existing
   where existing.installation_id = target_installation_id
     and existing.approval_id = target_approval_id
   for update;
  if approval.approval_id is not null then
    select * into approval_receipt
      from public.installation_core_surface_reconciliation_approval_receipts
     where installation_id = target_installation_id
       and approval_id = target_approval_id;
    if approval.approval_receipt_id <> target_approval_receipt_id
      or approval.owner_person_id <> owner_person_id_value
      or approval.release_adoption_receipt_id <>
        target_release_adoption_receipt_id
      or approval.release_adoption_receipt_hash <>
        target_release_adoption_receipt_hash
      or approval.plan <> plan_value
      or approval.plan_hash <> plan_hash_value
      or approval.expires_at <> target_expires_at
      or approval_receipt.receipt_id is null
    then
      raise exception 'Installation reconciliation approval retry conflicts with immutable authority';
    end if;
    return jsonb_build_object(
      'approval',
        public.installation_core_surface_reconciliation_approval_document(
          approval, approval_receipt
        ),
      'approvalReceipt',
        public.installation_core_surface_reconciliation_approval_receipt_document(
          approval_receipt, approval
        )
    );
  end if;

  insert into public.installation_core_surface_reconciliation_approvals (
    approval_id, approval_receipt_id, installation_id, owner_person_id,
    release_adoption_receipt_id, release_adoption_receipt_hash, plan,
    plan_hash, approval_plane, approved_at, expires_at, aal2_verified_at,
    assurance_level, installation_owner_verified_at, scope, approval_hash,
    created_at
  ) values (
    target_approval_id, target_approval_receipt_id, target_installation_id,
    owner_person_id_value, target_release_adoption_receipt_id,
    target_release_adoption_receipt_hash, plan_value, plan_hash_value,
    'installation-postgres', approved_at_value, target_expires_at,
    aal2_verified_at_value, 'aal2', approved_at_value, scope_value,
    'sha256:' || repeat('0', 64), approved_at_value
  ) returning * into approval;

  insert into public.installation_core_surface_reconciliation_approval_receipts (
    receipt_id, approval_id, installation_id, owner_person_id, plan_hash,
    approval_hash, receipt_plane, approved_at, created_at,
    aal2_verified_at, assurance_level, installation_owner_verified_at,
    effects, receipt_hash
  ) values (
    target_approval_receipt_id, approval.approval_id,
    approval.installation_id, approval.owner_person_id, approval.plan_hash,
    approval.approval_hash, 'installation-postgres', approval.approved_at,
    approval.approved_at, approval.aal2_verified_at, 'aal2',
    approval.installation_owner_verified_at, effects_value,
    'sha256:' || repeat('0', 64)
  ) returning * into approval_receipt;

  return jsonb_build_object(
    'approval',
      public.installation_core_surface_reconciliation_approval_document(
        approval, approval_receipt
      ),
    'approvalReceipt',
      public.installation_core_surface_reconciliation_approval_receipt_document(
        approval_receipt, approval
      )
  );
end
$$;

create function public.workspace_core_surface_reconciliation_receipt_core_document(
  value public.workspace_core_surface_reconciliation_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-core-surface-reconciliation-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', 'installation-postgres',
    'installationReceiptId', value.installation_receipt_id::text,
    'approvalId', value.approval_id::text,
    'approvalReceiptId', value.approval_receipt_id::text,
    'approvalReceiptSha256', value.approval_receipt_hash,
    'planHash', value.plan_hash,
    'vortonInstallationId', value.installation_id::text,
    'workspaceId', value.workspace_id::text,
    'realm', value.realm::text,
    'predecessorCoreSurfaceLineageReceipt', case
      when value.predecessor_receipt_id is null then 'null'::jsonb
      else jsonb_build_object(
        'receiptId', value.predecessor_receipt_id::text,
        'receiptSha256', value.predecessor_receipt_hash
      ) end,
    'compiledRegistrySha256', value.compiled_registry_hash,
    'legacyProjectionContractSha256',
      value.legacy_projection_contract_hash,
    'preimageModuleCount', value.preimage_module_count,
    'preimageSurfaceSha256', value.preimage_surface_hash,
    'postimageSurface', value.postimage_surface,
    'postimageSurfaceSha256', value.postimage_surface_hash,
    'appliedByPersonId', value.applied_by_person_id::text,
    'appliedAt', to_char(
      value.applied_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'rowCounts', value.row_counts,
    'effects', value.effects
  )
$$;

create function public.derive_workspace_core_surface_reconciliation_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.row_counts <> jsonb_build_object(
      'preimageCoreSurfaceRows',
        jsonb_array_length(new.preimage_surface->'modules'),
      'updatedCoreSurfaceRows', 1,
      'postimageCoreSurfaceRows',
        jsonb_array_length(new.postimage_surface->'modules'),
      'defaultCoreSurfaceRowsUpdated', 0,
      'workspaceLineageRowsInserted', 1,
      'workspaceBusinessRowsRead', 0,
      'workspaceBusinessRowsMutated', 0
    )
    or new.effects <> '{
      "legacyCompatibilityReconciled": true,
      "workspaceProjectionMetadataRead": true,
      "workspaceProjectionMutated": true,
      "historicalAttributionPreserved": true,
      "workspaceLineageAdvanced": true,
      "workspaceAuthorityBorrowed": false,
      "workspaceBusinessDataRead": false,
      "workspaceBusinessDataMutated": false,
      "artifactResolved": false,
      "artifactLoaded": false,
      "moduleRuntimeStarted": false,
      "moduleAdmitted": false,
      "moduleMigrated": false,
      "personalDataRead": false
    }'::jsonb
  then
    raise exception 'Workspace core-surface reconciliation receipt effects are invalid';
  end if;
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.workspace_core_surface_reconciliation_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_core_surface_reconciliation_receipts_derive_hash
before insert on public.workspace_core_surface_reconciliation_receipts
for each row execute function
  public.derive_workspace_core_surface_reconciliation_receipt_hash();

create function public.record_workspace_core_surface_reconciliation_lineage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.workspace_core_surface_lineage_receipts (
    receipt_id, installation_id, workspace_id, receipt_kind,
    predecessor_receipt_id, predecessor_receipt_hash,
    preimage_surface_hash, postimage_surface_hash, applied_at, receipt_hash
  ) values (
    new.receipt_id, new.installation_id, new.workspace_id,
    'installation-reconciliation', new.predecessor_receipt_id,
    new.predecessor_receipt_hash, new.preimage_surface_hash,
    new.postimage_surface_hash, new.applied_at, new.receipt_hash
  );
  return new;
end
$$;

create trigger workspace_core_surface_reconciliation_receipts_record_lineage
after insert on public.workspace_core_surface_reconciliation_receipts
for each row execute function
  public.record_workspace_core_surface_reconciliation_lineage();

create function public.workspace_core_surface_reconciliation_receipt_document(
  value public.workspace_core_surface_reconciliation_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_core_surface_reconciliation_receipt_core_document(
    value
  ) || jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.installation_core_surface_reconciliation_receipt_core_document(
  value public.installation_core_surface_reconciliation_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.installation-core-surface-reconciliation-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', 'installation-postgres',
    'approvalId', value.approval_id::text,
    'approvalReceiptId', value.approval_receipt_id::text,
    'approvalReceiptSha256', value.approval_receipt_hash,
    'approvalHash', value.approval_hash,
    'binding', jsonb_build_object(
      'vortonInstallationId', value.installation_id::text,
      'planHash', value.plan_hash,
      'targetRelease', value.plan->'targetRelease',
      'compiledRegistrySha256', value.plan->>'compiledRegistrySha256',
      'legacyProjectionContractSha256',
        value.plan->>'legacyProjectionContractSha256',
      'predecessorReconciliationReceipt',
        value.plan->'predecessorReconciliationReceipt',
      'inventorySha256', value.plan#>>'{inventory,inventorySha256}',
      'transitionSetSha256', value.plan->>'transitionSetSha256',
      'workspaceCount',
        (value.plan#>>'{inventory,workspaceCount}')::integer,
      'legacyWorkspaceCount',
        (value.plan#>>'{inventory,legacyWorkspaceCount}')::integer
    ),
    'preimageInventorySha256', value.preimage_inventory_hash,
    'postimageInventory', value.postimage_inventory,
    'workspaceReceipts', value.workspace_receipts,
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
    'installationOwnerVerifiedAt', to_char(
      value.installation_owner_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'rowCounts', value.row_counts,
    'idempotency', value.idempotency,
    'effects', value.effects
  )
$$;

create function public.derive_installation_core_surface_reconciliation_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  approval public.installation_core_surface_reconciliation_approvals;
  approval_receipt
    public.installation_core_surface_reconciliation_approval_receipts;
begin
  select * into approval
    from public.installation_core_surface_reconciliation_approvals existing
   where existing.installation_id = new.installation_id
     and existing.approval_id = new.approval_id;
  select * into approval_receipt
    from public.installation_core_surface_reconciliation_approval_receipts existing
   where existing.installation_id = new.installation_id
     and existing.receipt_id = new.approval_receipt_id;
  if approval.approval_id is null
    or approval_receipt.receipt_id is null
    or new.approval_receipt_id <> approval.approval_receipt_id
    or new.approval_receipt_hash <> approval_receipt.receipt_hash
    or new.approval_hash <> approval.approval_hash
    or new.owner_person_id <> approval.owner_person_id
    or new.release_adoption_receipt_id <>
      approval.release_adoption_receipt_id
    or new.release_adoption_receipt_hash <>
      approval.release_adoption_receipt_hash
    or new.plan <> approval.plan
    or new.plan_hash <> approval.plan_hash
    or new.preimage_inventory_hash <>
      approval.plan#>>'{inventory,inventorySha256}'
    or new.postimage_inventory_hash <>
      new.postimage_inventory->>'inventorySha256'
    or public.vorton_module_lifecycle_hash(
      new.postimage_inventory - 'inventorySha256'
    ) <> new.postimage_inventory_hash
    or new.transition_set_hash <> approval.plan->>'transitionSetSha256'
  then
    raise exception 'Installation core-surface reconciliation receipt integrity failure';
  end if;
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.installation_core_surface_reconciliation_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger installation_core_surface_reconciliation_receipts_derive_hash
before insert on public.installation_core_surface_reconciliation_receipts
for each row execute function
  public.derive_installation_core_surface_reconciliation_receipt_hash();

create function public.installation_core_surface_reconciliation_receipt_document(
  value public.installation_core_surface_reconciliation_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.installation_core_surface_reconciliation_receipt_core_document(
    value
  ) || jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.apply_installation_core_surface_reconciliation(
  target_installation_id uuid,
  target_approval_id uuid,
  target_receipt_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  subject_text text := current_setting('vorton.subject_id', true);
  actor_person_id_value uuid;
  installation_row public.installations;
  approval public.installation_core_surface_reconciliation_approvals;
  approval_receipt
    public.installation_core_surface_reconciliation_approval_receipts;
  existing_receipt
    public.installation_core_surface_reconciliation_receipts;
  execution_receipt
    public.installation_core_surface_reconciliation_receipts;
  workspace_receipt public.workspace_core_surface_reconciliation_receipts;
  workspace_receipt_documents jsonb := '[]'::jsonb;
  workspace_receipt_refs jsonb := '[]'::jsonb;
  transition jsonb;
  workspace_row public.workspaces;
  current_surface_value jsonb;
  current_surface_hash_value text;
  target_preferences_value jsonb;
  target_surface_value jsonb;
  target_surface_hash_value text;
  current_plan_value jsonb;
  current_plan_hash_value text;
  current_inventory_value jsonb;
  current_inventory_hash_value text;
  applied_at_value timestamptz;
  aal2_verified_at_value timestamptz;
  updated_row_count integer;
  workspace_receipt_id_value uuid;
  affected_count integer;
  row_counts_value jsonb;
  effects_value jsonb := '{
    "approvalConsumed": true,
    "installationReconciliationApplied": true,
    "legacyCompatibilityReconciled": true,
    "workspaceProjectionMetadataRead": true,
    "workspaceProjectionMutated": true,
    "historicalAttributionPreserved": true,
    "workspaceLineageAdvanced": true,
    "installationLineageAdvanced": true,
    "releaseInstalled": false,
    "releaseAdopted": false,
    "workspaceAuthorityBorrowed": false,
    "workspaceBusinessDataRead": false,
    "workspaceBusinessDataMutated": false,
    "artifactResolved": false,
    "artifactLoaded": false,
    "moduleRuntimeStarted": false,
    "moduleAdmitted": false,
    "moduleMigrated": false,
    "personalDataRead": false,
    "infrastructureMutated": false,
    "externalSystemMutated": false,
    "privateConsumerAuthorityGranted": false
  }'::jsonb;
begin
  -- Authenticate before any approval or receipt lookup. Caller-selected UUIDs
  -- must not turn the security-definer apply function into an authority-ledger
  -- existence oracle.
  applied_at_value := date_trunc('milliseconds', clock_timestamp());
  if target_installation_id is null
    or target_approval_id is null
    or target_receipt_id is null
    or subject_text is null
    or subject_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or public.vorton_installation_step_up_context_valid(
      target_installation_id::text, subject_text
    ) is not true
  then
    raise exception 'Signed recent installation-owner authority is required';
  end if;
  select person.id into actor_person_id_value
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_text::uuid
     and person.kind = 'owner'
   for share;
  if actor_person_id_value is null then
    raise exception 'Signed recent installation-owner authority is required';
  end if;

  select * into approval
    from public.installation_core_surface_reconciliation_approvals existing
   where existing.installation_id = target_installation_id
     and existing.approval_id = target_approval_id
   for update;
  if approval.approval_id is null then
    raise exception 'Exact installation reconciliation approval is required';
  end if;
  if target_receipt_id in (
      approval.approval_id, approval.approval_receipt_id,
      approval.release_adoption_receipt_id
    )
  then
    raise exception 'Installation reconciliation receipt identity conflicts with authority';
  end if;
  select * into approval_receipt
    from public.installation_core_surface_reconciliation_approval_receipts existing
   where existing.installation_id = target_installation_id
     and existing.approval_id = target_approval_id
   for share;
  if approval_receipt.receipt_id is null then
    raise exception 'Exact no-effect installation reconciliation approval receipt is required';
  end if;

  applied_at_value := date_trunc('milliseconds', clock_timestamp());
  if subject_text is null
    or public.vorton_installation_step_up_context_valid(
      target_installation_id::text, subject_text
    ) is not true
  then
    raise exception 'Signed recent installation-person AAL2 is required';
  end if;
  aal2_verified_at_value := to_timestamp(
    current_setting('vorton.auth_time', true)::bigint
  );
  select * into installation_row
    from public.installations installation
   where installation.id = target_installation_id
   for update;
  select person.id into actor_person_id_value
    from public.people person
   where person.installation_id = target_installation_id
     and person.auth_user_id = subject_text::uuid
     and person.kind = 'owner'
   for share;
  if actor_person_id_value is null
    or actor_person_id_value <> approval.owner_person_id
  then
    raise exception 'Live installation-owner authority is required';
  end if;

  select * into existing_receipt
    from public.installation_core_surface_reconciliation_receipts existing
   where existing.installation_id = target_installation_id
     and existing.approval_id = target_approval_id;
  if existing_receipt.receipt_id is not null then
    if existing_receipt.receipt_id <> target_receipt_id
      or existing_receipt.approval_receipt_id <>
        approval_receipt.receipt_id
      or existing_receipt.approval_receipt_hash <>
        approval_receipt.receipt_hash
      or existing_receipt.plan_hash <> approval.plan_hash
      or existing_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.installation_core_surface_reconciliation_receipt_core_document(
            existing_receipt
          )
        )
    then
      raise exception 'Installation reconciliation retry conflicts with immutable receipt';
    end if;
    select coalesce(jsonb_agg(
      public.workspace_core_surface_reconciliation_receipt_document(child)
      order by child.workspace_id::text collate "C"
    ), '[]'::jsonb) into workspace_receipt_documents
      from public.workspace_core_surface_reconciliation_receipts child
     where child.installation_receipt_id = existing_receipt.receipt_id;
    return jsonb_build_object(
      'workspaceReceipts', workspace_receipt_documents,
      'applicationReceipt',
        public.installation_core_surface_reconciliation_receipt_document(
          existing_receipt
        )
    );
  end if;

  if approval.expires_at <= applied_at_value
    or approval.approved_at > applied_at_value
  then
    raise exception 'Live unexpired installation-owner authority is required';
  end if;

  perform 1
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
   order by workspace.id::text collate "C"
   for update;
  perform 1
    from public.workspace_module_activations projection
   where projection.installation_id = target_installation_id
   order by projection.workspace_id::text collate "C",
            projection.navigation_order, projection.module_id
   for update;

  current_plan_value :=
    public.installation_core_surface_reconciliation_plan_document(
      target_installation_id, approval.release_adoption_receipt_id,
      approval.release_adoption_receipt_hash
    );
  current_plan_hash_value := current_plan_value->>'planHash';
  if current_plan_value <> approval.plan
    or current_plan_hash_value <> approval.plan_hash
    or approval.approval_hash <> public.vorton_module_lifecycle_hash(
      public.installation_core_surface_reconciliation_approval_core_document(
        approval
      )
    )
    or approval_receipt.approval_hash <> approval.approval_hash
    or approval_receipt.receipt_hash <> public.vorton_module_lifecycle_hash(
      public.installation_core_surface_reconciliation_approval_receipt_core_document(
        approval_receipt, approval
      )
    )
    or installation_row.core_surface_reconciliation_receipt_id is distinct
      from (
        approval.plan#>>'{predecessorReconciliationReceipt,receiptId}'
      )::uuid
  then
    raise exception 'Installation reconciliation authority changed before application';
  end if;

  affected_count :=
    (approval.plan#>>'{inventory,legacyWorkspaceCount}')::integer;
  for transition in
    select item from jsonb_array_elements(approval.plan->'transitions') item
  loop
    select * into workspace_row
      from public.workspaces workspace
     where workspace.installation_id = target_installation_id
       and workspace.id = (transition->>'workspaceId')::uuid
     for update;
    current_surface_value := public.workspace_core_surface_document(
      target_installation_id, workspace_row.id
    );
    current_surface_hash_value := public.vorton_module_lifecycle_hash(
      current_surface_value
    );
    target_preferences_value :=
      public.workspace_core_surface_preferences_from_legacy(
        current_surface_value
      );
    target_surface_value := transition->'targetSurface';
    target_surface_hash_value := public.vorton_module_lifecycle_hash(
      target_surface_value
    );
    if workspace_row.id is null
      or workspace_row.realm::text <> transition->>'realm'
      or public.workspace_core_surface_authority_state(
        target_installation_id, workspace_row.id
      ) <> 'legacy'
      or current_surface_hash_value <>
        transition->>'preimageSurfaceSha256'
      or target_surface_hash_value <>
        transition->>'targetSurfaceSha256'
    then
      raise exception 'Installation reconciliation workspace preimage changed';
    end if;

    update public.workspace_module_activations projection
       set presentation_variant = 'read-only'
     where projection.installation_id = target_installation_id
       and projection.workspace_id = workspace_row.id
       and projection.module_id = 'factory'
       and projection.contract_version = 'v1'
       and projection.label = 'Factory'
       and projection.presentation_variant = 'freed-read-only';
    get diagnostics updated_row_count = row_count;
    if updated_row_count <> 1
      or public.workspace_core_surface_document(
        target_installation_id, workspace_row.id
      ) <> target_surface_value
    then
      raise exception 'Exact legacy core-surface reconciliation failed';
    end if;

    workspace_receipt_id_value := public.vorton_core_surface_reconciliation_uuid(
      'workspace-reconciliation-receipt|' || target_receipt_id::text || '|' ||
      workspace_row.id::text
    );
    insert into public.workspace_core_surface_reconciliation_receipts (
      receipt_id, installation_receipt_id, approval_id,
      approval_receipt_id, approval_receipt_hash, plan_hash,
      installation_id, workspace_id,
      realm, predecessor_receipt_id, predecessor_receipt_hash,
      preimage_surface, preimage_module_count, preimage_surface_hash,
      target_preferences,
      postimage_surface, postimage_surface_hash, applied_by_person_id,
      compiled_registry_hash, legacy_projection_contract_hash,
      applied_at, row_counts, effects, receipt_hash
    ) values (
      workspace_receipt_id_value, target_receipt_id, approval.approval_id,
      approval_receipt.receipt_id, approval_receipt.receipt_hash,
      approval.plan_hash,
      target_installation_id, workspace_row.id, workspace_row.realm,
      null, null, current_surface_value,
      jsonb_array_length(current_surface_value->'modules'),
      current_surface_hash_value,
      target_preferences_value, target_surface_value,
      target_surface_hash_value, actor_person_id_value,
      approval.plan->>'compiledRegistrySha256',
      approval.plan->>'legacyProjectionContractSha256', applied_at_value,
      jsonb_build_object(
        'preimageCoreSurfaceRows',
          jsonb_array_length(current_surface_value->'modules'),
        'updatedCoreSurfaceRows', updated_row_count,
        'postimageCoreSurfaceRows',
          jsonb_array_length(target_surface_value->'modules'),
        'defaultCoreSurfaceRowsUpdated', 0,
        'workspaceLineageRowsInserted', 1,
        'workspaceBusinessRowsRead', 0,
        'workspaceBusinessRowsMutated', 0
      ),
      '{
        "legacyCompatibilityReconciled": true,
        "workspaceProjectionMetadataRead": true,
        "workspaceProjectionMutated": true,
        "historicalAttributionPreserved": true,
        "workspaceLineageAdvanced": true,
        "workspaceAuthorityBorrowed": false,
        "workspaceBusinessDataRead": false,
        "workspaceBusinessDataMutated": false,
        "artifactResolved": false,
        "artifactLoaded": false,
        "moduleRuntimeStarted": false,
        "moduleAdmitted": false,
        "moduleMigrated": false,
        "personalDataRead": false
      }'::jsonb,
      'sha256:' || repeat('0', 64)
    ) returning * into workspace_receipt;

    update public.workspaces
       set core_surface_selection_receipt_id = workspace_receipt.receipt_id,
           core_surface_selection_receipt_hash = workspace_receipt.receipt_hash
     where installation_id = target_installation_id
       and id = workspace_row.id;
    workspace_receipt_refs := workspace_receipt_refs || jsonb_build_array(
      jsonb_build_object(
        'workspaceId', workspace_receipt.workspace_id::text,
        'receiptId', workspace_receipt.receipt_id::text,
        'receiptSha256', workspace_receipt.receipt_hash
      )
    );
    workspace_receipt_documents := workspace_receipt_documents ||
      jsonb_build_array(
        public.workspace_core_surface_reconciliation_receipt_document(
          workspace_receipt
        )
      );
  end loop;

  current_inventory_value :=
    public.installation_core_surface_inventory_document(target_installation_id);
  current_inventory_hash_value := current_inventory_value->>'inventorySha256';
  if (current_inventory_value->>'legacyWorkspaceCount')::integer <> 0
    or (current_inventory_value->>'workspaceCount')::integer <>
      (approval.plan#>>'{inventory,workspaceCount}')::integer
  then
    raise exception 'Installation reconciliation postimage inventory is invalid';
  end if;

  row_counts_value := jsonb_build_object(
    'workspaceInventoryRowsRead',
      (approval.plan#>>'{inventory,workspaceCount}')::integer,
    'legacyWorkspaceRowsLocked', affected_count,
    'workspaceProjectionRowsUpdated', affected_count,
    'workspaceLineageRowsInserted', affected_count,
    'installationLineageRowsUpdated', 1,
    'workspaceBusinessRowsRead', 0,
    'workspaceBusinessRowsMutated', 0
  );
  insert into public.installation_core_surface_reconciliation_receipts (
    receipt_id, approval_id, approval_receipt_id, approval_receipt_hash,
    approval_hash, installation_id, owner_person_id,
    release_adoption_receipt_id, release_adoption_receipt_hash, plan,
    plan_hash, predecessor_receipt_id, predecessor_receipt_hash,
    workspace_receipts, preimage_inventory_hash, postimage_inventory_hash,
    postimage_inventory, transition_set_hash,
    approved_by_person_id, applied_by_person_id,
    approval_consumption_count, approval_consumed_at, applied_at,
    aal2_verified_at, assurance_level, installation_owner_verified_at,
    row_counts, idempotency, effects, receipt_hash
  ) values (
    target_receipt_id, approval.approval_id, approval_receipt.receipt_id,
    approval_receipt.receipt_hash, approval.approval_hash,
    approval.installation_id, approval.owner_person_id,
    approval.release_adoption_receipt_id,
    approval.release_adoption_receipt_hash, approval.plan,
    approval.plan_hash, installation_row.core_surface_reconciliation_receipt_id,
    installation_row.core_surface_reconciliation_receipt_hash,
    workspace_receipt_refs,
    approval.plan#>>'{inventory,inventorySha256}',
    current_inventory_hash_value,
    current_inventory_value,
    approval.plan->>'transitionSetSha256', approval.owner_person_id,
    actor_person_id_value, 1, applied_at_value, applied_at_value,
    aal2_verified_at_value, 'aal2', applied_at_value, row_counts_value,
    jsonb_build_object(
      'key', target_receipt_id::text,
      'exactReplayReturnsSameReceipt', true,
      'conflictingReplayDenied', true,
      'additionalProjectionMutationsOnReplay', 0
    ),
    effects_value, 'sha256:' || repeat('0', 64)
  ) returning * into execution_receipt;

  update public.installations
     set core_surface_reconciliation_receipt_id = execution_receipt.receipt_id,
         core_surface_reconciliation_receipt_hash = execution_receipt.receipt_hash
   where id = target_installation_id;

  return jsonb_build_object(
    'workspaceReceipts', workspace_receipt_documents,
    'applicationReceipt',
      public.installation_core_surface_reconciliation_receipt_document(
        execution_receipt
      )
  );
end
$$;

create function public.reject_installation_core_surface_reconciliation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Installation core-surface reconciliation authority is append-only';
end
$$;

create trigger installation_core_surface_reconciliation_approvals_append_only
before update or delete
on public.installation_core_surface_reconciliation_approvals
for each row execute function
  public.reject_installation_core_surface_reconciliation_mutation();

create trigger installation_core_surface_reconciliation_approval_receipts_append_only
before update or delete
on public.installation_core_surface_reconciliation_approval_receipts
for each row execute function
  public.reject_installation_core_surface_reconciliation_mutation();

create trigger installation_core_surface_reconciliation_receipts_append_only
before update or delete
on public.installation_core_surface_reconciliation_receipts
for each row execute function
  public.reject_installation_core_surface_reconciliation_mutation();

create trigger workspace_core_surface_reconciliation_receipts_append_only
before update or delete
on public.workspace_core_surface_reconciliation_receipts
for each row execute function
  public.reject_installation_core_surface_reconciliation_mutation();

alter table public.installation_core_surface_reconciliation_approvals
  enable row level security;
alter table public.installation_core_surface_reconciliation_approval_receipts
  enable row level security;
alter table public.installation_core_surface_reconciliation_receipts
  enable row level security;
alter table public.workspace_core_surface_reconciliation_receipts
  enable row level security;

revoke all on table
  public.installation_core_surface_reconciliation_approvals,
  public.installation_core_surface_reconciliation_approval_receipts,
  public.installation_core_surface_reconciliation_receipts,
  public.workspace_core_surface_reconciliation_receipts
from public, anon, authenticated, aubos_worker;

do $revoke_reconciliation_helpers$
declare
  target record;
begin
  for target in
    select routine.oid::regprocedure::text as signature
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname = 'public'
       and routine.proname = any(array[
         'vorton_legacy_core_surface_contract_document',
         'vorton_legacy_workspace_core_surface_valid',
         'workspace_core_surface_preferences_from_legacy',
         'vorton_core_surface_reconciliation_uuid',
         'vorton_generic_workspace_core_surface_valid',
         'workspace_core_surface_authority_state',
         'installation_core_surface_inventory_document',
         'installation_core_surface_reconciliation_plan_document',
         'installation_core_surface_reconciliation_binding_document',
         'installation_core_surface_reconciliation_authority_document',
         'installation_core_surface_reconciliation_approval_core_document',
         'derive_installation_core_surface_reconciliation_approval_hash',
         'installation_core_surface_reconciliation_approval_receipt_core_document',
         'derive_installation_core_surface_reconciliation_approval_receipt_hash',
         'installation_core_surface_reconciliation_approval_document',
         'installation_core_surface_reconciliation_approval_receipt_document',
         'workspace_core_surface_reconciliation_receipt_core_document',
         'derive_workspace_core_surface_reconciliation_receipt_hash',
         'record_workspace_core_surface_reconciliation_lineage',
         'workspace_core_surface_reconciliation_receipt_document',
         'installation_core_surface_reconciliation_receipt_core_document',
         'derive_installation_core_surface_reconciliation_receipt_hash',
         'installation_core_surface_reconciliation_receipt_document',
         'reject_installation_core_surface_reconciliation_mutation',
         'read_installation_core_surface_reconciliation_plan',
         'create_installation_core_surface_reconciliation_approval',
         'apply_installation_core_surface_reconciliation'
       ])
  loop
    execute 'revoke all on function ' || target.signature ||
      ' from public, anon, authenticated, aubos_worker';
  end loop;
end
$revoke_reconciliation_helpers$;

grant execute on function public.read_installation_core_surface_reconciliation_plan(
  uuid, uuid, text
) to authenticated;
grant execute on function public.create_installation_core_surface_reconciliation_approval(
  uuid, uuid, text, timestamptz
) to authenticated;
grant execute on function public.apply_installation_core_surface_reconciliation(
  uuid, uuid, uuid
) to authenticated;

commit;
