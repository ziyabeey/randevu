begin;

create function pg_temp.s07_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'S07: %', p_message; end if;
end
$$;

create function pg_temp.s07_key(p_recovery_id uuid, p_deadline bigint, p_secret_hash text)
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
grant execute on function pg_temp.s07_assert(boolean,text) to anon, authenticated;
grant execute on function pg_temp.s07_key(uuid,bigint,text) to anon, authenticated;

select pg_temp.s07_assert(
  public.public_booking_v2_key_matches(
    'pub2_1790000000_b8b99f15340658f0c76387b36c46931170676b2964e9dde9314cb1be613f5f81',
    '8c000000-0000-4000-8000-000000000207',
    '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a'
  ),
  'fixed Worker/PG key vector mismatch'
);
select pg_temp.s07_assert(
  not public.public_booking_v2_key_matches(
    'pub2_1790000000_b8b99f15340658f0c76387b36c46931170676b2964e9dde9314cb1be613f5f80',
    '8c000000-0000-4000-8000-000000000207',
    '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a'
  ),
  'wrong key binding accepted'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '19000000-0000-4000-8000-000000000217','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s07-owner@example.test','',now(),'{}','{}',now(),now()
) on conflict(id) do nothing;
insert into public.businesses(id,name,slug,timezone,created_by) values (
  '4c000000-0000-4000-8000-000000000217','S07 Resolution Salon','s07-resolution-salon',
  'Europe/Istanbul','19000000-0000-4000-8000-000000000217'
) on conflict(id) do nothing;
insert into public.memberships(id,business_id,user_id,role,active) values (
  '5c000000-0000-4000-8000-000000000217','4c000000-0000-4000-8000-000000000217',
  '19000000-0000-4000-8000-000000000217','owner',true
) on conflict(business_id,user_id) do update set active=true,role=excluded.role;
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
) values (
  '6c000000-0000-4000-8000-000000000217','4c000000-0000-4000-8000-000000000217',
  'S07 Service',30,0,0,21700,'TRY'
) on conflict(id) do nothing;
insert into public.staff_profiles(id,business_id,name) values (
  '7c000000-0000-4000-8000-000000000217','4c000000-0000-4000-8000-000000000217','S07 Staff'
) on conflict(id) do nothing;
insert into public.staff_services(business_id,staff_id,service_id,active) values (
  '4c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
  '6c000000-0000-4000-8000-000000000217',true
) on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000217',true);
do $$ declare v_day date:=date_trunc('week',current_date)::date+7; begin
  perform public.replace_business_hours(
    '4c000000-0000-4000-8000-000000000217',extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
    extract(dow from v_day)::smallint,'[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4c000000-0000-4000-8000-000000000217',true,15,0,30
  );
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);

-- A v2 commit retains its authority after the legacy proof hash is scrubbed.
do $$
declare
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_hash text:='0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a';
  v_key text;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_created uuid;
  v_replayed uuid;
  v_resolution record;
  v_jobs bigint;
begin
  v_key:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000217',v_deadline,v_hash);
  select appointment_id into v_created from public.create_public_appointment_with_recovery(
    's07-resolution-salon',v_key,'S07 Committed',
    '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000217','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000217',v_hash,
    repeat('c',64),repeat('i',16),1::smallint,
    '+90 555 217 00 01','s07-committed@example.test',null
  );
  select count(*) into v_jobs from public.appointment_notification_jobs where appointment_id=v_created;
  select appointment_id into v_replayed from public.create_public_appointment_with_recovery(
    's07-resolution-salon',v_key,'S07 Committed',
    '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000217','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000217',v_hash,
    repeat('c',64),repeat('i',16),1::smallint,
    '+90 555 217 00 01','s07-committed@example.test',null
  );
  perform pg_temp.s07_assert(v_created=v_replayed,'exact v2 replay changed appointment');
  perform pg_temp.s07_assert(
    (select count(*) from public.appointment_notification_jobs where appointment_id=v_created)=v_jobs,
    'exact v2 replay duplicated outbox'
  );
  begin
    perform public.create_public_appointment_with_recovery(
      's07-resolution-salon',v_key,'S07 Changed Payload',
      '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
      (v_day+time '10:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000217','sha256'),'hex'),
      '8c000000-0000-4000-8000-000000000217',v_hash,
      repeat('c',64),repeat('i',16),1::smallint,
      '+90 555 217 00 01','s07-committed@example.test',null
    );
    raise exception 'changed v2 payload unexpectedly replayed';
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.create_public_appointment_with_recovery(
      's07-resolution-salon',v_key,'S07 Committed',
      '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
      (v_day+time '10:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest('s07:management-conflict:8c000000-0000-4000-8000-000000000217','sha256'),'hex'),
      '8c000000-0000-4000-8000-000000000217',v_hash,
      repeat('c',64),repeat('i',16),1::smallint,
      '+90 555 217 00 01','s07-committed@example.test',null
    );
    raise exception 'changed v2 bootstrap unexpectedly replayed';
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
  update public.public_booking_recoveries set recovery_secret_hash=null
  where recovery_id='8c000000-0000-4000-8000-000000000217';
  select * into v_resolution from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000217',v_key,v_hash
  );
  perform pg_temp.s07_assert(v_resolution.resolution='committed','scrubbed hash lost committed authority');
  perform pg_temp.s07_assert(v_resolution.appointment_id=v_created,'committed resolve changed appointment');
