create extension if not exists dblink;

-- H19 prospective D1 x D5 coverage probe: idempotency x concurrency.
--
-- Two physical PostgreSQL sessions submit the same first booking-command claim
-- for the same tenant, key and request hash. The first session deliberately
-- keeps its transaction open after establishing the claim. The second session
-- must wait on that exact command identity and then classify the replay through
-- the stable idempotency contract rather than surface a raw uniqueness error.
--
-- This scenario is intentionally separate from sequential same-key retry tests
-- and concurrent booking tests that use distinct idempotency keys.

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
  v_command text;
  v_a_waited boolean := false;
  v_b_waited boolean := false;
  v_a_new boolean;
  v_a_appointment uuid;
  v_b_error text;
  v_result_rows integer;
  v_drain_rows integer;
begin
  v_command := format(
    $q$select c.is_new,c.appointment_id
       from public.claim_booking_command(%L::uuid,%L,%L,%L,null) c$q$,
    v_business,v_key,'create',v_hash
  );

  perform dblink_connect(
    'h19_d1d5_a',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d1d5_a'
  );
  perform dblink_connect(
    'h19_d1d5_b',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d1d5_b'
  );

  for v_conn in select unnest(array['h19_d1d5_a','h19_d1d5_b']) loop
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(
      v_conn,
      'set local "request.jwt.claim.sub" = '''||v_user::text||''''
    );
  end loop;

  -- A establishes the first claim, then remains active for two seconds so B can
  -- reach the same unique command identity while A's row is still uncommitted.
  if dblink_send_query(
    'h19_d1d5_a',
    v_command ||
      ' cross join lateral (select pg_sleep(2) where c.is_new is not null) hold_claim'
  ) <> 1 then
    raise exception 'H19 D1xD5 session A did not start';
  end if;

  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
      from pg_stat_activity
      where application_name='h19_d1d5_a'
        and wait_event_type='Timeout'
        and wait_event='PgSleep'
    ) then
      v_a_waited:=true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_a_waited then
    raise exception 'H19 D1xD5 session A did not hold the active claim window';
  end if;

  if dblink_send_query('h19_d1d5_b',v_command)<>1 then
    raise exception 'H19 D1xD5 session B did not start';
  end if;

  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
      from pg_stat_activity
      where application_name='h19_d1d5_b'
        and wait_event_type='Lock'
    ) then
      v_b_waited:=true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_b_waited then
    raise exception 'H19 D1xD5 session B did not wait on the active claim';
  end if;

  select t.is_new,t.appointment_id
  into strict v_a_new,v_a_appointment
  from dblink_get_result('h19_d1d5_a')
    as t(is_new boolean,appointment_id uuid);
  get diagnostics v_result_rows=row_count;

  perform * from dblink_get_result('h19_d1d5_a',false)
    as t(is_new boolean,appointment_id uuid);
  get diagnostics v_drain_rows=row_count;

  if v_result_rows<>1 or v_drain_rows<>0
     or v_a_new is distinct from true
     or v_a_appointment is not null then
    raise exception 'H19 D1xD5 session A returned an unexpected initial claim result';
  end if;

  perform dblink_exec('h19_d1d5_a','commit');

  begin
    perform *
    from dblink_get_result('h19_d1d5_b')
      as t(is_new boolean,appointment_id uuid);
    raise exception 'H19 D1xD5 session B unexpectedly returned a normal claim row';
  exception when others then
    v_b_error:=sqlerrm;
  end;

  begin
    perform * from dblink_get_result('h19_d1d5_b',false)
      as t(is_new boolean,appointment_id uuid);
  exception when others then
    null;
  end;
  perform dblink_exec('h19_d1d5_b','rollback');

  if position('IDEMPOTENCY_IN_PROGRESS' in coalesce(v_b_error,''))=0 then
    raise exception
      'H19 D1xD5 replay classification mismatch: %',
      coalesce(v_b_error,'<no error>');
  end if;

  perform dblink_disconnect('h19_d1d5_a');
  perform dblink_disconnect('h19_d1d5_b');

  if (
    select count(*)
    from public.booking_commands bc
    where bc.business_id=v_business and bc.idempotency_key=v_key
  )<>1 then
    raise exception 'H19 D1xD5 command identity did not converge to one ledger row';
  end if;

  raise notice
    'H19 D1xD5 prospective invariant accepted: concurrent same-key claims remain one command identity';
exception when others then
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
