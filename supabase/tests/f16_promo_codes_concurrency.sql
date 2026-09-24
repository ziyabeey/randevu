create extension if not exists dblink;

-- F16-06: two concurrent writers on two different tickets race for the last
-- usage slot of the same promo code. The promo_codes row lock serializes them:
-- exactly one reserves the slot and the other is refused with PROMO_EXHAUSTED.

insert into auth.users(id,email,raw_user_meta_data)
values ('f1680000-0000-4000-8000-000000000001','f1606-race@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1681000-0000-4000-8000-000000000001',
  'F16-06 Race Salon',
  'f1606-race-salon',
  'Europe/Istanbul',
  'f1680000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1682000-0000-4000-8000-000000000001',
  'f1681000-0000-4000-8000-000000000001',
  'f1680000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.customers(id,business_id,name,phone,created_by)
values (
  'f1683000-0000-4000-8000-000000000001',
  'f1681000-0000-4000-8000-000000000001',
  'F16-06 Race Customer',
  '05551680000',
  'f1680000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1684000-0000-4000-8000-000000000001',
  'f1681000-0000-4000-8000-000000000001',
  'F16-06 Race Kesim',
  30,0,0,'Genel',10,30000,'fixed',30000,30000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','f1680000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $f1606setup$
declare
  v_business uuid := 'f1681000-0000-4000-8000-000000000001';
  v_customer uuid := 'f1683000-0000-4000-8000-000000000001';
  v_service uuid := 'f1684000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_name text;
begin
  perform public.create_promo_code_guarded(
    v_business,'f1685000-0000-4000-8000-000000000001','SONHAK','percent',1000,null,
    now() - interval '1 day', null, 1, '{}'::uuid[]);
  perform set_config('f1606.race_promo','f1685000-0000-4000-8000-000000000001',false);

  foreach v_name in array array['a','b'] loop
    v_ticket := public.open_walk_in_ticket_guarded(
      v_business,v_customer,'f1606-race-open-'||v_name,repeat('4',63)||v_name);
    v_ticket := public.add_ticket_service_line_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_service,null,
      (v_ticket->>'version')::int,'f1606-race-add-'||v_name,repeat('5',63)||v_name);
    perform set_config('f1606.race_ticket_'||v_name,v_ticket->>'ticketId',false);
  end loop;
end
$f1606setup$;

reset role;

do $f1606race$
declare
  v_business uuid := 'f1681000-0000-4000-8000-000000000001';
  v_owner uuid := 'f1680000-0000-4000-8000-000000000001';
  v_promo uuid := current_setting('f1606.race_promo')::uuid;
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
  v_uses integer;
begin
  perform dblink_connect(
    'f1606_blocker',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1606_blocker'
  );
  perform dblink_exec('f1606_blocker','begin');
  perform dblink_exec(
    'f1606_blocker',
    format(
      'do $block$ begin perform 1 from public.promo_codes where business_id=%L::uuid and id=%L::uuid for update; end $block$;',
      v_business,
      v_promo
    )
  );

  for v_conn in select unnest(array['f1606_use_a','f1606_use_b']) loop
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
    select public.apply_ticket_promo_guarded(%L::uuid,%L::uuid,'SONHAK',2,%L,%L)
  $q$,v_business,current_setting('f1606.race_ticket_a'),'f1606-race-use-a',repeat('a',64));
  v_sql_b := format($q$
    select public.apply_ticket_promo_guarded(%L::uuid,%L::uuid,'SONHAK',2,%L,%L)
  $q$,v_business,current_setting('f1606.race_ticket_b'),'f1606-race-use-b',repeat('b',64));

  if dblink_send_query('f1606_use_a',v_sql_a) <> 1
     or dblink_send_query('f1606_use_b',v_sql_b) <> 1 then
    raise exception 'F16-06 could not start concurrent promo writers';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1606_use_a','f1606_use_b')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;

  if v_blocked <> 2 then
    raise exception 'F16-06 promo writers did not both park on the promo row lock: %',v_blocked;
  end if;

  perform dblink_exec('f1606_blocker','commit');
  perform dblink_disconnect('f1606_blocker');

  -- Consume whichever writer finishes first (see F14-03 harness).
  while v_finished < 2 loop
    v_conn := null;
    for i in 1..6000 loop
      if not v_done_a and dblink_is_busy('f1606_use_a')=0 then
        v_conn := 'f1606_use_a';
        exit;
      elsif not v_done_b and dblink_is_busy('f1606_use_b')=0 then
        v_conn := 'f1606_use_b';
        exit;
      end if;
      perform pg_sleep(0.01);
    end loop;
    if v_conn is null then
      raise exception 'F16-06 timed out waiting for either promo race writer';
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
      raise exception 'F16-06 promo race writer had trailing async results on %',v_conn;
    end if;

    if v_rows=1 and v_result ? 'ticketId' then
      v_successes:=v_successes+1;
      perform dblink_exec(v_conn,'commit');
    else
      if position('PROMO_EXHAUSTED' in coalesce(v_error,''))=0 then
        raise exception 'F16-06 losing promo writer failed for unexpected reason on %: %',v_conn,v_error;
      end if;
      v_failures:=v_failures+1;
      perform dblink_exec(v_conn,'rollback');
    end if;

    perform dblink_disconnect(v_conn);
    if v_conn='f1606_use_a' then v_done_a:=true; else v_done_b:=true; end if;
    v_finished:=v_finished+1;
  end loop;

  if v_successes<>1 or v_failures<>1 then
    raise exception 'F16-06 last-slot race expected 1 success/1 failure, got %/%',v_successes,v_failures;
  end if;

  select count(*)::integer into v_uses
  from public.promo_redemptions r
  where r.business_id=v_business and r.promo_code_id=v_promo and r.status in ('reserved','consumed');
  if v_uses<>1 then
    raise exception 'F16-06 last promo slot reserved % times',v_uses;
  end if;

  raise notice 'F16-06 concurrent last-slot race reserved exactly one promo';
exception when others then
  begin perform dblink_exec('f1606_blocker','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1606_blocker'); exception when others then null; end;
  for v_conn in select unnest(array['f1606_use_a','f1606_use_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$f1606race$;

-- The CI database is disposable; financial history is deliberately not deleted.
