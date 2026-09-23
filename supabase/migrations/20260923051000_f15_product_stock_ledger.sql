begin;

do $$ begin
  create type public.stock_movement_kind as enum (
    'initial',
    'receipt',
    'adjustment',
    'reversal'
  );
exception when duplicate_object then null;
end $$;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  name text not null,
  code text,
  unit text not null default 'piece',
  sale_price_minor integer not null,
  currency text not null,
  stock_on_hand bigint not null default 0,
  version integer not null default 1,
  active boolean not null default true,
  created_by_membership_id uuid not null,
  archived_by_membership_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  constraint products_creator_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id),
  constraint products_archiver_fk
    foreign key (business_id, archived_by_membership_id)
    references public.memberships(business_id, id),
  constraint products_name_shape
    check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint products_code_shape
    check (
      code is null
      or (
        code = upper(btrim(code))
        and char_length(code) between 1 and 64
        and code ~ '^[A-Z0-9][A-Z0-9._-]*$'
      )
    ),
  constraint products_unit_shape check (unit = 'piece'),
  constraint products_price_nonnegative check (sale_price_minor >= 0),
  constraint products_currency_shape check (currency ~ '^[A-Z]{3}$'),
  constraint products_stock_nonnegative check (stock_on_hand >= 0),
  constraint products_version_positive check (version > 0),
  constraint products_archive_shape
    check (
      (active and archived_by_membership_id is null and archived_at is null)
      or
      (not active and archived_by_membership_id is not null and archived_at is not null)
    )
);

create unique index products_business_code_unique_idx
  on public.products(business_id, code)
  where code is not null;

create index products_business_created_idx
  on public.products(business_id, created_at desc, id desc);

create index products_business_active_created_idx
  on public.products(business_id, created_at desc, id desc)
  where active;

create table public.product_stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  product_id uuid not null,
  kind public.stock_movement_kind not null,
  quantity_delta bigint not null,
  balance_after bigint not null,
  reason text,
  reverses_movement_id uuid,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, product_id, id),
  constraint product_stock_movements_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id),
  constraint product_stock_movements_actor_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id),
  constraint product_stock_movements_reversal_fk
    foreign key (business_id, product_id, reverses_movement_id)
    references public.product_stock_movements(business_id, product_id, id),
  constraint product_stock_movements_delta_nonzero check (quantity_delta <> 0),
  constraint product_stock_movements_balance_nonnegative check (balance_after >= 0),
  constraint product_stock_movements_reason_shape
    check (
      reason is null
      or (reason = btrim(reason) and char_length(reason) between 2 and 240)
    ),
  constraint product_stock_movements_kind_shape
    check (
      (kind = 'reversal' and reverses_movement_id is not null and reason is not null)
      or
      (kind <> 'reversal' and reverses_movement_id is null)
    ),
  constraint product_stock_movements_adjustment_reason
    check (kind <> 'adjustment' or reason is not null),
  constraint product_stock_movements_receipt_direction
    check (kind <> 'receipt' or quantity_delta > 0),
  constraint product_stock_movements_initial_direction
    check (kind <> 'initial' or quantity_delta > 0)
);

create unique index product_stock_one_initial_idx
  on public.product_stock_movements(business_id, product_id)
  where kind = 'initial';

create unique index product_stock_one_reversal_idx
  on public.product_stock_movements(business_id, reverses_movement_id)
  where reverses_movement_id is not null;

create index product_stock_movements_product_created_idx
  on public.product_stock_movements(business_id, product_id, created_at desc, id desc);

create table public.product_commands (
  business_id uuid not null references public.businesses(id),
  actor_membership_id uuid not null,
  command text not null check (command in (
    'create_product',
    'update_product',
    'archive_product',
    'record_stock',
    'reverse_stock'
  )),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  product_id uuid,
  result_payload jsonb,
  created_at timestamptz not null default now(),
  primary key (business_id, actor_membership_id, command, idempotency_key),
  constraint product_commands_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id),
  constraint product_commands_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id),
  constraint product_commands_result_shape
    check (
      (product_id is null and result_payload is null)
      or (product_id is not null and result_payload is not null)
    )
);

