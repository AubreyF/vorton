begin;

insert into auth.users (id, email)
values
  ('0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5', 'owner@synthetic.invalid'),
  ('1be8ac6f-bafd-480d-99a7-cb94258a9a1a', 'member@synthetic.invalid');

insert into public.installations (id, slug, display_name)
values
  ('7fae0c60-6682-41ec-b231-26bbaf7fde8e', 'moonbase-lab', 'Moonbase Lab'),
  ('36bb264a-668f-45a6-8da0-6e5cad3fc026', 'other-lab', 'Other Lab');

select public.provision_person(
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  '0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5',
  'Synthetic Owner',
  'owner'
);

select public.provision_person(
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  '1be8ac6f-bafd-480d-99a7-cb94258a9a1a',
  'Synthetic Member',
  'member'
);

insert into public.workers (
  id, installation_id, name, provider, billing_realm, host, runtime, model,
  data_classification_ceiling, isolation, network_policy
) values (
  'b5611dc4-07e4-4388-a7d0-ddf7bb452499',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'Synthetic Worker', 'synthetic', 'test-only', 'moon-1', 'container', 'fixture',
  'synthetic', 'ephemeral-container', 'deny-all'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5","role":"authenticated","installation_id":"7fae0c60-6682-41ec-b231-26bbaf7fde8e"}';

do $$
begin
  if (select count(*) from public.installations) <> 1 then
    raise exception 'RLS exposed an installation outside the authenticated membership';
  end if;
end
$$;

insert into public.work (
  id, installation_id, title, requested_outcome, requested_by_person_id
) values (
  'b6040202-b8e5-4513-a05f-47c11aa40573',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'Inspect synthetic telemetry',
  'Produce an offline fixture report.',
  public.current_person_id('7fae0c60-6682-41ec-b231-26bbaf7fde8e')
);

insert into public.records (
  id, installation_id, work_id, kind, summary, payload, classification, actor_person_id
) values (
  '5e9518d6-5aa5-454b-a73a-37a0a0b661d2',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'b6040202-b8e5-4513-a05f-47c11aa40573',
  'evidence',
  'Synthetic fixture was inspected.',
  '{"fixture":true}',
  'synthetic',
  public.current_person_id('7fae0c60-6682-41ec-b231-26bbaf7fde8e')
);

do $$
begin
  begin
    update public.records
    set summary = 'Mutation must fail'
    where id = '5e9518d6-5aa5-454b-a73a-37a0a0b661d2';
    raise exception 'Append-only Records accepted an update';
  exception
    when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm = 'Append-only Records accepted an update' then
        raise;
      end if;
  end;
end
$$;

insert into public.roles (
  id, installation_id, name, version, skill_markdown, content_sha256, created_by_person_id
) values (
  '2c347bbe-8b9d-4cdd-92f7-440d5a910878',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'Fixture Analyst', 1, '# Synthetic role',
  '9ed1a55c481c300f1a926ef66f16c5897fc9214e882a4cd87a0c6920fbd67e60',
  public.current_person_id('7fae0c60-6682-41ec-b231-26bbaf7fde8e')
);

insert into public.worker_role_assignments (
  installation_id, worker_id, role_id, assigned_by_person_id
) values (
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'b5611dc4-07e4-4388-a7d0-ddf7bb452499',
  '2c347bbe-8b9d-4cdd-92f7-440d5a910878',
  public.current_person_id('7fae0c60-6682-41ec-b231-26bbaf7fde8e')
);

do $$
begin
  if (select count(*) from public.capability_grants) <> 0 then
    raise exception 'A role assignment granted authority';
  end if;
end
$$;

insert into public.work (
  id, installation_id, title, requested_outcome, requested_by_person_id, custodian_person_id
) values (
  'eaf3cb24-b4eb-438a-819f-f27a819ee71d',
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'Member-custodied synthetic Work',
  'Prove that custody does not permit rewriting the request.',
  public.current_person_id('7fae0c60-6682-41ec-b231-26bbaf7fde8e'),
  (select id from public.people where auth_user_id = '1be8ac6f-bafd-480d-99a7-cb94258a9a1a')
);

set local request.jwt.claims =
  '{"sub":"1be8ac6f-bafd-480d-99a7-cb94258a9a1a","role":"authenticated","installation_id":"7fae0c60-6682-41ec-b231-26bbaf7fde8e"}';

do $$
begin
  begin
    update public.work
    set requested_outcome = 'Member attempted to rewrite authority.'
    where id = 'eaf3cb24-b4eb-438a-819f-f27a819ee71d';
    raise exception 'Non-owner custodian rewrote the Work request';
  exception
    when raise_exception then
      if sqlerrm = 'Non-owner custodian rewrote the Work request' then
        raise;
      end if;
  end;
end
$$;

update public.work
set state = 'ready'
where id = 'eaf3cb24-b4eb-438a-819f-f27a819ee71d';

set local request.jwt.claims =
  '{"sub":"0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5","role":"authenticated","installation_id":"7fae0c60-6682-41ec-b231-26bbaf7fde8e"}';

update public.work
set state = 'ready'
where id = 'b6040202-b8e5-4513-a05f-47c11aa40573';

update public.work
set state = 'leased',
    custodian_worker_id = 'b5611dc4-07e4-4388-a7d0-ddf7bb452499',
    lease_expires_at = now() + interval '5 minutes'
where id = 'b6040202-b8e5-4513-a05f-47c11aa40573';

reset role;
select set_config('aubos.worker_id', 'b5611dc4-07e4-4388-a7d0-ddf7bb452499', true);
select set_config('aubos.installation_id', '7fae0c60-6682-41ec-b231-26bbaf7fde8e', true);
select set_config('aubos.credential_id', 'fbc4ac66-4a32-4a34-b810-88f4330205aa', true);
set local role aubos_worker;

do $$
begin
  if (select count(*) from public.records) <> 1 then
    raise exception 'Worker could not read synthetic evidence for Work in its custody';
  end if;
end
$$;

insert into public.records (
  installation_id, work_id, kind, summary, payload, classification, actor_worker_id
) values (
  '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
  'b6040202-b8e5-4513-a05f-47c11aa40573',
  'receipt', 'Synthetic worker receipt.', '{"fixture":true}', 'synthetic',
  public.current_worker_id()
);

do $$
begin
  begin
    insert into public.records (
      installation_id, work_id, kind, summary, payload, classification, actor_worker_id
    ) values (
      '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
      'b6040202-b8e5-4513-a05f-47c11aa40573',
      'approval', 'A worker cannot approve its own Work.', '{}', 'synthetic',
      public.current_worker_id()
    );
    raise exception 'Worker was able to append an approval';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
begin
  begin
    update public.work
    set title = 'Worker attempted to rewrite the request'
    where id = 'b6040202-b8e5-4513-a05f-47c11aa40573';
    raise exception 'Worker received direct Work update authority';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select public.worker_transition_work(
  'b6040202-b8e5-4513-a05f-47c11aa40573',
  'review'
);

reset role;

do $$
begin
  begin
    update public.records
    set summary = 'Privileged mutation must also fail'
    where id = '5e9518d6-5aa5-454b-a73a-37a0a0b661d2';
    raise exception 'Append-only trigger accepted a privileged update';
  exception
    when raise_exception then
      if sqlerrm = 'Append-only trigger accepted a privileged update' then
        raise;
      end if;
  end;
end
$$;

do $$
begin
  begin
    insert into public.worker_credentials (
      installation_id, worker_id, token_hash, token_hint, issued_at, expires_at
    ) values (
      '7fae0c60-6682-41ec-b231-26bbaf7fde8e',
      'b5611dc4-07e4-4388-a7d0-ddf7bb452499',
      extensions.digest('synthetic-token', 'sha256'),
      'thetic', now(), now() + interval '16 minutes'
    );
    raise exception 'Credential lifetime ceiling was not enforced';
  exception
    when check_violation then null;
  end;
end
$$;

rollback;
