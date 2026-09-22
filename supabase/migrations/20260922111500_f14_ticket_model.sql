begin;

-- F14-02: additive ticket/service-line model.
-- Payments, refunds and corrections intentionally remain F14-03 scope.

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_group_id uuid,
  customer_id uuid not null,
  source text not null check (source in ('booking_group','walk_in')),
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  version integer not null default 1 check (version > 0),
  customer_name_snapshot text not null check (char_length(btrim(customer_name_snapshot)) between 2 and 120),
  customer_phone_snapshot text check (customer_phone_snapshot is null or char_length(customer_phone_snapshot) <= 40),
  customer_email_snapshot text check (customer_email_snapshot is null or char_length(customer_email_snapshot) <= 254),
  created_by_membership_id uuid not null,
  closed_by_membership_id uuid,
  closed_at timestamptz,
  cancelled_by_membership_id uuid,
  cancelled_at timestamptz,
  cancellation_reason text check (cancellation_reason is null or char_length(btrim(cancellation_reason)) between 2 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_business_id_key unique (business_id, id),
  constraint tickets_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  constraint tickets_group_fk
    foreign key (business_id, appointment_group_id)
    references public.appointment_groups(business_id, id),
  constraint tickets_creator_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id),
  constraint tickets_closer_fk
    foreign key (business_id, closed_by_membership_id)
    references public.memberships(business_id, id),
  constraint tickets_canceller_fk
    foreign key (business_id, cancelled_by_membership_id)
    references public.memberships(business_id, id),
  constraint tickets_source_contract
    check (
      (source = 'booking_group' and appointment_group_id is not null)
      or (source = 'walk_in' and appointment_group_id is null)
    ),
  constraint tickets_lifecycle_metadata
    check (
      (
        status = 'open'
        and closed_by_membership_id is null and closed_at is null
        and cancelled_by_membership_id is null and cancelled_at is null
        and cancellation_reason is null
      )
      or (
        status = 'closed'
        and closed_by_membership_id is not null and closed_at is not null
        and cancelled_by_membership_id is null and cancelled_at is null
        and cancellation_reason is null
      )
      or (
        status = 'cancelled'
        and cancelled_by_membership_id is not null and cancelled_at is not null
        and cancellation_reason is not null
        and closed_by_membership_id is null and closed_at is null
      )
    )
);

create unique index if not exists tickets_one_per_booking_group_idx
  on public.tickets(business_id, appointment_group_id)
  where appointment_group_id is not null;

create index if not exists tickets_business_status_idx
  on public.tickets(business_id, status, updated_at desc, id desc);

create table if not exists public.ticket_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  ticket_id uuid not null,
  line_ordinal integer not null check (line_ordinal between 1 and 100),
  source_type text not null default 'service' check (source_type = 'service'),
  source_appointment_line_id uuid,
  service_id uuid not null,
  staff_id uuid,
  service_name_snapshot text not null check (char_length(btrim(service_name_snapshot)) between 2 and 120),
  staff_name_snapshot text check (staff_name_snapshot is null or char_length(btrim(staff_name_snapshot)) between 2 and 120),
  quantity integer not null default 1 check (quantity = 1),
  price_type_snapshot text not null check (price_type_snapshot in ('fixed','range')),
  price_min_minor_snapshot integer not null check (price_min_minor_snapshot between 0 and 100000000),
  price_max_minor_snapshot integer not null check (price_max_minor_snapshot between 0 and 100000000),
  currency_snapshot text not null check (currency_snapshot ~ '^[A-Z]{3}$'),
  price_policy_version_snapshot integer not null check (price_policy_version_snapshot > 0),
  final_unit_price_minor integer check (final_unit_price_minor is null or final_unit_price_minor between 0 and 100000000),
  finalized_by_membership_id uuid,
  finalized_at timestamptz,
  finalization_reason text check (finalization_reason is null or char_length(btrim(finalization_reason)) between 2 and 240),
  discount_minor integer not null default 0 check (discount_minor between 0 and 100000000),
  discount_by_membership_id uuid,
  discount_at timestamptz,
  discount_reason text check (discount_reason is null or char_length(btrim(discount_reason)) between 2 and 240),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  constraint ticket_lines_business_id_key unique (business_id, id),
  constraint ticket_lines_ticket_ordinal_key unique (business_id, ticket_id, line_ordinal),
  constraint ticket_lines_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint ticket_lines_appointment_line_fk
    foreign key (business_id, source_appointment_line_id)
    references public.appointments(business_id, id),
  constraint ticket_lines_service_fk
    foreign key (business_id, service_id)
    references public.services(business_id, id),
  constraint ticket_lines_staff_fk
    foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id),
  constraint ticket_lines_finalizer_fk
    foreign key (business_id, finalized_by_membership_id)
    references public.memberships(business_id, id),
  constraint ticket_lines_discounter_fk
    foreign key (business_id, discount_by_membership_id)
    references public.memberships(business_id, id),
  constraint ticket_lines_creator_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id),
  constraint ticket_lines_price_range
    check (price_min_minor_snapshot <= price_max_minor_snapshot),
  constraint ticket_lines_price_type_shape
    check (
      (price_type_snapshot = 'fixed' and price_min_minor_snapshot = price_max_minor_snapshot)
      or price_type_snapshot = 'range'
    ),
  constraint ticket_lines_finalization_shape
    check (
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
);

