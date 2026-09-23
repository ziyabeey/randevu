begin;

-- F14-03: append-only manual payment/correction/refund ledger.
-- Online payment providers and UI remain out of scope.

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
    'record_refund'
  ));

create table if not exists public.ticket_payment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  ticket_id uuid not null,
  event_type text not null check (event_type in ('payment','correction','refund')),
  source_payment_event_id uuid,
  payment_method text not null check (payment_method in ('cash','card')),
  correction_direction text check (correction_direction in ('increase','decrease')),
  amount_minor integer not null check (amount_minor between 1 and 100000000),
  reason text check (reason is null or char_length(btrim(reason)) between 2 and 240),
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  constraint ticket_payment_events_business_ticket_id_key
    unique (business_id, ticket_id, id),
  constraint ticket_payment_events_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint ticket_payment_events_source_fk
    foreign key (business_id, ticket_id, source_payment_event_id)
    references public.ticket_payment_events(business_id, ticket_id, id),
  constraint ticket_payment_events_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id),
  constraint ticket_payment_events_not_self_source
    check (source_payment_event_id is null or source_payment_event_id <> id),
  constraint ticket_payment_events_shape
    check (
      (
        event_type = 'payment'
        and source_payment_event_id is null
        and correction_direction is null
        and reason is null
      )
      or
      (
        event_type = 'correction'
        and source_payment_event_id is not null
        and correction_direction is not null
        and reason is not null
      )
      or
      (
        event_type = 'refund'
        and source_payment_event_id is not null
        and correction_direction is null
        and reason is not null
      )
    )
);

create index if not exists ticket_payment_events_ticket_idx
  on public.ticket_payment_events(business_id, ticket_id, created_at, id);

create index if not exists ticket_payment_events_source_idx
  on public.ticket_payment_events(business_id, ticket_id, source_payment_event_id)
  where source_payment_event_id is not null;

alter table public.ticket_payment_events enable row level security;
alter table public.ticket_payment_events force row level security;
revoke all on table public.ticket_payment_events from public, anon, authenticated;

create or replace function public.f14_payment_actor(p_business_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $f14payactor$
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
    'payments_write'::public.financial_permission_key
  ) then
    raise exception 'PAYMENTS_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return v_actor;
end
$f14payactor$;

revoke all on function public.f14_payment_actor(uuid)
from public, anon, authenticated;

