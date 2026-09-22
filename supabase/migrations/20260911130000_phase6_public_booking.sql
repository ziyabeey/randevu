begin;

-- Phase 6: opt-in public self-booking surface.
-- Anonymous callers never receive direct table grants. They can only execute the
-- narrow security-definer functions granted at the end of this migration.

create table if not exists public.public_booking_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  step_minutes integer not null default 15 check (step_minutes between 5 and 120),
  min_notice_minutes integer not null default 60 check (min_notice_minutes between 0 and 10080),
  horizon_days integer not null default 60 check (horizon_days between 1 and 366),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.public_booking_settings(business_id)
select b.id from public.businesses b
on conflict (business_id) do nothing;

drop trigger if exists public_booking_settings_touch_updated_at on public.public_booking_settings;
create trigger public_booking_settings_touch_updated_at
before update on public.public_booking_settings
for each row execute function public.touch_updated_at();

create or replace function public.ensure_public_booking_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.public_booking_settings(business_id)
  values(new.id)
  on conflict (business_id) do nothing;
  return new;
end
$$;

drop trigger if exists businesses_ensure_public_booking_settings on public.businesses;
create trigger businesses_ensure_public_booking_settings
after insert on public.businesses
for each row execute function public.ensure_public_booking_settings();

-- Public-created records have no authenticated user actor. Keep the existing
-- member path intact while representing public provenance explicitly.
alter table public.customers alter column created_by drop not null;
alter table public.appointments alter column created_by drop not null;
alter table public.appointment_events alter column actor_user_id drop not null;
alter table public.booking_commands alter column created_by drop not null;

alter table public.appointments
  add column if not exists source text not null default 'operator';
alter table public.appointments drop constraint if exists appointments_source_check;
alter table public.appointments
  add constraint appointments_source_check check (source in ('operator','public'));

alter table public.appointment_events
  add column if not exists actor_type text not null default 'member';
alter table public.appointment_events drop constraint if exists appointment_events_actor_type_check;
alter table public.appointment_events
  add constraint appointment_events_actor_type_check check (actor_type in ('member','public'));

alter table public.booking_commands
  add column if not exists source text not null default 'operator';
alter table public.booking_commands drop constraint if exists booking_commands_source_check;
alter table public.booking_commands
  add constraint booking_commands_source_check check (source in ('operator','public'));
alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in ('create','public_create','reschedule','status'));

alter table public.public_booking_settings enable row level security;
alter table public.public_booking_settings force row level security;

drop policy if exists public_booking_settings_select_member on public.public_booking_settings;
create policy public_booking_settings_select_member on public.public_booking_settings
for select to authenticated
using (public.is_active_member(business_id));

revoke all on public.public_booking_settings from anon;
revoke all on public.public_booking_settings from authenticated;
grant select on public.public_booking_settings to authenticated;

