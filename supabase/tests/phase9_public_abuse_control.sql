begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','abuse-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000001','Abuse Test','abuse-test','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000001',
  'Abuse Hizmeti',30,0,0,180000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000001','4b000000-0000-4000-8000-000000000001','Abuse Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',
  '6b000000-0000-4000-8000-000000000001',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000001',
    '7b000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000001', true, 15, 0, 30
  );
end
$$;

reset role;
insert into public.public_booking_abuse_config(
  config_key,gate_secret_hash,
  read_window_seconds,read_actor_limit,read_network_limit,
  create_window_seconds,create_actor_limit,create_network_limit,create_business_limit,
  recover_window_seconds,recover_actor_limit,recover_network_limit
) values (
  'default',encode(digest('ggggggggggggggggggggggggggggggggggggggggggg','sha256'),'hex'),
  60,4,10,
  600,2,6,4,
  300,2,6
);

set local role anon;

-- Direct PostgREST entrypoints from earlier phases are no longer callable by anon.
do $$
begin
  begin
    perform * from public.get_public_booking_business('abuse-test');
    raise exception 'anon still executes raw public business RPC';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.create_public_appointment(
      'abuse-test','raw-create-denied','Raw Denied',
      '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',
      now()+interval '1 day','+90 555 000 00 01','raw@example.test',null
    );
    raise exception 'anon still executes raw public create RPC';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.create_public_appointment_with_recovery(
      'abuse-test','raw-recovery-denied','Raw Denied',
      '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',
      now()+interval '1 day',repeat('a',64),'8b000000-0000-4000-8000-000000000099',repeat('b',64),
      'ciphertext-raw-denied-abcdefghijklmnopqrstuvwxyz012345','iv-raw-denied-123',1::smallint,
      '+90 555 000 00 02','raw2@example.test',null
    );
    raise exception 'anon still executes raw recovery create RPC';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.recover_public_appointment(
      '8b000000-0000-4000-8000-000000000099','raw-recovery-denied',repeat('b',64)
    );
    raise exception 'anon still executes raw recovery lookup RPC';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- Guarded RPC cannot be used without the Worker-held server proof.
