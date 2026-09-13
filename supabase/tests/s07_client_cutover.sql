begin;

create function pg_temp.s07_cutover_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'S07 cutover: %', p_message; end if;
end
$$;

create function pg_temp.s07_cutover_key(p_recovery_id uuid, p_deadline bigint, p_secret_hash text)
returns text language sql immutable as $$
  select 'pub2_' || p_deadline::text || '_' || encode(
    extensions.digest(convert_to(
      'yzt:public-booking:intent:v2' || chr(10)
      || p_recovery_id::text || chr(10)
      || p_deadline::text || chr(10)
      || p_secret_hash,
      'UTF8'
    ), 'sha256'), 'hex'
  );
$$;
grant execute on function pg_temp.s07_cutover_assert(boolean,text) to anon, authenticated;
grant execute on function pg_temp.s07_cutover_key(uuid,bigint,text) to anon, authenticated;

-- CREATE OR REPLACE kept the established raw signature private and retained the
-- fixed security-definer path/volatility required by the transactional writes.
select pg_temp.s07_cutover_assert(
  to_regprocedure('public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)') is not null,
  'raw create signature changed'
);
select pg_temp.s07_cutover_assert(
  (select prosecdef and provolatile='v' and
     proconfig @> array['search_path=pg_catalog, public, extensions']
   from pg_proc
   where oid='public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)'::regprocedure),
  'raw create security/path/volatility changed'
);
select pg_temp.s07_cutover_assert(
  not has_function_privilege(
    'anon',
    'public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)',
    'execute'
  ) and not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid='public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)'::regprocedure
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ),
  'raw create became an API function'
);

-- The committed pre-cutover command keeps v1 recover and exact replay semantics.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_token_hash text := encode(extensions.digest(
    's07:management:8c000000-0000-4000-8000-000000000231','sha256'
  ),'hex');
  v_appointment_id uuid;
  v_replayed_id uuid;
  v_recovered_id uuid;
  v_jobs bigint;
begin
  select appointment_id into v_appointment_id
  from public.public_booking_recoveries
  where recovery_id='8c000000-0000-4000-8000-000000000231';
  select count(*) into v_jobs
  from public.appointment_notification_jobs
  where appointment_id=v_appointment_id;

  select appointment_id into v_replayed_id
  from public.create_public_appointment_with_recovery(
    's07-cutover-salon','s07-cutover-v1-0001','S07 Cutover Existing',
    '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
    (v_day + time '12:00') at time zone 'Europe/Istanbul',
    v_token_hash,'8c000000-0000-4000-8000-000000000231',repeat('3',64),
    repeat('d',64),repeat('j',16),1::smallint,
    '+90 555 207 02 31','s07-cutover-existing@example.test',null
  );
  perform pg_temp.s07_cutover_assert(
    v_appointment_id is not null and v_replayed_id=v_appointment_id,
    'exact pre-cutover v1 command did not replay'
  );
  perform pg_temp.s07_cutover_assert(
    (select count(*) from public.booking_commands
     where business_id='4c000000-0000-4000-8000-000000000232'
       and idempotency_key='s07-cutover-v1-0001')=1
    and (select count(*) from public.appointment_notification_jobs
         where appointment_id=v_appointment_id)=v_jobs,
    'v1 replay duplicated command or outbox rows'
  );
  perform pg_temp.s07_cutover_assert(
    (select management_token_ciphertext=repeat('c',64)
     from public.public_booking_recoveries
     where recovery_id='8c000000-0000-4000-8000-000000000231'),
    'v1 replay replaced stable bootstrap material'
  );

  select appointment_id into v_recovered_id
  from public.recover_public_appointment(
    '8c000000-0000-4000-8000-000000000231','s07-cutover-v1-0001',repeat('3',64)
  );
  perform pg_temp.s07_cutover_assert(
    v_recovered_id=v_appointment_id,
    'v1 recovery changed at cutover'
  );

  begin
    perform public.create_public_appointment_with_recovery(
      's07-cutover-salon','s07-cutover-v1-0001','Changed legacy payload',
      '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
      (v_day + time '12:00') at time zone 'Europe/Istanbul',
      v_token_hash,'8c000000-0000-4000-8000-000000000231',repeat('3',64),
      repeat('c',64),repeat('i',16),1::smallint,
      '+90 555 207 02 31','s07-cutover-existing@example.test',null
    );
    raise exception 'changed legacy payload replayed';
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.create_public_appointment_with_recovery(
      's07-cutover-salon','s07-cutover-v1-0001','S07 Cutover Existing',
      '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
      (v_day + time '12:00') at time zone 'Europe/Istanbul',
      v_token_hash,'8c000000-0000-4000-8000-000000000231',repeat('f',64),
      repeat('c',64),repeat('i',16),1::smallint,
      '+90 555 207 02 31','s07-cutover-existing@example.test',null
    );
    raise exception 'changed legacy proof replayed';
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- V2 first-create, resolve and its existing command path remain unchanged.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_deadline bigint := floor(extract(epoch from clock_timestamp()))::bigint + 300;
  v_secret_hash text := repeat('4',64);
  v_key text := pg_temp.s07_cutover_key(
    '8c000000-0000-4000-8000-000000000233',v_deadline,v_secret_hash
  );
  v_appointment_id uuid;
  v_resolution record;