create unique index if not exists ticket_lines_source_appointment_unique_idx
  on public.ticket_lines(business_id, source_appointment_line_id)
  where source_appointment_line_id is not null;

create index if not exists ticket_lines_ticket_idx
  on public.ticket_lines(business_id, ticket_id, line_ordinal);

create table if not exists public.ticket_commands (
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_membership_id uuid not null,
  command text not null check (command in (
    'open_from_booking_group',
    'open_walk_in',
    'add_service_line',
    'finalize_service_price',
    'set_service_discount',
    'close_ticket',
    'cancel_ticket'
  )),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  ticket_id uuid,
  result_payload jsonb,
  created_at timestamptz not null default now(),
  primary key (business_id, actor_membership_id, command, idempotency_key),
  constraint ticket_commands_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id),
  constraint ticket_commands_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint ticket_commands_result_shape
    check (
      (ticket_id is null and result_payload is null)
      or (ticket_id is not null and result_payload is not null)
    )
);

alter table public.tickets enable row level security;
alter table public.ticket_lines enable row level security;
alter table public.ticket_commands enable row level security;
alter table public.tickets force row level security;
alter table public.ticket_lines force row level security;
alter table public.ticket_commands force row level security;

revoke all on table public.tickets from public, anon, authenticated;
revoke all on table public.ticket_lines from public, anon, authenticated;
revoke all on table public.ticket_commands from public, anon, authenticated;

drop policy if exists tickets_select_member on public.tickets;
create policy tickets_select_member on public.tickets
for select to authenticated using (public.is_active_member(business_id));

drop policy if exists ticket_lines_select_member on public.ticket_lines;
create policy ticket_lines_select_member on public.ticket_lines
for select to authenticated using (public.is_active_member(business_id));

drop trigger if exists tickets_touch_updated_at on public.tickets;
create trigger tickets_touch_updated_at
before update on public.tickets
for each row execute function public.touch_updated_at();

create or replace function public.f14_financial_actor(p_business_id uuid)
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
    'pricing_adjustments_write'::public.financial_permission_key
  ) then
    raise exception 'FINANCIAL_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return v_actor;
end
$$;

