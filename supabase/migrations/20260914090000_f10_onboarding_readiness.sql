begin;

-- F10-03 keeps onboarding progress derived from the real business configuration.
-- No separate wizard-progress table is introduced: resumability is the current
-- service/staff/assignment/hours state, and the same contract gates publication.
create or replace function public.business_onboarding_readiness_internal(
  p_business_id uuid
)
returns table(
  business_id uuid,
  has_active_service boolean,
  has_active_staff boolean,
  has_active_assignment boolean,
  has_business_hours boolean,
  has_staff_hours boolean,
  has_overlapping_hours boolean,
  publishable boolean,
  missing_reasons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with flags as (
    select
      exists (
        select 1
        from public.services s
        where s.business_id = p_business_id
          and s.active
      ) as has_active_service,
      exists (
        select 1
        from public.staff_profiles sp
        where sp.business_id = p_business_id
          and sp.active
      ) as has_active_staff,
      exists (
        select 1
        from public.staff_services ss
        join public.staff_profiles sp
          on sp.business_id = ss.business_id
         and sp.id = ss.staff_id
         and sp.active
        join public.services s
          on s.business_id = ss.business_id
         and s.id = ss.service_id
         and s.active
        where ss.business_id = p_business_id
          and ss.active
      ) as has_active_assignment,
      exists (
        select 1
        from public.business_hours bh
        where bh.business_id = p_business_id
          and bh.active
      ) as has_business_hours,
      exists (
        select 1
        from public.staff_hours sh
        join public.staff_profiles sp
          on sp.business_id = sh.business_id
         and sp.id = sh.staff_id
         and sp.active
        join public.staff_services ss
          on ss.business_id = sh.business_id
         and ss.staff_id = sh.staff_id
         and ss.active
        join public.services s
          on s.business_id = ss.business_id
         and s.id = ss.service_id
         and s.active
        where sh.business_id = p_business_id
          and sh.active
      ) as has_staff_hours,
      exists (
        select 1
        from public.business_hours bh
        join public.staff_hours sh
          on sh.business_id = bh.business_id
         and sh.weekday = bh.weekday
         and sh.active
         and bh.starts_local < sh.ends_local
         and sh.starts_local < bh.ends_local
        join public.staff_profiles sp
          on sp.business_id = sh.business_id
         and sp.id = sh.staff_id
         and sp.active
        join public.staff_services ss
          on ss.business_id = sh.business_id
         and ss.staff_id = sh.staff_id
         and ss.active
        join public.services s
          on s.business_id = ss.business_id
         and s.id = ss.service_id
         and s.active
        where bh.business_id = p_business_id
          and bh.active
      ) as has_overlapping_hours
  )
  select
    p_business_id,
    f.has_active_service,
    f.has_active_staff,
    f.has_active_assignment,
    f.has_business_hours,
    f.has_staff_hours,
    f.has_overlapping_hours,
    f.has_active_service
      and f.has_active_staff
      and f.has_active_assignment
      and f.has_business_hours
      and f.has_staff_hours
      and f.has_overlapping_hours as publishable,
    array_remove(array[
      case when not f.has_active_service then 'SERVICE_REQUIRED' end,
      case when not f.has_active_staff then 'STAFF_REQUIRED' end,
      case when not f.has_active_assignment then 'ASSIGNMENT_REQUIRED' end,
      case when not f.has_business_hours then 'BUSINESS_HOURS_REQUIRED' end,
      case when not f.has_staff_hours then 'STAFF_HOURS_REQUIRED' end,
      case when not f.has_overlapping_hours then 'OVERLAPPING_HOURS_REQUIRED' end
    ]::text[], null) as missing_reasons
  from flags f;
$$;

-- Internal readiness bypasses table RLS only so all public/readiness callers use
-- one canonical calculation. It is never an API entry point.
revoke all on function public.business_onboarding_readiness_internal(uuid)
  from public, anon, authenticated;

-- Authenticated onboarding reads are business-scoped and reject recovery-mode
-- bearers at the database boundary, matching the accepted F10 session authority.
create or replace function public.get_business_onboarding_readiness(
  p_business_id uuid
)
returns table(
  business_id uuid,
  has_active_service boolean,
  has_active_staff boolean,
  has_active_assignment boolean,
  has_business_hours boolean,
  has_staff_hours boolean,
  has_overlapping_hours boolean,
  publishable boolean,
  missing_reasons text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  return query
  select *
  from public.business_onboarding_readiness_internal(p_business_id);
end
$$;

revoke all on function public.get_business_onboarding_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.get_business_onboarding_readiness(uuid)
  to authenticated;

-- One bounded database snapshot backs /api/onboarding. Catalog collections reuse
-- the S07 max+1 snapshot contract; hours are independently probed at max+1 so a
-- hosted PostgREST row cap can never become a partial successful onboarding view.
create or replace function public.get_business_onboarding_snapshot(
  p_business_id uuid
)
returns table(
  business jsonb,
  services jsonb,
  staff jsonb,
  assignments jsonb,
  business_hours jsonb,
  staff_hours jsonb,
  settings jsonb,
  readiness jsonb
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_business jsonb;
  v_services jsonb := '[]'::jsonb;
  v_staff jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_business_hours jsonb := '[]'::jsonb;
  v_staff_hours jsonb := '[]'::jsonb;
  v_settings jsonb;
  v_readiness jsonb;
  v_business_hours_count integer := 0;
  v_staff_hours_count integer := 0;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'slug', b.slug,
    'timezone', b.timezone
  ) into v_business
  from public.businesses b
  where b.id = p_business_id;

  if v_business is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- Reuse S07's authoritative 100/100/5000 catalog budgets and errors.
  select c.services, c.staff, c.assignments
    into v_services, v_staff, v_assignments
  from public.get_catalog_snapshot(p_business_id) c;

  select
    count(*),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'weekday', q.weekday,
        'starts_local', q.starts_local,
        'ends_local', q.ends_local,
        'active', q.active
      ) order by q.weekday, q.starts_local, q.id
    ), '[]'::jsonb)
  into v_business_hours_count, v_business_hours
  from (
    select bh.id, bh.weekday, bh.starts_local, bh.ends_local, bh.active
    from public.business_hours bh
    where bh.business_id = p_business_id
      and bh.active
    order by bh.weekday, bh.starts_local, bh.id
    limit 101
  ) q;

  if v_business_hours_count > 100 then
    raise exception 'ONBOARDING_BUSINESS_HOURS_LIMIT_EXCEEDED';
  end if;

  select
    count(*),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'staff_id', q.staff_id,
        'weekday', q.weekday,
        'starts_local', q.starts_local,
        'ends_local', q.ends_local,
        'active', q.active
      ) order by q.staff_id, q.weekday, q.starts_local, q.id
    ), '[]'::jsonb)
  into v_staff_hours_count, v_staff_hours
  from (
    select sh.id, sh.staff_id, sh.weekday, sh.starts_local, sh.ends_local, sh.active
    from public.staff_hours sh
    where sh.business_id = p_business_id
      and sh.active
    order by sh.staff_id, sh.weekday, sh.starts_local, sh.id
    limit 5001
  ) q;

  if v_staff_hours_count > 5000 then
    raise exception 'ONBOARDING_STAFF_HOURS_LIMIT_EXCEEDED';
  end if;

  select jsonb_build_object(
    'business_id', pbs.business_id,
    'enabled', pbs.enabled,
    'step_minutes', pbs.step_minutes,
    'min_notice_minutes', pbs.min_notice_minutes,
    'horizon_days', pbs.horizon_days
  ) into v_settings
  from public.public_booking_settings pbs
  where pbs.business_id = p_business_id;

  select jsonb_build_object(
    'business_id', r.business_id,
    'has_active_service', r.has_active_service,
    'has_active_staff', r.has_active_staff,
    'has_active_assignment', r.has_active_assignment,
    'has_business_hours', r.has_business_hours,
    'has_staff_hours', r.has_staff_hours,
    'has_overlapping_hours', r.has_overlapping_hours,
    'publishable', r.publishable,
    'missing_reasons', r.missing_reasons
  ) into v_readiness
  from public.business_onboarding_readiness_internal(p_business_id) r;

  if v_settings is null or v_readiness is null then
    raise exception 'ONBOARDING_CONTEXT_MISSING';
  end if;

  return query select
    v_business,
    coalesce(v_services, '[]'::jsonb),
    coalesce(v_staff, '[]'::jsonb),
    coalesce(v_assignments, '[]'::jsonb),
    v_business_hours,
    v_staff_hours,
    v_settings,
    v_readiness;