-- Internal command claim now records whether the caller was an authenticated
-- operator or a public booking function. The function remains non-executable by
-- anon/authenticated directly.
create or replace function public.claim_booking_command(
  p_business_id uuid,
  p_idempotency_key text,
  p_command text,
  p_request_hash text,
  p_appointment_id uuid default null
)
returns table(is_new boolean, appointment_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_existing public.booking_commands;
  v_source text := case when auth.uid() is null then 'public' else 'operator' end;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  insert into public.booking_commands(
    business_id, idempotency_key, command, request_hash, appointment_id, created_by, source
  ) values (
    p_business_id, p_idempotency_key, p_command, p_request_hash, p_appointment_id, auth.uid(), v_source
  )
  on conflict (business_id, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return query select true, p_appointment_id;
    return;
  end if;

  select * into v_existing
  from public.booking_commands
  where idempotency_key = p_idempotency_key;

  if v_existing.command <> p_command or v_existing.request_hash <> p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.appointment_id is null then
    raise exception 'IDEMPOTENCY_IN_PROGRESS';
  end if;

  return query select false, v_existing.appointment_id;
end
$$;

create or replace function public.update_public_booking_settings(
  p_business_id uuid,
  p_enabled boolean,
  p_step_minutes integer,
  p_min_notice_minutes integer,
  p_horizon_days integer
)
returns public.public_booking_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.public_booking_settings;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_enabled is null
     or p_step_minutes < 5 or p_step_minutes > 120
     or p_min_notice_minutes < 0 or p_min_notice_minutes > 10080
     or p_horizon_days < 1 or p_horizon_days > 366 then
    raise exception 'INVALID_PUBLIC_BOOKING_SETTINGS';
  end if;

  insert into public.public_booking_settings(
    business_id, enabled, step_minutes, min_notice_minutes, horizon_days
  ) values (
    p_business_id, p_enabled, p_step_minutes, p_min_notice_minutes, p_horizon_days
  )
  on conflict (business_id) do update
  set enabled = excluded.enabled,
      step_minutes = excluded.step_minutes,
      min_notice_minutes = excluded.min_notice_minutes,
      horizon_days = excluded.horizon_days
  returning * into v_row;

  return v_row;
end
$$;

-- Sanitized public business header. Disabled businesses intentionally look absent.
create or replace function public.get_public_booking_business(p_slug text)
returns table(
  name text,
  slug text,
  timezone text,
  local_date date,
  max_date date,
  step_minutes integer,
  min_notice_minutes integer,
  horizon_days integer
)
language sql
security definer
set search_path = public
as $$
  select
    b.name,
    b.slug,
    b.timezone,
    (now() at time zone b.timezone)::date,
    (now() at time zone b.timezone)::date + s.horizon_days,
    s.step_minutes,
    s.min_notice_minutes,
    s.horizon_days
  from public.businesses b
  join public.public_booking_settings s on s.business_id = b.id
  where lower(b.slug) = lower(trim(p_slug))
    and s.enabled
  limit 1;
$$;

create or replace function public.get_public_booking_services(p_slug text)
returns table(
  service_id uuid,
  name text,
  duration_minutes integer,
  price_minor integer,
  currency text
)
language sql
security definer
set search_path = public
as $$
  select sv.id, sv.name, sv.duration_minutes, sv.price_minor, sv.currency
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  join public.services sv on sv.business_id = b.id and sv.active
  where lower(b.slug) = lower(trim(p_slug))
    and exists (
      select 1
      from public.staff_services ss
      join public.staff_profiles sp
        on sp.business_id = ss.business_id
       and sp.id = ss.staff_id
       and sp.active
      where ss.business_id = b.id
        and ss.service_id = sv.id
        and ss.active
    )
  order by sv.name, sv.id;
$$;

create or replace function public.get_public_booking_staff(
  p_slug text,
  p_service_id uuid
)
returns table(staff_id uuid, staff_name text)
language sql
security definer
set search_path = public
as $$
  select sp.id, sp.name
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  join public.services sv
    on sv.business_id = b.id and sv.id = p_service_id and sv.active
  join public.staff_services ss
    on ss.business_id = b.id and ss.service_id = sv.id and ss.active
  join public.staff_profiles sp
    on sp.business_id = b.id and sp.id = ss.staff_id and sp.active
  where lower(b.slug) = lower(trim(p_slug))
  order by sp.name, sp.id;
$$;

-- Public slot computation deliberately duplicates the stable Phase 5 occupancy
-- invariant instead of weakening member-only internal RPC authorization.
create or replace function public.compute_public_booking_slots(
  p_slug text,
  p_service_id uuid,
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
  v_business_id uuid;
  v_timezone text;
  v_step_minutes integer;
  v_min_notice_minutes integer;
  v_horizon_days integer;
  v_today date;
begin
  select b.id, b.timezone, s.step_minutes, s.min_notice_minutes, s.horizon_days
  into v_business_id, v_timezone, v_step_minutes, v_min_notice_minutes, v_horizon_days
  from public.businesses b
  join public.public_booking_settings s on s.business_id = b.id
  where lower(b.slug) = lower(trim(p_slug))
    and s.enabled
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;
  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  if p_date < v_today or p_date > v_today + v_horizon_days then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  return query
  with service_cfg as (
    select sv.duration_minutes, sv.buffer_before_minutes, sv.buffer_after_minutes
    from public.services sv
    where sv.business_id = v_business_id
      and sv.id = p_service_id
      and sv.active
  ),
  eligible_staff as (
    select sp.id, sp.name
    from public.staff_profiles sp
    join public.staff_services ss
      on ss.business_id = sp.business_id
     and ss.staff_id = sp.id
     and ss.service_id = p_service_id
     and ss.active
    where sp.business_id = v_business_id
      and sp.active
      and (p_staff_id is null or sp.id = p_staff_id)
  ),
  local_windows as (
    select
      es.id as staff_id,
      es.name as staff_name,
      greatest(bh.starts_local, sh.starts_local) as local_start,
      least(bh.ends_local, sh.ends_local) as local_end,
      sc.duration_minutes,
      sc.buffer_before_minutes,
      sc.buffer_after_minutes
    from eligible_staff es
    cross join service_cfg sc
    join public.business_hours bh
      on bh.business_id = v_business_id
     and bh.weekday = extract(dow from p_date)::smallint
     and bh.active
    join public.staff_hours sh
      on sh.business_id = v_business_id
     and sh.staff_id = es.id
     and sh.weekday = extract(dow from p_date)::smallint
     and sh.active
    where greatest(bh.starts_local, sh.starts_local) < least(bh.ends_local, sh.ends_local)
  ),
  absolute_windows as (
    select
      lw.*,
      (p_date + lw.local_start) at time zone v_timezone as window_start,
      (p_date + lw.local_end) at time zone v_timezone as window_end
    from local_windows lw
  ),
  candidate_slots as (
    select
      aw.staff_id,
      aw.staff_name,
      gs as service_start,
      gs + make_interval(mins => aw.duration_minutes) as service_end,
      gs - make_interval(mins => aw.buffer_before_minutes) as occupied_start,
      gs + make_interval(mins => aw.duration_minutes + aw.buffer_after_minutes) as occupied_end
    from absolute_windows aw
    cross join lateral generate_series(
      aw.window_start + make_interval(mins => aw.buffer_before_minutes),
      aw.window_end - make_interval(mins => aw.duration_minutes + aw.buffer_after_minutes),
      make_interval(mins => v_step_minutes)
    ) gs
    where aw.window_start < aw.window_end
  )
  select distinct
    cs.staff_id,
    cs.staff_name,
    cs.service_start,
    cs.service_end,
    v_timezone
  from candidate_slots cs
  where cs.service_start >= now() + make_interval(mins => v_min_notice_minutes)
    and not exists (
      select 1
      from public.availability_blocks ab
      where ab.business_id = v_business_id
        and ab.active
        and (ab.staff_id is null or ab.staff_id = cs.staff_id)
        and ab.starts_at < cs.occupied_end
        and ab.ends_at > cs.occupied_start
    )
    and not exists (
      select 1
      from public.appointments a
      where a.business_id = v_business_id
        and a.staff_id = cs.staff_id
        and a.status <> 'cancelled'
        and a.occupied_starts_at < cs.occupied_end
        and a.occupied_ends_at > cs.occupied_start
    )
  order by cs.service_start, cs.staff_name, cs.staff_id;
end
$$;

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
  v_customer_email text := nullif(lower(trim(p_customer_email)), '');
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

  -- A public booking may reuse an exact contact match, but it never edits the
  -- existing CRM customer row. Submitted values live safely in appointment snapshots.
  select c.id into v_customer_id
  from public.customers c
  where c.business_id = v_business_id
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
    values(v_business_id, v_customer_name, v_customer_phone, v_customer_email, null)
    returning id into v_customer_id;
  end if;

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

revoke all on function public.ensure_public_booking_settings() from public;
revoke all on function public.claim_booking_command(uuid,text,text,text,uuid) from public;
revoke all on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer) from public;
revoke all on function public.get_public_booking_business(text) from public;
revoke all on function public.get_public_booking_services(text) from public;
revoke all on function public.get_public_booking_staff(text,uuid) from public;
revoke all on function public.compute_public_booking_slots(text,uuid,date,uuid) from public;
revoke all on function public.create_public_appointment(text,text,text,uuid,uuid,timestamptz,text,text,text) from public;

grant execute on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer) to authenticated;
grant execute on function public.get_public_booking_business(text) to anon;
grant execute on function public.get_public_booking_services(text) to anon;
grant execute on function public.get_public_booking_staff(text,uuid) to anon;
grant execute on function public.compute_public_booking_slots(text,uuid,date,uuid) to anon;
grant execute on function public.create_public_appointment(text,text,text,uuid,uuid,timestamptz,text,text,text) to anon;

commit;
