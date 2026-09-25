begin;

-- F16-07: staff commission and staff report.
--
-- Earning basis (product decision): commission is written line by line when a
-- ticket closes, as rate × (line price − line discount − promo share). A
-- package-covered session earns on the package's per-session value, a package
-- sale itself earns nothing, and a product line earns at the product rate of
-- the staff profile that entered it. Partial payment never changes commission:
-- a ticket only closes once it is fully paid.
--
-- After close, commission follows the ticket's money:
--   * a product return writes a negative movement for the same staff line;
--   * any other money given back or corrected (goodwill refunds, payment
--     corrections) is the ticket balance total − paid, spread over the lines in
--     proportion to their share of the ticket total (largest remainder), and
--     written as adjustment movements for the same staff.
-- Each movement stores the cumulative base and amount after it, and the amount
-- is always round_half_up(rate × cumulative base) minus the previous one, so
-- rounding never adds up past the rate of the remaining source amount.
--
-- Rates are append-only versions. A line snapshots the rate that was current at
-- close, so a later rate change never rewrites an old report. No payroll or
-- salary engine is added.

-- Rate versions --------------------------------------------------------------------

create table public.staff_commission_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  version integer not null check (version between 1 and 100000),
  service_rate_bps integer not null check (service_rate_bps between 0 and 10000),
  product_rate_bps integer not null check (product_rate_bps between 0 and 10000),
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  constraint staff_commission_rates_business_id_key unique (business_id, id),
  constraint staff_commission_rates_version_key unique (business_id, staff_id, version),
  constraint staff_commission_rates_staff_fk
    foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id) on delete cascade,
  constraint staff_commission_rates_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id)
);

create table public.staff_service_commission_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  version integer not null check (version between 1 and 100000),
  -- null clears the override: the staff default service rate applies again.
  rate_bps integer check (rate_bps is null or rate_bps between 0 and 10000),
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  constraint staff_service_commission_rates_business_id_key unique (business_id, id),
  constraint staff_service_commission_rates_version_key unique (business_id, staff_id, service_id, version),
  constraint staff_service_commission_rates_staff_fk
    foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id) on delete cascade,
  constraint staff_service_commission_rates_service_fk
    foreign key (business_id, service_id)
    references public.services(business_id, id) on delete cascade,
  constraint staff_service_commission_rates_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id)
);

-- Commission lines and movements ------------------------------------------------------

-- One row per commissionable ticket line, written once when the ticket closes.
create table public.staff_commission_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  ticket_id uuid not null,
  ticket_line_id uuid not null,
  line_ordinal integer not null check (line_ordinal between 1 and 100),
  staff_id uuid not null,
  staff_name_snapshot text not null check (char_length(btrim(staff_name_snapshot)) between 1 and 120),
  line_kind text not null check (line_kind in ('service','package_covered','product')),
  item_name_snapshot text not null check (char_length(btrim(item_name_snapshot)) between 1 and 120),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  rate_source text not null check (rate_source in ('service_default','service_override','product_default','none')),
  rate_version_id uuid,
  override_version_id uuid,
  base_at_close_minor bigint not null check (base_at_close_minor between 0 and 100000000000),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor between 0 and 100000000),
  quantity_at_close integer check (quantity_at_close is null or quantity_at_close between 0 and 1000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  closed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint staff_commission_lines_business_id_key unique (business_id, id),
  constraint staff_commission_lines_line_key unique (business_id, ticket_line_id),
  constraint staff_commission_lines_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint staff_commission_lines_line_fk
    foreign key (business_id, ticket_line_id)
    references public.ticket_lines(business_id, id),
  constraint staff_commission_lines_staff_fk
    foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id),
  constraint staff_commission_lines_rate_fk
    foreign key (business_id, rate_version_id)
    references public.staff_commission_rates(business_id, id),
  constraint staff_commission_lines_override_fk
    foreign key (business_id, override_version_id)
    references public.staff_service_commission_rates(business_id, id),
  constraint staff_commission_lines_shape
    check (
      (line_kind = 'product' and unit_price_minor is not null and quantity_at_close is not null
        and base_at_close_minor = unit_price_minor * quantity_at_close
        and rate_source in ('product_default','none') and override_version_id is null)
      or (line_kind in ('service','package_covered') and unit_price_minor is null and quantity_at_close is null
        and rate_source in ('service_default','service_override','none'))
    ),
  constraint staff_commission_lines_rate_source_shape
    check (
      (rate_source = 'none' and rate_bps = 0 and rate_version_id is null and override_version_id is null)
      or (rate_source = 'service_override' and override_version_id is not null)
      or (rate_source in ('service_default','product_default') and rate_version_id is not null and override_version_id is null)
    )
);

