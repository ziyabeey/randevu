create extension if not exists dblink;

-- F16-05: two concurrent writers on two different tickets race for the last
-- session of the same customer package. The package row lock serializes them:
-- exactly one covers its line and the other is refused with PACKAGE_EXHAUSTED.

insert into auth.users(id,email,raw_user_meta_data)
values ('f1660000-0000-4000-8000-000000000001','f1605-race@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1661000-0000-4000-8000-000000000001',
  'F16-05 Race Salon',
  'f1605-race-salon',
  'Europe/Istanbul',
  'f1660000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1662000-0000-4000-8000-000000000001',
  'f1661000-0000-4000-8000-000000000001',
  'f1660000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.customers(id,business_id,name,phone,created_by)
values (
  'f1663000-0000-4000-8000-000000000001',
  'f1661000-0000-4000-8000-000000000001',
  'F16-05 Race Customer',
  '05551660000',
  'f1660000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1664000-0000-4000-8000-000000000001',
  'f1661000-0000-4000-8000-000000000001',
  'F16-05 Race Lazer',
  30,0,0,'Genel',10,30000,'fixed',30000,30000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','f1660000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $f1605setup$
declare
  v_business uuid := 'f1661000-0000-4000-8000-000000000001';
  v_customer uuid := 'f1663000-0000-4000-8000-000000000001';
  v_service uuid := 'f1664000-0000-4000-8000-000000000001';
  v_sale jsonb;
  v_ticket jsonb;
  v_name text;
begin
  perform public.create_service_package_guarded(
    v_business,'f1665000-0000-4000-8000-000000000001',v_service,'Tek Seans',1,30,25000);
  v_sale := public.open_package_sale_guarded(
    v_business,v_customer,'f1665000-0000-4000-8000-000000000001',1,'f1605-race-sale',repeat('1',64));
  v_sale := public.record_ticket_payment_guarded(
    v_business,(v_sale->>'ticketId')::uuid,'cash',25000,'f1605-race-pay',repeat('2',64));
  v_sale := public.close_ticket_guarded(
    v_business,(v_sale->>'ticketId')::uuid,(v_sale->>'version')::int,'f1605-race-close',repeat('3',64));
  perform set_config('f1605.race_package',v_sale->'lines'->0->'soldPackage'->>'customerPackageId',false);

  foreach v_name in array array['a','b'] loop
    v_ticket := public.open_walk_in_ticket_guarded(
      v_business,v_customer,'f1605-race-open-'||v_name,repeat('4',63)||v_name);
    v_ticket := public.add_ticket_service_line_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_service,null,
      (v_ticket->>'version')::int,'f1605-race-add-'||v_name,repeat('5',63)||v_name);
    perform set_config('f1605.race_ticket_'||v_name,v_ticket->>'ticketId',false);
    perform set_config('f1605.race_line_'||v_name,v_ticket->'lines'->0->>'lineId',false);
  end loop;
end
$f1605setup$;

reset role;

do $f1605race$
declare
  v_business uuid := 'f1661000-0000-4000-8000-000000000001';
  v_owner uuid := 'f1660000-0000-4000-8000-000000000001';
  v_package uuid := current_setting('f1605.race_package')::uuid;
  v_conn text;
  v_sql_a text;
  v_sql_b text;
  v_blocked integer := 0;
  v_rows integer;
  v_drain integer;
  v_result jsonb;
  v_successes integer := 0;
  v_failures integer := 0;
  v_finished integer := 0;
  v_done_a boolean := false;
  v_done_b boolean := false;
  v_error text;
  v_used integer;
  v_uses integer;
begin
  perform dblink_connect(
    'f1605_blocker',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1605_blocker'
  );
  perform dblink_exec('f1605_blocker','begin');
  perform dblink_exec(
    'f1605_blocker',
    format(
      'do $block$ begin perform 1 from public.customer_packages where business_id=%L::uuid and id=%L::uuid for update; end $block$;',
      v_business,
      v_package
    )
  );

  for v_conn in select unnest(array['f1605_use_a','f1605_use_b']) loop
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

  v_sql_a := format($q$
    select public.apply_ticket_package_guarded(%L::uuid,%L::uuid,%L::uuid,%L::uuid,2,%L,%L)
  $q$,v_business,current_setting('f1605.race_ticket_a'),current_setting('f1605.race_line_a'),
      v_package,'f1605-race-use-a',repeat('a',64));
  v_sql_b := format($q$
    select public.apply_ticket_package_guarded(%L::uuid,%L::uuid,%L::uuid,%L::uuid,2,%L,%L)
  $q$,v_business,current_setting('f1605.race_ticket_b'),current_setting('f1605.race_line_b'),
      v_package,'f1605-race-use-b',repeat('b',64));

  if dblink_send_query('f1605_use_a',v_sql_a) <> 1
     or dblink_send_query('f1605_use_b',v_sql_b) <> 1 then
    raise exception 'F16-05 could not start concurrent package writers';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1605_use_a','f1605_use_b')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;

  if v_blocked <> 2 then
    raise exception 'F16-05 package writers did not both park on the package row lock: %',v_blocked;
  end if;

  perform dblink_exec('f1605_blocker','commit');
  perform dblink_disconnect('f1605_blocker');

  -- Consume whichever writer finishes first (see F14-03 harness).
  while v_finished < 2 loop
    v_conn := null;
    for i in 1..6000 loop
      if not v_done_a and dblink_is_busy('f1605_use_a')=0 then
        v_conn := 'f1605_use_a';
        exit;
      elsif not v_done_b and dblink_is_busy('f1605_use_b')=0 then
        v_conn := 'f1605_use_b';
        exit;
      end if;
      perform pg_sleep(0.01);
    end loop;
    if v_conn is null then
      raise exception 'F16-05 timed out waiting for either package race writer';
    end if;

    v_result := null;
    v_error := null;
    v_rows := 0;
    begin
      select t.result into v_result
      from dblink_get_result(v_conn,false) as t(result jsonb);
      get diagnostics v_rows=row_count;
    exception when others then
      v_rows:=0;
    end;
    if v_rows<>1 then
      v_error:=dblink_error_message(v_conn);
    end if;

    perform * from dblink_get_result(v_conn,false) as t(result jsonb);
    get diagnostics v_drain=row_count;
    if v_drain<>0 or dblink_is_busy(v_conn)<>0 then
      raise exception 'F16-05 package race writer had trailing async results on %',v_conn;
    end if;

    if v_rows=1 and v_result ? 'ticketId' then
      v_successes:=v_successes+1;
      perform dblink_exec(v_conn,'commit');
    else
      if position('PACKAGE_EXHAUSTED' in coalesce(v_error,''))=0 then
        raise exception 'F16-05 losing package writer failed for unexpected reason on %: %',v_conn,v_error;
      end if;
      v_failures:=v_failures+1;
      perform dblink_exec(v_conn,'rollback');
    end if;

    perform dblink_disconnect(v_conn);
    if v_conn='f1605_use_a' then v_done_a:=true; else v_done_b:=true; end if;
    v_finished:=v_finished+1;
  end loop;

  if v_successes<>1 or v_failures<>1 then
    raise exception 'F16-05 last-session race expected 1 success/1 failure, got %/%',v_successes,v_failures;
  end if;

  select cp.sessions_used into v_used
  from public.customer_packages cp
  where cp.business_id=v_business and cp.id=v_package;
  select count(*)::integer into v_uses
  from public.customer_package_usages u
  where u.business_id=v_business and u.customer_package_id=v_package and u.kind='use';
  if v_used<>1 or v_uses<>1 then
    raise exception 'F16-05 last session consumed twice: used=% uses=%',v_used,v_uses;
  end if;

  raise notice 'F16-05 concurrent last-session race consumed exactly one right';
exception when others then
  begin perform dblink_exec('f1605_blocker','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1605_blocker'); exception when others then null; end;
  for v_conn in select unnest(array['f1605_use_a','f1605_use_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$f1605race$;

-- The CI database is disposable; financial history is deliberately not deleted.
