create extension if not exists dblink;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '19000000-0000-4000-8000-000000000227','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s07-race-owner@example.test','',now(),'{}','{}',now(),now()
) on conflict(id) do nothing;
insert into public.businesses(id,name,slug,timezone,created_by) values (
  '4c000000-0000-4000-8000-000000000227','S07 Race Salon','s07-race-salon',
  'Europe/Istanbul','19000000-0000-4000-8000-000000000227'
) on conflict(id) do nothing;
insert into public.memberships(id,business_id,user_id,role,active) values (
  '5c000000-0000-4000-8000-000000000227','4c000000-0000-4000-8000-000000000227',
  '19000000-0000-4000-8000-000000000227','owner',true
) on conflict(business_id,user_id) do update set active=true,role=excluded.role;
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
) values (
  '6c000000-0000-4000-8000-000000000227','4c000000-0000-4000-8000-000000000227',
  'S07 Race Service',30,0,0,22700,'TRY'
) on conflict(id) do nothing;
insert into public.staff_profiles(id,business_id,name) values (
  '7c000000-0000-4000-8000-000000000227','4c000000-0000-4000-8000-000000000227','S07 Race Staff'
) on conflict(id) do nothing;
insert into public.staff_services(business_id,staff_id,service_id,active) values (
  '4c000000-0000-4000-8000-000000000227','7c000000-0000-4000-8000-000000000227',
  '6c000000-0000-4000-8000-000000000227',true
) on conflict(business_id,staff_id,service_id) do update set active=true;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000227',true);
do $$ declare v_day date:=date_trunc('week',current_date)::date+7; begin
  perform public.replace_business_hours(
    '4c000000-0000-4000-8000-000000000227',extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4c000000-0000-4000-8000-000000000227','7c000000-0000-4000-8000-000000000227',
    extract(dow from v_day)::smallint,'[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4c000000-0000-4000-8000-000000000227',true,15,0,30
  );
end $$;
commit;

create function public._s07_race_key(p_recovery_id uuid,p_deadline bigint,p_hash text)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_hash,'UTF8'),'sha256'),'hex');
$$;

create function public._s07_race_create(
  p_recovery_id uuid,p_deadline bigint,p_hash text,p_hour integer,p_name text default 'S07 Race'
) returns uuid language plpgsql set search_path=pg_catalog,public,extensions as $$
declare v_id uuid; v_key text:=public._s07_race_key(p_recovery_id,p_deadline,p_hash);
begin
  select appointment_id into v_id from public.create_public_appointment_with_recovery(
    's07-race-salon',v_key,p_name,
    '6c000000-0000-4000-8000-000000000227','7c000000-0000-4000-8000-000000000227',
    ((date_trunc('week',current_date)::date+7)+time '09:00'+make_interval(hours=>p_hour)) at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:race:management:'||p_recovery_id::text,'sha256'),'hex'),
    p_recovery_id,p_hash,repeat('c',64),repeat('i',16),1::smallint,
    null,lower(substr(p_recovery_id::text,1,8))||'@example.test',null
  );
  return v_id;
end $$;

create function public._s07_race_create_result(
  p_recovery_id uuid,p_deadline bigint,p_hash text,p_hour integer,p_name text default 'S07 Race'
) returns text language plpgsql set search_path=pg_catalog,public as $$
begin
  begin
    perform public._s07_race_create(p_recovery_id,p_deadline,p_hash,p_hour,p_name);
    return 'created';
  exception when others then return sqlerrm;
  end;
end $$;

create function public._s07_prelocked_create_result(
  p_gate bigint,p_recovery_id uuid,p_deadline bigint,p_hash text,p_hour integer
) returns text language plpgsql set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(p_gate);
  return public._s07_race_create_result(p_recovery_id,p_deadline,p_hash,p_hour,'S07 Prelock');
end $$;

-- Create holds the recovery lock until commit. A resolver on another connection
-- must wait and then observe the committed appointment, never write a closure.
do $$
declare
  v_id uuid:='8c000000-0000-4000-8000-000000000227';
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_hash text:=repeat('a',64);
  v_created uuid;
  v_resolution text;
  v_waited boolean:=false;
begin
  perform dblink_connect('s07_create','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_create');
  perform dblink_connect('s07_resolve','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_resolve');
  perform dblink_exec('s07_create','set statement_timeout=5000');
  perform dblink_exec('s07_resolve','set statement_timeout=5000');
  perform dblink_exec('s07_create','begin');
  select id into v_created from dblink('s07_create',format(
    'select public._s07_race_create(%L::uuid,%s,%L,1)',v_id,v_deadline,v_hash
  )) as t(id uuid);
  perform dblink_send_query('s07_resolve',format(
    'select resolution from public.resolve_public_booking_intent_v2(%L,%L,%L)',
    v_id,public._s07_race_key(v_id,v_deadline,v_hash),v_hash
  ));
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='s07_resolve' and wait_event_type='Lock') then
      v_waited:=true; exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_waited then raise exception 'S07 create-first resolver never waited on recovery lock'; end if;
  perform dblink_exec('s07_create','commit');
  select resolution into v_resolution from dblink_get_result('s07_resolve') as t(resolution text);
  if v_created is null or v_resolution is distinct from 'committed' then
    raise exception 'S07 create-first result mismatch: %, %',v_created,v_resolution;
  end if;
  if exists(select 1 from public.public_booking_resolution_closures where recovery_id=v_id) then
    raise exception 'S07 create-first resolver wrote closure';
  end if;
  perform dblink_disconnect('s07_create'); perform dblink_disconnect('s07_resolve');
