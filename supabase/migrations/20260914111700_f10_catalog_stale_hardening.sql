begin;

-- F10-04 guarded functions are themselves authenticated Data API endpoints.
-- Existing rows therefore require an optimistic version/snapshot at the DB
-- boundary as well as in the Worker. A missing proof is allowed only when the
-- target row/day does not exist yet, so first-time setup remains compatible.

create or replace function public.update_service_guarded(
  p_business_id uuid,
  p_service_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.services;
  v_name text;
  v_duration integer;
  v_before integer;
  v_after integer;
  v_price integer;
  v_active boolean;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) k
       where k not in ('name','durationMinutes','bufferBeforeMinutes','bufferAfterMinutes','priceMinor','active')
     ) then
    raise exception 'INVALID_SERVICE';
  end if;

  select * into v_row
  from public.services s
  where s.business_id = p_business_id and s.id = p_service_id
  for update;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
  if p_expected_updated_at is null
     or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE_WRITE';
  end if;

  begin
    v_name := case when p_patch ? 'name' then trim(p_patch->>'name') else v_row.name end;
    v_duration := case when p_patch ? 'durationMinutes' then (p_patch->>'durationMinutes')::integer else v_row.duration_minutes end;
    v_before := case when p_patch ? 'bufferBeforeMinutes' then (p_patch->>'bufferBeforeMinutes')::integer else v_row.buffer_before_minutes end;
    v_after := case when p_patch ? 'bufferAfterMinutes' then (p_patch->>'bufferAfterMinutes')::integer else v_row.buffer_after_minutes end;
    v_price := case when p_patch ? 'priceMinor' then (p_patch->>'priceMinor')::integer else v_row.price_minor end;
    v_active := case when p_patch ? 'active' then (p_patch->>'active')::boolean else v_row.active end;
  exception when others then
    raise exception 'INVALID_SERVICE';
  end;
  if v_name is null or char_length(v_name) not between 2 and 120
     or v_duration not between 5 and 720
     or v_before not between 0 and 240
     or v_after not between 0 and 240
     or v_price not between 0 and 100000000
     or v_active is null then
    raise exception 'INVALID_SERVICE';
  end if;

  update public.services s
  set name = v_name,
      duration_minutes = v_duration,
      buffer_before_minutes = v_before,
      buffer_after_minutes = v_after,
      price_minor = v_price,
      active = v_active
  where s.business_id = p_business_id and s.id = p_service_id
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.update_staff_guarded(
  p_business_id uuid,
  p_staff_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.staff_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_profiles;
  v_name text;
  v_phone text;
  v_active boolean;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) k
       where k not in ('name','phone','active')
     ) then
    raise exception 'INVALID_STAFF';
  end if;

  select * into v_row
  from public.staff_profiles sp
  where sp.business_id = p_business_id and sp.id = p_staff_id
  for update;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  if p_expected_updated_at is null
     or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE_WRITE';
  end if;

  begin
    v_name := case when p_patch ? 'name' then trim(p_patch->>'name') else v_row.name end;
    v_phone := case when p_patch ? 'phone' then nullif(trim(p_patch->>'phone'), '') else v_row.phone end;
    v_active := case when p_patch ? 'active' then (p_patch->>'active')::boolean else v_row.active end;
  exception when others then
    raise exception 'INVALID_STAFF';
  end;
  if v_name is null or char_length(v_name) not between 2 and 120
     or (v_phone is not null and char_length(v_phone) > 40)
     or v_active is null then
    raise exception 'INVALID_STAFF';
  end if;

  update public.staff_profiles sp
  set name = v_name, phone = v_phone, active = v_active
  where sp.business_id = p_business_id and sp.id = p_staff_id
  returning * into v_row;
  return v_row;
end
$$;

create or replace function public.set_staff_service_guarded(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_active boolean,
  p_expected_updated_at timestamptz default null
)
returns public.staff_services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_services;
  v_exists boolean := false;
  v_count integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_active is null then raise exception 'INVALID_ASSIGNMENT'; end if;

  perform pg_advisory_xact_lock(hashtextextended('f10-04:assignments:' || p_business_id::text, 0));
  select * into v_row
  from public.staff_services ss
  where ss.business_id = p_business_id
    and ss.staff_id = p_staff_id
    and ss.service_id = p_service_id
  for update;
  v_exists := found;

  if v_exists and (
       p_expected_updated_at is null
       or v_row.updated_at is distinct from p_expected_updated_at
     ) then
    raise exception 'STALE_WRITE';
  end if;
  if not v_exists and p_expected_updated_at is not null then
    raise exception 'STALE_WRITE';
  end if;

  if p_active and not exists (
      select 1 from public.staff_profiles sp
      where sp.business_id = p_business_id and sp.id = p_staff_id and sp.active
    ) then
    raise exception 'STAFF_NOT_FOUND';
  end if;
  if p_active and not exists (
      select 1 from public.services s
      where s.business_id = p_business_id and s.id = p_service_id and s.active
    ) then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  if not v_exists then
    if not exists (
      select 1 from public.staff_profiles sp
      where sp.business_id = p_business_id and sp.id = p_staff_id
    ) or not exists (
      select 1 from public.services s
      where s.business_id = p_business_id and s.id = p_service_id
    ) then
      raise exception 'ASSIGNMENT_NOT_FOUND';
    end if;
    select count(*) into v_count
    from public.staff_services ss where ss.business_id = p_business_id;
    if v_count >= 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;
    insert into public.staff_services(business_id, staff_id, service_id, active)
    values(p_business_id, p_staff_id, p_service_id, p_active)
    returning * into v_row;
  else
    update public.staff_services ss
    set active = p_active
    where ss.business_id = p_business_id
      and ss.staff_id = p_staff_id
      and ss.service_id = p_service_id
    returning * into v_row;
  end if;
  return v_row;
