begin;

-- Phase 7: customer appointment management by narrow capability token.
-- Plain tokens are never stored. The browser keeps the capability; PostgreSQL
-- stores only a SHA-256 hash and exposes no direct capability-table grants.

create extension if not exists pgcrypto;

create table if not exists public.appointment_management_capabilities (
  appointment_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (business_id, appointment_id)
    references public.appointments(business_id, id)
    on delete cascade
);

alter table public.appointment_management_capabilities enable row level security;
alter table public.appointment_management_capabilities force row level security;
revoke all on public.appointment_management_capabilities from anon;
revoke all on public.appointment_management_capabilities from authenticated;

alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in (
    'create','public_create','reschedule','status','public_reschedule','public_cancel'
  ));

create or replace function public.management_token_hash(p_token text)
returns text
language plpgsql
immutable
security definer
set search_path = public, extensions
as $$
begin
  if p_token is null
     or char_length(p_token) < 43
     or char_length(p_token) > 128
     or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'INVALID_MANAGEMENT_TOKEN';
  end if;
  return encode(digest(p_token, 'sha256'), 'hex');
end
$$;

-- The original public-create idempotency key proves that the caller owns the
-- just-created appointment. This lets the Worker attach a hashed management
-- capability without changing Phase 6's stable create RPC signature.
create or replace function public.provision_public_management_token(
  p_appointment_id uuid,
  p_booking_idempotency_key text,
  p_management_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_hash text;
  v_existing text;
begin
  v_hash := public.management_token_hash(p_management_token);

  select bc.business_id into v_business_id
  from public.booking_commands bc
  join public.appointments a
    on a.business_id = bc.business_id
   and a.id = bc.appointment_id
   and a.source = 'public'
  where bc.appointment_id = p_appointment_id
    and bc.idempotency_key = p_booking_idempotency_key
    and bc.command = 'public_create'
    and bc.source = 'public'
  limit 1;

  if v_business_id is null then
    raise exception 'INVALID_MANAGEMENT_BOOTSTRAP';
  end if;

  select c.token_hash into v_existing
  from public.appointment_management_capabilities c
  where c.appointment_id = p_appointment_id;

  if v_existing is not null then
    if v_existing <> v_hash then
      raise exception 'MANAGEMENT_TOKEN_ALREADY_PROVISIONED';
    end if;
    return true;
  end if;

  insert into public.appointment_management_capabilities(
    appointment_id, business_id, token_hash
  ) values (
    p_appointment_id, v_business_id, v_hash
  );

  return true;
end
$$;

create or replace function public.get_public_managed_appointment(p_token text)
returns table(
  appointment_id uuid,
  business_name text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  can_reschedule boolean,
  can_cancel boolean,
  local_date date,
  max_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  v_hash := public.management_token_hash(p_token);

  return query
  select
    a.id,
    b.name,
    a.status,
    a.starts_at,
    a.ends_at,
    a.timezone,
    a.service_name_snapshot,
    a.staff_name_snapshot,
    a.price_minor_snapshot,
    a.currency_snapshot,
    (a.status in ('scheduled','confirmed') and a.starts_at > now()),
    (a.status in ('scheduled','confirmed') and a.starts_at > now()),
    (now() at time zone b.timezone)::date,
    (now() at time zone b.timezone)::date + pbs.horizon_days
  from public.appointment_management_capabilities cap
  join public.appointments a
    on a.business_id = cap.business_id
   and a.id = cap.appointment_id
  join public.businesses b on b.id = a.business_id
  join public.public_booking_settings pbs on pbs.business_id = b.id
  where cap.token_hash = v_hash
    and cap.revoked_at is null
  limit 1;
end
$$;

-- Customer reschedule slots preserve the appointment's duration/buffer snapshots
-- while using current business/staff hours, blocks, staff eligibility and timezone.
-- The public booking page may be disabled; an already-issued capability still works.
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

  select a.* into v_current
  from public.appointment_management_capabilities cap
  join public.appointments a
    on a.business_id = cap.business_id
   and a.id = cap.appointment_id
  where cap.token_hash = v_hash
    and cap.revoked_at is null
  limit 1;

  if v_current.id is null then
    raise exception 'MANAGEMENT_NOT_FOUND';
  end if;

  select b.timezone, pbs.min_notice_minutes, pbs.horizon_days, pbs.step_minutes
  into v_business_timezone, v_min_notice_minutes, v_horizon_days, v_step_minutes
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id
  where b.id = v_current.business_id;

  if v_business_timezone is null then
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

  select a.* into v_current
  from public.appointment_management_capabilities cap
  join public.appointments a
    on a.business_id = cap.business_id
   and a.id = cap.appointment_id
  where cap.token_hash = v_hash_token
    and cap.revoked_at is null
  limit 1;

  if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  select b.timezone, pbs.min_notice_minutes, pbs.horizon_days
  into v_business_timezone, v_min_notice_minutes, v_horizon_days
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id
  where b.id = v_current.business_id;

  if v_business_timezone is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

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

create or replace function public.cancel_public_managed_appointment(
  p_token text,
  p_idempotency_key text,
  p_reason text default null
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
  v_reason text := nullif(trim(p_reason), '');
  v_hash text;
  v_claim record;
  v_row public.appointments;
begin
  v_hash_token := public.management_token_hash(p_token);
  if v_reason is not null and char_length(v_reason) > 240 then
    raise exception 'REASON_TOO_LONG';
  end if;

  select a.* into v_current
  from public.appointment_management_capabilities cap
  join public.appointments a
    on a.business_id = cap.business_id
   and a.id = cap.appointment_id
  where cap.token_hash = v_hash_token
    and cap.revoked_at is null
  limit 1;

  if v_current.id is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  v_hash := md5(jsonb_build_object(
    'source', 'public_manage',
    'appointmentId', v_current.id,
    'reason', v_reason
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    v_current.business_id, p_idempotency_key, 'public_cancel', v_hash, v_current.id
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

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = null,
      cancellation_reason = v_reason
  where business_id = v_current.business_id and id = v_current.id
  returning * into v_row;

  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, actor_type,
    from_status, to_status, payload
  ) values (
    v_current.business_id, v_current.id, 'cancelled', null, 'public',
    v_current.status, 'cancelled',
    jsonb_build_object('source', 'public_manage', 'reason', v_reason)
  );

  return query select
    v_row.id, v_row.status, v_row.starts_at, v_row.ends_at, v_row.timezone,
    v_row.service_name_snapshot, v_row.staff_name_snapshot,
    v_row.price_minor_snapshot, v_row.currency_snapshot;
end
$$;

revoke all on function public.management_token_hash(text) from public;
revoke all on function public.provision_public_management_token(uuid,text,text) from public;
revoke all on function public.get_public_managed_appointment(text) from public;
revoke all on function public.compute_public_management_slots(text,date,uuid) from public;
revoke all on function public.reschedule_public_managed_appointment(text,text,uuid,timestamptz) from public;
revoke all on function public.cancel_public_managed_appointment(text,text,text) from public;

grant execute on function public.provision_public_management_token(uuid,text,text) to anon;
grant execute on function public.get_public_managed_appointment(text) to anon;
grant execute on function public.compute_public_management_slots(text,date,uuid) to anon;
grant execute on function public.reschedule_public_managed_appointment(text,text,uuid,timestamptz) to anon;
grant execute on function public.cancel_public_managed_appointment(text,text,text) to anon;

commit;
