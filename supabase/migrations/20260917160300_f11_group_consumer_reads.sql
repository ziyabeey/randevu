begin;

-- F11-03 additive read projections. The legacy RPCs remain untouched for
-- compatibility; live workers move to v2 so every physical service line carries
-- its reservation-group identity/version instead of looking like N unrelated
-- appointments.

create or replace function public.get_calendar_appointments_v2(
  p_business_id uuid,
  p_start_date date,
  p_days integer default 1,
  p_staff_id uuid default null
)
returns table(
  appointment_id uuid,
  group_id uuid,
  line_ordinal smallint,
  group_status text,
  group_version integer,
  group_legacy_appointment_id uuid,
  group_line_count integer,
  group_starts_at timestamptz,
  group_ends_at timestamptz,
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
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_start_date is null or p_days is null or p_days < 1 or p_days > 7 then
    raise exception 'INVALID_CALENDAR_RANGE';
  end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_from := p_start_date::timestamp at time zone v_timezone;
  v_to := (p_start_date+p_days)::timestamp at time zone v_timezone;

  return query
  with scoped as (
    select
      a.*,
      count(*) over(partition by a.business_id,a.group_id)::integer as group_line_count,
      min(a.starts_at) over(partition by a.business_id,a.group_id) as group_starts_at,
      max(a.ends_at) over(partition by a.business_id,a.group_id) as group_ends_at
    from public.appointments a
    where a.business_id=p_business_id
  )
  select
    a.id,
    a.group_id,
    a.line_ordinal,
    g.status,
    g.version,
    g.legacy_appointment_id,
    a.group_line_count,
    a.group_starts_at,
    a.group_ends_at,
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
  from scoped a
  join public.appointment_groups g
    on g.business_id=a.business_id and g.id=a.group_id
  where a.starts_at>=v_from
    and a.starts_at<v_to
    and (p_staff_id is null or a.staff_id=p_staff_id)
  order by a.group_starts_at,a.line_ordinal,a.staff_name_snapshot,a.id;
end
$$;

revoke all on function public.get_calendar_appointments_v2(uuid,date,integer,uuid)
  from public, anon, authenticated;
grant execute on function public.get_calendar_appointments_v2(uuid,date,integer,uuid)
  to authenticated;

create or replace function public.list_business_customer_appointments_page_v2(
  p_business_id uuid,
  p_customer_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  appointment_id uuid,
  group_id uuid,
  line_ordinal smallint,
  group_status text,
  group_version integer,
  group_legacy_appointment_id uuid,
  group_line_count integer,
  group_starts_at timestamptz,
  group_ends_at timestamptz,
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
  cancellation_reason text
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>101 then raise exception 'INVALID_PAGE'; end if;
  if (p_after_starts_at is null)<>(p_after_id is null) then raise exception 'INVALID_PAGE'; end if;
  if not exists (
    select 1 from public.customers c
    where c.business_id=p_business_id and c.id=p_customer_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  return query
  with scoped as (
    select
      a.*,
      count(*) over(partition by a.business_id,a.group_id)::integer as group_line_count,
      min(a.starts_at) over(partition by a.business_id,a.group_id) as group_starts_at,
      max(a.ends_at) over(partition by a.business_id,a.group_id) as group_ends_at
    from public.appointments a
    where a.business_id=p_business_id
  )
  select
    a.id,
    a.group_id,
    a.line_ordinal,
    g.status,
    g.version,
    g.legacy_appointment_id,
    a.group_line_count,
    a.group_starts_at,
    a.group_ends_at,
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
    a.cancellation_reason
  from scoped a
  join public.appointment_groups g
    on g.business_id=a.business_id and g.id=a.group_id
  where a.customer_id=p_customer_id
    and (
      p_after_starts_at is null
      or (a.starts_at,a.id)<(p_after_starts_at,p_after_id)
    )
  order by a.starts_at desc,a.id desc
  limit p_limit;
end
$$;

revoke all on function public.list_business_customer_appointments_page_v2(uuid,uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.list_business_customer_appointments_page_v2(uuid,uuid,integer,timestamptz,uuid)
  to authenticated;

commit;