end
$$;

create or replace function public.replace_business_hours_guarded(
  p_business_id uuid,
  p_weekday smallint,
  p_intervals jsonb,
  p_expected_intervals jsonb default null
)
returns setof public.business_hours
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current jsonb;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_weekday is null or p_weekday < 0 or p_weekday > 6
     or p_intervals is null or jsonb_typeof(p_intervals) <> 'array'
     or jsonb_array_length(p_intervals) > 8
     or (p_expected_intervals is not null and (
       jsonb_typeof(p_expected_intervals) <> 'array'
       or jsonb_array_length(p_expected_intervals) > 8
     )) then
    raise exception 'INVALID_INTERVALS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:business-hours:' || p_business_id::text || ':' || p_weekday::text, 0
  ));
  select coalesce(jsonb_agg(jsonb_build_object(
    'start', to_char(h.starts_local, 'HH24:MI'),
    'end', to_char(h.ends_local, 'HH24:MI')
  ) order by h.starts_local, h.ends_local), '[]'::jsonb)
  into v_current
  from public.business_hours h
  where h.business_id = p_business_id and h.weekday = p_weekday and h.active;

  if p_expected_intervals is null and v_current <> '[]'::jsonb then
    raise exception 'STALE_WRITE';
  end if;
  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
    raise exception 'STALE_WRITE';
  end if;

  return query select * from public.replace_business_hours(p_business_id, p_weekday, p_intervals);
end
$$;

create or replace function public.replace_staff_hours_guarded(
  p_business_id uuid,
  p_staff_id uuid,
  p_weekday smallint,
  p_intervals jsonb,
  p_expected_intervals jsonb default null
)
returns setof public.staff_hours
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current jsonb;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_weekday is null or p_weekday < 0 or p_weekday > 6
     or p_intervals is null or jsonb_typeof(p_intervals) <> 'array'
     or jsonb_array_length(p_intervals) > 8
     or (p_expected_intervals is not null and (
       jsonb_typeof(p_expected_intervals) <> 'array'
       or jsonb_array_length(p_expected_intervals) > 8
     )) then
    raise exception 'INVALID_INTERVALS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:staff-hours:' || p_business_id::text || ':' || p_staff_id::text || ':' || p_weekday::text, 0
  ));
  select coalesce(jsonb_agg(jsonb_build_object(
    'start', to_char(h.starts_local, 'HH24:MI'),
    'end', to_char(h.ends_local, 'HH24:MI')
  ) order by h.starts_local, h.ends_local), '[]'::jsonb)
  into v_current
  from public.staff_hours h
  where h.business_id = p_business_id
    and h.staff_id = p_staff_id
    and h.weekday = p_weekday
    and h.active;

  if p_expected_intervals is null and v_current <> '[]'::jsonb then
    raise exception 'STALE_WRITE';
  end if;
  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
    raise exception 'STALE_WRITE';
  end if;

  return query select * from public.replace_staff_hours(
    p_business_id, p_staff_id, p_weekday, p_intervals
  );
end
$$;

revoke all on function public.update_service_guarded(uuid,uuid,timestamptz,jsonb)
  from public, anon, authenticated;
revoke all on function public.update_staff_guarded(uuid,uuid,timestamptz,jsonb)
  from public, anon, authenticated;
revoke all on function public.set_staff_service_guarded(uuid,uuid,uuid,boolean,timestamptz)
  from public, anon, authenticated;
revoke all on function public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.replace_staff_hours_guarded(uuid,uuid,smallint,jsonb,jsonb)
  from public, anon, authenticated;

grant execute on function public.update_service_guarded(uuid,uuid,timestamptz,jsonb)
  to authenticated;
grant execute on function public.update_staff_guarded(uuid,uuid,timestamptz,jsonb)
  to authenticated;
grant execute on function public.set_staff_service_guarded(uuid,uuid,uuid,boolean,timestamptz)
  to authenticated;
grant execute on function public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)
  to authenticated;
grant execute on function public.replace_staff_hours_guarded(uuid,uuid,smallint,jsonb,jsonb)
  to authenticated;

commit;
