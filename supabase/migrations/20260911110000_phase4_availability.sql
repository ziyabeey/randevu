begin;

-- Phase 4: weekly working windows, date-specific unavailable blocks and slot calculation.
-- Weekly breaks are represented by splitting a day into multiple open windows.

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- PostgreSQL extract(dow): Sunday=0
  starts_local time without time zone not null,
  ends_local time without time zone not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_local < ends_local),
  unique (business_id, id)
);

create table if not exists public.staff_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_local time without time zone not null,
  ends_local time without time zone not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_local < ends_local),
  unique (business_id, id),
  foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id)
    on delete cascade
);

create table if not exists public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (reason is null or char_length(reason) <= 240),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  unique (business_id, id),
  foreign key (business_id, staff_id)
    references public.staff_profiles(business_id, id)
    on delete cascade
);

create index if not exists business_hours_lookup_idx
  on public.business_hours (business_id, weekday, active, starts_local, ends_local);
create index if not exists staff_hours_lookup_idx
  on public.staff_hours (business_id, staff_id, weekday, active, starts_local, ends_local);
create index if not exists availability_blocks_lookup_idx
  on public.availability_blocks (business_id, staff_id, active, starts_at, ends_at);

drop trigger if exists business_hours_touch_updated_at on public.business_hours;
create trigger business_hours_touch_updated_at
before update on public.business_hours
for each row execute function public.touch_updated_at();

drop trigger if exists staff_hours_touch_updated_at on public.staff_hours;
create trigger staff_hours_touch_updated_at
before update on public.staff_hours
for each row execute function public.touch_updated_at();

drop trigger if exists availability_blocks_touch_updated_at on public.availability_blocks;
create trigger availability_blocks_touch_updated_at
before update on public.availability_blocks
for each row execute function public.touch_updated_at();

-- Reject unknown IANA timezone names whenever a business is created or its timezone changes.
create or replace function public.validate_business_timezone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE: %', new.timezone;
  end if;
  return new;
end
$$;

do $$
begin
  if exists (
    select 1 from public.businesses b
    where not exists (select 1 from pg_timezone_names z where z.name = b.timezone)
  ) then
    raise exception 'Existing business contains an invalid timezone';
  end if;
end
$$;

drop trigger if exists businesses_validate_timezone on public.businesses;
create trigger businesses_validate_timezone
before insert or update of timezone on public.businesses
for each row execute function public.validate_business_timezone();

alter table public.business_hours enable row level security;
alter table public.staff_hours enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.business_hours force row level security;
alter table public.staff_hours force row level security;
alter table public.availability_blocks force row level security;

drop policy if exists business_hours_select_member on public.business_hours;
create policy business_hours_select_member on public.business_hours
for select to authenticated
using (public.is_active_member(business_id));

drop policy if exists staff_hours_select_member on public.staff_hours;
create policy staff_hours_select_member on public.staff_hours
for select to authenticated
using (public.is_active_member(business_id));

drop policy if exists availability_blocks_select_member on public.availability_blocks;
create policy availability_blocks_select_member on public.availability_blocks
for select to authenticated
using (public.is_active_member(business_id));

revoke all on public.business_hours, public.staff_hours, public.availability_blocks from anon;
revoke all on public.business_hours, public.staff_hours, public.availability_blocks from authenticated;
grant select on public.business_hours, public.staff_hours, public.availability_blocks to authenticated;

