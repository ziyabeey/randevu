begin;

-- F16-05: service packages and usage balance.
--
-- Money and rights stay separate (K02):
-- * A package is sold as its own ticket line (`source_type = 'package'`). That
--   line is the only income the package ever produces.
-- * The sale grants a fixed number of sessions of one service. Sessions are
--   rights, not money. Using one settles a service line by a full-price package
--   coverage (discount = final price, net 0) plus an append-only `use` ledger row,
--   so the covered session is never counted as a second income.
-- * Usage reversal (open ticket only) and ticket cancellation append `reverse`
--   rows. The historical appointment/service price snapshot is never rewritten.
-- * A refund returns the unused sessions proportionally:
--   round_half_up(price * remaining / total). It lowers the sale ticket total by
--   that value (like a product return) and records refund events on real
--   source payments.
-- * The customer package row is locked for every use, reversal, cancellation and
--   refund, so two concurrent operations cannot consume the last session twice.

create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  service_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  session_count integer not null check (session_count between 1 and 100),
  validity_days integer not null check (validity_days between 1 and 730),
  price_minor integer not null check (price_minor between 0 and 100000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_packages_business_id_key unique (business_id, id),
  constraint service_packages_service_fk
    foreign key (business_id, service_id)
    references public.services(business_id, id),
  constraint service_packages_creator_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id)
);

create index service_packages_business_list_idx
  on public.service_packages(business_id, active, name, id);

alter table public.service_packages enable row level security;
alter table public.service_packages force row level security;
revoke all on table public.service_packages from public, anon, authenticated;

-- Package sale lines -----------------------------------------------------------

alter table public.ticket_lines
  drop constraint if exists ticket_lines_source_shape,
  drop constraint if exists ticket_lines_finalization_shape;

alter table public.ticket_lines
  add column if not exists package_id uuid,
  add column if not exists package_name_snapshot text;

alter table public.ticket_lines
  add constraint ticket_lines_package_fk
    foreign key (business_id, package_id)
    references public.service_packages(business_id, id),
  add constraint ticket_lines_source_shape
    check (
      (
        source_type = 'service'
        and service_id is not null
        and service_name_snapshot is not null
        and product_id is null
        and product_name_snapshot is null
        and product_code_snapshot is null
        and package_id is null
        and package_name_snapshot is null
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
        and package_id is null
        and package_name_snapshot is null
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
      or
      (
        source_type = 'package'
        and source_appointment_line_id is null
        and service_id is null
        and staff_id is null
        and service_name_snapshot is null
        and staff_name_snapshot is null
        and product_id is null
        and product_name_snapshot is null
        and product_code_snapshot is null
        and package_id is not null
        and package_name_snapshot is not null
        and char_length(btrim(package_name_snapshot)) between 2 and 120
        and quantity = 1
        and price_type_snapshot = 'fixed'
        and price_min_minor_snapshot = price_max_minor_snapshot
        and final_unit_price_minor = price_min_minor_snapshot
        and finalized_by_membership_id is not null
        and finalized_at is not null
        and finalization_reason = 'package_catalog_snapshot'
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
      or source_type in ('product','package')
    );

-- Sold packages ----------------------------------------------------------------

create table public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  customer_id uuid not null,
  service_package_id uuid not null,
  service_id uuid not null,
  package_name_snapshot text not null check (char_length(btrim(package_name_snapshot)) between 2 and 120),
  service_name_snapshot text not null check (char_length(btrim(service_name_snapshot)) between 1 and 120),
  sessions_total integer not null check (sessions_total between 1 and 100),
  sessions_used integer not null default 0,
  price_minor integer not null check (price_minor between 0 and 100000000),
  unit_value_minor integer not null check (unit_value_minor between 0 and 100000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  package_version_snapshot integer not null check (package_version_snapshot > 0),
  sale_ticket_id uuid not null,
  sale_ticket_line_id uuid not null,
  status text not null default 'active' check (status in ('active','cancelled','refunded')),
  expires_at timestamptz not null,
  sold_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_membership_id uuid,
  close_reason text check (close_reason is null or char_length(btrim(close_reason)) between 2 and 240),
  refund_value_minor integer check (refund_value_minor is null or refund_value_minor between 0 and 100000000),
  refunded_sessions integer check (refunded_sessions is null or refunded_sessions between 1 and 100),
  constraint customer_packages_business_id_key unique (business_id, id),
  constraint customer_packages_one_per_sale_line unique (business_id, sale_ticket_line_id),
  constraint customer_packages_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  constraint customer_packages_definition_fk
    foreign key (business_id, service_package_id)
    references public.service_packages(business_id, id),
  constraint customer_packages_service_fk
    foreign key (business_id, service_id)
    references public.services(business_id, id),
  constraint customer_packages_sale_ticket_fk
    foreign key (business_id, sale_ticket_id)
    references public.tickets(business_id, id),
  constraint customer_packages_sale_line_fk
    foreign key (business_id, sale_ticket_line_id)
    references public.ticket_lines(business_id, id),
  constraint customer_packages_seller_fk
    foreign key (business_id, sold_by_membership_id)
    references public.memberships(business_id, id),
  constraint customer_packages_closer_fk
    foreign key (business_id, closed_by_membership_id)
    references public.memberships(business_id, id),
  constraint customer_packages_usage_bounds
    check (sessions_used between 0 and sessions_total),
  constraint customer_packages_expiry_after_sale
    check (expires_at > created_at),
  constraint customer_packages_status_shape
    check (
      (
        status = 'active'
        and closed_at is null and closed_by_membership_id is null and close_reason is null
        and refund_value_minor is null and refunded_sessions is null
      )
      or (
        status = 'cancelled'
        and sessions_used = 0
        and closed_at is not null and closed_by_membership_id is not null and close_reason is not null
        and refund_value_minor is null and refunded_sessions is null
      )
      or (
        status = 'refunded'
        and closed_at is not null and closed_by_membership_id is not null and close_reason is not null
        and refund_value_minor is not null and refunded_sessions is not null
        and refunded_sessions = sessions_total - sessions_used
        and refund_value_minor <= price_minor
      )
    )
);

create index customer_packages_customer_idx
  on public.customer_packages(business_id, customer_id, status, expires_at, id);

create index customer_packages_sale_ticket_idx
  on public.customer_packages(business_id, sale_ticket_id);

alter table public.customer_packages enable row level security;
alter table public.customer_packages force row level security;
revoke all on table public.customer_packages from public, anon, authenticated;

create table public.customer_package_usages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  customer_package_id uuid not null,
  kind text not null check (kind in ('use','reverse')),
  ticket_id uuid not null,
  ticket_line_id uuid not null,
  reverses_usage_id uuid,
  value_minor integer not null check (value_minor between 0 and 100000000),
  reason text check (reason is null or char_length(btrim(reason)) between 2 and 240),
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  constraint customer_package_usages_business_id_key unique (business_id, id),
  constraint customer_package_usages_package_fk
    foreign key (business_id, customer_package_id)
    references public.customer_packages(business_id, id),
  constraint customer_package_usages_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint customer_package_usages_line_fk
    foreign key (business_id, ticket_line_id)
    references public.ticket_lines(business_id, id),
  constraint customer_package_usages_reverses_fk
    foreign key (business_id, reverses_usage_id)
    references public.customer_package_usages(business_id, id),
  constraint customer_package_usages_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id),
  constraint customer_package_usages_shape
    check (
      (kind = 'use' and reverses_usage_id is null and reason is null)
      or (kind = 'reverse' and reverses_usage_id is not null and reason is not null)
    )
);

