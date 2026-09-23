begin;

-- F15-02: product sale snapshots on tickets, atomic stock-out, and explicit
-- financial-return/physical-return coupling without inventing a second ledger.

alter table public.ticket_lines
  drop constraint if exists ticket_lines_source_type_check,
  drop constraint if exists ticket_lines_quantity_check,
  drop constraint if exists ticket_lines_service_fk,
  drop constraint if exists ticket_lines_finalization_shape;

alter table public.ticket_lines
  alter column service_id drop not null,
  alter column service_name_snapshot drop not null,
  add column if not exists product_id uuid,
  add column if not exists product_name_snapshot text,
  add column if not exists product_code_snapshot text;

alter table public.ticket_lines
  add constraint ticket_lines_service_fk
    foreign key (business_id, service_id)
    references public.services(business_id, id),
  add constraint ticket_lines_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id),
  add constraint ticket_lines_source_shape
    check (
      (
        source_type = 'service'
        and service_id is not null
        and service_name_snapshot is not null
        and product_id is null
        and product_name_snapshot is null
        and product_code_snapshot is null
        and quantity = 1
      )
      or
      (
        source_type = 'product'
        and source_appointment_line_id is null
        and service_id is null
        and staff_id is null
        and service_name_snapshot is null
        and staff_name_snapshot is null
        and product_id is not null
        and product_name_snapshot is not null
        and char_length(btrim(product_name_snapshot)) between 1 and 120
        and (product_code_snapshot is null or char_length(btrim(product_code_snapshot)) between 1 and 64)
        and quantity between 1 and 1000
        and price_type_snapshot = 'fixed'
        and price_min_minor_snapshot = price_max_minor_snapshot
        and final_unit_price_minor = price_min_minor_snapshot
        and finalized_by_membership_id is not null
        and finalized_at is not null
        and finalization_reason = 'product_catalog_snapshot'
        and discount_minor = 0
        and discount_by_membership_id is null
        and discount_at is null
        and discount_reason is null
      )
    ),
  add constraint ticket_lines_finalization_shape
    check (
      (
        source_type = 'service'
        and (
          (
            final_unit_price_minor is null
            and finalized_by_membership_id is null
            and finalized_at is null
            and finalization_reason is null
            and discount_minor = 0
            and discount_by_membership_id is null
            and discount_at is null
            and discount_reason is null
          )
          or (
            final_unit_price_minor is not null
            and finalized_by_membership_id is not null
            and finalized_at is not null
            and finalization_reason is not null
            and discount_minor <= final_unit_price_minor
            and (
              (discount_minor = 0 and discount_by_membership_id is null and discount_at is null and discount_reason is null)
              or
              (discount_by_membership_id is not null and discount_at is not null and discount_reason is not null)
            )
          )
        )
      )
      or source_type = 'product'
    );

alter table public.product_stock_movements
  add column if not exists ticket_line_id uuid,
  add column if not exists source_sale_movement_id uuid;

alter table public.product_stock_movements
  add constraint product_stock_movements_ticket_line_fk
    foreign key (business_id, ticket_line_id)
    references public.ticket_lines(business_id, id),
  add constraint product_stock_movements_source_sale_fk
    foreign key (business_id, product_id, source_sale_movement_id)
    references public.product_stock_movements(business_id, product_id, id),
  add constraint product_stock_sale_return_shape
    check (
      (kind = 'sale' and quantity_delta < 0 and ticket_line_id is not null and source_sale_movement_id is null)
      or
      (kind = 'return' and quantity_delta > 0 and ticket_line_id is not null and source_sale_movement_id is not null)
      or
      (kind not in ('sale','return') and ticket_line_id is null and source_sale_movement_id is null)
    );

create unique index if not exists product_stock_one_sale_per_ticket_line_idx
  on public.product_stock_movements(business_id, ticket_line_id)
  where kind = 'sale';

create index if not exists product_stock_return_source_idx
  on public.product_stock_movements(business_id, product_id, source_sale_movement_id)
  where kind = 'return';