end
$$;

revoke all on function public.get_business_onboarding_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.get_business_onboarding_snapshot(uuid)
  to authenticated;

-- Publication is fail-closed. Disabling remains possible even if configuration
-- has since become incomplete, so operators can always take a public page down.
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
  v_publishable boolean;
  v_missing text[];
begin
  perform public.f10_require_standard_session();

  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_enabled is null
     or p_step_minutes < 5 or p_step_minutes > 120
     or p_min_notice_minutes < 0 or p_min_notice_minutes > 10080
     or p_horizon_days < 1 or p_horizon_days > 366 then
    raise exception 'INVALID_PUBLIC_BOOKING_SETTINGS';
  end if;

  if p_enabled then
    select r.publishable, r.missing_reasons
      into v_publishable, v_missing
    from public.business_onboarding_readiness_internal(p_business_id) r;

    if not coalesce(v_publishable, false) then
      raise exception 'PUBLIC_BOOKING_NOT_READY'
        using detail = array_to_string(coalesce(v_missing, array[]::text[]), ',');
    end if;
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

revoke all on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer)
  to authenticated;

-- Live public visibility uses exactly the same readiness authority as publish.
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
stable
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
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug) = lower(trim(p_slug))
    and s.enabled
    and r.publishable
  limit 1;