revoke all on function public.f14_financial_actor(uuid) from public, anon, authenticated;

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
as $$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in (
    'open_from_booking_group','open_walk_in','add_service_line',
    'finalize_service_price','set_service_discount','close_ticket','cancel_ticket'
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
$$;

revoke all on function public.f14_claim_ticket_command(uuid,uuid,text,text,text)
from public, anon, authenticated;

create or replace function public.f14_finish_ticket_command(
  p_business_id uuid,
  p_actor_membership_id uuid,
  p_command text,
  p_idempotency_key text,
  p_ticket_id uuid,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ticket_id is null or p_result is null then
    raise exception 'INVALID_TICKET_RESULT';
  end if;

  update public.ticket_commands
  set ticket_id = p_ticket_id,
      result_payload = p_result
  where business_id = p_business_id
    and actor_membership_id = p_actor_membership_id
    and command = p_command
    and idempotency_key = p_idempotency_key
    and ticket_id is null
    and result_payload is null;

  if not found then
    raise exception 'TICKET_COMMAND_RESULT_CONFLICT';
  end if;
end
$$;

revoke all on function public.f14_finish_ticket_command(uuid,uuid,text,text,uuid,jsonb)
from public, anon, authenticated;

create or replace function public.f14_ticket_projection(
  p_business_id uuid,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_lines jsonb;
  v_count integer;
  v_final_count integer;
  v_estimate_min bigint;
  v_estimate_max bigint;
  v_subtotal bigint;
  v_discount bigint;
  v_total bigint;
  v_ready boolean;
begin
  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id
    and t.id = p_ticket_id;

  if v_ticket.id is null then
    return null;
  end if;

  select
    count(*)::integer,
    count(*) filter (where l.final_unit_price_minor is not null)::integer,
    coalesce(sum(l.price_min_minor_snapshot::bigint), 0),
    coalesce(sum(l.price_max_minor_snapshot::bigint), 0),
    coalesce(sum(l.final_unit_price_minor::bigint), 0),
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
      'quantity', l.quantity,
      'priceType', l.price_type_snapshot,
      'priceMinMinor', l.price_min_minor_snapshot,
      'priceMaxMinor', l.price_max_minor_snapshot,
      'currency', l.currency_snapshot,
      'pricePolicyVersion', l.price_policy_version_snapshot,
      'finalUnitPriceMinor', l.final_unit_price_minor,
      'discountMinor', l.discount_minor,
      'netMinor', case
        when l.final_unit_price_minor is null then null
        else l.final_unit_price_minor - l.discount_minor
      end,
      'finalizedAt', l.finalized_at,
      'finalizationReason', l.finalization_reason,
      'discountAt', l.discount_at,
      'discountReason', l.discount_reason
    ) order by l.line_ordinal), '[]'::jsonb)
  into
    v_count, v_final_count, v_estimate_min, v_estimate_max,
    v_subtotal, v_discount, v_lines
  from public.ticket_lines l
  where l.business_id = p_business_id
    and l.ticket_id = p_ticket_id;

  v_ready := v_count > 0 and v_count = v_final_count;
  v_total := case when v_ready then v_subtotal - v_discount else null end;

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
    'totalMinor', v_total,
    'paymentStatus', 'unpaid',
    'paidMinor', 0,
    'balanceMinor', v_total,
    'createdAt', v_ticket.created_at,
    'updatedAt', v_ticket.updated_at,
    'closedAt', v_ticket.closed_at,
    'cancelledAt', v_ticket.cancelled_at,
    'cancellationReason', v_ticket.cancellation_reason,
    'lines', v_lines
  );
end
$$;

revoke all on function public.f14_ticket_projection(uuid,uuid)
from public, anon, authenticated;

create or replace function public.get_ticket_contract(
  p_business_id uuid,
  p_ticket_id uuid
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

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  if v_result is null then
    raise exception 'TICKET_NOT_FOUND';
  end if;
  return v_result;
end
$$;

revoke all on function public.get_ticket_contract(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.get_ticket_contract(uuid,uuid) to authenticated;

create or replace function public.open_ticket_from_booking_group_guarded(
  p_business_id uuid,
  p_group_id uuid,
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
  v_group public.appointment_groups;
  v_ticket public.tickets;
  v_currency text;
  v_currency_count integer;
  v_line_count integer;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'open_from_booking_group',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_business_id::text || ':ticket-group:' || coalesce(p_group_id::text, ''), 0
  ));

  select * into v_group
  from public.appointment_groups g
  where g.business_id = p_business_id
    and g.id = p_group_id
  for share;

  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;
  if v_group.status = 'cancelled' then raise exception 'BOOKING_GROUP_CANCELLED'; end if;

  select count(*)::integer, count(distinct a.currency_snapshot)::integer, min(a.currency_snapshot)
  into v_line_count, v_currency_count, v_currency
  from public.appointments a
  where a.business_id = p_business_id
    and a.group_id = p_group_id;

  if v_line_count < 1 then raise exception 'BOOKING_GROUP_EMPTY'; end if;
  if v_currency_count <> 1 or v_currency is null then raise exception 'MIXED_CURRENCY'; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id
    and t.appointment_group_id = p_group_id
  for update;

  if v_ticket.id is null then
    insert into public.tickets(
      business_id, appointment_group_id, customer_id, source, status, currency,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      created_by_membership_id
    )
    select
      p_business_id,
      p_group_id,
      v_group.customer_id,
      'booking_group',
      'open',
      v_currency,
      a.customer_name_snapshot,
      a.customer_phone_snapshot,
      a.customer_email_snapshot,
      v_actor.id
    from public.appointments a
    where a.business_id = p_business_id
      and a.group_id = p_group_id
    order by a.line_ordinal
    limit 1
    returning * into v_ticket;

    insert into public.ticket_lines(
      business_id, ticket_id, line_ordinal, source_type, source_appointment_line_id,
      service_id, staff_id, service_name_snapshot, staff_name_snapshot,
      price_type_snapshot, price_min_minor_snapshot, price_max_minor_snapshot,
      currency_snapshot, price_policy_version_snapshot,
      final_unit_price_minor, finalized_by_membership_id, finalized_at, finalization_reason,
      created_by_membership_id
    )
    select
      a.business_id,
      v_ticket.id,
      a.line_ordinal,
      'service',
      a.id,
      a.service_id,
      a.staff_id,
      a.service_name_snapshot,
      a.staff_name_snapshot,
      a.price_type_snapshot,
      a.price_min_minor_snapshot,
      a.price_max_minor_snapshot,
      a.currency_snapshot,
      a.price_policy_version_snapshot,
      case when a.price_type_snapshot = 'fixed' then a.price_min_minor_snapshot else null end,
      case when a.price_type_snapshot = 'fixed' then v_actor.id else null end,
      case when a.price_type_snapshot = 'fixed' then now() else null end,
      case when a.price_type_snapshot = 'fixed' then 'fixed_booking_snapshot' else null end,
      v_actor.id
    from public.appointments a
    where a.business_id = p_business_id
      and a.group_id = p_group_id
    order by a.line_ordinal;
  end if;

  v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'open_from_booking_group',
    p_idempotency_key, v_ticket.id, v_result
  );
  return v_result;
