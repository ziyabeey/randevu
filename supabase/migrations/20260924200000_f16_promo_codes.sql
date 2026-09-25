begin;

-- F16-06: promotion / campaign codes (Ziya kararı: rezervasyonda gir, adisyonda düş).
--
-- * A promo code is a fixed (minor units) or percentage (basis points) discount,
--   limited by a validity window, an optional service scope and an optional
--   total usage limit.
-- * The customer enters the code for an online booking; it is re-validated on
--   the server and a quota slot is RESERVED for that appointment group. The
--   business can also apply a code directly on an open ticket.
-- * The reservation is CONSUMED when the ticket closes (the discount and its
--   per-line allocation are snapshotted) and RELEASED when the appointment is
--   cancelled / no-show, the ticket is cancelled, or the business removes it.
-- * Rules: one code per ticket; only service lines in scope are discounted;
--   package-covered lines never are; a manual line discount applies first;
--   percentages round DOWN to the minor unit; the discount never exceeds the
--   eligible amount, so the total cannot go negative. The client never sends a
--   price or rate. Reservations snapshot the terms, so later code edits never
--   change a reserved or consumed discount. The promo_codes row lock serializes
--   the last usage slot.

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  kind text not null check (kind in ('percent','fixed')),
  percent_bps integer check (percent_bps is null or percent_bps between 1 and 10000),
  amount_minor integer check (amount_minor is null or amount_minor between 1 and 100000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  starts_at timestamptz not null,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit between 1 and 100000),
  service_ids uuid[] not null default '{}'::uuid[] check (cardinality(service_ids) <= 50),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_business_id_key unique (business_id, id),
  constraint promo_codes_business_code_key unique (business_id, code),
  constraint promo_codes_creator_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id),
  constraint promo_codes_value_shape
    check (
      (kind = 'percent' and percent_bps is not null and amount_minor is null)
      or (kind = 'fixed' and amount_minor is not null and percent_bps is null)
    ),
  constraint promo_codes_window check (ends_at is null or ends_at > starts_at)
);

alter table public.promo_codes enable row level security;
alter table public.promo_codes force row level security;
revoke all on table public.promo_codes from public, anon, authenticated;

create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  promo_code_id uuid not null,
  source text not null check (source in ('booking','ticket')),
  appointment_group_id uuid,
  ticket_id uuid,
  customer_id uuid not null,
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  code_snapshot text not null,
  kind_snapshot text not null check (kind_snapshot in ('percent','fixed')),
  percent_bps_snapshot integer,
  amount_minor_snapshot integer,
  currency_snapshot text not null,
  service_ids_snapshot uuid[] not null,
  discount_minor integer check (discount_minor is null or discount_minor between 0 and 100000000),
  reserved_by_membership_id uuid,
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text check (release_reason is null or char_length(btrim(release_reason)) between 2 and 240),
  constraint promo_redemptions_business_id_key unique (business_id, id),
  constraint promo_redemptions_code_fk
    foreign key (business_id, promo_code_id)
    references public.promo_codes(business_id, id),
  constraint promo_redemptions_group_fk
    foreign key (business_id, appointment_group_id)
    references public.appointment_groups(business_id, id),
  constraint promo_redemptions_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint promo_redemptions_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  constraint promo_redemptions_actor_fk
    foreign key (business_id, reserved_by_membership_id)
    references public.memberships(business_id, id),
  constraint promo_redemptions_source_shape
    check (
      (source = 'booking' and appointment_group_id is not null and reserved_by_membership_id is null)
      or (source = 'ticket' and appointment_group_id is null and ticket_id is not null and reserved_by_membership_id is not null)
    ),
  constraint promo_redemptions_value_shape
    check (
      (kind_snapshot = 'percent' and percent_bps_snapshot between 1 and 10000 and amount_minor_snapshot is null)
      or (kind_snapshot = 'fixed' and amount_minor_snapshot between 1 and 100000000 and percent_bps_snapshot is null)
    ),
  constraint promo_redemptions_status_shape
    check (
      (status = 'reserved' and discount_minor is null and consumed_at is null and released_at is null and release_reason is null)
      or (status = 'consumed' and ticket_id is not null and discount_minor is not null and consumed_at is not null
          and released_at is null and release_reason is null)
      or (status = 'released' and discount_minor is null and consumed_at is null
          and released_at is not null and release_reason is not null)
    )
);

create unique index promo_redemptions_one_active_per_group
  on public.promo_redemptions(business_id, appointment_group_id)
  where status in ('reserved','consumed') and appointment_group_id is not null;

create unique index promo_redemptions_one_active_per_ticket
  on public.promo_redemptions(business_id, ticket_id)
  where status in ('reserved','consumed') and ticket_id is not null;

create index promo_redemptions_code_status_idx
  on public.promo_redemptions(business_id, promo_code_id, status);

alter table public.promo_redemptions enable row level security;
alter table public.promo_redemptions force row level security;
revoke all on table public.promo_redemptions from public, anon, authenticated;

-- Per-line allocation of a consumed discount (F16-07 prim uses it).
create table public.promo_redemption_lines (
  business_id uuid not null references public.businesses(id),
  redemption_id uuid not null,
  ticket_line_id uuid not null,
  base_minor integer not null check (base_minor between 0 and 100000000),
  discount_minor integer not null check (discount_minor between 0 and 100000000),
  primary key (business_id, redemption_id, ticket_line_id),
  constraint promo_redemption_lines_redemption_fk
    foreign key (business_id, redemption_id)
    references public.promo_redemptions(business_id, id),
  constraint promo_redemption_lines_line_fk
    foreign key (business_id, ticket_line_id)
    references public.ticket_lines(business_id, id),
  constraint promo_redemption_lines_bounded check (discount_minor <= base_minor)
);

create index promo_redemption_lines_line_idx
  on public.promo_redemption_lines(business_id, ticket_line_id);

alter table public.promo_redemption_lines enable row level security;
alter table public.promo_redemption_lines force row level security;
revoke all on table public.promo_redemption_lines from public, anon, authenticated;

-- Guards -------------------------------------------------------------------------

create or replace function public.f16_guard_promo_code_change()
returns trigger
language plpgsql
set search_path = ''
as $f1606codeguard$
begin
  if tg_op = 'DELETE' then raise exception 'PROMO_DELETE_FORBIDDEN'; end if;
  if old.id is distinct from new.id
     or old.business_id is distinct from new.business_id
     or old.code is distinct from new.code
     or old.kind is distinct from new.kind
     or old.currency is distinct from new.currency
     or old.created_by_membership_id is distinct from new.created_by_membership_id
     or old.created_at is distinct from new.created_at then
    raise exception 'PROMO_SOURCE_IMMUTABLE';
  end if;
  if new.version <> old.version + 1 then raise exception 'PROMO_VERSION_REQUIRED'; end if;
  return new;
end
$f1606codeguard$;

create trigger promo_codes_f16_guard
before update or delete on public.promo_codes
for each row execute function public.f16_guard_promo_code_change();

create or replace function public.f16_guard_promo_redemption_change()
returns trigger
language plpgsql
set search_path = ''
as $f1606redguard$
begin
  if tg_op = 'DELETE' then raise exception 'PROMO_REDEMPTION_DELETE_FORBIDDEN'; end if;
  if old.status <> 'reserved' then raise exception 'PROMO_REDEMPTION_CLOSED'; end if;
  if new.status = 'reserved' then raise exception 'PROMO_REDEMPTION_TRANSITION'; end if;
  if old.id is distinct from new.id
     or old.business_id is distinct from new.business_id
     or old.promo_code_id is distinct from new.promo_code_id
     or old.source is distinct from new.source
     or old.appointment_group_id is distinct from new.appointment_group_id
     or (old.ticket_id is not null and old.ticket_id is distinct from new.ticket_id)
     or old.customer_id is distinct from new.customer_id
     or old.code_snapshot is distinct from new.code_snapshot
     or old.kind_snapshot is distinct from new.kind_snapshot
     or old.percent_bps_snapshot is distinct from new.percent_bps_snapshot
     or old.amount_minor_snapshot is distinct from new.amount_minor_snapshot
     or old.currency_snapshot is distinct from new.currency_snapshot
     or old.service_ids_snapshot is distinct from new.service_ids_snapshot
     or old.reserved_by_membership_id is distinct from new.reserved_by_membership_id
     or old.reserved_at is distinct from new.reserved_at then
    raise exception 'PROMO_REDEMPTION_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end
