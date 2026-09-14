begin;

-- F10-05 forward repair after the merged customer-records delivery.
-- The browser/Worker surface is the bounded authority for customer-bearing reads.
-- Raw Data API access bypassed both the recovery-session guard and K03 bounds.
revoke select on table public.customers from authenticated;
revoke select on table public.appointments from authenticated;

-- One internal customer identity primitive is shared by CRM, operator booking and
-- public booking. The caller owns authority; this helper owns only deterministic
-- tenant-scoped identity resolution/creation under the same advisory lock.
create or replace function public.f10_resolve_or_create_customer(
  p_business_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_notes text,
  p_created_by uuid,
  p_reuse_existing boolean
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := public.f10_normalize_customer_email(coalesce(p_email, ''));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_phone_normalized text := public.f10_normalize_customer_phone(coalesce(p_phone, ''));
  v_customer_id uuid;
begin
  if p_business_id is null then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select c.id into v_customer_id
  from public.customers c
  where c.business_id = p_business_id
    and (
      (v_phone_normalized is not null
        and public.f10_normalize_customer_phone(c.phone) = v_phone_normalized)
      or
      (v_email is not null
        and public.f10_normalize_customer_email(c.email) = v_email)
    )
  order by c.updated_at desc, c.id desc
  limit 1;

  if v_customer_id is not null then
    if not coalesce(p_reuse_existing, false) then
      raise exception 'CUSTOMER_CONTACT_EXISTS';
    end if;
    return v_customer_id;
  end if;

  insert into public.customers(business_id, name, phone, email, notes, created_by)
  values(p_business_id, v_name, v_phone, v_email, v_notes, p_created_by)
  returning id into v_customer_id;

  return v_customer_id;
end
$$;

revoke all on function public.f10_resolve_or_create_customer(uuid,text,text,text,text,uuid,boolean)
  from public, anon, authenticated;

-- CRM create keeps its explicit duplicate-conflict contract, but now uses the
-- same canonical resolver and lock as every booking path.
create or replace function public.create_business_customer(
  p_business_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_notes text default null
)
returns table(
  customer_id uuid,
  name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_row public.customers;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id,
    p_name,
    p_phone,
    p_email,
    p_notes,
    auth.uid(),
    false
  );

  select * into v_row
  from public.customers c
  where c.business_id = p_business_id
    and c.id = v_customer_id;

  return query select
    v_row.id, v_row.name, v_row.phone, v_row.email, v_row.notes,
    v_row.created_at, v_row.updated_at;
end
$$;

-- Operator booking is a directly granted authenticated RPC. Recovery sessions
-- must fail at the DB boundary before idempotency/customer access. Booking may
-- reuse a canonical customer, but it no longer silently edits the CRM master.
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
  v_customer_email text := public.f10_normalize_customer_email(coalesce(p_customer_email, ''));
  v_notes text := nullif(trim(p_notes), '');
  v_hash text;
  v_claim record;
  v_row public.appointments;
  v_date date;
begin
  perform public.f10_require_standard_session();
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

  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id,
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    null,
    auth.uid(),
    true
  );

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