create unique index customer_package_usages_one_reverse_idx
  on public.customer_package_usages(business_id, reverses_usage_id)
  where kind = 'reverse';

create index customer_package_usages_line_idx
  on public.customer_package_usages(business_id, ticket_line_id, kind);

create index customer_package_usages_ticket_idx
  on public.customer_package_usages(business_id, ticket_id, kind);

create index customer_package_usages_package_idx
  on public.customer_package_usages(business_id, customer_package_id, created_at, id);

alter table public.customer_package_usages enable row level security;
alter table public.customer_package_usages force row level security;
revoke all on table public.customer_package_usages from public, anon, authenticated;

create table public.customer_package_refund_events (
  business_id uuid not null references public.businesses(id),
  customer_package_id uuid not null,
  ticket_id uuid not null,
  refund_event_id uuid not null,
  amount_minor integer not null check (amount_minor between 1 and 100000000),
  created_at timestamptz not null default now(),
  primary key (business_id, refund_event_id),
  constraint customer_package_refund_events_package_fk
    foreign key (business_id, customer_package_id)
    references public.customer_packages(business_id, id),
  constraint customer_package_refund_events_event_fk
    foreign key (business_id, ticket_id, refund_event_id)
    references public.ticket_payment_events(business_id, ticket_id, id)
);

create index customer_package_refund_events_package_idx
  on public.customer_package_refund_events(business_id, customer_package_id);

alter table public.customer_package_refund_events enable row level security;
alter table public.customer_package_refund_events force row level security;
revoke all on table public.customer_package_refund_events from public, anon, authenticated;

-- Invariant guards ---------------------------------------------------------------

create or replace function public.f16_active_package_use(p_business_id uuid, p_line_id uuid)
returns public.customer_package_usages
language sql
stable
security definer
set search_path = ''
as $f1605activeuse$
  select u.*
  from public.customer_package_usages u
  where u.business_id = p_business_id
    and u.ticket_line_id = p_line_id
    and u.kind = 'use'
    and not exists (
      select 1 from public.customer_package_usages r
      where r.business_id = u.business_id and r.reverses_usage_id = u.id and r.kind = 'reverse'
    )
  order by u.created_at desc, u.id desc
  limit 1
$f1605activeuse$;

create or replace function public.f16_guard_service_package_update()
returns trigger
language plpgsql
set search_path = ''
as $f1605defguard$
begin
  if tg_op = 'DELETE' then raise exception 'PACKAGE_DELETE_FORBIDDEN'; end if;
  if old.id is distinct from new.id
     or old.business_id is distinct from new.business_id
     or old.service_id is distinct from new.service_id
     or old.currency is distinct from new.currency
     or old.created_by_membership_id is distinct from new.created_by_membership_id
     or old.created_at is distinct from new.created_at then
    raise exception 'PACKAGE_SOURCE_IMMUTABLE';
  end if;
  if new.version <> old.version + 1 then raise exception 'PACKAGE_VERSION_REQUIRED'; end if;
  return new;
end
$f1605defguard$;

create trigger service_packages_f16_guard
before update or delete on public.service_packages
for each row execute function public.f16_guard_service_package_update();

create or replace function public.f16_guard_customer_package_change()
returns trigger
language plpgsql
set search_path = ''
as $f1605pkgguard$
begin
  if tg_op = 'DELETE' then raise exception 'CUSTOMER_PACKAGE_DELETE_FORBIDDEN'; end if;
  if old.status <> 'active' then raise exception 'CUSTOMER_PACKAGE_CLOSED'; end if;
  if old.id is distinct from new.id
     or old.business_id is distinct from new.business_id
     or old.customer_id is distinct from new.customer_id
     or old.service_package_id is distinct from new.service_package_id
     or old.service_id is distinct from new.service_id
     or old.package_name_snapshot is distinct from new.package_name_snapshot
     or old.service_name_snapshot is distinct from new.service_name_snapshot
     or old.sessions_total is distinct from new.sessions_total
     or old.price_minor is distinct from new.price_minor
     or old.unit_value_minor is distinct from new.unit_value_minor
     or old.currency is distinct from new.currency
     or old.package_version_snapshot is distinct from new.package_version_snapshot
     or old.sale_ticket_id is distinct from new.sale_ticket_id
     or old.sale_ticket_line_id is distinct from new.sale_ticket_line_id
     or old.expires_at is distinct from new.expires_at
     or old.sold_by_membership_id is distinct from new.sold_by_membership_id
     or old.created_at is distinct from new.created_at then
    raise exception 'CUSTOMER_PACKAGE_SNAPSHOT_IMMUTABLE';
  end if;
  if new.status = 'active' and abs(new.sessions_used - old.sessions_used) > 1 then
    raise exception 'CUSTOMER_PACKAGE_USAGE_STEP';
  end if;
  if new.status <> 'active' and new.sessions_used <> old.sessions_used then
    raise exception 'CUSTOMER_PACKAGE_USAGE_STEP';
  end if;
  return new;
end
$f1605pkgguard$;