end $$;

do $$
declare
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_hash text:=repeat('9',64);
  v_key text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000216',v_deadline,v_hash);
begin
  begin
    perform public.create_public_appointment_with_recovery(
      's07-resolution-salon',upper(v_key),'Must Not Downgrade',
      '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
      ((date_trunc('week',current_date)::date+7)+time '09:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000216','sha256'),'hex'),
      '8c000000-0000-4000-8000-000000000216',v_hash,
      repeat('z',64),repeat('v',16),1::smallint,null,'downgrade@example.test',null
    );
    raise exception 'malformed pub2 namespace downgraded to v1';
  exception when others then
    if position('INVALID_BOOKING_RECOVERY_BOOTSTRAP' in sqlerrm)=0 then raise; end if;
  end;
  perform pg_temp.s07_assert(not exists(select 1 from public.public_booking_recoveries
    where recovery_id='8c000000-0000-4000-8000-000000000216'),'malformed pub2 wrote bootstrap');
end $$;

-- Expired/missing material and revoked capabilities prove existence without PII.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_past_deadline bigint;
  v_hash text:=repeat('a',64);
  v_key text;
  v_past_key text;
  v_id uuid;
  v_result record;
begin
  v_key:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000218',v_deadline,v_hash);
  select appointment_id into v_id from public.create_public_appointment_with_recovery(
    's07-resolution-salon',v_key,'S07 Scrubbed',
    '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
    (v_day+time '11:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000218','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000218',v_hash,
    repeat('d',64),repeat('j',16),1::smallint,null,'scrubbed@example.test',null
  );
  -- Simulate resolving this known commit after its signed submission deadline.
  -- Both authoritative ledgers must remain bound to the same canonical past key.
  v_past_deadline:=floor(extract(epoch from clock_timestamp()))::bigint-1;
  v_past_key:=pg_temp.s07_key(
    '8c000000-0000-4000-8000-000000000218',v_past_deadline,v_hash
  );
  update public.booking_commands set idempotency_key=v_past_key
  where idempotency_key=v_key and appointment_id=v_id
    and command='public_create' and source='public';
  update public.public_booking_recoveries
  set idempotency_key=v_past_key,recovery_secret_hash=null,management_token_ciphertext=null,
      management_token_iv=null,expires_at=now()-interval '1 second'
  where recovery_id='8c000000-0000-4000-8000-000000000218';
  perform pg_temp.s07_assert((select count(*)=1 from public.booking_commands
    where idempotency_key=v_past_key and appointment_id=v_id
      and command='public_create' and source='public'),
    'past committed key was not rebound in booking command authority');
  select * into v_result from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000218',v_past_key,v_hash
  );
  perform pg_temp.s07_assert(v_result.resolution='exists_nolink','past expired commit reported absent');
  perform pg_temp.s07_assert(v_result.appointment_id is null and v_result.business_name is null
    and v_result.management_token_ciphertext is null,'exists_nolink leaked commit data');
  perform pg_temp.s07_assert(not exists(select 1 from public.public_booking_resolution_closures
    where idempotency_key=v_past_key),'past committed proof wrote an absent closure');

  v_hash:=repeat('b',64);
  v_key:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000219',v_deadline,v_hash);
  select appointment_id into v_id from public.create_public_appointment_with_recovery(
    's07-resolution-salon',v_key,'S07 Revoked',
    '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000219','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000219',v_hash,
    repeat('e',64),repeat('k',16),1::smallint,null,'revoked@example.test',null
  );
  update public.appointment_management_capabilities set revoked_at=clock_timestamp()
  where appointment_id=v_id;
  select * into v_result from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000219',v_key,v_hash
  );
  perform pg_temp.s07_assert(v_result.resolution='exists_nolink','revoked capability returned committed link');
  perform pg_temp.s07_assert(v_result.appointment_id is null and v_result.business_name is null
    and v_result.management_token_ciphertext is null,'revoked exists_nolink leaked data');
end $$;

