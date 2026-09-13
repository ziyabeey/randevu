begin;

-- S07 C2a: list endpoints page by stable keys instead of silently truncating.
-- Calendar remains a complete bounded date/staff range and gets a DB safety
-- timeout without changing its result semantics.

create index if not exists appointments_business_page_idx
  on public.appointments (business_id, starts_at, id);

create index if not exists appointment_events_page_idx
  on public.appointment_events (business_id, appointment_id, created_at, id);

create or replace function public.list_appointments_page(
  p_business_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  id uuid,
  business_id uuid,
  customer_id uuid,
  service_id uuid,
  staff_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  customer_name_snapshot text,
  customer_phone_snapshot text,
  customer_email_snapshot text,
  service_name_snapshot text,
  staff_name_snapshot text,
  price_minor_snapshot integer,
  currency_snapshot text,
  notes text,
  cancellation_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE_LIMIT';
  end if;
  if (p_after_starts_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;

  return query
  select
    a.id,a.business_id,a.customer_id,a.service_id,a.staff_id,a.status,
    a.starts_at,a.ends_at,a.timezone,
    a.customer_name_snapshot,a.customer_phone_snapshot,a.customer_email_snapshot,
    a.service_name_snapshot,a.staff_name_snapshot,a.price_minor_snapshot,
    a.currency_snapshot,a.notes,a.cancellation_reason,a.created_at,a.updated_at
  from public.appointments a
  where a.business_id = p_business_id
    and (
      p_after_starts_at is null
      or (a.starts_at, a.id) > (p_after_starts_at, p_after_id)
    )
  order by a.starts_at, a.id
  limit p_limit;
end
$$;

revoke all on function public.list_appointments_page(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.list_appointments_page(uuid,integer,timestamptz,uuid)
  to authenticated;

create or replace function public.list_appointment_events_page(
  p_business_id uuid,
  p_appointment_id uuid,
  p_limit integer default 26,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  id uuid,
  event_type text,
  actor_user_id uuid,
  from_status text,
  to_status text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE_LIMIT';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.business_id = p_business_id and a.id = p_appointment_id
  ) then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  return query
  select e.id,e.event_type,e.actor_user_id,e.from_status,e.to_status,e.payload,e.created_at
  from public.appointment_events e
  where e.business_id = p_business_id
    and e.appointment_id = p_appointment_id
    and (
      p_after_created_at is null
      or (e.created_at, e.id) > (p_after_created_at, p_after_id)
    )
  order by e.created_at, e.id
  limit p_limit;
end
$$;

revoke all on function public.list_appointment_events_page(uuid,uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.list_appointment_events_page(uuid,uuid,integer,timestamptz,uuid)
  to authenticated;

-- Calendar is already bounded by business-local date (1 or 7 days) and optional
-- staff. Do not add row truncation: a busy valid range must be complete.
alter function public.get_calendar_appointments(uuid,date,integer,uuid)
  set statement_timeout = '5s';

commit;