do $$
begin
  begin
    perform * from public.get_public_booking_business_guarded(
      'abuse-test','wrong-secret-value-that-is-long-enough-000000000000000',repeat('1',64),repeat('2',64)
    );
    raise exception 'wrong gate secret reached public RPC';
  exception when others then
    if sqlerrm = 'wrong gate secret reached public RPC' then raise; end if;
    if position('PUBLIC_BOOKING_GATE_UNAVAILABLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Read limits are actor + network based. Four reads fit; the fifth is rejected.
do $$
declare
  i integer;
begin
  for i in 1..4 loop
    perform * from public.get_public_booking_business_guarded(
      'abuse-test','ggggggggggggggggggggggggggggggggggggggggggg',repeat('1',64),repeat('f',64)
    );
  end loop;
  begin
    perform * from public.get_public_booking_business_guarded(
      'abuse-test','ggggggggggggggggggggggggggggggggggggggggggg',repeat('1',64),repeat('f',64)
    );
    raise exception 'read actor limit did not reject fifth request';
  exception when others then
    if sqlerrm = 'read actor limit did not reject fifth request' then raise; end if;
    if position('PUBLIC_BOOKING_RATE_LIMITED:' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;
delete from public.public_booking_rate_counters;
set local role anon;

-- New booking intents: actor A gets two; third is rejected. A safe retry of the
-- first completed booking bypasses the exhausted create budget and returns the
-- same appointment. Actor B on the same network can still book.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_start1 timestamptz := (v_day + time '10:00') at time zone 'Europe/Istanbul';
  v_start2 timestamptz := (v_day + time '11:00') at time zone 'Europe/Istanbul';
  v_start3 timestamptz := (v_day + time '12:00') at time zone 'Europe/Istanbul';
  v_start4 timestamptz := (v_day + time '13:00') at time zone 'Europe/Istanbul';
  v_start5 timestamptz := (v_day + time '14:00') at time zone 'Europe/Istanbul';
  v_start6 timestamptz := (v_day + time '15:00') at time zone 'Europe/Istanbul';
  v_first uuid;
  v_retry uuid;
begin
  select appointment_id into v_first
  from public.create_public_appointment_with_recovery_guarded(
    'abuse-test','abuse-create-0001','Actor A One',
    '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start1,
    repeat('a',64),'8b000000-0000-4000-8000-000000000001',repeat('b',64),
    'ciphertext-abuse-one-abcdefghijklmnopqrstuvwxyz012345','iv-abuse-one-1234',1::smallint,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('a',64),repeat('f',64),
    '+90 555 901 00 01','a1@example.test',null
  );
  if v_first is null then raise exception 'first guarded booking missing'; end if;

  perform * from public.create_public_appointment_with_recovery_guarded(
    'abuse-test','abuse-create-0002','Actor A Two',
    '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start2,
    repeat('c',64),'8b000000-0000-4000-8000-000000000002',repeat('d',64),
    'ciphertext-abuse-two-abcdefghijklmnopqrstuvwxyz012345','iv-abuse-two-1234',1::smallint,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('a',64),repeat('f',64),
    '+90 555 901 00 02','a2@example.test',null
  );

  begin
    perform * from public.create_public_appointment_with_recovery_guarded(
      'abuse-test','abuse-create-0003','Actor A Three',
      '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start3,
      repeat('e',64),'8b000000-0000-4000-8000-000000000003',repeat('1',64),
      'ciphertext-abuse-three-abcdefghijklmnopqrstuvwxyz0123','iv-abuse-three-12',1::smallint,
      'ggggggggggggggggggggggggggggggggggggggggggg',repeat('a',64),repeat('f',64),
      '+90 555 901 00 03','a3@example.test',null
    );
    raise exception 'actor create limit did not reject third new intent';
  exception when others then
    if sqlerrm = 'actor create limit did not reject third new intent' then raise; end if;
    if position('PUBLIC_BOOKING_RATE_LIMITED:' in sqlerrm)=0 then raise; end if;
  end;

  select appointment_id into v_retry
  from public.create_public_appointment_with_recovery_guarded(
    'abuse-test','abuse-create-0001','Actor A One',
    '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start1,
    repeat('a',64),'8b000000-0000-4000-8000-000000000001',repeat('b',64),
    'ciphertext-abuse-retry-different-abcdefghijklmnopqrstuvwxyz','iv-abuse-retry-1',1::smallint,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('a',64),repeat('f',64),
    '+90 555 901 00 01','a1@example.test',null
  );
  if v_retry <> v_first then raise exception 'safe retry did not return original appointment'; end if;

  perform * from public.create_public_appointment_with_recovery_guarded(
    'abuse-test','abuse-create-0004','Actor B Shared Network',
    '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start4,
    repeat('2',64),'8b000000-0000-4000-8000-000000000004',repeat('3',64),
    'ciphertext-abuse-four-abcdefghijklmnopqrstuvwxyz01234','iv-abuse-four-123',1::smallint,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('b',64),repeat('f',64),
    '+90 555 901 00 04','b1@example.test',null
  );

  perform * from public.create_public_appointment_with_recovery_guarded(
    'abuse-test','abuse-create-0005','Actor C Other Network',
    '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start5,
    repeat('4',64),'8b000000-0000-4000-8000-000000000005',repeat('5',64),
    'ciphertext-abuse-five-abcdefghijklmnopqrstuvwxyz01234','iv-abuse-five-123',1::smallint,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('c',64),repeat('e',64),
    '+90 555 901 00 05','c1@example.test',null
  );

  begin
    perform * from public.create_public_appointment_with_recovery_guarded(
      'abuse-test','abuse-create-0006','Actor D Distributed Fill',
      '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start6,
      repeat('6',64),'8b000000-0000-4000-8000-000000000006',repeat('7',64),
      'ciphertext-abuse-six-abcdefghijklmnopqrstuvwxyz012345','iv-abuse-six-1234',1::smallint,
      'ggggggggggggggggggggggggggggggggggggggggggg',repeat('d',64),repeat('9',64),
      '+90 555 901 00 06','d1@example.test',null
    );
    raise exception 'business create limit did not reject distributed fill';
  exception when others then
    if sqlerrm = 'business create limit did not reject distributed fill' then raise; end if;
    if position('PUBLIC_BOOKING_RATE_LIMITED:' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Recovery attempts are separately bounded.
do $$
declare
  v_secret_hash text := repeat('b',64);
begin
  if (select count(*) from public.recover_public_appointment_guarded(
    '8b000000-0000-4000-8000-000000000001','abuse-create-0001',v_secret_hash,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('8',64),repeat('7',64)
  )) <> 1 then raise exception 'first guarded recovery failed'; end if;
  if (select count(*) from public.recover_public_appointment_guarded(
    '8b000000-0000-4000-8000-000000000001','abuse-create-0001',v_secret_hash,
    'ggggggggggggggggggggggggggggggggggggggggggg',repeat('8',64),repeat('7',64)
  )) <> 1 then raise exception 'second guarded recovery failed'; end if;
  begin
    perform * from public.recover_public_appointment_guarded(
      '8b000000-0000-4000-8000-000000000001','abuse-create-0001',v_secret_hash,
      'ggggggggggggggggggggggggggggggggggggggggggg',repeat('8',64),repeat('7',64)
    );
    raise exception 'recovery actor limit did not reject third attempt';
  exception when others then
    if sqlerrm = 'recovery actor limit did not reject third attempt' then raise; end if;
    if position('PUBLIC_BOOKING_RATE_LIMITED:' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;
-- Counter storage contains derived hashes only; no raw proof/network material.
do $$
begin
  if exists (
    select 1 from public.public_booking_rate_counters
    where key_hash !~ '^[0-9a-f]{64}$'
  ) then raise exception 'rate counter stored non-hash key material'; end if;

  if (select count(*) from public.public_booking_rate_counters
      where action='create' and dimension='actor' and key_hash=repeat('a',64)) <> 1 then
    raise exception 'actor A counter missing';
  end if;
  if (select count from public.public_booking_rate_counters
      where action='create' and dimension='actor' and key_hash=repeat('a',64)) <> 2 then
    raise exception 'safe retry consumed create actor budget';
  end if;
  if (select count from public.public_booking_rate_counters
      where action='create' and dimension='network' and key_hash=repeat('f',64)) <> 3 then
    raise exception 'shared-network counter did not preserve independent actors';
  end if;
end
$$;

delete from public.public_booking_rate_counters;

-- Existing product validation stays authoritative behind the gate.
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);
select public.update_public_booking_settings(
  '4b000000-0000-4000-8000-000000000001', false, 15, 0, 30
);
select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_start timestamptz := (v_day + time '16:00') at time zone 'Europe/Istanbul';
begin
  if (select count(*) from public.get_public_booking_business_guarded(
    'abuse-test','ggggggggggggggggggggggggggggggggggggggggggg',repeat('a',64),repeat('b',64)
  )) <> 0 then raise exception 'disabled business remained publicly visible'; end if;

  begin
    perform * from public.create_public_appointment_with_recovery_guarded(
      'abuse-test','abuse-disabled-0001','Disabled Test',
      '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000001',v_start,
      repeat('1',64),'8b000000-0000-4000-8000-000000000011',repeat('2',64),
      'ciphertext-disabled-abcdefghijklmnopqrstuvwxyz012345','iv-disabled-1234',1::smallint,
      'ggggggggggggggggggggggggggggggggggggggggggg',repeat('c',64),repeat('d',64),
      '+90 555 901 00 11','disabled@example.test',null
    );
    raise exception 'disabled business accepted booking';
  exception when others then
    if sqlerrm = 'disabled business accepted booking' then raise; end if;
    if position('PUBLIC_BOOKING_DISABLED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);
select public.update_public_booking_settings(
  '4b000000-0000-4000-8000-000000000001', true, 15, 0, 30
);
select set_config('request.jwt.claim.sub','',true);
reset role;
delete from public.public_booking_rate_counters;
set local role anon;

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_start timestamptz := (v_day + time '16:00') at time zone 'Europe/Istanbul';
begin
  begin
    perform * from public.create_public_appointment_with_recovery_guarded(
      'abuse-test','abuse-invalid-service','Invalid Service',
      '6b000000-0000-4000-8000-000000000099','7b000000-0000-4000-8000-000000000001',v_start,
      repeat('3',64),'8b000000-0000-4000-8000-000000000012',repeat('4',64),
      'ciphertext-invalid-service-abcdefghijklmnopqrstuvwxyz0','iv-invalid-svc-12',1::smallint,
      'ggggggggggggggggggggggggggggggggggggggggggg',repeat('e',64),repeat('f',64),
      '+90 555 901 00 12','invalid-service@example.test',null
    );
    raise exception 'invalid service accepted booking';
  exception when others then
    if sqlerrm = 'invalid service accepted booking' then raise; end if;
    if position('SERVICE_NOT_FOUND' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform * from public.create_public_appointment_with_recovery_guarded(
      'abuse-test','abuse-invalid-staff','Invalid Staff',
      '6b000000-0000-4000-8000-000000000001','7b000000-0000-4000-8000-000000000099',v_start,
      repeat('5',64),'8b000000-0000-4000-8000-000000000013',repeat('6',64),
      'ciphertext-invalid-staff-abcdefghijklmnopqrstuvwxyz01','iv-invalid-stf-12',1::smallint,
      'ggggggggggggggggggggggggggggggggggggggggggg',repeat('1',64),repeat('2',64),
      '+90 555 901 00 13','invalid-staff@example.test',null
    );
    raise exception 'invalid staff accepted booking';
  exception when others then
    if sqlerrm = 'invalid staff accepted booking' then raise; end if;
    if position('STAFF_NOT_ELIGIBLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Missing provisioning fails closed.
reset role;
delete from public.public_booking_abuse_config where config_key='default';
set local role anon;
do $$
begin
  begin
    perform * from public.get_public_booking_business_guarded(
      'abuse-test','ggggggggggggggggggggggggggggggggggggggggggg',repeat('1',64),repeat('2',64)
    );
    raise exception 'missing gate config did not fail closed';
  exception when others then
    if sqlerrm = 'missing gate config did not fail closed' then raise; end if;
    if position('PUBLIC_BOOKING_GATE_UNAVAILABLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

rollback;