create index staff_commission_lines_ticket_idx
  on public.staff_commission_lines(business_id, ticket_id, line_ordinal);

-- Append-only movement ledger. The cumulative columns are the running totals of
-- the commission line after this movement.
create table public.staff_commission_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  commission_line_id uuid not null,
  staff_id uuid not null,
  ticket_id uuid not null,
  kind text not null check (kind in ('line','product_return','payment_adjustment')),
  base_minor bigint not null check (base_minor between -100000000000 and 100000000000),
  amount_minor bigint not null check (amount_minor between -100000000000 and 100000000000),
  cumulative_base_minor bigint not null check (cumulative_base_minor between 0 and 100000000000),
  cumulative_amount_minor bigint not null check (cumulative_amount_minor between 0 and 100000000000),
  returned_quantity integer check (returned_quantity is null or returned_quantity between 1 and 1000),
  source_return_id uuid,
  source_payment_event_id uuid,
  occurred_at timestamptz not null default now(),
  constraint staff_commission_entries_business_id_key unique (business_id, id),
  constraint staff_commission_entries_line_fk
    foreign key (business_id, commission_line_id)
    references public.staff_commission_lines(business_id, id),
  constraint staff_commission_entries_staff_fk
    foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id),
  constraint staff_commission_entries_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint staff_commission_entries_return_fk
    foreign key (business_id, source_return_id)
    references public.ticket_product_returns(business_id, id),
  constraint staff_commission_entries_payment_fk
    foreign key (business_id, ticket_id, source_payment_event_id)
    references public.ticket_payment_events(business_id, ticket_id, id),
  constraint staff_commission_entries_shape
    check (
      (kind = 'line' and base_minor >= 0 and amount_minor >= 0
        and returned_quantity is null and source_return_id is null and source_payment_event_id is null)
      or (kind = 'product_return' and base_minor < 0 and amount_minor <= 0
        and returned_quantity is not null and source_return_id is not null and source_payment_event_id is null)
      or (kind = 'payment_adjustment' and base_minor <> 0
        and returned_quantity is null and source_return_id is null)
    )
);

create unique index staff_commission_entries_one_line_idx
  on public.staff_commission_entries(business_id, commission_line_id)
  where kind = 'line';

create index staff_commission_entries_line_idx
  on public.staff_commission_entries(business_id, commission_line_id, occurred_at, id);

create index staff_commission_entries_period_idx
  on public.staff_commission_entries(business_id, occurred_at, staff_id);

alter table public.staff_commission_rates enable row level security;
alter table public.staff_commission_rates force row level security;
alter table public.staff_service_commission_rates enable row level security;
alter table public.staff_service_commission_rates force row level security;
alter table public.staff_commission_lines enable row level security;
alter table public.staff_commission_lines force row level security;
alter table public.staff_commission_entries enable row level security;
alter table public.staff_commission_entries force row level security;
revoke all on table public.staff_commission_rates from public, anon, authenticated;
revoke all on table public.staff_service_commission_rates from public, anon, authenticated;
revoke all on table public.staff_commission_lines from public, anon, authenticated;
revoke all on table public.staff_commission_entries from public, anon, authenticated;

-- Guards ------------------------------------------------------------------------------

create or replace function public.f16_guard_commission_immutable()
returns trigger
language plpgsql
set search_path = ''
as $f1607immutable$
begin
  raise exception 'COMMISSION_LEDGER_IMMUTABLE' using errcode = '55000';
end
$f1607immutable$;

create trigger staff_commission_rates_immutable
before update or delete on public.staff_commission_rates
for each row
when (pg_trigger_depth() = 0)
execute function public.f16_guard_commission_immutable();

create trigger staff_service_commission_rates_immutable
before update or delete on public.staff_service_commission_rates
for each row
when (pg_trigger_depth() = 0)
execute function public.f16_guard_commission_immutable();

-- Lines and movements are never edited or removed, not even by a cascade.
create trigger staff_commission_lines_immutable
before update or delete on public.staff_commission_lines
for each row
execute function public.f16_guard_commission_immutable();

create trigger staff_commission_entries_immutable
before update or delete on public.staff_commission_entries
for each row
execute function public.f16_guard_commission_immutable();

-- Helpers ---------------------------------------------------------------------------------

create or replace function public.f16_commission_amount(p_base bigint, p_rate_bps integer)
returns bigint
language sql
immutable
set search_path = ''
as $f1607amount$
  select case when coalesce(p_base, 0) <= 0 or coalesce(p_rate_bps, 0) <= 0 then 0::bigint
    else public.f16_round_half_up_div(p_base * p_rate_bps, 10000) end
