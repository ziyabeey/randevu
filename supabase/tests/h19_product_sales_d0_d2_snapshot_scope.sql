begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('e4ff0000-0000-4000-8000-000000000001','h19-bench-d0d2-local@example.invalid','{}'::jsonb),
  ('e4000000-0000-4000-8000-000000000001','h19-bench-d0d2-foreign@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('e4ff1000-0000-4000-8000-000000000001','H19 D0D2 Local','h19-d0d2-local','Europe/Istanbul','e4ff0000-0000-4000-8000-000000000001'),
  ('e4001000-0000-4000-8000-000000000001','H19 D0D2 Foreign','h19-d0d2-foreign','Europe/Istanbul','e4000000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('e4ff2000-0000-4000-8000-000000000001','e4ff1000-0000-4000-8000-000000000001','e4ff0000-0000-4000-8000-000000000001','owner',true),
  ('e4002000-0000-4000-8000-000000000001','e4001000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role='owner',active=true;

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('e4ff3000-0000-4000-8000-000000000001','e4ff1000-0000-4000-8000-000000000001','H19 Local Customer','05559300001','h19-d0d2-local-customer@example.invalid','e4ff0000-0000-4000-8000-000000000001'),
  ('e4003000-0000-4000-8000-000000000001','e4001000-0000-4000-8000-000000000001','H19 Foreign Customer','05559300002','h19-d0d2-foreign-customer@example.invalid','e4000000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

insert into public.products(
  id,business_id,name,code,unit,sale_price_minor,currency,stock_on_hand,version,active,created_by_membership_id
)
values
  (
    'e4ff4000-0000-4000-8000-000000000001',
    'e4ff1000-0000-4000-8000-000000000001',
    'Tenant A Local Product','H19-SHARED-CODE','piece',10000,'TRY',5,1,true,
    'e4ff2000-0000-4000-8000-000000000001'
  ),
  (
    'e4004000-0000-4000-8000-000000000001',
    'e4001000-0000-4000-8000-000000000001',
    'Tenant B Foreign Product','H19-SHARED-CODE','piece',10000,'TRY',5,1,true,
    'e4002000-0000-4000-8000-000000000001'
  )
on conflict(id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub','e4ff0000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $probe$
declare
  v_sale jsonb;
  v_line jsonb;
  v_ticket uuid;
  v_durable_name text;
  v_local_stock bigint;
  v_foreign_stock bigint;
begin
  v_sale := public.open_product_sale_guarded(
    'e4ff1000-0000-4000-8000-000000000001',
    'e4ff3000-0000-4000-8000-000000000001',
    'e4ff4000-0000-4000-8000-000000000001',
    1,1,
    'h19-bench-d0d2-sale-0001',repeat('4',64)
  );

  v_ticket := (v_sale->>'ticketId')::uuid;
  v_line := (v_sale->'lines')->0;

  if v_line->>'productId' <> 'e4ff4000-0000-4000-8000-000000000001' then
    raise exception 'H19 benchmark product-sales D0xD2 local product identity changed';
  end if;

  if v_line->>'productName' <> 'Tenant A Local Product' then
    raise exception 'H19 benchmark product-sales D0xD2 foreign product name entered local sale snapshot';
  end if;

  execute 'reset role';

  select l.product_name_snapshot into v_durable_name
  from public.ticket_lines l
  where l.business_id='e4ff1000-0000-4000-8000-000000000001'
    and l.ticket_id=v_ticket
    and l.product_id='e4ff4000-0000-4000-8000-000000000001';

  if v_durable_name <> 'Tenant A Local Product' then
    raise exception 'H19 benchmark product-sales D0xD2 foreign product name entered local sale snapshot';
  end if;

  select stock_on_hand into v_local_stock
  from public.products
  where business_id='e4ff1000-0000-4000-8000-000000000001'
    and id='e4ff4000-0000-4000-8000-000000000001';

  select stock_on_hand into v_foreign_stock
  from public.products
  where business_id='e4001000-0000-4000-8000-000000000001'
    and id='e4004000-0000-4000-8000-000000000001';

  if v_local_stock <> 4 or v_foreign_stock <> 5 then
    raise exception
      'H19 benchmark product-sales D0xD2 stock authority drift: local %, foreign %',
      v_local_stock,v_foreign_stock;
  end if;

  raise notice 'H19 benchmark product-sales D0xD2 PASS: immutable product name remained tenant-local';
end
$probe$;

rollback;
