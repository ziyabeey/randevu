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

-- One eligible stylist only: competing reservations cannot both be placed.
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

-- F11-04 bounded high fan-out acceptance. The genuine two-session block above
-- remains the lock-order proof; this layer drives 100 distinct keys through the
-- same staff/interval without turning PostgreSQL max_connections into the test.
-- Twenty requests are truly in-flight per wave, five waves total.
do $$
declare
  v_business uuid := 'd1710000-0000-4000-8000-000000000001';
  v_owner uuid := 'd1700000-0000-4000-8000-000000000001';
  v_start timestamptz := (date_trunc('week',current_date)::date+7+time '13:00') at time zone 'Europe/Istanbul';
  v_lock_key bigint := hashtextextended(v_business::text, 0);
  v_lock_held boolean := false;
  v_lines jsonb := '[{"serviceId":"d1730000-0000-4000-8000-000000000001"},{"serviceId":"d1730000-0000-4000-8000-000000000002"}]'::jsonb;
  v_conn text;
  v_sql text;
  v_blocked integer;
  v_busy integer;
  v_index integer;
  v_result jsonb;
  v_error text;
  v_ok integer := 0;
  v_failed integer := 0;
  v_bad_error integer := 0;
  v_rows integer;
  v_groups integer;
  v_commands integer;
  v_orphans integer;
  v_winner_group uuid;
