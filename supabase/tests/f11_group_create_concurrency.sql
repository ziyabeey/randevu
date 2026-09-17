create extension if not exists dblink;

-- F11-02 genuine two-writer interleaving. Two operators submit the same
-- multi-service reservation for the same staff and start under different
-- idempotency keys. Both block inside the canonical customer resolver on the
-- tenant advisory lock, so the race is deterministic. A-first and B-first are
-- each exercised; exactly one reservation per race may survive and the loser
-- must fail with a meaningful conflict, never with a half group.
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
  v_sql_a text;
  v_sql_b text;
  v_blocked integer;
  v_ok integer;
  v_failed integer;
  v_error text;
  v_groups integer;
  v_rows integer;
  v_conn text;
  v_first_conn text;
  v_second_conn text;
  v_winner_conn text;
  v_key_a text;
  v_key_b text;
  v_first_waited boolean;
  v_a_done boolean;
  v_b_done boolean;
  v_query_failed boolean;
  v_current_error text;
  v_result jsonb;
  v_result_rows integer;
  v_drain_rows integer;
begin
  -- Exercise each possible completion order. The preferred writer is first in
  -- the tenant-lock queue, but both writers are parked before that lock is
  -- released, so each pass remains a genuine two-writer race.
  for v_scenario in 1..2 loop
    v_start := (
      v_day + case when v_scenario = 1 then time '11:00' else time '15:00' end
    ) at time zone 'Europe/Istanbul';
    v_key_a := format('f1102-race-%s-key-a', v_scenario);
    v_key_b := format('f1102-race-%s-key-b', v_scenario);
    v_first_conn := case when v_scenario = 1 then 'f1102_race_a' else 'f1102_race_b' end;
    v_second_conn := case when v_scenario = 1 then 'f1102_race_b' else 'f1102_race_a' end;
    v_ok := 0;
    v_failed := 0;
    v_error := null;
    v_winner_conn := null;
    v_a_done := false;
    v_b_done := false;

    for v_conn in select unnest(array['f1102_race_a','f1102_race_b']) loop
      perform dblink_connect(
        v_conn,
        'host=127.0.0.1 port=5432 dbname='||current_database()
          ||' user=postgres password=postgres application_name='||v_conn
      );
      -- Both writers are deliberately parked on the tenant lock while the race
      -- is armed, so their budget must cover that wait plus the winner's commit.
      perform dblink_exec(v_conn,'set statement_timeout=30000');
      perform dblink_exec(v_conn,'begin');
      perform dblink_exec(v_conn,'set local role authenticated');
      perform dblink_exec(v_conn,'set local "request.jwt.claim.sub" = '''||v_owner::text||'''');
      perform dblink_exec(v_conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
    end loop;

    perform pg_advisory_lock(v_lock_key);
    v_lock_held := true;

    v_sql_a := format($q$
      select public.create_appointment_group(
        %L::uuid, %L, %L, %L::jsonb, %L::timestamptz, %L
      )
    $q$, v_business, v_key_a, format('Race %s A', v_scenario), v_lines,
      v_start, '05551110'||v_scenario::text||'01');
    v_sql_b := format($q$
      select public.create_appointment_group(
        %L::uuid, %L, %L, %L::jsonb, %L::timestamptz, %L
      )
    $q$, v_business, v_key_b, format('Race %s B', v_scenario), v_lines,
      v_start, '05551110'||v_scenario::text||'02');

    if dblink_send_query(
      v_first_conn,
      case when v_first_conn = 'f1102_race_a' then v_sql_a else v_sql_b end
    ) <> 1 then
      raise exception 'could not start preferred race writer %', v_first_conn;
    end if;

    -- Prove the preferred writer entered the lock queue first. This makes both
    -- A-first and B-first completion orders deterministic across the two passes.
    v_first_waited := false;
    for i in 1..300 loop
      perform pg_stat_clear_snapshot();
      if exists (
        select 1 from pg_stat_activity
        where application_name = v_first_conn and wait_event_type = 'Lock'
      ) then
        v_first_waited := true;
        exit;
      end if;
      perform pg_sleep(0.01);
    end loop;
    if not v_first_waited then
      raise exception 'preferred race writer % did not reach the tenant lock', v_first_conn;
    end if;

    if dblink_send_query(
      v_second_conn,
      case when v_second_conn = 'f1102_race_a' then v_sql_a else v_sql_b end
    ) <> 1 then
      raise exception 'could not start second race writer %', v_second_conn;
    end if;

    -- Both must actually be waiting before the lock is released; otherwise the
    -- test would prove nothing about interleaving.
    v_blocked := 0;
    for i in 1..300 loop
      perform pg_stat_clear_snapshot();
      select count(*)::integer into v_blocked
      from pg_stat_activity
      where application_name in ('f1102_race_a','f1102_race_b')
        and wait_event_type = 'Lock';
      exit when v_blocked = 2;
      perform pg_sleep(0.01);
    end loop;
    if v_blocked <> 2 then
      raise exception 'race writers did not both block on the tenant lock (blocked=%)', v_blocked;
    end if;

    perform pg_advisory_unlock(v_lock_key);
    v_lock_held := false;

    -- Collect whichever writer finishes first and end that remote transaction
    -- before waiting on the other. A successful winner otherwise retains the
    -- exclusion lock needed by the loser, making a fixed A-then-B collection
    -- order deadlock when B wins.
    for i in 1..2 loop
      v_conn := null;
      for j in 1..3000 loop
        if not v_a_done and dblink_is_busy('f1102_race_a') = 0 then
          v_conn := 'f1102_race_a';
          exit;
        elsif not v_b_done and dblink_is_busy('f1102_race_b') = 0 then
          v_conn := 'f1102_race_b';
          exit;
        end if;
        perform pg_sleep(0.01);
      end loop;
      if v_conn is null then
        raise exception 'timed out waiting for an unfinished race writer result';
      end if;

      v_query_failed := false;
      v_current_error := null;
      v_result := null;
      v_result_rows := 0;
      begin
        select t.result into strict v_result
        from dblink_get_result(v_conn) as t(result jsonb);
        get diagnostics v_result_rows = row_count;
      exception when others then
        v_query_failed := true;
        v_current_error := sqlerrm;
      end;

      -- libpq can accept COMMIT/ROLLBACK only after the trailing empty result is
      -- consumed. Drain it for both success and remote-error paths.
      perform * from dblink_get_result(v_conn, false) as t(result jsonb);
      get diagnostics v_drain_rows = row_count;
      if v_drain_rows <> 0 then
        raise exception 'writer % had % unexpected trailing result rows', v_conn, v_drain_rows;
      end if;

      if v_query_failed then
        v_error := coalesce(v_error, v_current_error);
        v_failed := v_failed + 1;
        perform dblink_exec(v_conn,'rollback');
      else
        if v_result_rows <> 1 or v_result is null or v_result->>'groupId' is null then
          raise exception 'writer % returned an invalid success result: %', v_conn, v_result;
        end if;
        perform dblink_exec(v_conn,'commit');
        v_ok := v_ok + 1;
        v_winner_conn := v_conn;
      end if;

      if v_conn = 'f1102_race_a' then v_a_done := true; else v_b_done := true; end if;
    end loop;

    for v_conn in select unnest(array['f1102_race_a','f1102_race_b']) loop
      perform dblink_disconnect(v_conn);
    end loop;

    if v_ok <> 1 or v_failed <> 1 then
      raise exception 'scenario % expected exactly one winner, got ok=% failed=%',
        v_scenario, v_ok, v_failed;
    end if;
    if v_winner_conn <> v_first_conn then
      raise exception 'scenario % expected queued writer % to win, got %',
        v_scenario, v_first_conn, v_winner_conn;
    end if;
    if v_error is null or (
      v_error not like '%APPOINTMENT_CONFLICT%'
      and v_error not like '%GROUP_SLOT_UNAVAILABLE%'
    ) then
      raise exception 'scenario % loser did not report a meaningful conflict: %',
        v_scenario, v_error;
    end if;

    select count(*)::integer into v_groups
    from public.appointment_groups g
    where g.business_id = v_business
      and g.id in (
        select bc.group_id from public.booking_commands bc
        where bc.business_id = v_business
          and bc.idempotency_key in (v_key_a, v_key_b)
      );
    select count(*)::integer into v_rows
    from public.appointments a
    where a.business_id = v_business
      and a.group_id in (
        select bc.group_id from public.booking_commands bc
        where bc.business_id = v_business
          and bc.idempotency_key in (v_key_a, v_key_b)
      );

    if v_groups <> 1 then
      raise exception 'scenario % expected one surviving group, found %', v_scenario, v_groups;
    end if;
    if v_rows <> 2 then
      raise exception 'scenario % expected two surviving lines, found % (half group)',
        v_scenario, v_rows;
    end if;

    -- The key-scoped checks prove the intended command survived. Whole-fixture
    -- totals also reject orphan groups or lines with no booking-command link.
    select count(*)::integer into v_groups
    from public.appointment_groups g
    where g.business_id = v_business;
    select count(*)::integer into v_rows
    from public.appointments a
    where a.business_id = v_business;
    if v_groups <> v_scenario then
      raise exception 'scenario % expected % total groups, found %',
        v_scenario, v_scenario, v_groups;
    end if;
    if v_rows <> 2 * v_scenario then
      raise exception 'scenario % expected % total lines, found % (orphan or half group)',
        v_scenario, 2 * v_scenario, v_rows;
    end if;
  end loop;

  raise notice 'F11-02 A-first and B-first group races accepted: one winner each, no half group';
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
