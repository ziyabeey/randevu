begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1500000-0000-4000-8000-000000000001','f1501-owner@example.invalid','{}'::jsonb),
  ('f1500000-0000-4000-8000-000000000002','f1501-staff@example.invalid','{}'::jsonb),
  ('f1500000-0000-4000-8000-000000000003','f1501-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1510000-0000-4000-8000-000000000001','F15-01 Salon A','f1501-salon-a','Europe/Istanbul','f1500000-0000-4000-8000-000000000001'),
  ('f1510000-0000-4000-8000-000000000002','F15-01 Salon B','f1501-salon-b','Europe/Istanbul','f1500000-0000-4000-8000-000000000003');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1520000-0000-4000-8000-000000000001','f1510000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000001','owner',true),
  ('f1520000-0000-4000-8000-000000000002','f1510000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000002','staff',true),
  ('f1520000-0000-4000-8000-000000000003','f1510000-0000-4000-8000-000000000002','f1500000-0000-4000-8000-000000000003','owner',true);

do $acl$
begin
  if has_table_privilege('authenticated','public.products','SELECT')
     or has_table_privilege('authenticated','public.product_stock_movements','SELECT')
     or has_table_privilege('authenticated','public.product_commands','SELECT')
     or has_table_privilege('anon','public.products','SELECT') then
    raise exception 'F15-01 raw product/stock tables unexpectedly exposed';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.create_product_guarded(uuid,text,text,text,integer,text,bigint,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.create_product_guarded(uuid,text,text,text,integer,text,bigint,text,text)',
      'EXECUTE'
    ) then
    raise exception 'F15-01 product RPC grants are wrong';
  end if;
end
$acl$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $create$
declare
  v_product jsonb;
  v_replay jsonb;
  v_product_id uuid;
  v_conflict boolean := false;
begin
  v_product := public.create_product_guarded(
    'f1510000-0000-4000-8000-000000000001',
    'Şampuan',
    'SAMP-001',
    'piece',
    25000,
    'TRY',
    10,
    'f1501-create-product-0001',
    repeat('a',64)
  );

  v_product_id := (v_product->>'productId')::uuid;
  perform set_config('f1501.product_id',v_product_id::text,false);

  if v_product->>'name' <> 'Şampuan'
     or (v_product->>'salePriceMinor')::int <> 25000
     or (v_product->>'stockOnHand')::bigint <> 10
     or (v_product->>'version')::int <> 1
     or not (v_product->>'active')::boolean then
    raise exception 'F15-01 create projection wrong: %',v_product;
  end if;

  if (
    select count(*) from public.product_stock_movements m
    where m.business_id='f1510000-0000-4000-8000-000000000001'
      and m.product_id=v_product_id
      and m.kind='initial'
      and m.quantity_delta=10
      and m.balance_after=10
  ) <> 1 then
    raise exception 'F15-01 initial stock movement missing';
  end if;

  v_replay := public.create_product_guarded(
    'f1510000-0000-4000-8000-000000000001',
    'Şampuan','SAMP-001','piece',25000,'TRY',10,
    'f1501-create-product-0001',repeat('a',64)
  );
  if v_replay <> v_product then raise exception 'F15-01 same-key create replay changed result'; end if;

  begin
    perform public.create_product_guarded(
      'f1510000-0000-4000-8000-000000000001',
      'Şampuan','SAMP-001','piece',25000,'TRY',10,
      'f1501-create-product-0001',repeat('b',64)
    );
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm) > 0 then v_conflict := true; else raise; end if;
  end;
  if not v_conflict then raise exception 'F15-01 same key accepted another request hash'; end if;
end
$create$;

do $stock$
declare
  v_result jsonb;
  v_before_count bigint;
  v_negative boolean := false;
  v_movement_id uuid;