create or replace function public.f14_ticket_paid_minor(
  p_business_id uuid,
  p_ticket_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $f14paid$
  select coalesce(sum(
    case
      when e.event_type = 'payment' then e.amount_minor::bigint
      when e.event_type = 'correction' and e.correction_direction = 'increase' then e.amount_minor::bigint
      when e.event_type = 'correction' and e.correction_direction = 'decrease' then -e.amount_minor::bigint
      when e.event_type = 'refund' then -e.amount_minor::bigint
      else 0::bigint
    end
  ), 0::bigint)
  from public.ticket_payment_events e
  where e.business_id = p_business_id
    and e.ticket_id = p_ticket_id
$f14paid$;

revoke all on function public.f14_ticket_paid_minor(uuid,uuid)
from public, anon, authenticated;

create or replace function public.f14_source_payment_net(
  p_business_id uuid,
  p_ticket_id uuid,
  p_source_payment_event_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $f14source$
declare
  v_source public.ticket_payment_events;
  v_net bigint;
begin
  select * into v_source
  from public.ticket_payment_events e
  where e.business_id = p_business_id
    and e.ticket_id = p_ticket_id
    and e.id = p_source_payment_event_id
    and e.event_type = 'payment';

  if v_source.id is null then
    raise exception 'SOURCE_PAYMENT_NOT_FOUND';
  end if;

  select
    v_source.amount_minor::bigint
    + coalesce(sum(
      case
        when e.event_type = 'correction' and e.correction_direction = 'increase'
          then e.amount_minor::bigint
        when e.event_type = 'correction' and e.correction_direction = 'decrease'
          then -e.amount_minor::bigint
        when e.event_type = 'refund'
          then -e.amount_minor::bigint
        else 0::bigint
      end
    ), 0::bigint)
  into v_net
  from public.ticket_payment_events e
  where e.business_id = p_business_id
    and e.ticket_id = p_ticket_id
    and e.source_payment_event_id = p_source_payment_event_id;

  return v_net;
end
$f14source$;

revoke all on function public.f14_source_payment_net(uuid,uuid,uuid)
from public, anon, authenticated;

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
as $f14claim$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in (
    'open_from_booking_group','open_walk_in','add_service_line',
    'finalize_service_price','set_service_discount','close_ticket','cancel_ticket',
    'record_payment','record_correction','record_refund'
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
$f14claim$;

revoke all on function public.f14_claim_ticket_command(uuid,uuid,text,text,text)
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
as $f14projection$
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
  v_paid bigint;
  v_balance bigint;
  v_ready boolean;
  v_payment_status text;
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
  v_paid := public.f14_ticket_paid_minor(p_business_id, p_ticket_id);

  if v_paid < 0 then
    raise exception 'FINANCIAL_INVARIANT_BROKEN';
  end if;
  if v_total is not null and v_paid > v_total then
    raise exception 'FINANCIAL_INVARIANT_BROKEN';
  end if;

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
  where e.business_id = p_business_id
    and e.ticket_id = p_ticket_id;

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
$f14projection$;

revoke all on function public.f14_ticket_projection(uuid,uuid)
from public, anon, authenticated;

create or replace function public.record_ticket_payment_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_payment_method text,
  p_amount_minor integer,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f14payment$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_replay jsonb;
  v_before jsonb;
  v_result jsonb;
  v_event public.ticket_payment_events;
begin
  v_actor := public.f14_payment_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'record_payment',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if p_payment_method not in ('cash','card')
     or p_amount_minor is null
     or p_amount_minor not between 1 and 100000000 then
    raise exception 'INVALID_PAYMENT';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id
    and t.id = p_ticket_id
  for update;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status = 'cancelled' then raise exception 'TICKET_CANCELLED'; end if;

  v_before := public.f14_ticket_projection(p_business_id, p_ticket_id);

  if not coalesce((v_before->>'settlementReady')::boolean, false) then
    raise exception 'PAYMENT_REQUIRES_FINAL_TOTAL';
  end if;
  if (v_before->>'balanceMinor')::bigint <= 0 then
    raise exception 'TICKET_ALREADY_PAID';
  end if;
  if p_amount_minor::bigint > (v_before->>'balanceMinor')::bigint then
    raise exception 'OVERPAYMENT';
  end if;

  insert into public.ticket_payment_events(
    business_id, ticket_id, event_type, source_payment_event_id,
    payment_method, correction_direction, amount_minor, reason,
    actor_membership_id
  ) values (
    p_business_id, p_ticket_id, 'payment', null,
    p_payment_method, null, p_amount_minor, null,
    v_actor.id
  )
  returning * into v_event;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'record_payment',
    p_idempotency_key, p_ticket_id, v_result
  );

  return v_result;
end
$f14payment$;

create or replace function public.record_ticket_correction_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_source_payment_event_id uuid,
  p_direction text,
  p_amount_minor integer,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f14correction$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_source public.ticket_payment_events;
  v_replay jsonb;
  v_before jsonb;
  v_result jsonb;
  v_reason text;
  v_source_net bigint;
begin
  v_actor := public.f14_payment_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'record_correction',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_direction not in ('increase','decrease')
     or p_amount_minor is null
     or p_amount_minor not between 1 and 100000000
     or v_reason is null
     or char_length(v_reason) > 240 then
    raise exception 'INVALID_CORRECTION';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id
    and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;

  select * into v_source
  from public.ticket_payment_events e
  where e.business_id = p_business_id
    and e.ticket_id = p_ticket_id
    and e.id = p_source_payment_event_id
    and e.event_type = 'payment'
  for update;
  if v_source.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;

  v_before := public.f14_ticket_projection(p_business_id, p_ticket_id);
  v_source_net := public.f14_source_payment_net(
    p_business_id, p_ticket_id, p_source_payment_event_id
  );

  if p_direction = 'increase'
     and (v_before->>'paidMinor')::bigint + p_amount_minor::bigint
       > (v_before->>'totalMinor')::bigint then
    raise exception 'OVERPAYMENT';
  end if;

  if p_direction = 'decrease' and p_amount_minor::bigint > v_source_net then
    raise exception 'SOURCE_PAYMENT_NEGATIVE';
  end if;

  insert into public.ticket_payment_events(
    business_id, ticket_id, event_type, source_payment_event_id,
    payment_method, correction_direction, amount_minor, reason,
    actor_membership_id
  ) values (
    p_business_id, p_ticket_id, 'correction', p_source_payment_event_id,
    v_source.payment_method, p_direction, p_amount_minor, v_reason,
    v_actor.id
  );

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'record_correction',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f14correction$;

create or replace function public.record_ticket_refund_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_source_payment_event_id uuid,
  p_amount_minor integer,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f14refund$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_source public.ticket_payment_events;
  v_replay jsonb;
  v_result jsonb;
  v_reason text;
  v_source_net bigint;
begin
  v_actor := public.f14_payment_actor(p_business_id);
  v_replay := public.f14_claim_ticket_command(
    p_business_id, v_actor.id, 'record_refund',
    p_idempotency_key, p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_amount_minor is null
     or p_amount_minor not between 1 and 100000000
     or v_reason is null
     or char_length(v_reason) > 240 then
    raise exception 'INVALID_REFUND';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id
    and t.id = p_ticket_id
  for update;
  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;

  select * into v_source
  from public.ticket_payment_events e
  where e.business_id = p_business_id
    and e.ticket_id = p_ticket_id
    and e.id = p_source_payment_event_id
    and e.event_type = 'payment'
  for update;
  if v_source.id is null then raise exception 'SOURCE_PAYMENT_NOT_FOUND'; end if;

  v_source_net := public.f14_source_payment_net(
    p_business_id, p_ticket_id, p_source_payment_event_id
  );
  if p_amount_minor::bigint > v_source_net then
    raise exception 'REFUND_EXCEEDS_SOURCE';
  end if;

  insert into public.ticket_payment_events(
    business_id, ticket_id, event_type, source_payment_event_id,
    payment_method, correction_direction, amount_minor, reason,
    actor_membership_id
  ) values (
    p_business_id, p_ticket_id, 'refund', p_source_payment_event_id,
    v_source.payment_method, null, p_amount_minor, v_reason,
    v_actor.id
  );

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  perform public.f14_finish_ticket_command(
    p_business_id, v_actor.id, 'record_refund',
    p_idempotency_key, p_ticket_id, v_result
  );
  return v_result;
end
$f14refund$;

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
as $f14discount$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_line public.ticket_lines;
  v_reason text;
  v_replay jsonb;
  v_result jsonb;
  v_paid bigint;
  v_current_total bigint;
  v_new_total bigint;
  v_unfinalized integer;
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

  select
    count(*) filter (where l.final_unit_price_minor is null)::integer,
    coalesce(sum(
      case
        when l.final_unit_price_minor is null then 0::bigint
        else l.final_unit_price_minor::bigint - l.discount_minor::bigint
      end
    ), 0::bigint)
  into v_unfinalized, v_current_total
  from public.ticket_lines l
  where l.business_id = p_business_id
    and l.ticket_id = p_ticket_id;

  v_paid := public.f14_ticket_paid_minor(p_business_id, p_ticket_id);
  if v_paid > 0 and v_unfinalized > 0 then
    raise exception 'FINANCIAL_INVARIANT_BROKEN';
  end if;

  v_new_total := v_current_total + v_line.discount_minor::bigint - p_discount_minor::bigint;
  if v_new_total < v_paid then
    raise exception 'TICKET_TOTAL_BELOW_PAID';
  end if;

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
$f14discount$;

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
as $f14close$
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
  where business_id = p_business_id
    and ticket_id = p_ticket_id;

  if v_count < 1 then raise exception 'TICKET_EMPTY'; end if;
  if v_unfinalized > 0 then raise exception 'SERVICE_PRICE_NOT_FINAL'; end if;

  v_result := public.f14_ticket_projection(p_business_id, p_ticket_id);
  if (v_result->>'balanceMinor')::bigint <> 0 then
    raise exception 'TICKET_BALANCE_REMAINS';
  end if;

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
$f14close$;

create or replace function public.f14_guard_payment_event_change()
returns trigger
language plpgsql
set search_path = ''
as $f14eventguard$
begin
  if tg_op = 'UPDATE' then
    raise exception 'PAYMENT_EVENT_IMMUTABLE';
  end if;
  raise exception 'PAYMENT_EVENT_DELETE_FORBIDDEN';
end
$f14eventguard$;

revoke all on function public.f14_guard_payment_event_change()
from public, anon, authenticated;

drop trigger if exists ticket_payment_events_update_guard on public.ticket_payment_events;
create trigger ticket_payment_events_update_guard
before update on public.ticket_payment_events
for each row execute function public.f14_guard_payment_event_change();

drop trigger if exists ticket_payment_events_delete_guard on public.ticket_payment_events;
create trigger ticket_payment_events_delete_guard
before delete on public.ticket_payment_events
for each row execute function public.f14_guard_payment_event_change();

create or replace function public.f14_guard_ticket_line_insert_after_payment()
returns trigger
language plpgsql
set search_path = ''
as $f14lineinsert$
begin
  if exists (
    select 1
    from public.ticket_payment_events e
    where e.business_id = new.business_id
      and e.ticket_id = new.ticket_id
  ) then
    raise exception 'TICKET_HAS_FINANCIAL_EVENTS';
  end if;
  return new;
end
$f14lineinsert$;

revoke all on function public.f14_guard_ticket_line_insert_after_payment()
from public, anon, authenticated;

drop trigger if exists ticket_lines_f14_payment_insert_guard on public.ticket_lines;
create trigger ticket_lines_f14_payment_insert_guard
before insert on public.ticket_lines
for each row execute function public.f14_guard_ticket_line_insert_after_payment();

revoke all on function public.record_ticket_payment_guarded(uuid,uuid,text,integer,text,text)
from public, anon, authenticated;
revoke all on function public.record_ticket_correction_guarded(uuid,uuid,uuid,text,integer,text,text,text)
from public, anon, authenticated;
revoke all on function public.record_ticket_refund_guarded(uuid,uuid,uuid,integer,text,text,text)
from public, anon, authenticated;

grant execute on function public.record_ticket_payment_guarded(uuid,uuid,text,integer,text,text)
to authenticated;
grant execute on function public.record_ticket_correction_guarded(uuid,uuid,uuid,text,integer,text,text,text)
to authenticated;
grant execute on function public.record_ticket_refund_guarded(uuid,uuid,uuid,integer,text,text,text)
to authenticated;

commit;