end
$$;

create or replace function public.open_walk_in_ticket_guarded(
  p_business_id uuid,
  p_customer_id uuid,
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
  v_customer public.customers;
  v_ticket public.tickets;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'open_walk_in',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_customer
  from public.customers c
  where c.business_id = p_business_id
    and c.id = p_customer_id;

  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  insert into public.tickets(
    business_id, appointment_group_id, customer_id, source, status, currency,
    customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
    created_by_membership_id
  ) values (
    p_business_id, null, v_customer.id, 'walk_in', 'open', null,
    v_customer.name, v_customer.phone, v_customer.email, v_actor.id
  )
  returning * into v_ticket;

  v_result := public.f14_ticket_projection(p_business_id, v_ticket.id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'open_walk_in',
    p_idempotency_key, v_ticket.id, v_result
  );
  return v_result;
end
$$;

create or replace function public.add_ticket_service_line_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_service_id uuid,
  p_staff_id uuid,
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
  v_ticket public.tickets;
  v_service public.services;
  v_staff public.staff_profiles;
  v_ordinal integer;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'add_service_line',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  select * into v_service
  from public.services s
  where s.business_id = p_business_id
    and s.id = p_service_id
    and s.active
  for share;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;

  if p_staff_id is not null then
    select * into v_staff
    from public.staff_profiles sp
    where sp.business_id = p_business_id
      and sp.id = p_staff_id
      and sp.active;
    if v_staff.id is null then raise exception 'STAFF_NOT_FOUND'; end if;
    if not exists (
      select 1 from public.staff_services ss
      where ss.business_id = p_business_id
        and ss.staff_id = p_staff_id
        and ss.service_id = p_service_id
        and ss.active
    ) then
      raise exception 'ASSIGNMENT_NOT_FOUND';
    end if;
  end if;

  if v_ticket.currency is null then
    update public.tickets
    set currency = v_service.currency
    where business_id = p_business_id and id = p_ticket_id;
    v_ticket.currency := v_service.currency;
  elsif v_ticket.currency <> v_service.currency then
    raise exception 'MIXED_CURRENCY';
  end if;

  select coalesce(max(line_ordinal), 0) + 1
  into v_ordinal
  from public.ticket_lines
  where business_id = p_business_id and ticket_id = p_ticket_id;

  if v_ordinal > 100 then raise exception 'TICKET_LINE_LIMIT_EXCEEDED'; end if;

  insert into public.ticket_lines(
    business_id, ticket_id, line_ordinal, source_type, source_appointment_line_id,
    service_id, staff_id, service_name_snapshot, staff_name_snapshot,
    price_type_snapshot, price_min_minor_snapshot, price_max_minor_snapshot,
    currency_snapshot, price_policy_version_snapshot,
    final_unit_price_minor, finalized_by_membership_id, finalized_at, finalization_reason,
    created_by_membership_id
  ) values (
    p_business_id, p_ticket_id, v_ordinal, 'service', null,
    v_service.id, v_staff.id, v_service.name, v_staff.name,
    v_service.price_type, v_service.price_min_minor, v_service.price_max_minor,
    v_service.currency, v_service.price_policy_version,
    case when v_service.price_type = 'fixed' then v_service.price_min_minor else null end,
    case when v_service.price_type = 'fixed' then v_actor.id else null end,
    case when v_service.price_type = 'fixed' then now() else null end,
    case when v_service.price_type = 'fixed' then 'fixed_catalog_snapshot' else null end,
    v_actor.id
  );

  update public.tickets
  set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'add_service_line',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$$;

create or replace function public.finalize_ticket_service_price_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_line_id uuid,
  p_final_unit_price_minor integer,
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
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_reason text;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'finalize_service_price',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_final_unit_price_minor is null
     or p_final_unit_price_minor not between 0 and 100000000
     or v_reason is null
     or char_length(v_reason) > 240 then
    raise exception 'INVALID_FINAL_PRICE';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  select * into v_line
  from public.ticket_lines l
  where l.business_id = p_business_id
    and l.ticket_id = p_ticket_id
    and l.id = p_line_id
  for update;
  if v_line.id is null then raise exception 'TICKET_LINE_NOT_FOUND'; end if;
  if v_line.price_type_snapshot <> 'range' then raise exception 'FIXED_PRICE_IMMUTABLE'; end if;
  if v_line.final_unit_price_minor is not null then raise exception 'PRICE_ALREADY_FINAL'; end if;

  update public.ticket_lines
  set final_unit_price_minor = p_final_unit_price_minor,
      finalized_by_membership_id = v_actor.id,
      finalized_at = now(),
      finalization_reason = v_reason
  where business_id = p_business_id and id = p_line_id;

  update public.tickets
  set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'finalize_service_price',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$$;

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
as $$
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
    p_business_id, v_actor.id, 'set_service_discount',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_discount_minor is null
     or p_discount_minor not between 0 and 100000000
     or v_reason is null
     or char_length(v_reason) > 240 then
    raise exception 'INVALID_DISCOUNT';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  select * into v_line
  from public.ticket_lines l
  where l.business_id = p_business_id
    and l.ticket_id = p_ticket_id
    and l.id = p_line_id
  for update;
  if v_line.id is null then raise exception 'TICKET_LINE_NOT_FOUND'; end if;
  if v_line.final_unit_price_minor is null then raise exception 'SERVICE_PRICE_NOT_FINAL'; end if;
  if p_discount_minor > v_line.final_unit_price_minor then raise exception 'DISCOUNT_EXCEEDS_LINE'; end if;

  update public.ticket_lines
  set discount_minor = p_discount_minor,
      discount_by_membership_id = case when p_discount_minor > 0 then v_actor.id else null end,
      discount_at = case when p_discount_minor > 0 then now() else null end,
      discount_reason = case when p_discount_minor > 0 then v_reason else null end
  where business_id = p_business_id and id = p_line_id;

  update public.tickets
  set version = version + 1
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'set_service_discount',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$$;

create or replace function public.close_ticket_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
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
  v_ticket public.tickets;
  v_replay jsonb;
  v_result jsonb;
  v_count integer;
  v_unfinalized integer;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'close_ticket',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  select
    count(*)::integer,
    count(*) filter (where final_unit_price_minor is null)::integer
  into v_count, v_unfinalized
  from public.ticket_lines
  where business_id = p_business_id and ticket_id = p_ticket_id;

  if v_count < 1 then raise exception 'TICKET_EMPTY'; end if;
  if v_unfinalized > 0 then raise exception 'SERVICE_PRICE_NOT_FINAL'; end if;

  update public.tickets
  set status = 'closed',
      version = version + 1,
      closed_by_membership_id = v_actor.id,
      closed_at = now()
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'close_ticket',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$$;

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
as $$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_reason text;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor := public.f14_financial_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'cancel_ticket',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) > 240 then
    raise exception 'INVALID_CANCELLATION_REASON';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;
  if p_expected_version is null or v_ticket.version <> p_expected_version then
    raise exception 'STALE_WRITE';
  end if;

  update public.tickets
  set status = 'cancelled',
      version = version + 1,
      cancelled_by_membership_id = v_actor.id,
      cancelled_at = now(),
      cancellation_reason = v_reason
  where business_id = p_business_id and id = p_ticket_id;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'cancel_ticket',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$$;

