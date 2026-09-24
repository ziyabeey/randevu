begin;

-- F15-04: read-only cash/day report over accepted append-only authorities.
-- One STABLE RPC call keeps all report components on the same statement snapshot.
create index if not exists ticket_payment_events_business_created_idx
  on public.ticket_payment_events(business_id,created_at,id);

create index if not exists tickets_business_created_idx
  on public.tickets(business_id,created_at,id);

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
as $f1504$
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
        ),0)::bigint - coalesce(rv.returned_minor,0),
        0
      )::bigint as expected_min_minor,
      greatest(
        coalesce(sum(
          l.price_max_minor_snapshot::bigint*l.quantity::bigint-l.discount_minor::bigint
        ),0)::bigint - coalesce(rv.returned_minor,0),
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
      coalesce(pa.paid_minor,0)::bigint as paid_minor
    from ticket_scope ts
    join public.ticket_lines l
      on l.business_id=ts.business_id and l.ticket_id=ts.id
    left join return_value rv on rv.ticket_id=ts.id
    left join payment_all_time pa on pa.ticket_id=ts.id
    group by ts.id,rv.returned_minor,pa.paid_minor
  ),
  sale as (
    select
      coalesce(sum(tr.expected_min_minor),0)::bigint as expected_min_minor,
      coalesce(sum(tr.expected_max_minor),0)::bigint as expected_max_minor,
      coalesce(sum(case when tr.settled then tr.service_minor else 0 end),0)::bigint as service_minor,
      coalesce(sum(case when tr.settled then tr.product_minor else 0 end),0)::bigint as product_minor,
      coalesce(sum(case when tr.settled then
        greatest(tr.service_minor+tr.product_minor-tr.paid_minor,0)
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
    'saleValueMinor',s.service_minor+s.product_minor,
    'outstandingMinor',s.outstanding_minor,
    'ticketCount',s.ticket_count,
    'unsettledTicketCount',s.unsettled_ticket_count
  )
  into v_result
  from payment p cross join expense e cross join appointment_expected a cross join sale s;

  return v_result;
end
$f1504$;

revoke all on function public.get_financial_day_report(uuid,date,date)
from public, anon, authenticated;
grant execute on function public.get_financial_day_report(uuid,date,date)
to authenticated;

commit;