-- Atomic replacement avoids half-written schedules if validation fails midway.
create or replace function public.replace_business_hours(
  p_business_id uuid,
  p_weekday smallint,
  p_intervals jsonb
)
returns setof public.business_hours
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_start time;
  v_end time;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'INVALID_WEEKDAY';
  end if;
  if jsonb_typeof(p_intervals) <> 'array' then
    raise exception 'INVALID_INTERVALS';
  end if;

  delete from public.business_hours
  where business_id = p_business_id and weekday = p_weekday;

  for v_item in select value from jsonb_array_elements(p_intervals)
  loop
    begin
      v_start := (v_item ->> 'start')::time;
      v_end := (v_item ->> 'end')::time;
    exception when others then
      raise exception 'INVALID_TIME';
    end;

    if v_start is null or v_end is null or v_start >= v_end then
      raise exception 'INVALID_INTERVAL';
    end if;

    if exists (
      select 1 from public.business_hours h
      where h.business_id = p_business_id
        and h.weekday = p_weekday
        and h.active
        and h.starts_local < v_end
        and v_start < h.ends_local
    ) then
      raise exception 'OVERLAPPING_INTERVALS';
    end if;

    insert into public.business_hours(business_id, weekday, starts_local, ends_local)
    values(p_business_id, p_weekday, v_start, v_end);
  end loop;

  return query
  select h.* from public.business_hours h
  where h.business_id = p_business_id and h.weekday = p_weekday
  order by h.starts_local;
end
$$;

create or replace function public.replace_staff_hours(
  p_business_id uuid,
  p_staff_id uuid,
  p_weekday smallint,
  p_intervals jsonb
)
returns setof public.staff_hours
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_start time;
  v_end time;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if not exists (
    select 1 from public.staff_profiles s
    where s.business_id = p_business_id and s.id = p_staff_id and s.active
  ) then
    raise exception 'STAFF_NOT_FOUND';
  end if;
  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'INVALID_WEEKDAY';
  end if;
  if jsonb_typeof(p_intervals) <> 'array' then
    raise exception 'INVALID_INTERVALS';
  end if;

  delete from public.staff_hours
  where business_id = p_business_id and staff_id = p_staff_id and weekday = p_weekday;

  for v_item in select value from jsonb_array_elements(p_intervals)
  loop
    begin
      v_start := (v_item ->> 'start')::time;
      v_end := (v_item ->> 'end')::time;
    exception when others then
      raise exception 'INVALID_TIME';
    end;

    if v_start is null or v_end is null or v_start >= v_end then
      raise exception 'INVALID_INTERVAL';
    end if;

    if exists (
      select 1 from public.staff_hours h
      where h.business_id = p_business_id
        and h.staff_id = p_staff_id
        and h.weekday = p_weekday
        and h.active
        and h.starts_local < v_end
        and v_start < h.ends_local
    ) then
      raise exception 'OVERLAPPING_INTERVALS';
    end if;

    insert into public.staff_hours(business_id, staff_id, weekday, starts_local, ends_local)
    values(p_business_id, p_staff_id, p_weekday, v_start, v_end);
  end loop;

  return query
  select h.* from public.staff_hours h
  where h.business_id = p_business_id and h.staff_id = p_staff_id and h.weekday = p_weekday
  order by h.starts_local;
end
$$;