create table public.ticket_product_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  ticket_id uuid not null,
  ticket_line_id uuid not null,
  product_id uuid not null,
  sale_movement_id uuid not null,
  refund_event_id uuid not null,
  quantity integer not null check (quantity between 1 and 1000),
  return_to_stock boolean not null,
  stock_return_movement_id uuid,
  reason text not null check (char_length(btrim(reason)) between 2 and 240),
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  constraint ticket_product_returns_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint ticket_product_returns_line_fk
    foreign key (business_id, ticket_line_id)
    references public.ticket_lines(business_id, id),
  constraint ticket_product_returns_product_fk
    foreign key (business_id, product_id)
    references public.products(business_id, id),
  constraint ticket_product_returns_sale_movement_fk
    foreign key (business_id, product_id, sale_movement_id)
    references public.product_stock_movements(business_id, product_id, id),
  constraint ticket_product_returns_refund_fk
    foreign key (business_id, ticket_id, refund_event_id)
    references public.ticket_payment_events(business_id, ticket_id, id),
  constraint ticket_product_returns_stock_return_fk
    foreign key (business_id, product_id, stock_return_movement_id)
    references public.product_stock_movements(business_id, product_id, id),
  constraint ticket_product_returns_stock_shape
    check (
      (return_to_stock and stock_return_movement_id is not null)
      or (not return_to_stock and stock_return_movement_id is null)
    )
);

create index ticket_product_returns_line_idx
  on public.ticket_product_returns(business_id, ticket_line_id, created_at, id);

create or replace function public.f15_guard_product_return_change()
returns trigger
language plpgsql
set search_path = ''
as $f1502returnguard$
begin
  if tg_op = 'UPDATE' then raise exception 'PRODUCT_RETURN_IMMUTABLE'; end if;
  raise exception 'PRODUCT_RETURN_DELETE_FORBIDDEN';
end
$f1502returnguard$;

drop trigger if exists ticket_product_returns_update_guard on public.ticket_product_returns;
create trigger ticket_product_returns_update_guard
before update on public.ticket_product_returns
for each row execute function public.f15_guard_product_return_change();

drop trigger if exists ticket_product_returns_delete_guard on public.ticket_product_returns;
create trigger ticket_product_returns_delete_guard
before delete on public.ticket_product_returns
for each row execute function public.f15_guard_product_return_change();

alter table public.ticket_product_returns enable row level security;
alter table public.ticket_product_returns force row level security;
revoke all on table public.ticket_product_returns from public, anon, authenticated;

alter table public.ticket_commands
  drop constraint if exists ticket_commands_command_check;

alter table public.ticket_commands
  add constraint ticket_commands_command_check
  check (command in (
    'open_from_booking_group',
    'open_walk_in',
    'add_service_line',
    'finalize_service_price',
    'set_service_discount',
    'close_ticket',
    'cancel_ticket',
    'record_payment',
    'record_correction',
    'record_refund',
    'add_product_line',
    'open_product_sale',
    'product_return_refund'
  ));

