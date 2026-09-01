-- Governed, workspace-scoped membership revocation authority.
--
-- Approval and application are deliberately separate person operations. Both
-- require the same signed workspace-person context with recent AAL2. Roles and
-- ownership alone grant no mutation authority: the actor must also hold the
-- exact live Work-scoped capability selected by the approval request.

begin;

-- The existing append-only revocation ledger predates the product authority
-- plane. Give each historical or future row an immutable identity without
-- changing its natural one-revocation-per-membership primary key.
alter table public.workspace_membership_revocations
  add column id uuid not null default gen_random_uuid(),
  add constraint workspace_membership_revocations_id_key unique (id),
  add constraint workspace_membership_revocations_receipt_identity unique (
    id, installation_id, workspace_id, person_id, revoked_by_person_id,
    revoked_at
  );

alter table public.workspace_memberships
  add constraint workspace_memberships_kind_identity unique (
    installation_id, workspace_id, person_id, kind
  );

create function public.workspace_membership_revocation_work_snapshot(
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
    'custodianPersonId', case when value.custodian_person_id is null then null
      else to_jsonb(value.custodian_person_id::text) end,
    'custodianWorkerId', case when value.custodian_worker_id is null then null
      else to_jsonb(value.custodian_worker_id::text) end,
    'leaseExpiresAt', case when value.lease_expires_at is null then null
      else to_jsonb(to_char(
        value.lease_expires_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )) end,
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

create table public.workspace_membership_revocation_approvals (
  approval_record_id uuid primary key,
  approval_id uuid not null,
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  actor_person_id uuid not null,
  actor_membership_kind public.person_kind not null default 'owner',
  target_person_id uuid not null,
  target_person_kind public.person_kind not null,
  work_id uuid not null,
  work_snapshot jsonb not null,
  work_snapshot_hash text not null
    check (work_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_content_sha256 text not null
    check (policy_content_sha256 ~ '^[a-f0-9]{64}$'),
  capability_grant_id uuid not null,
  binding jsonb not null,
  authority jsonb not null,
  approval_plane text not null check (approval_plane = 'workspace-postgres'),
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  actor_membership_verified_at timestamptz not null,
  target_membership_verified_at timestamptz not null,
  policy_verified_at timestamptz not null,
  capability_grant_verified_at timestamptz not null,
  work_verified_at timestamptz not null,
  live_owner_count_at_approval integer not null
    check (live_owner_count_at_approval > 0),
  scope jsonb not null,
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null,
  constraint workspace_membership_revocation_approvals_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_membership_revocation_approvals_actor_person_fk
    foreign key (installation_id, actor_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_membership_revocation_approvals_target_person_fk
    foreign key (installation_id, target_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_membership_revocation_approvals_actor_membership_fk
    foreign key (
      installation_id, workspace_id, actor_person_id, actor_membership_kind
    ) references public.workspace_memberships (
      installation_id, workspace_id, person_id, kind
    ) on delete restrict,
  constraint workspace_membership_revocation_approvals_target_membership_fk
    foreign key (
      installation_id, workspace_id, target_person_id, target_person_kind
    ) references public.workspace_memberships (
      installation_id, workspace_id, person_id, kind
    ) on delete restrict,
  constraint workspace_membership_revocation_approvals_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_approvals_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_approvals_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_approvals_record_fk
    foreign key (installation_id, workspace_id, approval_record_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint workspace_membership_revocation_approvals_not_self check (
    actor_person_id <> target_person_id
  ),
  constraint workspace_membership_revocation_approvals_actor_kind check (
    actor_membership_kind = 'owner'
  ),
  constraint workspace_membership_revocation_approvals_work_snapshot check (
    jsonb_typeof(work_snapshot) = 'object'
    and work_snapshot->>'id' = work_id::text
    and work_snapshot->>'vortonInstallationId' = installation_id::text
    and work_snapshot->>'workspaceId' = workspace_id::text
    and work_snapshot->>'state' = 'ready'
    and work_snapshot->>'custodianPersonId' = actor_person_id::text
    and work_snapshot->'custodianWorkerId' = 'null'::jsonb
    and work_snapshot->'leaseExpiresAt' = 'null'::jsonb
    and public.vorton_module_lifecycle_hash(work_snapshot) = work_snapshot_hash
  ),
  constraint workspace_membership_revocation_approvals_binding_check check (
    binding = jsonb_build_object(
      'vortonInstallationId', installation_id::text,
      'workspaceId', workspace_id::text,
      'realm', realm::text,
      'targetPersonId', target_person_id::text,
      'targetPersonKind', target_person_kind::text,
      'workId', work_id::text,
      'workSnapshotSha256', work_snapshot_hash
    )
  ),
  constraint workspace_membership_revocation_approvals_authority_check check (
    authority = jsonb_build_object(
      'principalKind', 'person',
      'personId', actor_person_id::text,
      'workspaceMembershipKind', 'owner',
      'capability', 'workspace.membership.revoke',
      'mode', 'modify',
      'workId', work_id::text,
      'policyId', policy_id::text,
      'policySha256', 'sha256:' || policy_content_sha256,
      'capabilityGrantId', capability_grant_id::text,
      'workScoped', true,
      'rolesGrantAuthority', false
    )
  ),
  constraint workspace_membership_revocation_approvals_time_check check (
    approved_at = date_trunc('milliseconds', approved_at)
    and expires_at = date_trunc('milliseconds', expires_at)
    and created_at = approved_at
    and actor_membership_verified_at = approved_at
    and target_membership_verified_at = approved_at
    and policy_verified_at = approved_at
    and capability_grant_verified_at = approved_at
    and work_verified_at = approved_at
    and aal2_verified_at <= approved_at
    and approved_at <= aal2_verified_at + interval '10 minutes'
    and expires_at > approved_at
    and expires_at <= approved_at + interval '24 hours'
  ),
  constraint workspace_membership_revocation_approvals_distinct_ids check (
    approval_id <> approval_record_id
    and approval_id <> policy_id
    and approval_id <> capability_grant_id
    and approval_record_id <> policy_id
    and approval_record_id <> capability_grant_id
    and policy_id <> capability_grant_id
  ),
  constraint workspace_membership_revocation_approvals_distinct_hashes check (
    approval_hash <> work_snapshot_hash
    and approval_hash <> 'sha256:' || policy_content_sha256
    and work_snapshot_hash <> 'sha256:' || policy_content_sha256
  ),
  constraint workspace_membership_revocation_approvals_scope_check check (
    scope = '{
      "action": "workspace.membership.revoke",
      "targetMembershipOnly": true,
      "selfRevocation": false,
      "personDeletion": false,
      "workspaceDeletion": false,
      "otherMembershipMutation": false,
      "otherWorkspaceRead": false,
      "otherWorkspaceMutation": false,
      "externalSystemMutation": false
    }'::jsonb
  ),
  constraint workspace_membership_revocation_approvals_owner_continuity check (
    target_person_kind <> 'owner' or live_owner_count_at_approval >= 2
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (
    approval_record_id, approval_id, installation_id, workspace_id, realm,
    actor_person_id, target_person_id, target_person_kind, work_id,
    work_snapshot_hash, policy_id, policy_content_sha256,
    capability_grant_id, binding, authority, approval_hash
  )
);

create function public.workspace_membership_revocation_approval_core_document(
  value public.workspace_membership_revocation_approvals
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-membership-revocation-approval.v1',
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalPlane', value.approval_plane,
    'actorPersonId', value.actor_person_id::text,
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
    'actorMembershipVerifiedAt', to_char(
      value.actor_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'targetMembershipVerifiedAt', to_char(
      value.target_membership_verified_at at time zone 'UTC',
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
    'ownerContinuityAtApproval', jsonb_build_object(
      'checkedAt', to_char(
        value.approved_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'liveOwnerCount', value.live_owner_count_at_approval
    ),
    'scope', value.scope
  )
$$;

create function public.derive_workspace_membership_revocation_approval_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.work_snapshot_hash := public.vorton_module_lifecycle_hash(
    new.work_snapshot
  );
  new.approval_hash := public.vorton_module_lifecycle_hash(
    public.workspace_membership_revocation_approval_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_membership_revocation_approvals_derive_hash
before insert on public.workspace_membership_revocation_approvals
for each row execute function
  public.derive_workspace_membership_revocation_approval_hash();

create table public.workspace_membership_revocation_approval_receipts (
  receipt_id uuid primary key,
  approval_record_id uuid not null,
  approval_id uuid not null,
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  actor_person_id uuid not null,
  target_person_id uuid not null,
  target_person_kind public.person_kind not null,
  work_id uuid not null,
  work_snapshot_hash text not null
    check (work_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_content_sha256 text not null
    check (policy_content_sha256 ~ '^[a-f0-9]{64}$'),
  capability_grant_id uuid not null,
  binding jsonb not null,
  authority jsonb not null,
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  receipt_plane text not null check (receipt_plane = 'workspace-postgres'),
  approved_at timestamptz not null,
  created_at timestamptz not null,
  actor_membership_verified_at timestamptz not null,
  target_membership_verified_at timestamptz not null,
  policy_verified_at timestamptz not null,
  capability_grant_verified_at timestamptz not null,
  work_verified_at timestamptz not null,
  owner_continuity_verified_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint workspace_membership_revocation_approval_receipts_approval_fk
    foreign key (
      approval_record_id, approval_id, installation_id, workspace_id, realm,
      actor_person_id, target_person_id, target_person_kind, work_id,
      work_snapshot_hash, policy_id, policy_content_sha256,
      capability_grant_id, binding, authority, approval_hash
    ) references public.workspace_membership_revocation_approvals (
      approval_record_id, approval_id, installation_id, workspace_id, realm,
      actor_person_id, target_person_id, target_person_kind, work_id,
      work_snapshot_hash, policy_id, policy_content_sha256,
      capability_grant_id, binding, authority, approval_hash
    ) on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_actor_fk
    foreign key (installation_id, workspace_id, actor_person_id)
    references public.workspace_memberships(
      installation_id, workspace_id, person_id
    ) on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_target_fk
    foreign key (
      installation_id, workspace_id, target_person_id, target_person_kind
    ) references public.workspace_memberships (
      installation_id, workspace_id, person_id, kind
    ) on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_approval_receipts_distinct_ids
    check (
      receipt_id <> approval_id
      and receipt_id <> approval_record_id
      and receipt_id <> policy_id
      and receipt_id <> capability_grant_id
      and approval_id <> approval_record_id
      and approval_id <> policy_id
      and approval_id <> capability_grant_id
      and approval_record_id <> policy_id
      and approval_record_id <> capability_grant_id
      and policy_id <> capability_grant_id
    ),
  constraint workspace_membership_revocation_approval_receipts_distinct_hashes
    check (
      receipt_hash <> approval_hash
      and receipt_hash <> work_snapshot_hash
      and receipt_hash <> 'sha256:' || policy_content_sha256
      and approval_hash <> work_snapshot_hash
      and approval_hash <> 'sha256:' || policy_content_sha256
      and work_snapshot_hash <> 'sha256:' || policy_content_sha256
    ),
  constraint workspace_membership_revocation_approval_receipts_time_check
    check (
      created_at = approved_at
      and actor_membership_verified_at = approved_at
      and target_membership_verified_at = approved_at
      and policy_verified_at = approved_at
      and capability_grant_verified_at = approved_at
      and work_verified_at = approved_at
      and owner_continuity_verified_at = approved_at
      and aal2_verified_at <= approved_at
      and approved_at <= aal2_verified_at + interval '10 minutes'
    ),
  constraint workspace_membership_revocation_approval_receipts_effects_check
    check (
      effects = '{
        "approvalCreated": true,
        "approvalConsumed": false,
        "targetMembershipRevoked": false,
        "targetMembershipMutated": false,
        "targetPersonDeleted": false,
        "workspaceDeleted": false,
        "otherMembershipMutated": false,
        "otherPersonMutated": false,
        "otherWorkspaceRead": false,
        "otherWorkspaceMutation": false,
        "workMutated": false,
        "policyMutated": false,
        "capabilityGrantMutated": false,
        "externalSystemMutated": false
      }'::jsonb
    ),
  unique (installation_id, workspace_id, approval_id),
  unique (installation_id, workspace_id, receipt_id),
  unique (approval_record_id),
  unique (
    receipt_id, approval_record_id, approval_id, installation_id,
    workspace_id, realm, actor_person_id, target_person_id,
    target_person_kind, work_id, work_snapshot_hash, policy_id,
    policy_content_sha256, capability_grant_id, binding, authority,
    approval_hash, receipt_hash
  )
);

create function
  public.workspace_membership_revocation_approval_receipt_core_document(
    value public.workspace_membership_revocation_approval_receipts
  ) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract',
      'vorton.workspace-membership-revocation-approval-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', value.receipt_plane,
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalHash', value.approval_hash,
    'actorPersonId', value.actor_person_id::text,
    'binding', value.binding,
    'authority', value.authority,
    'approvedAt', to_char(
      value.approved_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdAt', to_char(
      value.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'actorMembershipVerifiedAt', to_char(
      value.actor_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'targetMembershipVerifiedAt', to_char(
      value.target_membership_verified_at at time zone 'UTC',
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
    'ownerContinuityVerifiedAt', to_char(
      value.owner_continuity_verified_at at time zone 'UTC',
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

create function public.derive_workspace_membership_revocation_approval_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.workspace_membership_revocation_approval_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_membership_revocation_approval_receipts_derive_hash
before insert on public.workspace_membership_revocation_approval_receipts
for each row execute function
  public.derive_workspace_membership_revocation_approval_receipt_hash();

create function public.workspace_membership_revocation_approval_document(
  approval public.workspace_membership_revocation_approvals,
  receipt public.workspace_membership_revocation_approval_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_membership_revocation_approval_core_document(
    approval
  ) || jsonb_build_object(
    'approvalReceiptId', receipt.receipt_id::text,
    'approvalReceiptSha256', receipt.receipt_hash
  )
$$;

create function
  public.workspace_membership_revocation_approval_receipt_document(
    value public.workspace_membership_revocation_approval_receipts
  ) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_membership_revocation_approval_receipt_core_document(
    value
  ) || jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create table public.workspace_membership_revocation_receipts (
  receipt_id uuid primary key,
  membership_revocation_id uuid not null,
  approval_record_id uuid not null,
  approval_id uuid not null,
  approval_receipt_id uuid not null,
  approval_receipt_hash text not null
    check (approval_receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  approval_hash text not null check (approval_hash ~ '^sha256:[a-f0-9]{64}$'),
  installation_id uuid not null,
  workspace_id uuid not null,
  realm public.installation_realm not null,
  actor_person_id uuid not null,
  target_person_id uuid not null,
  target_person_kind public.person_kind not null,
  work_id uuid not null,
  work_snapshot_hash text not null
    check (work_snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  policy_id uuid not null,
  policy_content_sha256 text not null
    check (policy_content_sha256 ~ '^[a-f0-9]{64}$'),
  capability_grant_id uuid not null,
  binding jsonb not null,
  authority jsonb not null,
  approved_by_person_id uuid not null,
  applied_by_person_id uuid not null,
  approval_consumption_count integer not null
    check (approval_consumption_count = 1),
  approval_consumed_at timestamptz not null,
  revoked_at timestamptz not null,
  aal2_verified_at timestamptz not null,
  assurance_level text not null check (assurance_level = 'aal2'),
  actor_membership_verified_at timestamptz not null,
  target_membership_verified_at timestamptz not null,
  capability_grant_verified_at timestamptz not null,
  policy_verified_at timestamptz not null,
  work_snapshot_verified_at timestamptz not null,
  live_owner_count_before integer not null check (live_owner_count_before > 0),
  live_owner_count_after integer not null check (live_owner_count_after > 0),
  idempotency jsonb not null,
  effects jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[a-f0-9]{64}$'),
  constraint workspace_membership_revocation_receipts_approval_fk
    foreign key (
      approval_record_id, approval_id, installation_id, workspace_id, realm,
      actor_person_id, target_person_id, target_person_kind, work_id,
      work_snapshot_hash, policy_id, policy_content_sha256,
      capability_grant_id, binding, authority, approval_hash
    ) references public.workspace_membership_revocation_approvals (
      approval_record_id, approval_id, installation_id, workspace_id, realm,
      actor_person_id, target_person_id, target_person_kind, work_id,
      work_snapshot_hash, policy_id, policy_content_sha256,
      capability_grant_id, binding, authority, approval_hash
    ) on delete restrict,
  constraint workspace_membership_revocation_receipts_approval_receipt_fk
    foreign key (
      approval_receipt_id, approval_record_id, approval_id, installation_id,
      workspace_id, realm, actor_person_id, target_person_id,
      target_person_kind, work_id, work_snapshot_hash, policy_id,
      policy_content_sha256, capability_grant_id, binding, authority,
      approval_hash, approval_receipt_hash
    ) references public.workspace_membership_revocation_approval_receipts (
      receipt_id, approval_record_id, approval_id, installation_id,
      workspace_id, realm, actor_person_id, target_person_id,
      target_person_kind, work_id, work_snapshot_hash, policy_id,
      policy_content_sha256, capability_grant_id, binding, authority,
      approval_hash, receipt_hash
    ) on delete restrict,
  constraint workspace_membership_revocation_receipts_ledger_fk
    foreign key (
      membership_revocation_id, installation_id, workspace_id,
      target_person_id, applied_by_person_id, revoked_at
    ) references public.workspace_membership_revocations (
      id, installation_id, workspace_id, person_id, revoked_by_person_id,
      revoked_at
    ) on delete restrict,
  constraint workspace_membership_revocation_receipts_workspace_fk
    foreign key (installation_id, workspace_id, realm)
    references public.workspaces(installation_id, id, realm)
    on delete restrict,
  constraint workspace_membership_revocation_receipts_actor_person_fk
    foreign key (installation_id, approved_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_membership_revocation_receipts_applier_person_fk
    foreign key (installation_id, applied_by_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_membership_revocation_receipts_target_person_fk
    foreign key (installation_id, target_person_id)
    references public.people(installation_id, id) on delete restrict,
  constraint workspace_membership_revocation_receipts_actor_membership_fk
    foreign key (installation_id, workspace_id, applied_by_person_id)
    references public.workspace_memberships(
      installation_id, workspace_id, person_id
    ) on delete restrict,
  constraint workspace_membership_revocation_receipts_target_membership_fk
    foreign key (
      installation_id, workspace_id, target_person_id, target_person_kind
    ) references public.workspace_memberships (
      installation_id, workspace_id, person_id, kind
    ) on delete restrict,
  constraint workspace_membership_revocation_receipts_work_fk
    foreign key (installation_id, workspace_id, work_id)
    references public.work(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_receipts_policy_fk
    foreign key (installation_id, workspace_id, policy_id)
    references public.policies(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_receipts_grant_fk
    foreign key (installation_id, workspace_id, capability_grant_id)
    references public.capability_grants(installation_id, workspace_id, id)
    on delete restrict,
  constraint workspace_membership_revocation_receipts_record_fk
    foreign key (installation_id, workspace_id, receipt_id)
    references public.records(installation_id, workspace_id, id)
    on delete restrict deferrable initially deferred,
  constraint workspace_membership_revocation_receipts_same_actor check (
    approved_by_person_id = actor_person_id
    and applied_by_person_id = actor_person_id
    and actor_person_id <> target_person_id
  ),
  constraint workspace_membership_revocation_receipts_distinct_ids check (
    receipt_id <> membership_revocation_id
    and receipt_id <> approval_id
    and receipt_id <> approval_record_id
    and receipt_id <> approval_receipt_id
    and receipt_id <> policy_id
    and receipt_id <> capability_grant_id
    and membership_revocation_id <> approval_id
    and membership_revocation_id <> approval_record_id
    and membership_revocation_id <> approval_receipt_id
    and membership_revocation_id <> policy_id
    and membership_revocation_id <> capability_grant_id
    and approval_id <> approval_record_id
    and approval_id <> approval_receipt_id
    and approval_id <> policy_id
    and approval_id <> capability_grant_id
    and approval_record_id <> approval_receipt_id
    and approval_record_id <> policy_id
    and approval_record_id <> capability_grant_id
    and approval_receipt_id <> policy_id
    and approval_receipt_id <> capability_grant_id
    and policy_id <> capability_grant_id
  ),
  constraint workspace_membership_revocation_receipts_distinct_hashes check (
    receipt_hash <> approval_hash
    and receipt_hash <> approval_receipt_hash
    and receipt_hash <> work_snapshot_hash
    and receipt_hash <> 'sha256:' || policy_content_sha256
    and approval_hash <> approval_receipt_hash
    and approval_hash <> work_snapshot_hash
    and approval_hash <> 'sha256:' || policy_content_sha256
    and approval_receipt_hash <> work_snapshot_hash
    and approval_receipt_hash <> 'sha256:' || policy_content_sha256
    and work_snapshot_hash <> 'sha256:' || policy_content_sha256
  ),
  constraint workspace_membership_revocation_receipts_time_check check (
    approval_consumed_at = date_trunc('milliseconds', approval_consumed_at)
    and revoked_at = approval_consumed_at
    and actor_membership_verified_at = approval_consumed_at
    and target_membership_verified_at = approval_consumed_at
    and capability_grant_verified_at = approval_consumed_at
    and policy_verified_at = approval_consumed_at
    and work_snapshot_verified_at = approval_consumed_at
    and aal2_verified_at <= approval_consumed_at
    and approval_consumed_at <= aal2_verified_at + interval '10 minutes'
  ),
  constraint workspace_membership_revocation_receipts_owner_continuity check (
    (
      target_person_kind = 'owner'
      and live_owner_count_before >= 2
      and live_owner_count_after = live_owner_count_before - 1
    ) or (
      target_person_kind <> 'owner'
      and live_owner_count_after = live_owner_count_before
    )
  ),
  constraint workspace_membership_revocation_receipts_idempotency_check check (
    idempotency = jsonb_build_object(
      'key', receipt_id::text,
      'exactReplayReturnsSameReceipt', true,
      'conflictingReplayDenied', true,
      'additionalRevocationsOnReplay', 0
    )
  ),
  constraint workspace_membership_revocation_receipts_effects_check check (
    effects = '{
      "targetMembershipRevoked": true,
      "targetPersonDeleted": false,
      "workspaceDeleted": false,
      "otherMembershipMutated": false,
      "otherPersonMutated": false,
      "otherWorkspaceRead": false,
      "otherWorkspaceMutation": false,
      "workMutated": false,
      "policyMutated": false,
      "capabilityGrantMutated": false,
      "externalSystemMutated": false
    }'::jsonb
  ),
  unique (installation_id, workspace_id, approval_id),
  unique (installation_id, workspace_id, receipt_id),
  unique (membership_revocation_id)
);

create function public.workspace_membership_revocation_receipt_core_document(
  value public.workspace_membership_revocation_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'contract', 'vorton.workspace-membership-revocation-receipt.v1',
    'receiptId', value.receipt_id::text,
    'receiptPlane', 'workspace-postgres',
    'membershipRevocationId', value.membership_revocation_id::text,
    'approvalId', value.approval_id::text,
    'approvalRecordId', value.approval_record_id::text,
    'approvalReceiptId', value.approval_receipt_id::text,
    'approvalReceiptSha256', value.approval_receipt_hash,
    'approvalHash', value.approval_hash,
    'binding', value.binding,
    'authority', value.authority,
    'approvedByPersonId', value.approved_by_person_id::text,
    'appliedByPersonId', value.applied_by_person_id::text,
    'approvalConsumptionCount', value.approval_consumption_count,
    'approvalConsumedAt', to_char(
      value.approval_consumed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'revokedAt', to_char(
      value.revoked_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'aal2VerifiedAt', to_char(
      value.aal2_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'assuranceLevel', value.assurance_level,
    'actorMembershipVerifiedAt', to_char(
      value.actor_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'targetMembershipVerifiedAt', to_char(
      value.target_membership_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'capabilityGrantVerifiedAt', to_char(
      value.capability_grant_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'policyVerifiedAt', to_char(
      value.policy_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'workSnapshotVerifiedAt', to_char(
      value.work_snapshot_verified_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'ownerContinuity', jsonb_build_object(
      'checkedAt', to_char(
        value.approval_consumed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'liveOwnerCountBefore', value.live_owner_count_before,
      'liveOwnerCountAfter', value.live_owner_count_after,
      'finalOwnerRevoked', false
    ),
    'idempotency', value.idempotency,
    'effects', value.effects
  )
$$;

create function public.derive_workspace_membership_revocation_receipt_hash()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.receipt_hash := public.vorton_module_lifecycle_hash(
    public.workspace_membership_revocation_receipt_core_document(new)
  );
  return new;
end
$$;

create trigger workspace_membership_revocation_receipts_derive_hash
before insert on public.workspace_membership_revocation_receipts
for each row execute function
  public.derive_workspace_membership_revocation_receipt_hash();

create function public.workspace_membership_revocation_receipt_document(
  value public.workspace_membership_revocation_receipts
) returns jsonb
language sql immutable strict
set search_path = pg_catalog, public
as $$
  select public.workspace_membership_revocation_receipt_core_document(value) ||
    jsonb_build_object('receiptHash', value.receipt_hash)
$$;

create function public.reject_workspace_membership_revocation_authority_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Workspace membership revocation authority is append-only';
end
$$;

create trigger workspace_membership_revocation_approvals_append_only
before update or delete on public.workspace_membership_revocation_approvals
for each row execute function
  public.reject_workspace_membership_revocation_authority_mutation();

create trigger workspace_membership_revocation_approval_receipts_append_only
before update or delete on
  public.workspace_membership_revocation_approval_receipts
for each row execute function
  public.reject_workspace_membership_revocation_authority_mutation();

create trigger workspace_membership_revocation_receipts_append_only
before update or delete on public.workspace_membership_revocation_receipts
for each row execute function
  public.reject_workspace_membership_revocation_authority_mutation();

create function public.create_workspace_membership_revocation_approval(
  target_approval_id uuid,
  target_installation_id uuid,
  target_workspace_id uuid,
  target_person_id uuid,
  expected_target_kind public.person_kind,
  target_work_id uuid,
  target_capability_grant_id uuid,
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
  target_person_identity uuid;
  target_kind_value public.person_kind;
  workspace_realm public.installation_realm;
  work_row public.work;
  grant_row public.capability_grants;
  policy_row public.policies;
  approved_at_value timestamptz;
  aal2_verified_at_value timestamptz;
  work_snapshot_value jsonb;
  work_snapshot_hash_value text;
  binding_value jsonb;
  authority_value jsonb;
  scope_value jsonb := '{
    "action": "workspace.membership.revoke",
    "targetMembershipOnly": true,
    "selfRevocation": false,
    "personDeletion": false,
    "workspaceDeletion": false,
    "otherMembershipMutation": false,
    "otherWorkspaceRead": false,
    "otherWorkspaceMutation": false,
    "externalSystemMutation": false
  }'::jsonb;
  effects_value jsonb := '{
    "approvalCreated": true,
    "approvalConsumed": false,
    "targetMembershipRevoked": false,
    "targetMembershipMutated": false,
    "targetPersonDeleted": false,
    "workspaceDeleted": false,
    "otherMembershipMutated": false,
    "otherPersonMutated": false,
    "otherWorkspaceRead": false,
    "otherWorkspaceMutation": false,
    "workMutated": false,
    "policyMutated": false,
    "capabilityGrantMutated": false,
    "externalSystemMutated": false
  }'::jsonb;
  live_owner_count integer;
  approval_record_id_value uuid;
  approval_receipt_id_value uuid;
  generation_attempt integer;
  approval public.workspace_membership_revocation_approvals;
  receipt public.workspace_membership_revocation_approval_receipts;
  approval_record public.records;
begin
  if target_approval_id is null
    or target_installation_id is null
    or target_workspace_id is null
    or target_person_id is null
    or expected_target_kind is null
    or target_work_id is null
    or target_capability_grant_id is null
    or target_expires_at is null
    or target_expires_at is distinct from date_trunc(
      'milliseconds', target_expires_at
    )
    or subject_text is null
    or subject_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Exact workspace membership revocation approval request is invalid';
  end if;
  subject_auth_user_id := subject_text::uuid;

  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':' || target_workspace_id::text ||
    ':workspace-membership-revocation-approval:' ||
    target_approval_id::text,
    0
  ));

  select workspace.realm
    into workspace_realm
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
   for share;
  if workspace_realm is null then
    raise exception 'Target workspace does not exist';
  end if;

  approved_at_value := date_trunc('milliseconds', clock_timestamp());
  if not public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;

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
    raise exception 'A live workspace owner is required to approve revocation';
  end if;
  if actor_person_id_value = target_person_id then
    raise exception 'Self-revocation is forbidden';
  end if;

  -- An exact approval retry remains a read-only replay, but only the original
  -- live owner with fresh AAL2 may obtain the authority documents.
  select * into approval
    from public.workspace_membership_revocation_approvals existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id;
  if approval.approval_record_id is not null then
    if approval.actor_person_id is distinct from actor_person_id_value
      or approval.target_person_id is distinct from target_person_id
      or approval.target_person_kind is distinct from expected_target_kind
      or approval.work_id is distinct from target_work_id
      or approval.capability_grant_id is distinct from
        target_capability_grant_id
      or approval.expires_at is distinct from target_expires_at
    then
      raise exception 'Membership revocation approval retry conflicts with immutable authority';
    end if;
    select * into receipt
      from public.workspace_membership_revocation_approval_receipts existing
     where existing.installation_id = approval.installation_id
       and existing.workspace_id = approval.workspace_id
       and existing.approval_id = approval.approval_id;
    select * into approval_record
      from public.records existing
     where existing.installation_id = approval.installation_id
       and existing.workspace_id = approval.workspace_id
       and existing.id = approval.approval_record_id;
    if receipt.receipt_id is null
      or receipt.approval_hash <> approval.approval_hash
      or receipt.binding <> approval.binding
      or receipt.authority <> approval.authority
      or approval.approval_hash <> public.vorton_module_lifecycle_hash(
        public.workspace_membership_revocation_approval_core_document(approval)
      )
      or receipt.receipt_hash <> public.vorton_module_lifecycle_hash(
        public.workspace_membership_revocation_approval_receipt_core_document(
          receipt
        )
      )
      or approval_record.id is null
      or approval_record.kind <> 'approval'
      or approval_record.work_id <> approval.work_id
      or approval_record.summary <>
        'Approved workspace membership revocation'
      or approval_record.payload <> public.workspace_membership_revocation_approval_document(
        approval, receipt
      )
      or approval_record.source_uri is not null
      or approval_record.classification <> 'internal'
      or approval_record.actor_person_id <> approval.actor_person_id
      or approval_record.actor_worker_id is not null
      or approval_record.supersedes_record_id is not null
      or approval_record.created_at <> approval.approved_at
    then
      raise exception 'Membership revocation approval integrity failure';
    end if;
    return jsonb_build_object(
      'approval', public.workspace_membership_revocation_approval_document(
        approval, receipt
      ),
      'approvalReceipt',
        public.workspace_membership_revocation_approval_receipt_document(
          receipt
        )
    );
  end if;

  select person.id, membership.kind
    into target_person_identity, target_kind_value
    from public.people person
    join public.workspace_memberships membership
      on membership.installation_id = person.installation_id
     and membership.person_id = person.id
   where person.installation_id = target_installation_id
     and person.id = target_person_id
     and membership.workspace_id = target_workspace_id
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     )
   for share of person
   for update of membership;
  if target_person_identity is null then
    raise exception 'Target live workspace membership does not exist';
  end if;
  if target_kind_value <> expected_target_kind then
    raise exception 'Target membership kind does not match approval request';
  end if;

  perform 1
    from public.workspace_memberships membership
   where membership.installation_id = target_installation_id
     and membership.workspace_id = target_workspace_id
     and membership.kind = 'owner'
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     )
   for update;
  select count(*)::integer
    into live_owner_count
    from public.workspace_memberships membership
   where membership.installation_id = target_installation_id
     and membership.workspace_id = target_workspace_id
     and membership.kind = 'owner'
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     );
  if live_owner_count < 1
    or target_kind_value = 'owner' and live_owner_count < 2
  then
    raise exception 'The final live workspace owner cannot be revoked';
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
      select 1
        from jsonb_array_elements(work_row.acceptance_criteria) criterion
       where jsonb_typeof(criterion) <> 'string'
          or criterion #>> '{}' = ''
          or criterion #>> '{}' <> trim(criterion #>> '{}')
    )
  then
    raise exception 'Exact ready person-custodied Work is required';
  end if;
  work_snapshot_value :=
    public.workspace_membership_revocation_work_snapshot(work_row);
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
  if not public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    approved_at_value
  ) then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;
  aal2_verified_at_value := to_timestamp(
    current_setting('vorton.workspace_step_up_auth_time', true)::bigint
  );
  if target_expires_at <= approved_at_value
    or target_expires_at > approved_at_value + interval '24 hours'
  then
    raise exception 'Revocation approval expiry must be within 24 hours';
  end if;
  if grant_row.principal_kind <> 'person'
    or grant_row.person_id is distinct from actor_person_id_value
    or grant_row.worker_id is not null
    or grant_row.capability <> 'workspace.membership.revoke'
    or grant_row.mode <> 'modify'
    or grant_row.work_id is distinct from target_work_id
    or grant_row.granted_at > approved_at_value
    or grant_row.expires_at is not null
      and grant_row.expires_at <= approved_at_value
    or exists (
      select 1
        from public.capability_grant_revocations revocation
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
    raise exception 'Exact live person Work-scoped revocation capability is required';
  end if;
  if target_approval_id in (policy_row.id, grant_row.id) then
    raise exception 'Approval, Policy, and grant identities must be distinct';
  end if;

  binding_value := jsonb_build_object(
    'vortonInstallationId', target_installation_id::text,
    'workspaceId', target_workspace_id::text,
    'realm', workspace_realm::text,
    'targetPersonId', target_person_id::text,
    'targetPersonKind', target_kind_value::text,
    'workId', work_row.id::text,
    'workSnapshotSha256', work_snapshot_hash_value
  );
  authority_value := jsonb_build_object(
    'principalKind', 'person',
    'personId', actor_person_id_value::text,
    'workspaceMembershipKind', 'owner',
    'capability', 'workspace.membership.revoke',
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
    exit when cardinality(array[
      target_approval_id, approval_record_id_value,
      approval_receipt_id_value, policy_row.id, grant_row.id
    ]) = cardinality(array(
      select distinct identifier from unnest(array[
        target_approval_id, approval_record_id_value,
        approval_receipt_id_value, policy_row.id, grant_row.id
      ]) identifier
    ));
  end loop;
  if cardinality(array[
    target_approval_id, approval_record_id_value,
    approval_receipt_id_value, policy_row.id, grant_row.id
  ]) <> cardinality(array(
    select distinct identifier from unnest(array[
      target_approval_id, approval_record_id_value,
      approval_receipt_id_value, policy_row.id, grant_row.id
    ]) identifier
  )) then
    raise exception 'Revocation approval identifier generation failed';
  end if;

  insert into public.workspace_membership_revocation_approvals (
    approval_record_id, approval_id, installation_id, workspace_id, realm,
    actor_person_id, actor_membership_kind, target_person_id,
    target_person_kind, work_id, work_snapshot, work_snapshot_hash, policy_id,
    policy_content_sha256, capability_grant_id, binding, authority,
    approval_plane, approved_at, expires_at, aal2_verified_at,
    assurance_level, actor_membership_verified_at,
    target_membership_verified_at, policy_verified_at,
    capability_grant_verified_at, work_verified_at,
    live_owner_count_at_approval, scope, approval_hash, created_at
  ) values (
    approval_record_id_value, target_approval_id, target_installation_id,
    target_workspace_id, workspace_realm, actor_person_id_value, 'owner',
    target_person_id, target_kind_value, work_row.id, work_snapshot_value,
    work_snapshot_hash_value, policy_row.id, policy_row.content_sha256,
    grant_row.id, binding_value, authority_value, 'workspace-postgres',
    approved_at_value, target_expires_at, aal2_verified_at_value, 'aal2',
    approved_at_value, approved_at_value, approved_at_value,
    approved_at_value, approved_at_value, live_owner_count, scope_value,
    'sha256:' || repeat('0', 64), approved_at_value
  ) returning * into approval;

  insert into public.workspace_membership_revocation_approval_receipts (
    receipt_id, approval_record_id, approval_id, installation_id,
    workspace_id, realm, actor_person_id, target_person_id,
    target_person_kind, work_id, work_snapshot_hash, policy_id,
    policy_content_sha256, capability_grant_id, binding, authority,
    approval_hash, receipt_plane, approved_at, created_at,
    actor_membership_verified_at, target_membership_verified_at,
    policy_verified_at, capability_grant_verified_at, work_verified_at,
    owner_continuity_verified_at, aal2_verified_at, assurance_level,
    effects, receipt_hash
  ) values (
    approval_receipt_id_value, approval.approval_record_id,
    approval.approval_id, approval.installation_id, approval.workspace_id,
    approval.realm, approval.actor_person_id, approval.target_person_id,
    approval.target_person_kind, approval.work_id,
    approval.work_snapshot_hash, approval.policy_id,
    approval.policy_content_sha256, approval.capability_grant_id,
    approval.binding, approval.authority, approval.approval_hash,
    'workspace-postgres', approval.approved_at, approval.approved_at,
    approval.approved_at, approval.approved_at, approval.approved_at,
    approval.approved_at, approval.approved_at, approval.approved_at,
    approval.aal2_verified_at, 'aal2', effects_value,
    'sha256:' || repeat('0', 64)
  ) returning * into receipt;

  insert into public.records (
    id, installation_id, workspace_id, work_id, kind, summary, payload,
    source_uri, classification, actor_person_id, actor_worker_id,
    supersedes_record_id, created_at
  ) values (
    approval.approval_record_id, approval.installation_id,
    approval.workspace_id, approval.work_id, 'approval',
    'Approved workspace membership revocation',
    public.workspace_membership_revocation_approval_document(
      approval, receipt
    ),
    null, 'internal', approval.actor_person_id, null, null,
    approval.approved_at
  );

  return jsonb_build_object(
    'approval', public.workspace_membership_revocation_approval_document(
      approval, receipt
    ),
    'approvalReceipt',
      public.workspace_membership_revocation_approval_receipt_document(receipt)
  );
end
$$;

create function public.apply_workspace_membership_revocation(
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
  workspace_realm public.installation_realm;
  approval public.workspace_membership_revocation_approvals;
  approval_receipt public.workspace_membership_revocation_approval_receipts;
  execution_receipt public.workspace_membership_revocation_receipts;
  approval_record public.records;
  execution_record public.records;
  ledger_row public.workspace_membership_revocations;
  target_kind_value public.person_kind;
  target_identity uuid;
  work_row public.work;
  grant_row public.capability_grants;
  policy_row public.policies;
  current_work_snapshot jsonb;
  current_work_snapshot_hash text;
  applied_at_value timestamptz;
  aal2_verified_at_value timestamptz;
  live_owner_count_before integer;
  live_owner_count_after integer;
  membership_revocation_id_value uuid;
  generation_attempt integer;
  idempotency_value jsonb;
  effects_value jsonb := '{
    "targetMembershipRevoked": true,
    "targetPersonDeleted": false,
    "workspaceDeleted": false,
    "otherMembershipMutated": false,
    "otherPersonMutated": false,
    "otherWorkspaceRead": false,
    "otherWorkspaceMutation": false,
    "workMutated": false,
    "policyMutated": false,
    "capabilityGrantMutated": false,
    "externalSystemMutated": false
  }'::jsonb;
begin
  if target_receipt_id is null
    or target_approval_id is null
    or target_installation_id is null
    or target_workspace_id is null
    or subject_text is null
    or subject_text
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'Exact workspace membership revocation apply request is invalid';
  end if;
  subject_auth_user_id := subject_text::uuid;

  perform pg_advisory_xact_lock(hashtextextended(
    target_installation_id::text || ':' || target_workspace_id::text ||
    ':workspace-membership-revocation-apply:' || target_approval_id::text,
    0
  ));

  select workspace.realm
    into workspace_realm
    from public.workspaces workspace
   where workspace.installation_id = target_installation_id
     and workspace.id = target_workspace_id
   for update;
  if workspace_realm is null then
    raise exception 'Target workspace does not exist';
  end if;

  applied_at_value := date_trunc('milliseconds', clock_timestamp());
  if not public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    applied_at_value
  ) then
    raise exception 'Signed recent workspace-person AAL2 is required';
  end if;
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
    raise exception 'A live workspace member is required to apply or replay revocation';
  end if;
  if actor_membership_kind_value <> 'owner' then
    raise exception 'The same live workspace owner must apply or replay revocation';
  end if;

  select * into execution_receipt
    from public.workspace_membership_revocation_receipts existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id
   for update;
  if execution_receipt.receipt_id is not null then
    if execution_receipt.receipt_id is distinct from target_receipt_id
      or execution_receipt.applied_by_person_id is distinct from
        actor_person_id_value
      or execution_receipt.approved_by_person_id is distinct from
        actor_person_id_value
    then
      raise exception 'Membership revocation receipt retry conflicts with immutable application';
    end if;
    select * into approval
      from public.workspace_membership_revocation_approvals existing
     where existing.installation_id = execution_receipt.installation_id
       and existing.workspace_id = execution_receipt.workspace_id
       and existing.approval_id = execution_receipt.approval_id;
    select * into approval_receipt
      from public.workspace_membership_revocation_approval_receipts existing
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
    select * into ledger_row
      from public.workspace_membership_revocations existing
     where existing.id = execution_receipt.membership_revocation_id;
    if approval.approval_record_id is null
      or approval_receipt.receipt_id is null
      or approval.approval_hash <> public.vorton_module_lifecycle_hash(
        public.workspace_membership_revocation_approval_core_document(approval)
      )
      or approval_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_membership_revocation_approval_receipt_core_document(
            approval_receipt
          )
        )
      or execution_receipt.receipt_hash <>
        public.vorton_module_lifecycle_hash(
          public.workspace_membership_revocation_receipt_core_document(
            execution_receipt
          )
        )
      or approval_record.id is null
      or approval_record.payload <>
        public.workspace_membership_revocation_approval_document(
          approval, approval_receipt
        )
      or execution_record.id is null
      or execution_record.kind <> 'receipt'
      or execution_record.work_id <> execution_receipt.work_id
      or execution_record.summary <>
        'Applied workspace membership revocation'
      or execution_record.payload <>
        public.workspace_membership_revocation_receipt_document(
          execution_receipt
        )
      or execution_record.source_uri is not null
      or execution_record.classification <> 'internal'
      or execution_record.actor_person_id <>
        execution_receipt.applied_by_person_id
      or execution_record.actor_worker_id is not null
      or execution_record.supersedes_record_id is not null
      or execution_record.created_at <> execution_receipt.revoked_at
      or ledger_row.id is null
      or ledger_row.installation_id <> execution_receipt.installation_id
      or ledger_row.workspace_id <> execution_receipt.workspace_id
      or ledger_row.person_id <> execution_receipt.target_person_id
      or ledger_row.revoked_by_person_id <>
        execution_receipt.applied_by_person_id
      or ledger_row.revoked_at <> execution_receipt.revoked_at
    then
      raise exception 'Membership revocation completed receipt integrity failure';
    end if;
    return jsonb_build_object(
      'approval', public.workspace_membership_revocation_approval_document(
        approval, approval_receipt
      ),
      'approvalReceipt',
        public.workspace_membership_revocation_approval_receipt_document(
          approval_receipt
        ),
      'receipt', public.workspace_membership_revocation_receipt_document(
        execution_receipt
      )
    );
  end if;

  select * into approval
    from public.workspace_membership_revocation_approvals existing
   where existing.installation_id = target_installation_id
     and existing.workspace_id = target_workspace_id
     and existing.approval_id = target_approval_id
   for update;
  if approval.approval_record_id is null then
    raise exception 'Exact membership revocation approval does not exist';
  end if;
  if approval.actor_person_id <> actor_person_id_value then
    raise exception 'The same live workspace owner must approve and apply revocation';
  end if;
  if target_receipt_id in (
    approval.approval_id,
    approval.approval_record_id,
    approval.policy_id,
    approval.capability_grant_id
  ) then
    raise exception 'Revocation receipt identity conflicts with authority';
  end if;
  select * into approval_receipt
    from public.workspace_membership_revocation_approval_receipts existing
   where existing.installation_id = approval.installation_id
     and existing.workspace_id = approval.workspace_id
     and existing.approval_id = approval.approval_id
   for update;
  if approval_receipt.receipt_id is null
    or approval_receipt.receipt_id = target_receipt_id
  then
    raise exception 'Exact no-effect approval receipt is unavailable';
  end if;

  select person.id, membership.kind
    into target_identity, target_kind_value
    from public.people person
    join public.workspace_memberships membership
      on membership.installation_id = person.installation_id
     and membership.person_id = person.id
   where person.installation_id = approval.installation_id
     and person.id = approval.target_person_id
     and membership.workspace_id = approval.workspace_id
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     )
   for share of person
   for update of membership;
  if target_identity is null
    or target_kind_value is distinct from approval.target_person_kind
  then
    raise exception 'Exact target membership is no longer live';
  end if;
  if target_identity = actor_person_id_value then
    raise exception 'Self-revocation is forbidden';
  end if;

  perform 1
    from public.workspace_memberships membership
   where membership.installation_id = approval.installation_id
     and membership.workspace_id = approval.workspace_id
     and membership.kind = 'owner'
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     )
   for update;
  select count(*)::integer
    into live_owner_count_before
    from public.workspace_memberships membership
   where membership.installation_id = approval.installation_id
     and membership.workspace_id = approval.workspace_id
     and membership.kind = 'owner'
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     );
  if live_owner_count_before < 1
    or target_kind_value = 'owner' and live_owner_count_before < 2
  then
    raise exception 'The final live workspace owner cannot be revoked';
  end if;

  select * into work_row
    from public.work candidate
   where candidate.installation_id = approval.installation_id
     and candidate.workspace_id = approval.workspace_id
     and candidate.id = approval.work_id
   for update;
  current_work_snapshot :=
    public.workspace_membership_revocation_work_snapshot(work_row);
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
  if not public.vorton_workspace_step_up_context_valid(
    target_installation_id::text,
    target_workspace_id::text,
    subject_text,
    applied_at_value
  ) then
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
    or grant_row.capability <> 'workspace.membership.revoke'
    or grant_row.mode <> 'modify'
    or grant_row.work_id is distinct from approval.work_id
    or grant_row.granted_at > applied_at_value
    or grant_row.expires_at is not null
      and grant_row.expires_at <= applied_at_value
    or exists (
      select 1
        from public.capability_grant_revocations revocation
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
      public.workspace_membership_revocation_approval_core_document(approval)
    )
    or approval_receipt.approval_hash <> approval.approval_hash
    or approval_receipt.receipt_hash <>
      public.vorton_module_lifecycle_hash(
        public.workspace_membership_revocation_approval_receipt_core_document(
          approval_receipt
        )
      )
  then
    raise exception 'Membership revocation approval integrity failure';
  end if;
  select * into approval_record
    from public.records existing
   where existing.installation_id = approval.installation_id
     and existing.workspace_id = approval.workspace_id
     and existing.id = approval.approval_record_id;
  if approval_record.id is null
    or approval_record.kind <> 'approval'
    or approval_record.work_id <> approval.work_id
    or approval_record.summary <> 'Approved workspace membership revocation'
    or approval_record.payload <>
      public.workspace_membership_revocation_approval_document(
        approval, approval_receipt
      )
    or approval_record.source_uri is not null
    or approval_record.classification <> 'internal'
    or approval_record.actor_person_id <> approval.actor_person_id
    or approval_record.actor_worker_id is not null
    or approval_record.supersedes_record_id is not null
    or approval_record.created_at <> approval.approved_at
  then
    raise exception 'Membership revocation approval Record integrity failure';
  end if;

  select * into ledger_row
    from public.workspace_membership_revocations existing
   where existing.installation_id = approval.installation_id
     and existing.workspace_id = approval.workspace_id
     and existing.person_id = approval.target_person_id
   for update;
  if ledger_row.id is not null then
    raise exception 'Existing membership revocation lacks exact product receipt';
  end if;

  for generation_attempt in 1..16 loop
    membership_revocation_id_value := gen_random_uuid();
    exit when membership_revocation_id_value not in (
      target_receipt_id,
      approval.approval_id,
      approval.approval_record_id,
      approval_receipt.receipt_id,
      approval.policy_id,
      approval.capability_grant_id
    );
  end loop;
  if membership_revocation_id_value in (
    target_receipt_id,
    approval.approval_id,
    approval.approval_record_id,
    approval_receipt.receipt_id,
    approval.policy_id,
    approval.capability_grant_id
  ) then
    raise exception 'Membership revocation identifier generation failed';
  end if;

  insert into public.workspace_membership_revocations (
    id, installation_id, workspace_id, person_id, revoked_by_person_id,
    revoked_at
  ) values (
    membership_revocation_id_value, approval.installation_id,
    approval.workspace_id, approval.target_person_id,
    actor_person_id_value, applied_at_value
  ) returning * into ledger_row;

  select count(*)::integer
    into live_owner_count_after
    from public.workspace_memberships membership
   where membership.installation_id = approval.installation_id
     and membership.workspace_id = approval.workspace_id
     and membership.kind = 'owner'
     and public.workspace_membership_is_live(
       membership.installation_id,
       membership.workspace_id,
       membership.person_id
     );
  if live_owner_count_after < 1
    or target_kind_value = 'owner'
      and live_owner_count_after <> live_owner_count_before - 1
    or target_kind_value <> 'owner'
      and live_owner_count_after <> live_owner_count_before
  then
    raise exception 'Workspace owner continuity changed during revocation';
  end if;

  idempotency_value := jsonb_build_object(
    'key', target_receipt_id::text,
    'exactReplayReturnsSameReceipt', true,
    'conflictingReplayDenied', true,
    'additionalRevocationsOnReplay', 0
  );
  insert into public.workspace_membership_revocation_receipts (
    receipt_id, membership_revocation_id, approval_record_id, approval_id,
    approval_receipt_id, approval_receipt_hash, approval_hash,
    installation_id, workspace_id, realm, actor_person_id,
    target_person_id, target_person_kind, work_id, work_snapshot_hash,
    policy_id, policy_content_sha256, capability_grant_id, binding,
    authority, approved_by_person_id, applied_by_person_id,
    approval_consumption_count, approval_consumed_at, revoked_at,
    aal2_verified_at, assurance_level, actor_membership_verified_at,
    target_membership_verified_at, capability_grant_verified_at,
    policy_verified_at, work_snapshot_verified_at, live_owner_count_before,
    live_owner_count_after, idempotency, effects, receipt_hash
  ) values (
    target_receipt_id, ledger_row.id, approval.approval_record_id,
    approval.approval_id, approval_receipt.receipt_id,
    approval_receipt.receipt_hash, approval.approval_hash,
    approval.installation_id, approval.workspace_id, approval.realm,
    approval.actor_person_id, approval.target_person_id,
    approval.target_person_kind, approval.work_id,
    approval.work_snapshot_hash, approval.policy_id,
    approval.policy_content_sha256, approval.capability_grant_id,
    approval.binding, approval.authority, approval.actor_person_id,
    actor_person_id_value, 1, applied_at_value, applied_at_value,
    aal2_verified_at_value, 'aal2', applied_at_value, applied_at_value,
    applied_at_value, applied_at_value, applied_at_value,
    live_owner_count_before, live_owner_count_after, idempotency_value,
    effects_value, 'sha256:' || repeat('0', 64)
  ) returning * into execution_receipt;

  insert into public.records (
    id, installation_id, workspace_id, work_id, kind, summary, payload,
    source_uri, classification, actor_person_id, actor_worker_id,
    supersedes_record_id, created_at
  ) values (
    execution_receipt.receipt_id, execution_receipt.installation_id,
    execution_receipt.workspace_id, execution_receipt.work_id, 'receipt',
    'Applied workspace membership revocation',
    public.workspace_membership_revocation_receipt_document(
      execution_receipt
    ),
    null, 'internal', execution_receipt.applied_by_person_id, null, null,
    execution_receipt.revoked_at
  );

  return jsonb_build_object(
    'approval', public.workspace_membership_revocation_approval_document(
      approval, approval_receipt
    ),
    'approvalReceipt',
      public.workspace_membership_revocation_approval_receipt_document(
        approval_receipt
      ),
    'receipt', public.workspace_membership_revocation_receipt_document(
      execution_receipt
    )
  );
end
$$;

comment on table public.workspace_membership_revocation_approvals is
  'Immutable same-person workspace-owner approval bound to exact ready Work, Policy, capability grant, target membership, and recent signed AAL2.';
comment on table public.workspace_membership_revocation_approval_receipts is
  'Immutable no-effect receipt created atomically with governed membership-revocation approval.';
comment on table public.workspace_membership_revocation_receipts is
  'Immutable product receipt for one atomically consumed approval and one exact append-only membership revocation.';

alter table public.workspace_membership_revocation_approvals
  enable row level security;
alter table public.workspace_membership_revocation_approval_receipts
  enable row level security;
alter table public.workspace_membership_revocation_receipts
  enable row level security;

revoke all on table public.workspace_membership_revocation_approvals,
  public.workspace_membership_revocation_approval_receipts,
  public.workspace_membership_revocation_receipts
from public, anon, authenticated, aubos_worker;

revoke all on function public.workspace_membership_revocation_work_snapshot(
  public.work
) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.workspace_membership_revocation_approval_core_document(
    public.workspace_membership_revocation_approvals
  ) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.derive_workspace_membership_revocation_approval_hash()
from public, anon, authenticated, aubos_worker;
revoke all on function
  public.workspace_membership_revocation_approval_receipt_core_document(
    public.workspace_membership_revocation_approval_receipts
  ) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.derive_workspace_membership_revocation_approval_receipt_hash()
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_membership_revocation_approval_document(
  public.workspace_membership_revocation_approvals,
  public.workspace_membership_revocation_approval_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.workspace_membership_revocation_approval_receipt_document(
    public.workspace_membership_revocation_approval_receipts
  ) from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_membership_revocation_receipt_core_document(
  public.workspace_membership_revocation_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.derive_workspace_membership_revocation_receipt_hash()
from public, anon, authenticated, aubos_worker;
revoke all on function public.workspace_membership_revocation_receipt_document(
  public.workspace_membership_revocation_receipts
) from public, anon, authenticated, aubos_worker;
revoke all on function
  public.reject_workspace_membership_revocation_authority_mutation()
from public, anon, authenticated, aubos_worker;

revoke all on function public.create_workspace_membership_revocation_approval(
  uuid, uuid, uuid, uuid, public.person_kind, uuid, uuid, timestamptz
) from public, anon, authenticated, aubos_worker;
grant execute on function public.create_workspace_membership_revocation_approval(
  uuid, uuid, uuid, uuid, public.person_kind, uuid, uuid, timestamptz
) to authenticated;

revoke all on function public.apply_workspace_membership_revocation(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, aubos_worker;
grant execute on function public.apply_workspace_membership_revocation(
  uuid, uuid, uuid, uuid
) to authenticated;

commit;