create or replace function public.f14_guard_ticket_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.business_id is distinct from new.business_id
     or old.id is distinct from new.id
     or old.appointment_group_id is distinct from new.appointment_group_id
     or old.customer_id is distinct from new.customer_id
     or old.source is distinct from new.source
     or old.customer_name_snapshot is distinct from new.customer_name_snapshot
     or old.customer_phone_snapshot is distinct from new.customer_phone_snapshot
     or old.customer_email_snapshot is distinct from new.customer_email_snapshot
     or old.created_by_membership_id is distinct from new.created_by_membership_id
     or old.created_at is distinct from new.created_at then
    raise exception 'TICKET_SOURCE_IMMUTABLE';
  end if;

  if old.currency is not null and old.currency is distinct from new.currency then
    raise exception 'TICKET_CURRENCY_IMMUTABLE';
  end if;

  if old.status <> 'open' then
    raise exception 'TICKET_IMMUTABLE';
  end if;

  if new.version <> old.version + 1 then
    raise exception 'TICKET_VERSION_REQUIRED';
  end if;

  return new;
end
$$;

revoke all on function public.f14_guard_ticket_update() from public, anon, authenticated;

drop trigger if exists tickets_f14_update_guard on public.tickets;
create trigger tickets_f14_update_guard
before update on public.tickets
for each row execute function public.f14_guard_ticket_update();

