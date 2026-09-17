begin;

-- F11-03: atomic management for F11 reservation groups.
--
-- The appointment table remains the physical service-line store. A non-legacy
-- appointment_group is the management authority root, so old single-line
-- mutation RPCs must not be able to move/cancel one sibling behind the group's
-- optimistic version. Legacy one-line groups keep the historical RPC surface.

alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in (
    'create','public_create','reschedule','status','public_reschedule','public_cancel',
    'create_group','public_create_group','group_reschedule','group_cancel',
    'public_group_reschedule','public_group_cancel'
  ));

-- ---------------------------------------------------------------------------
-- Protect non-legacy groups from the old appointment-id mutation surface.
-- Group-aware functions set a transaction-local authority marker for the exact
-- group they are mutating. A marker for one group never authorizes a sibling.
-- ---------------------------------------------------------------------------
create or replace function public.f11_require_group_management_for_multi_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_legacy_appointment_id uuid;
  v_authorized_group text;
begin
  if old.group_id is null then
    return new;
  end if;

  select g.legacy_appointment_id
  into v_legacy_appointment_id
  from public.appointment_groups g
  where g.business_id = old.business_id
    and g.id = old.group_id;

  if not found then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;

  -- The deterministic one-line bridge intentionally keeps every historical
  -- appointment-id mutation working exactly as before.
  if v_legacy_appointment_id is not null then
    return new;
  end if;

  v_authorized_group := nullif(current_setting('app.f11_group_management_id', true), '');
  if v_authorized_group is null or v_authorized_group <> old.group_id::text then
    raise exception 'BOOKING_GROUP_MUTATION_REQUIRED';
  end if;

  return new;
end
$$;

revoke all on function public.f11_require_group_management_for_multi_line()
  from public, anon, authenticated;

drop trigger if exists appointments_f11_group_management_guard on public.appointments;
create trigger appointments_f11_group_management_guard
before update of
  service_id, staff_id, status,
  starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
  service_name_snapshot, staff_name_snapshot, cancellation_reason
on public.appointments
for each row execute function public.f11_require_group_management_for_multi_line();

-- During an atomic group status mutation, N line updates must not manufacture N
-- optimistic-version increments or expose a transient aggregate status. The
-- group mutation writes the single final aggregate/version after all lines move.
create or replace function public.f11_aggregate_group_status_from_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_legacy_appointment_id uuid;
  v_line_count integer;
  v_distinct_status_count integer;
  v_aggregate_status text;
  v_batch_group text;
begin
  select g.legacy_appointment_id
  into v_legacy_appointment_id
  from public.appointment_groups g
  where g.business_id = new.business_id
    and g.id = new.group_id
  for update;

  if not found then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;

  if v_legacy_appointment_id is not null then
    return new;
  end if;

  v_batch_group := nullif(current_setting('app.f11_group_status_batch_id', true), '');
  if v_batch_group = new.group_id::text then
    return new;
  end if;

  select
    count(*)::integer,
    count(distinct a.status)::integer,
    min(a.status)
  into v_line_count, v_distinct_status_count, v_aggregate_status
  from public.appointments a
  where a.business_id = new.business_id
    and a.group_id = new.group_id;

  if v_line_count = 0 then
    return new;
  end if;
  if v_distinct_status_count > 1 then
    v_aggregate_status := 'partial';
  end if;

  update public.appointment_groups g
  set status = v_aggregate_status,
      version = case when tg_op = 'UPDATE' then g.version + 1 else g.version end,
      updated_at = case
        when tg_op = 'UPDATE' or g.status is distinct from v_aggregate_status then now()
        else g.updated_at
      end
  where g.business_id = new.business_id
    and g.id = new.group_id;

  return new;
end
$$;