exception when others then
  begin perform dblink_disconnect('s07_create'); exception when others then null; end;
  begin perform dblink_disconnect('s07_resolve'); exception when others then null; end;
  raise;
end $$;

-- A create delayed before the recovery lock loses to resolve. Once released it
-- reads the durable fence before any bootstrap/customer/appointment/outbox write.
do $$
declare
  v_gate bigint:=7207001;
  v_id uuid:='8c000000-0000-4000-8000-000000000228';
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_hash text:=repeat('b',64);
  v_result text;
  v_resolution text;
  v_waited boolean:=false;
begin
  perform dblink_connect('s07_gate','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_gate');
  perform dblink_connect('s07_precreate','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_precreate');
  perform dblink_connect('s07_preresolve','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_preresolve');
  perform dblink_exec('s07_gate','set statement_timeout=7000');
  perform dblink_exec('s07_precreate','set statement_timeout=7000');
  perform dblink_exec('s07_preresolve','set statement_timeout=7000');
  perform dblink_exec('s07_gate','begin');
  perform dblink_exec('s07_gate',format(
    'do $lock$ begin perform pg_advisory_xact_lock(%s); end $lock$',v_gate
  ));
  perform dblink_send_query('s07_precreate',format(
    'select public._s07_prelocked_create_result(%s,%L::uuid,%s,%L,2)',v_gate,v_id,v_deadline,v_hash
  ));
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='s07_precreate' and wait_event_type='Lock') then
      v_waited:=true; exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_waited then raise exception 'S07 pre-lock create was not delayed'; end if;
  select resolution into v_resolution from dblink('s07_preresolve',format(
    'select resolution from public.resolve_public_booking_intent_v2(%L,%L,%L)',
    v_id,public._s07_race_key(v_id,v_deadline,v_hash),v_hash
  )) as t(resolution text);
  if v_resolution is distinct from 'closed_absent' then
    raise exception 'S07 resolve-first did not close: %',v_resolution;
  end if;
  perform dblink_exec('s07_gate','commit');
  select result into v_result from dblink_get_result('s07_precreate') as t(result text);
  if v_result is null or position('BOOKING_INTENT_CLOSED' in v_result)=0 then
    raise exception 'S07 released pre-lock create did not consume fence: %',v_result;
  end if;
  if exists(select 1 from public.public_booking_recoveries where recovery_id=v_id)
     or exists(select 1 from public.appointments where business_id='4c000000-0000-4000-8000-000000000227'
       and customer_name_snapshot='S07 Prelock') then
    raise exception 'S07 resolve-first create produced domain data';
  end if;
  perform dblink_disconnect('s07_gate'); perform dblink_disconnect('s07_precreate'); perform dblink_disconnect('s07_preresolve');
exception when others then
  begin perform dblink_disconnect('s07_gate'); exception when others then null; end;
  begin perform dblink_disconnect('s07_precreate'); exception when others then null; end;
  begin perform dblink_disconnect('s07_preresolve'); exception when others then null; end;
  raise;
end $$;

-- A create that began before its deadline but waited for the recovery lock must
-- use fresh wall time after lock acquisition and reject without side effects.
do $$
declare
  v_id uuid:='8c000000-0000-4000-8000-000000000229';
  v_deadline bigint;
  v_hash text:=repeat('c',64);
  v_result text;
  v_started bigint;
  v_waited boolean:=false;