begin
  select appointment_id into v_appointment_id
  from public.create_public_appointment_with_recovery(
    's07-cutover-salon',v_key,'S07 Cutover V2',
    '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
    (v_day + time '13:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest(
      's07:management:8c000000-0000-4000-8000-000000000233','sha256'
    ),'hex'),
    '8c000000-0000-4000-8000-000000000233',v_secret_hash,
    repeat('v',64),repeat('w',16),1::smallint,
    '+90 555 207 02 33','s07-cutover-v2@example.test',null
  );
  perform pg_temp.s07_cutover_assert(v_appointment_id is not null,'v2 first-create was closed');
  select * into v_resolution
  from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000233',v_key,v_secret_hash
  );
  perform pg_temp.s07_cutover_assert(
    v_resolution.resolution='committed' and v_resolution.appointment_id=v_appointment_id,
    'v2 committed resolution changed at cutover'
  );
end
$$;

-- Seed malformed durable states explicitly. Neither state is allowed to become
-- a fresh legacy booking after the cutover.
insert into public.public_booking_recoveries(
  recovery_id,business_id,idempotency_key,management_token_hash,recovery_secret_hash,
  management_token_ciphertext,management_token_iv,key_version,expires_at
) values
(
  '8c000000-0000-4000-8000-000000000234','4c000000-0000-4000-8000-000000000232',
  's07-cutover-orphan-0001',
  encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000234','sha256'),'hex'),
  repeat('5',64),repeat('o',64),repeat('p',16),1,now()+interval '72 hours'
),
(
  '8c000000-0000-4000-8000-000000000235','4c000000-0000-4000-8000-000000000232',
  's07-cutover-incomplete-01',
  encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000235','sha256'),'hex'),
  repeat('6',64),repeat('q',64),repeat('r',16),1,now()+interval '72 hours'
);
insert into public.booking_commands(
  business_id,idempotency_key,command,request_hash,appointment_id,created_by,source
) values (
  '4c000000-0000-4000-8000-000000000232','s07-cutover-incomplete-01',
  'public_create','incomplete-cutover-command',null,null,'public'
);

create function public.s07_cutover_test_reject_bootstrap_insert()
returns trigger language plpgsql as $$
begin
  raise exception 'CUTOVER_BOOTSTRAP_INSERT_REACHED';