create or replace function public.f15_guard_product_command_update()
returns trigger
language plpgsql
set search_path = ''
as $f15cmd$
begin
  if old.business_id is distinct from new.business_id
     or old.actor_membership_id is distinct from new.actor_membership_id
     or old.command is distinct from new.command
     or old.idempotency_key is distinct from new.idempotency_key
     or old.request_hash is distinct from new.request_hash
     or old.created_at is distinct from new.created_at then
    raise exception 'PRODUCT_COMMAND_IMMUTABLE';
  end if;

  if old.product_id is null and old.result_payload is null
     and new.product_id is not null and new.result_payload is not null then
    return new;
  end if;

  raise exception 'PRODUCT_COMMAND_IMMUTABLE';
end
$f15cmd$;

create or replace function public.f15_block_product_command_delete()
returns trigger
language plpgsql
set search_path = ''
as $f15cmddel$
begin
  raise exception 'PRODUCT_COMMAND_DELETE_FORBIDDEN';
end
$f15cmddel$;

drop trigger if exists product_commands_f15_update_guard on public.product_commands;
create trigger product_commands_f15_update_guard
before update on public.product_commands
for each row execute function public.f15_guard_product_command_update();

drop trigger if exists product_commands_f15_delete_guard on public.product_commands;
create trigger product_commands_f15_delete_guard
before delete on public.product_commands
for each row execute function public.f15_block_product_command_delete();

alter table public.products enable row level security;
alter table public.product_stock_movements enable row level security;
alter table public.product_commands enable row level security;
alter table public.products force row level security;
alter table public.product_stock_movements force row level security;
alter table public.product_commands force row level security;

revoke all on table public.products from public, anon, authenticated;
revoke all on table public.product_stock_movements from public, anon, authenticated;
revoke all on table public.product_commands from public, anon, authenticated;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

create or replace function public.f15_reject_stock_movement_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'STOCK_MOVEMENT_IMMUTABLE';
end
$$;

drop trigger if exists product_stock_movements_immutable on public.product_stock_movements;
create trigger product_stock_movements_immutable
before update or delete on public.product_stock_movements
for each row execute function public.f15_reject_stock_movement_mutation();

create or replace function public.f15_reject_product_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'PRODUCT_DELETE_FORBIDDEN';
end
$$;

drop trigger if exists products_no_delete on public.products;
create trigger products_no_delete
before delete on public.products
for each row execute function public.f15_reject_product_delete();

