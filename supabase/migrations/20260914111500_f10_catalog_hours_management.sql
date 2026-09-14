begin;

-- F10-04 keeps the existing catalog tables and availability model. Mutations move
-- behind standard-session, tenant-scoped RPCs so recovery bearers and direct Data
-- API writes cannot bypass the Worker boundary. Catalog snapshots retain S07's
-- max+1 budgets and gain optimistic-concurrency timestamps additively.
create or replace function public.get_catalog_snapshot(p_business_id uuid)
returns table(
  services jsonb,
  staff jsonb,
  assignments jsonb
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_user uuid := auth.uid();
  v_services jsonb := '[]'::jsonb;
  v_staff jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_service_count integer := 0;
  v_staff_count integer := 0;
  v_assignment_count integer := 0;
begin
  if v_user is null or not exists (
    select 1
    from public.memberships m
    where m.business_id = p_business_id
      and m.user_id = v_user
      and m.active
  ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'name', q.name,
      'duration_minutes', q.duration_minutes,
      'buffer_before_minutes', q.buffer_before_minutes,
      'buffer_after_minutes', q.buffer_after_minutes,
      'price_minor', q.price_minor,
      'currency', q.currency,
      'active', q.active,
      'updated_at', q.updated_at
    ) order by q.created_at, q.id), '[]'::jsonb)
  into v_service_count, v_services
  from (
    select sv.id, sv.name, sv.duration_minutes, sv.buffer_before_minutes,
      sv.buffer_after_minutes, sv.price_minor, sv.currency, sv.active,
      sv.created_at, sv.updated_at
    from public.services sv
    where sv.business_id = p_business_id
    order by sv.created_at, sv.id
    limit 101
  ) q;
  if v_service_count > 100 then raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED'; end if;

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'membership_id', q.membership_id,
      'name', q.name,
      'phone', q.phone,
      'active', q.active,
      'updated_at', q.updated_at
    ) order by q.created_at, q.id), '[]'::jsonb)
  into v_staff_count, v_staff
  from (
    select sp.id, sp.membership_id, sp.name, sp.phone, sp.active,
      sp.created_at, sp.updated_at
    from public.staff_profiles sp
    where sp.business_id = p_business_id
    order by sp.created_at, sp.id
    limit 101
  ) q;
  if v_staff_count > 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', q.staff_id,
      'service_id', q.service_id,
      'active', q.active,
      'updated_at', q.updated_at
    ) order by q.staff_id, q.service_id), '[]'::jsonb)
  into v_assignment_count, v_assignments
  from (
    select ss.staff_id, ss.service_id, ss.active, ss.updated_at
    from public.staff_services ss
    where ss.business_id = p_business_id
    order by ss.staff_id, ss.service_id
    limit 5001
  ) q;
  if v_assignment_count > 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;

  return query select v_services, v_staff, v_assignments;
end
$$;

revoke all on function public.get_catalog_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_catalog_snapshot(uuid) to authenticated;

create or replace function public.create_service_guarded(
  p_business_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_buffer_before_minutes integer,
  p_buffer_after_minutes integer,
  p_price_minor integer
)
returns public.services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.services;
  v_count integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 120
     or p_duration_minutes not between 5 and 720
     or p_buffer_before_minutes not between 0 and 240
     or p_buffer_after_minutes not between 0 and 240
     or p_price_minor not between 0 and 100000000 then
    raise exception 'INVALID_SERVICE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));
  select count(*) into v_count from public.services s where s.business_id = p_business_id;
  if v_count >= 100 then raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED'; end if;

  insert into public.services(
    business_id, name, duration_minutes, buffer_before_minutes,
    buffer_after_minutes, price_minor, currency
  ) values (
    p_business_id, trim(p_name), p_duration_minutes, p_buffer_before_minutes,
    p_buffer_after_minutes, p_price_minor, 'TRY'
  ) returning * into v_row;
  return v_row;
end
$$;

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
  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
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