create or replace function public.f14_guard_ticket_line_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select t.status into v_status
  from public.tickets t
  where t.business_id = old.business_id and t.id = old.ticket_id;

  if v_status is distinct from 'open' then
    raise exception 'TICKET_IMMUTABLE';
  end if;

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
$$;

revoke all on function public.f14_guard_ticket_line_update() from public, anon, authenticated;

drop trigger if exists ticket_lines_f14_update_guard on public.ticket_lines;
create trigger ticket_lines_f14_update_guard
before update on public.ticket_lines
for each row execute function public.f14_guard_ticket_line_update();

create or replace function public.f14_block_ticket_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'TICKET_DELETE_FORBIDDEN';
end
$$;

revoke all on function public.f14_block_ticket_delete() from public, anon, authenticated;

drop trigger if exists tickets_f14_delete_guard on public.tickets;
create trigger tickets_f14_delete_guard
before delete on public.tickets
for each row execute function public.f14_block_ticket_delete();

drop trigger if exists ticket_lines_f14_delete_guard on public.ticket_lines;
create trigger ticket_lines_f14_delete_guard
before delete on public.ticket_lines
for each row execute function public.f14_block_ticket_delete();

revoke all on function public.open_ticket_from_booking_group_guarded(uuid,uuid,text,text)
from public, anon, authenticated;
revoke all on function public.open_walk_in_ticket_guarded(uuid,uuid,text,text)
from public, anon, authenticated;
revoke all on function public.add_ticket_service_line_guarded(uuid,uuid,uuid,uuid,integer,text,text)
from public, anon, authenticated;
revoke all on function public.finalize_ticket_service_price_guarded(uuid,uuid,uuid,integer,text,integer,text,text)
from public, anon, authenticated;
revoke all on function public.set_ticket_service_discount_guarded(uuid,uuid,uuid,integer,text,integer,text,text)
from public, anon, authenticated;
revoke all on function public.close_ticket_guarded(uuid,uuid,integer,text,text)
from public, anon, authenticated;
revoke all on function public.cancel_ticket_guarded(uuid,uuid,text,integer,text,text)
from public, anon, authenticated;

grant execute on function public.open_ticket_from_booking_group_guarded(uuid,uuid,text,text)
to authenticated;
grant execute on function public.open_walk_in_ticket_guarded(uuid,uuid,text,text)
to authenticated;
grant execute on function public.add_ticket_service_line_guarded(uuid,uuid,uuid,uuid,integer,text,text)
to authenticated;
grant execute on function public.finalize_ticket_service_price_guarded(uuid,uuid,uuid,integer,text,integer,text,text)
to authenticated;
grant execute on function public.set_ticket_service_discount_guarded(uuid,uuid,uuid,integer,text,integer,text,text)
to authenticated;
grant execute on function public.close_ticket_guarded(uuid,uuid,integer,text,text)
to authenticated;
grant execute on function public.cancel_ticket_guarded(uuid,uuid,text,integer,text,text)
to authenticated;

commit;