end
$$;
create trigger s07_reject_bootstrap_insert
before insert on public.public_booking_recoveries
for each row execute function public.s07_cutover_test_reject_bootstrap_insert();

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  begin
    perform public.create_public_appointment_with_recovery(
      's07-cutover-salon','s07-cutover-new-v1-0001','Blocked Legacy Create',
      '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
      (v_day + time '14:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest(
        's07:management:8c000000-0000-4000-8000-000000000236','sha256'
      ),'hex'),
      '8c000000-0000-4000-8000-000000000236',repeat('7',64),
      repeat('s',64),repeat('t',16),1::smallint,
      '+90 555 207 02 36','s07-cutover-new@example.test',null
    );
    raise exception 'new v1 first-create succeeded';
  exception when others then
    if position('BOOKING_CLIENT_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.create_public_appointment_with_recovery(
      's07-cutover-salon','s07-cutover-orphan-0001','Blocked Orphan Bootstrap',
      '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
      (v_day + time '15:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest(
        's07:management:8c000000-0000-4000-8000-000000000234','sha256'
      ),'hex'),
      '8c000000-0000-4000-8000-000000000234',repeat('5',64),
      repeat('o',64),repeat('p',16),1::smallint,
      '+90 555 207 02 34','s07-cutover-orphan@example.test',null
    );
    raise exception 'orphan bootstrap reopened v1 create';
  exception when others then
    if position('BOOKING_CLIENT_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.create_public_appointment_with_recovery(
      's07-cutover-salon','s07-cutover-incomplete-01','Blocked Incomplete Command',
      '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
      (v_day + time '16:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest(
        's07:management:8c000000-0000-4000-8000-000000000235','sha256'
      ),'hex'),
      '8c000000-0000-4000-8000-000000000235',repeat('6',64),
      repeat('q',64),repeat('r',16),1::smallint,
      '+90 555 207 02 35','s07-cutover-incomplete@example.test',null
    );
    raise exception 'incomplete legacy command reopened v1 create';
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

select pg_temp.s07_cutover_assert(
  not exists(select 1 from public.public_booking_recoveries
    where recovery_id='8c000000-0000-4000-8000-000000000236')
  and not exists(select 1 from public.booking_commands
    where business_id='4c000000-0000-4000-8000-000000000232'
      and idempotency_key='s07-cutover-new-v1-0001')
  and not exists(select 1 from public.customers
    where business_id='4c000000-0000-4000-8000-000000000232'
      and email in (
        's07-cutover-new@example.test','s07-cutover-orphan@example.test',
        's07-cutover-incomplete@example.test'
      )),
  'blocked v1 attempts left bootstrap, command or customer data'
);

-- The public wrapper may expose only the approved cutover code. Its normal rate
-- accounting remains intact and the raw function is still reached only internally.
insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values('default',encode(extensions.digest(repeat('g',43),'sha256'),'hex'))
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash;
delete from public.public_booking_rate_counters;
set local role anon;
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_result jsonb;
begin
  v_result := public.execute_public_operation('book',jsonb_build_object(
    'p_slug','s07-cutover-salon',
    'p_idempotency_key','s07-cutover-public-v1-01',
    'p_customer_name','Blocked Public Legacy',
    'p_service_id','6c000000-0000-4000-8000-000000000232',
    'p_staff_id','7c000000-0000-4000-8000-000000000232',
    'p_starts_at',(v_day + time '17:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest(
      's07:management:8c000000-0000-4000-8000-000000000237','sha256'
    ),'hex'),
    'p_recovery_id','8c000000-0000-4000-8000-000000000237',
    'p_recovery_secret_hash',repeat('8',64),
    'p_management_token_ciphertext',repeat('u',64),
    'p_management_token_iv',repeat('v',16),
    'p_key_version',1,
    'p_customer_phone',null,
    'p_customer_email','s07-cutover-public@example.test',
    'p_notes',null
  ),repeat('g',43),repeat('a',64),repeat('b',64));
  perform pg_temp.s07_cutover_assert(
    v_result->>'ok'='false'
      and v_result#>>'{error,message}'='BOOKING_CLIENT_UPDATE_REQUIRED',
    'public wrapper hid or changed the cutover error'
  );
end
$$;
reset role;

select pg_temp.s07_cutover_assert(
  not exists(select 1 from public.public_booking_recoveries
    where recovery_id='8c000000-0000-4000-8000-000000000237')
  and public.public_operation_error('private email=user@example.test token=secret')
      #>>'{error,message}'='PUBLIC_OPERATION_UNAVAILABLE',
  'public cutover leaked data or weakened unknown-error sanitization'
);

rollback;