begin
  perform dblink_connect('s07_deadlock','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_deadlock');
  perform dblink_connect('s07_deadcreate','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_deadcreate');
  perform dblink_exec('s07_deadlock','set statement_timeout=7000');
  perform dblink_exec('s07_deadcreate','set statement_timeout=7000');
  v_deadline:=floor(extract(epoch from clock_timestamp()))::bigint+3;
  perform dblink_exec('s07_deadlock','begin');
  perform dblink_exec('s07_deadlock',format(
    'do $lock$ begin perform pg_advisory_xact_lock(hashtextextended(%L,0)); end $lock$',v_id::text
  ));
  perform dblink_exec('s07_deadcreate','begin');
  select started into v_started from dblink(
    's07_deadcreate','select floor(extract(epoch from now()))::bigint'
  ) as t(started bigint);
  if v_started is null or v_started>=v_deadline then
    raise exception 'S07 deadline create transaction did not begin before deadline: %, %',v_started,v_deadline;
  end if;
  perform dblink_send_query('s07_deadcreate',format(
    'select public._s07_race_create_result(%L::uuid,%s,%L,3,%L)',v_id,v_deadline,v_hash,'S07 Deadline'
  ));
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='s07_deadcreate' and wait_event_type='Lock') then
      v_waited:=true; exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_waited then raise exception 'S07 deadline create never waited on recovery lock'; end if;
  perform pg_sleep(greatest(
    0.0,
    v_deadline::numeric+0.2-extract(epoch from clock_timestamp())
  )::double precision);
  perform dblink_exec('s07_deadlock','commit');
  select result into v_result from dblink_get_result('s07_deadcreate') as t(result text);
  perform dblink_exec('s07_deadcreate','commit');
  if v_result is null or position('BOOKING_INTENT_DEADLINE_EXPIRED' in v_result)=0 then
    raise exception 'S07 blocked create used transaction now(): %',v_result;
  end if;
  if exists(select 1 from public.public_booking_recoveries where recovery_id=v_id) then
    raise exception 'S07 expired waiter wrote bootstrap';
  end if;
  perform dblink_disconnect('s07_deadlock'); perform dblink_disconnect('s07_deadcreate');
exception when others then
  begin perform dblink_disconnect('s07_deadlock'); exception when others then null; end;
  begin perform dblink_disconnect('s07_deadcreate'); exception when others then null; end;
  raise;
end $$;

-- Maintenance deletes an expired fence in an uncommitted transaction. Create's
-- exact fence read waits; after prune commits, the final fresh clock still closes
-- the stale command. This catches deadline-before-fence and transaction-now bugs.
delete from public.public_booking_resolution_closures
where recovery_id='8c000000-0000-4000-8000-000000000230';
with seed as (
  select '8c000000-0000-4000-8000-000000000230'::uuid recovery_id,
         floor(extract(epoch from clock_timestamp()))::bigint-61 submit_deadline,
         repeat('d',64) secret_hash
)
insert into public.public_booking_resolution_closures(idempotency_key,recovery_id,submit_deadline)
select public._s07_race_key(recovery_id,submit_deadline,secret_hash),recovery_id,submit_deadline
from seed;

do $$
declare
  v_id uuid:='8c000000-0000-4000-8000-000000000230';
  v_deadline bigint;
  v_hash text:=repeat('d',64);
  v_key text;
  v_pruned integer;
  v_result text;
  v_waited boolean:=false;
begin
  select idempotency_key,submit_deadline into strict v_key,v_deadline
  from public.public_booking_resolution_closures where recovery_id=v_id;
  perform dblink_connect('s07_prune','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_prune');
  perform dblink_connect('s07_prunecreate','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s07_prunecreate');
  perform dblink_exec('s07_prune','set statement_timeout=7000');
  perform dblink_exec('s07_prunecreate','set statement_timeout=7000');
  perform dblink_exec('s07_prune','begin');
  select n into v_pruned from dblink('s07_prune','select public.prune_public_booking_resolution_closures()') as t(n integer);
  if coalesce(v_pruned,0)<1 then raise exception 'S07 prune did not delete the target fence'; end if;
  perform dblink_send_query('s07_prunecreate',format(
    'select public._s07_race_create_result(%L::uuid,%s,%L,4,%L)',v_id,v_deadline,v_hash,'S07 Pruned'
  ));
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='s07_prunecreate' and wait_event_type='Lock') then
      v_waited:=true; exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_waited then raise exception 'S07 create did not wait on in-flight fence prune'; end if;
  perform dblink_exec('s07_prune','commit');
  select result into v_result from dblink_get_result('s07_prunecreate') as t(result text);
  if v_result is null or position('BOOKING_INTENT_DEADLINE_EXPIRED' in v_result)=0 then
    raise exception 'S07 pruned fence allowed stale create: %',v_result;
  end if;
  if exists(select 1 from public.public_booking_recoveries where recovery_id=v_id)
     or exists(select 1 from public.appointments where business_id='4c000000-0000-4000-8000-000000000227'
       and customer_name_snapshot='S07 Pruned') then
    raise exception 'S07 prune/create race produced domain data';
  end if;
  perform dblink_disconnect('s07_prune'); perform dblink_disconnect('s07_prunecreate');
exception when others then
  begin perform dblink_disconnect('s07_prune'); exception when others then null; end;
  begin perform dblink_disconnect('s07_prunecreate'); exception when others then null; end;
  raise;
end $$;

drop function public._s07_prelocked_create_result(bigint,uuid,bigint,text,integer);
drop function public._s07_race_create_result(uuid,bigint,text,integer,text);
drop function public._s07_race_create(uuid,bigint,text,integer,text);
drop function public._s07_race_key(uuid,bigint,text);

-- This test intentionally commits only disposable CI fixture rows. Every race
-- uses distinct real dblink connections; no mock ordering stands in for locks.
