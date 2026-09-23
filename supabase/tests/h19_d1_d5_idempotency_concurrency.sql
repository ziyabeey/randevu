create extension if not exists dblink;

-- H19 prospective D1 x D5 coverage probe: idempotency x concurrency.
--
-- Two physical PostgreSQL sessions submit the same first booking-command claim
-- for the same tenant, key and request hash. The command ledger must serialize
-- that identity atomically. One session may establish the claim; the other must
-- observe the already-active claim through the stable IDEMPOTENCY_IN_PROGRESS
-- result, never a raw uniqueness error.
--
-- This scenario is intentionally separate from:
--   * sequential same-key retry tests; and
--   * concurrent booking tests that use distinct idempotency keys.

delete from public.businesses
where id='b2910000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values (
  'b2900000-0000-4000-8000-000000000001',
  'h19-d1d5-owner@example.invalid',
  '{}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'b2910000-0000-4000-8000-000000000001',
  'H19 D1D5 Booking Ledger',
  'h19-d1d5-booking-ledger',
  'Europe/Istanbul',
  'b2900000-0000-4000-8000-000000000001'
);

do $$
declare
  v_business uuid := 'b2910000-0000-4000-8000-000000000001';
  v_user uuid := 'b2900000-0000-4000-8000-000000000001';
  v_key text := 'h19-d1d5-shared-0001';
  v_hash text := md5('h19-d1d5-same-request');
  v_conn text;
  v_blocked integer := 0;
  v_a_done boolean := false;
  v_b_done boolean := false;
  v_success integer := 0;
  v_progress integer := 0;
  v_is_new boolean;
  v_appointment uuid;
  v_error text;
  v_result_rows integer;
  v_drain_rows integer;
begin
  perform dblink_connect(
    'h19_d1d5_locker',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d1d5_locker'
  );
  perform dblink_exec('h19_d1d5_locker','begin');
  perform dblink_exec(
    'h19_d1d5_locker',
    'lock table public.booking_commands in share mode'
  );

  for v_conn in select unnest(array['h19_d1d5_a','h19_d1d5_b']) loop
    perform dblink_connect(
      v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_conn
    );
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(
      v_conn,
      'set local "request.jwt.claim.sub" = '''||v_user::text||''''
    );
  end loop;

  if dblink_send_query(
    'h19_d1d5_a',
    format(
      $q$select c.is_new,c.appointment_id
         from public.claim_booking_command(%L::uuid,%L,%L,%L,null) c$q$,
      v_business,v_key,'create',v_hash
    )
  ) <> 1 then
    raise exception 'H19 D1xD5 session A did not start';
  end if;

  if dblink_send_query(
    'h19_d1d5_b',
    format(
      $q$select c.is_new,c.appointment_id
         from public.claim_booking_command(%L::uuid,%L,%L,%L,null) c$q$,
      v_business,v_key,'create',v_hash
    )
  ) <> 1 then
    raise exception 'H19 D1xD5 session B did not start';
  end if;

  -- Both sessions must reach the same command-table write boundary before the
  -- locker is released, making this a real two-session first-claim exercise.
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('h19_d1d5_a','h19_d1d5_b')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;
  if v_blocked<>2 then
    raise exception 'H19 D1xD5 expected two waiting claim sessions, observed %',v_blocked;
  end if;

  perform dblink_exec('h19_d1d5_locker','commit');
  perform dblink_disconnect('h19_d1d5_locker');

  -- Collect whichever session finishes first. The successful claimant must
  -- commit before the second session can classify the same ledger identity.
  for pass in 1..2 loop
    v_conn := null;

    for attempt in 1..3000 loop
      if not v_a_done and dblink_is_busy('h19_d1d5_a')=0 then
        v_conn := 'h19_d1d5_a';
        exit;
      elsif not v_b_done and dblink_is_busy('h19_d1d5_b')=0 then
        v_conn := 'h19_d1d5_b';
        exit;
      end if;
      perform pg_sleep(0.01);
    end loop;

    if v_conn is null then
      raise exception 'H19 D1xD5 timed out waiting for a claim result';
    end if;

    v_is_new := null;
    v_appointment := null;
    v_error := null;
    v_result_rows := 0;

    begin
      select t.is_new,t.appointment_id
      into strict v_is_new,v_appointment
      from dblink_get_result(v_conn) as t(is_new boolean,appointment_id uuid);
      get diagnostics v_result_rows=row_count;

      perform * from dblink_get_result(v_conn,false)
        as t(is_new boolean,appointment_id uuid);
      get diagnostics v_drain_rows=row_count;
      if v_drain_rows<>0 then
        raise exception 'H19 D1xD5 session % returned trailing rows',v_conn;
      end if;

      if v_result_rows<>1 or v_is_new is distinct from true
         or v_appointment is not null then
        raise exception 'H19 D1xD5 unexpected successful claim result from %',v_conn;
      end if;

      perform dblink_exec(v_conn,'commit');
      v_success := v_success+1;
    exception when others then
      v_error := sqlerrm;
      begin
        perform * from dblink_get_result(v_conn,false)
          as t(is_new boolean,appointment_id uuid);
      exception when others then
        null;
      end;

      if position('IDEMPOTENCY_IN_PROGRESS' in v_error)>0 then
        perform dblink_exec(v_conn,'rollback');
        v_progress := v_progress+1;
      else
        raise exception 'H19 D1xD5 unexpected concurrent claim classification: %',v_error;
      end if;
    end;

    if v_conn='h19_d1d5_a' then
      v_a_done:=true;
    else
      v_b_done:=true;
    end if;
  end loop;

  perform dblink_disconnect('h19_d1d5_a');
  perform dblink_disconnect('h19_d1d5_b');

  if v_success<>1 or v_progress<>1 then
    raise exception
      'H19 D1xD5 expected one initial claim and one in-progress replay, got success=% progress=%',
      v_success,v_progress;
  end if;

  if (
    select count(*)
    from public.booking_commands bc
    where bc.business_id=v_business and bc.idempotency_key=v_key
  )<>1 then
    raise exception 'H19 D1xD5 command identity did not converge to one ledger row';
  end if;

  raise notice
    'H19 D1xD5 prospective invariant accepted: same-key concurrent first claims serialize to one command identity';
exception when others then
  begin perform dblink_exec('h19_d1d5_locker','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d1d5_locker'); exception when others then null; end;
  begin perform dblink_exec('h19_d1d5_a','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d1d5_a'); exception when others then null; end;
  begin perform dblink_exec('h19_d1d5_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d1d5_b'); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses
where id='b2910000-0000-4000-8000-000000000001';
delete from auth.users
where id='b2900000-0000-4000-8000-000000000001';