-- A future absent intent is fenced and repeatable; a past intent is terminal
-- without retaining a fence. The closed create produces no domain side effects.
do $$
declare
  v_future bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_past bigint:=floor(extract(epoch from clock_timestamp()))::bigint-1;
  v_hash text:=repeat('c',64);
  v_key text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000220',v_future,v_hash);
  v_past_key text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000221',v_past,repeat('d',64));
  v_result record;
  v_customers bigint;
begin
  select * into v_result from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000220',v_key,v_hash
  );
  perform pg_temp.s07_assert(v_result.resolution='closed_absent','future absence not closed');
  perform pg_temp.s07_assert((select count(*)=1 from public.public_booking_resolution_closures
    where idempotency_key=v_key and recovery_id='8c000000-0000-4000-8000-000000000220'
      and submit_deadline=v_future),'exact closure missing');
  select * into v_result from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000220',v_key,v_hash
  );
  perform pg_temp.s07_assert(v_result.resolution='closed_absent','closure retry changed result');

  select count(*) into v_customers from public.customers where business_id='4c000000-0000-4000-8000-000000000217';
  begin
    perform public.create_public_appointment_with_recovery(
      's07-resolution-salon',v_key,'Must Not Exist',
      '6c000000-0000-4000-8000-000000000217','7c000000-0000-4000-8000-000000000217',
      ((date_trunc('week',current_date)::date+7)+time '13:00') at time zone 'Europe/Istanbul',
      encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000220','sha256'),'hex'),
      '8c000000-0000-4000-8000-000000000220',v_hash,
      repeat('f',64),repeat('l',16),1::smallint,null,'closed@example.test',null
    );
    raise exception 'closed v2 create unexpectedly succeeded';
  exception when others then
    if position('BOOKING_INTENT_CLOSED' in sqlerrm)=0 then raise; end if;
  end;
  perform pg_temp.s07_assert((select count(*) from public.customers
    where business_id='4c000000-0000-4000-8000-000000000217')=v_customers,
    'closed create wrote customer data');
  perform pg_temp.s07_assert(not exists(select 1 from public.public_booking_recoveries
    where recovery_id='8c000000-0000-4000-8000-000000000220'),'closed create wrote bootstrap');

  select * into v_result from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000221',v_past_key,repeat('d',64)
  );
  perform pg_temp.s07_assert(v_result.resolution='closed_absent','past absence not terminal');
  perform pg_temp.s07_assert(not exists(select 1 from public.public_booking_resolution_closures
    where idempotency_key=v_past_key),'past absence retained unnecessary fence');
end $$;

-- Malformed, wrong-bound, excessive-future and conflicting evidence is generic
-- (zero rows) and never allocates a closure.
do $$
declare
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_far bigint:=floor(extract(epoch from clock_timestamp()))::bigint+600;
  v_key text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000222',v_deadline,repeat('e',64));
  v_conflict text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000223',v_deadline,repeat('f',64));
  v_orphan text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000225',v_deadline,repeat('1',64));
