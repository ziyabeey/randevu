begin;

-- Phase 5 hardening:
-- 1) idempotent create is resolved before mutable catalog validation;
-- 2) reschedule uses the appointment's duration/buffer snapshots even if the
--    service is later edited or deactivated;
-- 3) reschedule adopts the business's current timezone while preserving the
--    previous timezone in the audit delta;
-- 4) lifecycle transitions are enforced at the database boundary.

create or replace function public.compute_reschedule_slots(
  p_business_id uuid,
  p_appointment_id uuid,
  p_date date,
  p_staff_id uuid default null,
  p_step_minutes integer default 15
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
  v_current public.appointments;
  v_business_timezone text;
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_step_minutes < 5 or p_step_minutes > 120 then
    raise exception 'INVALID_STEP';
  end if;
  if p_date < current_date - 1 or p_date > current_date + 366 then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  select * into v_current
  from public.appointments
  where business_id = p_business_id and id = p_appointment_id;

  if v_current.id is null then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;
  if v_current.status not in ('scheduled','confirmed') then
    raise exception 'APPOINTMENT_NOT_RESCHEDULABLE';
  end if;

  select b.timezone into v_business_timezone
  from public.businesses b
  where b.id = p_business_id;
  if v_business_timezone is null then
    raise exception 'BUSINESS_NOT_FOUND';
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
    where sp.business_id = p_business_id
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
      on bh.business_id = p_business_id
     and bh.weekday = extract(dow from p_date)::smallint
     and bh.active
    join public.staff_hours sh
      on sh.business_id = p_business_id
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
      make_interval(mins => p_step_minutes)
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
  where not exists (
    select 1
    from public.availability_blocks ab
    where ab.business_id = p_business_id
      and ab.active
      and (ab.staff_id is null or ab.staff_id = cs.staff_id)
      and ab.starts_at < cs.occupied_end
      and ab.ends_at > cs.occupied_start
  )
  and not exists (
    select 1
    from public.appointments a
    where a.business_id = p_business_id
      and a.staff_id = cs.staff_id
      and a.id <> p_appointment_id
      and a.status <> 'cancelled'
      and a.occupied_starts_at < cs.occupied_end
      and a.occupied_ends_at > cs.occupied_start
  )
  order by cs.service_start, cs.staff_name, cs.staff_id;
end
$$;

create or replace function public.create_appointment(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_service_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service public.services;
  v_staff public.staff_profiles;
  v_timezone text;
  v_customer_id uuid;
  v_customer_name text := trim(p_customer_name);
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_customer_email text := nullif(lower(trim(p_customer_email)), '');
  v_notes text := nullif(trim(p_notes), '');
  v_hash text;
  v_claim record;
  v_row public.appointments;
  v_date date;
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_customer_email is not null and (char_length(v_customer_email) > 254 or position('@' in v_customer_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  v_hash := md5(jsonb_build_object(
    'customerName', v_customer_name,
    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,
    'serviceId', p_service_id,
    'staffId', p_staff_id,
    'startsAt', p_starts_at,
    'notes', v_notes
  )::text);

  select * into v_claim
  from public.claim_booking_command(p_business_id, p_idempotency_key, 'create', v_hash, null);

  if not v_claim.is_new then
    select * into v_row
    from public.appointments
    where business_id = p_business_id and id = v_claim.appointment_id;
    if v_row.id is null then
      raise exception 'IDEMPOTENCY_RESULT_MISSING';
    end if;
    return v_row;
  end if;

  -- Mutable catalog checks happen after the idempotency claim so an exact retry
  -- still returns its committed result even if the service/staff was deactivated later.
  select * into v_service
  from public.services
  where business_id = p_business_id and id = p_service_id and active;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;

  select sp.* into v_staff
  from public.staff_profiles sp
  join public.staff_services ss
    on ss.business_id = sp.business_id
   and ss.staff_id = sp.id
   and ss.service_id = p_service_id
   and ss.active
  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  select timezone into v_timezone
  from public.businesses where id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_date := (p_starts_at at time zone v_timezone)::date;
  if not exists (
    select 1
    from public.compute_availability_slots_internal(
      p_business_id, p_service_id, v_date, p_staff_id, 5, null
    ) s
    where s.staff_id = p_staff_id and s.starts_at = p_starts_at
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  select c.id into v_customer_id
  from public.customers c
  where c.business_id = p_business_id
    and (
      (v_customer_phone is not null and c.phone is not null
        and regexp_replace(c.phone, '[^0-9]+', '', 'g') = regexp_replace(v_customer_phone, '[^0-9]+', '', 'g'))
      or
      (v_customer_email is not null and c.email is not null and lower(trim(c.email)) = v_customer_email)
    )
  order by c.updated_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers(business_id, name, phone, email, created_by)
    values(p_business_id, v_customer_name, v_customer_phone, v_customer_email, auth.uid())
    returning id into v_customer_id;
  else
    update public.customers
    set name = v_customer_name,
        phone = coalesce(v_customer_phone, phone),
        email = coalesce(v_customer_email, email)
    where business_id = p_business_id and id = v_customer_id;
  end if;

  begin
    insert into public.appointments(
      business_id, customer_id, service_id, staff_id, status,
      starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      service_name_snapshot, staff_name_snapshot,
      duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      price_minor_snapshot, currency_snapshot, notes, created_by
    ) values (
      p_business_id, v_customer_id, p_service_id, p_staff_id, 'scheduled',
      p_starts_at,
      p_starts_at + make_interval(mins => v_service.duration_minutes),
      p_starts_at - make_interval(mins => v_service.buffer_before_minutes),
      p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes),
      v_timezone,
      v_customer_name, v_customer_phone, v_customer_email,
      v_service.name, v_staff.name,
      v_service.duration_minutes, v_service.buffer_before_minutes, v_service.buffer_after_minutes,
      v_service.price_minor, v_service.currency, v_notes, auth.uid()
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, from_status, to_status, payload
  ) values (
    p_business_id, v_row.id, 'created', auth.uid(), null, 'scheduled',
    jsonb_build_object('startsAt', v_row.starts_at, 'staffId', v_row.staff_id, 'serviceId', v_row.service_id)
  );

  update public.booking_commands
  set appointment_id = v_row.id
  where business_id = p_business_id and idempotency_key = p_idempotency_key;

  return v_row;
end
$$;

create or replace function public.reschedule_appointment(
  p_business_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_staff_id uuid,
  p_starts_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.appointments;
  v_staff public.staff_profiles;
  v_timezone text;
  v_hash text;
  v_claim record;
  v_row public.appointments;
  v_date date;
  v_old_starts_at timestamptz;
  v_old_staff_id uuid;
  v_old_timezone text;
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  v_hash := md5(jsonb_build_object(
    'appointmentId', p_appointment_id,
    'staffId', p_staff_id,
    'startsAt', p_starts_at
  )::text);

  select * into v_claim
  from public.claim_booking_command(p_business_id, p_idempotency_key, 'reschedule', v_hash, p_appointment_id);
  if not v_claim.is_new then
    select * into v_row from public.appointments
    where business_id = p_business_id and id = v_claim.appointment_id;
    if v_row.id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_row;
  end if;

  select * into v_current
  from public.appointments
  where business_id = p_business_id and id = p_appointment_id
  for update;

  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_current.status not in ('scheduled','confirmed') then
    raise exception 'APPOINTMENT_NOT_RESCHEDULABLE';
  end if;

  select sp.* into v_staff
  from public.staff_profiles sp
  join public.staff_services ss
    on ss.business_id = sp.business_id
   and ss.staff_id = sp.id
   and ss.service_id = v_current.service_id
   and ss.active
  where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_date := (p_starts_at at time zone v_timezone)::date;
  if not exists (
    select 1
    from public.compute_reschedule_slots(
      p_business_id, p_appointment_id, v_date, p_staff_id, 5
    ) s
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
        timezone = v_timezone
    where business_id = p_business_id and id = p_appointment_id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, from_status, to_status, payload
  ) values (
    p_business_id, p_appointment_id, 'rescheduled', auth.uid(), v_current.status, v_current.status,
    jsonb_build_object(
      'oldStartsAt', v_old_starts_at,
      'newStartsAt', v_row.starts_at,
      'oldStaffId', v_old_staff_id,
      'newStaffId', v_row.staff_id,
      'oldTimezone', v_old_timezone,
      'newTimezone', v_row.timezone
    )
  );

  return v_row;
end
$$;

create or replace function public.set_appointment_status(
  p_business_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_status text,
  p_reason text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.appointments;
  v_hash text;
  v_claim record;
  v_row public.appointments;
  v_reason text := nullif(trim(p_reason), '');
begin
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_status not in ('confirmed','completed','no_show','cancelled') then
    raise exception 'INVALID_STATUS';
  end if;
  if v_reason is not null and char_length(v_reason) > 240 then
    raise exception 'REASON_TOO_LONG';
  end if;

  v_hash := md5(jsonb_build_object(
    'appointmentId', p_appointment_id,
    'status', p_status,
    'reason', v_reason
  )::text);

  select * into v_claim
  from public.claim_booking_command(p_business_id, p_idempotency_key, 'status', v_hash, p_appointment_id);
  if not v_claim.is_new then
    select * into v_row from public.appointments
    where business_id = p_business_id and id = v_claim.appointment_id;
    if v_row.id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return v_row;
  end if;

  select * into v_current
  from public.appointments
  where business_id = p_business_id and id = p_appointment_id
  for update;

  if v_current.id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if v_current.status = p_status then return v_current; end if;

  if v_current.status = 'scheduled' and p_status not in ('confirmed','cancelled') then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;
  if v_current.status = 'confirmed' and p_status not in ('completed','no_show','cancelled') then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;
  if v_current.status in ('cancelled','completed','no_show') then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  update public.appointments
  set status = p_status,
      cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when p_status = 'cancelled' then auth.uid() else cancelled_by end,
      cancellation_reason = case when p_status = 'cancelled' then v_reason else cancellation_reason end
  where business_id = p_business_id and id = p_appointment_id
  returning * into v_row;

  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, from_status, to_status, payload
  ) values (
    p_business_id, p_appointment_id, p_status, auth.uid(), v_current.status, p_status,
    case when p_status = 'cancelled' then jsonb_build_object('reason', v_reason) else '{}'::jsonb end
  );

  return v_row;
end
$$;

revoke all on function public.compute_reschedule_slots(uuid,uuid,date,uuid,integer) from public;
revoke all on function public.create_appointment(uuid,text,text,uuid,uuid,timestamptz,text,text,text) from public;
revoke all on function public.reschedule_appointment(uuid,uuid,text,uuid,timestamptz) from public;
revoke all on function public.set_appointment_status(uuid,uuid,text,text,text) from public;

grant execute on function public.compute_reschedule_slots(uuid,uuid,date,uuid,integer) to authenticated;
grant execute on function public.create_appointment(uuid,text,text,uuid,uuid,timestamptz,text,text,text) to authenticated;
grant execute on function public.reschedule_appointment(uuid,uuid,text,uuid,timestamptz) to authenticated;
grant execute on function public.set_appointment_status(uuid,uuid,text,text,text) to authenticated;

commit;
