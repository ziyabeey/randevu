begin;

create or replace function public.business_onboarding_readiness_internal(p_business_id uuid)
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
      exists (select 1 from public.services s where s.business_id=p_business_id and s.active) as has_active_service,
      exists (select 1 from public.staff_profiles sp where sp.business_id=p_business_id and sp.active) as has_active_staff,
      exists (
        select 1 from public.staff_services ss
        join public.staff_profiles sp on sp.business_id=ss.business_id and sp.id=ss.staff_id and sp.active
        join public.services s on s.business_id=ss.business_id and s.id=ss.service_id and s.active
        where ss.business_id=p_business_id and ss.active
      ) as has_active_assignment,
      exists (select 1 from public.business_hours bh where bh.business_id=p_business_id and bh.active) as has_business_hours,
      exists (
        select 1 from public.staff_hours sh
        join public.staff_profiles sp on sp.business_id=sh.business_id and sp.id=sh.staff_id and sp.active
        join public.staff_services ss on ss.business_id=sh.business_id and ss.staff_id=sh.staff_id and ss.active
        join public.services s on s.business_id=ss.business_id and s.id=ss.service_id and s.active
        where sh.business_id=p_business_id and sh.active
      ) as has_staff_hours,
      exists (
        select 1 from public.business_hours bh
        join public.staff_hours sh
          on sh.business_id=bh.business_id and sh.weekday=bh.weekday and sh.active
         and bh.starts_local<sh.ends_local and sh.starts_local<bh.ends_local
        join public.staff_profiles sp on sp.business_id=sh.business_id and sp.id=sh.staff_id and sp.active
        join public.staff_services ss on ss.business_id=sh.business_id and ss.staff_id=sh.staff_id and ss.active
        join public.services s on s.business_id=ss.business_id and s.id=ss.service_id and s.active
        where bh.business_id=p_business_id and bh.active
      ) as has_overlapping_hours,
      exists (
        select 1 from public.business_public_profiles p
        where p.business_id=p_business_id
          and (
            nullif(trim(coalesce(p.public_phone,'')),'') is not null
            or nullif(trim(coalesce(p.public_email,'')),'') is not null
            or nullif(trim(coalesce(p.public_whatsapp,'')),'') is not null
          )
      ) as has_public_contact
  )
  select
    p_business_id,
    f.has_active_service,
    f.has_active_staff,
    f.has_active_assignment,
    f.has_business_hours,
    f.has_staff_hours,
    f.has_overlapping_hours,
    f.has_active_service and f.has_active_staff and f.has_active_assignment
      and f.has_business_hours and f.has_staff_hours and f.has_overlapping_hours
      and f.has_public_contact as publishable,
    array_remove(array[
      case when not f.has_active_service then 'SERVICE_REQUIRED' end,
      case when not f.has_active_staff then 'STAFF_REQUIRED' end,
      case when not f.has_active_assignment then 'ASSIGNMENT_REQUIRED' end,
      case when not f.has_business_hours then 'BUSINESS_HOURS_REQUIRED' end,
      case when not f.has_staff_hours then 'STAFF_HOURS_REQUIRED' end,
      case when not f.has_overlapping_hours then 'OVERLAPPING_HOURS_REQUIRED' end,
      case when not f.has_public_contact then 'PUBLIC_CONTACT_REQUIRED' end
    ]::text[],null)
  from flags f;
$$;

revoke all on function public.business_onboarding_readiness_internal(uuid)
  from public, anon, authenticated;

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
as $
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

  -- Serialize public-profile contact changes and booking enable/disable on the
  -- same tenant row. F12 profile writes use this exact business-row lock too.
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
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
$;

revoke all on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer)
  to authenticated;

create or replace function public.f12_require_public_support_contact()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_required boolean;
begin
  -- Keep direct table writes on the same serialization point as both public
  -- profile RPC writes and update_public_booking_settings.
  perform 1 from public.businesses b where b.id = new.business_id for update;
  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;

  if nullif(trim(coalesce(new.public_phone,'')),'') is not null
     or nullif(trim(coalesce(new.public_email,'')),'') is not null
     or nullif(trim(coalesce(new.public_whatsapp,'')),'') is not null then
    return new;
  end if;

  select
    exists(select 1 from public.public_booking_settings s where s.business_id=new.business_id and s.enabled)
    or exists(
      select 1 from public.appointments a
      where a.business_id=new.business_id
        and a.source='public'
        and a.status in ('scheduled','confirmed')
        and a.ends_at>now()
    )
  into v_required;

  if v_required then raise exception 'PUBLIC_CONTACT_REQUIRED'; end if;
  return new;
end
$$;

revoke all on function public.f12_require_public_support_contact()
  from public, anon, authenticated;

drop trigger if exists f12_public_support_contact_guard on public.business_public_profiles;
create trigger f12_public_support_contact_guard
before insert or update of public_phone, public_email, public_whatsapp
on public.business_public_profiles
for each row execute function public.f12_require_public_support_contact();

drop function public.get_public_managed_appointment(text);

create function public.get_public_managed_appointment(p_token text)
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
  max_date date,
  support_slug text,
  support_phone text,
  support_email text,
  support_website text,
  support_whatsapp text,
  support_address text
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_hash text;
begin
  v_hash:=public.management_token_hash(p_token);
  return query
  select
    a.id,b.name,a.status,a.starts_at,a.ends_at,a.timezone,
    a.service_name_snapshot,a.staff_name_snapshot,a.price_minor_snapshot,a.currency_snapshot,
    (a.status in ('scheduled','confirmed') and a.starts_at>now()),
    (a.status in ('scheduled','confirmed') and a.starts_at>now()),
    (now() at time zone b.timezone)::date,
    (now() at time zone b.timezone)::date+pbs.horizon_days,
    b.slug,
    p.public_phone,p.public_email,p.public_website,p.public_whatsapp,p.address_text
  from public.appointment_management_capabilities cap
  join public.appointments a on a.business_id=cap.business_id and a.id=cap.appointment_id
  join public.businesses b on b.id=a.business_id
  join public.public_booking_settings pbs on pbs.business_id=b.id
  left join public.business_public_profiles p on p.business_id=b.id
  where cap.token_hash=v_hash and cap.revoked_at is null
  limit 1;
end
$$;

revoke all on function public.get_public_managed_appointment(text)
  from public, anon, authenticated;

commit;