begin
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000222',v_key,repeat('0',64))),'wrong proof became terminal');
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8C000000-0000-4000-8000-000000000222',v_key,repeat('e',64))),'uppercase UUID accepted');
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000222',upper(v_key),repeat('e',64))),'uppercase key accepted');
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000222',v_key||chr(10),repeat('e',64))),'LF key alias accepted');
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000222',
    pg_temp.s07_key('8c000000-0000-4000-8000-000000000222',v_far,repeat('e',64)),repeat('e',64)
  )),'excessive future key became terminal');

  insert into public.public_booking_resolution_closures(idempotency_key,recovery_id,submit_deadline)
  values(v_conflict,'8c000000-0000-4000-8000-000000000224',v_deadline);
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000223',v_conflict,repeat('f',64))),'conflicting fence became terminal');

  insert into public.booking_commands(
    business_id,idempotency_key,command,request_hash,appointment_id,created_by,source
  ) values (
    '4c000000-0000-4000-8000-000000000217',v_orphan,'public_create','s07-orphan',null,null,'public'
  );
  perform pg_temp.s07_assert((select count(*)=0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000225',v_orphan,repeat('1',64))),'orphan command became terminal');
  perform pg_temp.s07_assert(not exists(select 1 from public.public_booking_resolution_closures
    where recovery_id in (
      '8c000000-0000-4000-8000-000000000222',
      '8c000000-0000-4000-8000-000000000223',
      '8c000000-0000-4000-8000-000000000225'
    )),'invalid evidence wrote a closure');
end $$;

-- Resolve travels through the same gate and recovery budget as v1 recovery.
delete from public.public_booking_rate_counters;
insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values('default',encode(extensions.digest(repeat('g',43),'sha256'),'hex'))
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash;
set local role anon;
do $$
declare
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_hash text:=repeat('2',64);
  v_key text:=pg_temp.s07_key('8c000000-0000-4000-8000-000000000226',v_deadline,v_hash);
  v_result jsonb;
begin
  v_result:=public.execute_public_operation('resolve',jsonb_build_object(
    'p_recovery_id','8c000000-0000-4000-8000-000000000226',
    'p_idempotency_key',v_key,'p_recovery_secret_hash',v_hash
  ),repeat('g',43),repeat('a',64),repeat('b',64));
  perform pg_temp.s07_assert(v_result->>'ok'='true'
    and v_result#>>'{data,0,resolution}'='closed_absent','gated resolve failed');
end $$;
reset role;
select pg_temp.s07_assert((select count=1 from public.public_booking_rate_counters
  where action='recover' and dimension='actor' and key_hash=repeat('a',64)),
  'resolve bypassed recover quota');

-- Prune is bounded, ordered, skips fresh closures and is reached by existing maintenance.
insert into public.public_booking_resolution_closures(idempotency_key,recovery_id,submit_deadline)
select 'pub2_'||(1000000000+i)::text||'_'||lpad(to_hex(i),64,'0'),
       ('8d000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
       1000000000+i
from generate_series(1,501) i;
select pg_temp.s07_assert(public.prune_public_booking_resolution_closures()=500,'prune batch is not 500');
select pg_temp.s07_assert((select count(*)=1 from public.public_booking_resolution_closures
  where submit_deadline between 1000000001 and 1000000501),'prune did not leave exactly one stale row');
select pg_temp.s07_assert((select min(submit_deadline)=1000000501 from public.public_booking_resolution_closures
  where submit_deadline between 1000000001 and 1000000501),'prune order is unstable');
insert into public.notification_dispatch_config(config_key,secret_hash)
values('default',encode(extensions.digest(repeat('s',43),'sha256'),'hex'))
on conflict(config_key) do update set secret_hash=excluded.secret_hash;
set local role anon;
select * from public.maintain_notification_jobs(repeat('s',43));
reset role;
select pg_temp.s07_assert(not exists(select 1 from public.public_booking_resolution_closures
  where submit_deadline between 1000000001 and 1000000501),'maintenance did not connect closure prune');

-- Exact schema/volatility/search-path and API role inventory.
select pg_temp.s07_assert((select array_agg(column_name::text order by ordinal_position)=array[
  'idempotency_key','recovery_id','submit_deadline','closed_at'
] from information_schema.columns where table_schema='public'
  and table_name='public_booking_resolution_closures'),'closure contains unexpected columns');
select pg_temp.s07_assert((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='public.public_booking_resolution_closures'::regclass),'closure RLS is not forced');
select pg_temp.s07_assert(not exists(
    select 1 from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    where c.oid='public.public_booking_resolution_closures'::regclass
      and acl.grantee=0 and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) and not has_table_privilege('anon','public.public_booking_resolution_closures','select')
  and not has_table_privilege('authenticated','public.public_booking_resolution_closures','select')
  and not exists(
    select 1
    from (values('anon'),('authenticated')) api_role(role_name)
    cross join (values('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) mutation(privilege_name)
    where has_table_privilege(
      api_role.role_name,'public.public_booking_resolution_closures',mutation.privilege_name
    )
  ),
  'closure table exposed');
do $$ declare r record; begin
  for r in select * from (values
    ('public.public_booking_v2_key_matches(text,uuid,text)','i',false),
    ('public.resolve_public_booking_intent_v2(text,text,text)','v',false),
    ('public.prune_public_booking_resolution_closures()','v',false),
    ('public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)','v',false),
    ('public.execute_public_operation(text,jsonb,text,text,text)','v',true),
    ('public.maintain_notification_jobs(text)','v',true)
  ) as expected(signature,volatility,anon_allowed)
  loop
    perform pg_temp.s07_assert(to_regprocedure(r.signature) is not null,'missing function '||r.signature);
    perform pg_temp.s07_assert((select provolatile=r.volatility::"char" from pg_proc
      where oid=to_regprocedure(r.signature)),'wrong volatility '||r.signature);
    perform pg_temp.s07_assert(has_function_privilege('anon',r.signature,'execute')=r.anon_allowed,
      'wrong anon ACL '||r.signature);
    perform pg_temp.s07_assert(not has_function_privilege('authenticated',r.signature,'execute'),
      'authenticated RPC exposure '||r.signature);
    perform pg_temp.s07_assert(not exists(
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=to_regprocedure(r.signature) and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ),'PUBLIC execute exposure '||r.signature);
  end loop;
end $$;

rollback;