begin
  -- Open a bounded reusable pool. Session-level role/claims survive each
  -- autocommit statement, so every wave exercises the real authenticated RPC.
  for i in 1..20 loop
    v_conn := 'f1104_fanout_'||lpad(i::text,2,'0');
    perform dblink_connect(
      v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_conn
    );
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'set role authenticated');
    perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_owner::text||'''');
    perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  for v_wave in 1..5 loop
    perform pg_advisory_lock(v_lock_key);
    v_lock_held := true;

    for i in 1..20 loop
      v_index := (v_wave-1)*20+i;
      v_conn := 'f1104_fanout_'||lpad(i::text,2,'0');
      v_sql := format($q$
        select public.create_appointment_group(
          %L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L
        )
      $q$,
        v_business,
        'f1104-fanout-'||lpad(v_index::text,3,'0'),
        'Fanout Customer '||lpad(v_index::text,3,'0'),
        v_lines,
        v_start,
        '055520'||lpad(v_index::text,5,'0')
      );
      if dblink_send_query(v_conn,v_sql) <> 1 then
        raise exception 'F11-04 fanout request % did not start',v_index;
      end if;
    end loop;

    -- Every request in the wave must have reached the canonical tenant lock
    -- before release; otherwise this would be sequential load, not contention.
    v_blocked := 0;
    for attempt in 1..1000 loop
      perform pg_stat_clear_snapshot();
      select count(*)::integer into v_blocked
      from pg_stat_activity
      where application_name like 'f1104_fanout_%'
        and wait_event_type='Lock';
      exit when v_blocked=20;
      perform pg_sleep(0.01);
    end loop;
    if v_blocked<>20 then
      raise exception 'F11-04 fanout wave % parked %/20 requests',v_wave,v_blocked;
    end if;

    perform pg_advisory_unlock(v_lock_key);
    v_lock_held := false;

    -- Autocommit is deliberate here: the first successful statement releases
    -- its row/exclusion locks before the rest of the wave finishes.
    for attempt in 1..6000 loop
      v_busy := 0;
      for i in 1..20 loop
        v_conn := 'f1104_fanout_'||lpad(i::text,2,'0');
        v_busy := v_busy+dblink_is_busy(v_conn);
      end loop;
      exit when v_busy=0;
      perform pg_sleep(0.01);
    end loop;
    if v_busy<>0 then
      raise exception 'F11-04 fanout wave % timed out with % busy requests',v_wave,v_busy;
    end if;

    for i in 1..20 loop
      v_conn := 'f1104_fanout_'||lpad(i::text,2,'0');
      v_result := null;
      v_error := null;
      begin
        select t.result into strict v_result
        from dblink_get_result(v_conn) as t(result jsonb);
        v_ok := v_ok+1;
        if v_winner_group is null then
          v_winner_group := (v_result->>'groupId')::uuid;
        elsif v_winner_group <> (v_result->>'groupId')::uuid then
          raise exception 'F11-04 fanout produced multiple winner groups';
        end if;
      exception when others then
        v_error := sqlerrm;
        v_failed := v_failed+1;
        if v_error not like '%APPOINTMENT_CONFLICT%'
           and v_error not like '%GROUP_SLOT_UNAVAILABLE%' then
          v_bad_error := v_bad_error+1;
        end if;
      end;
      begin
        perform * from dblink_get_result(v_conn,false) as t(result jsonb);
      exception when others then null;
      end;
    end loop;
  end loop;

  for i in 1..20 loop
    v_conn := 'f1104_fanout_'||lpad(i::text,2,'0');
    perform dblink_disconnect(v_conn);
  end loop;

  if v_ok<>1 or v_failed<>99 or v_bad_error<>0 or v_winner_group is null then
    raise exception 'F11-04 bounded fanout expected 1 winner + 99 deterministic conflicts, ok=% failed=% bad_error=%',
      v_ok,v_failed,v_bad_error;
  end if;

  select count(*)::integer into v_commands
  from public.booking_commands bc
  where bc.business_id=v_business and bc.idempotency_key like 'f1104-fanout-%';
  if v_commands<>1 then
    raise exception 'F11-04 fanout expected one durable command, found %',v_commands;
  end if;

  select count(*)::integer into v_groups
  from public.appointment_groups g
  where g.business_id=v_business
    and g.id in (
      select bc.group_id from public.booking_commands bc
      where bc.business_id=v_business and bc.idempotency_key like 'f1104-fanout-%'
    );
  select count(*)::integer into v_rows
  from public.appointments a
  where a.business_id=v_business and a.group_id=v_winner_group;
  if v_groups<>1 or v_rows<>2 then
    raise exception 'F11-04 fanout half-state: groups=% lines=%',v_groups,v_rows;
  end if;

  if (select count(*) from public.appointment_events e
      where e.business_id=v_business and e.group_id=v_winner_group and e.event_type='created')<>1 then
    raise exception 'F11-04 fanout winner did not produce exactly one create event';
  end if;

  select count(*)::integer into v_orphans
  from public.booking_commands bc
  left join public.appointment_groups g
    on g.business_id=bc.business_id and g.id=bc.group_id
  where bc.business_id=v_business
    and bc.idempotency_key like 'f1104-fanout-%'
    and (bc.group_id is null or g.id is null);
  if v_orphans<>0 then raise exception 'F11-04 fanout left orphan booking commands: %',v_orphans; end if;

  select count(*)::integer into v_orphans
  from public.appointment_management_capabilities c
  left join public.appointment_groups g
    on g.business_id=c.business_id and g.id=c.group_id
  where c.business_id=v_business and g.id is null;
  if v_orphans<>0 then raise exception 'F11-04 fanout left orphan management capabilities: %',v_orphans; end if;

  select count(*)::integer into v_orphans
  from public.appointment_notification_jobs j
  left join public.appointment_groups g
    on g.business_id=j.business_id and g.id=j.group_id
  where j.business_id=v_business and j.group_id is not null and g.id is null;
  if v_orphans<>0 then raise exception 'F11-04 fanout left orphan notification jobs: %',v_orphans; end if;

  if (select count(*) from public.appointment_groups where business_id=v_business)<>3
     or (select count(*) from public.appointments where business_id=v_business)<>6 then
    raise exception 'F11-04 fanout changed fixture cardinality beyond one two-line winner';
  end if;

  raise notice 'F11-04 bounded fanout accepted: requests=100 concurrency=20 waves=5 winners=1 conflicts=99 commands=1 groups=1 lines=2 orphan_evidence=0';
exception when others then
  if v_lock_held then perform pg_advisory_unlock(v_lock_key); end if;
  for i in 1..20 loop
    v_conn := 'f1104_fanout_'||lpad(i::text,2,'0');
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$$;

delete from public.businesses where id = 'd1710000-0000-4000-8000-000000000001';