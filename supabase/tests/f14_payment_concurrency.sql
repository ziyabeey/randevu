create extension if not exists dblink;

delete from public.businesses where id='f1710000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f1700000-0000-4000-8000-000000000001','f1403-race@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1710000-0000-4000-8000-000000000001',
  'F14-03 Race Salon',
  'f1403-race-salon',
  'Europe/Istanbul',
  'f1700000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1720000-0000-4000-8000-000000000001',
  'f1710000-0000-4000-8000-000000000001',
  'f1700000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.customers(id,business_id,name,phone,created_by)
values (
  'f1730000-0000-4000-8000-000000000001',
  'f1710000-0000-4000-8000-000000000001',
  'F14-03 Race Customer',
  '05557770000',
  'f1700000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1740000-0000-4000-8000-000000000001',
  'f1710000-0000-4000-8000-000000000001',
  'F14-03 Race 600',
  30,0,0,'Genel',10,60000,'fixed',60000,60000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','f1700000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $f1403setup$
declare
  v_ticket jsonb;
begin
  v_ticket := public.open_walk_in_ticket_guarded(
    'f1710000-0000-4000-8000-000000000001',
    'f1730000-0000-4000-8000-000000000001',
    'f1403-race-open',
    repeat('1',64)
  );
  v_ticket := public.add_ticket_service_line_guarded(
    'f1710000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'f1740000-0000-4000-8000-000000000001',
    null,1,
    'f1403-race-add',
    repeat('2',64)
  );
  perform set_config('f1403.race_ticket',v_ticket->>'ticketId',false);
end
$f1403setup$;

reset role;

do $f1403race$
declare
  v_ticket uuid := current_setting('f1403.race_ticket')::uuid;
  v_business uuid := 'f1710000-0000-4000-8000-000000000001';
  v_owner uuid := 'f1700000-0000-4000-8000-000000000001';
  v_conn text;
  v_sql_a text;
  v_sql_b text;
  v_blocked integer := 0;
  v_rows integer;
  v_drain integer;
  v_result jsonb;
  v_successes integer := 0;
  v_failures integer := 0;
  v_error text;
  v_projection jsonb;
begin
  perform dblink_connect(
    'f1403_blocker',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1403_blocker'
  );
  perform dblink_exec('f1403_blocker','begin');
  perform dblink_exec(
    'f1403_blocker',
    format(
      'do $block$ begin perform 1 from public.tickets where business_id=%L::uuid and id=%L::uuid for update; end $block$;',
      v_business,
      v_ticket
    )
  );

  for v_conn in select unnest(array['f1403_pay_a','f1403_pay_b']) loop
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
    select public.record_ticket_payment_guarded(
      %L::uuid,%L::uuid,'cash',40000,%L,%L
    )
  $q$,v_business,v_ticket,'f1403-race-pay-a',repeat('a',64));

  v_sql_b := format($q$
    select public.record_ticket_payment_guarded(
      %L::uuid,%L::uuid,'card',40000,%L,%L
    )
  $q$,v_business,v_ticket,'f1403-race-pay-b',repeat('b',64));

  if dblink_send_query('f1403_pay_a',v_sql_a) <> 1
     or dblink_send_query('f1403_pay_b',v_sql_b) <> 1 then
    raise exception 'F14-03 could not start concurrent payment writers';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1403_pay_a','f1403_pay_b')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;

  if v_blocked <> 2 then
    raise exception 'F14-03 payment writers did not both park on ticket row lock: %',v_blocked;
  end if;

  perform dblink_exec('f1403_blocker','commit');
  perform dblink_disconnect('f1403_blocker');

  for v_conn in select unnest(array['f1403_pay_a','f1403_pay_b']) loop
    for i in 1..3000 loop
      exit when dblink_is_busy(v_conn)=0;
      perform pg_sleep(0.01);
    end loop;

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

    -- Async dblink keeps a terminal empty result frame after the statement
    -- result/error. Drain it before COMMIT/ROLLBACK so the connection is idle.
    perform * from dblink_get_result(v_conn,false) as t(result jsonb);
    get diagnostics v_drain=row_count;
    if v_drain<>0 or dblink_is_busy(v_conn)<>0 then
      raise exception 'F14-03 payment race writer had trailing async results on %',v_conn;
    end if;

    if v_rows=1 and v_result->>'ticketId'=v_ticket::text then
      v_successes:=v_successes+1;
      perform dblink_exec(v_conn,'commit');
    else
      if position('OVERPAYMENT' in coalesce(v_error,''))=0 then
        raise exception 'F14-03 losing race writer failed for unexpected reason on %: %',v_conn,v_error;
      end if;
      v_failures:=v_failures+1;
      perform dblink_exec(v_conn,'rollback');
    end if;

    perform dblink_disconnect(v_conn);
  end loop;

  if v_successes<>1 or v_failures<>1 then
    raise exception 'F14-03 overpayment race expected 1 success/1 failure, got %/%',v_successes,v_failures;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

  v_projection:=public.get_ticket_contract(v_business,v_ticket);
  if (v_projection->>'paidMinor')::int<>40000
     or (v_projection->>'balanceMinor')::int<>20000
     or v_projection->>'paymentStatus'<>'partial' then
    raise exception 'F14-03 concurrent payment race corrupted balance: %',v_projection;
  end if;

  v_projection:=public.record_ticket_payment_guarded(
    v_business,v_ticket,'cash',20000,
    'f1403-race-settle',
    repeat('c',64)
  );
  if (v_projection->>'paidMinor')::int<>60000
     or (v_projection->>'balanceMinor')::int<>0
     or v_projection->>'paymentStatus'<>'paid' then
    raise exception 'F14-03 race ticket could not settle after bounded loser: %',v_projection;
  end if;

  reset role;
  raise notice 'F14-03 concurrent overpayment race preserved nonnegative balance';
exception when others then
  begin perform dblink_exec('f1403_blocker','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1403_blocker'); exception when others then null; end;
  for v_conn in select unnest(array['f1403_pay_a','f1403_pay_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$f1403race$;

-- The CI database is disposable. Deliberately do not delete the business here:
-- F14 financial tickets/payment events are retention-protected and business
-- deletion must not cascade through immutable financial history.