-- Public booking stays anonymous/gated, but customer identity resolution is the
-- same canonical transaction-serialized primitive. Reuse never mutates the CRM
-- master; submitted contact/name values remain frozen in appointment snapshots.
create or replace function public.create_public_appointment(
  p_slug text,
  p_idempotency_key text,
  p_customer_name text,
  p_service_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
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
  v_business_id uuid;
  v_timezone text;
  v_enabled boolean;
  v_min_notice_minutes integer;
  v_horizon_days integer;
  v_today date;
  v_date date;
  v_service public.services;
  v_staff public.staff_profiles;
  v_customer_id uuid;
  v_customer_name text := trim(p_customer_name);
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_customer_email text := public.f10_normalize_customer_email(coalesce(p_customer_email, ''));
  v_notes text := nullif(trim(p_notes), '');
  v_hash text;
  v_claim record;
  v_row public.appointments;
begin
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_customer_email is not null and (char_length(v_customer_email) > 254 or position('@' in v_customer_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_customer_phone is null and v_customer_email is null then
    raise exception 'PUBLIC_CONTACT_REQUIRED';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'NOTES_TOO_LONG';
  end if;
  if p_starts_at is null then
    raise exception 'INVALID_START';
  end if;

  select b.id, b.timezone, s.enabled, s.min_notice_minutes, s.horizon_days
  into v_business_id, v_timezone, v_enabled, v_min_notice_minutes, v_horizon_days
  from public.businesses b
  join public.public_booking_settings s on s.business_id = b.id
  where lower(b.slug) = lower(trim(p_slug))
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;

  v_hash := md5(jsonb_build_object(
    'source', 'public',
    'customerName', v_customer_name,
    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,
    'serviceId', p_service_id,
    'staffId', p_staff_id,
    'startsAt', p_starts_at,
    'notes', v_notes
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    v_business_id, p_idempotency_key, 'public_create', v_hash, null
  );

  if not v_claim.is_new then
    select * into v_row
    from public.appointments a
    where a.business_id = v_business_id and a.id = v_claim.appointment_id;
    if v_row.id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;

    return query select
      v_row.id, v_row.status, v_row.starts_at, v_row.ends_at, v_row.timezone,
      v_row.service_name_snapshot, v_row.staff_name_snapshot,
      v_row.price_minor_snapshot, v_row.currency_snapshot;
    return;
  end if;

  if not v_enabled then
    raise exception 'PUBLIC_BOOKING_DISABLED';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  v_date := (p_starts_at at time zone v_timezone)::date;
  if v_date < v_today or v_date > v_today + v_horizon_days then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;
  if p_starts_at < now() + make_interval(mins => v_min_notice_minutes) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  select * into v_service
  from public.services sv
  where sv.business_id = v_business_id
    and sv.id = p_service_id
    and sv.active;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;

  select sp.* into v_staff
  from public.staff_profiles sp
  join public.staff_services ss
    on ss.business_id = sp.business_id
   and ss.staff_id = sp.id
   and ss.service_id = p_service_id
   and ss.active
  where sp.business_id = v_business_id
    and sp.id = p_staff_id
    and sp.active;
  if v_staff.id is null then raise exception 'STAFF_NOT_ELIGIBLE'; end if;

  if not exists (
    select 1
    from public.compute_public_booking_slots(p_slug, p_service_id, v_date, p_staff_id) s
    where s.staff_id = p_staff_id and s.starts_at = p_starts_at
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  v_customer_id := public.f10_resolve_or_create_customer(
    v_business_id,
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    null,
    null,
    true
  );

  begin
    insert into public.appointments(
      business_id, customer_id, service_id, staff_id, status,
      starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      service_name_snapshot, staff_name_snapshot,
      duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      price_minor_snapshot, currency_snapshot, notes, created_by, source
    ) values (
      v_business_id, v_customer_id, p_service_id, p_staff_id, 'scheduled',
      p_starts_at,
      p_starts_at + make_interval(mins => v_service.duration_minutes),
      p_starts_at - make_interval(mins => v_service.buffer_before_minutes),
      p_starts_at + make_interval(mins => v_service.duration_minutes + v_service.buffer_after_minutes),
      v_timezone,
      v_customer_name, v_customer_phone, v_customer_email,
      v_service.name, v_staff.name,
      v_service.duration_minutes, v_service.buffer_before_minutes, v_service.buffer_after_minutes,
      v_service.price_minor, v_service.currency, v_notes, null, 'public'
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, actor_type,
    from_status, to_status, payload
  ) values (
    v_business_id, v_row.id, 'created', null, 'public', null, 'scheduled',
    jsonb_build_object(
      'source', 'public',
      'startsAt', v_row.starts_at,
      'staffId', v_row.staff_id,
      'serviceId', v_row.service_id
    )
  );

  update public.booking_commands
  set appointment_id = v_row.id
  where business_id = v_business_id
    and idempotency_key = p_idempotency_key;

  return query select
    v_row.id, v_row.status, v_row.starts_at, v_row.ends_at, v_row.timezone,
    v_row.service_name_snapshot, v_row.staff_name_snapshot,
    v_row.price_minor_snapshot, v_row.currency_snapshot;
end
$$;

-- Re-stating functions preserves their historical explicit grants. The new
-- helper itself remains internal only.
revoke all on function public.f10_resolve_or_create_customer(uuid,text,text,text,text,uuid,boolean)
  from public, anon, authenticated;

commit;