$f1607amount$;

-- The rate that applies to a service line for a staff profile right now:
-- a current per-service override wins over the staff default service rate.
create or replace function public.f16_service_commission_rate(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  out rate_bps integer,
  out rate_source text,
  out rate_version_id uuid,
  out override_version_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $f1607servicerate$
declare
  v_override public.staff_service_commission_rates;
  v_default public.staff_commission_rates;
begin
  select * into v_override
  from public.staff_service_commission_rates o
  where o.business_id = p_business_id and o.staff_id = p_staff_id and o.service_id = p_service_id
  order by o.version desc
  limit 1;

  if v_override.id is not null and v_override.rate_bps is not null then
    rate_bps := v_override.rate_bps;
    rate_source := 'service_override';
    override_version_id := v_override.id;
    return;
  end if;

  select * into v_default
  from public.staff_commission_rates r
  where r.business_id = p_business_id and r.staff_id = p_staff_id
  order by r.version desc
  limit 1;

  if v_default.id is null then
    rate_bps := 0;
    rate_source := 'none';
    return;
  end if;
  rate_bps := v_default.service_rate_bps;
  rate_source := 'service_default';
  rate_version_id := v_default.id;
end
$f1607servicerate$;

-- Appends one movement and keeps the cumulative amount equal to
-- round_half_up(rate × cumulative base).
create or replace function public.f16_append_commission_entry(
  p_line public.staff_commission_lines,
  p_kind text,
  p_base_delta bigint,
  p_returned_quantity integer,
  p_source_return_id uuid,
  p_source_payment_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $f1607append$
declare
  v_cum_base bigint;
  v_cum_amount bigint;
  v_new_base bigint;
  v_new_amount bigint;
begin
  select coalesce(sum(e.base_minor), 0), coalesce(sum(e.amount_minor), 0)
  into v_cum_base, v_cum_amount
  from public.staff_commission_entries e
  where e.business_id = p_line.business_id and e.commission_line_id = p_line.id;

  v_new_base := v_cum_base + p_base_delta;
  v_new_amount := public.f16_commission_amount(v_new_base, p_line.rate_bps);
  if p_kind <> 'line' and p_base_delta = 0 then return; end if;

  insert into public.staff_commission_entries(
    business_id, commission_line_id, staff_id, ticket_id, kind,
    base_minor, amount_minor, cumulative_base_minor, cumulative_amount_minor,
    returned_quantity, source_return_id, source_payment_event_id
  ) values (
    p_line.business_id, p_line.id, p_line.staff_id, p_line.ticket_id, p_kind,
    p_base_delta, v_new_amount - v_cum_amount, v_new_base, v_new_amount,
    p_returned_quantity, p_source_return_id, p_source_payment_event_id
  );
end
$f1607append$;

-- Ticket close ------------------------------------------------------------------------------

create or replace function public.f16_commission_on_ticket_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1607close$
declare
  v_line record;
  v_rate record;
  v_use public.customer_package_usages;
  v_staff public.staff_profiles;
  v_row public.staff_commission_lines;
  v_kind text;
  v_base bigint;
  v_promo bigint;
  v_returned integer;
  v_default public.staff_commission_rates;
begin
  for v_line in
    select l.*
    from public.ticket_lines l
    where l.business_id = new.business_id and l.ticket_id = new.id
    order by l.line_ordinal
  loop
    v_staff := null;
    v_rate := null;
    if v_line.source_type = 'service' and v_line.staff_id is not null then
      select * into v_staff from public.staff_profiles s
      where s.business_id = v_line.business_id and s.id = v_line.staff_id;
      v_use := public.f16_active_package_use(v_line.business_id, v_line.id);
      select * into v_rate
      from public.f16_service_commission_rate(v_line.business_id, v_line.staff_id, v_line.service_id);
      if v_use.id is not null then
        v_kind := 'package_covered';
        v_base := v_use.value_minor;
      else
        select coalesce(sum(pl.discount_minor), 0) into v_promo
        from public.promo_redemption_lines pl
        join public.promo_redemptions r
          on r.business_id = pl.business_id and r.id = pl.redemption_id
        where pl.business_id = v_line.business_id and pl.ticket_line_id = v_line.id
          and r.status = 'consumed';
        v_kind := 'service';
        v_base := greatest(v_line.final_unit_price_minor::bigint - v_line.discount_minor::bigint - v_promo, 0);
      end if;

      insert into public.staff_commission_lines(
        business_id, ticket_id, ticket_line_id, line_ordinal, staff_id, staff_name_snapshot,
        line_kind, item_name_snapshot, rate_bps, rate_source, rate_version_id, override_version_id,
        base_at_close_minor, currency, closed_at
      ) values (
        v_line.business_id, new.id, v_line.id, v_line.line_ordinal, v_line.staff_id,
        coalesce(v_line.staff_name_snapshot, v_staff.name),
        v_kind, v_line.service_name_snapshot, v_rate.rate_bps, v_rate.rate_source,
        v_rate.rate_version_id, v_rate.override_version_id,
        v_base, v_line.currency_snapshot, new.closed_at
      )
      returning * into v_row;
      perform public.f16_append_commission_entry(v_row, 'line', v_base, null, null, null);

    elsif v_line.source_type = 'product' then
      select * into v_staff from public.staff_profiles s
      where s.business_id = v_line.business_id and s.membership_id = v_line.created_by_membership_id;
      if v_staff.id is null then continue; end if;

      select coalesce(sum(r.quantity), 0)::integer into v_returned
      from public.ticket_product_returns r
      where r.business_id = v_line.business_id and r.ticket_line_id = v_line.id;

      select * into v_default
      from public.staff_commission_rates cr
      where cr.business_id = v_line.business_id and cr.staff_id = v_staff.id
      order by cr.version desc
      limit 1;

      insert into public.staff_commission_lines(
        business_id, ticket_id, ticket_line_id, line_ordinal, staff_id, staff_name_snapshot,
        line_kind, item_name_snapshot, rate_bps, rate_source, rate_version_id, override_version_id,
        base_at_close_minor, unit_price_minor, quantity_at_close, currency, closed_at
      ) values (
        v_line.business_id, new.id, v_line.id, v_line.line_ordinal, v_staff.id, v_staff.name,
        'product', v_line.product_name_snapshot,
        coalesce(v_default.product_rate_bps, 0),
        case when v_default.id is null then 'none' else 'product_default' end,
        v_default.id, null,
        (v_line.quantity - v_returned)::bigint * v_line.final_unit_price_minor::bigint,
        v_line.final_unit_price_minor, v_line.quantity - v_returned,
        v_line.currency_snapshot, new.closed_at
      )
      returning * into v_row;
      perform public.f16_append_commission_entry(v_row, 'line', v_row.base_at_close_minor, null, null, null);
    end if;
    -- Package sale lines and service lines without staff earn no commission.
  end loop;
  return null;
end
$f1607close$;

-- Named to sort after tickets_f16_promo_status_effects, which writes the promo
-- allocation this trigger reads.
create trigger tickets_f16_staff_commission_close
after update of status on public.tickets
for each row
when (old.status = 'open' and new.status = 'closed')
execute function public.f16_commission_on_ticket_close();

-- Post-close money ----------------------------------------------------------------------------

-- Brings a closed ticket's commission movements in line with its current money:
-- post-close product returns, then the remaining balance (money given back or
-- corrected beyond returns and package refunds) spread over the ticket total.
create or replace function public.f16_commission_rebalance(
  p_business_id uuid,
  p_ticket_id uuid,
  p_source_return_id uuid,
  p_source_payment_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $f1607rebalance$
declare
  v_ticket public.tickets;
  v_total bigint;
  v_paid bigint;
  v_reduction bigint;
  v_item record;
  v_line public.staff_commission_lines;
  v_returned integer;
  v_post_close_returned integer;
  v_recorded_returned integer;
  v_new_returned integer;
  v_cum_base bigint;
  v_target bigint;
  v_return_base bigint;
  v_adjustment bigint;
  v_return_id uuid;
begin
  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null or v_ticket.status <> 'closed' then return; end if;
  if not exists (
    select 1 from public.staff_commission_lines cl
    where cl.business_id = p_business_id and cl.ticket_id = p_ticket_id
  ) then
    return;
  end if;

  v_total := greatest(coalesce(public.f16_ticket_total_minor(p_business_id, p_ticket_id), 0), 0);
  v_paid := public.f14_ticket_paid_minor(p_business_id, p_ticket_id);
  v_reduction := least(greatest(v_total - v_paid, 0), v_total);

  -- Weights are each commission line's current share of the ticket total, plus
  -- the rest of the ticket (package sales, lines without staff) as one bucket.
  -- Largest remainder: floor shares, then one minor unit each to the items with
  -- the largest fractional share (ticket order on ties). A unit only goes to an
  -- item with a fractional share, so no item is allocated more than its weight.
  for v_item in
    with line_weight as (
      select cl.id as commission_line_id, cl.line_ordinal as ordinal,
        case cl.line_kind
          when 'service' then cl.base_at_close_minor
          when 'package_covered' then 0::bigint
          else (l.quantity - coalesce((
            select sum(r.quantity) from public.ticket_product_returns r
            where r.business_id = l.business_id and r.ticket_line_id = l.id
          ), 0))::bigint * cl.unit_price_minor
        end as weight
      from public.staff_commission_lines cl
      join public.ticket_lines l on l.business_id = cl.business_id and l.id = cl.ticket_line_id
      where cl.business_id = p_business_id and cl.ticket_id = p_ticket_id
    ),
    all_weight as (
      select w.commission_line_id, w.ordinal, w.weight from line_weight w
      union all
      select null::uuid, 1000, greatest(v_total - coalesce((select sum(w.weight) from line_weight w), 0), 0)
    ),
    share as (
      select a.commission_line_id, a.ordinal, a.weight,
        case when v_total > 0 then (v_reduction * a.weight) / v_total else 0 end as floor_share,
        case when v_total > 0 then (v_reduction * a.weight) % v_total else 0 end as fraction
      from all_weight a
    ),
    ranked as (
      select s.*,
        v_reduction - sum(s.floor_share) over () as remainder,
        case when s.fraction > 0
          then row_number() over (partition by s.fraction > 0 order by s.fraction desc, s.ordinal)
          else null end as rank
      from share s
    )
    select r.commission_line_id, r.weight,
      least(r.floor_share + case when r.rank <= r.remainder then 1 else 0 end, r.weight) as allocated
    from ranked r
    where r.commission_line_id is not null
    order by r.ordinal
  loop
    select * into v_line from public.staff_commission_lines cl
    where cl.business_id = p_business_id and cl.id = v_item.commission_line_id;

    select coalesce(sum(e.base_minor), 0) into v_cum_base
    from public.staff_commission_entries e
    where e.business_id = p_business_id and e.commission_line_id = v_line.id;

    v_new_returned := 0;
    v_return_id := null;
    if v_line.line_kind = 'product' then
      select coalesce(sum(r.quantity), 0)::integer into v_returned
      from public.ticket_product_returns r
      where r.business_id = p_business_id and r.ticket_line_id = v_line.ticket_line_id;
      select v_line.quantity_at_close - (l.quantity - v_returned) into v_post_close_returned
      from public.ticket_lines l
      where l.business_id = p_business_id and l.id = v_line.ticket_line_id;
      select coalesce(sum(e.returned_quantity), 0)::integer into v_recorded_returned
      from public.staff_commission_entries e
      where e.business_id = p_business_id and e.commission_line_id = v_line.id and e.kind = 'product_return';
      v_new_returned := greatest(v_post_close_returned - v_recorded_returned, 0);

      if v_new_returned > 0 then
        v_return_id := p_source_return_id;
        if v_return_id is null or not exists (
          select 1 from public.ticket_product_returns r
          where r.business_id = p_business_id and r.id = v_return_id and r.ticket_line_id = v_line.ticket_line_id
        ) then
          select r.id into v_return_id
          from public.ticket_product_returns r
          where r.business_id = p_business_id and r.ticket_line_id = v_line.ticket_line_id
          order by r.created_at desc, r.id desc
          limit 1;
        end if;
      end if;
      v_target := v_item.weight - v_item.allocated;
    elsif v_line.line_kind = 'service' then
      v_target := v_line.base_at_close_minor - v_item.allocated;
    else
      v_target := v_line.base_at_close_minor;
    end if;

    v_target := greatest(v_target, 0);
    v_return_base := -(v_new_returned::bigint * coalesce(v_line.unit_price_minor, 0));
    v_adjustment := v_target - (v_cum_base + v_return_base);

    -- The running base never goes below zero: when an earlier adjustment already
    -- took part of a returned product's share, the correcting adjustment is
    -- written before the return.
    if v_cum_base + v_return_base < 0 then
      perform public.f16_append_commission_entry(v_line, 'payment_adjustment', v_adjustment, null, null, p_source_payment_event_id);
      perform public.f16_append_commission_entry(v_line, 'product_return', v_return_base, v_new_returned, v_return_id, null);
    else
      if v_new_returned > 0 then
        perform public.f16_append_commission_entry(v_line, 'product_return', v_return_base, v_new_returned, v_return_id, null);
      end if;
      perform public.f16_append_commission_entry(v_line, 'payment_adjustment', v_adjustment, null, null, p_source_payment_event_id);
    end if;
  end loop;
end
$f1607rebalance$;

create or replace function public.f16_commission_on_product_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1607return$
begin
  perform public.f16_commission_rebalance(new.business_id, new.ticket_id, new.id, null);
  return null;
end
$f1607return$;

-- The return row is written after its refund event, so the ticket money is
-- consistent here.
create trigger ticket_product_returns_f16_staff_commission
after insert on public.ticket_product_returns
for each row
execute function public.f16_commission_on_product_return();

create or replace function public.f16_commission_on_payment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1607payment$
begin
  perform public.f16_commission_rebalance(new.business_id, new.ticket_id, null, new.id);
  return null;
end
$f1607payment$;

-- Deferred to commit: a product return or package refund writes its refund
-- event before the row that lowers the ticket total, so only the committed
-- state tells a goodwill refund apart from a return.
create constraint trigger ticket_payment_events_f16_staff_commission
after insert on public.ticket_payment_events
deferrable initially deferred
for each row
when (new.event_type in ('refund','correction'))
execute function public.f16_commission_on_payment_event();

-- Rate management ---------------------------------------------------------------------------

create or replace function public.f16_commission_manager(p_business_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $f1607manager$
declare
  v_actor public.memberships;
begin
  perform public.f10_require_standard_session();
  select * into v_actor
  from public.memberships m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
  if v_actor.id is null or v_actor.role not in ('owner','manager') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return v_actor;
end
$f1607manager$;

create or replace function public.f16_staff_commission_state(p_business_id uuid, p_staff_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $f1607state$
  select jsonb_build_object(
    'staffId', s.id,
    'staffName', s.name,
    'active', s.active,
    'version', coalesce(r.version, 0),
    'serviceRateBps', r.service_rate_bps,
    'productRateBps', r.product_rate_bps,
    'updatedAt', r.created_at,
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'serviceId', o.service_id,
        'serviceName', sv.name,
        'version', o.version,
        'rateBps', o.rate_bps,
        'updatedAt', o.created_at
      ) order by sv.name, o.service_id)
      from (
        select distinct on (x.service_id) x.*
        from public.staff_service_commission_rates x
        where x.business_id = s.business_id and x.staff_id = s.id
        order by x.service_id, x.version desc
      ) o
      join public.services sv on sv.business_id = o.business_id and sv.id = o.service_id
    ), '[]'::jsonb)
  )
  from public.staff_profiles s
  left join lateral (
    select cr.* from public.staff_commission_rates cr
    where cr.business_id = s.business_id and cr.staff_id = s.id
    order by cr.version desc
    limit 1
  ) r on true
  where s.business_id = p_business_id and s.id = p_staff_id
$f1607state$;

create or replace function public.list_staff_commission_rates(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1607list$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not public.has_financial_permission(p_business_id, 'financial_reports_read'::public.financial_permission_key) then
    raise exception 'FINANCIAL_REPORTS_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.f16_staff_commission_state(p_business_id, s.id) order by s.active desc, s.name, s.id)
    from public.staff_profiles s
    where s.business_id = p_business_id
  ), '[]'::jsonb);
