begin;

-- H19 permanent F15 interaction scenario: D0 x D1 (actor authorization scope x idempotency).
-- Preserved from the preregistered prospective probe: two independently authorized inventory writers in the same business reuse
-- the same record_stock idempotency key on different products. Product-command
-- identity includes actor_membership_id, so both valid commands must coexist.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1a00000-0000-4000-8000-000000000001','h19-f15-owner@example.invalid','{}'::jsonb),
  ('f1a00000-0000-4000-8000-000000000002','h19-f15-staff@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1a10000-0000-4000-8000-000000000001',
  'H19 F15 Actor Idempotency',
  'h19-f15-actor-idempotency',
  'Europe/Istanbul',
  'f1a00000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values
  (
    'f1a20000-0000-4000-8000-000000000001',
    'f1a10000-0000-4000-8000-000000000001',
    'f1a00000-0000-4000-8000-000000000001',
    'owner',
    true
  ),
  (
    'f1a20000-0000-4000-8000-000000000002',
    'f1a10000-0000-4000-8000-000000000001',
    'f1a00000-0000-4000-8000-000000000002',
    'staff',
    true
  );

insert into public.membership_financial_permissions(
  business_id,membership_id,permission,active,granted_by_membership_id
) values (
  'f1a10000-0000-4000-8000-000000000001',
  'f1a20000-0000-4000-8000-000000000002',
  'inventory_write',
  true,
  'f1a20000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $h19_f15$
declare
  v_business constant uuid := 'f1a10000-0000-4000-8000-000000000001';
  v_owner constant uuid := 'f1a00000-0000-4000-8000-000000000001';
  v_staff constant uuid := 'f1a00000-0000-4000-8000-000000000002';
  v_shared_key constant text := 'h19-f15-shared-stock-0001';
  v_product_a jsonb;
  v_product_b jsonb;
  v_result_a jsonb;
  v_result_b jsonb;
  v_product_a_id uuid;
  v_product_b_id uuid;
begin
  perform set_config('request.jwt.claim.sub',v_owner::text,true);

  v_product_a := public.create_product_guarded(
    v_business,
    'H19 Ürün A',
    'H19-A',
    'piece',
    10000,
    'TRY',
    0,
    'h19-f15-create-product-a',
    repeat('1',64)
  );
  v_product_b := public.create_product_guarded(
    v_business,
    'H19 Ürün B',
    'H19-B',
    'piece',
    12000,
    'TRY',
    0,
    'h19-f15-create-product-b',
    repeat('2',64)
  );

  v_product_a_id := (v_product_a->>'productId')::uuid;
  v_product_b_id := (v_product_b->>'productId')::uuid;

  v_result_a := public.record_product_stock_movement_guarded(
    v_business,
    v_product_a_id,
    'receipt',
    3,
    null,
    1,
    v_shared_key,
    repeat('a',64)
  );

  perform set_config('request.jwt.claim.sub',v_staff::text,true);

  v_result_b := public.record_product_stock_movement_guarded(
    v_business,
    v_product_b_id,
    'receipt',
    4,
    null,
    1,
    v_shared_key,
    repeat('b',64)
  );

  if (v_result_a->>'productId')::uuid<>v_product_a_id
     or (v_result_a->>'stockOnHand')::bigint<>3
     or (v_result_a->>'version')::integer<>2 then
    raise exception 'H19 F15 D0xD1 owner result mismatch: %',v_result_a;
  end if;

  if (v_result_b->>'productId')::uuid<>v_product_b_id
     or (v_result_b->>'stockOnHand')::bigint<>4
     or (v_result_b->>'version')::integer<>2 then
    raise exception 'H19 F15 D0xD1 staff result mismatch: %',v_result_b;
  end if;

  perform set_config('h19f15.product_a',v_product_a_id::text,false);
  perform set_config('h19f15.product_b',v_product_b_id::text,false);
end
$h19_f15$;

reset role;

do $h19_assert$
declare
  v_business constant uuid := 'f1a10000-0000-4000-8000-000000000001';
  v_shared_key constant text := 'h19-f15-shared-stock-0001';
  v_product_a uuid := current_setting('h19f15.product_a')::uuid;
  v_product_b uuid := current_setting('h19f15.product_b')::uuid;
begin
  if (
    select count(*)
    from public.product_commands c
    where c.business_id=v_business
      and c.command='record_stock'
      and c.idempotency_key=v_shared_key
  )<>2 then
    raise exception 'H19 F15 D0xD1 expected two actor-scoped command rows';
  end if;

  if (
    select count(distinct c.actor_membership_id)
    from public.product_commands c
    where c.business_id=v_business
      and c.command='record_stock'
      and c.idempotency_key=v_shared_key
  )<>2 then
    raise exception 'H19 F15 D0xD1 command identity did not preserve actor scope';
  end if;

  if not exists (
    select 1 from public.product_commands c
    where c.business_id=v_business
      and c.actor_membership_id='f1a20000-0000-4000-8000-000000000001'
      and c.command='record_stock'
      and c.idempotency_key=v_shared_key
      and c.product_id=v_product_a
      and c.request_hash=repeat('a',64)
  ) or not exists (
    select 1 from public.product_commands c
    where c.business_id=v_business
      and c.actor_membership_id='f1a20000-0000-4000-8000-000000000002'
      and c.command='record_stock'
      and c.idempotency_key=v_shared_key
      and c.product_id=v_product_b
      and c.request_hash=repeat('b',64)
  ) then
    raise exception 'H19 F15 D0xD1 actor/product command mapping mismatch';
  end if;

  raise notice 'H19 F15 D0xD1 prospective invariant accepted: same key remains actor-scoped inside one tenant';
end
$h19_assert$;

rollback;
