\set ON_ERROR_STOP on
\ir h19_test_support.sql

-- H19 blind prospective inventory D1 x D5 probe.
-- Frozen in Issue #396 before Phase 1 concluded.
-- Same actor + same product + same command/key/hash overlap must converge through
-- one command identity even while product version authority is moving.

delete from public.businesses
where id='f1d10000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values (
  'f1d00000-0000-4000-8000-000000000001',
  'h19-inventory-d1d5@example.invalid',
  '{}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1d10000-0000-4000-8000-000000000001',
  'H19 Inventory D1D5',
  'h19-inventory-d1d5',
  'Europe/Istanbul',
  'f1d00000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1d20000-0000-4000-8000-000000000001',
  'f1d10000-0000-4000-8000-000000000001',
  'f1d00000-0000-4000-8000-000000000001',
  'owner',
  true
);

set role authenticated;
select set_config('request.jwt.claim.sub','f1d00000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $setup$
declare
  v_product jsonb;
begin
  v_product:=public.create_product_guarded(
    'f1d10000-0000-4000-8000-000000000001',
    'H19 Same-Key Stock',
    'H19-D1D5',
    'piece',
    15000,
    'TRY',
    10,
    'h19-inventory-d1d5-create',
    repeat('1',64)
  );
  perform set_config('h19_inventory_d1d5.product_id',v_product->>'productId',false);
end
$setup$;

reset role;

do $probe$
declare
  v_business constant uuid := 'f1d10000-0000-4000-8000-000000000001';
  v_user constant uuid := 'f1d00000-0000-4000-8000-000000000001';
  v_product uuid := current_setting('h19_inventory_d1d5.product_id')::uuid;
  v_key constant text := 'h19-inventory-d1d5-shared-0001';
  v_hash constant text := repeat('d',64);
  v_sql text;
  v_a_wait boolean := false;
  v_b_wait boolean := false;
  v_leader text;
  v_other text;
  v_leader_result jsonb;
  v_other_result jsonb;
  v_other_error text;
  v_commands integer;
  v_movements integer;
  v_stock bigint;
  v_version integer;
begin
  perform pg_temp.h19_connect('h19_inv_d1d5_blocker',true);
  perform *
  from dblink(
    'h19_inv_d1d5_blocker',
    format(
      'select id::text from public.products where business_id=%L::uuid and id=%L::uuid for update',
      v_business,v_product
    )
  ) as t(id text);

  perform pg_temp.h19_connect('h19_inv_d1d5_a',true);
  perform pg_temp.h19_connect('h19_inv_d1d5_b',true);
  perform pg_temp.h19_set_authenticated('h19_inv_d1d5_a',v_user,true);
  perform pg_temp.h19_set_authenticated('h19_inv_d1d5_b',v_user,true);

  v_sql:=format(
    $q$
      select public.record_product_stock_movement_guarded(
        %L::uuid,%L::uuid,'receipt'::public.stock_movement_kind,3,null,1,%L,%L
      )
    $q$,
    v_business,v_product,v_key,v_hash
  );

  if dblink_send_query('h19_inv_d1d5_a',v_sql)<>1 then
    raise exception 'H19 inventory D1xD5 writer A did not start';
  end if;

  v_a_wait:=pg_temp.h19_wait_for_activity(
    'h19_inv_d1d5_a','Lock',null,500
  );
  if not v_a_wait then
    raise exception 'H19 inventory D1xD5 writer A did not reach the frozen overlap barrier';
  end if;

  if dblink_send_query('h19_inv_d1d5_b',v_sql)<>1 then
    raise exception 'H19 inventory D1xD5 writer B did not start';
  end if;

  v_b_wait:=pg_temp.h19_wait_for_activity(
    'h19_inv_d1d5_b','Lock',null,500
  );
  if not v_b_wait then
    raise exception 'H19 inventory D1xD5 writer B did not overlap the first command';
  end if;

  perform dblink_exec('h19_inv_d1d5_blocker','commit');
  perform pg_temp.h19_safe_cleanup('h19_inv_d1d5_blocker',false);

  for i in 1..3000 loop
    if dblink_is_busy('h19_inv_d1d5_a')=0 then
      v_leader:='h19_inv_d1d5_a';
      v_other:='h19_inv_d1d5_b';
      exit;
    elsif dblink_is_busy('h19_inv_d1d5_b')=0 then
      v_leader:='h19_inv_d1d5_b';
      v_other:='h19_inv_d1d5_a';
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;

  if v_leader is null then
    raise exception 'H19 inventory D1xD5 no writer completed after barrier release';
  end if;

  select x.r into strict v_leader_result
  from dblink_get_result(v_leader) x(r jsonb);
  begin
    perform * from dblink_get_result(v_leader,false) x(r jsonb);
  exception when others then
    null;
  end;
  perform dblink_exec(v_leader,'commit');
  perform pg_temp.h19_safe_cleanup(v_leader,false);

  if not pg_temp.h19_wait_until_idle(v_other,3000) then
    raise exception 'H19 inventory D1xD5 second writer did not resolve after leader commit';
  end if;

  begin
    select x.r into strict v_other_result
    from dblink_get_result(v_other) x(r jsonb);
  exception when others then
    v_other_error:=sqlerrm;
  end;
  begin
    perform * from dblink_get_result(v_other,false) x(r jsonb);
  exception when others then
    null;
  end;

  if v_other_error is not null then
    perform pg_temp.h19_safe_cleanup(v_other,true);
    raise exception
      'H19 inventory D1xD5 replay classification mismatch: %',
      v_other_error;
  end if;

  perform dblink_exec(v_other,'commit');
  perform pg_temp.h19_safe_cleanup(v_other,false);

  if v_other_result is distinct from v_leader_result then
    raise exception
      'H19 inventory D1xD5 same command identity returned divergent results: leader %, replay %',
      v_leader_result,v_other_result;
  end if;

  select count(*)::integer into v_commands
  from public.product_commands c
  where c.business_id=v_business
    and c.actor_membership_id='f1d20000-0000-4000-8000-000000000001'
    and c.command='record_stock'
    and c.idempotency_key=v_key;

  if v_commands<>1 then
    raise exception
      'H19 inventory D1xD5 expected one shared command row, found %',
      v_commands;
  end if;

  select count(*)::integer into v_movements
  from public.product_stock_movements m
  where m.business_id=v_business
    and m.product_id=v_product
    and m.kind='receipt'
    and m.quantity_delta=3;

  if v_movements<>1 then
    raise exception
      'H19 inventory D1xD5 expected one durable receipt, found %',
      v_movements;
  end if;

  select p.stock_on_hand,p.version
  into strict v_stock,v_version
  from public.products p
  where p.business_id=v_business and p.id=v_product;

  if v_stock<>13 or v_version<>2 then
    raise exception
      'H19 inventory D1xD5 product moved more than once: stock %, version %',
      v_stock,v_version;
  end if;

  if (v_leader_result->>'stockOnHand')::bigint<>13
     or (v_leader_result->>'version')::integer<>2 then
    raise exception
      'H19 inventory D1xD5 authoritative replay projection mismatch: %',
      v_leader_result;
  end if;

  raise notice
    'H19 inventory D1xD5 prospective invariant accepted: overlapping same-key stock command converged to one result';
exception when others then
  perform pg_temp.h19_safe_cleanup('h19_inv_d1d5_blocker',true);
  perform pg_temp.h19_safe_cleanup('h19_inv_d1d5_a',true);
  perform pg_temp.h19_safe_cleanup('h19_inv_d1d5_b',true);
  raise;
end
$probe$;