-- A block with equal local start/end means the full local day.
-- If end is earlier than start, the block continues into the next local day.
create or replace function public.create_availability_block_local(
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
  v_timezone text;
  v_end_date date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_row public.availability_blocks;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_staff_id is not null and not exists (
    select 1 from public.staff_profiles s
    where s.business_id = p_business_id and s.id = p_staff_id and s.active
  ) then
    raise exception 'STAFF_NOT_FOUND';
  end if;
  if p_reason is not null and char_length(p_reason) > 240 then
    raise exception 'REASON_TOO_LONG';
  end if;

  select timezone into v_timezone
  from public.businesses
  where id = p_business_id;

  if v_timezone is null then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;

  v_end_date := case when p_end_local <= p_start_local then p_date + 1 else p_date end;
  v_start_at := (p_date + p_start_local) at time zone v_timezone;
  v_end_at := (v_end_date + p_end_local) at time zone v_timezone;

  if v_start_at >= v_end_at then
    raise exception 'INVALID_BLOCK';
  end if;

  insert into public.availability_blocks(business_id, staff_id, starts_at, ends_at, reason)
  values(p_business_id, p_staff_id, v_start_at, v_end_at, nullif(trim(p_reason), ''))
  returning * into v_row;

  return v_row;
end
$$;

create or replace function public.delete_availability_block(
  p_business_id uuid,
  p_block_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null or not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  delete from public.availability_blocks
  where business_id = p_business_id and id = p_block_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end
$$;

-- Slot rules:
-- * weekly business and staff windows are intersected;
-- * gaps between weekly windows are breaks;
-- * business blocks (staff_id null) and staff-specific blocks subtract time;
-- * service duration plus before/after buffers must fully fit;
-- * slots advance independently by p_step_minutes;
-- * local windows are converted to timestamptz before generate_series.
--   Therefore nonexistent spring-forward wall times are never emitted, while
--   repeated fall-back wall times become two distinct instants with different offsets.
create or replace function public.compute_availability_slots(
  p_business_id uuid,
  p_service_id uuid,
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
security invoker
set search_path = public
as $$
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

  return query
  with service_cfg as (
    select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    from public.services s
    where s.business_id = p_business_id
      and s.id = p_service_id
      and s.active
  ),
  business_cfg as (
    select b.timezone
    from public.businesses b
    where b.id = p_business_id
  ),
  eligible_staff as (
    select sp.id, sp.name
    from public.staff_profiles sp
    join public.staff_services ss
      on ss.business_id = sp.business_id
     and ss.staff_id = sp.id
     and ss.service_id = p_service_id
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
      least(bh.ends_local, sh.ends_local) as local_end,
      bc.timezone,
      sc.duration_minutes,
      sc.buffer_before_minutes,
      sc.buffer_after_minutes
    from eligible_staff es
    cross join service_cfg sc
    cross join business_cfg bc
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
      (p_date + lw.local_start) at time zone lw.timezone as window_start,
      (p_date + lw.local_end) at time zone lw.timezone as window_end
    from local_windows lw
  ),
  candidate_slots as (
    select
      aw.staff_id,
      aw.staff_name,
      aw.timezone,
      aw.duration_minutes,
      aw.buffer_before_minutes,
      aw.buffer_after_minutes,
      gs as service_start,
      gs + make_interval(mins => aw.duration_minutes) as service_end,
      gs - make_interval(mins => aw.buffer_before_minutes) as occupied_start,
      gs + make_interval(mins => aw.duration_minutes + aw.buffer_after_minutes) as occupied_end
    from absolute_windows aw
    cross join lateral generate_series(
      aw.window_start + make_interval(mins => aw.buffer_before_minutes),
      aw.window_end - make_interval(mins => aw.duration_minutes + aw.buffer_after_minutes),
      make_interval(mins => p_step_minutes)
    ) gs
    where aw.window_start < aw.window_end
  )
  select distinct
    cs.staff_id,
    cs.staff_name,
    cs.service_start,
    cs.service_end,
    cs.timezone
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
  order by cs.service_start, cs.staff_name, cs.staff_id;
end
$$;

revoke all on function public.validate_business_timezone() from public;
revoke all on function public.replace_business_hours(uuid,smallint,jsonb) from public;
revoke all on function public.replace_staff_hours(uuid,uuid,smallint,jsonb) from public;
revoke all on function public.create_availability_block_local(uuid,uuid,date,time,time,text) from public;
revoke all on function public.delete_availability_block(uuid,uuid) from public;
revoke all on function public.compute_availability_slots(uuid,uuid,date,uuid,integer) from public;

grant execute on function public.replace_business_hours(uuid,smallint,jsonb) to authenticated;
grant execute on function public.replace_staff_hours(uuid,uuid,smallint,jsonb) to authenticated;
grant execute on function public.create_availability_block_local(uuid,uuid,date,time,time,text) to authenticated;
grant execute on function public.delete_availability_block(uuid,uuid) to authenticated;
grant execute on function public.compute_availability_slots(uuid,uuid,date,uuid,integer) to authenticated;

commit;