create or replace function public.f14_claim_ticket_command(
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
as $f1502claim$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in (
    'open_from_booking_group','open_walk_in','add_service_line',
    'finalize_service_price','set_service_discount','close_ticket','cancel_ticket',
    'record_payment','record_correction','record_refund',
    'add_product_line','open_product_sale','product_return_refund'
  ) then
    raise exception 'INVALID_TICKET_COMMAND';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH';
  end if;

  insert into public.ticket_commands(
    business_id, actor_membership_id, command, idempotency_key, request_hash
  ) values (
    p_business_id, p_actor_membership_id, p_command, p_idempotency_key, p_request_hash
  )
  on conflict (business_id, actor_membership_id, command, idempotency_key) do nothing;

  select c.request_hash, c.result_payload
  into v_hash, v_result
  from public.ticket_commands c
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
$f1502claim$;

create or replace function public.f15_product_sale_actor(p_business_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $f1502actor$
declare
  v_actor public.memberships;
begin
  v_actor := public.f15_inventory_actor(p_business_id);
  perform public.f15_require_pricing_permission(p_business_id);
  return v_actor;
end
$f1502actor$;

create or replace function public.f15_product_return_actor(p_business_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $f1502returnactor$
declare
  v_actor public.memberships;
begin
  v_actor := public.f15_inventory_actor(p_business_id);
  if not public.has_financial_permission(
    p_business_id,
    'payments_write'::public.financial_permission_key
  ) then
    raise exception 'PAYMENTS_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  return v_actor;
end
$f1502returnactor$;

create or replace function public.f14_ticket_projection(
  p_business_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1502projection$
declare
  v_ticket public.tickets;
  v_lines jsonb;
  v_events jsonb;
  v_count integer;
  v_final_count integer;
  v_estimate_min bigint;
  v_estimate_max bigint;
  v_subtotal bigint;
  v_discount bigint;
  v_total bigint;
  v_returned bigint;
  v_paid bigint;
  v_balance bigint;
  v_ready boolean;
  v_payment_status text;
begin
  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_ticket.id is null then return null; end if;

  select
    count(*)::integer,
    count(*) filter (where l.final_unit_price_minor is not null)::integer,
    coalesce(sum(l.price_min_minor_snapshot::bigint * l.quantity::bigint), 0),
    coalesce(sum(l.price_max_minor_snapshot::bigint * l.quantity::bigint), 0),
    coalesce(sum(l.final_unit_price_minor::bigint * l.quantity::bigint), 0),
    coalesce(sum(l.discount_minor::bigint), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'lineId', l.id,
      'ordinal', l.line_ordinal,
      'sourceType', l.source_type,
      'sourceAppointmentLineId', l.source_appointment_line_id,
      'serviceId', l.service_id,
      'staffId', l.staff_id,
      'serviceName', l.service_name_snapshot,
      'staffName', l.staff_name_snapshot,
      'productId', l.product_id,
      'productName', l.product_name_snapshot,
      'productCode', l.product_code_snapshot,
      'quantity', l.quantity,
      'returnedQuantity', (
        select coalesce(sum(r.quantity), 0)::integer
        from public.ticket_product_returns r
        where r.business_id = l.business_id and r.ticket_line_id = l.id
      ),
      'priceType', l.price_type_snapshot,
      'priceMinMinor', l.price_min_minor_snapshot,
      'priceMaxMinor', l.price_max_minor_snapshot,
      'currency', l.currency_snapshot,
      'pricePolicyVersion', l.price_policy_version_snapshot,
      'finalUnitPriceMinor', l.final_unit_price_minor,
      'discountMinor', l.discount_minor,
      'netMinor', case
        when l.final_unit_price_minor is null then null
        else (l.final_unit_price_minor::bigint * l.quantity::bigint) - l.discount_minor::bigint
      end,
      'finalizedAt', l.finalized_at,
      'finalizationReason', l.finalization_reason,
      'discountAt', l.discount_at,
      'discountReason', l.discount_reason
    ) order by l.line_ordinal), '[]'::jsonb)
  into v_count, v_final_count, v_estimate_min, v_estimate_max, v_subtotal, v_discount, v_lines
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id;

  -- A product return takes the goods back, so it lowers what the ticket owes by
  -- the returned quantity at the immutable sale price snapshot (product lines
  -- carry no discount). Sale lines and stock movements are never rewritten.
  select coalesce(sum(r.quantity::bigint * l.final_unit_price_minor::bigint), 0)
  into v_returned
  from public.ticket_product_returns r
  join public.ticket_lines l
    on l.business_id = r.business_id and l.id = r.ticket_line_id
  where r.business_id = p_business_id and r.ticket_id = p_ticket_id;

  v_ready := v_count > 0 and v_count = v_final_count;
  v_total := case when v_ready then v_subtotal - v_discount - v_returned else null end;
  v_paid := public.f14_ticket_paid_minor(p_business_id, p_ticket_id);

  if v_paid < 0 then raise exception 'FINANCIAL_INVARIANT_BROKEN'; end if;
  if v_total is not null and v_paid > v_total then raise exception 'FINANCIAL_INVARIANT_BROKEN'; end if;

  v_balance := case when v_total is null then null else v_total - v_paid end;
  v_payment_status := case
    when v_total is null or v_paid = 0 then 'unpaid'
    when v_paid < v_total then 'partial'
    else 'paid'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', e.id,
    'eventType', e.event_type,
    'sourcePaymentEventId', e.source_payment_event_id,
    'method', e.payment_method,
    'correctionDirection', e.correction_direction,
    'amountMinor', e.amount_minor,
    'effectMinor', case
      when e.event_type = 'payment' then e.amount_minor
      when e.event_type = 'correction' and e.correction_direction = 'increase' then e.amount_minor
      else -e.amount_minor
    end,
    'reason', e.reason,
    'actorMembershipId', e.actor_membership_id,
    'createdAt', e.created_at
  ) order by e.created_at, e.id), '[]'::jsonb)
  into v_events
  from public.ticket_payment_events e
  where e.business_id = p_business_id and e.ticket_id = p_ticket_id;

  return jsonb_build_object(
    'ticketId', v_ticket.id,
    'businessId', v_ticket.business_id,
    'bookingGroupId', v_ticket.appointment_group_id,
    'customerId', v_ticket.customer_id,
    'source', v_ticket.source,
    'status', v_ticket.status,
    'version', v_ticket.version,
    'currency', v_ticket.currency,
    'customerName', v_ticket.customer_name_snapshot,
    'customerPhone', v_ticket.customer_phone_snapshot,
    'customerEmail', v_ticket.customer_email_snapshot,
    'settlementReady', v_ready,
    'estimateMinMinor', v_estimate_min,
    'estimateMaxMinor', v_estimate_max,
    'subtotalMinor', case when v_ready then v_subtotal else null end,
    'discountMinor', case when v_ready then v_discount else null end,
    'returnedMinor', v_returned,
    'totalMinor', v_total,
    'paymentStatus', v_payment_status,
    'paidMinor', v_paid,
    'balanceMinor', v_balance,
    'createdAt', v_ticket.created_at,
    'updatedAt', v_ticket.updated_at,
    'closedAt', v_ticket.closed_at,
    'cancelledAt', v_ticket.cancelled_at,
    'cancellationReason', v_ticket.cancellation_reason,
    'lines', v_lines,
    'paymentEvents', v_events
  );