create or replace function public.f15_inventory_actor(p_business_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
begin
  perform public.f10_require_standard_session();

  select * into v_actor
  from public.memberships m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and m.active
  limit 1;

  if v_actor.id is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if not public.has_financial_permission(
    p_business_id,
    'inventory_write'::public.financial_permission_key
  ) then
    raise exception 'INVENTORY_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return v_actor;
end
$$;

create or replace function public.f15_require_pricing_permission(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_financial_permission(
    p_business_id,
    'pricing_adjustments_write'::public.financial_permission_key
  ) then
    raise exception 'PRICING_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
end
$$;

create or replace function public.f15_claim_product_command(
  p_business_id uuid,
  p_actor_membership_id uuid,
  p_command text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in (
    'create_product','update_product','archive_product','record_stock','reverse_stock'
  ) then
    raise exception 'INVALID_PRODUCT_COMMAND';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH';
  end if;

  insert into public.product_commands(
    business_id, actor_membership_id, command, idempotency_key, request_hash
  ) values (
    p_business_id, p_actor_membership_id, p_command, p_idempotency_key, p_request_hash
  )
  on conflict (business_id, actor_membership_id, command, idempotency_key) do nothing;

  select c.request_hash, c.result_payload
  into v_hash, v_result
  from public.product_commands c
  where c.business_id = p_business_id
    and c.actor_membership_id = p_actor_membership_id
    and c.command = p_command
    and c.idempotency_key = p_idempotency_key
  for update;

  if v_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  return v_result;
end
$$;

create or replace function public.f15_finish_product_command(
  p_business_id uuid,
  p_actor_membership_id uuid,
  p_command text,
  p_idempotency_key text,
  p_product_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_product_id is null or p_result is null then
    raise exception 'INVALID_PRODUCT_RESULT';
  end if;

  update public.product_commands
  set product_id = p_product_id,
      result_payload = p_result
  where business_id = p_business_id
    and actor_membership_id = p_actor_membership_id
    and command = p_command
    and idempotency_key = p_idempotency_key
    and product_id is null
    and result_payload is null;

  if not found then
    raise exception 'PRODUCT_COMMAND_RESULT_CONFLICT';
  end if;
end
$$;

create or replace function public.f15_product_projection(
  p_business_id uuid,
  p_product_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'productId', p.id,
    'businessId', p.business_id,
    'name', p.name,
    'code', p.code,
    'unit', p.unit,
    'salePriceMinor', p.sale_price_minor,
    'currency', p.currency,
    'stockOnHand', p.stock_on_hand,
    'version', p.version,
    'active', p.active,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at,
    'archivedAt', p.archived_at
  )
  from public.products p
  where p.business_id = p_business_id
    and p.id = p_product_id
$$;

create or replace function public.get_product_contract(
  p_business_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  v_result := public.f15_product_projection(p_business_id, p_product_id);
  if v_result is null then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  return v_result;
end
$$;

create or replace function public.list_product_contracts_page(
  p_business_id uuid,
  p_include_archived boolean,
  p_limit integer,
  p_after_created_at timestamptz,
  p_after_id uuid
)
returns table (
  product jsonb,
  sort_created_at timestamptz,
  sort_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_include_archived is null then
    raise exception 'INVALID_PRODUCT_FILTER';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE';
  end if;

  return query
  select
    public.f15_product_projection(p.business_id, p.id),
    p.created_at,
    p.id
  from public.products p
  where p.business_id = p_business_id
    and (p_include_archived or p.active)
    and (
      p_after_created_at is null
      or (p.created_at, p.id) < (p_after_created_at, p_after_id)
    )
  order by p.created_at desc, p.id desc
  limit p_limit;
end
$$;

create or replace function public.list_product_stock_movements_page(
  p_business_id uuid,
  p_product_id uuid,
  p_limit integer,
  p_after_created_at timestamptz,
  p_after_id uuid
)
returns table (
  movement jsonb,
  sort_created_at timestamptz,
  sort_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.products p
    where p.business_id = p_business_id and p.id = p_product_id
  ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE';
  end if;

  return query
  select
    jsonb_build_object(
      'movementId', m.id,
      'productId', m.product_id,
      'kind', m.kind,
      'quantityDelta', m.quantity_delta,
      'balanceAfter', m.balance_after,
      'reason', m.reason,
      'reversesMovementId', m.reverses_movement_id,
      'createdAt', m.created_at
    ),
    m.created_at,
    m.id
  from public.product_stock_movements m
  where m.business_id = p_business_id
    and m.product_id = p_product_id
    and (
      p_after_created_at is null
      or (m.created_at, m.id) < (p_after_created_at, p_after_id)
    )
  order by m.created_at desc, m.id desc
  limit p_limit;
end
$$;

create or replace function public.create_product_guarded(
  p_business_id uuid,
  p_name text,
  p_code text,
  p_unit text,
  p_sale_price_minor integer,
  p_currency text,
  p_initial_quantity bigint,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_product public.products;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_unit text := lower(btrim(coalesce(p_unit, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f15_inventory_actor(p_business_id);
  perform public.f15_require_pricing_permission(p_business_id);

  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'create_product', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
    raise exception 'INVALID_PRODUCT_CODE';
  end if;
  if v_unit <> 'piece' then raise exception 'INVALID_PRODUCT_UNIT'; end if;
  if p_sale_price_minor is null or p_sale_price_minor < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  if p_initial_quantity is null or p_initial_quantity < 0 or p_initial_quantity > 1000000000 then
    raise exception 'INVALID_STOCK_QUANTITY';
  end if;

  begin
    insert into public.products(
      business_id, name, code, unit, sale_price_minor, currency,
      stock_on_hand, created_by_membership_id
    ) values (
      p_business_id, v_name, v_code, v_unit, p_sale_price_minor, v_currency,
      p_initial_quantity, v_actor.id
    )
    returning * into v_product;
  exception when unique_violation then
    raise exception 'PRODUCT_CODE_EXISTS';
  end;

  if p_initial_quantity > 0 then
    insert into public.product_stock_movements(
      business_id, product_id, kind, quantity_delta, balance_after,
      reason, created_by_membership_id
    ) values (
      p_business_id, v_product.id, 'initial', p_initial_quantity, p_initial_quantity,
      null, v_actor.id
    );
  end if;

  v_result := public.f15_product_projection(p_business_id, v_product.id);
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'create_product', p_idempotency_key, v_product.id, v_result
  );
  return v_result;
end
$$;

create or replace function public.update_product_guarded(
  p_business_id uuid,
  p_product_id uuid,
  p_name text,
  p_code text,
  p_unit text,
  p_sale_price_minor integer,
  p_currency text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_product public.products;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_unit text := lower(btrim(coalesce(p_unit, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f15_inventory_actor(p_business_id);
  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'update_product', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  if char_length(v_name) not between 1 and 120 then raise exception 'INVALID_PRODUCT_NAME'; end if;
  if v_code is not null and (char_length(v_code) not between 1 and 64 or v_code !~ '^[A-Z0-9][A-Z0-9._-]*$') then
    raise exception 'INVALID_PRODUCT_CODE';
  end if;
  if v_unit <> 'piece' then raise exception 'INVALID_PRODUCT_UNIT'; end if;
  if p_sale_price_minor is null or p_sale_price_minor < 0 then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;

  if v_product.sale_price_minor is distinct from p_sale_price_minor
      or v_product.currency is distinct from v_currency then
    perform public.f15_require_pricing_permission(p_business_id);
  end if;

  begin
    update public.products
    set name = v_name,
        code = v_code,
        unit = v_unit,
        sale_price_minor = p_sale_price_minor,
        currency = v_currency,
        version = version + 1
    where business_id = p_business_id and id = p_product_id
    returning * into v_product;
  exception when unique_violation then
    raise exception 'PRODUCT_CODE_EXISTS';
  end;

  v_result := public.f15_product_projection(p_business_id, v_product.id);
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'update_product', p_idempotency_key, v_product.id, v_result
  );
  return v_result;
end
$$;

create or replace function public.archive_product_guarded(
  p_business_id uuid,
  p_product_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_product public.products;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f15_inventory_actor(p_business_id);
  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'archive_product', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  if v_product.active then
    update public.products
    set active = false,
        archived_by_membership_id = v_actor.id,
        archived_at = now(),
        version = version + 1
    where business_id = p_business_id and id = p_product_id
    returning * into v_product;
  end if;

  v_result := public.f15_product_projection(p_business_id, v_product.id);
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'archive_product', p_idempotency_key, v_product.id, v_result
  );
  return v_result;
end
$$;

create or replace function public.record_product_stock_movement_guarded(
  p_business_id uuid,
  p_product_id uuid,
  p_kind public.stock_movement_kind,
  p_quantity_delta bigint,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_product public.products;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_balance bigint;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f15_inventory_actor(p_business_id);

  if p_kind not in ('receipt'::public.stock_movement_kind, 'adjustment'::public.stock_movement_kind) then
    raise exception 'INVALID_STOCK_KIND';
  end if;
  if p_quantity_delta is null or p_quantity_delta = 0
     or p_quantity_delta < -1000000000 or p_quantity_delta > 1000000000 then
    raise exception 'INVALID_STOCK_QUANTITY';
  end if;
  if p_kind = 'receipt' and p_quantity_delta < 1 then raise exception 'INVALID_STOCK_QUANTITY'; end if;
  if p_kind = 'adjustment' and (v_reason is null or char_length(v_reason) not between 2 and 240) then
    raise exception 'STOCK_REASON_REQUIRED';
  end if;
  if v_reason is not null and char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_STOCK_REASON'; end if;

  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  -- EXP-H19 blind D1xD5 variation: classify product version before consulting
  -- the existing command identity. This is intentionally experimental only.
  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'record_stock', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_new_balance := v_product.stock_on_hand + p_quantity_delta;
  if v_new_balance < 0 then raise exception 'NEGATIVE_STOCK'; end if;

  update public.products
  set stock_on_hand = v_new_balance,
      version = version + 1
  where business_id = p_business_id and id = p_product_id
  returning * into v_product;

  insert into public.product_stock_movements(
    business_id, product_id, kind, quantity_delta, balance_after,
    reason, created_by_membership_id
  ) values (
    p_business_id, p_product_id, p_kind, p_quantity_delta, v_new_balance,
    v_reason, v_actor.id
  );

  v_result := public.f15_product_projection(p_business_id, p_product_id);
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'record_stock', p_idempotency_key, p_product_id, v_result
  );
  return v_result;
end
$$;

create or replace function public.reverse_product_stock_movement_guarded(
  p_business_id uuid,
  p_product_id uuid,
  p_movement_id uuid,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_product public.products;
  v_source public.product_stock_movements;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_balance bigint;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f15_inventory_actor(p_business_id);
  v_replay := public.f15_claim_product_command(
    p_business_id, v_actor.id, 'reverse_stock', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if char_length(v_reason) not between 2 and 240 then raise exception 'STOCK_REASON_REQUIRED'; end if;

  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;

  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
  if p_expected_version is null or v_product.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  select * into v_source
  from public.product_stock_movements m
  where m.business_id = p_business_id
    and m.product_id = p_product_id
    and m.id = p_movement_id
  for share;

  if v_source.id is null then raise exception 'STOCK_MOVEMENT_NOT_FOUND'; end if;
  if v_source.kind = 'reversal' then raise exception 'STOCK_REVERSAL_SOURCE_INVALID'; end if;
  if exists (
    select 1 from public.product_stock_movements r
    where r.business_id = p_business_id
      and r.product_id = p_product_id
      and r.reverses_movement_id = p_movement_id
  ) then
    raise exception 'STOCK_MOVEMENT_ALREADY_REVERSED';
  end if;

  v_new_balance := v_product.stock_on_hand - v_source.quantity_delta;
  if v_new_balance < 0 then raise exception 'NEGATIVE_STOCK'; end if;

  update public.products
  set stock_on_hand = v_new_balance,
      version = version + 1
  where business_id = p_business_id and id = p_product_id
  returning * into v_product;

  insert into public.product_stock_movements(
    business_id, product_id, kind, quantity_delta, balance_after,
    reason, reverses_movement_id, created_by_membership_id
  ) values (
    p_business_id, p_product_id, 'reversal', -v_source.quantity_delta, v_new_balance,
    v_reason, p_movement_id, v_actor.id
  );

  v_result := public.f15_product_projection(p_business_id, p_product_id);
  perform public.f15_finish_product_command(
    p_business_id, v_actor.id, 'reverse_stock', p_idempotency_key, p_product_id, v_result
  );
  return v_result;
end
$$;

revoke all on function public.f15_guard_product_command_update() from public, anon, authenticated;
revoke all on function public.f15_block_product_command_delete() from public, anon, authenticated;
revoke all on function public.f15_reject_stock_movement_mutation() from public, anon, authenticated;
revoke all on function public.f15_reject_product_delete() from public, anon, authenticated;
revoke all on function public.f15_inventory_actor(uuid) from public, anon, authenticated;
revoke all on function public.f15_require_pricing_permission(uuid) from public, anon, authenticated;
revoke all on function public.f15_claim_product_command(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.f15_finish_product_command(uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.f15_product_projection(uuid,uuid) from public, anon, authenticated;

revoke all on function public.get_product_contract(uuid,uuid) from public, anon, authenticated;
revoke all on function public.list_product_contracts_page(uuid,boolean,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.list_product_stock_movements_page(uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.create_product_guarded(uuid,text,text,text,integer,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.update_product_guarded(uuid,uuid,text,text,text,integer,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.archive_product_guarded(uuid,uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.record_product_stock_movement_guarded(uuid,uuid,public.stock_movement_kind,bigint,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.reverse_product_stock_movement_guarded(uuid,uuid,uuid,text,integer,text,text) from public, anon, authenticated;

grant execute on function public.get_product_contract(uuid,uuid) to authenticated;
grant execute on function public.list_product_contracts_page(uuid,boolean,integer,timestamptz,uuid) to authenticated;
grant execute on function public.list_product_stock_movements_page(uuid,uuid,integer,timestamptz,uuid) to authenticated;
grant execute on function public.create_product_guarded(uuid,text,text,text,integer,text,bigint,text,text) to authenticated;
grant execute on function public.update_product_guarded(uuid,uuid,text,text,text,integer,text,integer,text,text) to authenticated;
grant execute on function public.archive_product_guarded(uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.record_product_stock_movement_guarded(uuid,uuid,public.stock_movement_kind,bigint,text,integer,text,text) to authenticated;
grant execute on function public.reverse_product_stock_movement_guarded(uuid,uuid,uuid,text,integer,text,text) to authenticated;

commit;