$f1606redguard$;

create trigger promo_redemptions_f16_guard
before update or delete on public.promo_redemptions
for each row execute function public.f16_guard_promo_redemption_change();

create or replace function public.f16_guard_promo_ledger()
returns trigger
language plpgsql
set search_path = ''
as $f1606ledger$
begin
  if tg_op = 'UPDATE' then raise exception 'PROMO_LEDGER_IMMUTABLE'; end if;
  raise exception 'PROMO_LEDGER_DELETE_FORBIDDEN';
end
$f1606ledger$;

create trigger promo_redemption_lines_f16_immutable
before update or delete on public.promo_redemption_lines
for each row execute function public.f16_guard_promo_ledger();

-- Discount helpers ----------------------------------------------------------------

create or replace function public.f16_normalize_promo_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $f1606normalize$
  select case
    when upper(btrim(coalesce(p_code, ''))) ~ '^[A-Z0-9][A-Z0-9-]{2,31}$' then upper(btrim(p_code))
    else null
  end
$f1606normalize$;

-- The one active (reserved or consumed) redemption of a ticket: either applied
-- on the ticket, or reserved for the booking group the ticket was opened from.
create or replace function public.f16_ticket_promo_redemption(p_business_id uuid, p_ticket_id uuid)
returns public.promo_redemptions
language sql
stable
security definer
set search_path = ''
as $f1606ticketpromo$
  select r.*
  from public.tickets t
  join public.promo_redemptions r
    on r.business_id = t.business_id
   and r.status in ('reserved','consumed')
   and (
     r.ticket_id = t.id
     or (r.ticket_id is null and r.appointment_group_id is not null and r.appointment_group_id = t.appointment_group_id)
   )
  where t.business_id = p_business_id and t.id = p_ticket_id
  order by r.reserved_at, r.id
  limit 1
$f1606ticketpromo$;

-- Eligible lines: finalized service lines in scope that are not covered by a
-- package right; the base is what remains after any manual line discount.
create or replace function public.f16_promo_line_bases(
  p_business_id uuid,
  p_ticket_id uuid,
  p_service_ids uuid[],
  p_currency text
)
returns table(line_id uuid, line_ordinal integer, base_minor bigint)
language sql
stable
security definer
set search_path = ''
as $f1606bases$
  select l.id, l.line_ordinal, (l.final_unit_price_minor - l.discount_minor)::bigint
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id
    and l.source_type = 'service'
    and l.final_unit_price_minor is not null
    and l.currency_snapshot = p_currency
    and (cardinality(p_service_ids) = 0 or l.service_id = any(p_service_ids))
    and (public.f16_active_package_use(l.business_id, l.id)).id is null
  order by l.line_ordinal
$f1606bases$;

