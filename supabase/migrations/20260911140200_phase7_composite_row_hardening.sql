begin;

-- PostgreSQL composite variables must receive the appointment row as one value.
-- Using a.* expands the row into individual columns and breaks assignment when
-- additional scalar settings are selected beside it.
create or replace function public.compute_public_management_slots(
  p_token text,
  p_date date,
  p_staff_id uuid default null
)
returns table(
  staff_id uuid,
  staff_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_current public.appointments;
  v_business_timezone text;
  v_min_notice_minutes integer;
  v_horizon_days integer;
  v_step_minutes integer;
  v_today date;
begin
  v_hash := public.management_token_hash(p_token);

  select a, b.timezone, pbs.min_notice_minutes, pbs.horizon_days, pbs.step_minutes
  into v_current, v_business_timezone, v_min_notice_minutes, v_horizon_days, v_step_minutes
  from public.appointment_management_capabilities cap
  join public.appointments a
    on a.business_id = cap.business_id
   and a.id = cap.appointment_id
  join public.businesses b on b.id = a.business_id
  join public.public_booking_settings pbs on pbs.business_id = b.id
  where cap.token_hash = v_hash
    and cap.revoked_at is null
  limit 1;

  if v_current.id is null then
    raise exception 'MANAGEMENT_NOT_FOUND';
  end if;
  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;

  v_today := (now() at time zone v_business_timezone)::date;
  if p_date < v_today or p_date > v_today + v_horizon_days then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  return query
  with eligible_staff as (
    select sp.id, sp.name
    from public.staff_profiles sp
    join public.staff_services ss
      on ss.business_id = sp.business_id
     and ss.staff_id = sp.id
     and ss.service_id = v_current.service_id
     and ss.active
    where sp.business_id = v_current.business_id
      and sp.active
      and (p_staff_id is null or sp.id = p_staff_id)
  ),
  local_windows as (
    select
      es.id as staff_id,
      es.name as staff_name,
      greatest(bh.starts_local, sh.starts_local) as local_start,
      least(bh.ends_local, sh.ends_local) as local_end
    from eligible_staff es
    join public.business_hours bh
      on bh.business_id = v_current.business_id
     and bh.weekday = extract(dow from p_date)::smallint
     and bh.active
    join public.staff_hours sh
      on sh.business_id = v_current.business_id
     and sh.staff_id = es.id
     and sh.weekday = extract(dow from p_date)::smallint
     and sh.active
    where greatest(bh.starts_local, sh.starts_local) < least(bh.ends_local, sh.ends_local)
  ),
  absolute_windows as (
    select
      lw.*,
      (p_date + lw.local_start) at time zone v_business_timezone as window_start,
      (p_date + lw.local_end) at time zone v_business_timezone as window_end
    from local_windows lw
  ),
  candidate_slots as (
    select
      aw.staff_id,
      aw.staff_name,
      gs as service_start,
      gs + make_interval(mins => v_current.duration_minutes_snapshot) as service_end,
      gs - make_interval(mins => v_current.buffer_before_minutes_snapshot) as occupied_start,
      gs + make_interval(
        mins => v_current.duration_minutes_snapshot + v_current.buffer_after_minutes_snapshot
      ) as occupied_end
    from absolute_windows aw
    cross join lateral generate_series(
      aw.window_start + make_interval(mins => v_current.buffer_before_minutes_snapshot),
      aw.window_end - make_interval(
        mins => v_current.duration_minutes_snapshot + v_current.buffer_after_minutes_snapshot
      ),
      make_interval(mins => v_step_minutes)
    ) gs
    where aw.window_start < aw.window_end
  )
  select distinct
    cs.staff_id,
    cs.staff_name,
    cs.service_start,
    cs.service_end,
    v_business_timezone
  from candidate_slots cs
  where cs.service_start >= now() + make_interval(mins => v_min_notice_minutes)
    and not exists (
      select 1
      from public.availability_blocks ab
      where ab.business_id = v_current.business_id
        and ab.active
        and (ab.staff_id is null or ab.staff_id = cs.staff_id)
        and ab.starts_at < cs.occupied_end
        and ab.ends_at > cs.occupied_start
    )
    and not exists (
      select 1
      from public.appointments a
      where a.business_id = v_current.business_id
        and a.staff_id = cs.staff_id
        and a.id <> v_current.id
        and a.status <> 'cancelled'
        and a.occupied_starts_at < cs.occupied_end
        and a.occupied_ends_at > cs.occupied_start
    )
  order by cs.service_start, cs.staff_name, cs.staff_id;
end
$$;

create or replace function public.reschedule_public_managed_appointment(
  p_token text,
  p_idempotency_key text,
  p_staff_id uuid,
  p_starts_at timestamptz
)
returns table(
  appointment_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash_token text;
  v_current public.appointments;
  v_staff public.staff_profiles;
  v_business_timezone text;
  v_min_notice_minutes integer;
  v_horizon_days integer;
  v_date date;
  v_today date;
  v_hash text;
  v_claim record;
  v_row public.appointments;
  v_old_starts_at timestamptz;
  v_old_staff_id uuid;
  v_old_timezone text;
begin
  v_hash_token := public.management_token_hash(p_token);

  select a, b.timezone, pbs.min_notice_minutes, pbs.horizon_days
  into v_current, v_business_timezone, v_min_notice_minutes, v_horizon_days
  from public.appointment_management_capabilities cap
  join public.appointments a
    on a.business_id = cap.business_id
   and a.id = cap.appointment_id
  join public.businesses b on b.id = a.business_id
  join public.public_booking_settings pbs on pbs.business_id = b.id
  where cap.token_hash = v_hash_token
    and cap.revoked_at is null
  limit 1;

  if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  v_hash := md5(jsonb_build_object(
    'source', 'public_manage',
    'appointmentId', v_current.id,
    'staffId', p_staff_id,
    'startsAt', p_starts_at
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    v_current.business_id, p_idempotency_key, 'public_reschedule', v_hash, v_current.id
  );

  if not v_claim.is_new then
    select * into v_row
    from public.appointments a
    where a.business_id = v_current.business_id and a.id = v_claim.appointment_id;
    if v_row.id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return query select
      v_row.id, v_row.status, v_row.starts_at, v_row.ends_at, v_row.timezone,
      v_row.service_name_snapshot, v_row.staff_name_snapshot,
      v_row.price_minor_snapshot, v_row.currency_snapshot;
    return;
  end if;

  select * into v_current
  from public.appointments a
  where a.business_id = v_current.business_id and a.id = v_current.id
  for update;

  if v_current.status not in ('scheduled','confirmed') or v_current.starts_at <= now() then
    raise exception 'APPOINTMENT_NOT_MANAGEABLE';
  end if;
  if p_starts_at is null then raise exception 'INVALID_START'; end if;

  select sp.* into v_staff
  from public.staff_profiles sp
  join public.staff_services ss
    on ss.business_id = sp.business_id
   and ss.staff_id = sp.id
   and ss.service_id = v_current.service_id
   and ss.active
  where sp.business_id = v_current.business_id
    and sp.id = p_staff_id
    and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  v_today := (now() at time zone v_business_timezone)::date;
  v_date := (p_starts_at at time zone v_business_timezone)::date;
  if v_date < v_today or v_date > v_today + v_horizon_days then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;
  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  if not exists (
    select 1
    from public.compute_public_management_slots(p_token, v_date, p_staff_id) s
    where s.staff_id = p_staff_id and s.starts_at = p_starts_at
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  v_old_starts_at := v_current.starts_at;
  v_old_staff_id := v_current.staff_id;
  v_old_timezone := v_current.timezone;

  begin
    update public.appointments
    set staff_id = p_staff_id,
        staff_name_snapshot = v_staff.name,
        starts_at = p_starts_at,
        ends_at = p_starts_at + make_interval(mins => v_current.duration_minutes_snapshot),
        occupied_starts_at = p_starts_at - make_interval(mins => v_current.buffer_before_minutes_snapshot),
        occupied_ends_at = p_starts_at + make_interval(
          mins => v_current.duration_minutes_snapshot + v_current.buffer_after_minutes_snapshot
        ),
        timezone = v_business_timezone
    where business_id = v_current.business_id and id = v_current.id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, actor_type,
    from_status, to_status, payload
  ) values (
    v_current.business_id, v_current.id, 'rescheduled', null, 'public',
    v_current.status, v_current.status,
    jsonb_build_object(
      'source', 'public_manage',
      'oldStartsAt', v_old_starts_at,
      'newStartsAt', v_row.starts_at,
      'oldStaffId', v_old_staff_id,
      'newStaffId', v_row.staff_id,
      'oldTimezone', v_old_timezone,
      'newTimezone', v_row.timezone
    )
  );

  return query select
    v_row.id, v_row.status, v_row.starts_at, v_row.ends_at, v_row.timezone,
    v_row.service_name_snapshot, v_row.staff_name_snapshot,
    v_row.price_minor_snapshot, v_row.currency_snapshot;
end
$$;

commit;