begin
  v_result := public.record_product_stock_movement_guarded(
    'f1510000-0000-4000-8000-000000000001',
    current_setting('f1501.product_id')::uuid,
    'receipt',
    5,
    null,
    1,
    'f1501-stock-receipt-0001',
    repeat('c',64)
  );
  if (v_result->>'stockOnHand')::bigint <> 15 or (v_result->>'version')::int <> 2 then
    raise exception 'F15-01 receipt did not advance stock/version: %',v_result;
  end if;

  v_result := public.record_product_stock_movement_guarded(
    'f1510000-0000-4000-8000-000000000001',
    current_setting('f1501.product_id')::uuid,
    'adjustment',
    -3,
    'Sayım farkı',
    2,
    'f1501-stock-adjust-0001',
    repeat('d',64)
  );
  if (v_result->>'stockOnHand')::bigint <> 12 or (v_result->>'version')::int <> 3 then
    raise exception 'F15-01 adjustment did not advance stock/version: %',v_result;
  end if;

  select count(*) into v_before_count
  from public.product_stock_movements
  where business_id='f1510000-0000-4000-8000-000000000001'
    and product_id=current_setting('f1501.product_id')::uuid;

  begin
    perform public.record_product_stock_movement_guarded(
      'f1510000-0000-4000-8000-000000000001',
      current_setting('f1501.product_id')::uuid,
      'adjustment',
      -13,
      'Yanlış sayım',
      3,
      'f1501-negative-stock-0001',
      repeat('e',64)
    );
  exception when others then
    if position('NEGATIVE_STOCK' in sqlerrm) > 0 then v_negative := true; else raise; end if;
  end;
  if not v_negative then raise exception 'F15-01 negative stock was accepted'; end if;

  if (
    select stock_on_hand from public.products
    where business_id='f1510000-0000-4000-8000-000000000001'
      and id=current_setting('f1501.product_id')::uuid
  ) <> 12 then
    raise exception 'F15-01 rejected negative write changed balance projection';
  end if;

  if (
    select count(*) from public.product_stock_movements
    where business_id='f1510000-0000-4000-8000-000000000001'
      and product_id=current_setting('f1501.product_id')::uuid
  ) <> v_before_count then
    raise exception 'F15-01 rejected negative write created a movement';
  end if;

  select id into v_movement_id
  from public.product_stock_movements
  where business_id='f1510000-0000-4000-8000-000000000001'
    and product_id=current_setting('f1501.product_id')::uuid
    and kind='receipt'
  order by created_at desc,id desc
  limit 1;

  v_result := public.reverse_product_stock_movement_guarded(
    'f1510000-0000-4000-8000-000000000001',
    current_setting('f1501.product_id')::uuid,
    v_movement_id,
    'Yanlış stok girişi',
    3,
    'f1501-stock-reverse-0001',
    repeat('f',64)
  );
  if (v_result->>'stockOnHand')::bigint <> 7 or (v_result->>'version')::int <> 4 then
    raise exception 'F15-01 reversal projection wrong: %',v_result;
  end if;
end
$stock$;

reset role;

do $immutable$
declare
  v_update_blocked boolean := false;
  v_delete_blocked boolean := false;
  v_product_delete_blocked boolean := false;
begin
  begin
    update public.product_stock_movements
    set quantity_delta=999
    where business_id='f1510000-0000-4000-8000-000000000001'
      and product_id=current_setting('f1501.product_id')::uuid;
  exception when others then
    if position('STOCK_MOVEMENT_IMMUTABLE' in sqlerrm)>0 then v_update_blocked:=true; else raise; end if;
  end;
  if not v_update_blocked then raise exception 'F15-01 movement UPDATE was allowed'; end if;

  begin
    delete from public.product_stock_movements
    where business_id='f1510000-0000-4000-8000-000000000001'
      and product_id=current_setting('f1501.product_id')::uuid;
  exception when others then
    if position('STOCK_MOVEMENT_IMMUTABLE' in sqlerrm)>0 then v_delete_blocked:=true; else raise; end if;
  end;
  if not v_delete_blocked then raise exception 'F15-01 movement DELETE was allowed'; end if;

  begin
    delete from public.products
    where business_id='f1510000-0000-4000-8000-000000000001'
      and id=current_setting('f1501.product_id')::uuid;
  exception when others then
    if position('PRODUCT_DELETE_FORBIDDEN' in sqlerrm)>0 then v_product_delete_blocked:=true; else raise; end if;
  end;
  if not v_product_delete_blocked then raise exception 'F15-01 product DELETE was allowed'; end if;