end
$f1502projection$;

create or replace function public.f14_guard_ticket_line_update()
returns trigger
language plpgsql
set search_path = ''
as $f1502lineguard$
declare
  v_status text;
begin
  select t.status into v_status
  from public.tickets t
  where t.business_id = old.business_id and t.id = old.ticket_id;
  if v_status is distinct from 'open' then raise exception 'TICKET_IMMUTABLE'; end if;

  if old.business_id is distinct from new.business_id
     or old.id is distinct from new.id
     or old.ticket_id is distinct from new.ticket_id
     or old.line_ordinal is distinct from new.line_ordinal
     or old.source_type is distinct from new.source_type
     or old.source_appointment_line_id is distinct from new.source_appointment_line_id
     or old.service_id is distinct from new.service_id
     or old.staff_id is distinct from new.staff_id
     or old.service_name_snapshot is distinct from new.service_name_snapshot
     or old.staff_name_snapshot is distinct from new.staff_name_snapshot
     or old.product_id is distinct from new.product_id
     or old.product_name_snapshot is distinct from new.product_name_snapshot
     or old.product_code_snapshot is distinct from new.product_code_snapshot
     or old.quantity is distinct from new.quantity
     or old.price_type_snapshot is distinct from new.price_type_snapshot
     or old.price_min_minor_snapshot is distinct from new.price_min_minor_snapshot
     or old.price_max_minor_snapshot is distinct from new.price_max_minor_snapshot
     or old.currency_snapshot is distinct from new.currency_snapshot
     or old.price_policy_version_snapshot is distinct from new.price_policy_version_snapshot
     or old.created_by_membership_id is distinct from new.created_by_membership_id
     or old.created_at is distinct from new.created_at then
    raise exception 'TICKET_LINE_SOURCE_IMMUTABLE';
  end if;
  return new;
end
$f1502lineguard$;