create trigger customer_packages_f16_guard
before update or delete on public.customer_packages
for each row execute function public.f16_guard_customer_package_change();

create or replace function public.f16_guard_append_only_package_ledger()
returns trigger
language plpgsql
set search_path = ''
as $f1605ledgerguard$
begin
  if tg_op = 'UPDATE' then raise exception 'PACKAGE_LEDGER_IMMUTABLE'; end if;
  raise exception 'PACKAGE_LEDGER_DELETE_FORBIDDEN';
end
$f1605ledgerguard$;

create trigger customer_package_usages_f16_immutable
before update or delete on public.customer_package_usages
for each row execute function public.f16_guard_append_only_package_ledger();

create trigger customer_package_refund_events_f16_immutable
before update or delete on public.customer_package_refund_events
for each row execute function public.f16_guard_append_only_package_ledger();

-- A `use` row may only exist for a fully covered service line of the same
-- ticket, and a `reverse` row must reverse a use of the same package and line.
create or replace function public.f16_guard_package_usage_insert()
returns trigger
language plpgsql
set search_path = ''
as $f1605useinsert$
declare
  v_line public.ticket_lines;
  v_use public.customer_package_usages;
begin
  select * into v_line
  from public.ticket_lines l
  where l.business_id = new.business_id and l.id = new.ticket_line_id and l.ticket_id = new.ticket_id;
  if v_line.id is null or v_line.source_type <> 'service' then
    raise exception 'PACKAGE_USAGE_LINE_INVALID';
  end if;

  if new.kind = 'use' then
    if v_line.final_unit_price_minor is null or v_line.discount_minor <> v_line.final_unit_price_minor then
      raise exception 'PACKAGE_USAGE_LINE_NOT_COVERED';
    end if;
    if (public.f16_active_package_use(new.business_id, new.ticket_line_id)).id is not null then
      raise exception 'LINE_ALREADY_COVERED';
    end if;
  else
    select * into v_use
    from public.customer_package_usages u
    where u.business_id = new.business_id and u.id = new.reverses_usage_id and u.kind = 'use';
    if v_use.id is null
       or v_use.customer_package_id <> new.customer_package_id
       or v_use.ticket_line_id <> new.ticket_line_id
       or v_use.ticket_id <> new.ticket_id
       or v_use.value_minor <> new.value_minor then
      raise exception 'PACKAGE_USAGE_REVERSE_INVALID';
    end if;
  end if;
  return new;
end
$f1605useinsert$;

create trigger customer_package_usages_f16_insert_guard
before insert on public.customer_package_usages
for each row execute function public.f16_guard_package_usage_insert();

-- While a line is covered by an active package use, its discount (the coverage)
-- cannot be edited through any other path; reversal appends `reverse` first.
create or replace function public.f16_guard_package_covered_line()
returns trigger
language plpgsql
set search_path = ''
as $f1605coveredline$
begin
  if (old.discount_minor is distinct from new.discount_minor
      or old.discount_reason is distinct from new.discount_reason
      or old.discount_by_membership_id is distinct from new.discount_by_membership_id
      or old.discount_at is distinct from new.discount_at
      or old.final_unit_price_minor is distinct from new.final_unit_price_minor)
     and (public.f16_active_package_use(old.business_id, old.id)).id is not null then
    raise exception 'LINE_COVERED_BY_PACKAGE';
  end if;
  return new;
end
$f1605coveredline$;

create trigger ticket_lines_f16_package_cover_guard
before update on public.ticket_lines
for each row execute function public.f16_guard_package_covered_line();

create or replace function public.f14_guard_ticket_line_update()
returns trigger
language plpgsql
set search_path = ''
as $f1605lineguard$
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
     or old.package_id is distinct from new.package_id
     or old.package_name_snapshot is distinct from new.package_name_snapshot
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
$f1605lineguard$;

-- Ticket command vocabulary -------------------------------------------------------

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
    'refund_package'
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
as $f1605claim$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in (
    'open_from_booking_group','open_walk_in','add_service_line',
    'finalize_service_price','set_service_discount','close_ticket','cancel_ticket',
    'record_payment','record_correction','record_refund',
    'add_product_line','open_product_sale','product_return_refund',
    'add_package_line','open_package_sale','apply_package','reverse_package_usage','refund_package'
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
$f1605claim$;

-- Money helpers ------------------------------------------------------------------

-- Non-negative half-up division in integer minor units: round(a / b).
create or replace function public.f16_round_half_up_div(p_numerator bigint, p_denominator bigint)
returns bigint
language sql
immutable
set search_path = ''
as $f1605round$
  select (2 * p_numerator + p_denominator) / (2 * p_denominator)
$f1605round$;

create or replace function public.f16_package_refund_value(p_package public.customer_packages)
returns bigint
language sql
immutable
set search_path = ''
as $f1605refundvalue$
  select public.f16_round_half_up_div(
    p_package.price_minor::bigint * (p_package.sessions_total - p_package.sessions_used)::bigint,
    p_package.sessions_total::bigint
  )
$f1605refundvalue$;

-- Projections --------------------------------------------------------------------

create or replace function public.f16_service_package_json(p_package public.service_packages)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $f1605defjson$
  select jsonb_build_object(
    'packageId', p_package.id,
    'businessId', p_package.business_id,
    'serviceId', p_package.service_id,
    'serviceName', (
      select s.name from public.services s
      where s.business_id = p_package.business_id and s.id = p_package.service_id
    ),
    'name', p_package.name,
    'sessionCount', p_package.session_count,
    'validityDays', p_package.validity_days,
    'priceMinor', p_package.price_minor,
    'unitValueMinor', public.f16_round_half_up_div(p_package.price_minor, p_package.session_count),
    'currency', p_package.currency,
    'active', p_package.active,
    'version', p_package.version,
    'createdAt', p_package.created_at,
    'updatedAt', p_package.updated_at
  )
$f1605defjson$;

create or replace function public.f16_customer_package_json(p_package public.customer_packages)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $f1605pkgjson$
  select jsonb_build_object(
    'customerPackageId', p_package.id,
    'businessId', p_package.business_id,
    'customerId', p_package.customer_id,
    'packageId', p_package.service_package_id,
    'serviceId', p_package.service_id,
    'packageName', p_package.package_name_snapshot,
    'serviceName', p_package.service_name_snapshot,
    'sessionsTotal', p_package.sessions_total,
    'sessionsUsed', p_package.sessions_used,
    'sessionsRemaining', case when p_package.status = 'active'
      then p_package.sessions_total - p_package.sessions_used else 0 end,
    'priceMinor', p_package.price_minor,
    'unitValueMinor', p_package.unit_value_minor,
    'currency', p_package.currency,
    'status', p_package.status,
    'expiresAt', p_package.expires_at,
    'expired', p_package.expires_at <= now(),
    'saleTicketId', p_package.sale_ticket_id,
    'saleTicketStatus', (
      select t.status from public.tickets t
      where t.business_id = p_package.business_id and t.id = p_package.sale_ticket_id
    ),
    'refundPreviewMinor', case
      when p_package.status = 'active' and p_package.sessions_used < p_package.sessions_total
        then public.f16_package_refund_value(p_package)
      else null
    end,
    'refundValueMinor', p_package.refund_value_minor,
    'refundedSessions', p_package.refunded_sessions,
    'closeReason', p_package.close_reason,
    'closedAt', p_package.closed_at,
    'createdAt', p_package.created_at,
    'usages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'usageId', u.id,
        'kind', u.kind,
        'ticketId', u.ticket_id,
        'ticketLineId', u.ticket_line_id,
        'reversesUsageId', u.reverses_usage_id,
        'valueMinor', u.value_minor,
        'reason', u.reason,
        'createdAt', u.created_at
      ) order by u.created_at, u.id)
      from (
        select * from public.customer_package_usages x
        where x.business_id = p_package.business_id and x.customer_package_id = p_package.id
        order by x.created_at desc, x.id desc
        limit 100
      ) u
    ), '[]'::jsonb)
  )
