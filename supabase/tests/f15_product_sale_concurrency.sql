create extension if not exists dblink;

insert into auth.users(id,email,raw_user_meta_data)
values ('f15b0000-0000-4000-8000-000000000001','f1502-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('f15b1000-0000-4000-8000-000000000001','F15-02 Race Salon','f1502-race','Europe/Istanbul','f15b0000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('f15b2000-0000-4000-8000-000000000001','f15b1000-0000-4000-8000-000000000001','f15b0000-0000-4000-8000-000000000001','owner',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('f15b3000-0000-4000-8000-000000000001','f15b1000-0000-4000-8000-000000000001','Race A','05551110001','race-a@example.invalid','f15b0000-0000-4000-8000-000000000001'),
  ('f15b3000-0000-4000-8000-000000000002','f15b1000-0000-4000-8000-000000000001','Race B','05551110002','race-b@example.invalid','f15b0000-0000-4000-8000-000000000001');

set role authenticated;
select set_config('request.jwt.claim.sub','f15b0000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_product jsonb;
begin
  v_product:=public.create_product_guarded(
    'f15b1000-0000-4000-8000-000000000001',
    'Son Ürün','LAST-1','piece',10000,'TRY',1,
    'f1502-race-product',repeat('a',64)
  );
  perform set_config('f1502.race_product',v_product->>'productId',false);
end
$$;

reset role;

-- Two independent authenticated sessions race the same statement pair. Each
-- winner drains the terminal libpq result before COMMIT (as in
-- f15_product_stock_concurrency); each loser keeps its exact error text.
create function pg_temp.f1502_race(p_user uuid, p_sql_a text, p_sql_b text)
returns jsonb
language plpgsql
as $race$
declare
  v_names text[] := array['f1502_race_a','f1502_race_b'];
  v_sql text[] := array[p_sql_a,p_sql_b];
  v_done boolean[] := array[false,false];
  v_out jsonb := '{}'::jsonb;
  v_result jsonb;
  v_i integer;
  v_tick integer;
begin
  for v_i in 1..2 loop
    perform dblink_connect(
      v_names[v_i],
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_names[v_i]
    );
    perform dblink_exec(v_names[v_i],'begin');
    perform dblink_exec(v_names[v_i],'set local role authenticated');
    perform dblink_exec(v_names[v_i],'set local "request.jwt.claim.sub" = '''||p_user::text||'''');
    perform dblink_exec(v_names[v_i],$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;
  for v_i in 1..2 loop
    if dblink_send_query(v_names[v_i],v_sql[v_i])<>1 then
      raise exception 'F15-02 race % could not start',v_names[v_i];
    end if;
  end loop;

  for v_tick in 1..3000 loop
    for v_i in 1..2 loop
      continue when v_done[v_i] or dblink_is_busy(v_names[v_i])<>0;
      begin
        select t.result into strict v_result
        from dblink_get_result(v_names[v_i]) as t(result jsonb);
        perform * from dblink_get_result(v_names[v_i],false) as t(result jsonb);
        perform dblink_exec(v_names[v_i],'commit');
        v_out := v_out || jsonb_build_object(v_names[v_i],jsonb_build_object('ok',true,'result',v_result));
      exception when others then
        v_out := v_out || jsonb_build_object(v_names[v_i],jsonb_build_object('ok',false,'error',sqlerrm));
        begin perform dblink_exec(v_names[v_i],'rollback'); exception when others then null; end;
      end;
      v_done[v_i] := true;
    end loop;
    exit when v_done[1] and v_done[2];
    perform pg_sleep(0.01);
  end loop;

  for v_i in 1..2 loop
    begin perform dblink_disconnect(v_names[v_i]); exception when others then null; end;
  end loop;
  if not (v_done[1] and v_done[2]) then raise exception 'F15-02 race timed out: %',v_out; end if;
  return v_out;
end
$race$;

-- 1. Last unit: two tickets race the only unit; one sale survives, the loser
--    fails on the product CAS/stock gate and nothing is half-written.
do $last_unit$
declare
  v_business uuid := 'f15b1000-0000-4000-8000-000000000001';
  v_product uuid := current_setting('f1502.race_product')::uuid;
  v_version integer;
  v_race jsonb;
  v_ok integer;
  v_loser text;
begin
  select version into v_version from public.products where id=v_product;
  v_race := pg_temp.f1502_race(
    'f15b0000-0000-4000-8000-000000000001',
    format($q$select public.open_product_sale_guarded(%L::uuid,%L::uuid,%L::uuid,1,%s,%L,%L)$q$,
      v_business,'f15b3000-0000-4000-8000-000000000001',v_product,v_version,'f1502-race-sale-a',repeat('b',64)),
    format($q$select public.open_product_sale_guarded(%L::uuid,%L::uuid,%L::uuid,1,%s,%L,%L)$q$,
      v_business,'f15b3000-0000-4000-8000-000000000002',v_product,v_version,'f1502-race-sale-b',repeat('c',64))
  );
  select count(*) filter (where (value->>'ok')::boolean), max(value->>'error')
  into v_ok, v_loser
  from jsonb_each(v_race);
  if v_ok<>1 then raise exception 'F15-02 last-unit race expected exactly one sale: %',v_race; end if;
  if position('STALE_PRODUCT_WRITE' in v_loser)=0 and position('INSUFFICIENT_STOCK' in v_loser)=0 then
    raise exception 'F15-02 last-unit loser failed for an unexpected reason: %',v_loser;
  end if;
  if (select stock_on_hand from public.products where id=v_product)<>0 then
    raise exception 'F15-02 last-unit race left incorrect stock';
  end if;
  if (select count(*) from public.product_stock_movements where product_id=v_product and kind='sale')<>1
     or (select count(*) from public.ticket_lines where product_id=v_product and source_type='product')<>1 then
    raise exception 'F15-02 last-unit race persisted a duplicate or orphan sale';
  end if;
  raise notice 'F15-02 last-unit race produced exactly one durable sale; loser: %',v_loser;
end
$last_unit$;

-- Fixtures for the next races are committed so both dblink sessions see them.
set role authenticated;
select set_config('request.jwt.claim.sub','f15b0000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_product jsonb;
  v_sale jsonb;
  v_paid jsonb;
begin
  v_product := public.create_product_guarded(
    'f15b1000-0000-4000-8000-000000000001',
    'Tekrar Ürünü','DUP-1','piece',10000,'TRY',5,
    'f1502-dup-product',repeat('d',64)
  );
  perform set_config('f1502.dup_product',v_product->>'productId',false);

  v_product := public.create_product_guarded(
    'f15b1000-0000-4000-8000-000000000001',
    'İade Ürünü','RET-1','piece',10000,'TRY',5,
    'f1502-ret-product',repeat('e',64)
  );
  perform set_config('f1502.ret_product',v_product->>'productId',false);
  v_sale := public.open_product_sale_guarded(
    'f15b1000-0000-4000-8000-000000000001',
    'f15b3000-0000-4000-8000-000000000001',
    (v_product->>'productId')::uuid,2,(v_product->>'version')::integer,
    'f1502-ret-sale',repeat('f',64)
  );
  perform set_config('f1502.ret_ticket',v_sale->>'ticketId',false);
  perform set_config('f1502.ret_line',(v_sale->'lines')->0->>'lineId',false);
  v_paid := public.record_ticket_payment_guarded(
    'f15b1000-0000-4000-8000-000000000001',(v_sale->>'ticketId')::uuid,'cash',20000,
    'f1502-ret-pay',repeat('1',64)
  );
  perform set_config('f1502.ret_payment',(
    select event->>'eventId' from jsonb_array_elements(v_paid->'paymentEvents') event
    where event->>'eventType'='payment'
  ),false);
end
$$;

reset role;

-- 2. Same command replayed concurrently: the second first-seen duplicate waits
--    on the command receipt and returns the first result; one stock effect.
do $duplicate_command$
declare
  v_business uuid := 'f15b1000-0000-4000-8000-000000000001';
  v_product uuid := current_setting('f1502.dup_product')::uuid;
  v_version integer;
  v_sql text;
  v_race jsonb;
begin
  select version into v_version from public.products where id=v_product;
  v_sql := format($q$select public.open_product_sale_guarded(%L::uuid,%L::uuid,%L::uuid,1,%s,%L,%L)$q$,
    v_business,'f15b3000-0000-4000-8000-000000000001',v_product,v_version,'f1502-dup-sale',repeat('2',64));
  v_race := pg_temp.f1502_race('f15b0000-0000-4000-8000-000000000001',v_sql,v_sql);
  if not (v_race->'f1502_race_a'->>'ok')::boolean or not (v_race->'f1502_race_b'->>'ok')::boolean then
    raise exception 'F15-02 concurrent duplicate command did not replay: %',v_race;
  end if;
  if v_race->'f1502_race_a'->'result' is distinct from v_race->'f1502_race_b'->'result' then
    raise exception 'F15-02 concurrent duplicate returned different results: %',v_race;
  end if;
  if (select stock_on_hand from public.products where id=v_product)<>4
     or (select count(*) from public.product_stock_movements where product_id=v_product and kind='sale')<>1
     or (select count(*) from public.ticket_commands
         where business_id=v_business and command='open_product_sale' and idempotency_key='f1502-dup-sale')<>1 then
    raise exception 'F15-02 concurrent duplicate command produced a second stock effect';
  end if;
  raise notice 'F15-02 concurrent duplicate command replayed one durable sale';
end
$duplicate_command$;

-- 3. Resellable return versus a stock count adjustment on the same product:
--    the return always lands; the adjustment either serializes after it
--    (stale CAS) or before it, and the ledger always sums to stock_on_hand.
do $return_vs_adjustment$
declare
  v_business uuid := 'f15b1000-0000-4000-8000-000000000001';
  v_product uuid := current_setting('f1502.ret_product')::uuid;
  v_version integer;
  v_race jsonb;
  v_adjusted boolean;
  v_expected bigint;
begin
  select version into v_version from public.products where id=v_product;
  v_race := pg_temp.f1502_race(
    'f15b0000-0000-4000-8000-000000000001',
    format($q$select public.record_product_return_refund_guarded(%L::uuid,%L::uuid,%L::uuid,%L::uuid,1,10000,true,'Satılabilir iade',%L,%L)$q$,
      v_business,current_setting('f1502.ret_ticket'),current_setting('f1502.ret_line'),
      current_setting('f1502.ret_payment'),'f1502-ret-return',repeat('3',64)),
    format($q$select public.record_product_stock_movement_guarded(%L::uuid,%L::uuid,'adjustment',-1,'Sayım farkı',%s,%L,%L)$q$,
      v_business,v_product,v_version,'f1502-ret-adjust',repeat('4',64))
  );
  if not (v_race->'f1502_race_a'->>'ok')::boolean then
    raise exception 'F15-02 resellable return lost to a stock adjustment: %',v_race;
  end if;
  v_adjusted := (v_race->'f1502_race_b'->>'ok')::boolean;
  if not v_adjusted and position('STALE_WRITE' in v_race->'f1502_race_b'->>'error')=0 then
    raise exception 'F15-02 stock adjustment failed for an unexpected reason: %',v_race;
  end if;
  -- 5 created - 2 sold + 1 returned (- 1 counted if the adjustment won the race)
  v_expected := 4 - case when v_adjusted then 1 else 0 end;
  if (select stock_on_hand from public.products where id=v_product)<>v_expected then
    raise exception 'F15-02 return/adjustment race stock wrong: %',v_race;
  end if;
  if (select sum(quantity_delta) from public.product_stock_movements where product_id=v_product)
     <>(select stock_on_hand from public.products where id=v_product) then
    raise exception 'F15-02 return/adjustment race broke the ledger projection';
  end if;
  if (select count(*) from public.product_stock_movements where product_id=v_product and kind='return')<>1
     or (select count(*) from public.ticket_product_returns where ticket_line_id=current_setting('f1502.ret_line')::uuid)<>1 then
    raise exception 'F15-02 return/adjustment race duplicated or dropped the return';
  end if;
  raise notice 'F15-02 return/adjustment race serialized (adjustment committed: %)',v_adjusted;
end
$return_vs_adjustment$;