end
$f1607list$;

create or replace function public.set_staff_commission_rates_guarded(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_rate_bps integer,
  p_product_rate_bps integer,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1607setrates$
declare
  v_actor public.memberships;
  v_staff public.staff_profiles;
  v_current integer;
begin
  v_actor := public.f16_commission_manager(p_business_id);
  if p_staff_id is null
     or p_service_rate_bps is null or p_service_rate_bps not between 0 and 10000
     or p_product_rate_bps is null or p_product_rate_bps not between 0 and 10000
     or p_expected_version is null or p_expected_version not between 0 and 99999 then
    raise exception 'INVALID_COMMISSION_RATE';
  end if;

  select * into v_staff from public.staff_profiles s
  where s.business_id = p_business_id and s.id = p_staff_id
  for update;
  if v_staff.id is null then raise exception 'STAFF_NOT_FOUND'; end if;

  select coalesce(max(r.version), 0) into v_current
  from public.staff_commission_rates r
  where r.business_id = p_business_id and r.staff_id = p_staff_id;
  if v_current <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  insert into public.staff_commission_rates(
    business_id, staff_id, version, service_rate_bps, product_rate_bps, actor_membership_id
  ) values (
    p_business_id, p_staff_id, v_current + 1, p_service_rate_bps, p_product_rate_bps, v_actor.id
  );
  return public.f16_staff_commission_state(p_business_id, p_staff_id);
end
$f1607setrates$;

create or replace function public.set_staff_service_commission_override_guarded(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_rate_bps integer,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1607setoverride$
declare
  v_actor public.memberships;
  v_staff public.staff_profiles;
  v_current integer;
begin
  v_actor := public.f16_commission_manager(p_business_id);
  if p_staff_id is null or p_service_id is null
     or (p_rate_bps is not null and p_rate_bps not between 0 and 10000)
     or p_expected_version is null or p_expected_version not between 0 and 99999 then
    raise exception 'INVALID_COMMISSION_RATE';
  end if;

  select * into v_staff from public.staff_profiles s
  where s.business_id = p_business_id and s.id = p_staff_id
  for update;
  if v_staff.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.services sv where sv.business_id = p_business_id and sv.id = p_service_id
  ) then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  select coalesce(max(o.version), 0) into v_current
  from public.staff_service_commission_rates o
  where o.business_id = p_business_id and o.staff_id = p_staff_id and o.service_id = p_service_id;
  if v_current <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  insert into public.staff_service_commission_rates(
    business_id, staff_id, service_id, version, rate_bps, actor_membership_id
  ) values (
    p_business_id, p_staff_id, p_service_id, v_current + 1, p_rate_bps, v_actor.id
  );
  return public.f16_staff_commission_state(p_business_id, p_staff_id);
end
$f1607setoverride$;

-- Report ---------------------------------------------------------------------------------

create or replace function public.get_staff_commission_report(
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
as $f1607report$
declare
  v_member public.memberships;
  v_full boolean;
  v_own_staff uuid;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
  v_currency_count integer;
  v_currency text;
  v_staff jsonb;
  v_movements jsonb;
  v_movement_count integer;
  v_totals jsonb;
begin
  perform public.f10_require_standard_session();
  select * into v_member
  from public.memberships m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
  if v_member.id is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  -- Financial report readers see every staff member; anyone else only their
  -- own staff profile's movements.
  v_full := public.has_financial_permission(p_business_id, 'financial_reports_read'::public.financial_permission_key);
  if not v_full then
    select s.id into v_own_staff
    from public.staff_profiles s
    where s.business_id = p_business_id and s.membership_id = v_member.id;
  end if;

  if p_start_date is null or p_end_date is null
     or p_end_date < p_start_date
     or p_end_date > p_start_date + 91 then
    raise exception 'INVALID_REPORT_RANGE';
  end if;

  select b.timezone into v_timezone from public.businesses b where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_from := p_start_date::timestamp at time zone v_timezone;
  v_to := (p_end_date + 1)::timestamp at time zone v_timezone;

  with report_row as (
    select e.id as entry_id, e.occurred_at, e.kind, e.base_minor, e.amount_minor,
      cl.staff_id, cl.staff_name_snapshot as staff_name, cl.ticket_id, cl.line_kind,
      cl.item_name_snapshot as item_name, cl.rate_bps, cl.rate_source, cl.currency,
      t.customer_name_snapshot as customer_name
    from public.staff_commission_entries e
    join public.staff_commission_lines cl
      on cl.business_id = e.business_id and cl.id = e.commission_line_id
    join public.tickets t
      on t.business_id = cl.business_id and t.id = cl.ticket_id
    where e.business_id = p_business_id
      and e.occurred_at >= v_from and e.occurred_at < v_to
      and (v_full or e.staff_id = v_own_staff)
  ),
  staff_row as (
    select r.staff_id, min(r.staff_name) as staff_name, jsonb_build_object(
      'staffId', r.staff_id,
      'staffName', min(r.staff_name),
      'serviceBaseMinor', coalesce(sum(r.base_minor) filter (where r.kind = 'line' and r.line_kind = 'service'), 0),
      'packageUnitBaseMinor', coalesce(sum(r.base_minor) filter (where r.kind = 'line' and r.line_kind = 'package_covered'), 0),
      'productBaseMinor', coalesce(sum(r.base_minor) filter (where r.kind = 'line' and r.line_kind = 'product'), 0),
      'adjustmentBaseMinor', coalesce(sum(r.base_minor) filter (where r.kind <> 'line'), 0),
      'baseMinor', coalesce(sum(r.base_minor), 0),
      'commissionMinor', coalesce(sum(r.amount_minor), 0),
      'adjustmentCommissionMinor', coalesce(sum(r.amount_minor) filter (where r.kind <> 'line'), 0),
      'lineCount', count(*) filter (where r.kind = 'line'),
      'adjustmentCount', count(*) filter (where r.kind <> 'line')
    ) as item
    from report_row r
    group by r.staff_id
  ),
  movement as (
    select r.* from report_row r
    order by r.occurred_at desc, r.entry_id
    limit 500
  )
  select
    (select count(distinct r.currency) from report_row r),
    (select min(r.currency) from report_row r),
    (select count(*)::integer from report_row r),
    (select coalesce(jsonb_agg(x.item order by x.staff_name, x.staff_id), '[]'::jsonb) from staff_row x),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'entryId', m.entry_id,
        'occurredAt', m.occurred_at,
        'kind', m.kind,
        'staffId', m.staff_id,
        'staffName', m.staff_name,
        'ticketId', m.ticket_id,
        'customerName', m.customer_name,
        'lineKind', m.line_kind,
        'itemName', m.item_name,
        'rateBps', m.rate_bps,
        'rateSource', m.rate_source,
        'baseMinor', m.base_minor,
        'amountMinor', m.amount_minor
      ) order by m.occurred_at desc, m.entry_id), '[]'::jsonb) from movement m),
    (select jsonb_build_object(
        'baseMinor', coalesce(sum(r.base_minor), 0),
        'commissionMinor', coalesce(sum(r.amount_minor), 0),
        'adjustmentCommissionMinor', coalesce(sum(r.amount_minor) filter (where r.kind <> 'line'), 0),
        'lineCount', count(*) filter (where r.kind = 'line')
      ) from report_row r)
  into v_currency_count, v_currency, v_movement_count, v_staff, v_movements, v_totals;

  if v_currency_count > 1 then raise exception 'REPORT_CURRENCY_MIXED'; end if;

  return jsonb_build_object(
    'businessId', p_business_id,
    'startDate', p_start_date,
    'endDate', p_end_date,
    'timezone', v_timezone,
    'asOf', statement_timestamp(),
    'scope', case when v_full then 'business' else 'own' end,
    'ownStaffId', v_own_staff,
    'currency', v_currency,
    'totals', v_totals,
    'staff', v_staff,
    'movements', v_movements,
    'movementCount', v_movement_count,
    'movementsTruncated', v_movement_count > 500,
    'definition', jsonb_build_array(
      'Prim, adisyon kapanınca satır bazında yazılır: oran × (satır fiyatı − satır indirimi − kampanya payı).',
      'Paketten karşılanan seans, paketin seans birim değeri (satış fiyatı ÷ seans) üzerinden prim alır; paket satışının kendisi prim üretmez.',
      'Ürün satırı, satırı giren çalışanın ürün oranıyla hesaplanır. Personeli olmayan satır prim üretmez.',
      'Kısmi tahsilat primi değiştirmez; adisyon ancak tamamen ödenince kapanır.',
      'Kapanıştan sonraki ürün iadesi aynı çalışana negatif prim yazar. Diğer para iadeleri ve tahsilat düzeltmeleri, satırların adisyon tutarındaki payına göre aynı çalışanlara dağıtılır.',
      'Oran değişikliği yalnız sonraki kapanışlara uygulanır; yazılmış prim kayıtları değişmez.',
      'Tutarlar kuruş cinsindendir; prim kümülatif matrah üzerinden yarım kuruşta yukarı yuvarlanır ve kaynak tutarın oranını aşmaz.',
      'Bu rapor bordro veya maaş hesabı değildir.'
    )
  );