create or replace function public.create_staff_guarded(
  p_business_id uuid,
  p_name text,
  p_phone text default null
)
returns public.staff_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.staff_profiles;
  v_phone text := nullif(trim(p_phone), '');
  v_count integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 120
     or (v_phone is not null and char_length(v_phone) > 40) then
    raise exception 'INVALID_STAFF';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('f10-04:staff:' || p_business_id::text, 0));
  select count(*) into v_count from public.staff_profiles sp where sp.business_id = p_business_id;
  if v_count >= 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;

  insert into public.staff_profiles(business_id, name, phone)
  values(p_business_id, trim(p_name), v_phone)
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
  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then
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

  if v_exists and p_expected_updated_at is not null
     and v_row.updated_at is distinct from p_expected_updated_at then
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

-- Schedule replacements remain atomic but now support an optional expected
-- snapshot. F10-03 callers can omit it; F10-04 editors send it and receive a
-- deterministic STALE_WRITE instead of silently overwriting another manager.
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
  if p_expected_intervals is not null and jsonb_typeof(p_expected_intervals) <> 'array' then
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
  if p_expected_intervals is not null and jsonb_typeof(p_expected_intervals) <> 'array' then
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
  if p_expected_intervals is not null and v_current is distinct from p_expected_intervals then
    raise exception 'STALE_WRITE';
  end if;
  return query select * from public.replace_staff_hours(
    p_business_id, p_staff_id, p_weekday, p_intervals
  );
end
$$;

create or replace function public.create_availability_block_local_guarded(
  p_business_id uuid,
  p_staff_id uuid,
  p_date date,
  p_start_local time,
  p_end_local time,
  p_reason text default null
)
returns public.availability_blocks
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return public.create_availability_block_local(
    p_business_id, p_staff_id, p_date, p_start_local, p_end_local, p_reason
  );
end
$$;

create or replace function public.delete_availability_block_guarded(
  p_business_id uuid,
  p_block_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return public.delete_availability_block(p_business_id, p_block_id);
end
$$;

-- Direct table mutations and the pre-F10 schedule RPCs cease to be browser API
-- surfaces. SELECT remains available under RLS for accepted bounded read paths.
revoke insert, update, delete on public.services, public.staff_profiles, public.staff_services
  from authenticated;
grant select on public.services, public.staff_profiles, public.staff_services to authenticated;

revoke all on function public.replace_business_hours(uuid,smallint,jsonb)
  from public, anon, authenticated;
revoke all on function public.replace_staff_hours(uuid,uuid,smallint,jsonb)
  from public, anon, authenticated;
revoke all on function public.create_availability_block_local(uuid,uuid,date,time,time,text)
  from public, anon, authenticated;
revoke all on function public.delete_availability_block(uuid,uuid)
  from public, anon, authenticated;

revoke all on function public.create_service_guarded(uuid,text,integer,integer,integer,integer)
  from public, anon, authenticated;
revoke all on function public.update_service_guarded(uuid,uuid,timestamptz,jsonb)
  from public, anon, authenticated;
revoke all on function public.create_staff_guarded(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.update_staff_guarded(uuid,uuid,timestamptz,jsonb)
  from public, anon, authenticated;
revoke all on function public.set_staff_service_guarded(uuid,uuid,uuid,boolean,timestamptz)
  from public, anon, authenticated;
revoke all on function public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.replace_staff_hours_guarded(uuid,uuid,smallint,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.create_availability_block_local_guarded(uuid,uuid,date,time,time,text)
  from public, anon, authenticated;
revoke all on function public.delete_availability_block_guarded(uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.create_service_guarded(uuid,text,integer,integer,integer,integer)
  to authenticated;
grant execute on function public.update_service_guarded(uuid,uuid,timestamptz,jsonb)
  to authenticated;
grant execute on function public.create_staff_guarded(uuid,text,text)
  to authenticated;
grant execute on function public.update_staff_guarded(uuid,uuid,timestamptz,jsonb)
  to authenticated;
grant execute on function public.set_staff_service_guarded(uuid,uuid,uuid,boolean,timestamptz)
  to authenticated;
grant execute on function public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)
  to authenticated;
grant execute on function public.replace_staff_hours_guarded(uuid,uuid,smallint,jsonb,jsonb)
  to authenticated;
grant execute on function public.create_availability_block_local_guarded(uuid,uuid,date,time,time,text)
  to authenticated;
grant execute on function public.delete_availability_block_guarded(uuid,uuid)
  to authenticated;

commit;
