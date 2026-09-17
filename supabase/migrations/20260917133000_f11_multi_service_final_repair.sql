begin;

-- F11-02 final repair: processing-capacity snapshots, exact group inputs,
-- authoritative estimates, public gated group booking, and group notifications.

alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in (
    'create','public_create','reschedule','status','public_reschedule','public_cancel',
    'create_group','public_create_group'
  ));

-- ---------------------------------------------------------------------------
-- HOLD / RELEASE processing-capacity contract.
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column if not exists processing_capacity_policy text,
  add column if not exists processing_policy_version integer;

update public.businesses
set processing_capacity_policy = coalesce(processing_capacity_policy, 'HOLD'),
    processing_policy_version = coalesce(processing_policy_version, 1)
where processing_capacity_policy is null or processing_policy_version is null;

alter table public.businesses
  alter column processing_capacity_policy set default 'HOLD',
  alter column processing_capacity_policy set not null,
  alter column processing_policy_version set default 1,
  alter column processing_policy_version set not null;

alter table public.businesses
  drop constraint if exists businesses_processing_capacity_policy_check,
  add constraint businesses_processing_capacity_policy_check
    check (processing_capacity_policy in ('HOLD','RELEASE')),
  drop constraint if exists businesses_processing_policy_version_check,
  add constraint businesses_processing_policy_version_check
    check (processing_policy_version > 0);

alter table public.services
  add column if not exists processing_capacity_policy text,
  add column if not exists passive_wait_minutes integer,
  add column if not exists processing_policy_version integer;

update public.services
set passive_wait_minutes = coalesce(passive_wait_minutes, 0),
    processing_policy_version = coalesce(processing_policy_version, 1)
where passive_wait_minutes is null or processing_policy_version is null;

alter table public.services
  alter column passive_wait_minutes set default 0,
  alter column passive_wait_minutes set not null,
  alter column processing_policy_version set default 1,
  alter column processing_policy_version set not null;

alter table public.services
  drop constraint if exists services_processing_capacity_policy_check,
  add constraint services_processing_capacity_policy_check
    check (processing_capacity_policy is null or processing_capacity_policy in ('HOLD','RELEASE')),
  drop constraint if exists services_passive_wait_minutes_check,
  add constraint services_passive_wait_minutes_check
    check (passive_wait_minutes >= 0 and passive_wait_minutes < duration_minutes),
  drop constraint if exists services_processing_policy_version_check,
  add constraint services_processing_policy_version_check
    check (processing_policy_version > 0);

create or replace function public.f11_bump_business_processing_policy_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.processing_capacity_policy := upper(trim(coalesce(new.processing_capacity_policy, 'HOLD')));
  if tg_op = 'INSERT' then
    new.processing_policy_version := 1;
  elsif new.processing_capacity_policy is distinct from old.processing_capacity_policy then
    new.processing_policy_version := old.processing_policy_version + 1;
  else
    new.processing_policy_version := old.processing_policy_version;
  end if;
  return new;
end
$$;

revoke all on function public.f11_bump_business_processing_policy_version()
  from public, anon, authenticated;

drop trigger if exists businesses_f11_processing_policy_version on public.businesses;
create trigger businesses_f11_processing_policy_version
before insert or update of processing_capacity_policy, processing_policy_version
on public.businesses
for each row execute function public.f11_bump_business_processing_policy_version();

create or replace function public.f11_bump_service_processing_policy_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.processing_capacity_policy := case
    when new.processing_capacity_policy is null then null
    else upper(trim(new.processing_capacity_policy))
  end;
  new.passive_wait_minutes := coalesce(new.passive_wait_minutes, 0);
  if new.passive_wait_minutes < 0 or new.passive_wait_minutes >= new.duration_minutes then
    raise exception 'INVALID_PROCESSING_POLICY';
  end if;

  if tg_op = 'INSERT' then
    new.processing_policy_version := 1;
  elsif new.processing_capacity_policy is distinct from old.processing_capacity_policy
     or new.passive_wait_minutes is distinct from old.passive_wait_minutes
     or new.duration_minutes is distinct from old.duration_minutes then
    new.processing_policy_version := old.processing_policy_version + 1;
  else
    new.processing_policy_version := old.processing_policy_version;
  end if;
  return new;
end
$$;

revoke all on function public.f11_bump_service_processing_policy_version()
  from public, anon, authenticated;

drop trigger if exists services_f11_processing_policy_version on public.services;
create trigger services_f11_processing_policy_version
before insert or update of
  processing_capacity_policy, passive_wait_minutes, duration_minutes, processing_policy_version
on public.services
for each row execute function public.f11_bump_service_processing_policy_version();

alter table public.appointments
  add column if not exists processing_capacity_policy_snapshot text,
  add column if not exists passive_wait_minutes_snapshot integer,
  add column if not exists processing_policy_version_snapshot bigint;

update public.appointments a
set processing_capacity_policy_snapshot = coalesce(a.processing_capacity_policy_snapshot, 'HOLD'),
    passive_wait_minutes_snapshot = coalesce(a.passive_wait_minutes_snapshot, 0),
    processing_policy_version_snapshot = coalesce(a.processing_policy_version_snapshot, 1000001)
where a.processing_capacity_policy_snapshot is null
   or a.passive_wait_minutes_snapshot is null
   or a.processing_policy_version_snapshot is null;

alter table public.appointments
  alter column processing_capacity_policy_snapshot set not null,
  alter column passive_wait_minutes_snapshot set not null,
  alter column processing_policy_version_snapshot set not null,
  drop constraint if exists appointments_processing_capacity_policy_snapshot_check,
  add constraint appointments_processing_capacity_policy_snapshot_check
    check (processing_capacity_policy_snapshot in ('HOLD','RELEASE')),
  drop constraint if exists appointments_passive_wait_minutes_snapshot_check,
  add constraint appointments_passive_wait_minutes_snapshot_check
    check (passive_wait_minutes_snapshot >= 0 and passive_wait_minutes_snapshot < duration_minutes_snapshot),
  drop constraint if exists appointments_processing_policy_version_snapshot_check,
  add constraint appointments_processing_policy_version_snapshot_check
    check (processing_policy_version_snapshot > 0);

