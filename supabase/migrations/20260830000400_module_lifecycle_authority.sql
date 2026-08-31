-- Workspace-owned, recent-AAL2 approval authority for exact module data-lifecycle actions.
-- This migration records approval creation only. It does not consume an approval
-- or execute backup, recovery, deletion, or rollback.

begin;

create type public.module_lifecycle_action as enum (
  'backup', 'recovery', 'deletion', 'rollback'
);

create function public.vorton_module_lifecycle_hash(value jsonb)
returns text
language sql immutable strict
set search_path = pg_catalog, public, extensions
as $$
  select 'sha256:' || encode(
    extensions.digest(
      convert_to(public.vorton_canonical_jsonb(value), 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

-- Cross-language canonicalization vector. packages/contracts uses the same
-- ASCII key ordering, compact JSON, array ordering, and SHA-256 bytes.
do $$
declare
  vector jsonb := '{
    "z": null,
    "a": {
      "timestamp": "2026-08-30T12:00:00.000Z",
      "uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "integer": 42,
      "array": [3, "x", false],
      "nested": {"b": 2, "a": 1}
    }
  }'::jsonb;
begin
  if public.vorton_canonical_jsonb(vector)
      <> '{"a":{"array":[3,"x",false],"integer":42,"nested":{"a":1,"b":2},"timestamp":"2026-08-30T12:00:00.000Z","uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"z":null}'
    or public.vorton_module_lifecycle_hash(vector)
      <> 'sha256:12b1b0f57cff0749342d1d85bdd5ec6fcbb5f024209ca22b408e31959e5e8c6e'
  then
    raise exception 'Module lifecycle canonical JSON vector mismatch';
  end if;
end
$$;

create function public.vorton_jsonb_has_exact_keys(
  value jsonb,
  expected_keys text[]
) returns boolean
language sql immutable strict
set search_path = pg_catalog
as $$
  select coalesce(
    jsonb_typeof(value) = 'object'
    and value ?& expected_keys
    and (select count(*) from jsonb_object_keys(value)) = cardinality(expected_keys),
    false
  )
$$;

create function public.vorton_module_lifecycle_receipt_reference_valid(value jsonb)
returns boolean
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select coalesce(
    public.vorton_jsonb_has_exact_keys(value, array['receiptId', 'receiptSha256'])
    and jsonb_typeof(value->'receiptId') = 'string'
    and value->>'receiptId'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and jsonb_typeof(value->'receiptSha256') = 'string'
    and value->>'receiptSha256' ~ '^sha256:[a-f0-9]{64}$',
    false
  )
$$;

create function public.vorton_module_lifecycle_binding_valid(value jsonb)
returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  target jsonb;
  target_action text;
  object_key text;
  sequence_text text;
  prerequisite_ids text[] := array[]::text[];
  prerequisite_hashes text[] := array[]::text[];
begin
  if not public.vorton_jsonb_has_exact_keys(
    value,
    array[
      'vortonInstallationId', 'workspaceId', 'realm', 'module', 'sequence',
      'migrationPlanHash', 'sourceSnapshotSha256', 'targetPreimageSha256',
      'targetPostimageSha256', 'target'
    ]
  ) then
    return false;
  end if;

  if jsonb_typeof(value->'vortonInstallationId') <> 'string'
    or value->>'vortonInstallationId'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(value->'workspaceId') <> 'string'
    or value->>'workspaceId'
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(value->'realm') <> 'string'
    or value->>'realm' not in ('personal', 'organizational')
    or jsonb_typeof(value->'module') <> 'string'
    or value->>'module' !~ '^[a-z][a-z0-9-]*$'
  then
    return false;
  end if;

  if jsonb_typeof(value->'sequence') <> 'number' then
    return false;
  end if;
  sequence_text := value->>'sequence';
  if sequence_text !~ '^[1-9][0-9]*$'
    or sequence_text::numeric > 9007199254740991
  then
    return false;
  end if;

  if jsonb_typeof(value->'migrationPlanHash') <> 'string'
    or value->>'migrationPlanHash' !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(value->'sourceSnapshotSha256') <> 'string'
    or value->>'sourceSnapshotSha256' !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(value->'targetPreimageSha256') <> 'string'
    or value->>'targetPreimageSha256' !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(value->'targetPostimageSha256') <> 'string'
    or value->>'targetPostimageSha256' !~ '^sha256:[a-f0-9]{64}$'
    or value->>'targetPreimageSha256' = value->>'targetPostimageSha256'
  then
    return false;
  end if;

  target := value->'target';
  if jsonb_typeof(target) <> 'object'
    or jsonb_typeof(target->'action') <> 'string'
  then
    return false;
  end if;
  target_action := target->>'action';

  case target_action
    when 'backup' then
      if not public.vorton_jsonb_has_exact_keys(
        target,
        array['action', 'backupId', 'storageObjectKey', 'encryptionKeyBindingId']
      )
        or jsonb_typeof(target->'backupId') <> 'string'
        or target->>'backupId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(target->'encryptionKeyBindingId') <> 'string'
        or target->>'encryptionKeyBindingId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(target->'storageObjectKey') <> 'string'
      then
        return false;
      end if;
      object_key := target->>'storageObjectKey';
      if length(object_key) not between 1 and 512
        or object_key !~ '^[a-z0-9._/-]+$'
        or left(object_key, 1) = '/'
        or exists (
          select 1
          from regexp_split_to_table(object_key, '/') segment
          where segment in ('', '.', '..')
        )
      then
        return false;
      end if;

    when 'recovery' then
      if not public.vorton_jsonb_has_exact_keys(
        target,
        array['action', 'recoveryId', 'recoveryNamespace', 'backupReceipt']
      )
        or jsonb_typeof(target->'recoveryId') <> 'string'
        or target->>'recoveryId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(target->'recoveryNamespace') <> 'string'
        or target->>'recoveryNamespace' !~ '^[a-z][a-z0-9-]*$'
        or not public.vorton_module_lifecycle_receipt_reference_valid(
          target->'backupReceipt'
        )
      then
        return false;
      end if;
      prerequisite_ids := array[target#>>'{backupReceipt,receiptId}'];
      prerequisite_hashes := array[target#>>'{backupReceipt,receiptSha256}'];

    when 'deletion' then
      if not public.vorton_jsonb_has_exact_keys(
        target,
        array[
          'action', 'mode', 'rehearsalId', 'controlledFixtureId',
          'productionDeletion', 'noProductionRecords', 'backupReceipt',
          'recoveryReceipt', 'surfaces'
        ]
      )
        or target->>'mode' <> 'controlled-fixture'
        or jsonb_typeof(target->'mode') <> 'string'
        or jsonb_typeof(target->'rehearsalId') <> 'string'
        or target->>'rehearsalId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(target->'controlledFixtureId') <> 'string'
        or target->>'controlledFixtureId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or target->'productionDeletion' <> 'false'::jsonb
        or target->'noProductionRecords' <> 'true'::jsonb
        or not public.vorton_module_lifecycle_receipt_reference_valid(
          target->'backupReceipt'
        )
        or not public.vorton_module_lifecycle_receipt_reference_valid(
          target->'recoveryReceipt'
        )
        or not public.vorton_jsonb_has_exact_keys(
          target->'surfaces',
          array['database', 'storage', 'memory', 'search', 'backups']
        )
        or target#>'{surfaces,database}' <> 'true'::jsonb
        or target#>'{surfaces,storage}' <> 'true'::jsonb
        or target#>'{surfaces,memory}' <> 'true'::jsonb
        or target#>'{surfaces,search}' <> 'true'::jsonb
        or target#>'{surfaces,backups}' <> 'true'::jsonb
      then
        return false;
      end if;
      prerequisite_ids := array[
        target#>>'{backupReceipt,receiptId}',
        target#>>'{recoveryReceipt,receiptId}'
      ];
      prerequisite_hashes := array[
        target#>>'{backupReceipt,receiptSha256}',
        target#>>'{recoveryReceipt,receiptSha256}'
      ];

    when 'rollback' then
      if not public.vorton_jsonb_has_exact_keys(
        target,
        array[
          'action', 'rollbackId', 'rollbackNamespace', 'backupReceipt',
          'recoveryReceipt', 'deletionRehearsalReceipt'
        ]
      )
        or jsonb_typeof(target->'rollbackId') <> 'string'
        or target->>'rollbackId'
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(target->'rollbackNamespace') <> 'string'
        or target->>'rollbackNamespace' !~ '^[a-z][a-z0-9-]*$'
        or not public.vorton_module_lifecycle_receipt_reference_valid(
          target->'backupReceipt'
        )
        or not public.vorton_module_lifecycle_receipt_reference_valid(
          target->'recoveryReceipt'
        )
        or not public.vorton_module_lifecycle_receipt_reference_valid(
          target->'deletionRehearsalReceipt'
        )
      then
        return false;
      end if;
      prerequisite_ids := array[
        target#>>'{backupReceipt,receiptId}',
        target#>>'{recoveryReceipt,receiptId}',
        target#>>'{deletionRehearsalReceipt,receiptId}'
      ];
      prerequisite_hashes := array[
        target#>>'{backupReceipt,receiptSha256}',
        target#>>'{recoveryReceipt,receiptSha256}',
        target#>>'{deletionRehearsalReceipt,receiptSha256}'
      ];

    else
      return false;
  end case;

  if cardinality(prerequisite_ids) <> (
      select count(distinct identity) from unnest(prerequisite_ids) identity
    )
    or cardinality(prerequisite_hashes) <> (
      select count(distinct digest) from unnest(prerequisite_hashes) digest
    )
  then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end
$$;

create function public.vorton_module_lifecycle_identities_distinct(
  target_approval_id uuid,
  target_approval_record_id uuid,
  target_approval_receipt_id uuid,
  binding jsonb
) returns boolean
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  identities text[];
  action_name text;
begin
  if target_approval_id is null
    or target_approval_record_id is null
    or binding is null
    or not public.vorton_module_lifecycle_binding_valid(binding)
  then
    return false;
  end if;
  identities := array[
    target_approval_id::text,
    target_approval_record_id::text
  ];
  if target_approval_receipt_id is not null then
    identities := identities || target_approval_receipt_id::text;
  end if;
  action_name := binding#>>'{target,action}';
  if action_name in ('recovery', 'deletion', 'rollback') then
    identities := identities || array[
      binding#>>'{target,backupReceipt,receiptId}'
    ];
  end if;
  if action_name in ('deletion', 'rollback') then
    identities := identities || array[
      binding#>>'{target,recoveryReceipt,receiptId}'
    ];
  end if;
  if action_name = 'rollback' then
    identities := identities || array[
      binding#>>'{target,deletionRehearsalReceipt,receiptId}'
    ];
  end if;
  return cardinality(identities) = (
    select count(distinct identity) from unnest(identities) identity
  );
end
$$;

create function public.vorton_module_lifecycle_receipt_hash_distinct(
  target_receipt_hash text,
  binding jsonb
) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  prerequisite_hashes text[] := array[]::text[];
  action_name text;
begin
  if target_receipt_hash !~ '^sha256:[a-f0-9]{64}$'
    or not public.vorton_module_lifecycle_binding_valid(binding)
  then
    return false;
  end if;
  action_name := binding#>>'{target,action}';
  if action_name in ('recovery', 'deletion', 'rollback') then
    prerequisite_hashes := prerequisite_hashes || array[
      binding#>>'{target,backupReceipt,receiptSha256}'
    ];
  end if;
  if action_name in ('deletion', 'rollback') then
    prerequisite_hashes := prerequisite_hashes || array[
      binding#>>'{target,recoveryReceipt,receiptSha256}'
    ];
  end if;
  if action_name = 'rollback' then
    prerequisite_hashes := prerequisite_hashes || array[
      binding#>>'{target,deletionRehearsalReceipt,receiptSha256}'
    ];
  end if;
  return not target_receipt_hash = any(prerequisite_hashes);
end
$$;

create function public.vorton_workspace_step_up_context_valid(
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
    ),
    false
  )
  from aubos_private.runtime_context_keys context_key
  where context_key.role_name = session_user
$$;

-- Historical actor attribution must not freeze workspace membership. The
-- installation-person FK on records remains authoritative for actor identity,
-- while record insertion policies and this approval function check membership
-- live. Keeping the older membership FK would make revocation impossible after
-- writing any person-authored Record.
alter table public.records drop constraint records_workspace_person_fk;

create table public.module_lifecycle_action_approvals (
  approval_record_id uuid primary key,
  approval_id uuid not null,
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  owner_person_id uuid not null,
  action public.module_lifecycle_action not null,
  binding jsonb not null,
  binding_hash text not null check (binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  approval_plane text not null check (approval_plane = 'workspace-postgres'),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  workspace_membership_verified_at timestamptz not null,
  scope jsonb not null,
  roles_grant_authority boolean not null check (not roles_grant_authority),
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null,
  constraint module_lifecycle_approvals_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm) on delete restrict,
  constraint module_lifecycle_approvals_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint module_lifecycle_approvals_record_fk
    foreign key (installation_id, workspace_id, approval_record_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint module_lifecycle_approvals_binding_check check (
    public.vorton_module_lifecycle_binding_valid(binding)
    and binding->>'vortonInstallationId' = installation_id::text
    and binding->>'workspaceId' = workspace_id::text
    and binding->>'realm' = realm::text
    and binding#>>'{target,action}' = action::text
  ),
  constraint module_lifecycle_approvals_distinct_ids check (
    public.vorton_module_lifecycle_identities_distinct(
      approval_id, approval_record_id, null, binding
    )
  ),
  constraint module_lifecycle_approvals_time_check check (
    created_at = approved_at
    and workspace_membership_verified_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
    and expires_at > approved_at
    and expires_at <= approved_at + interval '24 hours'
  ),
  constraint module_lifecycle_approvals_scope_check check (
    scope = jsonb_build_object(
      'action', action::text,
      'moduleOnly', true,
      'otherWorkspaceMutation', false,
      'productionDeletion', false
    )
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (
    approval_record_id, approval_id, installation_id, workspace_id,
    owner_person_id, binding_hash, approval_hash
  )
);

create function public.module_lifecycle_approval_core_document(
  value public.module_lifecycle_action_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.module-lifecycle-action-approval.v1',
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalPlane', value.approval_plane,
    'ownerPersonId', value.owner_person_id::text,
    'binding', value.binding,
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
    'workspaceMembershipVerifiedAt', to_char(
      value.workspace_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'scope', value.scope,
    'rolesGrantAuthority', value.roles_grant_authority
  )
$$;

create function public.derive_module_lifecycle_approval_hashes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.binding_hash := public.vorton_module_lifecycle_hash(new.binding);
  new.approval_hash := public.vorton_module_lifecycle_hash(
    public.module_lifecycle_approval_core_document(new)
  );
  return new;
end
$$;

create trigger module_lifecycle_approvals_derive_hashes
before insert on public.module_lifecycle_action_approvals
for each row execute function public.derive_module_lifecycle_approval_hashes();

create table public.module_lifecycle_approval_receipts (
  receipt_id uuid primary key,
  approval_record_id uuid not null,
  approval_id uuid not null,
  installation_id uuid not null,
  workspace_id uuid not null,
  owner_person_id uuid not null,
  binding jsonb not null,
  binding_hash text not null check (binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  action public.module_lifecycle_action not null,
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  receipt_plane text not null check (receipt_plane = 'workspace-postgres'),
  approved_at timestamptz not null,
  created_at timestamptz not null,
  live_membership_checked_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint module_lifecycle_approval_receipts_approval_fk
    foreign key (
      approval_record_id, approval_id, installation_id, workspace_id,
      owner_person_id, binding_hash, approval_hash
    ) references public.module_lifecycle_action_approvals (
      approval_record_id, approval_id, installation_id, workspace_id,
      owner_person_id, binding_hash, approval_hash
    ) on delete restrict,
  constraint module_lifecycle_approval_receipts_binding_check check (
    public.vorton_module_lifecycle_binding_valid(binding)
    and binding->>'vortonInstallationId' = installation_id::text
    and binding->>'workspaceId' = workspace_id::text
    and binding#>>'{target,action}' = action::text
  ),
  constraint module_lifecycle_approval_receipts_distinct_ids check (
    public.vorton_module_lifecycle_identities_distinct(
      approval_id, approval_record_id, receipt_id, binding
    )
  ),
  constraint module_lifecycle_approval_receipts_distinct_hashes check (
    public.vorton_module_lifecycle_receipt_hash_distinct(receipt_hash, binding)
  ),
  constraint module_lifecycle_approval_receipts_time_check check (
    created_at = approved_at
    and live_membership_checked_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
  ),
  constraint module_lifecycle_approval_receipts_effects_check check (
    effects = '{
      "actionExecuted": false,
      "approvalConsumed": false,
      "workspaceMutated": false,
      "moduleDataMutated": false,
      "externalSystemMutated": false
    }'::jsonb
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (installation_id, workspace_id, receipt_id),
  unique (approval_record_id)
);

create function public.module_lifecycle_approval_receipt_core_document(
  value public.module_lifecycle_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.module-lifecycle-approval-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', value.receipt_plane,
    'approvalId', value.approval_id::text,
    'approvalHash', value.approval_hash,
    'binding', value.binding,
    'action', value.action::text,
    'vortonInstallationId', value.installation_id::text,
    'workspaceId', value.workspace_id::text,
    'ownerPersonId', value.owner_person_id::text,
    'approvedAt', to_char(
      value.approved_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdAt', to_char(
      value.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'liveMembershipCheckedAt', to_char(
      value.live_membership_checked_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'aal2VerifiedAt', to_char(
      value.aal2_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'assuranceLevel', value.assurance_level,
    'effects', value.effects
  )
$$;

create function public.derive_module_lifecycle_receipt_hashes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.binding_hash := public.vorton_module_lifecycle_hash(new.binding);
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.module_lifecycle_approval_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger module_lifecycle_receipts_derive_hashes
before insert on public.module_lifecycle_approval_receipts
for each row execute function public.derive_module_lifecycle_receipt_hashes();

create function public.module_lifecycle_approval_document(
  approval public.module_lifecycle_action_approvals,
  receipt public.module_lifecycle_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.module_lifecycle_approval_core_document(approval) ||
    jsonb_build_object(
      'approvalReceiptId', receipt.receipt_id::text,
      'approvalReceiptSha256', receipt.receipt_hash
    )
$$;

create function public.module_lifecycle_approval_receipt_document(
  value public.module_lifecycle_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.module_lifecycle_approval_receipt_core_document(value) ||
    jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.reject_module_lifecycle_authority_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Module lifecycle approvals and approval-creation receipts are append-only';
end
$$;

create trigger module_lifecycle_approvals_reject_update_delete
before update or delete on public.module_lifecycle_action_approvals
for each row execute function public.reject_module_lifecycle_authority_mutation();

create trigger module_lifecycle_receipts_reject_update_delete
before update or delete on public.module_lifecycle_approval_receipts
for each row execute function public.reject_module_lifecycle_authority_mutation();

create function public.create_module_lifecycle_action_approval(
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  exact_binding jsonb,
  target_expires_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  subject_text text := current_setting('vorton.subject_id', true);
  subject_id uuid;
  approved_at_value timestamptz;
  subject_auth_time timestamptz;
  owner_id uuid;
  workspace_realm public.installation_realm;
  approval_record_id_value uuid;
  approval_receipt_id_value uuid;
  approval public.module_lifecycle_action_approvals;
  receipt public.module_lifecycle_approval_receipts;
  approval_record public.records;
  scope_value jsonb;
  record_summary text;
  identifier_generation_attempt integer;
  effects_value jsonb := '{
    "actionExecuted": false,
    "approvalConsumed": false,
    "workspaceMutated": false,
    "moduleDataMutated": false,
    "externalSystemMutated": false
  }'::jsonb;
begin
  if target_approval_id is null
    or target_installation_id is null
    or target_workspace_id is null
    or exact_binding is null
    or not public.vorton_module_lifecycle_binding_valid(exact_binding)
  then
    raise exception 'Exact module lifecycle binding is invalid';
  end if;
  if exact_binding->>'vortonInstallationId' <> target_installation_id::text
    or exact_binding->>'workspaceId' <> target_workspace_id::text
  then
    raise exception 'Module lifecycle binding does not match workspace authority';
  end if;
  if subject_text is null or subject_text
    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Signed workspace-person AAL2 context is required to approve module lifecycle action';
  end if;
  subject_id := subject_text::uuid;

  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':' || target_workspace_id::text ||
    ':module-lifecycle-approval:' || target_approval_id::text,
    0
  ));
  approved_at_value := date_trunc('milliseconds', clock_timestamp());

  if not public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) then
    raise exception 'Signed workspace-person AAL2 context is required to approve module lifecycle action';
  end if;

  select person.id, workspace.realm
    into owner_id, workspace_realm
    from public.workspaces workspace
    join public.workspace_memberships membership
      on membership.installation_id = workspace.installation_id
     and membership.workspace_id = workspace.id
    join public.people person
      on person.installation_id = membership.installation_id
     and person.id = membership.person_id
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
     and person.auth_user_id = subject_id
     and membership.kind = 'owner'
   for share of membership, workspace, person;
  if owner_id is null then
    raise exception 'Live workspace owner authority is required to approve module lifecycle action';
  end if;
  if exact_binding->>'realm' <> workspace_realm::text then
    raise exception 'Module lifecycle binding does not match workspace authority';
  end if;

  -- A competing membership mutation may have held the row lock long enough
  -- for an otherwise valid step-up to become stale. Rebind the authoritative
  -- approval time and recheck AAL2 only after the live owner rows are locked.
  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if not public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) then
    raise exception 'Signed workspace-person AAL2 context is required to approve module lifecycle action';
  end if;
  subject_auth_time := to_timestamp(
    current_setting('vorton.workspace_step_up_auth_time', true)::bigint
  );

  select * into approval
    from public.module_lifecycle_action_approvals existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id;
  if approval.approval_record_id is not null then
    if approval.owner_person_id is distinct from owner_id
      or approval.binding is distinct from exact_binding
      or approval.expires_at is distinct from target_expires_at
    then
      raise exception 'Module lifecycle approval retry conflicts with immutable authority';
    end if;
    select * into receipt
      from public.module_lifecycle_approval_receipts existing_receipt
     where existing_receipt.approval_record_id = approval.approval_record_id;
    if receipt.receipt_id is null
      or receipt.approval_id is distinct from approval.approval_id
      or receipt.binding is distinct from approval.binding
      or receipt.approval_hash is distinct from approval.approval_hash
    then
      raise exception 'Module lifecycle approval receipt integrity failure';
    end if;
    record_summary := 'Approved exact module lifecycle ' ||
      approval.action::text || ' action';
    select * into approval_record
      from public.records existing_record
     where existing_record.installation_id = approval.installation_id
       and existing_record.workspace_id = approval.workspace_id
       and existing_record.id = approval.approval_record_id;
    if approval_record.id is null
      or approval_record.kind is distinct from 'approval'::public.record_kind
      or approval_record.summary is distinct from record_summary
      or approval_record.payload is distinct from
        public.module_lifecycle_approval_document(approval, receipt)
      or approval_record.source_uri is not null
      or approval_record.classification is distinct from
        'internal'::public.data_classification
      or approval_record.actor_person_id is distinct from approval.owner_person_id
      or approval_record.actor_worker_id is not null
      or approval_record.work_id is not null
      or approval_record.supersedes_record_id is not null
      or approval_record.created_at is distinct from approval.approved_at
    then
      raise exception 'Module lifecycle approval Record integrity failure';
    end if;
    return jsonb_build_object(
      'approval', public.module_lifecycle_approval_document(approval, receipt),
      'receipt', public.module_lifecycle_approval_receipt_document(receipt)
    );
  end if;

  if target_expires_at is null
    or target_expires_at is distinct from date_trunc(
      'milliseconds', target_expires_at
    )
    or target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
  then
    raise exception 'Module lifecycle approval expiry must be within 24 hours';
  end if;

  if (
    exact_binding#>>'{target,action}' in ('recovery', 'deletion', 'rollback')
    and target_approval_id::text =
      exact_binding#>>'{target,backupReceipt,receiptId}'
  ) or (
    exact_binding#>>'{target,action}' in ('deletion', 'rollback')
    and target_approval_id::text =
      exact_binding#>>'{target,recoveryReceipt,receiptId}'
  ) or (
    exact_binding#>>'{target,action}' = 'rollback'
    and target_approval_id::text =
      exact_binding#>>'{target,deletionRehearsalReceipt,receiptId}'
  ) then
    raise exception 'Exact module lifecycle binding is invalid';
  end if;

  for identifier_generation_attempt in 1..16 loop
    approval_record_id_value := gen_random_uuid();
    approval_receipt_id_value := gen_random_uuid();
    exit when public.vorton_module_lifecycle_identities_distinct(
      target_approval_id,
      approval_record_id_value,
      approval_receipt_id_value,
      exact_binding
    );
  end loop;
  if not public.vorton_module_lifecycle_identities_distinct(
    target_approval_id,
    approval_record_id_value,
    approval_receipt_id_value,
    exact_binding
  ) then
    raise exception 'Module lifecycle approval identifier generation failed';
  end if;

  scope_value := jsonb_build_object(
    'action', exact_binding#>>'{target,action}',
    'moduleOnly', true,
    'otherWorkspaceMutation', false,
    'productionDeletion', false
  );

  insert into public.module_lifecycle_action_approvals (
    approval_record_id, approval_id, installation_id, workspace_id, realm,
    owner_person_id, action, binding, binding_hash, approval_plane,
    approved_at, expires_at, aal2_verified_at, assurance_level,
    workspace_membership_verified_at, scope, roles_grant_authority,
    approval_hash, created_at
  ) values (
    approval_record_id_value, target_approval_id, target_installation_id,
    target_workspace_id, workspace_realm, owner_id,
    (exact_binding#>>'{target,action}')::public.module_lifecycle_action,
    exact_binding, 'sha256:' || repeat('0', 64), 'workspace-postgres',
    approved_at_value, target_expires_at, subject_auth_time, 'aal2',
    approved_at_value, scope_value, false, 'sha256:' || repeat('0', 64),
    approved_at_value
  ) returning * into approval;

  insert into public.module_lifecycle_approval_receipts (
    receipt_id, approval_record_id, approval_id, installation_id, workspace_id,
    owner_person_id, binding, binding_hash, action, approval_hash,
    receipt_plane, approved_at, created_at, live_membership_checked_at,
    aal2_verified_at, assurance_level, effects, receipt_hash
  ) values (
    approval_receipt_id_value, approval.approval_record_id,
    approval.approval_id, approval.installation_id, approval.workspace_id,
    approval.owner_person_id, approval.binding, approval.binding_hash,
    approval.action, approval.approval_hash, 'workspace-postgres',
    approval.approved_at, approval.approved_at, approval.approved_at,
    approval.aal2_verified_at, 'aal2', effects_value,
    'sha256:' || repeat('0', 64)
  ) returning * into receipt;

  record_summary := 'Approved exact module lifecycle ' ||
    approval.action::text || ' action';
  insert into public.records (
    id, installation_id, workspace_id, work_id, kind, summary, payload,
    source_uri, classification, actor_person_id, actor_worker_id,
    supersedes_record_id, created_at
  ) values (
    approval.approval_record_id, approval.installation_id,
    approval.workspace_id, null, 'approval', record_summary,
    public.module_lifecycle_approval_document(approval, receipt), null,
    'internal', approval.owner_person_id, null, null, approval.approved_at
  ) returning * into approval_record;

  return jsonb_build_object(
    'approval', public.module_lifecycle_approval_document(approval, receipt),
    'receipt', public.module_lifecycle_approval_receipt_document(receipt)
  );
end
$$;

alter table public.module_lifecycle_action_approvals enable row level security;
alter table public.module_lifecycle_approval_receipts enable row level security;

revoke all on table public.module_lifecycle_action_approvals,
  public.module_lifecycle_approval_receipts
  from public, anon, authenticated, aubos_worker;

revoke all on function public.vorton_module_lifecycle_hash(jsonb)
  from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_jsonb_has_exact_keys(jsonb, text[])
  from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_receipt_reference_valid(jsonb)
  from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_binding_valid(jsonb)
  from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_identities_distinct(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_receipt_hash_distinct(
  text, jsonb
) from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_workspace_step_up_context_valid(
  text, text, text, timestamptz
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_approval_core_document(
  public.module_lifecycle_action_approvals
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_approval_receipt_core_document(
  public.module_lifecycle_approval_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_approval_document(
  public.module_lifecycle_action_approvals,
  public.module_lifecycle_approval_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_approval_receipt_document(
  public.module_lifecycle_approval_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_module_lifecycle_approval_hashes()
  from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_module_lifecycle_receipt_hashes()
  from public, anon, authenticated, aubos_worker;
revoke all on function public.reject_module_lifecycle_authority_mutation()
  from public, anon, authenticated, aubos_worker;
revoke all on function public.create_module_lifecycle_action_approval(
  uuid, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated, aubos_worker;

grant execute on function public.create_module_lifecycle_action_approval(
  uuid, uuid, uuid, jsonb, timestamptz
) to authenticated;

commit;
