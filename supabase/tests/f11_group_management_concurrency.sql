create extension if not exists dblink;

-- F11-03 genuine two-writer interleaving on one group. The single-session
-- acceptance proves the version guard rejects a stale number; only a real race
-- proves the guard is what serializes two live writers. Both passes park on the
-- group-management advisory lock, so each is deterministic:
--   1. two operators move the same group at once;
--   2. an operator and the customer's /m#token link move it at once.
-- Exactly one may win. The loser must report BOOKING_GROUP_VERSION_CONFLICT --
-- raised for the operator, carried through the public envelope for the customer
-- -- and must leave no half-moved group behind.
--
-- The mutation RPCs run under set statement_timeout='5s', which also bounds the
-- wait on that advisory lock, so every arming poll below stays well inside it.
delete from public.businesses where id = 'd1810000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('d1800000-0000-4000-8000-000000000001','f1103-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('d1810000-0000-4000-8000-000000000001','F11-03 Race','f1103-race','Europe/Istanbul','d1800000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('d1820000-0000-4000-8000-000000000001','d1810000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role=excluded.role,active=excluded.active;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('d1830000-0000-4000-8000-000000000001','d1810000-0000-4000-8000-000000000001','Race Renk',60,0,0,'Genel',10,20000,'fixed',20000,20000,'TRY',true),
  ('d1830000-0000-4000-8000-000000000002','d1810000-0000-4000-8000-000000000001','Race Kesim',30,0,0,'Genel',20,12000,'fixed',12000,12000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values ('d1840000-0000-4000-8000-000000000001','d1810000-0000-4000-8000-000000000001','Race Staff',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1810000-0000-4000-8000-000000000001','d1840000-0000-4000-8000-000000000001','d1830000-0000-4000-8000-000000000001',true),
  ('d1810000-0000-4000-8000-000000000001','d1840000-0000-4000-8000-000000000001','d1830000-0000-4000-8000-000000000002',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd1810000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd1810000-0000-4000-8000-000000000001'::uuid,'d1840000-0000-4000-8000-000000000001'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true;

insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('d1810000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values ('default',encode(extensions.digest('f1103-race-gate-secret-000000000000000000000','sha256'),'hex'))
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash;

-- A public-source group with a live capability token: the operator console and
-- the customer link are then two real writers on the same row.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_deadline bigint := floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_secret text := encode(extensions.digest('f1103-race:secret','sha256'),'hex');
  v_key text;
  v_result jsonb;
begin
  v_key := 'pub2_'||v_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||'d1880000-0000-4000-8000-000000000001'||chr(10)
      ||v_deadline::text||chr(10)||v_secret,'UTF8'),'sha256'),'hex');

  v_result := public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f1103-race','p_idempotency_key',v_key,
    'p_customer_name','Race Customer',
    'p_lines','[{"serviceId":"d1830000-0000-4000-8000-000000000001"},{"serviceId":"d1830000-0000-4000-8000-000000000002"}]'::jsonb,
    'p_starts_at',(v_day+time '10:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',public.management_token_hash('f1103racetoken'||repeat('a',29)),
    'p_recovery_id','d1880000-0000-4000-8000-000000000001',
    'p_recovery_secret_hash',v_secret,
    'p_management_token_ciphertext',repeat('c',64),'p_management_token_iv',repeat('v',16),
    'p_key_version',1,'p_customer_phone','05559990001'
  ),'f1103-race-gate-secret-'||repeat('0',21),
    encode(extensions.digest('f1103-race:actor:fixture','sha256'),'hex'),
    encode(extensions.digest('f1103-race:network','sha256'),'hex'));

  if v_result->>'ok' is distinct from 'true' then
    raise exception 'F11-03 race fixture could not book the public group: %', v_result::text;
  end if;
  perform set_config('f1103race.group_id',v_result#>>'{data,0,group_payload,groupId}',false);
end
$$;

do $$
declare
  v_business uuid := 'd1810000-0000-4000-8000-000000000001';
  v_owner uuid := 'd1800000-0000-4000-8000-000000000001';
  v_group uuid := current_setting('f1103race.group_id')::uuid;
  v_token text := 'f1103racetoken'||repeat('a',29);
  v_gate text := 'f1103-race-gate-secret-'||repeat('0',21);
  v_day date := date_trunc('week',current_date)::date+7;
  v_lock_key bigint := hashtextextended('f11:group-management:'||v_business::text||':'||v_group::text,0);
  v_lock_held boolean := false;
  v_scenario integer;
  v_version integer;
  v_target_a timestamptz;
  v_target_b timestamptz;
  v_sql_a text;
  v_sql_b text;
  v_key_a text;
  v_key_b text;
  v_conn text;
  v_first_conn text := 'f1103_race_a';
  v_second_conn text := 'f1103_race_b';
  v_winner_conn text;
  v_first_waited boolean;
  v_blocked integer;
  v_a_done boolean;
  v_b_done boolean;
  v_query_failed boolean;
  v_current_error text;
  v_result jsonb;
  v_result_rows integer;
  v_drain_rows integer;
  v_ok integer;
  v_failed integer;
  v_error text;
  v_succeeded boolean;
  v_lines integer;
  v_distinct integer;
  v_commands integer;
begin
  for v_scenario in 1..2 loop
    select g.version into v_version
    from public.appointment_groups g where g.id = v_group;

    v_target_a := (v_day + case when v_scenario = 1 then time '13:00' else time '16:00' end)
      at time zone 'Europe/Istanbul';
    v_target_b := (v_day + case when v_scenario = 1 then time '15:00' else time '18:00' end)
      at time zone 'Europe/Istanbul';
    v_key_a := format('f1103-race-%s-key-a', v_scenario);
    v_key_b := format('f1103-race-%s-key-b', v_scenario);
    v_ok := 0;
    v_failed := 0;
    v_error := null;
    v_winner_conn := null;
    v_a_done := false;
    v_b_done := false;

    -- A is always the operator console. B is a second operator in pass 1 and
    -- the customer's public link in pass 2.
    perform dblink_connect('f1103_race_a',
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name=f1103_race_a');
    perform dblink_exec('f1103_race_a','set statement_timeout=30000');
    perform dblink_exec('f1103_race_a','begin');
    perform dblink_exec('f1103_race_a','set local role authenticated');
    perform dblink_exec('f1103_race_a','set local "request.jwt.claim.sub" = '''||v_owner::text||'''');
    perform dblink_exec('f1103_race_a',$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

    perform dblink_connect('f1103_race_b',
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name=f1103_race_b');
    perform dblink_exec('f1103_race_b','set statement_timeout=30000');
    perform dblink_exec('f1103_race_b','begin');
    if v_scenario = 1 then
      perform dblink_exec('f1103_race_b','set local role authenticated');
      perform dblink_exec('f1103_race_b','set local "request.jwt.claim.sub" = '''||v_owner::text||'''');
      perform dblink_exec('f1103_race_b',$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
    else
      perform dblink_exec('f1103_race_b','set local role anon');
    end if;

    perform pg_advisory_lock(v_lock_key);
    v_lock_held := true;

    v_sql_a := format($q$
      select public.reschedule_appointment_group(%L::uuid,%L::uuid,%L,%s,%L::timestamptz)
    $q$, v_business, v_group, v_key_a, v_version, v_target_a);

    if v_scenario = 1 then
      v_sql_b := format($q$
        select public.reschedule_appointment_group(%L::uuid,%L::uuid,%L,%s,%L::timestamptz)
      $q$, v_business, v_group, v_key_b, v_version, v_target_b);
    else
      v_sql_b := format($q$
        select public.execute_public_operation('manage_group_reschedule',
          jsonb_build_object('p_token',%L,'p_idempotency_key',%L,
            'p_expected_version',%s,'p_starts_at',%L::timestamptz),
          %L,%L,%L)
      $q$, v_token, v_key_b, v_version, v_target_b, v_gate,
        encode(extensions.digest('f1103-race:actor:customer','sha256'),'hex'),
        encode(extensions.digest('f1103-race:network','sha256'),'hex'));
    end if;

    if dblink_send_query(v_first_conn, v_sql_a) <> 1 then
      raise exception 'could not start the operator writer';
    end if;

    v_first_waited := false;
    for i in 1..150 loop
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
      raise exception 'scenario %: the operator writer never reached the group lock', v_scenario;
    end if;

    if dblink_send_query(v_second_conn, v_sql_b) <> 1 then
      raise exception 'could not start the second writer';
    end if;

    v_blocked := 0;
    for i in 1..150 loop
      perform pg_stat_clear_snapshot();
      select count(*)::integer into v_blocked
      from pg_stat_activity
      where application_name in ('f1103_race_a','f1103_race_b')
        and wait_event_type = 'Lock';
      exit when v_blocked = 2;
      perform pg_sleep(0.01);
    end loop;
    if v_blocked <> 2 then
      raise exception 'scenario %: writers did not both block on the group lock (blocked=%)',
        v_scenario, v_blocked;
    end if;

    perform pg_advisory_unlock(v_lock_key);
    v_lock_held := false;

    -- Collect whichever writer finishes first and end that remote transaction
    -- before waiting on the other: the winner holds the group row until commit.
    for i in 1..2 loop
      v_conn := null;
      for j in 1..3000 loop
        if not v_a_done and dblink_is_busy('f1103_race_a') = 0 then
          v_conn := 'f1103_race_a';
          exit;
        elsif not v_b_done and dblink_is_busy('f1103_race_b') = 0 then
          v_conn := 'f1103_race_b';
          exit;
        end if;
        perform pg_sleep(0.01);
      end loop;
      if v_conn is null then
        raise exception 'scenario %: timed out waiting for a race writer result', v_scenario;
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

      -- The operator RPC raises; the public dispatcher catches and answers with
      -- an envelope so its rate-limit counter can still commit. Both shapes are
      -- a loss, and both must name the conflict.
      if v_query_failed then
        v_succeeded := false;
        v_current_error := coalesce(v_current_error,'');
      elsif v_result ? 'ok' then
        v_succeeded := v_result->>'ok' = 'true';
        if not v_succeeded then
          v_current_error := coalesce(v_result#>>'{error,message}','');
        end if;
      else
        if v_result_rows <> 1 or v_result is null or v_result->>'groupId' is null then
          raise exception 'writer % returned an invalid result: %', v_conn, v_result;
        end if;
        v_succeeded := true;
      end if;

      if v_succeeded then
        perform dblink_exec(v_conn,'commit');
        v_ok := v_ok + 1;
        v_winner_conn := v_conn;
      else
        v_error := coalesce(v_error, v_current_error);
        v_failed := v_failed + 1;
        -- A caught envelope leaves a live transaction; commit it exactly as the
        -- Worker does so the quota write is not silently discarded.
        if v_query_failed then
          perform dblink_exec(v_conn,'rollback');
        else
          perform dblink_exec(v_conn,'commit');
        end if;
      end if;

      if v_conn = 'f1103_race_a' then v_a_done := true; else v_b_done := true; end if;
    end loop;

    perform dblink_disconnect('f1103_race_a');
    perform dblink_disconnect('f1103_race_b');

    if v_ok <> 1 or v_failed <> 1 then
      raise exception 'scenario % expected exactly one winner, got ok=% failed=%',
        v_scenario, v_ok, v_failed;
    end if;
    if v_winner_conn <> v_first_conn then
      raise exception 'scenario % expected the queued writer % to win, got %',
        v_scenario, v_first_conn, v_winner_conn;
    end if;
    if v_error is null or v_error not like '%BOOKING_GROUP_VERSION_CONFLICT%' then
      raise exception 'scenario % loser did not report the version conflict: %',
        v_scenario, coalesce(v_error,'<null>');
    end if;

    -- One move happened, and it is the winner's. No line was left behind at the
    -- old start and none followed the loser's target.
    select g.version into v_version
    from public.appointment_groups g where g.id = v_group;
    if v_version <> v_scenario + 1 then
      raise exception 'scenario % expected version %, found %',
        v_scenario, v_scenario + 1, v_version;
    end if;

    select count(*)::integer, count(distinct a.starts_at)::integer
    into v_lines, v_distinct
    from public.appointments a where a.group_id = v_group;
    if v_lines <> 2 then
      raise exception 'scenario % expected two lines, found %', v_scenario, v_lines;
    end if;
    if v_distinct <> 2 then
      raise exception 'scenario % expected two consecutive line starts, found % distinct',
        v_scenario, v_distinct;
    end if;
    if not exists (
      select 1 from public.appointments a
      where a.group_id = v_group and a.line_ordinal = 1 and a.starts_at = v_target_a
    ) then
      raise exception 'scenario % did not land the group on the winner target', v_scenario;
    end if;
    if exists (
      select 1 from public.appointments a
      where a.group_id = v_group and a.starts_at = v_target_b
    ) then
      raise exception 'scenario % left a line on the loser target (half move)', v_scenario;
    end if;

    select count(*)::integer into v_commands
    from public.booking_commands bc
    where bc.business_id = v_business and bc.idempotency_key = v_key_b;
    if v_commands <> 0 then
      raise exception 'scenario % recorded a command for the losing key', v_scenario;
    end if;
    select count(*)::integer into v_commands
    from public.booking_commands bc
    where bc.business_id = v_business and bc.idempotency_key = v_key_a;
    if v_commands <> 1 then
      raise exception 'scenario % expected one winning command, found %', v_scenario, v_commands;
    end if;
  end loop;

  raise notice 'F11-03 operator/operator and operator/customer group races accepted: one winner each, no half move';
exception when others then
  if v_lock_held then perform pg_advisory_unlock(v_lock_key); end if;
  begin perform dblink_exec('f1103_race_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('f1103_race_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1103_race_a'); exception when others then null; end;
  begin perform dblink_disconnect('f1103_race_b'); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses where id = 'd1810000-0000-4000-8000-000000000001';