end
$f1607report$;

-- Grants ---------------------------------------------------------------------------------

revoke all on function public.f16_guard_commission_immutable() from public, anon, authenticated;
revoke all on function public.f16_commission_amount(bigint, integer) from public, anon, authenticated;
revoke all on function public.f16_service_commission_rate(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.f16_append_commission_entry(public.staff_commission_lines, text, bigint, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.f16_commission_on_ticket_close() from public, anon, authenticated;
revoke all on function public.f16_commission_rebalance(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.f16_commission_on_product_return() from public, anon, authenticated;
revoke all on function public.f16_commission_on_payment_event() from public, anon, authenticated;
revoke all on function public.f16_commission_manager(uuid) from public, anon, authenticated;
revoke all on function public.f16_staff_commission_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_staff_commission_rates(uuid) from public, anon, authenticated;
revoke all on function public.set_staff_commission_rates_guarded(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.set_staff_service_commission_override_guarded(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.get_staff_commission_report(uuid, date, date) from public, anon, authenticated;

grant execute on function public.list_staff_commission_rates(uuid) to authenticated;
grant execute on function public.set_staff_commission_rates_guarded(uuid, uuid, integer, integer, integer) to authenticated;
grant execute on function public.set_staff_service_commission_override_guarded(uuid, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.get_staff_commission_report(uuid, date, date) to authenticated;

commit;
