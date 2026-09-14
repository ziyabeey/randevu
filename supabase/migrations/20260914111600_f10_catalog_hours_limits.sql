begin;

-- Guarded RPCs are also direct authenticated Data API surfaces, so Worker-side
-- array limits are repeated here. This prevents bypass callers from pushing a
-- tenant past the bounded F10-03 onboarding snapshot.
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
declare
  v_count integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:availability-blocks:' || p_business_id::text, 0
  ));
  select count(*) into v_count
  from public.availability_blocks b
  where b.business_id = p_business_id and b.active;
  if v_count >= 100 then
    raise exception 'AVAILABILITY_BLOCKS_LIMIT_EXCEEDED';
  end if;
  return public.create_availability_block_local(
    p_business_id, p_staff_id, p_date, p_start_local, p_end_local, p_reason
  );
end
$$;

revoke all on function public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.replace_staff_hours_guarded(uuid,uuid,smallint,jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.create_availability_block_local_guarded(uuid,uuid,date,time,time,text)
  from public, anon, authenticated;
grant execute on function public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)
  to authenticated;
grant execute on function public.replace_staff_hours_guarded(uuid,uuid,smallint,jsonb,jsonb)
  to authenticated;
grant execute on function public.create_availability_block_local_guarded(uuid,uuid,date,time,time,text)
  to authenticated;

commit;
