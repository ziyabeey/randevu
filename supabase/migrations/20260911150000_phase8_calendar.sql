begin;

-- Phase 8: operator calendar read surface.
-- Calendar is a projection over existing appointments, not a new booking model.
-- The RPC accepts a business-local date and converts exact local-midnight
-- boundaries with the business IANA timezone before reading appointments.

create or replace function public.get_calendar_appointments(
  p_business_id uuid,
  p_start_date date,
  p_days integer default 1,
  p_staff_id uuid default null
)
returns table(
  appointment_id uuid,
  staff_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  customer_name text,
  customer_phone text,
  customer_email text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  notes text,
  cancellation_reason text,
  source text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_start_date is null or p_days is null or p_days < 1 or p_days > 7 then
    raise exception 'INVALID_CALENDAR_RANGE';
  end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id = p_business_id;

  if v_timezone is null then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;

  v_from := p_start_date::timestamp at time zone v_timezone;
  v_to := (p_start_date + p_days)::timestamp at time zone v_timezone;

  return query
  select
    a.id,
    a.staff_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.timezone,
    a.customer_name_snapshot,
    a.customer_phone_snapshot,
    a.customer_email_snapshot,
    a.service_name_snapshot,
    a.staff_name_snapshot,
    a.price_minor_snapshot,
    a.currency_snapshot,
    a.notes,
    a.cancellation_reason,
    a.source
  from public.appointments a
  where a.business_id = p_business_id
    and a.starts_at >= v_from
    and a.starts_at < v_to
    and (p_staff_id is null or a.staff_id = p_staff_id)
  order by a.starts_at, a.staff_name_snapshot, a.id;
end
$$;

revoke all on function public.get_calendar_appointments(uuid,date,integer,uuid) from public;
grant execute on function public.get_calendar_appointments(uuid,date,integer,uuid) to authenticated;

commit;