create or replace function public.f16_promo_amount(
  p_kind text,
  p_percent_bps integer,
  p_amount_minor integer,
  p_base bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $f1606amount$
  select case
    when coalesce(p_base, 0) <= 0 then 0::bigint
    when p_kind = 'percent' then (p_base * p_percent_bps) / 10000
    else least(p_amount_minor::bigint, p_base)
  end
$f1606amount$;

create or replace function public.f16_ticket_promo_amount(p_business_id uuid, p_ticket_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $f1606ticketamount$
declare
  v_r public.promo_redemptions;
  v_base bigint;
begin
  v_r := public.f16_ticket_promo_redemption(p_business_id, p_ticket_id);
  if v_r.id is null then return 0; end if;
  if v_r.status = 'consumed' then return v_r.discount_minor; end if;
  select coalesce(sum(b.base_minor), 0) into v_base
  from public.f16_promo_line_bases(p_business_id, p_ticket_id, v_r.service_ids_snapshot, v_r.currency_snapshot) b;
  return public.f16_promo_amount(v_r.kind_snapshot, v_r.percent_bps_snapshot, v_r.amount_minor_snapshot, v_base);
end
$f1606ticketamount$;

-- Single money formula for projections and write guards.
create or replace function public.f16_ticket_money(p_business_id uuid, p_ticket_id uuid)
returns table(
  line_count integer,
  final_count integer,
  estimate_min bigint,
  estimate_max bigint,
  subtotal bigint,
  discount bigint,
  returned bigint,
  package_refunded bigint,
  package_covered bigint,
  promo bigint,
  paid bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $f1606money$
begin
  select
    count(*)::integer,
    count(*) filter (where l.final_unit_price_minor is not null)::integer,
    coalesce(sum(l.price_min_minor_snapshot::bigint * l.quantity::bigint), 0),
    coalesce(sum(l.price_max_minor_snapshot::bigint * l.quantity::bigint), 0),
    coalesce(sum(l.final_unit_price_minor::bigint * l.quantity::bigint), 0),
    coalesce(sum(l.discount_minor::bigint), 0),
    coalesce(sum(l.discount_minor::bigint) filter (
      where (public.f16_active_package_use(l.business_id, l.id)).id is not null
    ), 0)
  into line_count, final_count, estimate_min, estimate_max, subtotal, discount, package_covered
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id;

  select coalesce(sum(r.quantity::bigint * l.final_unit_price_minor::bigint), 0)
  into returned
  from public.ticket_product_returns r
  join public.ticket_lines l on l.business_id = r.business_id and l.id = r.ticket_line_id
  where r.business_id = p_business_id and r.ticket_id = p_ticket_id;

  select coalesce(sum(cp.refund_value_minor::bigint), 0)
  into package_refunded
  from public.customer_packages cp
  where cp.business_id = p_business_id and cp.sale_ticket_id = p_ticket_id and cp.status = 'refunded';

  promo := public.f16_ticket_promo_amount(p_business_id, p_ticket_id);
  paid := public.f14_ticket_paid_minor(p_business_id, p_ticket_id);
  return next;
end
$f1606money$;

create or replace function public.f16_ticket_total_minor(p_business_id uuid, p_ticket_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $f1606total$
  select case when m.line_count > 0 and m.line_count = m.final_count
    then m.subtotal - m.discount - m.returned - m.package_refunded - m.promo
    else null end
  from public.f16_ticket_money(p_business_id, p_ticket_id) m
$f1606total$;

-- Projection and write guards -----------------------------------------------------

create or replace function public.f14_ticket_projection(
  p_business_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1606projection$
declare
  v_ticket public.tickets;
  v_lines jsonb;
  v_events jsonb;
  v_money record;
  v_promo public.promo_redemptions;
  v_total bigint;
  v_balance bigint;
  v_ready boolean;
  v_payment_status text;
begin
  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_ticket.id is null then return null; end if;

  select
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
      'packageId', l.package_id,
      'packageName', l.package_name_snapshot,
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
      'discountReason', l.discount_reason,
      'soldPackage', case when l.source_type = 'package' then (
        select jsonb_build_object(
          'customerPackageId', cp.id,
          'status', cp.status,
          'sessionsTotal', cp.sessions_total,
          'sessionsUsed', cp.sessions_used,
          'expiresAt', cp.expires_at,
          'refundPreviewMinor', case
            when cp.status = 'active' and cp.sessions_used < cp.sessions_total
              then public.f16_package_refund_value(cp)
            else null
          end,
          'refundValueMinor', cp.refund_value_minor,
          'refundedSessions', cp.refunded_sessions
        )
        from public.customer_packages cp
        where cp.business_id = l.business_id and cp.sale_ticket_line_id = l.id
      ) else null end,
      'promoDiscountMinor', (
        select pl.discount_minor
        from public.promo_redemption_lines pl
        join public.promo_redemptions pr on pr.business_id = pl.business_id and pr.id = pl.redemption_id
        where pl.business_id = l.business_id and pl.ticket_line_id = l.id and pr.status = 'consumed'
        limit 1
      ),
      'packageCoverage', (
        select jsonb_build_object(
          'usageId', u.id,
          'customerPackageId', u.customer_package_id,
          'packageName', cp.package_name_snapshot,
          'valueMinor', u.value_minor
        )
        from public.customer_package_usages u
        join public.customer_packages cp
          on cp.business_id = u.business_id and cp.id = u.customer_package_id
        where u.business_id = l.business_id and u.ticket_line_id = l.id and u.kind = 'use'
          and not exists (
            select 1 from public.customer_package_usages r
            where r.business_id = u.business_id and r.reverses_usage_id = u.id and r.kind = 'reverse'
          )
        limit 1
      )
    ) order by l.line_ordinal), '[]'::jsonb)
  into v_lines
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id;

  -- One money formula (f16_ticket_money) for the projection and every write
  -- guard: product returns and package refunds lower the total, and a promo
  -- discount is taken from eligible service lines only.
  select * into v_money from public.f16_ticket_money(p_business_id, p_ticket_id);
  v_promo := public.f16_ticket_promo_redemption(p_business_id, p_ticket_id);

  v_ready := v_money.line_count > 0 and v_money.line_count = v_money.final_count;
  v_total := case when v_ready
    then v_money.subtotal - v_money.discount - v_money.returned - v_money.package_refunded - v_money.promo
    else null end;

  if v_money.paid < 0 then raise exception 'FINANCIAL_INVARIANT_BROKEN'; end if;
  if v_total is not null and v_money.paid > v_total then raise exception 'FINANCIAL_INVARIANT_BROKEN'; end if;

  v_balance := case when v_total is null then null else v_total - v_money.paid end;
  v_payment_status := case
    when v_total is null or v_money.paid = 0 then 'unpaid'
    when v_money.paid < v_total then 'partial'
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
    'estimateMinMinor', v_money.estimate_min,
    'estimateMaxMinor', v_money.estimate_max,
    'subtotalMinor', case when v_ready then v_money.subtotal else null end,
    'discountMinor', case when v_ready then v_money.discount else null end,
    'packageCoveredMinor', case when v_ready then v_money.package_covered else null end,
    'promoDiscountMinor', v_money.promo,
    'promo', case when v_promo.id is null then null else jsonb_build_object(
      'redemptionId', v_promo.id,
      'code', v_promo.code_snapshot,
      'kind', v_promo.kind_snapshot,
      'percentBps', v_promo.percent_bps_snapshot,
      'amountMinor', v_promo.amount_minor_snapshot,
      'serviceIds', to_jsonb(v_promo.service_ids_snapshot),
      'source', v_promo.source,
      'status', v_promo.status
    ) end,
    'returnedMinor', v_money.returned,
    'packageRefundedMinor', v_money.package_refunded,
    'totalMinor', v_total,
    'paymentStatus', v_payment_status,
    'paidMinor', v_money.paid,
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
$f1606projection$;


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
as $f1606discount$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_reason text;
  v_replay jsonb;
  v_result jsonb;
  v_paid bigint;
  v_new_total bigint;
  v_unfinalized integer;
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

  select count(*) filter (where l.final_unit_price_minor is null)::integer
  into v_unfinalized
  from public.ticket_lines l
  where l.business_id=p_business_id and l.ticket_id=p_ticket_id;

  v_paid:=public.f14_ticket_paid_minor(p_business_id,p_ticket_id);
  if v_paid>0 and v_unfinalized>0 then
    raise exception 'FINANCIAL_INVARIANT_BROKEN';
  end if;

  update public.ticket_lines
  set discount_minor=p_discount_minor,
      discount_by_membership_id=case when p_discount_minor>0 then v_actor.id else null end,
      discount_at=case when p_discount_minor>0 then now() else null end,
      discount_reason=case when p_discount_minor>0 then v_reason else null end
  where business_id=p_business_id and id=p_line_id;

  -- A discount also changes a percentage promo's base, so the guard uses the
  -- single money formula after the change instead of an inline estimate.
  v_new_total:=public.f16_ticket_total_minor(p_business_id,p_ticket_id);
  if v_new_total is not null and v_new_total<v_paid then
    raise exception 'TICKET_TOTAL_BELOW_PAID';
  end if;

  update public.tickets set version=version+1
  where business_id=p_business_id and id=p_ticket_id;

  v_result:=public.f14_ticket_projection(p_business_id,p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id,v_actor.id,'set_service_discount',p_idempotency_key,p_ticket_id,v_result
  );
  return v_result;
end
$f1606discount$;

-- Ticket command vocabulary ----------------------------------------------------------

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
    'product_return_refund',
    'add_package_line',
    'open_package_sale',
    'apply_package',
    'reverse_package_usage',
    'refund_package',
    'apply_promo',
    'remove_promo'
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
as $f1606claim$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in (
    'open_from_booking_group','open_walk_in','add_service_line',
    'finalize_service_price','set_service_discount','close_ticket','cancel_ticket',
    'record_payment','record_correction','record_refund',
    'add_product_line','open_product_sale','product_return_refund',
    'add_package_line','open_package_sale','apply_package','reverse_package_usage','refund_package',
    'apply_promo','remove_promo'
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
$f1606claim$;

-- Reservation core ------------------------------------------------------------------

-- Validates the code against its window, scope and usage limit, then inserts a
-- reserved redemption with snapshotted terms. The promo_codes row lock is the
-- quota authority: two reservations of the last slot serialize on it.
create or replace function public.f16_reserve_promo(
  p_business_id uuid,
  p_code text,
  p_customer_id uuid,
  p_source text,
  p_group_id uuid,
  p_ticket_id uuid,
  p_service_ids uuid[],
  p_actor_membership_id uuid
)
returns public.promo_redemptions
language plpgsql
security definer
set search_path = ''
as $f1606reserve$
declare
  v_code text := public.f16_normalize_promo_code(p_code);
  v_promo public.promo_codes;
  v_used integer;
  v_row public.promo_redemptions;
begin
  if v_code is null then raise exception 'PROMO_NOT_FOUND'; end if;

  select * into v_promo
  from public.promo_codes p
  where p.business_id = p_business_id and p.code = v_code
  for update;
  if v_promo.id is null or not v_promo.active then raise exception 'PROMO_NOT_FOUND'; end if;
  if now() < v_promo.starts_at then raise exception 'PROMO_NOT_STARTED'; end if;
  if v_promo.ends_at is not null and now() >= v_promo.ends_at then raise exception 'PROMO_EXPIRED'; end if;
  if cardinality(v_promo.service_ids) > 0
     and not (v_promo.service_ids && coalesce(p_service_ids, '{}'::uuid[])) then
    raise exception 'PROMO_NOT_APPLICABLE';
  end if;

  if v_promo.usage_limit is not null then
    select count(*)::integer into v_used
    from public.promo_redemptions r
    where r.business_id = p_business_id and r.promo_code_id = v_promo.id
      and r.status in ('reserved','consumed');
    if v_used >= v_promo.usage_limit then raise exception 'PROMO_EXHAUSTED'; end if;
  end if;

  insert into public.promo_redemptions(
    business_id, promo_code_id, source, appointment_group_id, ticket_id, customer_id, status,
    code_snapshot, kind_snapshot, percent_bps_snapshot, amount_minor_snapshot, currency_snapshot,
    service_ids_snapshot, reserved_by_membership_id
  ) values (
    p_business_id, v_promo.id, p_source, p_group_id, p_ticket_id, p_customer_id, 'reserved',
    v_promo.code, v_promo.kind, v_promo.percent_bps, v_promo.amount_minor, v_promo.currency,
    v_promo.service_ids, p_actor_membership_id
  )
  returning * into v_row;
  return v_row;
end
$f1606reserve$;

-- Customer (public + management capability) surface -------------------------------

create or replace function public.f16_public_business_id(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $f1606publicbiz$
  select b.id
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug) = lower(btrim(coalesce(p_slug, ''))) and r.publishable
  limit 1
$f1606publicbiz$;

-- Terms only: no usage counts, no other customers' data.
create or replace function public.get_public_promo_preview(
  p_slug text,
  p_code text,
  p_service_ids uuid[]
)
returns table(
  code text,
  kind text,
  percent_bps integer,
  amount_minor integer,
  currency text,
  ends_at timestamptz,
  applicable boolean,
  scoped boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $f1606preview$
declare
  v_business_id uuid := public.f16_public_business_id(p_slug);
  v_code text := public.f16_normalize_promo_code(p_code);
  v_promo public.promo_codes;
  v_used integer;
begin
  if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
  if v_code is null or cardinality(coalesce(p_service_ids, '{}'::uuid[])) > 10 then
    raise exception 'PROMO_NOT_FOUND';
  end if;
  select * into v_promo from public.promo_codes p
  where p.business_id = v_business_id and p.code = v_code;
  if v_promo.id is null or not v_promo.active then raise exception 'PROMO_NOT_FOUND'; end if;
  if now() < v_promo.starts_at then raise exception 'PROMO_NOT_STARTED'; end if;
  if v_promo.ends_at is not null and now() >= v_promo.ends_at then raise exception 'PROMO_EXPIRED'; end if;
  if v_promo.usage_limit is not null then
    select count(*)::integer into v_used from public.promo_redemptions r
    where r.business_id = v_business_id and r.promo_code_id = v_promo.id and r.status in ('reserved','consumed');
    if v_used >= v_promo.usage_limit then raise exception 'PROMO_EXHAUSTED'; end if;
  end if;
  return query select v_promo.code, v_promo.kind, v_promo.percent_bps, v_promo.amount_minor, v_promo.currency,
    v_promo.ends_at,
    cardinality(v_promo.service_ids) = 0 or v_promo.service_ids && coalesce(p_service_ids, '{}'::uuid[]),
    cardinality(v_promo.service_ids) > 0;
end
$f1606preview$;

create or replace function public.f16_promo_ref(p_token text)
returns table(
  business_id uuid,
  group_id uuid,
  customer_id uuid,
  group_status text,
  first_start timestamptz,
  service_ids uuid[]
)
language sql
stable
security definer
set search_path = ''
as $f1606ref$
  select ref.business_id, ref.group_id, g.customer_id, g.status,
    (select min(a.starts_at) from public.appointments a
      where a.business_id = g.business_id and a.group_id = g.id and a.status <> 'cancelled'),
    coalesce((select array_agg(distinct a.service_id) from public.appointments a
      where a.business_id = g.business_id and a.group_id = g.id and a.status <> 'cancelled'), '{}'::uuid[])
  from public.f11_public_management_group_ref(p_token) ref
  join public.appointment_groups g on g.business_id = ref.business_id and g.id = ref.group_id
  limit 1
$f1606ref$;

create or replace function public.f16_group_promo_state(p_business_id uuid, p_group_id uuid, p_attachable boolean)
returns table(
  code text,
  kind text,
  percent_bps integer,
  amount_minor integer,
  currency text,
  status text,
  attachable boolean
)
language sql
stable
security definer
set search_path = ''
as $f1606groupstate$
  select r.code_snapshot, r.kind_snapshot, r.percent_bps_snapshot, r.amount_minor_snapshot,
    r.currency_snapshot, r.status, false
  from public.promo_redemptions r
  where r.business_id = p_business_id
    and r.status in ('reserved','consumed')
    and (
      r.appointment_group_id = p_group_id
      or r.ticket_id = (select t.id from public.tickets t where t.business_id = p_business_id and t.appointment_group_id = p_group_id)
    )
  union all
  select null, null, null, null, null, null, p_attachable
  where not exists (
    select 1 from public.promo_redemptions r
    where r.business_id = p_business_id
      and r.status in ('reserved','consumed')
      and (
        r.appointment_group_id = p_group_id
        or r.ticket_id = (select t.id from public.tickets t where t.business_id = p_business_id and t.appointment_group_id = p_group_id)
      )
  )
  limit 1
$f1606groupstate$;

create or replace function public.get_public_managed_promo(p_token text)
returns table(
  code text,
  kind text,
  percent_bps integer,
  amount_minor integer,
  currency text,
  status text,
  attachable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $f1606manageview$
declare
  v_ref record;
begin
  select * into v_ref from public.f16_promo_ref(p_token);
  if not found then raise exception 'MANAGEMENT_NOT_FOUND'; end if;
  return query select * from public.f16_group_promo_state(
    v_ref.business_id, v_ref.group_id,
    v_ref.group_status in ('scheduled','confirmed') and v_ref.first_start > now()
      and not exists (
        select 1 from public.tickets t
        where t.business_id = v_ref.business_id and t.appointment_group_id = v_ref.group_id
      )
  );
end
$f1606manageview$;

create or replace function public.attach_public_managed_promo(p_token text, p_code text)
returns table(
  code text,
  kind text,
  percent_bps integer,
  amount_minor integer,
  currency text,
  status text,
  attachable boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $f1606attach$
declare
  v_ref record;
  v_existing record;
  v_code text := public.f16_normalize_promo_code(p_code);
begin
  select * into v_ref from public.f16_promo_ref(p_token);
  if not found then raise exception 'MANAGEMENT_NOT_FOUND'; end if;
  if v_code is null then raise exception 'PROMO_NOT_FOUND'; end if;

  -- Share F14's per-group ticket lock with ticket open and staff apply, so a
  -- booking-side attach and a ticket for the same group are serialized. Then
  -- serialize attaches of the same group (one code per appointment).
  perform pg_advisory_xact_lock(hashtextextended(
    v_ref.business_id::text || ':ticket-group:' || v_ref.group_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended('f16:promo-group:' || v_ref.group_id::text, 0));
  -- A status change (cancel/no-show) takes this row lock too, so an attach can
  -- no longer reserve a code that the concurrent release trigger cannot see.
  -- The group state is read again after the lock.
  perform 1 from public.appointment_groups g
  where g.business_id = v_ref.business_id and g.id = v_ref.group_id
  for no key update;
  select * into v_ref from public.f16_promo_ref(p_token);
  if not found then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  select * into v_existing
  from public.f16_group_promo_state(v_ref.business_id, v_ref.group_id, false) s
  where s.code is not null;
  if found then
    if v_existing.code = v_code then
      return query select * from public.f16_group_promo_state(v_ref.business_id, v_ref.group_id, false);
      return;
    end if;
    raise exception 'PROMO_ALREADY_APPLIED';
  end if;

  if v_ref.group_status not in ('scheduled','confirmed') or v_ref.first_start is null or v_ref.first_start <= now() then
    raise exception 'PROMO_NOT_ATTACHABLE';
  end if;
  -- Once the salon opened the ticket, the code is applied there by staff under
  -- the ticket version and the paid guard; the customer link no longer changes
  -- ticket money.
  if exists (
    select 1 from public.tickets t
    where t.business_id = v_ref.business_id and t.appointment_group_id = v_ref.group_id
  ) then
    raise exception 'PROMO_NOT_ATTACHABLE';
  end if;

  perform public.f16_reserve_promo(
    v_ref.business_id, v_code, v_ref.customer_id, 'booking', v_ref.group_id, null, v_ref.service_ids, null
  );
  return query select * from public.f16_group_promo_state(v_ref.business_id, v_ref.group_id, false);
end
$f1606attach$;

create or replace function public.f16_promo_operation_error(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $f1606operr$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN',
      'PROMO_NOT_FOUND','PROMO_NOT_STARTED','PROMO_EXPIRED','PROMO_EXHAUSTED',
      'PROMO_NOT_APPLICABLE','PROMO_ALREADY_APPLIED','PROMO_NOT_ATTACHABLE',
      'INVALID_PUBLIC_OPERATION'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$f1606operr$;

-- Same gate secret and S04 rate classes as execute_public_operation, with a
-- closed promo action list so the booking gateway itself is not widened.
create or replace function public.execute_public_promo_operation(
  p_action text, p_args jsonb, p_gate_secret text, p_actor_hash text, p_network_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $f1606gateway$
declare
  v_class text;
  v_data jsonb;
  v_service_ids uuid[];
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_prior_claims text := current_setting('request.jwt.claims', true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    return public.f16_promo_operation_error('PUBLIC_BOOKING_GATE_UNAVAILABLE');
  end if;

  v_class := case p_action
    when 'promo_preview' then 'read'
    when 'manage_promo_view' then 'manage_read'
    when 'manage_promo_attach' then 'manage_change'
    else null end;
  if v_class is null then return public.f16_promo_operation_error('INVALID_PUBLIC_OPERATION'); end if;

  begin
    perform public.enforce_public_booking_rate(v_class, p_actor_hash, p_network_hash);
  exception when others then return public.f16_promo_operation_error(sqlerrm);
  end;
  begin perform public.prune_public_booking_rate_counters(); exception when others then null; end;

  if p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text) > 4096 then
    return public.f16_promo_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    case p_action
      when 'promo_preview' then
        if jsonb_typeof(coalesce(p_args->'p_service_ids', '[]'::jsonb)) <> 'array' then
          raise exception 'INVALID_PUBLIC_OPERATION';
        end if;
        select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_service_ids
        from jsonb_array_elements_text(coalesce(p_args->'p_service_ids', '[]'::jsonb));
        select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
        from public.get_public_promo_preview((p_args->>'p_slug')::text, (p_args->>'p_code')::text, v_service_ids) r;
      when 'manage_promo_view' then
        select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
        from public.get_public_managed_promo((p_args->>'p_token')::text) r;
      when 'manage_promo_attach' then
        select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
        from public.attach_public_managed_promo((p_args->>'p_token')::text, (p_args->>'p_code')::text) r;
    end case;
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return public.f16_promo_operation_error('INVALID_PUBLIC_OPERATION');
  when others then
    return public.f16_promo_operation_error(sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'data', v_data);
end
$f1606gateway$;

-- Business surface ---------------------------------------------------------------------

create or replace function public.f16_promo_code_json(p_promo public.promo_codes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $f1606codejson$
  select jsonb_build_object(
    'promoId', p_promo.id,
    'businessId', p_promo.business_id,
    'code', p_promo.code,
    'kind', p_promo.kind,
    'percentBps', p_promo.percent_bps,
    'amountMinor', p_promo.amount_minor,
    'currency', p_promo.currency,
    'startsAt', p_promo.starts_at,
    'endsAt', p_promo.ends_at,
    'usageLimit', p_promo.usage_limit,
    'serviceIds', to_jsonb(p_promo.service_ids),
    'serviceNames', coalesce((
      select jsonb_agg(s.name order by s.name)
      from public.services s
      where s.business_id = p_promo.business_id and s.id = any(p_promo.service_ids)
    ), '[]'::jsonb),
    'reservedCount', (
      select count(*) from public.promo_redemptions r
      where r.business_id = p_promo.business_id and r.promo_code_id = p_promo.id and r.status = 'reserved'
    ),
    'consumedCount', (
      select count(*) from public.promo_redemptions r
      where r.business_id = p_promo.business_id and r.promo_code_id = p_promo.id and r.status = 'consumed'
    ),
    'active', p_promo.active,
    'version', p_promo.version,
    'createdAt', p_promo.created_at,
    'updatedAt', p_promo.updated_at
  )
$f1606codejson$;

create or replace function public.f16_validate_promo_terms(
  p_business_id uuid,
  p_kind text,
  p_percent_bps integer,
  p_amount_minor integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_usage_limit integer,
  p_service_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $f1606validate$
begin
  if p_kind not in ('percent','fixed')
     or (p_kind = 'percent' and (p_percent_bps is null or p_percent_bps not between 1 and 10000 or p_amount_minor is not null))
     or (p_kind = 'fixed' and (p_amount_minor is null or p_amount_minor not between 1 and 100000000 or p_percent_bps is not null))
     or p_starts_at is null
     or (p_ends_at is not null and p_ends_at <= p_starts_at)
     or (p_usage_limit is not null and p_usage_limit not between 1 and 100000)
     or p_service_ids is null or cardinality(p_service_ids) > 50
     or array_position(p_service_ids, null) is not null then
    raise exception 'INVALID_PROMO';
  end if;
  if exists (
    select 1 from unnest(p_service_ids) sid
    where not exists (select 1 from public.services s where s.business_id = p_business_id and s.id = sid)
  ) then
    raise exception 'SERVICE_NOT_FOUND';
  end if;
end
$f1606validate$;

create or replace function public.create_promo_code_guarded(
  p_business_id uuid,
  p_promo_id uuid,
  p_code text,
  p_kind text,
  p_percent_bps integer,
  p_amount_minor integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_usage_limit integer,
  p_service_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1606create$
declare
  v_actor public.memberships;
  v_code text := public.f16_normalize_promo_code(p_code);
  v_currency text;
  v_services uuid[];
  v_row public.promo_codes;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  if p_promo_id is null or v_code is null then raise exception 'INVALID_PROMO'; end if;
  v_services := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_service_ids, '{}'::uuid[])) x), '{}'::uuid[]);
  perform public.f16_validate_promo_terms(
    p_business_id, p_kind, p_percent_bps, p_amount_minor, p_starts_at, p_ends_at, p_usage_limit, v_services);

  select coalesce(min(s.currency), 'TRY') into v_currency
  from public.services s where s.business_id = p_business_id;

  if exists (
    select 1 from public.promo_codes p
    where p.business_id = p_business_id and p.code = v_code and p.id <> p_promo_id
  ) then
    raise exception 'PROMO_CODE_TAKEN';
  end if;

  insert into public.promo_codes(
    id, business_id, code, kind, percent_bps, amount_minor, currency,
    starts_at, ends_at, usage_limit, service_ids, created_by_membership_id
  ) values (
    p_promo_id, p_business_id, v_code, p_kind, p_percent_bps, p_amount_minor, v_currency,
    p_starts_at, p_ends_at, p_usage_limit, v_services, v_actor.id
  )
  on conflict (id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.promo_codes p where p.id = p_promo_id and p.business_id = p_business_id;
    if v_row.id is null or v_row.code <> v_code or v_row.kind <> p_kind
       or v_row.percent_bps is distinct from p_percent_bps or v_row.amount_minor is distinct from p_amount_minor
       or v_row.starts_at <> p_starts_at or v_row.ends_at is distinct from p_ends_at
       or v_row.usage_limit is distinct from p_usage_limit or v_row.service_ids <> v_services
       or v_row.version <> 1 then
      raise exception 'PROMO_ID_CONFLICT';
    end if;
  end if;
  return public.f16_promo_code_json(v_row);
exception when unique_violation then
  raise exception 'PROMO_CODE_TAKEN';
end
$f1606create$;

create or replace function public.update_promo_code_guarded(
  p_business_id uuid,
  p_promo_id uuid,
  p_expected_version integer,
  p_percent_bps integer,
  p_amount_minor integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_usage_limit integer,
  p_service_ids uuid[],
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1606update$
declare
  v_actor public.memberships;
  v_row public.promo_codes;
  v_services uuid[];
begin
  v_actor := public.f14_financial_actor(p_business_id);
  if p_promo_id is null or p_expected_version is null or p_expected_version < 1 or p_active is null then
    raise exception 'INVALID_PROMO';
  end if;
  select * into v_row from public.promo_codes p
  where p.business_id = p_business_id and p.id = p_promo_id
  for update;
  if v_row.id is null then raise exception 'PROMO_NOT_FOUND'; end if;
  v_services := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_service_ids, '{}'::uuid[])) x), '{}'::uuid[]);
  perform public.f16_validate_promo_terms(
    p_business_id, v_row.kind, p_percent_bps, p_amount_minor, p_starts_at, p_ends_at, p_usage_limit, v_services);

  if v_row.version = p_expected_version + 1
     and v_row.percent_bps is not distinct from p_percent_bps and v_row.amount_minor is not distinct from p_amount_minor
     and v_row.starts_at = p_starts_at and v_row.ends_at is not distinct from p_ends_at
     and v_row.usage_limit is not distinct from p_usage_limit and v_row.service_ids = v_services
     and v_row.active = p_active then
    return public.f16_promo_code_json(v_row);
  end if;
  if v_row.version <> p_expected_version then raise exception 'STALE_PROMO_WRITE'; end if;

  update public.promo_codes
  set percent_bps = p_percent_bps,
      amount_minor = p_amount_minor,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      usage_limit = p_usage_limit,
      service_ids = v_services,
      active = p_active,
      version = version + 1,
      updated_at = now()
  where business_id = p_business_id and id = p_promo_id
  returning * into v_row;
  return public.f16_promo_code_json(v_row);
end
$f1606update$;

create or replace function public.list_promo_codes(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1606list$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.f16_promo_code_json(p) order by p.active desc, p.code)
    from (
      select * from public.promo_codes x
      where x.business_id = p_business_id
      order by x.active desc, x.code
      limit 200
    ) p
  ), '[]'::jsonb);
end
$f1606list$;

create or replace function public.apply_ticket_promo_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_code text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1606apply$
declare
  v_actor public.memberships;
  v_group_id uuid;
  v_ticket public.tickets;
  v_services uuid[];
  v_total bigint;
  v_paid bigint;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'apply_promo', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  -- Same lock order as ticket open and the booking-side attach: the per-group
  -- ticket lock first, then the ticket row.
  select t.appointment_group_id into v_group_id
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id;
  if v_group_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_business_id::text || ':ticket-group:' || v_group_id::text, 0
    ));
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;
  if (public.f16_ticket_promo_redemption(p_business_id, p_ticket_id)).id is not null then
    raise exception 'PROMO_ALREADY_APPLIED';
  end if;

  select coalesce(array_agg(distinct l.service_id), '{}'::uuid[]) into v_services
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id and l.source_type = 'service';

  perform public.f16_reserve_promo(
    p_business_id, p_code, v_ticket.customer_id, 'ticket', null, p_ticket_id, v_services, v_actor.id
  );

  -- The promo can only lower the total; it must not fall below what is paid.
  v_total := public.f16_ticket_total_minor(p_business_id, p_ticket_id);
  v_paid := public.f14_ticket_paid_minor(p_business_id, p_ticket_id);
  if v_total is not null and v_total < v_paid then raise exception 'TICKET_TOTAL_BELOW_PAID'; end if;

  update public.tickets set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'apply_promo', p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f1606apply$;

create or replace function public.remove_ticket_promo_guarded(
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
as $f1606remove$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_redemption public.promo_redemptions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'remove_promo', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason) > 240 then raise exception 'INVALID_PROMO_REMOVAL'; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  v_redemption := public.f16_ticket_promo_redemption(p_business_id, p_ticket_id);
  if v_redemption.id is null then raise exception 'PROMO_NOT_APPLIED'; end if;

  update public.promo_redemptions
  set status = 'released', released_at = now(), release_reason = v_reason
  where business_id = p_business_id and id = v_redemption.id;

  update public.tickets set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'remove_promo', p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f1606remove$;

-- Lifecycle ------------------------------------------------------------------------------

-- Ticket close consumes the reservation and snapshots the discount with a
-- deterministic per-line allocation; ticket cancel releases it.
create or replace function public.f16_promo_effects_on_ticket_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1606ticketstatus$
declare
  v_r public.promo_redemptions;
  v_base_sum bigint;
  v_total bigint;
begin
  v_r := public.f16_ticket_promo_redemption(new.business_id, new.id);
  if v_r.id is null or v_r.status <> 'reserved' then return null; end if;
  select * into v_r from public.promo_redemptions r
  where r.business_id = new.business_id and r.id = v_r.id
  for update;

  if new.status = 'cancelled' then
    update public.promo_redemptions
    set status = 'released', released_at = now(), release_reason = 'Adisyon iptali'
    where business_id = new.business_id and id = v_r.id;
    return null;
  end if;

  select coalesce(sum(b.base_minor), 0) into v_base_sum
  from public.f16_promo_line_bases(new.business_id, new.id, v_r.service_ids_snapshot, v_r.currency_snapshot) b;
  v_total := public.f16_promo_amount(v_r.kind_snapshot, v_r.percent_bps_snapshot, v_r.amount_minor_snapshot, v_base_sum);

  if v_total > 0 then
    -- Proportional floor shares; the rounding remainder goes one minor unit at
    -- a time to the lines in ticket order. When a remainder exists the total is
    -- below the eligible sum, so every line with a positive base can take it.
    insert into public.promo_redemption_lines(business_id, redemption_id, ticket_line_id, base_minor, discount_minor)
    select new.business_id, v_r.id, a.line_id, a.base_minor, a.share + case when a.rn <= a.remainder then 1 else 0 end
    from (
      select b.line_id, b.base_minor, b.share,
        v_total - sum(b.share) over () as remainder,
        case when b.share < b.base_minor
          then row_number() over (partition by b.share < b.base_minor order by b.line_ordinal)
          else null end as rn
      from (
        select x.line_id, x.line_ordinal, x.base_minor, (v_total * x.base_minor) / v_base_sum as share
        from public.f16_promo_line_bases(new.business_id, new.id, v_r.service_ids_snapshot, v_r.currency_snapshot) x
      ) b
    ) a
    where a.share + case when a.rn <= a.remainder then 1 else 0 end > 0;
  end if;

  update public.promo_redemptions
  set status = 'consumed', ticket_id = new.id, consumed_at = now(), discount_minor = v_total
  where business_id = new.business_id and id = v_r.id;
  return null;
end
$f1606ticketstatus$;

create trigger tickets_f16_promo_status_effects
after update of status on public.tickets
for each row
when (old.status = 'open' and new.status in ('closed','cancelled'))
execute function public.f16_promo_effects_on_ticket_status();

-- A cancelled or no-show appointment gives its reserved booking slot back.
create or replace function public.f16_promo_effects_on_group_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1606groupstatus$
begin
  update public.promo_redemptions
  set status = 'released', released_at = now(),
      release_reason = case when new.status = 'no_show' then 'Randevuya gelinmedi' else 'Randevu iptali' end
  where business_id = new.business_id and appointment_group_id = new.id and status = 'reserved';
  return null;
end
$f1606groupstatus$;

create trigger appointment_groups_f16_promo_release
after update of status on public.appointment_groups
for each row
when (old.status is distinct from new.status and new.status in ('cancelled','no_show'))
execute function public.f16_promo_effects_on_group_status();

-- Day report: service sales are net of the promo discount; the discount itself
-- is shown separately for reconciliation.
create or replace function public.get_financial_day_report(
  p_business_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $f1606report$
declare
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
  v_currency_count integer;
  v_currency text;
  v_result jsonb;
begin
  perform public.f10_require_standard_session();

  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;
  if not public.has_financial_permission(
    p_business_id,
    'financial_reports_read'::public.financial_permission_key
  ) then
    raise exception 'FINANCIAL_REPORTS_PERMISSION_REQUIRED' using errcode='42501';
  end if;

  if p_start_date is null or p_end_date is null
     or p_end_date < p_start_date
     or p_end_date > p_start_date + 91 then
    raise exception 'INVALID_REPORT_RANGE';
  end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  -- Same boundary rule as F13-02: local midnight is converted through the
  -- business IANA timezone, so DST 23/25-hour days remain correct.
  v_from := p_start_date::timestamp at time zone v_timezone;
  v_to := (p_end_date + 1)::timestamp at time zone v_timezone;

  select count(distinct x.currency), min(x.currency)
  into v_currency_count, v_currency
  from (
    select t.currency
    from public.ticket_payment_events e
    join public.tickets t
      on t.business_id=e.business_id and t.id=e.ticket_id
    where e.business_id=p_business_id
      and e.created_at>=v_from and e.created_at<v_to
      and t.currency is not null
    union all
    select e.currency
    from public.expense_events e
    where e.business_id=p_business_id
      and e.occurred_at>=v_from and e.occurred_at<v_to
    union all
    select t.currency
    from public.tickets t
    where t.business_id=p_business_id
      and t.status<>'cancelled'
      and t.created_at>=v_from and t.created_at<v_to
      and t.currency is not null
    union all
    select a.currency_snapshot
    from public.appointments a
    where a.business_id=p_business_id
      and a.status<>'cancelled'
      and a.starts_at>=v_from and a.starts_at<v_to
      and a.currency_snapshot is not null
  ) x;

  if v_currency_count > 1 then
    raise exception 'REPORT_CURRENCY_MIXED';
  end if;

  with
  payment as (
    select
      coalesce(sum(case when e.event_type='payment'
                        then e.amount_minor else 0 end),0)::bigint as collected_minor,
      coalesce(sum(case when e.event_type='refund' then e.amount_minor else 0 end),0)::bigint as refund_minor,
      coalesce(sum(case when e.event_type='correction' and e.correction_direction='increase'
                        then e.amount_minor else 0 end),0)::bigint as correction_increase_minor,
      coalesce(sum(case when e.event_type='correction' and e.correction_direction='decrease'
                        then e.amount_minor else 0 end),0)::bigint as correction_decrease_minor,
      coalesce(sum(case
        when e.event_type='payment' then e.amount_minor
        when e.event_type='correction' and e.correction_direction='increase' then e.amount_minor
        else -e.amount_minor end),0)::bigint as net_minor,
      coalesce(sum(case when e.payment_method='cash' then
        case when e.event_type='payment'
                  or (e.event_type='correction' and e.correction_direction='increase')
             then e.amount_minor else -e.amount_minor end else 0 end),0)::bigint as cash_net_minor,
      coalesce(sum(case when e.payment_method='card' then
        case when e.event_type='payment'
                  or (e.event_type='correction' and e.correction_direction='increase')
             then e.amount_minor else -e.amount_minor end else 0 end),0)::bigint as card_net_minor,
      coalesce(sum(case when e.payment_method='cash' and e.event_type='payment'
                        then e.amount_minor else 0 end),0)::bigint as cash_in_minor,
      coalesce(sum(case when e.payment_method='card' and e.event_type='payment'
                        then e.amount_minor else 0 end),0)::bigint as card_in_minor
    from public.ticket_payment_events e
    where e.business_id=p_business_id
      and e.created_at>=v_from and e.created_at<v_to
  ),
  expense as (
    select
      coalesce(sum(case when e.event_type='expense' then e.amount_minor else -e.amount_minor end),0)::bigint as net_minor,
      coalesce(sum(case when e.payment_method='cash' then
        case when e.event_type='expense' then e.amount_minor else -e.amount_minor end
        else 0 end),0)::bigint as cash_net_minor,
      coalesce(sum(case when e.payment_method='card' then
        case when e.event_type='expense' then e.amount_minor else -e.amount_minor end
        else 0 end),0)::bigint as card_net_minor
    from public.expense_events e
    where e.business_id=p_business_id
      and e.occurred_at>=v_from and e.occurred_at<v_to
  ),
  ticket_scope as (
    select t.id,t.business_id
    from public.tickets t
    where t.business_id=p_business_id
      and t.status<>'cancelled'
      and t.created_at>=v_from and t.created_at<v_to
  ),
  package_refund as (
    select cp.sale_ticket_id as ticket_id,
           coalesce(sum(cp.refund_value_minor::bigint),0)::bigint as refunded_minor
    from ticket_scope ts
    join public.customer_packages cp
      on cp.business_id=ts.business_id and cp.sale_ticket_id=ts.id and cp.status='refunded'
    group by cp.sale_ticket_id
  ),
  -- Sessions covered by a package right: shown for reconciliation, never income.
  package_cover as (
    select count(*)::integer as covered_count,
           coalesce(sum(u.value_minor::bigint),0)::bigint as covered_value_minor
    from ticket_scope ts
    join public.customer_package_usages u
      on u.business_id=ts.business_id and u.ticket_id=ts.id and u.kind='use'
    where not exists (
      select 1 from public.customer_package_usages r
      where r.business_id=u.business_id and r.reverses_usage_id=u.id and r.kind='reverse'
    )
  ),
  promo as (
    select ts.id as ticket_id, public.f16_ticket_promo_amount(ts.business_id, ts.id) as promo_minor
    from ticket_scope ts
  ),
  return_value as (
    select r.ticket_id,
           coalesce(sum(r.quantity::bigint*l.final_unit_price_minor::bigint),0)::bigint as returned_minor
    from ticket_scope ts
    join public.ticket_product_returns r
      on r.business_id=ts.business_id and r.ticket_id=ts.id
    join public.ticket_lines l
      on l.business_id=r.business_id and l.id=r.ticket_line_id
    group by r.ticket_id
  ),
  payment_all_time as (
    select e.ticket_id,
           coalesce(sum(case
             when e.event_type='payment' then e.amount_minor
             when e.event_type='correction' and e.correction_direction='increase' then e.amount_minor
             else -e.amount_minor end),0)::bigint as paid_minor
    from ticket_scope ts
    join public.ticket_payment_events e
      on e.business_id=ts.business_id and e.ticket_id=ts.id
    group by e.ticket_id
  ),
  appointment_expected as (
    select
      coalesce(sum(a.price_min_minor_snapshot::bigint),0)::bigint as min_minor,
      coalesce(sum(a.price_max_minor_snapshot::bigint),0)::bigint as max_minor,
      count(*)::integer as appointment_count
    from public.appointments a
    where a.business_id=p_business_id
      and a.status<>'cancelled'
      and a.starts_at>=v_from and a.starts_at<v_to
  ),
  ticket_rollup as (
    select
      ts.id,
      bool_and(l.final_unit_price_minor is not null) as settled,
      greatest(
        coalesce(sum(
          l.price_min_minor_snapshot::bigint*l.quantity::bigint-l.discount_minor::bigint
        ),0)::bigint - coalesce(rv.returned_minor,0) - coalesce(pr.refunded_minor,0) - coalesce(pm.promo_minor,0),
        0
      )::bigint as expected_min_minor,
      greatest(
        coalesce(sum(
          l.price_max_minor_snapshot::bigint*l.quantity::bigint-l.discount_minor::bigint
        ),0)::bigint - coalesce(rv.returned_minor,0) - coalesce(pr.refunded_minor,0) - coalesce(pm.promo_minor,0),
        0
      )::bigint as expected_max_minor,
      -- A promo discount only ever reduces eligible service lines.
      greatest(
        coalesce(sum(case when l.source_type='service' and l.final_unit_price_minor is not null
                          then l.final_unit_price_minor::bigint*l.quantity::bigint-l.discount_minor::bigint
                          else 0 end),0)::bigint
        - coalesce(pm.promo_minor,0),
        0
      )::bigint as service_minor,
      coalesce(pm.promo_minor,0)::bigint as promo_minor,
      greatest(
        coalesce(sum(case when l.source_type='product' and l.final_unit_price_minor is not null
                          then l.final_unit_price_minor::bigint*l.quantity::bigint-l.discount_minor::bigint
                          else 0 end),0)::bigint
        - coalesce(rv.returned_minor,0),
        0
      )::bigint as product_minor,
      greatest(
        coalesce(sum(case when l.source_type='package' and l.final_unit_price_minor is not null
                          then l.final_unit_price_minor::bigint*l.quantity::bigint-l.discount_minor::bigint
                          else 0 end),0)::bigint
        - coalesce(pr.refunded_minor,0),
        0
      )::bigint as package_minor,
      coalesce(pa.paid_minor,0)::bigint as paid_minor
    from ticket_scope ts
    join public.ticket_lines l
      on l.business_id=ts.business_id and l.ticket_id=ts.id
    left join return_value rv on rv.ticket_id=ts.id
    left join package_refund pr on pr.ticket_id=ts.id
    left join promo pm on pm.ticket_id=ts.id
    left join payment_all_time pa on pa.ticket_id=ts.id
    group by ts.id,rv.returned_minor,pr.refunded_minor,pm.promo_minor,pa.paid_minor
  ),
  sale as (
    select
      coalesce(sum(tr.expected_min_minor),0)::bigint as expected_min_minor,
      coalesce(sum(tr.expected_max_minor),0)::bigint as expected_max_minor,
      coalesce(sum(case when tr.settled then tr.service_minor else 0 end),0)::bigint as service_minor,
      coalesce(sum(case when tr.settled then tr.product_minor else 0 end),0)::bigint as product_minor,
      coalesce(sum(case when tr.settled then tr.package_minor else 0 end),0)::bigint as package_minor,
      coalesce(sum(case when tr.settled then tr.promo_minor else 0 end),0)::bigint as promo_minor,
      coalesce(sum(case when tr.settled then
        greatest(tr.service_minor+tr.product_minor+tr.package_minor-tr.paid_minor,0)
        else 0 end),0)::bigint as outstanding_minor,
      count(*) filter (where not tr.settled)::integer as unsettled_ticket_count,
      count(*)::integer as ticket_count
    from ticket_rollup tr
  )
  select jsonb_build_object(
    'businessId',p_business_id,
    'startDate',p_start_date,
    'endDate',p_end_date,
    'timezone',v_timezone,
    'fromInstant',v_from,
    'toInstant',v_to,
    'asOf',statement_timestamp(),
    'currency',v_currency,
    'collectedMinor',p.collected_minor,
    'cashCollectedMinor',p.cash_in_minor,
    'cardCollectedMinor',p.card_in_minor,
    'refundMinor',p.refund_minor,
    'correctionIncreaseMinor',p.correction_increase_minor,
    'correctionDecreaseMinor',p.correction_decrease_minor,
    'paymentNetMinor',p.net_minor,
    'expenseMinor',e.net_minor,
    'cashExpenseMinor',e.cash_net_minor,
    'cardExpenseMinor',e.card_net_minor,
    'netMovementMinor',p.net_minor-e.net_minor,
    'cashNetMovementMinor',p.cash_net_minor-e.cash_net_minor,
    'cardNetMovementMinor',p.card_net_minor-e.card_net_minor,
    'expectedMinMinor',s.expected_min_minor,
    'expectedMaxMinor',s.expected_max_minor,
    'expectedAppointmentMinMinor',a.min_minor,
    'expectedAppointmentMaxMinor',a.max_minor,
    'appointmentCount',a.appointment_count,
    'serviceSaleMinor',s.service_minor,
    'productSaleMinor',s.product_minor,
    'packageSaleMinor',s.package_minor,
    'promoDiscountMinor',s.promo_minor,
    'saleValueMinor',s.service_minor+s.product_minor+s.package_minor,
    'packageCoveredSessionCount',pc.covered_count,
    'packageCoveredValueMinor',pc.covered_value_minor,
    'outstandingMinor',s.outstanding_minor,
    'ticketCount',s.ticket_count,
    'unsettledTicketCount',s.unsettled_ticket_count
  )
  into v_result
  from payment p cross join expense e cross join appointment_expected a cross join sale s
  cross join package_cover pc;

  return v_result;
end
$f1606report$;

revoke all on function public.get_financial_day_report(uuid,date,date)
from public, anon, authenticated;
grant execute on function public.get_financial_day_report(uuid,date,date)
to authenticated;

-- Grants ---------------------------------------------------------------------------------

revoke all on function public.f16_guard_promo_code_change() from public, anon, authenticated;
revoke all on function public.f16_guard_promo_redemption_change() from public, anon, authenticated;
revoke all on function public.f16_guard_promo_ledger() from public, anon, authenticated;
revoke all on function public.f16_normalize_promo_code(text) from public, anon, authenticated;
revoke all on function public.f16_ticket_promo_redemption(uuid,uuid) from public, anon, authenticated;
revoke all on function public.f16_promo_line_bases(uuid,uuid,uuid[],text) from public, anon, authenticated;
revoke all on function public.f16_promo_amount(text,integer,integer,bigint) from public, anon, authenticated;
revoke all on function public.f16_ticket_promo_amount(uuid,uuid) from public, anon, authenticated;
revoke all on function public.f16_ticket_money(uuid,uuid) from public, anon, authenticated;
revoke all on function public.f16_ticket_total_minor(uuid,uuid) from public, anon, authenticated;
revoke all on function public.f16_reserve_promo(uuid,text,uuid,text,uuid,uuid,uuid[],uuid) from public, anon, authenticated;
revoke all on function public.f16_public_business_id(text) from public, anon, authenticated;
revoke all on function public.get_public_promo_preview(text,text,uuid[]) from public, anon, authenticated;
revoke all on function public.f16_promo_ref(text) from public, anon, authenticated;
revoke all on function public.f16_group_promo_state(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.get_public_managed_promo(text) from public, anon, authenticated;
revoke all on function public.attach_public_managed_promo(text,text) from public, anon, authenticated;
revoke all on function public.f16_promo_operation_error(text) from public, anon, authenticated;
revoke all on function public.f16_promo_code_json(public.promo_codes) from public, anon, authenticated;
revoke all on function public.f16_validate_promo_terms(uuid,text,integer,integer,timestamptz,timestamptz,integer,uuid[]) from public, anon, authenticated;
revoke all on function public.f16_promo_effects_on_ticket_status() from public, anon, authenticated;
revoke all on function public.f16_promo_effects_on_group_status() from public, anon, authenticated;

revoke all on function public.execute_public_promo_operation(text,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.create_promo_code_guarded(uuid,uuid,text,text,integer,integer,timestamptz,timestamptz,integer,uuid[]) from public, anon, authenticated;
revoke all on function public.update_promo_code_guarded(uuid,uuid,integer,integer,integer,timestamptz,timestamptz,integer,uuid[],boolean) from public, anon, authenticated;
revoke all on function public.list_promo_codes(uuid) from public, anon, authenticated;
revoke all on function public.apply_ticket_promo_guarded(uuid,uuid,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.remove_ticket_promo_guarded(uuid,uuid,text,integer,text,text) from public, anon, authenticated;

grant execute on function public.execute_public_promo_operation(text,jsonb,text,text,text) to anon;
grant execute on function public.create_promo_code_guarded(uuid,uuid,text,text,integer,integer,timestamptz,timestamptz,integer,uuid[]) to authenticated;
grant execute on function public.update_promo_code_guarded(uuid,uuid,integer,integer,integer,timestamptz,timestamptz,integer,uuid[],boolean) to authenticated;
grant execute on function public.list_promo_codes(uuid) to authenticated;
grant execute on function public.apply_ticket_promo_guarded(uuid,uuid,text,integer,text,text) to authenticated;
grant execute on function public.remove_ticket_promo_guarded(uuid,uuid,text,integer,text,text) to authenticated;

commit;