-- The historical single-service invariant forced staff occupancy to extend to
-- the customer-facing service end. RELEASE deliberately permits occupancy to
-- end during a passive tail wait. Replace only that exact legacy CHECK.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.appointments'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%ends_at <= occupied_ends_at%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.appointments drop constraint %I', v_name);
  end if;
end
$$;

alter table public.appointments
  drop constraint if exists appointments_processing_occupancy_end_check,
  add constraint appointments_processing_occupancy_end_check
  check (
    processing_capacity_policy_snapshot = 'RELEASE'
    or ends_at <= occupied_ends_at
  );

create or replace function public.f11_validate_processing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_service public.services;
  v_business public.businesses;
  v_policy text;
  v_version bigint;
begin
  if tg_op = 'UPDATE' then
    if old.processing_capacity_policy_snapshot is distinct from new.processing_capacity_policy_snapshot
       or old.passive_wait_minutes_snapshot is distinct from new.passive_wait_minutes_snapshot
       or old.processing_policy_version_snapshot is distinct from new.processing_policy_version_snapshot then
      raise exception 'APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE';
    end if;
    return new;
  end if;

  select * into v_service
  from public.services s
  where s.business_id = new.business_id and s.id = new.service_id;
  select * into v_business
  from public.businesses b
  where b.id = new.business_id;
  if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;
  if v_business.id is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_policy := coalesce(v_service.processing_capacity_policy, v_business.processing_capacity_policy);
  v_version := v_business.processing_policy_version::bigint * 1000000
             + v_service.processing_policy_version::bigint;

  if new.processing_capacity_policy_snapshot is null then
    new.processing_capacity_policy_snapshot := v_policy;
  elsif new.processing_capacity_policy_snapshot <> v_policy then
    raise exception 'PROCESSING_POLICY_SNAPSHOT_MISMATCH';
  end if;
  if new.passive_wait_minutes_snapshot is null then
    new.passive_wait_minutes_snapshot := v_service.passive_wait_minutes;
  elsif new.passive_wait_minutes_snapshot <> v_service.passive_wait_minutes then
    raise exception 'PROCESSING_POLICY_SNAPSHOT_MISMATCH';
  end if;
  if new.processing_policy_version_snapshot is null then
    new.processing_policy_version_snapshot := v_version;
  elsif new.processing_policy_version_snapshot <> v_version then
    raise exception 'PROCESSING_POLICY_SNAPSHOT_MISMATCH';
  end if;
  return new;
end
$$;

revoke all on function public.f11_validate_processing_snapshot()
  from public, anon, authenticated;

drop trigger if exists appointments_f11_processing_snapshot on public.appointments;
create trigger appointments_f11_processing_snapshot
before insert or update on public.appointments
for each row execute function public.f11_validate_processing_snapshot();

