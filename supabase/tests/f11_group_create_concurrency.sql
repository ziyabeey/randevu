create extension if not exists dblink;

-- F11-02 genuine two-writer interleaving. Two operators submit the same
-- multi-service reservation for the same staff and start under different
-- idempotency keys. Both block inside the canonical customer resolver on the
-- tenant advisory lock, so the race is deterministic. Exactly one reservation
-- may survive and the loser must fail with a meaningful conflict, never with a
-- half group.
delete from public.businesses where id = 'd1710000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('d1700000-0000-4000-8000-000000000001','f1102-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('d1710000-0000-4000-8000-000000000001','F11-02 Race','f1102-race','Europe/Istanbul','d1700000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('d1720000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role=excluded.role,active=excluded.active;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('d1730000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001','Race Boya',45,10,10,'Renk',10,null,'range',20000,30000,'TRY',true),
  ('d1730000-0000-4000-8000-000000000002','d1710000-0000-4000-8000-000000000001','Race Kesim',30,0,0,'Genel',20,15000,'fixed',15000,15000,'TRY',true);

-- One eligible stylist only: the two reservations cannot both be placed.
insert into public.staff_profiles(id,business_id,name,active)
values ('d1740000-0000-4000-8000-000000000001','d1710000-0000-4000-8000-000000000001','Race Staff',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1710000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000001',true),
  ('d1710000-0000-4000-8000-000000000001','d1740000-0000-4000-8000-000000000001','d1730000-0000-4000-8000-000000000002',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd1710000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd1710000-0000-4000-8000-000000000001'::uuid,'d1740000-0000-4000-8000-000000000001'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;

do $$
declare
  v_business uuid := 'd1710000-0000-4000-8000-000000000001';
  v_owner uuid := 'd1700000-0000-4000-8000-000000000001';
  v_day date := date_trunc('week',current_date)::date+7;
  v_start timestamptz;
  v_lock_key bigint := hashtextextended(v_business::text, 0);
  v_lock_held boolean := false;
  v_lines jsonb := '[{"serviceId":"d1730000-0000-4000-8000-000000000001"},{"serviceId":"d1730000-0000-4000-8000-000000000002"}]'::jsonb;
  v_sql text;
  v_blocked integer;
  v_ok integer := 0;
  v_failed integer := 0;
  v_error text;
  v_groups integer;
  v_rows integer;
  v_conn text;
begin
  v_start := (v_day + time '11:00') at time zone 'Europe/Istanbul';

  for v_conn in select unnest(array['f1102_race_a','f1102_race_b']) loop
    perform dblink_connect(
      v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_conn
    );
    perform dblink_exec(v_conn,'set statement_timeout=8000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,'set local "request.jwt.claim.sub" = '''||v_owner::text||'''');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  -- Hold the tenant resolver lock so both writers are in flight together.
  perform pg_advisory_lock(v_lock_key);
  v_lock_held := true;

  v_sql := format($q$
    select public.create_appointment_group(
      %L::uuid, 'f1102-race-key-a', 'Race A', %L::jsonb, %L::timestamptz, '05551110001'
    )
  $q$, v_business, v_lines, v_start);
  if dblink_send_query('f1102_race_a', v_sql) <> 1 then
    raise exception 'could not start race writer A';
  end if;

  v_sql := format($q$
    select public.create_appointment_group(
      %L::uuid, 'f1102-race-key-b', 'Race B', %L::jsonb, %L::timestamptz, '05551110002'
    )
  $q$, v_business, v_lines, v_start);
  if dblink_send_query('f1102_race_b', v_sql) <> 1 then
    raise exception 'could not start race writer B';
  end if;

  -- Both must actually be waiting before the lock is released; otherwise the
  -- test would prove nothing about interleaving.
  for i in 1..250 loop
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1102_race_a','f1102_race_b')
      and wait_event_type = 'Lock';
    exit when v_blocked = 2;
    perform pg_sleep(0.02);
  end loop;
  if v_blocked <> 2 then
    raise exception 'race writers did not both block on the tenant lock (blocked=%)', v_blocked;
  end if;

  perform pg_advisory_unlock(v_lock_key);
  v_lock_held := false;

  for v_conn in select unnest(array['f1102_race_a','f1102_race_b']) loop
    begin
      perform * from dblink_get_result(v_conn) as t(result jsonb);
      perform * from dblink_get_result(v_conn, false) as t(result jsonb);
      perform dblink_exec(v_conn,'commit');
      v_ok := v_ok + 1;
    exception when others then
      v_error := coalesce(v_error, sqlerrm);
      v_failed := v_failed + 1;
      begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;

  if v_ok <> 1 or v_failed <> 1 then
    raise exception 'expected exactly one winner, got ok=% failed=%', v_ok, v_failed;
  end if;
  if v_error not like '%APPOINTMENT_CONFLICT%' and v_error not like '%GROUP_SLOT_UNAVAILABLE%' then
    raise exception 'loser did not report a meaningful conflict: %', v_error;
  end if;

  select count(*)::integer into v_groups
  from public.appointment_groups g where g.business_id = v_business;
  select count(*)::integer into v_rows
  from public.appointments a where a.business_id = v_business;

  if v_groups <> 1 then raise exception 'expected one surviving group, found %', v_groups; end if;
  if v_rows <> 2 then raise exception 'expected two surviving lines, found % (half group)', v_rows; end if;

  raise notice 'F11-02 two-writer group race accepted: one winner, no half group';
exception when others then
  if v_lock_held then perform pg_advisory_unlock(v_lock_key); end if;
  begin perform dblink_exec('f1102_race_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('f1102_race_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1102_race_a'); exception when others then null; end;
  begin perform dblink_disconnect('f1102_race_b'); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses where id = 'd1710000-0000-4000-8000-000000000001';
