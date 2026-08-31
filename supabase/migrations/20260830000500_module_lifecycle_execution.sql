-- Immutable two-step execution authority for approved module lifecycle actions.
-- PostgreSQL admits and records exact commands, then separately records exact
-- observed results. External actions never run inside a database transaction.

begin;

create function public.vorton_module_lifecycle_predecessors(
  binding jsonb
) returns jsonb
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  action_name text;
begin
  if not public.vorton_module_lifecycle_binding_valid(binding) then
    raise exception 'Exact module lifecycle binding is invalid';
  end if;
  action_name := binding#>>'{target,action}';
  case action_name
    when 'backup' then
      return jsonb_build_object('action', 'backup');
    when 'recovery' then
      return jsonb_build_object(
        'action', 'recovery',
        'backup', binding#>'{target,backupReceipt}'
      );
    when 'deletion' then
      return jsonb_build_object(
        'action', 'deletion',
        'backup', binding#>'{target,backupReceipt}',
        'recovery', binding#>'{target,recoveryReceipt}'
      );
    when 'rollback' then
      return jsonb_build_object(
        'action', 'rollback',
        'backup', binding#>'{target,backupReceipt}',
        'recovery', binding#>'{target,recoveryReceipt}',
        'deletion', binding#>'{target,deletionRehearsalReceipt}'
      );
    else
      raise exception 'Unknown module lifecycle action';
  end case;
end
$$;

alter table public.module_lifecycle_approval_receipts
  add constraint module_lifecycle_approval_receipts_execution_key unique (
    receipt_id, approval_id, installation_id, workspace_id, owner_person_id,
    binding_hash, approval_hash, receipt_hash
  );

