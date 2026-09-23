begin;

-- F13-02: add an explicit business-local date range to the appointment page
-- contract without weakening the F13-01 revision-bound continuation guarantee.
create or replace function public.list_appointments_page_v3(
  p_business_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null,
  p_expected_revision uuid default null,
  p_start_date date default null,
  p_end_date date default null
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
  updated_at timestamptz,
  page_revision uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
set statement_timeout = '5s'
as $$
declare
  v_revision uuid;
  v_timezone text;
  v_from timestamptz;
  v_to timestamptz;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE_LIMIT';
  end if;
  if (p_after_starts_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;
  if (p_after_starts_at is null) <> (p_expected_revision is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;
  if (p_start_date is null) <> (p_end_date is null) then
    raise exception 'INVALID_PAGE_RANGE';
  end if;
  if p_start_date is not null then
    if p_end_date <= p_start_date then
      raise exception 'INVALID_PAGE_RANGE';
    end if;
    select b.timezone into v_timezone
    from public.businesses b
    where b.id = p_business_id;
    if v_timezone is null then
      raise exception 'BUSINESS_NOT_FOUND';
    end if;
    v_from := p_start_date::timestamp at time zone v_timezone;
    v_to := p_end_date::timestamp at time zone v_timezone;
  end if;

  insert into private.appointment_page_revisions(business_id)
  values (p_business_id)
  on conflict on constraint appointment_page_revisions_pkey do nothing;

  select r.revision
    into v_revision
  from private.appointment_page_revisions r
  where r.business_id = p_business_id
  for share;

  if p_expected_revision is not null
     and p_expected_revision is distinct from v_revision then
    raise exception 'STALE_APPOINTMENT_PAGE';
  end if;

  return query
  select
    a.id,a.business_id,a.customer_id,a.service_id,a.staff_id,a.status,
    a.starts_at,a.ends_at,a.timezone,
    a.customer_name_snapshot,a.customer_phone_snapshot,a.customer_email_snapshot,
    a.service_name_snapshot,a.staff_name_snapshot,a.price_minor_snapshot,
    a.currency_snapshot,a.notes,a.cancellation_reason,a.created_at,a.updated_at,
    v_revision
  from public.appointments a
  where a.business_id = p_business_id
    and (
      v_from is null
      or (a.starts_at >= v_from and a.starts_at < v_to)
    )
    and (
      p_after_starts_at is null
      or (a.starts_at, a.id) > (p_after_starts_at, p_after_id)
    )
  order by a.starts_at, a.id
  limit p_limit;
end
$$;

-- v3 is the only browser/Worker authority after this cutover. Keeping the old
-- function object is harmless for migration history, but its executable surface
-- must be closed so PostgREST cannot bypass the range-aware contract.
revoke all on function public.list_appointments_page_v2(uuid,integer,timestamptz,uuid,uuid)
  from public, anon, authenticated;

revoke all on function public.list_appointments_page_v3(uuid,integer,timestamptz,uuid,uuid,date,date)
  from public, anon, authenticated;
grant execute on function public.list_appointments_page_v3(uuid,integer,timestamptz,uuid,uuid,date,date)
  to authenticated;

commit;
