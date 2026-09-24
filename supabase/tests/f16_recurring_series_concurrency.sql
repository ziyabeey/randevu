create extension if not exists dblink;

-- F16-01 genuine two-session replay race. The first writer claims the whole-series
-- key and then waits on the canonical tenant customer lock. The second writer
-- reaches the same command primary key while the first is still open. After
-- release, both calls must resolve to one durable series with no partial state.
delete from public.businesses where id='f1710000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f1700000-0000-4000-8000-000000000001','f1601-race@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1710000-0000-4000-8000-000000000001','F16-01 Race','f1601-race',
  'Europe/Istanbul','f1700000-0000-4000-8000-000000000001'
);
insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1720000-0000-4000-8000-000000000001',
  'f1710000-0000-4000-8000-000000000001',
  'f1700000-0000-4000-8000-000000000001','owner',true
);
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1730000-0000-4000-8000-000000000001',
  'f1710000-0000-4000-8000-000000000001',
  'Race Kesim',30,0,0,'Genel',10,12000,'fixed',12000,12000,'TRY',true
);
insert into public.staff_profiles(id,business_id,name,active)
values (
  'f1740000-0000-4000-8000-000000000001',
  'f1710000-0000-4000-8000-000000000001','Race Staff',true
);
insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'f1710000-0000-4000-8000-000000000001',
  'f1740000-0000-4000-8000-000000000001',
  'f1730000-0000-4000-8000-000000000001',true
);
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'f1710000-0000-4000-8000-000000000001',d,time '09:00',time '18:00',true
from generate_series(0,6) d;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'f1710000-0000-4000-8000-000000000001',
  'f1740000-0000-4000-8000-000000000001',
  d,time '09:00',time '18:00',true
from generate_series(0,6) d;

do $f16_race$
declare
  v_business uuid:='f1710000-0000-4000-8000-000000000001';
  v_owner uuid:='f1700000-0000-4000-8000-000000000001';
  v_start timestamptz:=(current_date+7+time '11:00') at time zone 'Europe/Istanbul';
  v_lines jsonb:='[{"serviceId":"f1730000-0000-4000-8000-000000000001","staffId":"f1740000-0000-4000-8000-000000000001"}]'::jsonb;
  v_key text:='f1601-concurrent-series-key';
  v_lock_key bigint:=hashtextextended(v_business::text,0);
  v_lock_held boolean:=false;
  v_sql text;
  v_first_waited boolean:=false;
  v_second_waited boolean:=false;
  v_result_a jsonb;
  v_result_b jsonb;
  v_series_a uuid;
  v_series_b uuid;
  v_drain integer;
  v_conn text;
begin
  perform dblink_connect(
    'f1601_series_a',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1601_series_a'
  );
  perform dblink_connect(
    'f1601_series_b',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1601_series_b'
  );
  for v_conn in select unnest(array['f1601_series_a','f1601_series_b']) loop
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,'set local "request.jwt.claim.sub" = '''||v_owner::text||'''');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  perform pg_advisory_lock(v_lock_key);
  v_lock_held:=true;
  v_sql:=format($q$
    select public.create_appointment_series(
      %L::uuid,%L,%L,%L::jsonb,%L::timestamptz,'daily',3,%L
    )
  $q$,v_business,v_key,'Race Müşteri',v_lines,v_start,'05551601099');

  if dblink_send_query('f1601_series_a',v_sql)<>1 then
    raise exception 'F16-01 race writer A did not start';
  end if;
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f1601_series_a' and wait_event_type='Lock'
    ) then v_first_waited:=true; exit; end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_first_waited then raise exception 'F16-01 writer A did not reach tenant lock'; end if;

  if dblink_send_query('f1601_series_b',v_sql)<>1 then
    raise exception 'F16-01 race writer B did not start';
  end if;
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f1601_series_b' and wait_event_type='Lock'
    ) then v_second_waited:=true; exit; end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_second_waited then raise exception 'F16-01 writer B did not block behind the claimed series key'; end if;

  perform pg_advisory_unlock(v_lock_key);
  v_lock_held:=false;

  for i in 1..5000 loop
    exit when dblink_is_busy('f1601_series_a')=0;
    perform pg_sleep(0.01);
  end loop;
  select t.result into strict v_result_a
  from dblink_get_result('f1601_series_a') as t(result jsonb);
  perform * from dblink_get_result('f1601_series_a',false) as t(result jsonb);
  get diagnostics v_drain=row_count;
  if v_drain<>0 then raise exception 'F16-01 writer A trailing rows=%',v_drain; end if;
  perform dblink_exec('f1601_series_a','commit');

  for i in 1..5000 loop
    exit when dblink_is_busy('f1601_series_b')=0;
    perform pg_sleep(0.01);
  end loop;
  select t.result into strict v_result_b
  from dblink_get_result('f1601_series_b') as t(result jsonb);
  perform * from dblink_get_result('f1601_series_b',false) as t(result jsonb);
  get diagnostics v_drain=row_count;
  if v_drain<>0 then raise exception 'F16-01 writer B trailing rows=%',v_drain; end if;
  perform dblink_exec('f1601_series_b','commit');

  v_series_a:=(v_result_a->>'seriesId')::uuid;
  v_series_b:=(v_result_b->>'seriesId')::uuid;
  if v_series_a is null or v_series_b is null or v_series_a<>v_series_b then
    raise exception 'F16-01 concurrent replay returned different series: A=% B=%',v_result_a,v_result_b;
  end if;
  if (select count(*) from public.appointment_series
      where business_id=v_business)<>1 then
    raise exception 'F16-01 concurrent replay created multiple series headers';
  end if;
  if (select count(*) from public.appointment_groups
      where business_id=v_business and series_id=v_series_a)<>3 then
    raise exception 'F16-01 concurrent replay left partial/duplicate occurrence groups';
  end if;
  if (select count(*) from public.appointments a
      join public.appointment_groups g
        on g.business_id=a.business_id and g.id=a.group_id
      where g.business_id=v_business and g.series_id=v_series_a)<>3 then
    raise exception 'F16-01 concurrent replay left partial appointment lines';
  end if;
  if (select count(*) from public.appointment_series_commands
      where business_id=v_business and idempotency_key=v_key)<>1 then
    raise exception 'F16-01 concurrent replay created multiple series commands';
  end if;
  if (select count(*) from public.appointment_series_events
      where business_id=v_business and series_id=v_series_a and event_type='created')<>1 then
    raise exception 'F16-01 concurrent replay duplicated create audit';
  end if;

  perform dblink_disconnect('f1601_series_a');
  perform dblink_disconnect('f1601_series_b');
  raise notice 'F16-01 concurrent same-key create accepted: writers=2 series=1 groups=3 commands=1';
exception when others then
  if v_lock_held then perform pg_advisory_unlock(v_lock_key); end if;
  begin perform dblink_exec('f1601_series_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('f1601_series_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1601_series_a'); exception when others then null; end;
  begin perform dblink_disconnect('f1601_series_b'); exception when others then null; end;
  raise;
end
$f16_race$;

delete from public.businesses where id='f1710000-0000-4000-8000-000000000001';
