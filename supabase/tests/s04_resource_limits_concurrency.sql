
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000204','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s04-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000204','Abuse Test','s04-test','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000204'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000204','4b000000-0000-4000-8000-000000000204',
  '19000000-0000-4000-8000-000000000204','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000204','4b000000-0000-4000-8000-000000000204',
  'Abuse Hizmeti',30,0,0,180000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000204','4b000000-0000-4000-8000-000000000204','Abuse Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000204','7b000000-0000-4000-8000-000000000204',
  '6b000000-0000-4000-8000-000000000204',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000204',false);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000204',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000204',
    '7b000000-0000-4000-8000-000000000204',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000204', true, 15, 0, 30
  );
end
$$;

reset role;
delete from public.public_booking_rate_counters;
delete from public.public_booking_abuse_config;
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


create extension if not exists dblink;
create function public._s04_race_payload() returns jsonb language sql as $$
 select jsonb_build_object('p_slug','s04-test','p_idempotency_key','s04-race-book','p_customer_name','Race Customer',
 'p_service_id','6b000000-0000-4000-8000-000000000204','p_staff_id','7b000000-0000-4000-8000-000000000204',
 'p_starts_at',((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul',
 'p_management_token_hash',repeat('a',64),'p_recovery_id','8b000000-0000-4000-8000-000000000204',
 'p_recovery_secret_hash',repeat('b',64),'p_management_token_ciphertext',repeat('c',60),
 'p_management_token_iv',repeat('i',16),'p_key_version',1,'p_customer_phone','+90 555 000 02 04','p_customer_email','s04-customer@example.test');
$$;
grant execute on function public._s04_race_payload() to anon;
do $$ declare v_a jsonb; v_b jsonb; v_waited boolean:=false; v_count integer; begin
 perform dblink_connect('s04_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s04_a');
 perform dblink_connect('s04_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s04_b');
 perform dblink_exec('s04_a','set statement_timeout=5000');
 perform dblink_exec('s04_b','set statement_timeout=5000');
 perform dblink_exec('s04_a','set role anon');
 perform dblink_exec('s04_b','set role anon');
 perform dblink_exec('s04_a','begin');
 select result into v_a from dblink('s04_a',$q$select public.execute_public_operation('book',public._s04_race_payload(),repeat('g',43),repeat('a',64),repeat('1',64))$q$) as t(result jsonb);
 if v_a->>'ok'<>'true' then raise exception 'S04 first concurrent call failed: %',v_a; end if;
 -- Different network/actor proves recovery lock itself protects classification.
 perform dblink_send_query('s04_b',$q$select public.execute_public_operation('book',public._s04_race_payload(),repeat('g',43),repeat('b',64),repeat('2',64))$q$);
 for i in 1..100 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity where application_name='s04_b' and wait_event_type='Lock') then v_waited:=true; exit; end if;
   perform pg_sleep(0.01);
 end loop;
 if not v_waited then raise exception 'S04 no real lock contention'; end if;
 perform dblink_exec('s04_a','commit');
 select result into v_b from dblink_get_result('s04_b') as t(result jsonb);
 if v_b->>'ok'<>'true' or v_b#>>'{data,0,appointment_id}' is distinct from v_a#>>'{data,0,appointment_id}' then raise exception 'S04 concurrent replay mismatch: %',v_b; end if;
 select sum(count) into v_count from public.public_booking_rate_counters where action='create' and dimension='actor';
 if v_count<>1 then raise exception 'S04 first request race charged two creates: %',v_count; end if;
 select sum(count) into v_count from public.public_booking_rate_counters where action='request' and dimension='actor';
 if v_count<>2 then raise exception 'S04 concurrent request count mismatch'; end if;
 if (select count(*) from public.appointments where business_id='4b000000-0000-4000-8000-000000000204')<>1 then raise exception 'S04 concurrent duplicate appointment'; end if;
 perform dblink_disconnect('s04_a'); perform dblink_disconnect('s04_b');
 raise notice 'S04 two committed concurrent requests: 1 appointment, 1 create budget, 2 request admissions';
exception when others then
 begin perform dblink_disconnect('s04_a'); exception when others then null; end;
 begin perform dblink_disconnect('s04_b'); exception when others then null; end;
 raise;
end $$;
drop function public._s04_race_payload();

-- Model a window rollover while a stale caller is blocked on the row, without
-- waiting for a wall-clock minute boundary. The committed future window must
-- never be moved backwards by the older proposal.
insert into public.public_booking_rate_counters(action,dimension,key_hash,window_started_at,count)
values ('manage_read','actor',repeat('9',64),to_timestamp(floor(extract(epoch from clock_timestamp())/60)*60),7);
do $$ declare v_waited boolean:=false; v_window timestamptz; v_count integer; begin
 perform dblink_connect('s04_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s04_a');
 perform dblink_connect('s04_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s04_b');
 perform dblink_exec('s04_a','set statement_timeout=5000');
 perform dblink_exec('s04_b','set statement_timeout=5000');
 perform dblink_exec('s04_a','begin');
 select w into v_window from dblink('s04_a',$q$update public.public_booking_rate_counters set window_started_at=window_started_at+interval '2 minutes' where action='manage_read' and dimension='actor' and key_hash=repeat('9',64) returning window_started_at$q$) as t(w timestamptz);
 perform dblink_send_query('s04_b',$q$select public.consume_public_booking_rate('manage_read','actor',repeat('9',64),10,60)$q$);
 for i in 1..100 loop
   perform pg_stat_clear_snapshot();
   if exists(select 1 from pg_stat_activity where application_name='s04_b' and wait_event_type='Lock') then v_waited:=true; exit; end if;
   perform pg_sleep(0.01);
 end loop;
 if not v_waited then raise exception 'S04 boundary test did not wait on row'; end if;
 perform dblink_exec('s04_a','commit');
 perform * from dblink_get_result('s04_b') as t(result text);
 select count into v_count from public.public_booking_rate_counters where action='manage_read' and dimension='actor' and key_hash=repeat('9',64) and window_started_at=v_window;
 if v_count is distinct from 8 then raise exception 'S04 old waiter reset later window: %',v_count; end if;
 perform dblink_disconnect('s04_a'); perform dblink_disconnect('s04_b');
 raise notice 'S04 window monotonicity: blocked stale caller increments 7 to 8; no backward reset';
exception when others then
 begin perform dblink_disconnect('s04_a'); exception when others then null; end;
 begin perform dblink_disconnect('s04_b'); exception when others then null; end;
 raise;
end $$;