create or replace function public.set_ticket_service_discount_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_line_id uuid,
  p_discount_minor integer,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1502discount$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_reason text;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id,v_actor.id,'set_service_discount',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
  if p_discount_minor is null
     or p_discount_minor not between 0 and 100000000
     or v_reason is null or char_length(v_reason)>240 then
    raise exception 'INVALID_DISCOUNT';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id=p_business_id and t.id=p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status<>'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version<>p_expected_version then raise exception 'STALE_WRITE'; end if;

  select * into v_line
  from public.ticket_lines l
  where l.business_id=p_business_id and l.ticket_id=p_ticket_id and l.id=p_line_id
  for update;
  if v_line.id is null then raise exception 'TICKET_LINE_NOT_FOUND'; end if;
  if v_line.source_type<>'service' then raise exception 'PRODUCT_LINE_PRICE_IMMUTABLE'; end if;
  if v_line.final_unit_price_minor is null then raise exception 'SERVICE_PRICE_NOT_FINAL'; end if;
  if p_discount_minor>v_line.final_unit_price_minor then raise exception 'DISCOUNT_EXCEEDS_LINE'; end if;

  update public.ticket_lines
  set discount_minor=p_discount_minor,
      discount_by_membership_id=case when p_discount_minor>0 then v_actor.id else null end,
      discount_at=case when p_discount_minor>0 then now() else null end,
      discount_reason=case when p_discount_minor>0 then v_reason else null end
  where business_id=p_business_id and id=p_line_id;

  update public.tickets set version=version+1
  where business_id=p_business_id and id=p_ticket_id;

  v_result:=public.f14_ticket_projection(p_business_id,p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'set_service_discount',p_idempotency_key,p_ticket_id,v_result
  );
  return v_result;
end
$f1502discount$;

create or replace function public.add_ticket_product_line_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_expected_ticket_version integer,
  p_expected_product_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1502add$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_product public.products;
  v_line public.ticket_lines;
  v_ordinal integer;
  v_replay jsonb;
  v_result jsonb;
  v_new_balance bigint;
begin
  v_actor := public.f15_product_sale_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'add_product_line', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if p_quantity is null or p_quantity not between 1 and 1000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_ticket_version is null or v_ticket.version <> p_expected_ticket_version then raise exception 'STALE_WRITE'; end if;
  if exists (
    select 1 from public.ticket_payment_events e
    where e.business_id = p_business_id and e.ticket_id = p_ticket_id
  ) then
    raise exception 'TICKET_HAS_FINANCIAL_EVENTS';
  end if;

  select * into v_product
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
  if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;
  if v_ticket.currency is not null and v_ticket.currency <> v_product.currency then raise exception 'MIXED_CURRENCY'; end if;

  select coalesce(max(line_ordinal),0)+1 into v_ordinal
  from public.ticket_lines
  where business_id=p_business_id and ticket_id=p_ticket_id;
  if v_ordinal > 100 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;

  insert into public.ticket_lines(
    business_id,ticket_id,line_ordinal,source_type,source_appointment_line_id,
    service_id,staff_id,service_name_snapshot,staff_name_snapshot,
    product_id,product_name_snapshot,product_code_snapshot,
    quantity,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
    currency_snapshot,price_policy_version_snapshot,
    final_unit_price_minor,finalized_by_membership_id,finalized_at,finalization_reason,
    discount_minor,created_by_membership_id
  ) values (
    p_business_id,p_ticket_id,v_ordinal,'product',null,
    null,null,null,null,
    v_product.id,v_product.name,v_product.code,
    p_quantity,'fixed',v_product.sale_price_minor,v_product.sale_price_minor,
    v_product.currency,v_product.version,
    v_product.sale_price_minor,v_actor.id,now(),'product_catalog_snapshot',
    0,v_actor.id
  )
  returning * into v_line;

  v_new_balance := v_product.stock_on_hand - p_quantity;
  update public.products
  set stock_on_hand=v_new_balance, version=version+1
  where business_id=p_business_id and id=p_product_id;

  insert into public.product_stock_movements(
    business_id,product_id,kind,quantity_delta,balance_after,reason,
    ticket_line_id,source_sale_movement_id,created_by_membership_id
  ) values (
    p_business_id,p_product_id,'sale',-p_quantity,v_new_balance,'product_sale',
    v_line.id,null,v_actor.id
  );

  update public.tickets
  set currency=coalesce(currency,v_product.currency), version=version+1
  where business_id=p_business_id and id=p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id,p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'add_product_line',p_idempotency_key,p_ticket_id,v_result
  );
  return v_result;