-- ---------------------------------------------------------------------------
-- Exact active same-tenant line definitions with processing snapshots.
-- ---------------------------------------------------------------------------
create or replace function public.f11_group_line_defs_v2(
  p_business_id uuid,
  p_lines jsonb
)
returns table(
  line_ordinal smallint,
  service_id uuid,
  service_name text,
  duration_minutes integer,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  pinned_staff_id uuid,
  price_type text,
  price_min_minor integer,
  price_max_minor integer,
  price_minor integer,
  price_policy_version integer,
  currency text,
  processing_capacity_policy text,
  passive_wait_minutes integer,
  processing_policy_version bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_GROUP_LINES';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 then raise exception 'INVALID_GROUP_LINES'; end if;
  if v_count > public.f11_group_line_limit() then
    raise exception 'GROUP_LINE_LIMIT_EXCEEDED';
  end if;

  return query
  with requested as (
    select
      ord::smallint as line_ordinal,
      nullif(item->>'serviceId', '')::uuid as service_id,
      nullif(item->>'staffId', '')::uuid as pinned_staff_id
    from jsonb_array_elements(p_lines) with ordinality as t(item, ord)
  )
  select
    r.line_ordinal,
    s.id,
    s.name,
    s.duration_minutes,
    s.buffer_before_minutes,
    s.buffer_after_minutes,
    r.pinned_staff_id,
    s.price_type,
    s.price_min_minor,
    s.price_max_minor,
    s.price_minor,
    s.price_policy_version,
    s.currency,
    coalesce(s.processing_capacity_policy, b.processing_capacity_policy),
    s.passive_wait_minutes,
    b.processing_policy_version::bigint * 1000000 + s.processing_policy_version::bigint
  from requested r
  join public.services s
    on s.business_id = p_business_id
   and s.id = r.service_id
   and s.active
  join public.businesses b on b.id = s.business_id
  order by r.line_ordinal;
end
$$;

revoke all on function public.f11_group_line_defs_v2(uuid,jsonb)
  from public, anon, authenticated;

-- Rebuild the planner. RELEASE affects staff occupancy only; customer service
-- order remains sequential and the frozen service end remains unchanged.
create or replace function public.f11_plan_group_at(
  p_business_id uuid,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_ignore_group_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_date date;
  v_requested_count integer;
  v_valid_count integer;
  v_currency_count integer;
  v_currency text;
  v_estimate_min integer;
  v_estimate_max integer;
  v_line record;
  v_cursor timestamptz := p_starts_at;
  v_prev_staff uuid := null;
  v_prev_index integer := 0;
  v_staff_id uuid;
  v_staff_name text;
  v_service_start timestamptz;
  v_service_end timestamptz;
  v_staff_active_end timestamptz;
  v_occ_start timestamptz;
  v_occ_end timestamptz;
  v_plan jsonb := '[]'::jsonb;
  v_candidate record;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_GROUP_LINES';
  end if;
  v_requested_count := jsonb_array_length(p_lines);

  select
    count(*)::integer,
    count(distinct d.currency)::integer,
    min(d.currency),
    coalesce(sum(d.price_min_minor), 0)::integer,
    coalesce(sum(d.price_max_minor), 0)::integer
  into v_valid_count, v_currency_count, v_currency, v_estimate_min, v_estimate_max
  from public.f11_group_line_defs_v2(p_business_id, p_lines) d;

  if v_valid_count <> v_requested_count then
    raise exception 'SERVICE_NOT_FOUND';
  end if;
  if v_currency_count <> 1 then
    raise exception 'MIXED_CURRENCY';
  end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date := (p_starts_at at time zone v_timezone)::date;

  for v_line in select * from public.f11_group_line_defs_v2(p_business_id, p_lines) loop
    v_service_start := v_cursor;
    v_service_end := v_service_start + make_interval(mins => v_line.duration_minutes);
    v_staff_active_end := case
      when v_line.processing_capacity_policy = 'RELEASE'
        then v_service_end - make_interval(mins => v_line.passive_wait_minutes)
      else v_service_end
    end;
    v_staff_id := null;
    v_staff_name := null;

    if v_prev_staff is not null then
      v_occ_start := v_service_start;
      v_occ_end := v_staff_active_end + make_interval(mins => v_line.buffer_after_minutes);
      if (v_line.pinned_staff_id is null or v_line.pinned_staff_id = v_prev_staff)
         and public.f11_staff_slot_free(
               p_business_id, v_prev_staff, v_line.service_id, v_date,
               v_occ_start, v_occ_end, p_ignore_group_id) then
        select sp.name into v_staff_name
        from public.staff_profiles sp
        where sp.business_id = p_business_id and sp.id = v_prev_staff;
        v_staff_id := v_prev_staff;
      end if;
    end if;

    if v_staff_id is null then
      v_occ_start := v_service_start - make_interval(mins => v_line.buffer_before_minutes);
      v_occ_end := v_staff_active_end + make_interval(mins => v_line.buffer_after_minutes);
      for v_candidate in
        select sp.id, sp.name
        from public.staff_profiles sp
        join public.staff_services ss
          on ss.business_id = sp.business_id
         and ss.staff_id = sp.id
         and ss.service_id = v_line.service_id
         and ss.active
        where sp.business_id = p_business_id
          and sp.active
          and (v_line.pinned_staff_id is null or sp.id = v_line.pinned_staff_id)
        order by sp.name, sp.id
      loop
        if public.f11_staff_slot_free(
             p_business_id, v_candidate.id, v_line.service_id, v_date,
             v_occ_start, v_occ_end, p_ignore_group_id) then
          v_staff_id := v_candidate.id;
          v_staff_name := v_candidate.name;
          exit;
        end if;
      end loop;
    end if;

    if v_staff_id is null then return null; end if;

    if v_prev_staff is not null and v_staff_id = v_prev_staff then
      v_plan := jsonb_set(
        v_plan,
        array[(v_prev_index - 1)::text, 'occupiedEndsAt'],
        v_plan -> (v_prev_index - 1) -> 'staffActiveEndsAt'
      );
    end if;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'lineOrdinal', v_line.line_ordinal,
      'serviceId', v_line.service_id,
      'serviceName', v_line.service_name,
      'staffId', v_staff_id,
      'staffName', v_staff_name,
      'startsAt', v_service_start,
      'endsAt', v_service_end,
      'staffActiveEndsAt', v_staff_active_end,
      'occupiedStartsAt', v_occ_start,
      'occupiedEndsAt', v_occ_end,
      'durationMinutes', v_line.duration_minutes,
      'bufferBeforeMinutes', v_line.buffer_before_minutes,
      'bufferAfterMinutes', v_line.buffer_after_minutes,
      'processingCapacityPolicy', v_line.processing_capacity_policy,
      'passiveWaitMinutes', v_line.passive_wait_minutes,
      'processingPolicyVersion', v_line.processing_policy_version,
      'priceType', v_line.price_type,
      'priceMinMinor', v_line.price_min_minor,
      'priceMaxMinor', v_line.price_max_minor,
      'priceMinor', case when v_line.price_type = 'fixed' then v_line.price_minor else null end,
      'pricePolicyVersion', v_line.price_policy_version,
      'currency', v_line.currency
    ));

    v_prev_index := v_prev_index + 1;
    v_prev_staff := v_staff_id;
    v_cursor := v_service_end;
  end loop;

  if jsonb_array_length(v_plan) = 0 then return null; end if;

  return jsonb_build_object(
    'startsAt', p_starts_at,
    'endsAt', v_cursor,
    'timezone', v_timezone,
    'currency', v_currency,
    'estimateMinMinor', v_estimate_min,
    'estimateMaxMinor', v_estimate_max,
    'lines', v_plan
  );
end
$$;

revoke all on function public.f11_plan_group_at(uuid,jsonb,timestamptz,uuid)
  from public, anon, authenticated;

