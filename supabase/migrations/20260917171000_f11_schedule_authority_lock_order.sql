begin;

-- F11-04 lock-order repair.
-- Whole-group reschedule must not hold an UPDATE-strength parent staff lock
-- before the F10-04 staff-hours advisory authority lock. Doing so deadlocks
-- against replace_staff_hours_guarded(), which owns the advisory lock and then
-- needs a foreign-key KEY SHARE on the same staff row.
--
-- The deferred schedule-authority guard remains the final authority fence and
-- takes all F10-04 advisory families before its final row validation.
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

  -- Staff identity must stay stable, but UPDATE-strength here creates a
  -- row-lock/advisory-lock inversion with guarded staff-hours writes. The final
  -- deferred authority guard rechecks active staff after acquiring F10-04
  -- advisory locks, so KEY SHARE is sufficient at this earlier planning stage.
  perform 1
  from public.staff_profiles sp
  where sp.business_id=p_business_id
    and sp.id in (
      select a.staff_id from public.appointments a
      where a.business_id=p_business_id and a.group_id=p_group_id
    )
  order by sp.id
  for key share;

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

commit;
