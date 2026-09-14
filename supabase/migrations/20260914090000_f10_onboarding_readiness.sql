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

-- If a published business later loses a required service/staff/hours link, the
-- public header disappears immediately. This does not mutate the saved enabled
-- preference; restoring a valid configuration restores visibility.
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

commit;