create or replace function public.f11_compute_group_slots_internal(
  p_business_id uuid,
  p_date date,
  p_lines jsonb,
  p_step_minutes integer
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  total_duration_minutes integer,
  currency text,
  estimate_min_minor integer,
  estimate_max_minor integer,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_requested_count integer;
  v_line_count integer;
  v_currency_count integer;
  v_total_minutes integer;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_candidates integer;
  v_probe integer;
  v_start timestamptz;
  v_plan jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_GROUP_LINES';
  end if;
  v_requested_count := jsonb_array_length(p_lines);
  select count(*)::integer,
         count(distinct d.currency)::integer,
         coalesce(sum(d.duration_minutes), 0)::integer
    into v_line_count, v_currency_count, v_total_minutes
  from public.f11_group_line_defs_v2(p_business_id, p_lines) d;

  if v_line_count <> v_requested_count then raise exception 'SERVICE_NOT_FOUND'; end if;
  if v_currency_count <> 1 then raise exception 'MIXED_CURRENCY'; end if;
  if p_step_minutes < 5 or p_step_minutes > 120 then raise exception 'INVALID_STEP'; end if;
  if p_date < current_date - 1 or p_date > current_date + 366 then raise exception 'DATE_OUT_OF_RANGE'; end if;

  select b.timezone into v_timezone from public.businesses b where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  select
    min((p_date + bh.starts_local) at time zone v_timezone),
    max((p_date + bh.ends_local) at time zone v_timezone)
  into v_window_start, v_window_end
  from public.business_hours bh
  where bh.business_id = p_business_id
    and bh.weekday = extract(dow from p_date)::smallint
    and bh.active;

  if v_window_start is null then return; end if;

  v_candidates := greatest(
    0,
    (extract(epoch from (v_window_end - make_interval(mins => v_total_minutes) - v_window_start))
      / (p_step_minutes * 60))::integer + 1
  );
  v_probe := v_candidates * v_line_count;
  if v_probe > public.f11_group_probe_budget() then
    raise exception 'GROUP_SLOT_BUDGET_EXCEEDED';
  end if;

  v_start := v_window_start;
  while v_start + make_interval(mins => v_total_minutes) <= v_window_end loop
    v_plan := public.f11_plan_group_at(p_business_id, p_lines, v_start, null);
    if v_plan is not null then
      starts_at := v_start;
      ends_at := (v_plan->>'endsAt')::timestamptz;
      timezone := v_timezone;
      total_duration_minutes := v_total_minutes;
      currency := v_plan->>'currency';
      estimate_min_minor := (v_plan->>'estimateMinMinor')::integer;
      estimate_max_minor := (v_plan->>'estimateMaxMinor')::integer;
      lines := v_plan->'lines';
      return next;
    end if;
    v_start := v_start + make_interval(mins => p_step_minutes);
  end loop;
  return;
end
$$;

revoke all on function public.f11_compute_group_slots_internal(uuid,date,jsonb,integer)
  from public, anon, authenticated;

drop function if exists public.compute_group_availability_slots(uuid,date,jsonb,integer);
create function public.compute_group_availability_slots(
  p_business_id uuid,
  p_date date,
  p_lines jsonb,
  p_step_minutes integer default 15
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  total_duration_minutes integer,
  currency text,
  estimate_min_minor integer,
  estimate_max_minor integer,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return query
  select * from public.f11_compute_group_slots_internal(
    p_business_id, p_date, p_lines, p_step_minutes
  );
end
$$;

revoke all on function public.compute_group_availability_slots(uuid,date,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.compute_group_availability_slots(uuid,date,jsonb,integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Canonical group payload + one shared atomic creation core.
-- ---------------------------------------------------------------------------
create or replace function public.f11_group_payload(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'groupId', g.id,
    'status', g.status,
    'source', g.source,
    'version', g.version,
    'customerId', g.customer_id,
    'startsAt', min(a.starts_at),
    'endsAt', max(a.ends_at),
    'timezone', min(a.timezone),
    'currency', min(a.currency_snapshot),
    'estimateMinMinor', sum(a.price_min_minor_snapshot)::integer,
    'estimateMaxMinor', sum(a.price_max_minor_snapshot)::integer,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'appointmentId', a.id,
      'lineOrdinal', a.line_ordinal,
      'serviceId', a.service_id,
      'serviceName', a.service_name_snapshot,
      'staffId', a.staff_id,
      'staffName', a.staff_name_snapshot,
      'status', a.status,
      'startsAt', a.starts_at,
      'endsAt', a.ends_at,
      'occupiedStartsAt', a.occupied_starts_at,
      'occupiedEndsAt', a.occupied_ends_at,
      'processingCapacityPolicy', a.processing_capacity_policy_snapshot,
      'passiveWaitMinutes', a.passive_wait_minutes_snapshot,
      'processingPolicyVersion', a.processing_policy_version_snapshot,
      'priceType', a.price_type_snapshot,
      'priceMinMinor', a.price_min_minor_snapshot,
      'priceMaxMinor', a.price_max_minor_snapshot,
      'priceMinor', a.price_minor_snapshot,
      'currency', a.currency_snapshot,
      'pricePolicyVersion', a.price_policy_version_snapshot
    ) order by a.line_ordinal), '[]'::jsonb)
  )
  from public.appointment_groups g
  join public.appointments a
    on a.business_id = g.business_id and a.group_id = g.id
  where g.business_id = p_business_id and g.id = p_group_id
  group by g.id, g.status, g.source, g.version, g.customer_id
  having count(distinct a.currency_snapshot) = 1
$$;

revoke all on function public.f11_group_payload(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.f11_create_group_internal(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_source text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_name text := trim(p_customer_name);
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_customer_email text := public.f10_normalize_customer_email(coalesce(p_customer_email, ''));
  v_notes text := nullif(trim(p_notes), '');
  v_requested_count integer;
  v_valid_count integer;
  v_currency_count integer;
  v_hash text;
  v_claim record;
  v_plan jsonb;
  v_line jsonb;
  v_customer_id uuid;
  v_group_id uuid;
  v_anchor_id uuid;
  v_timezone text;
  v_existing_group uuid;
  v_actor uuid := case when p_source = 'operator' then auth.uid() else null end;
begin
  if p_source not in ('operator','public') then raise exception 'INVALID_GROUP_SOURCE'; end if;
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_customer_email is not null and (char_length(v_customer_email) > 254 or position('@' in v_customer_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if p_source = 'public' and v_customer_phone is null and v_customer_email is null then
    raise exception 'PUBLIC_CONTACT_REQUIRED';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then raise exception 'NOTES_TOO_LONG'; end if;
  if p_starts_at is null then raise exception 'INVALID_START'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_GROUP_LINES'; end if;

  -- Binding fail-closed fence: exact requested cardinality and one currency are
  -- proven before command claim, customer resolution or any durable write.
  v_requested_count := jsonb_array_length(p_lines);
  select count(*)::integer, count(distinct d.currency)::integer
    into v_valid_count, v_currency_count
  from public.f11_group_line_defs_v2(p_business_id, p_lines) d;
  if v_valid_count <> v_requested_count then raise exception 'SERVICE_NOT_FOUND'; end if;
  if v_currency_count <> 1 then raise exception 'MIXED_CURRENCY'; end if;

  v_hash := md5(jsonb_build_object(
    'source', p_source,
    'customerName', v_customer_name,
    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,
    'lines', p_lines,
    'startsAt', p_starts_at,
    'notes', v_notes
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    p_business_id,
    p_idempotency_key,
    case when p_source = 'public' then 'public_create_group' else 'create_group' end,
    v_hash,
    null
  );

  if not v_claim.is_new then
    select a.group_id into v_existing_group
    from public.appointments a
    where a.business_id = p_business_id and a.id = v_claim.appointment_id;
    if v_existing_group is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return public.f11_group_payload(p_business_id, v_existing_group);
  end if;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
  if v_plan is null then raise exception 'GROUP_SLOT_UNAVAILABLE'; end if;
  v_timezone := v_plan->>'timezone';

  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id, v_customer_name, v_customer_phone, v_customer_email,
    null, v_actor, true
  );

  perform 1
  from public.staff_profiles sp
  where sp.business_id = p_business_id
    and sp.id in (
      select distinct (l->>'staffId')::uuid
      from jsonb_array_elements(v_plan->'lines') l
    )
  order by sp.id
  for update;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
  if v_plan is null then raise exception 'GROUP_SLOT_UNAVAILABLE'; end if;

  v_group_id := gen_random_uuid();
  insert into public.appointment_groups(
    id,business_id,customer_id,status,source,version,legacy_appointment_id,created_by
  ) values (
    v_group_id,p_business_id,v_customer_id,'scheduled',p_source,1,null,v_actor
  );

  set constraints appointments_staff_no_overlap deferred;

  for v_line in select * from jsonb_array_elements(v_plan->'lines') loop
    insert into public.appointments(
      business_id,customer_id,service_id,staff_id,status,source,
      group_id,line_ordinal,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
      service_name_snapshot,staff_name_snapshot,
      duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      processing_capacity_policy_snapshot,passive_wait_minutes_snapshot,processing_policy_version_snapshot,
      price_minor_snapshot,currency_snapshot,
      price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,price_policy_version_snapshot,
      notes,created_by
    ) values (
      p_business_id,v_customer_id,
      (v_line->>'serviceId')::uuid,(v_line->>'staffId')::uuid,'scheduled',p_source,
      v_group_id,(v_line->>'lineOrdinal')::smallint,
      (v_line->>'startsAt')::timestamptz,(v_line->>'endsAt')::timestamptz,
      (v_line->>'occupiedStartsAt')::timestamptz,(v_line->>'occupiedEndsAt')::timestamptz,
      v_timezone,
      v_customer_name,v_customer_phone,v_customer_email,
      v_line->>'serviceName',v_line->>'staffName',
      (v_line->>'durationMinutes')::integer,
      (v_line->>'bufferBeforeMinutes')::integer,
      (v_line->>'bufferAfterMinutes')::integer,
      v_line->>'processingCapacityPolicy',
      (v_line->>'passiveWaitMinutes')::integer,
      (v_line->>'processingPolicyVersion')::bigint,
      nullif(v_line->>'priceMinor','')::integer,
      v_line->>'currency',
      v_line->>'priceType',
      (v_line->>'priceMinMinor')::integer,
      (v_line->>'priceMaxMinor')::integer,
      (v_line->>'pricePolicyVersion')::integer,
      v_notes,v_actor
    )
    returning id into v_anchor_id;

    if (v_line->>'lineOrdinal')::integer <> 1 then
      v_anchor_id := (
        select a.id from public.appointments a
        where a.business_id = p_business_id and a.group_id = v_group_id and a.line_ordinal = 1
      );
    end if;
  end loop;

  begin
    set constraints appointments_staff_no_overlap immediate;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  select a.id into v_anchor_id
  from public.appointments a
  where a.business_id = p_business_id and a.group_id = v_group_id and a.line_ordinal = 1;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  ) values (
    p_business_id,v_anchor_id,'created',v_actor,
    case when p_source='public' then 'public' else 'member' end,
    null,'scheduled',
    jsonb_build_object(
      'startsAt',p_starts_at,
      'lineCount',jsonb_array_length(v_plan->'lines'),
      'currency',v_plan->>'currency',
      'estimateMinMinor',(v_plan->>'estimateMinMinor')::integer,
      'estimateMaxMinor',(v_plan->>'estimateMaxMinor')::integer,
      'lines',v_plan->'lines'
    )
  );

  update public.booking_commands
  set appointment_id = v_anchor_id
  where business_id = p_business_id and idempotency_key = p_idempotency_key;

  return public.f11_group_payload(p_business_id, v_group_id);
end
$$;

revoke all on function public.f11_create_group_internal(
  uuid,text,text,jsonb,timestamptz,text,text,text,text
) from public, anon, authenticated;

create or replace function public.create_appointment_group(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.f11_create_group_internal(
    p_business_id,p_idempotency_key,p_customer_name,p_lines,p_starts_at,
    'operator',p_customer_phone,p_customer_email,p_notes
  );
end
$$;

revoke all on function public.create_appointment_group(
  uuid,text,text,jsonb,timestamptz,text,text,text
) from public, anon, authenticated;
grant execute on function public.create_appointment_group(
  uuid,text,text,jsonb,timestamptz,text,text,text
) to authenticated;

-- ---------------------------------------------------------------------------
-- Public group planning / creation. These raw functions are internal-only;
-- execute_public_operation is the sole anon transport.
-- ---------------------------------------------------------------------------
create or replace function public.compute_public_group_availability_slots(
  p_slug text,
  p_date date,
  p_lines jsonb
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  total_duration_minutes integer,
  currency text,
  estimate_min_minor integer,
  estimate_max_minor integer,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_timezone text;
  v_enabled boolean;
  v_step integer;
  v_horizon integer;
  v_min_notice integer;
  v_today date;
begin
  select b.id,b.timezone,p.enabled,p.step_minutes,p.horizon_days,p.min_notice_minutes
  into v_business_id,v_timezone,v_enabled,v_step,v_horizon,v_min_notice
  from public.businesses b
  join public.public_booking_settings p on p.business_id=b.id
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug)=lower(trim(p_slug)) and r.publishable
  limit 1;

  if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
  if not v_enabled then raise exception 'PUBLIC_BOOKING_DISABLED'; end if;
  v_today := (now() at time zone v_timezone)::date;
  if p_date < v_today or p_date > v_today + v_horizon then raise exception 'DATE_OUT_OF_RANGE'; end if;

  return query
  select s.*
  from public.f11_compute_group_slots_internal(v_business_id,p_date,p_lines,v_step) s
  where s.starts_at >= now() + make_interval(mins => v_min_notice);
end
$$;

revoke all on function public.compute_public_group_availability_slots(text,date,jsonb)
  from public, anon, authenticated;

create or replace function public.create_public_appointment_group_with_recovery(
  p_slug text,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_management_token_hash text,
  p_recovery_id uuid,
  p_recovery_secret_hash text,
  p_management_token_ciphertext text,
  p_management_token_iv text,
  p_key_version smallint,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns table(
  appointment_id uuid,
  group_payload jsonb,
  recovery_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_business_id uuid;
  v_timezone text;
  v_enabled boolean;
  v_horizon integer;
  v_min_notice integer;
  v_today date;
  v_date date;
  v_deadline bigint;
  v_fence public.public_booking_resolution_closures;
  v_bootstrap public.public_booking_recoveries;
  v_payload jsonb;
  v_group_id uuid;
  v_anchor_id uuid;
  v_cap_hash text;
  v_expires_at timestamptz;
begin
  if p_idempotency_key is null
     or not public.public_booking_v2_key_matches(
       p_idempotency_key,p_recovery_id,p_recovery_secret_hash
     )
     or p_management_token_hash is null
     or p_management_token_hash !~ '^[0-9a-f]{64}$'
     or p_recovery_secret_hash is null
     or p_recovery_secret_hash !~ '^[0-9a-f]{64}$'
     or p_management_token_ciphertext is null
     or char_length(p_management_token_ciphertext) < 32
     or char_length(p_management_token_ciphertext) > 512
     or p_management_token_iv is null
     or char_length(p_management_token_iv) < 12
     or char_length(p_management_token_iv) > 64
     or p_key_version is null or p_key_version < 1 then
    raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP';
  end if;

  v_deadline := substr(p_idempotency_key,6,10)::bigint;
  if v_deadline > floor(extract(epoch from clock_timestamp()))::bigint + 330 then
    raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text,0));

  select f.* into v_fence
  from public.public_booking_resolution_closures f
  where f.idempotency_key=p_idempotency_key
  for key share;
  if found then raise exception 'BOOKING_INTENT_CLOSED'; end if;
  if clock_timestamp() >= to_timestamp(v_deadline::double precision) then
    raise exception 'BOOKING_INTENT_DEADLINE_EXPIRED';
  end if;

  select b.id,b.timezone,p.enabled,p.horizon_days,p.min_notice_minutes
  into v_business_id,v_timezone,v_enabled,v_horizon,v_min_notice
  from public.businesses b
  join public.public_booking_settings p on p.business_id=b.id
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug)=lower(trim(p_slug)) and r.publishable
  limit 1;

  if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
  if not v_enabled then raise exception 'PUBLIC_BOOKING_DISABLED'; end if;

  v_today := (now() at time zone v_timezone)::date;
  v_date := (p_starts_at at time zone v_timezone)::date;
  if v_date < v_today or v_date > v_today + v_horizon then raise exception 'DATE_OUT_OF_RANGE'; end if;
  if p_starts_at < now() + make_interval(mins => v_min_notice) then
    raise exception 'GROUP_SLOT_UNAVAILABLE';
  end if;

  begin
    insert into public.public_booking_recoveries(
      recovery_id,business_id,idempotency_key,
      management_token_hash,recovery_secret_hash,
      management_token_ciphertext,management_token_iv,key_version,expires_at
    ) values (
      p_recovery_id,v_business_id,p_idempotency_key,
      p_management_token_hash,p_recovery_secret_hash,
      p_management_token_ciphertext,p_management_token_iv,p_key_version,
      now()+interval '72 hours'
    )
    on conflict (business_id,idempotency_key) do nothing;
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  select * into v_bootstrap
  from public.public_booking_recoveries r
  where r.business_id=v_business_id and r.idempotency_key=p_idempotency_key;

  if v_bootstrap.recovery_id is null
     or v_bootstrap.recovery_id <> p_recovery_id
     or v_bootstrap.management_token_hash <> p_management_token_hash
     or v_bootstrap.recovery_secret_hash is distinct from p_recovery_secret_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  v_payload := public.f11_create_group_internal(
    v_business_id,p_idempotency_key,p_customer_name,p_lines,p_starts_at,
    'public',p_customer_phone,p_customer_email,p_notes
  );
  v_group_id := (v_payload->>'groupId')::uuid;

  select a.id into v_anchor_id
  from public.appointments a
  where a.business_id=v_business_id and a.group_id=v_group_id and a.line_ordinal=1;
  if v_anchor_id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;

  begin
    insert into public.appointment_management_capabilities(
      appointment_id,business_id,token_hash
    ) values (
      v_anchor_id,v_business_id,p_management_token_hash
    )
    on conflict on constraint appointment_management_capabilities_pkey do nothing;
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  select cap.token_hash into v_cap_hash
  from public.appointment_management_capabilities cap
  where cap.group_id=v_group_id and cap.business_id=v_business_id;
  if v_cap_hash is null or v_cap_hash <> p_management_token_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  update public.public_booking_recoveries r
  set appointment_id=v_anchor_id
  where r.recovery_id=p_recovery_id and r.business_id=v_business_id
    and (r.appointment_id is null or r.appointment_id=v_anchor_id);

  select r.expires_at into v_expires_at
  from public.public_booking_recoveries r
  where r.recovery_id=p_recovery_id and r.business_id=v_business_id
    and r.appointment_id=v_anchor_id;
  if v_expires_at is null then raise exception 'IDEMPOTENCY_CONFLICT'; end if;

  return query select v_anchor_id,v_payload,v_expires_at;
end
$$;

revoke all on function public.create_public_appointment_group_with_recovery(
  text,text,text,jsonb,timestamptz,text,uuid,text,text,text,smallint,text,text,text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Group-aware frozen outbox snapshot. One recovery bind -> one group job.
-- ---------------------------------------------------------------------------
alter table public.appointment_notification_jobs
  add column if not exists group_summary_snapshot jsonb,
  add column if not exists estimate_min_minor_snapshot integer,
  add column if not exists estimate_max_minor_snapshot integer;

alter table public.appointment_notification_jobs
  drop constraint if exists appointment_notification_jobs_group_estimate_check,
  add constraint appointment_notification_jobs_group_estimate_check
  check (
    (group_summary_snapshot is null
      and estimate_min_minor_snapshot is null
      and estimate_max_minor_snapshot is null)
    or
    (group_summary_snapshot is not null
      and estimate_min_minor_snapshot between 0 and 1000000000
      and estimate_max_minor_snapshot between 0 and 1000000000
      and estimate_min_minor_snapshot <= estimate_max_minor_snapshot)
  );

create or replace function public.create_public_booking_confirmation_event(
  p_business_id uuid,
  p_appointment_id uuid,
  p_recovery_id uuid,
  p_event_reason text default 'created'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_recovery public.public_booking_recoveries;
  v_email text;
  v_event_id uuid := gen_random_uuid();
  v_event_version integer;
  v_line_count integer;
  v_summary jsonb;
  v_estimate_min integer;
  v_estimate_max integer;
  v_currency text;
  v_service_label text;
  v_staff_label text;
  v_template integer;
begin
  if p_event_reason not in ('created','rescheduled') then
    raise exception 'INVALID_NOTIFICATION_EVENT_REASON';
  end if;

  select * into v_appointment
  from public.appointments a
  where a.business_id=p_business_id and a.id=p_appointment_id and a.source='public'
  for share;
  if v_appointment.id is null then raise exception 'NOTIFICATION_APPOINTMENT_NOT_FOUND'; end if;
  if v_appointment.status not in ('scheduled','confirmed') then
    raise exception 'NOTIFICATION_APPOINTMENT_NOT_ACTIVE';
  end if;

  select * into v_business from public.businesses b where b.id=p_business_id;
  select * into v_recovery
  from public.public_booking_recoveries r
  where r.recovery_id=p_recovery_id and r.business_id=p_business_id
    and r.group_id=v_appointment.group_id
  for share;

  v_email := nullif(btrim(v_appointment.customer_email_snapshot),'');
  if v_business.id is null or v_recovery.recovery_id is null or v_email is null then
    return null;
  end if;

  select count(*)::integer,
         sum(a.price_min_minor_snapshot)::integer,
         sum(a.price_max_minor_snapshot)::integer,
         min(a.currency_snapshot)
  into v_line_count,v_estimate_min,v_estimate_max,v_currency
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=v_appointment.group_id
    and a.status <> 'cancelled';

  if v_line_count > 1 then
    if (select count(distinct a.currency_snapshot)
        from public.appointments a
        where a.business_id=p_business_id and a.group_id=v_appointment.group_id
          and a.status <> 'cancelled') <> 1 then
      raise exception 'MIXED_CURRENCY';
    end if;

    select jsonb_build_object(
      'groupId',v_appointment.group_id,
      'lineCount',v_line_count,
      'currency',v_currency,
      'estimateMinMinor',v_estimate_min,
      'estimateMaxMinor',v_estimate_max,
      'lines',jsonb_agg(jsonb_build_object(
        'lineOrdinal',a.line_ordinal,
        'serviceName',a.service_name_snapshot,
        'staffName',a.staff_name_snapshot,
        'startsAt',a.starts_at,
        'endsAt',a.ends_at,
        'priceType',a.price_type_snapshot,
        'priceMinMinor',a.price_min_minor_snapshot,
        'priceMaxMinor',a.price_max_minor_snapshot
      ) order by a.line_ordinal)
    )
    into v_summary
    from public.appointments a
    where a.business_id=p_business_id and a.group_id=v_appointment.group_id
      and a.status <> 'cancelled';

    v_service_label := v_line_count::text || ' hizmet';
    v_staff_label := 'Birden fazla personel';
    v_template := 2;
  else
    v_summary := null;
    v_estimate_min := null;
    v_estimate_max := null;
    v_service_label := v_appointment.service_name_snapshot;
    v_staff_label := v_appointment.staff_name_snapshot;
    v_template := 1;
  end if;

  select coalesce(max(j.event_version),0)+1
  into v_event_version
  from public.appointment_notification_jobs j
  where j.group_id=v_appointment.group_id
    and j.kind='public_booking_confirmation'
    and j.channel='email';

  insert into public.appointment_notification_jobs(
    business_id,appointment_id,recovery_id,kind,channel,recipient,provider,state,
    available_at,retry_until,provider_idempotency_key,
    event_id,event_version,event_reason,template_version,is_current,
    business_name_snapshot,customer_name_snapshot,starts_at_snapshot,timezone_snapshot,
    service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot,
    delivery_certainty,group_summary_snapshot,estimate_min_minor_snapshot,estimate_max_minor_snapshot
  ) values (
    p_business_id,p_appointment_id,p_recovery_id,
    'public_booking_confirmation','email',v_email,'resend','pending',
    now(),least(v_recovery.expires_at,now()+interval '72 hours'),
    'public-booking-confirmation/'||v_event_id::text,
    v_event_id,v_event_version,p_event_reason,v_template,true,
    v_business.name,v_appointment.customer_name_snapshot,
    (select min(a.starts_at) from public.appointments a
      where a.business_id=p_business_id and a.group_id=v_appointment.group_id and a.status<>'cancelled'),
    v_appointment.timezone,
    v_service_label,v_staff_label,
    case when v_template=1 then v_appointment.price_minor_snapshot else 0 end,
    coalesce(v_currency,v_appointment.currency_snapshot),
    'unattempted',v_summary,v_estimate_min,v_estimate_max
  );

  return v_event_id;
end
$$;

revoke all on function public.create_public_booking_confirmation_event(uuid,uuid,uuid,text)
  from public, anon, authenticated;

create or replace function public.get_notification_group_snapshot(
  p_dispatch_secret text,
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job public.appointment_notification_jobs;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  select * into v_job
  from public.appointment_notification_jobs j
  where j.id=p_job_id;
  if v_job.id is null or v_job.template_version <> 2 or v_job.group_summary_snapshot is null then
    raise exception 'NOTIFICATION_GROUP_SNAPSHOT_NOT_FOUND';
  end if;
  return v_job.group_summary_snapshot;
end
$$;

revoke all on function public.get_notification_group_snapshot(text,uuid)
  from public, anon, authenticated;
grant execute on function public.get_notification_group_snapshot(text,uuid) to anon;

-- ---------------------------------------------------------------------------
-- Extend the one public gate. No raw group booking RPC gets browser EXECUTE.
-- ---------------------------------------------------------------------------
create or replace function public.public_operation_error(p_message text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('ok',false,'error',jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','PUBLIC_BOOKING_DISABLED','IDEMPOTENCY_CONFLICT',
      'IDEMPOTENCY_IN_PROGRESS','APPOINTMENT_CONFLICT','SLOT_UNAVAILABLE',
      'GROUP_SLOT_UNAVAILABLE','GROUP_LINE_LIMIT_EXCEEDED','GROUP_SLOT_BUDGET_EXCEEDED',
      'MIXED_CURRENCY','DATE_OUT_OF_RANGE',
      'PUBLIC_CONTACT_REQUIRED','INVALID_CUSTOMER_NAME','INVALID_CUSTOMER_PHONE',
      'INVALID_CUSTOMER_EMAIL','NOTES_TOO_LONG','INVALID_START','INVALID_DATE',
      'INVALID_GROUP_LINES','INVALID_BOOKING_RECOVERY_BOOTSTRAP','INVALID_IDEMPOTENCY_KEY',
      'BOOKING_CLIENT_UPDATE_REQUIRED','BOOKING_INTENT_CLOSED','BOOKING_INTENT_DEADLINE_EXPIRED',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

revoke all on function public.public_operation_error(text)
  from public, anon, authenticated;

create or replace function public.execute_public_operation(
  p_action text,p_args jsonb,p_gate_secret text,p_actor_hash text,p_network_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_class text;
  v_data jsonb;
  v_business_id uuid;
  v_recovery_id uuid;
  v_safe_retry boolean := false;
  v_prior_sub text := current_setting('request.jwt.claim.sub',true);
  v_prior_claims text := current_setting('request.jwt.claims',true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    return public.public_operation_error('PUBLIC_BOOKING_GATE_UNAVAILABLE');
  end if;

  v_class := case p_action
    when 'business' then 'read' when 'services' then 'read' when 'staff' then 'read'
    when 'profile' then 'read' when 'media' then 'read'
    when 'slots' then 'slot' when 'group_slots' then 'slot'
    when 'book' then 'request' when 'group_book' then 'request'
    when 'recover' then 'recover' when 'resolve' then 'recover'
    when 'manage_view' then 'manage_read' when 'manage_slots' then 'manage_slot'
    when 'manage_reschedule' then 'manage_change' when 'manage_cancel' then 'manage_cancel'
    else null end;
  if v_class is null then return public.public_operation_error('INVALID_PUBLIC_OPERATION'); end if;

  begin
    perform public.enforce_public_booking_rate(v_class,p_actor_hash,p_network_hash);
  exception when others then return public.public_operation_error(sqlerrm);
  end;
  begin perform public.prune_public_booking_rate_counters(); exception when others then null; end;

  if p_args is null or jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>16384 then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  if p_action in ('book','group_book') then
    begin
      v_recovery_id := (p_args->>'p_recovery_id')::uuid;
      if v_recovery_id is null then raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_recovery_id::text,0));
      select b.id into v_business_id
      from public.businesses b
      where b.slug=lower(trim(p_args->>'p_slug')) limit 1;
      if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
      select exists(
        select 1 from public.public_booking_recoveries r
        where r.business_id=v_business_id and r.recovery_id=v_recovery_id
          and r.idempotency_key=p_args->>'p_idempotency_key'
          and r.management_token_hash=p_args->>'p_management_token_hash'
          and r.recovery_secret_hash=p_args->>'p_recovery_secret_hash'
          and r.appointment_id is not null
      ) into v_safe_retry;
    exception when invalid_text_representation then
      return public.public_operation_error('INVALID_BOOKING_RECOVERY_BOOTSTRAP');
    when others then return public.public_operation_error(sqlerrm);
    end;
    if not v_safe_retry then
      begin
        perform public.enforce_public_booking_rate('create',p_actor_hash,p_network_hash,v_business_id);
      exception when others then return public.public_operation_error(sqlerrm);
      end;
    end if;
  end if;

  begin
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    case p_action
      when 'business' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_business((p_args->>'p_slug')::text) r;
      when 'services' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_services((p_args->>'p_slug')::text) r;
      when 'staff' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_staff(
          (p_args->>'p_slug')::text,(p_args->>'p_service_id')::uuid
        ) r;
      when 'profile' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_business_profile((p_args->>'p_slug')::text) r;
      when 'media' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_media_object((p_args->>'p_media_id')::uuid) r;
      when 'slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_booking_slots(
          (p_args->>'p_slug')::text,(p_args->>'p_service_id')::uuid,
          (p_args->>'p_date')::date,(p_args->>'p_staff_id')::uuid
        ) r;
      when 'group_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_group_availability_slots(
          (p_args->>'p_slug')::text,(p_args->>'p_date')::date,p_args->'p_lines'
        ) r;
      when 'book' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.create_public_appointment_with_recovery(
          (p_args->>'p_slug')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_customer_name')::text,(p_args->>'p_service_id')::uuid,
          (p_args->>'p_staff_id')::uuid,(p_args->>'p_starts_at')::timestamptz,
          (p_args->>'p_management_token_hash')::text,(p_args->>'p_recovery_id')::uuid,
          (p_args->>'p_recovery_secret_hash')::text,
          (p_args->>'p_management_token_ciphertext')::text,
          (p_args->>'p_management_token_iv')::text,(p_args->>'p_key_version')::smallint,
          (p_args->>'p_customer_phone')::text,(p_args->>'p_customer_email')::text,
          (p_args->>'p_notes')::text
        ) r;
      when 'group_book' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.create_public_appointment_group_with_recovery(
          (p_args->>'p_slug')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_customer_name')::text,p_args->'p_lines',
          (p_args->>'p_starts_at')::timestamptz,
          (p_args->>'p_management_token_hash')::text,(p_args->>'p_recovery_id')::uuid,
          (p_args->>'p_recovery_secret_hash')::text,
          (p_args->>'p_management_token_ciphertext')::text,
          (p_args->>'p_management_token_iv')::text,(p_args->>'p_key_version')::smallint,
          (p_args->>'p_customer_phone')::text,(p_args->>'p_customer_email')::text,
          (p_args->>'p_notes')::text
        ) r;
      when 'recover' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.recover_public_appointment(
          (p_args->>'p_recovery_id')::uuid,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_recovery_secret_hash')::text
        ) r;
      when 'resolve' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.resolve_public_booking_intent_v2(
          (p_args->>'p_recovery_id')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_recovery_secret_hash')::text
        ) r;
      when 'manage_view' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_managed_appointment((p_args->>'p_token')::text) r;
      when 'manage_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_management_slots(
          (p_args->>'p_token')::text,(p_args->>'p_date')::date,
          (p_args->>'p_staff_id')::uuid
        ) r;
      when 'manage_reschedule' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.reschedule_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_staff_id')::uuid,(p_args->>'p_starts_at')::timestamptz
        ) r;
      when 'manage_cancel' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.cancel_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_reason')::text
        ) r;
    end case;
    perform set_config('request.jwt.claim.sub',coalesce(v_prior_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(v_prior_claims,''),true);
  exception when invalid_text_representation or datetime_field_overflow then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  when others then
    return public.public_operation_error(sqlerrm);
  end;

  return jsonb_build_object('ok',true,'data',v_data);
end
$$;

revoke all on function public.execute_public_operation(text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;

commit;
