create extension if not exists dblink;

delete from public.businesses where id='e1510000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('e1500000-0000-4000-8000-000000000001','f1402-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('e1510000-0000-4000-8000-000000000001','F14-02 Race Salon','f1402-race-salon','Europe/Istanbul','e1500000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('e1520000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','e1500000-0000-4000-8000-000000000001','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'e1530000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001',
  'F14 Race Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values ('e1540000-0000-4000-8000-000000000001','e1510000-0000-4000-8000-000000000001','F14 Race Staff',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'e1510000-0000-4000-8000-000000000001',
  'e1540000-0000-4000-8000-000000000001',
  'e1530000-0000-4000-8000-000000000001',
  true
);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'e1510000-0000-4000-8000-000000000001',
       extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
       time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'e1510000-0000-4000-8000-000000000001'::uuid,
       'e1540000-0000-4000-8000-000000000001'::uuid,
       extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
       time '09:00',time '18:00',true;

set role authenticated;
select set_config('request.jwt.claim.sub','e1500000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_group jsonb;
begin
  v_group := public.create_appointment_group(
    'e1510000-0000-4000-8000-000000000001',
    'f1402-race-booking',
    'F14 Race Customer',
    '[{"serviceId":"e1530000-0000-4000-8000-000000000001","staffId":"e1540000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day + time '14:00') at time zone 'Europe/Istanbul',
    '05559990000'
  );
  perform set_config('f1402.race_group',v_group->>'groupId',false);
end
$$;

reset role;

do $$
declare
  v_business uuid := 'e1510000-0000-4000-8000-000000000001';
  v_owner uuid := 'e1500000-0000-4000-8000-000000000001';
  v_group uuid := current_setting('f1402.race_group')::uuid;
  v_lock_key bigint := hashtextextended(
    v_business::text || ':ticket-group:' || v_group::text, 0
  );
  v_conn text;
  v_sql_a text;
  v_sql_b text;
  v_blocked integer := 0;
  v_result_a jsonb;
  v_result_b jsonb;
  v_finished integer := 0;
  v_result jsonb;
  v_rows integer;
  v_drain integer;
begin
  for v_conn in select unnest(array['f1402_ticket_a','f1402_ticket_b']) loop
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

  v_sql_a := format($q$
    select public.open_ticket_from_booking_group_guarded(
      %L::uuid,%L::uuid,%L,%L
    )
  $q$,v_business,v_group,'f1402-race-ticket-a',repeat('a',64));

  v_sql_b := format($q$
    select public.open_ticket_from_booking_group_guarded(
      %L::uuid,%L::uuid,%L,%L
    )
  $q$,v_business,v_group,'f1402-race-ticket-b',repeat('b',64));

  if dblink_send_query('f1402_ticket_a',v_sql_a) <> 1
     or dblink_send_query('f1402_ticket_b',v_sql_b) <> 1 then
    raise exception 'F14 could not start ticket race writers';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1402_ticket_a','f1402_ticket_b')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;

  if v_blocked <> 2 then
    raise exception 'F14 ticket race did not park both writers on the canonical group lock: %',v_blocked;
  end if;

  perform pg_advisory_unlock(v_lock_key);

  while v_finished < 2 loop
    v_conn := null;
    for i in 1..3000 loop
      if v_result_a is null and dblink_is_busy('f1402_ticket_a')=0 then
        v_conn := 'f1402_ticket_a'; exit;
      elsif v_result_b is null and dblink_is_busy('f1402_ticket_b')=0 then
        v_conn := 'f1402_ticket_b'; exit;
      end if;
      perform pg_sleep(0.01);
    end loop;

    if v_conn is null then raise exception 'F14 timed out waiting for ticket race result'; end if;

    select t.result into strict v_result
    from dblink_get_result(v_conn) as t(result jsonb);
    get diagnostics v_rows=row_count;
    if v_rows<>1 or v_result->>'ticketId' is null then
      raise exception 'F14 race writer returned invalid ticket result: %',v_result;
    end if;

    perform * from dblink_get_result(v_conn,false) as t(result jsonb);
    get diagnostics v_drain=row_count;
    if v_drain<>0 then raise exception 'F14 race writer had trailing rows'; end if;

    perform dblink_exec(v_conn,'commit');

    if v_conn='f1402_ticket_a' then
      v_result_a:=v_result;
    else
      v_result_b:=v_result;
    end if;
    v_finished:=v_finished+1;
  end loop;

  perform dblink_disconnect('f1402_ticket_a');
  perform dblink_disconnect('f1402_ticket_b');

  if v_result_a->>'ticketId' <> v_result_b->>'ticketId' then
    raise exception 'F14 concurrent ticket opens diverged: % vs %',
      v_result_a->>'ticketId',v_result_b->>'ticketId';
  end if;

  if (
    select count(*)
    from public.tickets
    where business_id=v_business and appointment_group_id=v_group
  ) <> 1 then
    raise exception 'F14 concurrent open persisted more than one ticket';
  end if;

  if (
    select count(*)
    from public.ticket_commands
    where business_id=v_business
      and command='open_from_booking_group'
      and ticket_id=(v_result_a->>'ticketId')::uuid
  ) <> 2 then
    raise exception 'F14 race did not preserve both idempotent command receipts';
  end if;

  raise notice 'F14-02 concurrent booking-group open converged to one ticket';
exception when others then
  begin perform pg_advisory_unlock(v_lock_key); exception when others then null; end;
  for v_conn in select unnest(array['f1402_ticket_a','f1402_ticket_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$$;

-- The CI database is disposable. Deliberately do not delete the business here:
-- F14 financial tickets are retention-protected and business deletion must not
-- cascade through immutable financial history.
