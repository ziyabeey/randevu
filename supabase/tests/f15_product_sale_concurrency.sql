create extension if not exists dblink;

insert into auth.users(id,email,raw_user_meta_data)
values ('f1800000-0000-4000-8000-000000000001','f1502-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('f1810000-0000-4000-8000-000000000001','F15-02 Race Salon','f1502-race','Europe/Istanbul','f1800000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('f1820000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001','owner',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('f1830000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000001','Race A','05551110001','race-a@example.invalid','f1800000-0000-4000-8000-000000000001'),
  ('f1830000-0000-4000-8000-000000000002','f1810000-0000-4000-8000-000000000001','Race B','05551110002','race-b@example.invalid','f1800000-0000-4000-8000-000000000001');

set role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_product jsonb;
begin
  v_product:=public.create_product_guarded(
    'f1810000-0000-4000-8000-000000000001',
    'Son Ürün','LAST-1','piece',10000,'TRY',1,
    'f1502-race-product',repeat('a',64)
  );
  perform set_config('f1502.race_product',v_product->>'productId',false);
end
$$;

reset role;

do $$
declare
  v_business uuid:='f1810000-0000-4000-8000-000000000001';
  v_user uuid:='f1800000-0000-4000-8000-000000000001';
  v_product uuid:=current_setting('f1502.race_product')::uuid;
  v_sql_a text;
  v_sql_b text;
  v_success integer:=0;
  v_fail integer:=0;
  v_ticket_a jsonb;
  v_ticket_b jsonb;
begin
  perform dblink_connect(
    'f1502_sale_a',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1502_sale_a'
  );
  perform dblink_connect(
    'f1502_sale_b',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1502_sale_b'
  );

  for conn in select unnest(array['f1502_sale_a','f1502_sale_b']) loop
    perform dblink_exec(conn,'begin');
    perform dblink_exec(conn,'set local role authenticated');
    perform dblink_exec(conn,'set local "request.jwt.claim.sub" = '''||v_user::text||'''');
    perform dblink_exec(conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  v_sql_a:=format($q$
    select public.open_product_sale_guarded(
      %L::uuid,%L::uuid,%L::uuid,1,1,%L,%L
    )
  $q$,v_business,'f1830000-0000-4000-8000-000000000001',v_product,'f1502-race-sale-a',repeat('b',64));

  v_sql_b:=format($q$
    select public.open_product_sale_guarded(
      %L::uuid,%L::uuid,%L::uuid,1,1,%L,%L
    )
  $q$,v_business,'f1830000-0000-4000-8000-000000000002',v_product,'f1502-race-sale-b',repeat('c',64));

  if dblink_send_query('f1502_sale_a',v_sql_a)<>1
     or dblink_send_query('f1502_sale_b',v_sql_b)<>1 then
    raise exception 'F15-02 could not start concurrent product sales';
  end if;

  for i in 1..3000 loop
    if v_ticket_a is null and dblink_is_busy('f1502_sale_a')=0 then
      begin
        select result into strict v_ticket_a
        from dblink_get_result('f1502_sale_a') as t(result jsonb);
        v_success:=v_success+1;
        perform dblink_exec('f1502_sale_a','commit');
      exception when others then
        v_fail:=v_fail+1;
        begin perform dblink_exec('f1502_sale_a','rollback'); exception when others then null; end;
        v_ticket_a:='{}'::jsonb;
      end;
    end if;

    if v_ticket_b is null and dblink_is_busy('f1502_sale_b')=0 then
      begin
        select result into strict v_ticket_b
        from dblink_get_result('f1502_sale_b') as t(result jsonb);
        v_success:=v_success+1;
        perform dblink_exec('f1502_sale_b','commit');
      exception when others then
        v_fail:=v_fail+1;
        begin perform dblink_exec('f1502_sale_b','rollback'); exception when others then null; end;
        v_ticket_b:='{}'::jsonb;
      end;
    end if;

    exit when v_ticket_a is not null and v_ticket_b is not null;
    perform pg_sleep(0.01);
  end loop;

  perform dblink_disconnect('f1502_sale_a');
  perform dblink_disconnect('f1502_sale_b');

  if v_success<>1 or v_fail<>1 then
    raise exception 'F15-02 last-unit race expected one success/one failure, got success %, fail %',v_success,v_fail;
  end if;

  if (
    select stock_on_hand from public.products
    where business_id=v_business and id=v_product
  )<>0 then raise exception 'F15-02 last-unit race left incorrect stock'; end if;

  if (
    select count(*) from public.product_stock_movements
    where business_id=v_business and product_id=v_product and kind='sale'
  )<>1 then raise exception 'F15-02 last-unit race persisted duplicate stock-out'; end if;

  if (
    select count(*) from public.ticket_lines
    where business_id=v_business and product_id=v_product and source_type='product'
  )<>1 then raise exception 'F15-02 last-unit race persisted duplicate product sale lines'; end if;

  raise notice 'F15-02 last-unit race produced exactly one durable sale';
exception when others then
  begin perform dblink_exec('f1502_sale_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('f1502_sale_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1502_sale_a'); exception when others then null; end;
  begin perform dblink_disconnect('f1502_sale_b'); exception when others then null; end;
  raise;
end
$$;