create table public.module_lifecycle_action_commands (
  command_id uuid primary key,
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
  action public.module_lifecycle_action not null,
  proof_scope text not null check (
    proof_scope in ('controlled-synthetic', 'workspace-production')
  ),
  binding jsonb not null,
  binding_hash text not null check (binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  executor_worker_id uuid not null,
  admission_credential_id uuid not null,
  work_id uuid not null,
  policy_id uuid not null,
  capability_grant_id uuid not null,
  live_authority_checked_at timestamptz not null,
  consumed_at timestamptz not null,
  predecessor_receipts jsonb not null,
  effects jsonb not null,
  command_hash text not null check (command_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint module_lifecycle_commands_approval_fk
    foreign key (
      approval_record_id, approval_id, installation_id, workspace_id,
      owner_person_id, binding_hash, approval_hash
    ) references public.module_lifecycle_action_approvals (
      approval_record_id, approval_id, installation_id, workspace_id,
      owner_person_id, binding_hash, approval_hash
    ) on delete restrict,
  constraint module_lifecycle_commands_approval_receipt_fk
    foreign key (
      approval_receipt_id, approval_id, installation_id, workspace_id,
      owner_person_id, binding_hash, approval_hash, approval_receipt_hash
    ) references public.module_lifecycle_approval_receipts (
      receipt_id, approval_id, installation_id, workspace_id,
      owner_person_id, binding_hash, approval_hash, receipt_hash
    ) on delete restrict,
  constraint module_lifecycle_commands_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm) on delete restrict,
  constraint module_lifecycle_commands_owner_fk
    foreign key (installation_id, owner_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint module_lifecycle_commands_worker_fk
    foreign key (installation_id, workspace_id, executor_worker_id)
    references public.workers(installation_id, workspace_id, id)
    on delete restrict,
  constraint module_lifecycle_commands_credential_fk
    foreign key (installation_id, workspace_id, admission_credential_id)
    references public.worker_credentials(installation_id, workspace_id, id)
    on delete restrict,
  constraint module_lifecycle_commands_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint module_lifecycle_commands_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint module_lifecycle_commands_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint module_lifecycle_commands_record_fk
    foreign key (installation_id, workspace_id, command_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint module_lifecycle_commands_binding_check check (
    public.vorton_module_lifecycle_binding_valid(binding)
    and binding->>'vortonInstallationId' = installation_id::text
    and binding->>'workspaceId' = workspace_id::text
    and binding->>'realm' = realm::text
    and binding#>>'{target,action}' = action::text
    and public.vorton_module_lifecycle_hash(binding) = binding_hash
  ),
  constraint module_lifecycle_commands_proof_scope_check check (
    action <> 'deletion' or proof_scope = 'controlled-synthetic'
  ),
  constraint module_lifecycle_commands_predecessors_check check (
    predecessor_receipts = public.vorton_module_lifecycle_predecessors(binding)
  ),
  constraint module_lifecycle_commands_effects_check check (
    effects = '{
      "approvalConsumed": true,
      "actionExecuted": false,
      "workspaceMutated": false,
      "moduleDataMutated": false,
      "externalSystemMutated": false
    }'::jsonb
  ),
  constraint module_lifecycle_commands_time_check check (
    live_authority_checked_at = consumed_at
    and consumed_at = date_trunc('milliseconds', consumed_at)
  ),
  constraint module_lifecycle_commands_identity_check check (
    command_id <> approval_id
    and command_id <> approval_record_id
    and command_id <> approval_receipt_id
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (installation_id, workspace_id, command_id),
  unique (
    command_id, command_hash, approval_record_id, approval_id, approval_receipt_id,
    approval_receipt_hash, approval_hash, installation_id, workspace_id,
    owner_person_id, action, binding_hash, executor_worker_id, work_id,
    policy_id, capability_grant_id, proof_scope, consumed_at
  )
);

create function public.module_lifecycle_action_command_core_document(
  value public.module_lifecycle_action_commands
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.module-lifecycle-action-command.v1',
    'commandId', value.command_id::text,
    'commandPlane', 'workspace-postgres',
    'approvalId', value.approval_id::text,
    'approvalReceiptId', value.approval_receipt_id::text,
    'approvalReceiptSha256', value.approval_receipt_hash,
    'approvalHash', value.approval_hash,
    'binding', value.binding,
    'action', value.action::text,
    'vortonInstallationId', value.installation_id::text,
    'workspaceId', value.workspace_id::text,
    'ownerPersonId', value.owner_person_id::text,
    'proofScope', value.proof_scope,
    'executor', jsonb_build_object(
      'kind', 'worker',
      'workerId', value.executor_worker_id::text,
      'workId', value.work_id::text,
      'policyId', value.policy_id::text,
      'admission', jsonb_build_object(
        'credentialId', value.admission_credential_id::text,
        'capabilityGrantId', value.capability_grant_id::text,
        'liveAuthorityCheckedAt', to_char(
          value.live_authority_checked_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      'rolesGrantAuthority', false
    ),
    'approvalConsumptionCount', 1,
    'consumedAt', to_char(
      value.consumed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'idempotencyKey', value.command_id::text,
    'predecessorReceipts', value.predecessor_receipts,
    'effects', value.effects
  )
$$;

create function public.module_lifecycle_action_command_document(
  value public.module_lifecycle_action_commands
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.module_lifecycle_action_command_core_document(value) ||
    jsonb_build_object('commandHash', value.command_hash)
$$;

create function public.derive_module_lifecycle_action_command_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.binding_hash := public.vorton_module_lifecycle_hash(new.binding);
  new.command_hash := public.vorton_module_lifecycle_hash(
    public.module_lifecycle_action_command_core_document(new)
  );
  return new;
end
$$;

create trigger module_lifecycle_action_commands_derive_hash
before insert on public.module_lifecycle_action_commands
for each row execute function public.derive_module_lifecycle_action_command_hash();

create function public.vorton_module_lifecycle_execution_identities_distinct(
  command_id uuid,
  approval_id uuid,
  approval_record_id uuid,
  approval_receipt_id uuid,
  action_receipt_id uuid,
  binding jsonb
) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  identities text[] := array[
    command_id::text, approval_id::text, approval_record_id::text,
    approval_receipt_id::text
  ];
  predecessors jsonb;
begin
  if not public.vorton_module_lifecycle_binding_valid(binding) then
    return false;
  end if;
  if action_receipt_id is not null then
    identities := identities || array[action_receipt_id::text];
  end if;
  predecessors := public.vorton_module_lifecycle_predecessors(binding);
  if predecessors->>'action' in ('recovery', 'deletion', 'rollback') then
    identities := identities || array[predecessors#>>'{backup,receiptId}'];
  end if;
  if predecessors->>'action' in ('deletion', 'rollback') then
    identities := identities || array[predecessors#>>'{recovery,receiptId}'];
  end if;
  if predecessors->>'action' = 'rollback' then
    identities := identities || array[predecessors#>>'{deletion,receiptId}'];
  end if;
  return cardinality(identities) = (
    select count(distinct identity) from unnest(identities) identity
  );
exception
  when others then return false;
end
$$;

alter table public.module_lifecycle_action_commands
  drop constraint module_lifecycle_commands_identity_check,
  add constraint module_lifecycle_commands_identity_check check (
    public.vorton_module_lifecycle_execution_identities_distinct(
      command_id, approval_id, approval_record_id, approval_receipt_id,
      null, binding
    )
  );

create function public.vorton_module_lifecycle_execution_hashes_distinct(
  approval_hash text,
  approval_receipt_hash text,
  command_hash text,
  action_receipt_hash text,
  binding jsonb
) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  hashes text[] := array[approval_hash, approval_receipt_hash, command_hash];
  predecessors jsonb;
begin
  if action_receipt_hash is not null then
    hashes := hashes || array[action_receipt_hash];
  end if;
  predecessors := public.vorton_module_lifecycle_predecessors(binding);
  if predecessors->>'action' in ('recovery', 'deletion', 'rollback') then
    hashes := hashes || array[predecessors#>>'{backup,receiptSha256}'];
  end if;
  if predecessors->>'action' in ('deletion', 'rollback') then
    hashes := hashes || array[predecessors#>>'{recovery,receiptSha256}'];
  end if;
  if predecessors->>'action' = 'rollback' then
    hashes := hashes || array[predecessors#>>'{deletion,receiptSha256}'];
  end if;
  return cardinality(hashes) = (
    select count(distinct digest) from unnest(hashes) digest
  );
exception
  when others then return false;
end
$$;

alter table public.module_lifecycle_action_commands
  add constraint module_lifecycle_commands_hash_identity_check check (
    public.vorton_module_lifecycle_execution_hashes_distinct(
      approval_hash, approval_receipt_hash, command_hash, null, binding
    )
  );

create function public.vorton_module_lifecycle_action_result_valid(
  target_action public.module_lifecycle_action,
  target_binding jsonb,
  target_consumed_at timestamptz,
  target_executed_at timestamptz,
  target_outcome jsonb,
  target_effects jsonb,
  target_evidence jsonb
) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  status_name text;
  mutation_boundary text;
  captured_at timestamptz;
begin
  if not public.vorton_module_lifecycle_binding_valid(target_binding)
    or target_binding#>>'{target,action}' <> target_action::text
    or target_executed_at < target_consumed_at
    or target_executed_at <> date_trunc('milliseconds', target_executed_at)
    or jsonb_typeof(target_outcome) <> 'object'
    or jsonb_typeof(target_effects) <> 'object'
    or jsonb_typeof(target_evidence) <> 'object'
    or jsonb_typeof(target_outcome->'status') <> 'string'
    or jsonb_typeof(target_evidence->'action') <> 'string'
    or target_evidence->>'action' <> target_action::text
  then
    return false;
  end if;
  status_name := target_outcome->>'status';

  if status_name = 'succeeded' then
    if not public.vorton_jsonb_has_exact_keys(
      target_outcome, array['status', 'code']
    )
      or target_outcome->>'code' <> 'completed'
      or not public.vorton_jsonb_has_exact_keys(
        target_effects,
        array[
          'approvalConsumed', 'actionAttempted', 'actionCompleted',
          'productionModuleDataMutated', 'otherWorkspaceMutated',
          'mutationBoundary'
        ]
      )
      or target_effects->'approvalConsumed' <> 'true'::jsonb
      or target_effects->'actionAttempted' <> 'true'::jsonb
      or target_effects->'actionCompleted' <> 'true'::jsonb
      or target_effects->'productionModuleDataMutated' <> 'false'::jsonb
      or target_effects->'otherWorkspaceMutated' <> 'false'::jsonb
      or jsonb_typeof(target_effects->'mutationBoundary') <> 'string'
    then
      return false;
    end if;
    mutation_boundary := target_effects->>'mutationBoundary';
    if mutation_boundary <> (case target_action
      when 'backup' then 'workspace-backup-artifact'
      when 'recovery' then 'isolated-recovery-namespace'
      when 'deletion' then 'controlled-fixture'
      when 'rollback' then 'isolated-rollback-namespace'
    end) then
      return false;
    end if;

    case target_action
      when 'backup' then
        if not public.vorton_jsonb_has_exact_keys(
          target_evidence,
          array[
            'action', 'capturedAt', 'recordCount', 'capturedStateSha256',
            'manifestSha256', 'encryptedArtifactSha256', 'encryptedAtRest',
            'workspaceKeyBound', 'workspaceStorageBound',
            'otherWorkspaceAccessDenied'
          ]
        )
          or jsonb_typeof(target_evidence->'capturedAt') <> 'string'
          or target_evidence->>'capturedAt'
            !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
          or jsonb_typeof(target_evidence->'recordCount') <> 'number'
          or target_evidence->>'recordCount' !~ '^(0|[1-9][0-9]*)$'
          or (target_evidence->>'recordCount')::numeric > 9007199254740991
          or target_evidence->>'capturedStateSha256'
            <> target_binding->>'targetPreimageSha256'
          or target_evidence->>'manifestSha256' !~ '^sha256:[a-f0-9]{64}$'
          or target_evidence->>'encryptedArtifactSha256'
            !~ '^sha256:[a-f0-9]{64}$'
          or target_evidence->'encryptedAtRest' <> 'true'::jsonb
          or target_evidence->'workspaceKeyBound' <> 'true'::jsonb
          or target_evidence->'workspaceStorageBound' <> 'true'::jsonb
          or target_evidence->'otherWorkspaceAccessDenied' <> 'true'::jsonb
        then return false; end if;
        captured_at := (target_evidence->>'capturedAt')::timestamptz;
        if captured_at < target_consumed_at or captured_at > target_executed_at
        then return false; end if;

      when 'recovery' then
        if not public.vorton_jsonb_has_exact_keys(
          target_evidence,
          array[
            'action', 'isolatedNamespaceSha256', 'restoredRecordCount',
            'restoredStateSha256', 'productionNamespaceMutated',
            'otherWorkspaceMutationCount', 'recoveryNamespaceDeleted'
          ]
        )
          or target_evidence->>'isolatedNamespaceSha256'
            !~ '^sha256:[a-f0-9]{64}$'
          or jsonb_typeof(target_evidence->'restoredRecordCount') <> 'number'
          or target_evidence->>'restoredRecordCount' !~ '^(0|[1-9][0-9]*)$'
          or (target_evidence->>'restoredRecordCount')::numeric > 9007199254740991
          or target_evidence->>'restoredStateSha256'
            <> target_binding->>'targetPreimageSha256'
          or target_evidence->'productionNamespaceMutated' <> 'false'::jsonb
          or target_evidence->'otherWorkspaceMutationCount' <> '0'::jsonb
          or target_evidence->'recoveryNamespaceDeleted' <> 'true'::jsonb
        then return false; end if;

      when 'deletion' then
        if not public.vorton_jsonb_has_exact_keys(
          target_evidence,
          array[
            'action', 'mode', 'controlledFixtureId',
            'deletionManifestSha256', 'productionRecordsDeleted',
            'residualCounts', 'postDeletionRetrievalDenied',
            'otherWorkspaceMutationCount'
          ]
        )
          or target_evidence->>'mode' <> 'controlled-fixture'
          or target_evidence->>'controlledFixtureId'
            <> target_binding#>>'{target,controlledFixtureId}'
          or target_evidence->>'deletionManifestSha256'
            !~ '^sha256:[a-f0-9]{64}$'
          or target_evidence->'productionRecordsDeleted' <> '0'::jsonb
          or not public.vorton_jsonb_has_exact_keys(
            target_evidence->'residualCounts',
            array[
              'databaseRows', 'storageObjects', 'memoryFragments',
              'searchDocuments', 'backupObjects'
            ]
          )
          or exists (
            select 1 from jsonb_each(target_evidence->'residualCounts') item
            where item.value <> '0'::jsonb
          )
          or target_evidence->'postDeletionRetrievalDenied' <> 'true'::jsonb
          or target_evidence->'otherWorkspaceMutationCount' <> '0'::jsonb
        then return false; end if;

      when 'rollback' then
        if not public.vorton_jsonb_has_exact_keys(
          target_evidence,
          array[
            'action', 'fromPostimageSha256', 'restoredPreimageSha256',
            'replayedPostimageSha256', 'productionNamespaceMutated',
            'otherWorkspaceMutationCount', 'rollbackNamespaceDeleted'
          ]
        )
          or target_evidence->>'fromPostimageSha256'
            <> target_binding->>'targetPostimageSha256'
          or target_evidence->>'restoredPreimageSha256'
            <> target_binding->>'targetPreimageSha256'
          or target_evidence->>'replayedPostimageSha256'
            <> target_binding->>'targetPostimageSha256'
          or target_evidence->'productionNamespaceMutated' <> 'false'::jsonb
          or target_evidence->'otherWorkspaceMutationCount' <> '0'::jsonb
          or target_evidence->'rollbackNamespaceDeleted' <> 'true'::jsonb
        then return false; end if;
    end case;
    return true;
  end if;

  if status_name <> 'failed'
    or not public.vorton_jsonb_has_exact_keys(
      target_outcome,
      array['status', 'code', 'stage', 'retryDisposition']
    )
    or jsonb_typeof(target_outcome->'code') <> 'string'
    or target_outcome->>'code' !~ '^[a-z][a-z0-9-]*$'
    or target_outcome->>'stage'
      not in ('execution', 'verification', 'reconciliation')
    or target_outcome->>'retryDisposition' <> 'new-approval-required'
    or not public.vorton_jsonb_has_exact_keys(
      target_effects,
      array[
        'approvalConsumed', 'actionAttempted', 'actionCompleted',
        'authorizedTargetMutation', 'productionModuleDataMutation',
        'otherWorkspaceMutation', 'quarantined'
      ]
    )
    or target_effects->'approvalConsumed' <> 'true'::jsonb
    or target_effects->'actionAttempted' <> 'true'::jsonb
    or target_effects->'actionCompleted' <> 'false'::jsonb
    or target_effects->>'authorizedTargetMutation'
      not in ('none', 'partial', 'unknown')
    or target_effects->>'productionModuleDataMutation'
      not in ('none', 'detected', 'unknown')
    or target_effects->>'otherWorkspaceMutation'
      not in ('none', 'detected', 'unknown')
    or target_effects->'quarantined' <> 'true'::jsonb
    or not public.vorton_jsonb_has_exact_keys(
      target_evidence,
      array['action', 'failureEvidenceSha256', 'lastSafeCheckpoint']
    )
    or target_evidence->>'failureEvidenceSha256' !~ '^sha256:[a-f0-9]{64}$'
    or target_evidence->>'lastSafeCheckpoint' !~ '^[a-z][a-z0-9-]*$'
  then
    return false;
  end if;
  return true;
exception
  when others then return false;
end
$$;

create table public.module_lifecycle_action_receipts (
  receipt_id uuid primary key,
  command_id uuid not null,
  command_hash text not null check (command_hash ~ '^sha256:[a-f0-9]{64}$'),
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
  action public.module_lifecycle_action not null,
  proof_scope text not null check (
    proof_scope in ('controlled-synthetic', 'workspace-production')
  ),
  binding jsonb not null,
  binding_hash text not null check (binding_hash ~ '^sha256:[a-f0-9]{64}$'),
  executor_worker_id uuid not null,
  admission_credential_id uuid not null,
  finalization_credential_id uuid not null,
  work_id uuid not null,
  policy_id uuid not null,
  capability_grant_id uuid not null,
  admission_authority_checked_at timestamptz not null,
  finalization_authority_checked_at timestamptz not null,
  consumed_at timestamptz not null,
  executed_at timestamptz not null,
  predecessor_receipts jsonb not null,
  outcome jsonb not null,
  effects jsonb not null,
  evidence jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint module_lifecycle_action_receipts_command_fk
    foreign key (
      command_id, command_hash, approval_record_id, approval_id,
      approval_receipt_id,
      approval_receipt_hash, approval_hash, installation_id, workspace_id,
      owner_person_id, action, binding_hash, executor_worker_id, work_id,
      policy_id, capability_grant_id, proof_scope, consumed_at
    ) references public.module_lifecycle_action_commands (
      command_id, command_hash, approval_record_id, approval_id, approval_receipt_id,
      approval_receipt_hash, approval_hash, installation_id, workspace_id,
      owner_person_id, action, binding_hash, executor_worker_id, work_id,
      policy_id, capability_grant_id, proof_scope, consumed_at
    ) on delete restrict,
  constraint module_lifecycle_action_receipts_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm) on delete restrict,
  constraint module_lifecycle_action_receipts_final_credential_fk
    foreign key (installation_id, workspace_id, finalization_credential_id)
    references public.worker_credentials(installation_id, workspace_id, id)
    on delete restrict,
  constraint module_lifecycle_action_receipts_record_fk
    foreign key (installation_id, workspace_id, receipt_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint module_lifecycle_action_receipts_binding_check check (
    public.vorton_module_lifecycle_binding_valid(binding)
    and binding->>'vortonInstallationId' = installation_id::text
    and binding->>'workspaceId' = workspace_id::text
    and binding->>'realm' = realm::text
    and binding#>>'{target,action}' = action::text
    and public.vorton_module_lifecycle_hash(binding) = binding_hash
    and predecessor_receipts = public.vorton_module_lifecycle_predecessors(binding)
  ),
  constraint module_lifecycle_action_receipts_scope_check check (
    action <> 'deletion' or proof_scope = 'controlled-synthetic'
  ),
  constraint module_lifecycle_action_receipts_result_check check (
    public.vorton_module_lifecycle_action_result_valid(
      action, binding, consumed_at, executed_at, outcome, effects, evidence
    )
  ),
  constraint module_lifecycle_action_receipts_time_check check (
    admission_authority_checked_at = consumed_at
    and finalization_authority_checked_at = executed_at
    and consumed_at = date_trunc('milliseconds', consumed_at)
    and executed_at = date_trunc('milliseconds', executed_at)
  ),
  constraint module_lifecycle_action_receipts_identity_check check (
    public.vorton_module_lifecycle_execution_identities_distinct(
      command_id, approval_id, approval_record_id, approval_receipt_id,
      receipt_id, binding
    )
  ),
  constraint module_lifecycle_action_receipts_hash_identity_check check (
    public.vorton_module_lifecycle_execution_hashes_distinct(
      approval_hash, approval_receipt_hash, command_hash, receipt_hash, binding
    )
  ),
  unique (installation_id, workspace_id, command_id),
  unique (installation_id, workspace_id, receipt_id)
);

create function public.module_lifecycle_action_receipt_core_document(
  value public.module_lifecycle_action_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.module-lifecycle-action-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', 'workspace-postgres',
    'commandId', value.command_id::text,
    'commandHash', value.command_hash,
    'idempotencyKey', value.command_id::text,
    'approvalId', value.approval_id::text,
    'approvalReceiptId', value.approval_receipt_id::text,
    'approvalReceiptSha256', value.approval_receipt_hash,
    'approvalHash', value.approval_hash,
    'binding', value.binding,
    'action', value.action::text,
    'proofScope', value.proof_scope,
    'vortonInstallationId', value.installation_id::text,
    'workspaceId', value.workspace_id::text,
    'ownerPersonId', value.owner_person_id::text,
    'executor', jsonb_build_object(
      'kind', 'worker',
      'workerId', value.executor_worker_id::text,
      'workId', value.work_id::text,
      'policyId', value.policy_id::text,
      'admission', jsonb_build_object(
        'credentialId', value.admission_credential_id::text,
        'capabilityGrantId', value.capability_grant_id::text,
        'liveAuthorityCheckedAt', to_char(
          value.admission_authority_checked_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      'finalization', jsonb_build_object(
        'credentialId', value.finalization_credential_id::text,
        'liveAuthorityCheckedAt', to_char(
          value.finalization_authority_checked_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      ),
      'rolesGrantAuthority', false
    ),
    'approvalConsumptionCount', 1,
    'consumedAt', to_char(
      value.consumed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'executedAt', to_char(
      value.executed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'predecessorReceipts', value.predecessor_receipts,
    'outcome', value.outcome,
    'effects', value.effects,
    'evidence', value.evidence
  )
$$;

create function public.module_lifecycle_action_receipt_document(
  value public.module_lifecycle_action_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.module_lifecycle_action_receipt_core_document(value) ||
    jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.derive_module_lifecycle_action_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.binding_hash := public.vorton_module_lifecycle_hash(new.binding);
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.module_lifecycle_action_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger module_lifecycle_action_receipts_derive_hash
before insert on public.module_lifecycle_action_receipts
for each row execute function public.derive_module_lifecycle_action_receipt_hash();

create function public.vorton_module_lifecycle_predecessor_chain_valid(
  target_binding jsonb,
  target_proof_scope text
) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  predecessors jsonb;
  backup public.module_lifecycle_action_receipts;
  recovery public.module_lifecycle_action_receipts;
  deletion public.module_lifecycle_action_receipts;
begin
  if not public.vorton_module_lifecycle_binding_valid(target_binding)
    or target_proof_scope not in ('controlled-synthetic', 'workspace-production')
  then return false; end if;
  predecessors := public.vorton_module_lifecycle_predecessors(target_binding);

  if predecessors->>'action' in ('recovery', 'deletion', 'rollback') then
    select * into backup
      from public.module_lifecycle_action_receipts receipt
     where receipt.receipt_id = (predecessors#>>'{backup,receiptId}')::uuid
       and receipt.receipt_hash = predecessors#>>'{backup,receiptSha256}'
       and receipt.action = 'backup'
       and receipt.outcome->>'status' = 'succeeded';
    if backup.receipt_id is null
      or (
        predecessors->>'action' in ('recovery', 'rollback')
        and backup.proof_scope <> target_proof_scope
      )
      or (backup.binding - 'target') <> (target_binding - 'target')
      or backup.receipt_hash <> public.vorton_module_lifecycle_hash(
        public.module_lifecycle_action_receipt_core_document(backup)
      )
    then return false; end if;
  end if;

  if predecessors->>'action' in ('deletion', 'rollback') then
    select * into recovery
      from public.module_lifecycle_action_receipts receipt
     where receipt.receipt_id = (predecessors#>>'{recovery,receiptId}')::uuid
       and receipt.receipt_hash = predecessors#>>'{recovery,receiptSha256}'
       and receipt.action = 'recovery'
       and receipt.outcome->>'status' = 'succeeded';
    if recovery.receipt_id is null
      or (
        predecessors->>'action' = 'rollback'
        and recovery.proof_scope <> target_proof_scope
      )
      or (
        predecessors->>'action' = 'deletion'
        and recovery.proof_scope <> backup.proof_scope
      )
      or (recovery.binding - 'target') <> (target_binding - 'target')
      or recovery.predecessor_receipts <> jsonb_build_object(
        'action', 'recovery',
        'backup', jsonb_build_object(
          'receiptId', backup.receipt_id::text,
          'receiptSha256', backup.receipt_hash
        )
      )
      or recovery.evidence->>'restoredRecordCount'
        <> backup.evidence->>'recordCount'
      or recovery.receipt_hash <> public.vorton_module_lifecycle_hash(
        public.module_lifecycle_action_receipt_core_document(recovery)
      )
    then return false; end if;
  end if;

  if predecessors->>'action' = 'rollback' then
    select * into deletion
      from public.module_lifecycle_action_receipts receipt
     where receipt.receipt_id = (predecessors#>>'{deletion,receiptId}')::uuid
       and receipt.receipt_hash = predecessors#>>'{deletion,receiptSha256}'
       and receipt.action = 'deletion'
       and receipt.outcome->>'status' = 'succeeded';
    if deletion.receipt_id is null
      or deletion.proof_scope <> 'controlled-synthetic'
      or (deletion.binding - 'target') <> (target_binding - 'target')
      or deletion.predecessor_receipts <> jsonb_build_object(
        'action', 'deletion',
        'backup', jsonb_build_object(
          'receiptId', backup.receipt_id::text,
          'receiptSha256', backup.receipt_hash
        ),
        'recovery', jsonb_build_object(
          'receiptId', recovery.receipt_id::text,
          'receiptSha256', recovery.receipt_hash
        )
      )
      or deletion.receipt_hash <> public.vorton_module_lifecycle_hash(
        public.module_lifecycle_action_receipt_core_document(deletion)
      )
    then return false; end if;
  end if;
  return true;
exception
  when others then return false;
end
$$;

create function public.module_lifecycle_action_completion_document(
  command public.module_lifecycle_action_commands,
  receipt public.module_lifecycle_action_receipts
) returns jsonb
language plpgsql stable strict
set search_path = pg_catalog, public
as $$
declare
  approval public.module_lifecycle_action_approvals;
  approval_receipt public.module_lifecycle_approval_receipts;
  predecessors jsonb := jsonb_build_object('action', command.action::text);
  reference jsonb;
  predecessor public.module_lifecycle_action_receipts;
  key_name text;
begin
  select * into approval from public.module_lifecycle_action_approvals
   where approval_id = command.approval_id
     and installation_id = command.installation_id
     and workspace_id = command.workspace_id;
  select * into approval_receipt from public.module_lifecycle_approval_receipts
   where receipt_id = command.approval_receipt_id;
  for key_name, reference in
    select entry.key, entry.value
      from jsonb_each(command.predecessor_receipts) entry
     where entry.key <> 'action'
     order by entry.key collate "C"
  loop
    select * into predecessor from public.module_lifecycle_action_receipts
     where receipt_id = (reference->>'receiptId')::uuid
       and receipt_hash = reference->>'receiptSha256';
    if predecessor.receipt_id is null then
      raise exception 'Module lifecycle predecessor receipt integrity failure';
    end if;
    predecessors := predecessors || jsonb_build_object(
      key_name, public.module_lifecycle_action_receipt_document(predecessor)
    );
  end loop;
  return jsonb_build_object(
    'approval', public.module_lifecycle_approval_document(
      approval, approval_receipt
    ),
    'approvalReceipt', public.module_lifecycle_approval_receipt_document(
      approval_receipt
    ),
    'command', public.module_lifecycle_action_command_document(command),
    'predecessorReceiptDocuments', predecessors,
    'actionReceipt', public.module_lifecycle_action_receipt_document(receipt)
  );
end
$$;

create function public.reject_module_lifecycle_execution_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Module lifecycle commands and action receipts are append-only';
end
$$;

create trigger module_lifecycle_action_commands_reject_update_delete
before update or delete on public.module_lifecycle_action_commands
for each row execute function public.reject_module_lifecycle_execution_mutation();

create trigger module_lifecycle_action_receipts_reject_update_delete
before update or delete on public.module_lifecycle_action_receipts
for each row execute function public.reject_module_lifecycle_execution_mutation();

create function public.consume_module_lifecycle_action_approval(
  target_command_id uuid,
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  target_work_id uuid,
  exact_proof_scope text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  worker_text text := current_setting('aubos.subject_id', true);
  credential_text text := current_setting('aubos.credential_id', true);
  worker_id_value uuid;
  credential_id_value uuid;
  approval public.module_lifecycle_action_approvals;
  approval_receipt public.module_lifecycle_approval_receipts;
  command public.module_lifecycle_action_commands;
  credential public.worker_credentials;
  work_row public.work;
  grant_row public.capability_grants;
  policy_row public.policies;
  owner_membership public.workspace_memberships;
  approval_record public.records;
  command_record public.records;
  active_grant_count integer;
  active_grant_id uuid;
  consumed_at_value timestamptz;
  expected_capability text;
  effects_value jsonb := '{
    "approvalConsumed": true,
    "actionExecuted": false,
    "workspaceMutated": false,
    "moduleDataMutated": false,
    "externalSystemMutated": false
  }'::jsonb;
  summary_value text;
begin
  if target_command_id is null or target_approval_id is null
    or target_installation_id is null or target_workspace_id is null
    or target_work_id is null
    or exact_proof_scope not in ('controlled-synthetic', 'workspace-production')
    or worker_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or credential_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or not public.aubos_runtime_context_valid(
      'worker', target_installation_id::text, target_workspace_id::text,
      worker_text
    )
  then
    raise exception 'Signed credentialed worker context is required to consume lifecycle approval';
  end if;
  worker_id_value := worker_text::uuid;
  credential_id_value := credential_text::uuid;

  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':' || target_workspace_id::text ||
    ':module-lifecycle-consume:' || target_approval_id::text,
    0
  ));

  select * into credential from public.worker_credentials existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.id = credential_id_value
     and existing.worker_id = worker_id_value
   for update;
  if credential.id is null
    or credential.expires_at <= clock_timestamp()
    or exists (
      select 1 from public.worker_credential_revocations revocation
       where revocation.installation_id = target_installation_id
         and revocation.workspace_id = target_workspace_id
         and revocation.credential_id = credential_id_value
    )
  then
    raise exception 'Live worker credential is required to consume lifecycle approval';
  end if;

  select * into command from public.module_lifecycle_action_commands existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id;
  if command.command_id is not null then
    if command.command_id is distinct from target_command_id
      or command.executor_worker_id is distinct from worker_id_value
      or command.work_id is distinct from target_work_id
      or command.proof_scope is distinct from exact_proof_scope
    then
      raise exception 'Lifecycle action command retry conflicts with immutable consumption';
    end if;
    select * into command_record from public.records existing_record
     where existing_record.installation_id = command.installation_id
       and existing_record.workspace_id = command.workspace_id
       and existing_record.id = command.command_id;
    summary_value := 'Consumed exact module lifecycle ' ||
      command.action::text || ' approval';
    if command_record.id is null
      or command_record.kind is distinct from 'receipt'::public.record_kind
      or command_record.work_id is distinct from command.work_id
      or command_record.summary is distinct from summary_value
      or command_record.payload is distinct from
        public.module_lifecycle_action_command_document(command)
      or command_record.classification is distinct from
        'internal'::public.data_classification
      or command_record.actor_worker_id is distinct from command.executor_worker_id
      or command_record.actor_person_id is not null
      or command_record.created_at is distinct from command.consumed_at
    then
      raise exception 'Lifecycle action command Record integrity failure';
    end if;
    select * into approval from public.module_lifecycle_action_approvals
     where installation_id = command.installation_id
       and workspace_id = command.workspace_id
       and approval_id = command.approval_id;
    select * into approval_receipt from public.module_lifecycle_approval_receipts
     where receipt_id = command.approval_receipt_id;
    select * into owner_membership
      from public.workspace_memberships membership
     where membership.installation_id = command.installation_id
       and membership.workspace_id = command.workspace_id
       and membership.person_id = command.owner_person_id
     for update;
    if owner_membership.person_id is null
      or owner_membership.kind <> 'owner'
    then
      raise exception 'Live original owner membership is required to replay lifecycle consumption';
    end if;
    return jsonb_build_object(
      'approval', public.module_lifecycle_approval_document(
        approval, approval_receipt
      ),
      'approvalReceipt', public.module_lifecycle_approval_receipt_document(
        approval_receipt
      ),
      'command', public.module_lifecycle_action_command_document(command)
    );
  end if;

  select * into approval from public.module_lifecycle_action_approvals existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id
   for update;
  if approval.approval_record_id is null then
    raise exception 'Exact module lifecycle approval does not exist';
  end if;
  if approval.action = 'deletion' and exact_proof_scope <> 'controlled-synthetic'
  then
    raise exception 'Deletion rehearsal requires controlled synthetic proof scope';
  end if;
  select * into approval_receipt
    from public.module_lifecycle_approval_receipts existing
   where existing.receipt_id in (
     select receipt_id from public.module_lifecycle_approval_receipts
      where installation_id = approval.installation_id
        and workspace_id = approval.workspace_id
        and approval_id = approval.approval_id
   )
   for update;
  if approval_receipt.receipt_id is null
    or approval_receipt.approval_hash <> approval.approval_hash
    or approval_receipt.binding <> approval.binding
    or approval_receipt.receipt_hash <> public.vorton_module_lifecycle_hash(
      public.module_lifecycle_approval_receipt_core_document(approval_receipt)
    )
  then
    raise exception 'Lifecycle approval receipt integrity failure';
  end if;

  select * into work_row from public.work candidate
   where candidate.installation_id = target_installation_id
     and candidate.workspace_id = target_workspace_id
     and candidate.id = target_work_id
   for update;

  perform 1 from public.capability_grants candidate
   where candidate.installation_id = target_installation_id
     and candidate.workspace_id = target_workspace_id
     and candidate.principal_kind = 'worker'
     and candidate.worker_id = worker_id_value
     and candidate.work_id = target_work_id
     and candidate.capability = 'module.lifecycle.' || approval.action::text
       || '.' || exact_proof_scope
     and candidate.mode = 'modify'
   for update;
  select count(*)::integer, (array_agg(candidate.id order by candidate.id))[1]
    into active_grant_count, active_grant_id
    from public.capability_grants candidate
   where candidate.installation_id = target_installation_id
     and candidate.workspace_id = target_workspace_id
     and candidate.principal_kind = 'worker'
     and candidate.worker_id = worker_id_value
     and candidate.work_id = target_work_id
     and candidate.capability = 'module.lifecycle.' || approval.action::text
       || '.' || exact_proof_scope
     and candidate.mode = 'modify'
     and (candidate.expires_at is null
       or candidate.expires_at > clock_timestamp())
     and not exists (
       select 1 from public.capability_grant_revocations revocation
        where revocation.installation_id = candidate.installation_id
          and revocation.workspace_id = candidate.workspace_id
          and revocation.grant_id = candidate.id
     );
  if active_grant_count <> 1 then
    raise exception 'Exactly one live Work-scoped lifecycle capability grant is required';
  end if;
  select * into grant_row from public.capability_grants existing
   where existing.id = active_grant_id for update;
  select * into policy_row from public.policies existing
   where existing.installation_id = grant_row.installation_id
     and existing.workspace_id = grant_row.workspace_id
     and existing.id = grant_row.policy_id
   for update;
  select * into owner_membership from public.workspace_memberships membership
   where membership.installation_id = approval.installation_id
     and membership.workspace_id = approval.workspace_id
     and membership.person_id = approval.owner_person_id
   for update;

  consumed_at_value := date_trunc('milliseconds', clock_timestamp());
  expected_capability := 'module.lifecycle.' || approval.action::text
    || '.' || exact_proof_scope;
  if credential.expires_at <= consumed_at_value
    or exists (
      select 1 from public.worker_credential_revocations revocation
       where revocation.installation_id = target_installation_id
         and revocation.workspace_id = target_workspace_id
         and revocation.credential_id = credential_id_value
    )
    or work_row.id is null or work_row.state <> 'leased'
    or work_row.custodian_worker_id <> worker_id_value
    or work_row.lease_expires_at <= consumed_at_value
    or grant_row.id is null or policy_row.id is null
    or grant_row.capability <> expected_capability
    or grant_row.mode <> 'modify'
    or grant_row.work_id <> target_work_id
    or grant_row.expires_at is not null and grant_row.expires_at <= consumed_at_value
    or exists (
      select 1 from public.capability_grant_revocations revocation
       where revocation.installation_id = grant_row.installation_id
         and revocation.workspace_id = grant_row.workspace_id
         and revocation.grant_id = grant_row.id
    )
    or owner_membership.person_id is null or owner_membership.kind <> 'owner'
    or approval.expires_at <= consumed_at_value
    or approval.approved_at > consumed_at_value
  then
    raise exception 'Live lifecycle execution authority is unavailable';
  end if;

  select * into approval_record from public.records existing_record
   where existing_record.installation_id = approval.installation_id
     and existing_record.workspace_id = approval.workspace_id
     and existing_record.id = approval.approval_record_id;
  if approval_record.id is null
    or approval_record.kind <> 'approval'
    or approval_record.summary <> 'Approved exact module lifecycle ' ||
      approval.action::text || ' action'
    or approval_record.payload <> public.module_lifecycle_approval_document(
      approval, approval_receipt
    )
    or approval_record.source_uri is not null
    or approval_record.classification <> 'internal'
    or approval_record.actor_person_id <> approval.owner_person_id
    or approval_record.actor_worker_id is not null
    or approval_record.work_id is not null
    or approval_record.supersedes_record_id is not null
    or approval_record.created_at <> approval.approved_at
  then
    raise exception 'Lifecycle approval Record integrity failure';
  end if;
  if not public.vorton_module_lifecycle_predecessor_chain_valid(
    approval.binding, exact_proof_scope
  ) then
    raise exception 'Lifecycle predecessor receipt chain is invalid';
  end if;

  insert into public.module_lifecycle_action_commands (
    command_id, approval_record_id, approval_id, approval_receipt_id,
    approval_receipt_hash, approval_hash, installation_id, workspace_id,
    realm, owner_person_id, action, proof_scope, binding, binding_hash,
    executor_worker_id, admission_credential_id, work_id, policy_id,
    capability_grant_id, live_authority_checked_at, consumed_at,
    predecessor_receipts, effects, command_hash
  ) values (
    target_command_id, approval.approval_record_id, approval.approval_id,
    approval_receipt.receipt_id, approval_receipt.receipt_hash,
    approval.approval_hash, approval.installation_id, approval.workspace_id,
    approval.realm, approval.owner_person_id, approval.action,
    exact_proof_scope, approval.binding, approval.binding_hash,
    worker_id_value, credential_id_value, work_row.id, policy_row.id,
    grant_row.id, consumed_at_value, consumed_at_value,
    public.vorton_module_lifecycle_predecessors(approval.binding),
    effects_value, 'sha256:' || repeat('0', 64)
  ) returning * into command;

  summary_value := 'Consumed exact module lifecycle ' ||
    command.action::text || ' approval';
  insert into public.records (
    id, installation_id, workspace_id, work_id, kind, summary, payload,
    source_uri, classification, actor_person_id, actor_worker_id,
    supersedes_record_id, created_at
  ) values (
    command.command_id, command.installation_id, command.workspace_id,
    command.work_id, 'receipt', summary_value,
    public.module_lifecycle_action_command_document(command), null,
    'internal', null, command.executor_worker_id, null, command.consumed_at
  );

  return jsonb_build_object(
    'approval', public.module_lifecycle_approval_document(
      approval, approval_receipt
    ),
    'approvalReceipt', public.module_lifecycle_approval_receipt_document(
      approval_receipt
    ),
    'command', public.module_lifecycle_action_command_document(command)
  );
end
$$;

create function public.finalize_module_lifecycle_action(
  target_receipt_id uuid,
  target_command_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  exact_outcome jsonb,
  exact_effects jsonb,
  exact_evidence jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  worker_text text := current_setting('aubos.subject_id', true);
  credential_text text := current_setting('aubos.credential_id', true);
  worker_id_value uuid;
  credential_id_value uuid;
  credential public.worker_credentials;
  command public.module_lifecycle_action_commands;
  receipt public.module_lifecycle_action_receipts;
  command_record public.records;
  receipt_record public.records;
  executed_at_value timestamptz;
  summary_value text;
begin
  if target_receipt_id is null or target_command_id is null
    or target_installation_id is null or target_workspace_id is null
    or exact_outcome is null or exact_effects is null or exact_evidence is null
    or worker_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or credential_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or not public.aubos_runtime_context_valid(
      'worker', target_installation_id::text, target_workspace_id::text,
      worker_text
    )
  then
    raise exception 'Signed credentialed worker context is required to finalize lifecycle action';
  end if;
  worker_id_value := worker_text::uuid;
  credential_id_value := credential_text::uuid;
  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':' || target_workspace_id::text ||
    ':module-lifecycle-finalize:' || target_command_id::text,
    0
  ));
  select * into credential from public.worker_credentials existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.id = credential_id_value
     and existing.worker_id = worker_id_value
   for update;
  if credential.id is null
    or credential.expires_at <= clock_timestamp()
    or exists (
      select 1 from public.worker_credential_revocations revocation
       where revocation.installation_id = target_installation_id
         and revocation.workspace_id = target_workspace_id
         and revocation.credential_id = credential_id_value
    )
  then
    raise exception 'Fresh live worker credential is required to finalize lifecycle action';
  end if;
  select * into command from public.module_lifecycle_action_commands existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.command_id = target_command_id
   for update;
  if command.command_id is null
    or command.executor_worker_id <> worker_id_value
  then
    raise exception 'Exact lifecycle action command is unavailable to this worker';
  end if;
  select * into command_record from public.records existing_record
   where existing_record.installation_id = command.installation_id
     and existing_record.workspace_id = command.workspace_id
     and existing_record.id = command.command_id;
  if command_record.id is null
    or command_record.kind <> 'receipt'
    or command_record.work_id <> command.work_id
    or command_record.summary <> 'Consumed exact module lifecycle ' ||
      command.action::text || ' approval'
    or command_record.payload <>
      public.module_lifecycle_action_command_document(command)
    or command_record.classification <> 'internal'
    or command_record.actor_worker_id <> command.executor_worker_id
    or command_record.actor_person_id is not null
    or command_record.created_at <> command.consumed_at
  then
    raise exception 'Lifecycle action command Record integrity failure';
  end if;

  select * into receipt from public.module_lifecycle_action_receipts existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.command_id = target_command_id;
  if receipt.receipt_id is not null then
    if receipt.receipt_id <> target_receipt_id
      or receipt.outcome <> exact_outcome
      or receipt.effects <> exact_effects
      or receipt.evidence <> exact_evidence
    then
      raise exception 'Lifecycle action receipt retry conflicts with immutable result';
    end if;
    select * into receipt_record from public.records existing_record
     where existing_record.installation_id = receipt.installation_id
       and existing_record.workspace_id = receipt.workspace_id
       and existing_record.id = receipt.receipt_id;
    summary_value := 'Recorded exact module lifecycle ' ||
      receipt.action::text || ' result';
    if receipt_record.id is null
      or receipt_record.kind <> 'receipt'
      or receipt_record.work_id <> receipt.work_id
      or receipt_record.summary <> summary_value
      or receipt_record.payload <>
        public.module_lifecycle_action_receipt_document(receipt)
      or receipt_record.actor_worker_id <> receipt.executor_worker_id
      or receipt_record.actor_person_id is not null
      or receipt_record.created_at <> receipt.executed_at
    then
      raise exception 'Lifecycle action receipt Record integrity failure';
    end if;
    return public.module_lifecycle_action_completion_document(command, receipt);
  end if;

  executed_at_value := date_trunc('milliseconds', clock_timestamp());
  if not public.vorton_module_lifecycle_action_result_valid(
    command.action, command.binding, command.consumed_at,
    executed_at_value, exact_outcome, exact_effects, exact_evidence
  ) then
    raise exception 'Exact lifecycle action result is invalid';
  end if;

  insert into public.module_lifecycle_action_receipts (
    receipt_id, command_id, command_hash, approval_record_id, approval_id,
    approval_receipt_id, approval_receipt_hash, approval_hash,
    installation_id, workspace_id, realm, owner_person_id, action,
    proof_scope, binding, binding_hash, executor_worker_id,
    admission_credential_id, finalization_credential_id, work_id, policy_id,
    capability_grant_id, admission_authority_checked_at,
    finalization_authority_checked_at, consumed_at, executed_at,
    predecessor_receipts, outcome, effects, evidence, receipt_hash
  ) values (
    target_receipt_id, command.command_id, command.command_hash,
    command.approval_record_id, command.approval_id,
    command.approval_receipt_id, command.approval_receipt_hash,
    command.approval_hash, command.installation_id, command.workspace_id,
    command.realm, command.owner_person_id, command.action,
    command.proof_scope, command.binding, command.binding_hash,
    command.executor_worker_id, command.admission_credential_id,
    credential_id_value, command.work_id, command.policy_id,
    command.capability_grant_id, command.live_authority_checked_at,
    executed_at_value, command.consumed_at, executed_at_value,
    command.predecessor_receipts, exact_outcome, exact_effects,
    exact_evidence, 'sha256:' || repeat('0', 64)
  ) returning * into receipt;

  summary_value := 'Recorded exact module lifecycle ' ||
    receipt.action::text || ' result';
  insert into public.records (
    id, installation_id, workspace_id, work_id, kind, summary, payload,
    source_uri, classification, actor_person_id, actor_worker_id,
    supersedes_record_id, created_at
  ) values (
    receipt.receipt_id, receipt.installation_id, receipt.workspace_id,
    receipt.work_id, 'receipt', summary_value,
    public.module_lifecycle_action_receipt_document(receipt), null,
    'internal', null, receipt.executor_worker_id, null, receipt.executed_at
  );
  return public.module_lifecycle_action_completion_document(command, receipt);
end
$$;

alter table public.module_lifecycle_action_commands enable row level security;
alter table public.module_lifecycle_action_receipts enable row level security;

revoke all on table public.module_lifecycle_action_commands,
  public.module_lifecycle_action_receipts
  from public, anon, authenticated, aubos_worker;

revoke all on function public.vorton_module_lifecycle_predecessors(jsonb)
  from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_execution_identities_distinct(
  uuid, uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_execution_hashes_distinct(
  text, text, text, text, jsonb
) from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_action_result_valid(
  public.module_lifecycle_action, jsonb, timestamptz, timestamptz,
  jsonb, jsonb, jsonb
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_action_command_core_document(
  public.module_lifecycle_action_commands
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_action_command_document(
  public.module_lifecycle_action_commands
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_action_receipt_core_document(
  public.module_lifecycle_action_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_action_receipt_document(
  public.module_lifecycle_action_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_module_lifecycle_action_command_hash()
  from public, anon, authenticated, aubos_worker;
revoke all on function public.derive_module_lifecycle_action_receipt_hash()
  from public, anon, authenticated, aubos_worker;
revoke all on function public.vorton_module_lifecycle_predecessor_chain_valid(
  jsonb, text
) from public, anon, authenticated, aubos_worker;
revoke all on function public.module_lifecycle_action_completion_document(
  public.module_lifecycle_action_commands,
  public.module_lifecycle_action_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function public.reject_module_lifecycle_execution_mutation()
  from public, anon, authenticated, aubos_worker;
revoke all on function public.consume_module_lifecycle_action_approval(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, aubos_worker;
revoke all on function public.finalize_module_lifecycle_action(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated, aubos_worker;

grant execute on function public.consume_module_lifecycle_action_approval(
  uuid, uuid, uuid, uuid, uuid, text
) to aubos_worker;
grant execute on function public.finalize_module_lifecycle_action(
  uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb
) to aubos_worker;

commit;