$$;

revoke all on function public.get_public_booking_business(text)
  from public, anon, authenticated;

-- Preserve S07's max+1 public catalog contract while adding live readiness.
create or replace function public.get_public_booking_services(p_slug text)
returns table(
  service_id uuid,
  name text,
  duration_minutes integer,
  price_minor integer,
  currency text
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_rows integer;
begin
  return query
  select sv.id, sv.name, sv.duration_minutes, sv.price_minor, sv.currency
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  join public.services sv on sv.business_id = b.id and sv.active
  where lower(b.slug) = lower(trim(p_slug))
    and r.publishable
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
  order by sv.name, sv.id
  limit 101;

  get diagnostics v_rows = row_count;
  if v_rows > 100 then
    raise exception 'PUBLIC_SERVICES_LIMIT_EXCEEDED';
  end if;
end
$$;

create or replace function public.get_public_booking_staff(
  p_slug text,
  p_service_id uuid
)
returns table(staff_id uuid, staff_name text)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_rows integer;
begin
  return query
  select sp.id, sp.name
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  join public.services sv
    on sv.business_id = b.id and sv.id = p_service_id and sv.active
  join public.staff_services ss
    on ss.business_id = b.id and ss.service_id = sv.id and ss.active
  join public.staff_profiles sp
    on sp.business_id = b.id and sp.id = ss.staff_id and sp.active
  where lower(b.slug) = lower(trim(p_slug))
    and r.publishable
  order by sp.name, sp.id
  limit 101;

  get diagnostics v_rows = row_count;
  if v_rows > 100 then
    raise exception 'PUBLIC_STAFF_LIMIT_EXCEEDED';
  end if;
end
$$;

-- Slot reads must fail closed when a formerly published business becomes
-- structurally unbookable. Keep the established signature and slot semantics.
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
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug) = lower(trim(p_slug))
    and s.enabled
    and r.publishable
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
      on bh.weekday = extract(dow from p_date)::smallint
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

-- A final insert-time guard closes the create chain as well. It uses the same
-- readiness function and therefore cannot drift from publish/read visibility.
create or replace function public.f10_guard_public_appointment_readiness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.business_onboarding_readiness_internal(new.business_id) r
    where r.publishable
  ) then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;
  return new;
end
$$;

revoke all on function public.f10_guard_public_appointment_readiness()
  from public, anon, authenticated;

drop trigger if exists f10_public_appointment_readiness_guard on public.appointments;
create trigger f10_public_appointment_readiness_guard
before insert on public.appointments
for each row
when (new.source = 'public')
execute function public.f10_guard_public_appointment_readiness();

-- F17/S08 contract: raw public implementation functions remain unreachable from
-- browser roles; execute_public_operation stays the single server-gated transport.
revoke all on function public.get_public_booking_services(text)
  from public, anon, authenticated;
revoke all on function public.get_public_booking_staff(text,uuid)
  from public, anon, authenticated;
revoke all on function public.compute_public_booking_slots(text,uuid,date,uuid)
  from public, anon, authenticated;

commit;
