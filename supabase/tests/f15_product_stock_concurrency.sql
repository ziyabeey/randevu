create extension if not exists dblink;

delete from public.businesses where id='f1610000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f1600000-0000-4000-8000-000000000001','f1501-race@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('f1610000-0000-4000-8000-000000000001','F15-01 Race Salon','f1501-race','Europe/Istanbul','f1600000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('f1620000-0000-4000-8000-000000000001','f1610000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000001','owner',true);

set role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_product jsonb;
begin
  v_product := public.create_product_guarded(
    'f1610000-0000-4000-8000-000000000001',
    'Race Product','RACE-1','piece',10000,'TRY',10,
    'f1501-race-create-0001',repeat('a',64)
  );
  perform set_config('f1501.race_product',v_product->>'productId',false);
end
$$;

reset role;

do $$
declare
  v_business uuid := 'f1610000-0000-4000-8000-000000000001';
  v_user uuid := 'f1600000-0000-4000-8000-000000000001';
  v_product uuid := current_setting('f1501.race_product')::uuid;
  v_conn text;
  v_sql text;
  v_busy integer;
  v_rows integer;
begin
  for v_conn in select unnest(array['f1501_stock_a','f1501_stock_b']) loop
    perform dblink_connect(
      v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_conn
    );
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,'set local "request.jwt.claim.sub" = '''||v_user::text||'''');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  -- Hold the product row so both sessions reach the same version before either
  -- can commit a stock movement.
  perform 1 from public.products p where p.id=v_product for update;

  v_sql := format($q$
    select public.record_product_stock_movement_guarded(
      %L::uuid,%L::uuid,'adjustment'::public.stock_movement_kind,-6,'Concurrent count',1,%L,%L
    )
  $q$,v_business,v_product,'f1501-race-a',repeat('b',64));
  if dblink_send_query('f1501_stock_a',v_sql)<>1 then raise exception 'F15 race writer A did not start'; end if;

  v_sql := format($q$
    select public.record_product_stock_movement_guarded(
      %L::uuid,%L::uuid,'adjustment'::public.stock_movement_kind,-6,'Concurrent count',1,%L,%L
    )
  $q$,v_business,v_product,'f1501-race-b',repeat('c',64));
  if dblink_send_query('f1501_stock_b',v_sql)<>1 then raise exception 'F15 race writer B did not start'; end if;

  -- Releasing this savepoint is not enough to release row locks, so use a
  -- transaction-level advisory rendezvous instead of trying to inspect an
  -- intermediate balance. The main transaction ends this DO statement only
  -- after both writers are observed waiting; writers then serialize on the row.
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_busy
    from pg_stat_activity
    where application_name in ('f1501_stock_a','f1501_stock_b')
      and wait_event_type='Lock';
    exit when v_busy=2;
    perform pg_sleep(0.01);
  end loop;

  if v_busy<>2 then raise exception 'F15 race writers did not both wait on product row: %',v_busy; end if;

  -- We cannot release a row lock before transaction end. Instead roll back the
  -- main-session lock via a subtransaction exception boundary.
  raise exception 'F15_INTERNAL_RELEASE';
exception
  when others then
    if sqlerrm <> 'F15_INTERNAL_RELEASE' then
      for v_conn in select unnest(array['f1501_stock_a','f1501_stock_b']) loop
        begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
        begin perform dblink_disconnect(v_conn); exception when others then null; end;
      end loop;
      raise;
    end if;
end
$$;

-- The synthetic row lock above is released when its statement transaction
-- completes. Wait for both asynchronous writers, tolerating one expected
-- STALE_WRITE/negative transaction failure.
do $
declare
  v_done_a boolean := false;
  v_done_b boolean := false;
begin
  for i in 1..3000 loop
    if not v_done_a and dblink_is_busy('f1501_stock_a')=0 then
      begin
        perform * from dblink_get_result('f1501_stock_a',false) as t(result jsonb);
      exception when others then null;
      end;
      begin perform dblink_exec('f1501_stock_a','commit'); exception when others then
        begin perform dblink_exec('f1501_stock_a','rollback'); exception when others then null; end;
      end;
      perform dblink_disconnect('f1501_stock_a');
      v_done_a := true;
    end if;

    if not v_done_b and dblink_is_busy('f1501_stock_b')=0 then
      begin
        perform * from dblink_get_result('f1501_stock_b',false) as t(result jsonb);
      exception when others then null;
      end;
      begin perform dblink_exec('f1501_stock_b','commit'); exception when others then
        begin perform dblink_exec('f1501_stock_b','rollback'); exception when others then null; end;
      end;
      perform dblink_disconnect('f1501_stock_b');
      v_done_b := true;
    end if;

    exit when v_done_a and v_done_b;
    perform pg_sleep(0.01);
  end loop;

  if not (v_done_a and v_done_b) then
    raise exception 'F15 timed out waiting for concurrent stock writers';
  end if;
end
$;

do $$
declare
  v_product uuid := current_setting('f1501.race_product')::uuid;
  v_balance bigint;
  v_version integer;
  v_adjustments integer;
begin
  select stock_on_hand,version into v_balance,v_version
  from public.products where id=v_product;

  select count(*)::integer into v_adjustments
  from public.product_stock_movements
  where product_id=v_product and kind='adjustment';

  if v_balance<>4 or v_version<>2 or v_adjustments<>1 then
    raise exception 'F15 concurrent stock lost integrity: balance %, version %, adjustments %',
      v_balance,v_version,v_adjustments;
  end if;

  if exists (
    select 1 from public.product_stock_movements
    where product_id=v_product and balance_after<0
  ) then
    raise exception 'F15 concurrent stock persisted a negative balance';
  end if;

  raise notice 'F15-01 concurrent writers serialized; exactly one stale-version decrement committed';
end
$$;