end
$f1502add$;

create or replace function public.open_product_sale_guarded(
  p_business_id uuid,
  p_customer_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_expected_product_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1502open$
declare
  v_actor public.memberships;
  v_customer public.customers;
  v_product public.products;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_replay jsonb;
  v_result jsonb;
  v_new_balance bigint;
begin
  v_actor := public.f15_product_sale_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  if p_quantity is null or p_quantity not between 1 and 1000 then raise exception 'INVALID_PRODUCT_QUANTITY'; end if;

  select * into v_customer
  from public.customers c
  where c.business_id=p_business_id and c.id=p_customer_id
  for share;
  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  select * into v_product
  from public.products p
  where p.business_id=p_business_id and p.id=p_product_id
  for update;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if not v_product.active then raise exception 'PRODUCT_ARCHIVED'; end if;
  if p_expected_product_version is null or v_product.version <> p_expected_product_version then raise exception 'STALE_PRODUCT_WRITE'; end if;
  if v_product.stock_on_hand < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;

  insert into public.tickets(
    business_id,appointment_group_id,customer_id,source,status,currency,
    customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,created_by_membership_id
  ) values (
    p_business_id,null,v_customer.id,'walk_in','open',v_product.currency,
    v_customer.name,v_customer.phone,v_customer.email,v_actor.id
  ) returning * into v_ticket;

  insert into public.ticket_lines(
    business_id,ticket_id,line_ordinal,source_type,source_appointment_line_id,
    service_id,staff_id,service_name_snapshot,staff_name_snapshot,
    product_id,product_name_snapshot,product_code_snapshot,
    quantity,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
    currency_snapshot,price_policy_version_snapshot,
    final_unit_price_minor,finalized_by_membership_id,finalized_at,finalization_reason,
    discount_minor,created_by_membership_id
  ) values (
    p_business_id,v_ticket.id,1,'product',null,
    null,null,null,null,
    v_product.id,v_product.name,v_product.code,
    p_quantity,'fixed',v_product.sale_price_minor,v_product.sale_price_minor,
    v_product.currency,v_product.version,
    v_product.sale_price_minor,v_actor.id,now(),'product_catalog_snapshot',
    0,v_actor.id
  ) returning * into v_line;

  v_new_balance := v_product.stock_on_hand-p_quantity;
  update public.products set stock_on_hand=v_new_balance,version=version+1
  where business_id=p_business_id and id=p_product_id;

  insert into public.product_stock_movements(
    business_id,product_id,kind,quantity_delta,balance_after,reason,
    ticket_line_id,source_sale_movement_id,created_by_membership_id
  ) values (
    p_business_id,p_product_id,'sale',-p_quantity,v_new_balance,'product_sale',
    v_line.id,null,v_actor.id
  );

  v_result := public.f14_ticket_projection(p_business_id,v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'open_product_sale',p_idempotency_key,v_ticket.id,v_result
  );
  return v_result;
end
$f1502open$;

create or replace function public.record_product_return_refund_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_line_id uuid,
  p_source_payment_event_id uuid,
  p_quantity integer,
  p_amount_minor integer,
  p_return_to_stock boolean,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1502return$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_product public.products;
  v_source_payment public.ticket_payment_events;
  v_sale_movement public.product_stock_movements;
  v_refund public.ticket_payment_events;
  v_stock_return public.product_stock_movements;
  v_replay jsonb;
  v_result jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_returned integer;
  v_source_net bigint;
  v_new_balance bigint;
  v_return_value bigint;
  v_before jsonb;
begin
  v_actor := public.f15_product_return_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if p_quantity is null or p_quantity not between 1 and 1000
     or p_amount_minor is null or p_amount_minor not between 1 and 100000000
     or p_return_to_stock is null
     or v_reason is null or char_length(v_reason)>240 then
    raise exception 'INVALID_PRODUCT_RETURN';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id=p_business_id and t.id=p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;

  select * into v_line
  from public.ticket_lines l
  where l.business_id=p_business_id and l.ticket_id=p_ticket_id
    and l.id=p_line_id and l.source_type='product'
  for share;
  if v_line.id is null then raise exception 'PRODUCT_LINE_NOT_FOUND'; end if;

  select * into v_product
  from public.products p
  where p.business_id=p_business_id and p.id=v_line.product_id
  for update;
  if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

  select * into v_sale_movement
  from public.product_stock_movements m
  where m.business_id=p_business_id and m.product_id=v_product.id
    and m.ticket_line_id=v_line.id and m.kind='sale'
  for share;
  if v_sale_movement.id is null then raise exception 'PRODUCT_SALE_MOVEMENT_NOT_FOUND'; end if;

  select coalesce(sum(r.quantity),0)::integer into v_returned
  from public.ticket_product_returns r
  where r.business_id=p_business_id and r.ticket_line_id=v_line.id;

  if v_returned + p_quantity > v_line.quantity then raise exception 'RETURN_EXCEEDS_SOLD_QUANTITY'; end if;

  select * into v_source_payment
  from public.ticket_payment_events e
  where e.business_id=p_business_id and e.ticket_id=p_ticket_id
    and e.id=p_source_payment_event_id and e.event_type='payment'
  for update;
  if v_source_payment.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;

  v_source_net := public.f14_source_payment_net(p_business_id,p_ticket_id,p_source_payment_event_id);
  if p_amount_minor::bigint > v_source_net then raise exception 'REFUND_EXCEEDS_SOURCE'; end if;

  -- The return lowers the total by its value; the refund may not exceed that
  -- value and must bring net paid back within the reduced total.
  v_return_value := p_quantity::bigint * v_line.final_unit_price_minor::bigint;
  if p_amount_minor::bigint > v_return_value then raise exception 'REFUND_EXCEEDS_RETURN_VALUE'; end if;
  v_before := public.f14_ticket_projection(p_business_id,p_ticket_id);
  if (v_before->>'totalMinor') is null then raise exception 'RETURN_REQUIRES_FINAL_TOTAL'; end if;
  if (v_before->>'paidMinor')::bigint - p_amount_minor::bigint
     > (v_before->>'totalMinor')::bigint - v_return_value then
    raise exception 'RETURN_REFUND_BELOW_REQUIRED';
  end if;

  insert into public.ticket_payment_events(
    business_id,ticket_id,event_type,source_payment_event_id,payment_method,
    correction_direction,amount_minor,reason,actor_membership_id
  ) values (
    p_business_id,p_ticket_id,'refund',p_source_payment_event_id,v_source_payment.payment_method,
    null,p_amount_minor,v_reason,v_actor.id
  ) returning * into v_refund;

  if p_return_to_stock then
    v_new_balance := v_product.stock_on_hand + p_quantity;
    update public.products set stock_on_hand=v_new_balance,version=version+1
    where business_id=p_business_id and id=v_product.id;

    insert into public.product_stock_movements(
      business_id,product_id,kind,quantity_delta,balance_after,reason,
      ticket_line_id,source_sale_movement_id,created_by_membership_id
    ) values (
      p_business_id,v_product.id,'return',p_quantity,v_new_balance,v_reason,
      v_line.id,v_sale_movement.id,v_actor.id
    ) returning * into v_stock_return;
  end if;

  insert into public.ticket_product_returns(
    business_id,ticket_id,ticket_line_id,product_id,sale_movement_id,
    refund_event_id,quantity,return_to_stock,stock_return_movement_id,
    reason,actor_membership_id
  ) values (
    p_business_id,p_ticket_id,v_line.id,v_product.id,v_sale_movement.id,
    v_refund.id,p_quantity,p_return_to_stock,
    case when p_return_to_stock then v_stock_return.id else null end,
    v_reason,v_actor.id
  );

  v_result := public.f14_ticket_projection(p_business_id,p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'product_return_refund',p_idempotency_key,p_ticket_id,v_result
  );
  return v_result;
end
$f1502return$;

create or replace function public.cancel_ticket_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1502cancel$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_replay jsonb;
  v_result jsonb;
  v_line record;
  v_product public.products;
  v_sale public.product_stock_movements;
  v_new_balance bigint;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id,v_actor.id,'cancel_ticket',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason)>240 then raise exception 'INVALID_CANCELLATION_REASON'; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id=p_business_id and t.id=p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version<>p_expected_version then raise exception 'STALE_WRITE'; end if;
  if exists (
    select 1 from public.ticket_payment_events e
    where e.business_id=p_business_id and e.ticket_id=p_ticket_id
  ) then raise exception 'TICKET_HAS_FINANCIAL_EVENTS'; end if;

  if exists (
    select 1 from public.ticket_lines l
    where l.business_id=p_business_id and l.ticket_id=p_ticket_id and l.source_type='product'
  ) and not public.has_financial_permission(
    p_business_id,
    'inventory_write'::public.financial_permission_key
  ) then
    raise exception 'INVENTORY_PERMISSION_REQUIRED' using errcode='42501';
  end if;

  for v_line in
    select l.id,l.product_id,l.quantity
    from public.ticket_lines l
    where l.business_id=p_business_id and l.ticket_id=p_ticket_id and l.source_type='product'
    order by l.product_id,l.id
  loop
    select * into v_product
    from public.products p
    where p.business_id=p_business_id and p.id=v_line.product_id
    for update;
    if v_product.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

    select * into v_sale
    from public.product_stock_movements m
    where m.business_id=p_business_id and m.product_id=v_product.id
      and m.ticket_line_id=v_line.id and m.kind='sale'
    for share;
    if v_sale.id is null then raise exception 'PRODUCT_SALE_MOVEMENT_NOT_FOUND'; end if;

    if exists (
      select 1 from public.product_stock_movements r
      where r.business_id=p_business_id and r.product_id=v_product.id
        and r.source_sale_movement_id=v_sale.id and r.kind='return'
    ) then raise exception 'PRODUCT_LINE_ALREADY_RETURNED'; end if;

    v_new_balance := v_product.stock_on_hand + v_line.quantity;
    update public.products set stock_on_hand=v_new_balance,version=version+1
    where business_id=p_business_id and id=v_product.id;

    insert into public.product_stock_movements(
      business_id,product_id,kind,quantity_delta,balance_after,reason,
      ticket_line_id,source_sale_movement_id,created_by_membership_id
    ) values (
      p_business_id,v_product.id,'return',v_line.quantity,v_new_balance,'ticket_cancel:'||v_reason,
      v_line.id,v_sale.id,v_actor.id
    );
  end loop;

  update public.tickets
  set status='cancelled',version=version+1,cancelled_by_membership_id=v_actor.id,
      cancelled_at=now(),cancellation_reason=v_reason
  where business_id=p_business_id and id=p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id,p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'cancel_ticket',p_idempotency_key,p_ticket_id,v_result
  );
  return v_result;
end
$f1502cancel$;

revoke all on function public.f15_guard_product_return_change() from public,anon,authenticated;
revoke all on function public.f15_product_sale_actor(uuid) from public,anon,authenticated;
revoke all on function public.f15_product_return_actor(uuid) from public,anon,authenticated;
revoke all on function public.add_ticket_product_line_guarded(uuid,uuid,uuid,integer,integer,integer,text,text) from public,anon,authenticated;
revoke all on function public.open_product_sale_guarded(uuid,uuid,uuid,integer,integer,text,text) from public,anon,authenticated;
revoke all on function public.record_product_return_refund_guarded(uuid,uuid,uuid,uuid,integer,integer,boolean,text,text,text) from public,anon,authenticated;

grant execute on function public.add_ticket_product_line_guarded(uuid,uuid,uuid,integer,integer,integer,text,text) to authenticated;
grant execute on function public.open_product_sale_guarded(uuid,uuid,uuid,integer,integer,text,text) to authenticated;
grant execute on function public.record_product_return_refund_guarded(uuid,uuid,uuid,uuid,integer,integer,boolean,text,text,text) to authenticated;

commit;