end
$immutable$;

-- Staff without inventory permission cannot write.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1500000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $staff_denied$
declare
  v_denied boolean := false;
begin
  begin
    perform public.record_product_stock_movement_guarded(
      'f1510000-0000-4000-8000-000000000001',
      current_setting('f1501.product_id')::uuid,
      'receipt',1,null,4,
      'f1501-staff-denied-0001',repeat('1',64)
    );
  exception when others then
    if position('INVENTORY_PERMISSION_REQUIRED' in sqlerrm)>0 then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'F15-01 staff wrote stock without permission'; end if;
end
$staff_denied$;

reset role;

-- Explicit inventory grant permits stock, while price change still needs pricing grant.
insert into public.membership_financial_permissions(
  business_id,membership_id,permission,active,granted_by_membership_id
) values (
  'f1510000-0000-4000-8000-000000000001',
  'f1520000-0000-4000-8000-000000000002',
  'inventory_write',
  true,
  'f1520000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1500000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $staff_grant$
declare
  v_result jsonb;
  v_price_denied boolean := false;
begin
  v_result := public.record_product_stock_movement_guarded(
    'f1510000-0000-4000-8000-000000000001',
    current_setting('f1501.product_id')::uuid,
    'receipt',2,null,4,
    'f1501-staff-receipt-0001',repeat('2',64)
  );
  if (v_result->>'stockOnHand')::bigint <> 9 or (v_result->>'version')::int <> 5 then
    raise exception 'F15-01 granted staff stock write failed: %',v_result;
  end if;

  begin
    perform public.update_product_guarded(
      'f1510000-0000-4000-8000-000000000001',
      current_setting('f1501.product_id')::uuid,
      'Şampuan','SAMP-001','piece',26000,'TRY',5,
      'f1501-staff-price-0001',repeat('3',64)
    );
  exception when others then
    if position('PRICING_PERMISSION_REQUIRED' in sqlerrm)>0 then v_price_denied:=true; else raise; end if;
  end;
  if not v_price_denied then raise exception 'F15-01 inventory-only staff changed price'; end if;
end
$staff_grant$;

-- Cross-tenant product identity cannot be read or mutated through bounded RPCs.
do $cross_tenant$
declare
  v_not_found boolean := false;
begin
  begin
    perform public.record_product_stock_movement_guarded(
      'f1510000-0000-4000-8000-000000000001',
      'f1530000-0000-4000-8000-000000000099',
      'receipt',1,null,5,
      'f1501-cross-tenant-0001',repeat('4',64)
    );
  exception when others then
    if position('PRODUCT_NOT_FOUND' in sqlerrm)>0 then v_not_found:=true; else raise; end if;
  end;
  if not v_not_found then raise exception 'F15-01 unknown/cross-tenant product did not fail closed'; end if;
end
$cross_tenant$;

reset role;

-- Owner archive keeps history intact.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $archive$
declare
  v_result jsonb;
  v_movements bigint;
begin
  select count(*) into v_movements
  from public.product_stock_movements
  where business_id='f1510000-0000-4000-8000-000000000001'
    and product_id=current_setting('f1501.product_id')::uuid;

  v_result := public.archive_product_guarded(
    'f1510000-0000-4000-8000-000000000001',
    current_setting('f1501.product_id')::uuid,
    5,
    'f1501-archive-0001',
    repeat('5',64)
  );

  if (v_result->>'active')::boolean or (v_result->>'version')::int <> 6 then
    raise exception 'F15-01 archive projection wrong: %',v_result;
  end if;

  if (
    select count(*) from public.product_stock_movements
    where business_id='f1510000-0000-4000-8000-000000000001'
      and product_id=current_setting('f1501.product_id')::uuid
  ) <> v_movements then
    raise exception 'F15-01 archive changed stock history';
  end if;
end
$archive$;

rollback;