$f1605pkgjson$;

create or replace function public.f14_ticket_projection(
  p_business_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1605projection$
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
  v_package_refunded bigint;
  v_package_covered bigint;
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

  -- A package refund takes the unused sessions back at their proportional
  -- value, the same way a product return lowers the sale ticket total.
  select coalesce(sum(cp.refund_value_minor::bigint), 0)
  into v_package_refunded
  from public.customer_packages cp
  where cp.business_id = p_business_id and cp.sale_ticket_id = p_ticket_id and cp.status = 'refunded';

  -- Coverage is a full-price settlement by a package right, not a discount.
  select coalesce(sum(l.discount_minor::bigint), 0)
  into v_package_covered
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id
    and exists (
      select 1 from public.customer_package_usages u
      where u.business_id = l.business_id and u.ticket_line_id = l.id and u.kind = 'use'
        and not exists (
          select 1 from public.customer_package_usages r
          where r.business_id = u.business_id and r.reverses_usage_id = u.id and r.kind = 'reverse'
        )
    );

  v_ready := v_count > 0 and v_count = v_final_count;
  v_total := case when v_ready then v_subtotal - v_discount - v_returned - v_package_refunded else null end;
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
    'packageCoveredMinor', case when v_ready then v_package_covered else null end,
    'returnedMinor', v_returned,
    'packageRefundedMinor', v_package_refunded,
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
$f1605projection$;

-- Package definitions ---------------------------------------------------------------

create or replace function public.create_service_package_guarded(
  p_business_id uuid,
  p_package_id uuid,
  p_service_id uuid,
  p_name text,
  p_session_count integer,
  p_validity_days integer,
  p_price_minor integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605create$
declare
  v_actor public.memberships;
  v_service public.services;
  v_row public.service_packages;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  v_actor := public.f14_financial_actor(p_business_id);
  if p_package_id is null or p_service_id is null
     or v_name is null or char_length(v_name) not between 2 and 120
     or p_session_count is null or p_session_count not between 1 and 100
     or p_validity_days is null or p_validity_days not between 1 and 730
     or p_price_minor is null or p_price_minor not between 0 and 100000000 then
    raise exception 'INVALID_PACKAGE';
  end if;

  select * into v_service
  from public.services s
  where s.business_id = p_business_id and s.id = p_service_id
  for share;
  if v_service.id is null or not v_service.active then raise exception 'SERVICE_NOT_FOUND'; end if;

  insert into public.service_packages(
    id, business_id, service_id, name, session_count, validity_days,
    price_minor, currency, created_by_membership_id
  ) values (
    p_package_id, p_business_id, p_service_id, v_name, p_session_count, p_validity_days,
    p_price_minor, v_service.currency, v_actor.id
  )
  on conflict (id) do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Same client id: an exact first-version replay returns the stored row;
    -- anything else (including another tenant's id) is a conflict.
    select * into v_row
    from public.service_packages p
    where p.id = p_package_id and p.business_id = p_business_id;
    if v_row.id is null
       or v_row.service_id <> p_service_id
       or v_row.name <> v_name
       or v_row.session_count <> p_session_count
       or v_row.validity_days <> p_validity_days
       or v_row.price_minor <> p_price_minor
       or v_row.version <> 1 then
      raise exception 'PACKAGE_ID_CONFLICT';
    end if;
  end if;

  return public.f16_service_package_json(v_row);
end
$f1605create$;

create or replace function public.update_service_package_guarded(
  p_business_id uuid,
  p_package_id uuid,
  p_expected_version integer,
  p_name text,
  p_session_count integer,
  p_validity_days integer,
  p_price_minor integer,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605update$
declare
  v_actor public.memberships;
  v_row public.service_packages;
  v_service_active boolean;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  v_actor := public.f14_financial_actor(p_business_id);
  if p_package_id is null or p_expected_version is null or p_expected_version < 1
     or v_name is null or char_length(v_name) not between 2 and 120
     or p_session_count is null or p_session_count not between 1 and 100
     or p_validity_days is null or p_validity_days not between 1 and 730
     or p_price_minor is null or p_price_minor not between 0 and 100000000
     or p_active is null then
    raise exception 'INVALID_PACKAGE';
  end if;

  select * into v_row
  from public.service_packages p
  where p.business_id = p_business_id and p.id = p_package_id
  for update;
  if v_row.id is null then raise exception 'PACKAGE_NOT_FOUND'; end if;

  -- A lost response is replayed by the same expected version and payload.
  if v_row.version = p_expected_version + 1
     and v_row.name = v_name and v_row.session_count = p_session_count
     and v_row.validity_days = p_validity_days and v_row.price_minor = p_price_minor
     and v_row.active = p_active then
    return public.f16_service_package_json(v_row);
  end if;
  if v_row.version <> p_expected_version then raise exception 'STALE_PACKAGE_WRITE'; end if;

  if p_active then
    select s.active into v_service_active
    from public.services s
    where s.business_id = p_business_id and s.id = v_row.service_id;
    if not coalesce(v_service_active, false) then raise exception 'SERVICE_NOT_FOUND'; end if;
  end if;

  update public.service_packages
  set name = v_name,
      session_count = p_session_count,
      validity_days = p_validity_days,
      price_minor = p_price_minor,
      active = p_active,
      version = version + 1,
      updated_at = now()
  where business_id = p_business_id and id = p_package_id
  returning * into v_row;

  return public.f16_service_package_json(v_row);
end
$f1605update$;

create or replace function public.list_service_packages(
  p_business_id uuid,
  p_include_inactive boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1605list$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(public.f16_service_package_json(p) order by p.active desc, p.name, p.id)
    from (
      select * from public.service_packages x
      where x.business_id = p_business_id
        and (coalesce(p_include_inactive, false) or x.active)
      order by x.active desc, x.name, x.id
      limit 200
    ) p
  ), '[]'::jsonb);
end
$f1605list$;

-- Package sale -----------------------------------------------------------------------

create or replace function public.f16_insert_package_sale_line(
  p_ticket public.tickets,
  p_package public.service_packages,
  p_actor public.memberships
)
returns public.ticket_lines
language plpgsql
security definer
set search_path = ''
as $f1605insertsale$
declare
  v_line public.ticket_lines;
  v_ordinal integer;
  v_service_name text;
begin
  select coalesce(max(l.line_ordinal), 0) + 1 into v_ordinal
  from public.ticket_lines l
  where l.business_id = p_ticket.business_id and l.ticket_id = p_ticket.id;
  if v_ordinal > 100 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;

  select s.name into v_service_name
  from public.services s
  where s.business_id = p_package.business_id and s.id = p_package.service_id;
  if v_service_name is null then raise exception 'SERVICE_NOT_FOUND'; end if;

  insert into public.ticket_lines(
    business_id, ticket_id, line_ordinal, source_type, source_appointment_line_id,
    service_id, staff_id, service_name_snapshot, staff_name_snapshot,
    product_id, product_name_snapshot, product_code_snapshot,
    package_id, package_name_snapshot,
    quantity, price_type_snapshot, price_min_minor_snapshot, price_max_minor_snapshot,
    currency_snapshot, price_policy_version_snapshot,
    final_unit_price_minor, finalized_by_membership_id, finalized_at, finalization_reason,
    discount_minor, created_by_membership_id
  ) values (
    p_ticket.business_id, p_ticket.id, v_ordinal, 'package', null,
    null, null, null, null,
    null, null, null,
    p_package.id, p_package.name,
    1, 'fixed', p_package.price_minor, p_package.price_minor,
    p_package.currency, p_package.version,
    p_package.price_minor, p_actor.id, now(), 'package_catalog_snapshot',
    0, p_actor.id
  )
  returning * into v_line;

  insert into public.customer_packages(
    business_id, customer_id, service_package_id, service_id,
    package_name_snapshot, service_name_snapshot, sessions_total,
    price_minor, unit_value_minor, currency, package_version_snapshot,
    sale_ticket_id, sale_ticket_line_id, expires_at, sold_by_membership_id
  ) values (
    p_ticket.business_id, p_ticket.customer_id, p_package.id, p_package.service_id,
    p_package.name, v_service_name, p_package.session_count,
    p_package.price_minor,
    public.f16_round_half_up_div(p_package.price_minor, p_package.session_count),
    p_package.currency, p_package.version,
    p_ticket.id, v_line.id, now() + make_interval(days => p_package.validity_days), p_actor.id
  );

  return v_line;
end
$f1605insertsale$;

create or replace function public.f16_lock_sellable_package(
  p_business_id uuid,
  p_package_id uuid,
  p_expected_package_version integer
)
returns public.service_packages
language plpgsql
security definer
set search_path = ''
as $f1605lockdef$
declare
  v_package public.service_packages;
begin
  select * into v_package
  from public.service_packages p
  where p.business_id = p_business_id and p.id = p_package_id
  for share;
  if v_package.id is null then raise exception 'PACKAGE_NOT_FOUND'; end if;
  if not v_package.active then raise exception 'PACKAGE_INACTIVE'; end if;
  if p_expected_package_version is null or v_package.version <> p_expected_package_version then
    raise exception 'STALE_PACKAGE_WRITE';
  end if;
  return v_package;
end
$f1605lockdef$;

create or replace function public.add_ticket_package_line_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_package_id uuid,
  p_expected_ticket_version integer,
  p_expected_package_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605addline$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_package public.service_packages;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'add_package_line', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_ticket_version is null or v_ticket.version <> p_expected_ticket_version then
    raise exception 'STALE_WRITE';
  end if;
  if exists (
    select 1 from public.ticket_payment_events e
    where e.business_id = p_business_id and e.ticket_id = p_ticket_id
  ) then
    raise exception 'TICKET_HAS_FINANCIAL_EVENTS';
  end if;

  v_package := public.f16_lock_sellable_package(p_business_id, p_package_id, p_expected_package_version);
  if v_ticket.currency is not null and v_ticket.currency <> v_package.currency then
    raise exception 'MIXED_CURRENCY';
  end if;

  perform public.f16_insert_package_sale_line(v_ticket, v_package, v_actor);

  update public.tickets
  set currency = coalesce(currency, v_package.currency), version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'add_package_line', p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f1605addline$;

create or replace function public.open_package_sale_guarded(
  p_business_id uuid,
  p_customer_id uuid,
  p_package_id uuid,
  p_expected_package_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605opensale$
declare
  v_actor public.memberships;
  v_customer public.customers;
  v_package public.service_packages;
  v_ticket public.tickets;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'open_package_sale', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_customer
  from public.customers c
  where c.business_id = p_business_id and c.id = p_customer_id
  for share;
  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  v_package := public.f16_lock_sellable_package(p_business_id, p_package_id, p_expected_package_version);

  insert into public.tickets(
    business_id, appointment_group_id, customer_id, source, status, currency,
    customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot, created_by_membership_id
  ) values (
    p_business_id, null, v_customer.id, 'walk_in', 'open', v_package.currency,
    v_customer.name, v_customer.phone, v_customer.email, v_actor.id
  ) returning * into v_ticket;

  perform public.f16_insert_package_sale_line(v_ticket, v_package, v_actor);

  v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'open_package_sale', p_idempotency_key, v_ticket.id, v_result
  );
  return v_result;
end
$f1605opensale$;

-- Using and reversing a session -----------------------------------------------------

create or replace function public.apply_ticket_package_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_line_id uuid,
  p_customer_package_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605apply$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_package public.customer_packages;
  v_sale_status text;
  v_before jsonb;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'apply_package', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  -- Lock order everywhere: ticket, then line, then customer package.
  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  select * into v_line
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id and l.id = p_line_id
  for update;
  if v_line.id is null then raise exception 'TICKET_LINE_NOT_FOUND'; end if;
  if v_line.source_type <> 'service' then raise exception 'PACKAGE_LINE_NOT_SERVICE'; end if;
  if v_line.final_unit_price_minor is null then raise exception 'SERVICE_PRICE_NOT_FINAL'; end if;
  if (public.f16_active_package_use(p_business_id, p_line_id)).id is not null then
    raise exception 'LINE_ALREADY_COVERED';
  end if;
  if v_line.discount_minor > 0 then raise exception 'LINE_HAS_DISCOUNT'; end if;

  select * into v_package
  from public.customer_packages cp
  where cp.business_id = p_business_id and cp.id = p_customer_package_id
  for update;
  if v_package.id is null then raise exception 'PACKAGE_NOT_FOUND'; end if;
  if v_package.customer_id <> v_ticket.customer_id then raise exception 'PACKAGE_CUSTOMER_MISMATCH'; end if;
  if v_package.status <> 'active' then raise exception 'PACKAGE_NOT_ACTIVE'; end if;
  if v_package.expires_at <= now() then raise exception 'PACKAGE_EXPIRED'; end if;
  if v_package.service_id <> v_line.service_id then raise exception 'PACKAGE_SERVICE_MISMATCH'; end if;
  if v_package.currency <> v_line.currency_snapshot then raise exception 'MIXED_CURRENCY'; end if;
  if v_package.sessions_used >= v_package.sessions_total then raise exception 'PACKAGE_EXHAUSTED'; end if;

  -- An unpaid package can only cover a session on its own sale ticket, so a
  -- right is never consumed elsewhere before the sale itself is settled.
  if v_package.sale_ticket_id <> p_ticket_id then
    select t.status into v_sale_status
    from public.tickets t
    where t.business_id = p_business_id and t.id = v_package.sale_ticket_id;
    if v_sale_status is distinct from 'closed' then raise exception 'PACKAGE_SALE_NOT_SETTLED'; end if;
  end if;

  v_before := public.f14_ticket_projection(p_business_id, p_ticket_id);
  if (v_before->>'paidMinor')::bigint > 0
     and (
       (v_before->>'totalMinor') is null
       or (v_before->>'totalMinor')::bigint - v_line.final_unit_price_minor::bigint
          < (v_before->>'paidMinor')::bigint
     ) then
    raise exception 'TICKET_TOTAL_BELOW_PAID';
  end if;

  update public.ticket_lines
  set discount_minor = final_unit_price_minor,
      discount_by_membership_id = v_actor.id,
      discount_at = now(),
      discount_reason = left('Paket hakkı: ' || v_package.package_name_snapshot, 240)
  where business_id = p_business_id and id = p_line_id;

  insert into public.customer_package_usages(
    business_id, customer_package_id, kind, ticket_id, ticket_line_id,
    reverses_usage_id, value_minor, reason, actor_membership_id
  ) values (
    p_business_id, v_package.id, 'use', p_ticket_id, p_line_id,
    null, v_package.unit_value_minor, null, v_actor.id
  );

  update public.customer_packages
  set sessions_used = sessions_used + 1
  where business_id = p_business_id and id = v_package.id;

  update public.tickets set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'apply_package', p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f1605apply$;

create or replace function public.reverse_ticket_package_usage_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_line_id uuid,
  p_reason text,
  p_expected_version integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605reverse$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_use public.customer_package_usages;
  v_package public.customer_packages;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'reverse_package_usage', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason) > 240 then raise exception 'INVALID_PACKAGE_REVERSAL'; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then raise exception 'STALE_WRITE'; end if;

  select * into v_line
  from public.ticket_lines l
  where l.business_id = p_business_id and l.ticket_id = p_ticket_id and l.id = p_line_id
  for update;
  if v_line.id is null then raise exception 'TICKET_LINE_NOT_FOUND'; end if;

  v_use := public.f16_active_package_use(p_business_id, p_line_id);
  if v_use.id is null then raise exception 'LINE_NOT_COVERED'; end if;

  select * into v_package
  from public.customer_packages cp
  where cp.business_id = p_business_id and cp.id = v_use.customer_package_id
  for update;
  if v_package.status <> 'active' then raise exception 'PACKAGE_NOT_ACTIVE'; end if;

  insert into public.customer_package_usages(
    business_id, customer_package_id, kind, ticket_id, ticket_line_id,
    reverses_usage_id, value_minor, reason, actor_membership_id
  ) values (
    p_business_id, v_package.id, 'reverse', p_ticket_id, p_line_id,
    v_use.id, v_use.value_minor, v_reason, v_actor.id
  );

  update public.customer_packages
  set sessions_used = sessions_used - 1
  where business_id = p_business_id and id = v_package.id;

  update public.ticket_lines
  set discount_minor = 0,
      discount_by_membership_id = null,
      discount_at = null,
      discount_reason = null
  where business_id = p_business_id and id = p_line_id;

  update public.tickets set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'reverse_package_usage', p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f1605reverse$;

-- Proportional refund of the unused sessions ----------------------------------------

create or replace function public.refund_customer_package_guarded(
  p_business_id uuid,
  p_customer_package_id uuid,
  p_expected_refund_minor integer,
  p_sources jsonb,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f1605refund$
declare
  v_actor public.memberships;
  v_sale_ticket_id uuid;
  v_ticket public.tickets;
  v_package public.customer_packages;
  v_source public.ticket_payment_events;
  v_refund public.ticket_payment_events;
  v_item jsonb;
  v_source_id uuid;
  v_amount integer;
  v_sum bigint := 0;
  v_value bigint;
  v_remaining integer;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_payment_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'refund_package', p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if v_reason is null or char_length(v_reason) > 240
     or p_expected_refund_minor is null or p_expected_refund_minor not between 0 and 100000000
     or p_sources is null or jsonb_typeof(p_sources) <> 'array'
     or jsonb_array_length(p_sources) > 10 then
    raise exception 'INVALID_PACKAGE_REFUND';
  end if;

  select cp.sale_ticket_id into v_sale_ticket_id
  from public.customer_packages cp
  where cp.business_id = p_business_id and cp.id = p_customer_package_id;
  if v_sale_ticket_id is null then raise exception 'PACKAGE_NOT_FOUND'; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = v_sale_ticket_id
  for update;
  if v_ticket.status <> 'closed' then raise exception 'PACKAGE_SALE_NOT_CLOSED'; end if;

  select * into v_package
  from public.customer_packages cp
  where cp.business_id = p_business_id and cp.id = p_customer_package_id
  for update;
  if v_package.status <> 'active' then raise exception 'PACKAGE_NOT_ACTIVE'; end if;

  -- A session still sitting on an open ticket must be settled or reversed
  -- first; otherwise the refund would price a right that may yet come back.
  if exists (
    select 1
    from public.customer_package_usages u
    join public.tickets t on t.business_id = u.business_id and t.id = u.ticket_id
    where u.business_id = p_business_id and u.customer_package_id = v_package.id
      and u.kind = 'use' and t.status = 'open'
      and not exists (
        select 1 from public.customer_package_usages r
        where r.business_id = u.business_id and r.reverses_usage_id = u.id and r.kind = 'reverse'
      )
  ) then
    raise exception 'PACKAGE_USAGE_OPEN';
  end if;

  v_remaining := v_package.sessions_total - v_package.sessions_used;
  if v_remaining < 1 then raise exception 'PACKAGE_FULLY_USED'; end if;
  v_value := public.f16_package_refund_value(v_package);
  if v_value <> p_expected_refund_minor then raise exception 'PACKAGE_REFUND_CHANGED'; end if;

  for v_item in select value from jsonb_array_elements(p_sources) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'paymentEventId') <> 'string'
       or jsonb_typeof(v_item->'amountMinor') <> 'number' then
      raise exception 'INVALID_PACKAGE_REFUND';
    end if;
    begin
      v_source_id := (v_item->>'paymentEventId')::uuid;
      v_amount := (v_item->>'amountMinor')::integer;
    exception when others then
      raise exception 'INVALID_PACKAGE_REFUND';
    end;
    if v_amount is null or v_amount < 1 or v_amount::numeric <> (v_item->>'amountMinor')::numeric then
      raise exception 'INVALID_PACKAGE_REFUND';
    end if;
    v_sum := v_sum + v_amount;
  end loop;
  if (select count(distinct x->>'paymentEventId') from jsonb_array_elements(p_sources) x)
     <> jsonb_array_length(p_sources) then
    raise exception 'INVALID_PACKAGE_REFUND';
  end if;
  if v_sum <> v_value then raise exception 'PACKAGE_REFUND_SOURCES_MISMATCH'; end if;

  for v_item in select value from jsonb_array_elements(p_sources) order by value->>'paymentEventId' loop
    v_source_id := (v_item->>'paymentEventId')::uuid;
    v_amount := (v_item->>'amountMinor')::integer;

    select * into v_source
    from public.ticket_payment_events e
    where e.business_id = p_business_id and e.ticket_id = v_ticket.id
      and e.id = v_source_id and e.event_type = 'payment'
    for update;
    if v_source.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;
    if v_amount::bigint > public.f14_source_payment_net(p_business_id, v_ticket.id, v_source_id) then
      raise exception 'REFUND_EXCEEDS_SOURCE';
    end if;

    insert into public.ticket_payment_events(
      business_id, ticket_id, event_type, source_payment_event_id, payment_method,
      correction_direction, amount_minor, reason, actor_membership_id
    ) values (
      p_business_id, v_ticket.id, 'refund', v_source_id, v_source.payment_method,
      null, v_amount, v_reason, v_actor.id
    ) returning * into v_refund;

    insert into public.customer_package_refund_events(
      business_id, customer_package_id, ticket_id, refund_event_id, amount_minor
    ) values (
      p_business_id, v_package.id, v_ticket.id, v_refund.id, v_amount
    );
  end loop;

  update public.customer_packages
  set status = 'refunded',
      refund_value_minor = v_value,
      refunded_sessions = v_remaining,
      closed_at = now(),
      closed_by_membership_id = v_actor.id,
      close_reason = v_reason
  where business_id = p_business_id and id = v_package.id;

  -- The projection re-checks that net paid never exceeds the reduced total.
  v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'refund_package', p_idempotency_key, v_ticket.id, v_result
  );
  return v_result;
end
$f1605refund$;

create or replace function public.list_customer_packages(
  p_business_id uuid,
  p_customer_id uuid,
  p_include_closed boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1605customerlist$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.business_id = p_business_id and c.id = p_customer_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  return coalesce((
    select jsonb_agg(public.f16_customer_package_json(cp)
      order by (cp.status = 'active') desc, cp.expires_at, cp.id)
    from (
      select * from public.customer_packages x
      where x.business_id = p_business_id and x.customer_id = p_customer_id
        and (coalesce(p_include_closed, false) or x.status = 'active')
      order by (x.status = 'active') desc, x.expires_at, x.id
      limit 100
    ) cp
  ), '[]'::jsonb);
end
$f1605customerlist$;

-- Ticket cancellation restores rights and cancels unused sold packages. It runs
-- inside the cancel transaction after the ticket row lock is held.
create or replace function public.f16_package_effects_on_ticket_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1605cancel$
declare
  v_use public.customer_package_usages;
  v_package public.customer_packages;
begin
  for v_use in
    select u.*
    from public.customer_package_usages u
    where u.business_id = new.business_id and u.ticket_id = new.id and u.kind = 'use'
      and not exists (
        select 1 from public.customer_package_usages r
        where r.business_id = u.business_id and r.reverses_usage_id = u.id and r.kind = 'reverse'
      )
    order by u.customer_package_id, u.id
  loop
    select * into v_package
    from public.customer_packages cp
    where cp.business_id = new.business_id and cp.id = v_use.customer_package_id
    for update;
    if v_package.status <> 'active' then raise exception 'PACKAGE_NOT_ACTIVE'; end if;

    insert into public.customer_package_usages(
      business_id, customer_package_id, kind, ticket_id, ticket_line_id,
      reverses_usage_id, value_minor, reason, actor_membership_id
    ) values (
      new.business_id, v_use.customer_package_id, 'reverse', new.id, v_use.ticket_line_id,
      v_use.id, v_use.value_minor, 'Adisyon iptali', new.cancelled_by_membership_id
    );

    update public.customer_packages
    set sessions_used = sessions_used - 1
    where business_id = new.business_id and id = v_use.customer_package_id;
  end loop;

  for v_package in
    select * from public.customer_packages cp
    where cp.business_id = new.business_id and cp.sale_ticket_id = new.id
    order by cp.id
    for update
  loop
    if v_package.sessions_used > 0 then raise exception 'PACKAGE_IN_USE'; end if;
    update public.customer_packages
    set status = 'cancelled',
        closed_at = now(),
        closed_by_membership_id = new.cancelled_by_membership_id,
        close_reason = 'Adisyon iptali'
    where business_id = new.business_id and id = v_package.id;
  end loop;

  return null;
end
$f1605cancel$;

create trigger tickets_f16_package_cancel_effects
after update of status on public.tickets
for each row
when (old.status = 'open' and new.status = 'cancelled')
execute function public.f16_package_effects_on_ticket_cancel();

-- Day report: package sales are their own income line; package-covered
-- sessions contribute 0 service income and are reported only as a count/value.
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
as $f1605report$
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
        ),0)::bigint - coalesce(rv.returned_minor,0) - coalesce(pr.refunded_minor,0),
        0
      )::bigint as expected_min_minor,
      greatest(
        coalesce(sum(
          l.price_max_minor_snapshot::bigint*l.quantity::bigint-l.discount_minor::bigint
        ),0)::bigint - coalesce(rv.returned_minor,0) - coalesce(pr.refunded_minor,0),
        0
      )::bigint as expected_max_minor,
      coalesce(sum(case when l.source_type='service' and l.final_unit_price_minor is not null
                        then l.final_unit_price_minor::bigint*l.quantity::bigint-l.discount_minor::bigint
                        else 0 end),0)::bigint as service_minor,
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
    left join payment_all_time pa on pa.ticket_id=ts.id
    group by ts.id,rv.returned_minor,pr.refunded_minor,pa.paid_minor
  ),
  sale as (
    select
      coalesce(sum(tr.expected_min_minor),0)::bigint as expected_min_minor,
      coalesce(sum(tr.expected_max_minor),0)::bigint as expected_max_minor,
      coalesce(sum(case when tr.settled then tr.service_minor else 0 end),0)::bigint as service_minor,
      coalesce(sum(case when tr.settled then tr.product_minor else 0 end),0)::bigint as product_minor,
      coalesce(sum(case when tr.settled then tr.package_minor else 0 end),0)::bigint as package_minor,
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
$f1605report$;

revoke all on function public.get_financial_day_report(uuid,date,date)
from public, anon, authenticated;
grant execute on function public.get_financial_day_report(uuid,date,date)
to authenticated;

-- Grants ---------------------------------------------------------------------------

revoke all on function public.f16_active_package_use(uuid,uuid) from public, anon, authenticated;
revoke all on function public.f16_guard_service_package_update() from public, anon, authenticated;
revoke all on function public.f16_guard_customer_package_change() from public, anon, authenticated;
revoke all on function public.f16_guard_append_only_package_ledger() from public, anon, authenticated;
revoke all on function public.f16_guard_package_usage_insert() from public, anon, authenticated;
revoke all on function public.f16_guard_package_covered_line() from public, anon, authenticated;
revoke all on function public.f16_round_half_up_div(bigint,bigint) from public, anon, authenticated;
revoke all on function public.f16_package_refund_value(public.customer_packages) from public, anon, authenticated;
revoke all on function public.f16_service_package_json(public.service_packages) from public, anon, authenticated;
revoke all on function public.f16_customer_package_json(public.customer_packages) from public, anon, authenticated;
revoke all on function public.f16_insert_package_sale_line(public.tickets,public.service_packages,public.memberships) from public, anon, authenticated;
revoke all on function public.f16_lock_sellable_package(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.f16_package_effects_on_ticket_cancel() from public, anon, authenticated;

revoke all on function public.create_service_package_guarded(uuid,uuid,uuid,text,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.update_service_package_guarded(uuid,uuid,integer,text,integer,integer,integer,boolean) from public, anon, authenticated;
revoke all on function public.list_service_packages(uuid,boolean) from public, anon, authenticated;
revoke all on function public.add_ticket_package_line_guarded(uuid,uuid,uuid,integer,integer,text,text) from public, anon, authenticated;
revoke all on function public.open_package_sale_guarded(uuid,uuid,uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.apply_ticket_package_guarded(uuid,uuid,uuid,uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.reverse_ticket_package_usage_guarded(uuid,uuid,uuid,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.refund_customer_package_guarded(uuid,uuid,integer,jsonb,text,text,text) from public, anon, authenticated;
revoke all on function public.list_customer_packages(uuid,uuid,boolean) from public, anon, authenticated;

grant execute on function public.create_service_package_guarded(uuid,uuid,uuid,text,integer,integer,integer) to authenticated;
grant execute on function public.update_service_package_guarded(uuid,uuid,integer,text,integer,integer,integer,boolean) to authenticated;
grant execute on function public.list_service_packages(uuid,boolean) to authenticated;
grant execute on function public.add_ticket_package_line_guarded(uuid,uuid,uuid,integer,integer,text,text) to authenticated;
grant execute on function public.open_package_sale_guarded(uuid,uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.apply_ticket_package_guarded(uuid,uuid,uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.reverse_ticket_package_usage_guarded(uuid,uuid,uuid,text,integer,text,text) to authenticated;
grant execute on function public.refund_customer_package_guarded(uuid,uuid,integer,jsonb,text,text,text) to authenticated;
grant execute on function public.list_customer_packages(uuid,uuid,boolean) to authenticated;

commit;