revoke all on function public.f11_aggregate_group_status_from_line()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Canonical management projection. The existing F11 group payload remains the
-- data contract; management adds only authority/version capability metadata.
-- ---------------------------------------------------------------------------
create or replace function public.f11_group_management_payload(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group public.appointment_groups;
  v_payload jsonb;
  v_line_count integer;
  v_active_count integer;
  v_bad_reschedule_count integer;
  v_bad_cancel_count integer;
begin
  select * into v_group
  from public.appointment_groups g
  where g.business_id = p_business_id
    and g.id = p_group_id;
  if v_group.id is null then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;

  select
    count(*)::integer,
    count(*) filter (where a.status in ('scheduled','confirmed'))::integer,
    count(*) filter (where a.status not in ('scheduled','confirmed'))::integer,
    count(*) filter (where a.status not in ('scheduled','confirmed','cancelled'))::integer
  into v_line_count, v_active_count, v_bad_reschedule_count, v_bad_cancel_count
  from public.appointments a
  where a.business_id = p_business_id
    and a.group_id = p_group_id;

  if v_line_count < 1 then
    raise exception 'BOOKING_GROUP_EMPTY';
  end if;

  v_payload := public.f11_group_payload(p_business_id, p_group_id);
  if v_payload is null then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;

  return v_payload || jsonb_build_object(
    'legacyAppointmentId', v_group.legacy_appointment_id,
    'managementMode', case
      when v_group.legacy_appointment_id is not null then 'legacy_single'
      else 'group'
    end,
    'lineCount', v_line_count,
    'canRescheduleGroup',
      v_group.legacy_appointment_id is null
      and v_bad_reschedule_count = 0
      and v_active_count = v_line_count,
    'canCancelGroup',
      v_group.legacy_appointment_id is null
      and v_bad_cancel_count = 0
      and v_active_count > 0
  );
end
$$;

revoke all on function public.f11_group_management_payload(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.get_booking_group_management(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.f11_group_management_payload(p_business_id, p_group_id);
end
$$;

revoke all on function public.get_booking_group_management(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_booking_group_management(uuid,uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Re-plan an existing non-legacy group from its frozen line snapshots. Catalog
-- edits never rewrite historical duration/buffer/processing/price semantics.
-- Current staff eligibility/hours/blocks are still authoritative for the new
-- time. Staff assignment is preserved by group reschedule in F11-03.
-- ---------------------------------------------------------------------------
create or replace function public.f11_plan_existing_group_at(
  p_business_id uuid,
  p_group_id uuid,
  p_starts_at timestamptz
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
  v_line public.appointments;
  v_cursor timestamptz := p_starts_at;
  v_service_start timestamptz;
  v_service_end timestamptz;
  v_staff_active_end timestamptz;
  v_occ_start timestamptz;
  v_occ_end timestamptz;
  v_prev_staff uuid := null;
  v_prev_index integer := 0;
  v_plan jsonb := '[]'::jsonb;
begin
  if p_starts_at is null then
    raise exception 'INVALID_START';
  end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id = p_business_id;
  if v_timezone is null then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;
  v_date := (p_starts_at at time zone v_timezone)::date;

  for v_line in
    select a.*
    from public.appointments a
    where a.business_id = p_business_id
      and a.group_id = p_group_id
    order by a.line_ordinal, a.id
  loop
    if v_line.status not in ('scheduled','confirmed') then
      raise exception 'BOOKING_GROUP_NOT_RESCHEDULABLE';
    end if;

    v_service_start := v_cursor;
    v_service_end := v_service_start + make_interval(mins => v_line.duration_minutes_snapshot);
    v_staff_active_end := case
      when v_line.processing_capacity_policy_snapshot = 'RELEASE'
        then v_service_end - make_interval(mins => v_line.passive_wait_minutes_snapshot)
      else v_service_end
    end;

    if v_prev_staff is not null and v_prev_staff = v_line.staff_id then
      v_occ_start := v_service_start;
    else
      v_occ_start := v_service_start - make_interval(mins => v_line.buffer_before_minutes_snapshot);
    end if;
    v_occ_end := v_staff_active_end + make_interval(mins => v_line.buffer_after_minutes_snapshot);

    if not public.f11_staff_slot_free(
      p_business_id,
      v_line.staff_id,
      v_line.service_id,
      v_date,
      v_occ_start,
      v_occ_end,
      p_group_id
    ) then
      return null;
    end if;

    if v_prev_staff is not null and v_prev_staff = v_line.staff_id then
      v_plan := jsonb_set(
        v_plan,
        array[(v_prev_index - 1)::text, 'occupiedEndsAt'],
        v_plan -> (v_prev_index - 1) -> 'staffActiveEndsAt'
      );
    end if;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'appointmentId', v_line.id,
      'lineOrdinal', v_line.line_ordinal,
      'serviceId', v_line.service_id,
      'serviceName', v_line.service_name_snapshot,
      'staffId', v_line.staff_id,
      'staffName', v_line.staff_name_snapshot,
      'startsAt', v_service_start,
      'endsAt', v_service_end,
      'staffActiveEndsAt', v_staff_active_end,
      'occupiedStartsAt', v_occ_start,
      'occupiedEndsAt', v_occ_end,
      'status', v_line.status,
      'durationMinutes', v_line.duration_minutes_snapshot,
      'bufferBeforeMinutes', v_line.buffer_before_minutes_snapshot,
      'bufferAfterMinutes', v_line.buffer_after_minutes_snapshot,
      'processingCapacityPolicy', v_line.processing_capacity_policy_snapshot,
      'passiveWaitMinutes', v_line.passive_wait_minutes_snapshot,
      'processingPolicyVersion', v_line.processing_policy_version_snapshot,
      'priceType', v_line.price_type_snapshot,
      'priceMinMinor', v_line.price_min_minor_snapshot,
      'priceMaxMinor', v_line.price_max_minor_snapshot,
      'priceMinor', v_line.price_minor_snapshot,
      'pricePolicyVersion', v_line.price_policy_version_snapshot,
      'currency', v_line.currency_snapshot
    ));

    v_prev_staff := v_line.staff_id;
    v_prev_index := v_prev_index + 1;
    v_cursor := v_service_end;
  end loop;

  if jsonb_array_length(v_plan) = 0 then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'startsAt', p_starts_at,
    'endsAt', v_cursor,
    'timezone', v_timezone,
    'totalDurationMinutes',
      round(extract(epoch from (v_cursor - p_starts_at)) / 60)::integer,
    'lines', v_plan
  );
end
$$;

revoke all on function public.f11_plan_existing_group_at(uuid,uuid,timestamptz)
  from public, anon, authenticated;

create or replace function public.f11_existing_group_reschedule_slots_internal(
  p_business_id uuid,
  p_group_id uuid,
  p_date date,
  p_step_minutes integer default 15
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  total_duration_minutes integer,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group public.appointment_groups;
  v_timezone text;
  v_line_count integer;
  v_total_minutes integer;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_candidates integer;
  v_probe integer;
  v_start timestamptz;
  v_plan jsonb;
begin
  if p_step_minutes < 5 or p_step_minutes > 120 then
    raise exception 'INVALID_STEP';
  end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id = p_business_id and g.id = p_group_id;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;
  if v_group.legacy_appointment_id is not null then
    raise exception 'BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT';
  end if;

  select
    count(*)::integer,
    coalesce(sum(a.duration_minutes_snapshot),0)::integer
  into v_line_count, v_total_minutes
  from public.appointments a
  where a.business_id = p_business_id and a.group_id = p_group_id;
  if v_line_count < 1 then raise exception 'BOOKING_GROUP_EMPTY'; end if;
  if exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.status not in ('scheduled','confirmed')
  ) then
    raise exception 'BOOKING_GROUP_NOT_RESCHEDULABLE';
  end if;

  select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  select
    min((p_date + bh.starts_local) at time zone v_timezone),
    max((p_date + bh.ends_local) at time zone v_timezone)
  into v_window_start, v_window_end
  from public.business_hours bh
  where bh.business_id=p_business_id
    and bh.weekday=extract(dow from p_date)::smallint
    and bh.active;

  if v_window_start is null then return; end if;

  v_candidates := greatest(
    0,
    (extract(epoch from (
      v_window_end - make_interval(mins=>v_total_minutes) - v_window_start
    )) / (p_step_minutes * 60))::integer + 1
  );
  v_probe := v_candidates * v_line_count;
  if v_probe > public.f11_group_probe_budget() then
    raise exception 'GROUP_SLOT_BUDGET_EXCEEDED';
  end if;

  v_start := v_window_start;
  while v_start + make_interval(mins=>v_total_minutes) <= v_window_end loop
    v_plan := public.f11_plan_existing_group_at(p_business_id,p_group_id,v_start);
    if v_plan is not null then
      starts_at := v_start;
      ends_at := (v_plan->>'endsAt')::timestamptz;
      timezone := v_timezone;
      total_duration_minutes := v_total_minutes;
      lines := v_plan->'lines';
      return next;
    end if;
    v_start := v_start + make_interval(mins=>p_step_minutes);
  end loop;
end
$$;

revoke all on function public.f11_existing_group_reschedule_slots_internal(uuid,uuid,date,integer)
  from public, anon, authenticated;

create or replace function public.compute_booking_group_reschedule_slots(
  p_business_id uuid,
  p_group_id uuid,
  p_date date,
  p_step_minutes integer default 15
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  total_duration_minutes integer,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 366 then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  return query
  select *
  from public.f11_existing_group_reschedule_slots_internal(
    p_business_id,p_group_id,p_date,p_step_minutes
  );
end
$$;

revoke all on function public.compute_booking_group_reschedule_slots(uuid,uuid,date,integer)
  from public, anon, authenticated;
grant execute on function public.compute_booking_group_reschedule_slots(uuid,uuid,date,integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Shared atomic mutation cores. Callers validate their authority before entry.
-- Exact idempotency replay returns before optimistic-version validation, matching
-- the established single-appointment command semantics.
-- ---------------------------------------------------------------------------
create or replace function public.f11_reschedule_group_core(
  p_business_id uuid,
  p_group_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_starts_at timestamptz,
  p_command text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.appointment_groups;
  v_anchor_id uuid;
  v_hash text;
  v_claim record;
  v_plan jsonb;
  v_old_lines jsonb;
  v_new_version integer;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_GROUP_VERSION';
  end if;
  if p_starts_at is null then raise exception 'INVALID_START'; end if;
  if p_command not in ('group_reschedule','public_group_reschedule') then
    raise exception 'INVALID_GROUP_COMMAND';
  end if;
  if p_actor_type not in ('member','public') then raise exception 'INVALID_ACTOR_TYPE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'f11:group-management:'||p_business_id::text||':'||p_group_id::text,0
  ));

  select * into v_group
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=p_group_id
  for update;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;
  if v_group.legacy_appointment_id is not null then
    raise exception 'BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT';
  end if;

  select a.id into v_anchor_id
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  limit 1;
  if v_anchor_id is null then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  v_hash := md5(jsonb_build_object(
    'groupId',p_group_id,
    'expectedVersion',p_expected_version,
    'startsAt',p_starts_at
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    p_business_id,p_idempotency_key,p_command,v_hash,v_anchor_id
  );
  if not v_claim.is_new then
    return public.f11_group_management_payload(p_business_id,p_group_id);
  end if;

  if v_group.version <> p_expected_version then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.status not in ('scheduled','confirmed')
  ) then
    raise exception 'BOOKING_GROUP_NOT_RESCHEDULABLE';
  end if;

  -- Lock all physical lines, then all participating staff in deterministic order.
  perform 1
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  for update;

  perform 1
  from public.staff_profiles sp
  where sp.business_id=p_business_id
    and sp.id in (
      select a.staff_id from public.appointments a
      where a.business_id=p_business_id and a.group_id=p_group_id
    )
  order by sp.id
  for update;

  -- Availability is intentionally recomputed after the stable staff locks.
  v_plan := public.f11_plan_existing_group_at(p_business_id,p_group_id,p_starts_at);
  if v_plan is null then raise exception 'SLOT_UNAVAILABLE'; end if;

  select jsonb_agg(jsonb_build_object(
    'appointmentId',a.id,
    'lineOrdinal',a.line_ordinal,
    'startsAt',a.starts_at,
    'endsAt',a.ends_at,
    'occupiedStartsAt',a.occupied_starts_at,
    'occupiedEndsAt',a.occupied_ends_at,
    'timezone',a.timezone,
    'staffId',a.staff_id
  ) order by a.line_ordinal,a.id)
  into v_old_lines
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id;

  perform set_config('app.f11_group_management_id',p_group_id::text,true);
  begin
    with plan as (
      select
        (x->>'appointmentId')::uuid as appointment_id,
        (x->>'startsAt')::timestamptz as starts_at,
        (x->>'endsAt')::timestamptz as ends_at,
        (x->>'occupiedStartsAt')::timestamptz as occupied_starts_at,
        (x->>'occupiedEndsAt')::timestamptz as occupied_ends_at
      from jsonb_array_elements(v_plan->'lines') x
    )
    update public.appointments a
    set starts_at=p.starts_at,
        ends_at=p.ends_at,
        occupied_starts_at=p.occupied_starts_at,
        occupied_ends_at=p.occupied_ends_at,
        timezone=v_plan->>'timezone'
    from plan p
    where a.business_id=p_business_id
      and a.group_id=p_group_id
      and a.id=p.appointment_id;
  exception when exclusion_violation then
    perform set_config('app.f11_group_management_id','',true);
    raise exception 'APPOINTMENT_CONFLICT';
  end;
  perform set_config('app.f11_group_management_id','',true);

  update public.appointment_groups g
  set version=g.version+1,
      updated_at=now()
  where g.business_id=p_business_id and g.id=p_group_id
    and g.version=p_expected_version
  returning g.version into v_new_version;
  if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  )
  select
    p_business_id,
    a.id,
    'rescheduled',
    p_actor_user_id,
    p_actor_type,
    a.status,
    a.status,
    jsonb_build_object(
      'groupId',p_group_id,
      'groupVersion',v_new_version,
      'lineOrdinal',a.line_ordinal,
      'oldStartsAt',(old_line->>'startsAt')::timestamptz,
      'newStartsAt',a.starts_at,
      'oldStaffId',(old_line->>'staffId')::uuid,
      'newStaffId',a.staff_id,
      'oldTimezone',old_line->>'timezone',
      'newTimezone',a.timezone
    )
  from public.appointments a
  join lateral (
    select x as old_line
    from jsonb_array_elements(v_old_lines) x
    where (x->>'appointmentId')::uuid=a.id
    limit 1
  ) old_snapshot on true
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id;

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.f11_reschedule_group_core(uuid,uuid,text,integer,timestamptz,text,text,uuid)
  from public, anon, authenticated;

create or replace function public.f11_cancel_group_core(
  p_business_id uuid,
  p_group_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_reason text,
  p_command text,
  p_actor_type text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.appointment_groups;
  v_anchor_id uuid;
  v_hash text;
  v_claim record;
  v_reason text := nullif(btrim(p_reason),'');
  v_new_version integer;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_GROUP_VERSION';
  end if;
  if v_reason is not null and char_length(v_reason)>500 then
    raise exception 'CANCELLATION_REASON_TOO_LONG';
  end if;
  if p_command not in ('group_cancel','public_group_cancel') then
    raise exception 'INVALID_GROUP_COMMAND';
  end if;
  if p_actor_type not in ('member','public') then raise exception 'INVALID_ACTOR_TYPE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'f11:group-management:'||p_business_id::text||':'||p_group_id::text,0
  ));

  select * into v_group
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=p_group_id
  for update;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;
  if v_group.legacy_appointment_id is not null then
    raise exception 'BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT';
  end if;

  select a.id into v_anchor_id
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  limit 1;
  if v_anchor_id is null then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  v_hash := md5(jsonb_build_object(
    'groupId',p_group_id,
    'expectedVersion',p_expected_version,
    'reason',v_reason
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    p_business_id,p_idempotency_key,p_command,v_hash,v_anchor_id
  );
  if not v_claim.is_new then
    return public.f11_group_management_payload(p_business_id,p_group_id);
  end if;

  if v_group.version <> p_expected_version then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.status not in ('scheduled','confirmed','cancelled')
  ) then
    raise exception 'BOOKING_GROUP_NOT_CANCELLABLE';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.status in ('scheduled','confirmed')
  ) then
    raise exception 'BOOKING_GROUP_NOT_CANCELLABLE';
  end if;

  perform 1
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  for update;

  perform set_config('app.f11_group_management_id',p_group_id::text,true);
  perform set_config('app.f11_group_status_batch_id',p_group_id::text,true);
  update public.appointments a
  set status='cancelled',
      cancellation_reason=coalesce(v_reason,a.cancellation_reason)
  where a.business_id=p_business_id
    and a.group_id=p_group_id
    and a.status in ('scheduled','confirmed');
  perform set_config('app.f11_group_status_batch_id','',true);
  perform set_config('app.f11_group_management_id','',true);

  update public.appointment_groups g
  set status='cancelled',
      version=g.version+1,
      updated_at=now()
  where g.business_id=p_business_id and g.id=p_group_id
    and g.version=p_expected_version
  returning g.version into v_new_version;
  if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  )
  select
    p_business_id,
    a.id,
    'status_changed',
    p_actor_user_id,
    p_actor_type,
    case when a.status='cancelled' then 'scheduled' else a.status end,
    'cancelled',
    jsonb_build_object(
      'groupId',p_group_id,
      'groupVersion',v_new_version,
      'lineOrdinal',a.line_ordinal,
      'reason',v_reason
    )
  from public.appointments a
  where a.business_id=p_business_id
    and a.group_id=p_group_id
    and a.status='cancelled'
  order by a.line_ordinal,a.id;

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.f11_cancel_group_core(uuid,uuid,text,integer,text,text,text,uuid)
  from public, anon, authenticated;

create or replace function public.reschedule_appointment_group(
  p_business_id uuid,
  p_group_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.f11_reschedule_group_core(
    p_business_id,p_group_id,p_idempotency_key,p_expected_version,p_starts_at,
    'group_reschedule','member',auth.uid()
  );
end
$$;

revoke all on function public.reschedule_appointment_group(uuid,uuid,text,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reschedule_appointment_group(uuid,uuid,text,integer,timestamptz)
  to authenticated;

create or replace function public.cancel_appointment_group(
  p_business_id uuid,
  p_group_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.f11_cancel_group_core(
    p_business_id,p_group_id,p_idempotency_key,p_expected_version,p_reason,
    'group_cancel','member',auth.uid()
  );
end
$$;

revoke all on function public.cancel_appointment_group(uuid,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.cancel_appointment_group(uuid,uuid,text,integer,text)
  to authenticated;

commit;
