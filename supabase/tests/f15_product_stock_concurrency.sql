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

do $race$
declare
  v_business uuid := 'f1610000-0000-4000-8000-000000000001';
  v_user uuid := 'f1600000-0000-4000-8000-000000000001';
  v_product uuid := current_setting('f1501.race_product')::uuid;
  v_conn text;
  v_sql text;
  v_ready text := null;
  v_other text;
  v_result jsonb;
  v_successes integer := 0;
  v_stale integer := 0;
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

  v_sql := format($q$
    select public.record_product_stock_movement_guarded(
      %L::uuid,%L::uuid,'adjustment'::public.stock_movement_kind,-6,'Concurrent count',1,%L,%L
    )
  $q$,v_business,v_product,'f1501-race-a',repeat('b',64));
  if dblink_send_query('f1501_stock_a',v_sql)<>1 then
    raise exception 'F15 race writer A did not start';
  end if;

  v_sql := format($q$
    select public.record_product_stock_movement_guarded(
      %L::uuid,%L::uuid,'adjustment'::public.stock_movement_kind,-6,'Concurrent count',1,%L,%L
    )
  $q$,v_business,v_product,'f1501-race-b',repeat('c',64));
  if dblink_send_query('f1501_stock_b',v_sql)<>1 then
    raise exception 'F15 race writer B did not start';
  end if;

  -- One writer may finish its statement first but still owns the product row
  -- until we commit that dblink transaction. Commit the first completed writer,
  -- which releases the row lock; the second then re-reads version=2 and must
  -- fail STALE_WRITE rather than applying another decrement.
  for i in 1..3000 loop
    if dblink_is_busy('f1501_stock_a')=0 then
      v_ready := 'f1501_stock_a';
      exit;
    elsif dblink_is_busy('f1501_stock_b')=0 then
      v_ready := 'f1501_stock_b';
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if v_ready is null then
    raise exception 'F15 timed out waiting for first stock writer';
  end if;

  v_other := case when v_ready='f1501_stock_a' then 'f1501_stock_b' else 'f1501_stock_a' end;

  begin
    select t.result into strict v_result
    from dblink_get_result(v_ready) as t(result jsonb);
    if (v_result->>'stockOnHand')::bigint <> 4 or (v_result->>'version')::integer <> 2 then
      raise exception 'F15 first writer returned wrong projection: %',v_result;
    end if;
    v_successes := v_successes + 1;
    perform dblink_exec(v_ready,'commit');
  exception when others then
    begin perform dblink_exec(v_ready,'rollback'); exception when others then null; end;
    raise;
  end;
  perform dblink_disconnect(v_ready);

  for i in 1..3000 loop
    exit when dblink_is_busy(v_other)=0;
    perform pg_sleep(0.01);
  end loop;
  if dblink_is_busy(v_other)<>0 then
    raise exception 'F15 timed out waiting for stale stock writer';
  end if;

  begin
    perform * from dblink_get_result(v_other) as t(result jsonb);
    v_successes := v_successes + 1;
    perform dblink_exec(v_other,'commit');
  exception when others then
    if position('STALE_WRITE' in sqlerrm)>0 then
      v_stale := v_stale + 1;
      begin perform dblink_exec(v_other,'rollback'); exception when others then null; end;
    else
      begin perform dblink_exec(v_other,'rollback'); exception when others then null; end;
      raise;
    end if;
  end;
  perform dblink_disconnect(v_other);

  if v_successes<>1 or v_stale<>1 then
    raise exception 'F15 race outcome wrong: successes %, stale %',v_successes,v_stale;
  end if;

  if (
    select stock_on_hand from public.products
    where business_id=v_business and id=v_product
  ) <> 4 then
    raise exception 'F15 concurrent stock balance is not 4';
  end if;

  if (
    select version from public.products
    where business_id=v_business and id=v_product
  ) <> 2 then
    raise exception 'F15 concurrent stock version is not 2';
  end if;

  if (
    select count(*) from public.product_stock_movements
    where business_id=v_business and product_id=v_product and kind='adjustment'
  ) <> 1 then
    raise exception 'F15 concurrent stock persisted wrong adjustment count';
  end if;

  if exists (
    select 1 from public.product_stock_movements
    where business_id=v_business and product_id=v_product and balance_after<0
  ) then
    raise exception 'F15 concurrent stock persisted a negative balance';
  end if;

  raise notice 'F15-01 concurrent writers serialized; one committed and one failed STALE_WRITE';
exception when others then
  for v_conn in select unnest(array['f1501_stock_a','f1501_stock_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$race$;
