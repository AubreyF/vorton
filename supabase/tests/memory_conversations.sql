begin;

do $$
begin
  begin
    insert into public.installations (id, slug, display_name)
    values (
      '55555555-5555-4555-a555-555555555555',
      'missing-realm', 'Missing Realm'
    );
    raise exception 'New installation omitted an explicit realm';
  exception
    when check_violation then null;
  end;
end
$$;

-- Simulate an installation that existed before this migration. The real upgrade
-- receives the same null realm because the migration has no default or backfill.
alter table public.installations drop constraint installations_realm_assigned;
insert into public.installations (id, slug, display_name)
values (
  '44444444-4444-4444-a444-444444444444',
  'preexisting-unknown', 'Preexisting Unknown'
);
alter table public.installations
  add constraint installations_realm_assigned check (realm is not null) not valid;

do $$
begin
  begin
    insert into public.source_connections (
      installation_id, installation_realm, provider, external_account_id,
      credential_reference, poll_overlap_seconds, requests_per_minute,
      page_size, max_pages_per_poll, backoff_base_seconds,
      backoff_max_seconds, watermark
    ) values (
      '44444444-4444-4444-a444-444444444444', 'organizational', 'omi',
      'unknown-account', 'secret://synthetic-only', 300, 30, 25, 4, 1, 60,
      '2026-08-28T11:00:00Z'
    );
    raise exception 'Unknown installation accepted a source connection';
  exception
    when foreign_key_violation then null;
  end;
end
$$;

update public.installations
set realm = 'personal'
where id = '44444444-4444-4444-a444-444444444444';

insert into public.memory_banks (
  installation_id, installation_realm, adapter, external_bank_id,
  database_locator, object_bucket_locator
) values (
  '44444444-4444-4444-a444-444444444444', 'personal', 'hindsight',
  'backfilled-personal-bank', 'database://backfilled-personal',
  'bucket://backfilled-personal'
);

insert into public.installations (id, slug, display_name, realm)
values
  ('7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'synthetic-org', 'Synthetic Org', 'organizational'),
  ('36bb264a-668f-45a6-8da0-6e5cad3fc026', 'synthetic-person', 'Synthetic Person', 'personal');

insert into public.source_connections (
  id, installation_id, installation_realm, provider, external_account_id,
  credential_reference, poll_overlap_seconds, requests_per_minute, page_size,
  max_pages_per_poll, backoff_base_seconds, backoff_max_seconds, watermark
) values (
  '0dd9b2cc-b44c-4039-a1fc-5226b5d9bb06',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational', 'google-meet',
  'synthetic-account', 'secret://synthetic-only', 300, 30, 25, 4, 1, 60,
  '2026-08-28T11:00:00Z'
);

insert into public.transcript_revisions (
  id, installation_id, installation_realm, connection_id, provider,
  provider_object_id, revision_hash, title, started_at, participants,
  provider_observed_at, ingested_at, adapter_version, classification,
  completeness, boundary, admission_state
) values (
  '11111111-1111-4111-a111-111111111111',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
  '0dd9b2cc-b44c-4039-a1fc-5226b5d9bb06', 'google-meet', 'synthetic-meeting',
  repeat('a', 64), 'Synthetic mission review', '2026-08-28T11:00:00Z',
  '["Synthetic Ada"]', '2026-08-28T11:30:00Z', '2026-08-28T12:00:00Z',
  'fixture-v1', 'synthetic', 'complete', 'organizational', 'pending'
);

insert into public.transcript_utterances (
  installation_id, installation_realm, transcript_revision_id, ordinal,
  speaker, utterance_text, started_at
) values (
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
  '11111111-1111-4111-a111-111111111111', 0, 'Synthetic Ada',
  'Review the fictional telemetry.', '2026-08-28T11:01:00Z'
);

insert into public.source_citations (
  installation_id, installation_realm, transcript_revision_id, source_uri,
  revision_hash, locator
) values (
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
  '11111111-1111-4111-a111-111111111111',
  'google-meet://synthetic-meeting?revision=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  repeat('a', 64), 'utterance:0'
);

insert into public.memory_banks (
  id, installation_id, installation_realm, adapter, external_bank_id,
  database_locator, object_bucket_locator
) values (
  'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational', 'hindsight',
  'synthetic-org-bank', 'database://synthetic-org', 'bucket://synthetic-org'
);

insert into public.derived_memories (
  id, installation_id, installation_realm, bank_id, external_memory_id, memory_text
) values (
  'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
  'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'synthetic-reflection',
  'Untrusted synthetic reflection.'
);

insert into public.consolidation_lineage (
  installation_id, installation_realm, derived_memory_id, source_revision_id
) values (
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
  'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
  '11111111-1111-4111-a111-111111111111'
);

insert into public.transcript_revisions (
  id, installation_id, installation_realm, connection_id, provider,
  provider_object_id, revision_hash, title, started_at, participants,
  provider_observed_at, ingested_at, adapter_version, classification,
  completeness, boundary, admission_state, deleted_at, supersedes_revision_id
) values (
  '22222222-2222-4222-a222-222222222222',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
  '0dd9b2cc-b44c-4039-a1fc-5226b5d9bb06', 'google-meet', 'synthetic-meeting',
  repeat('b', 64), 'Synthetic mission review', '2026-08-28T11:00:00Z',
  '[]', '2026-08-28T12:30:00Z', '2026-08-28T13:00:00Z', 'fixture-v1',
  'synthetic', 'unavailable', 'organizational', 'pending',
  '2026-08-28T13:00:00Z', '11111111-1111-4111-a111-111111111111'
);

do $$
begin
  if not exists (
    select 1 from public.derived_memories
    where id = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
      and invalidated_at = '2026-08-28T13:00:00Z'
  ) then
    raise exception 'Supersession did not invalidate derived memory';
  end if;

  begin
    update public.transcript_revisions
      set title = 'Canonical mutation'
      where id = '11111111-1111-4111-a111-111111111111';
    raise exception 'Canonical transcript revision accepted mutation';
  exception
    when raise_exception then
      if sqlerrm = 'Canonical transcript revision accepted mutation' then raise; end if;
  end;

  begin
    insert into public.transcript_revisions (
      id, installation_id, installation_realm, connection_id, provider,
      provider_object_id, revision_hash, started_at, participants,
      provider_observed_at, ingested_at, adapter_version, classification,
      completeness, boundary, admission_state
    ) values (
      '33333333-3333-4333-a333-333333333333',
      '7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'organizational',
      '0dd9b2cc-b44c-4039-a1fc-5226b5d9bb06', 'google-meet', 'mixed-source',
      repeat('c', 64), '2026-08-28T11:00:00Z', '[]',
      '2026-08-28T12:30:00Z', '2026-08-28T13:00:00Z', 'fixture-v1',
      'synthetic', 'partial', 'mixed', 'pending'
    );
    raise exception 'Mixed source bypassed quarantine';
  exception
    when check_violation then null;
  end;
end
$$;

rollback;
