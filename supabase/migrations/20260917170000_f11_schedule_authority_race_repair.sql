begin;

-- F11-04 forward repair.
--
-- F11 create/group-reschedule/line-reschedule already re-plan before writing,
-- but F10-04 schedule/catalog mutations use independent authority locks. A
-- concurrent hours/block/assignment/catalog write could therefore commit after
-- the last read and before the booking transaction committed. Keep the accepted
-- RPCs and schema intact; add one deferred DB-final guard that joins the same
-- F10-04 lock families at the durability boundary.

-- Whole-group reschedule uses frozen line snapshots, but RELEASE still shortens
-- staff occupancy only. The customer's complete service interval keeps the
-- accepted F11-02 business-hours + tenant-wide block authority.
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
  if p_starts_at is null then raise exception 'INVALID_START'; end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date := (p_starts_at at time zone v_timezone)::date;

  for v_line in
    select a.*
    from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
    order by a.line_ordinal,a.id
  loop
    if v_line.status not in ('scheduled','confirmed') then
      raise exception 'BOOKING_GROUP_NOT_RESCHEDULABLE';
    end if;

    v_service_start := v_cursor;
    v_service_end := v_service_start + make_interval(mins=>v_line.duration_minutes_snapshot);
    v_staff_active_end := case
      when v_line.processing_capacity_policy_snapshot='RELEASE'
        then v_service_end-make_interval(mins=>v_line.passive_wait_minutes_snapshot)
      else v_service_end
    end;

    -- Full customer interval authority is independent of RELEASE staff capacity.
    if not exists (
      select 1
      from public.business_hours bh
      where bh.business_id=p_business_id
        and bh.weekday=extract(dow from (v_service_start at time zone v_timezone)::date)::smallint
        and bh.active
        and ((((v_service_start at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= v_service_start
        and ((((v_service_start at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= v_service_end
    ) or exists (
      select 1
      from public.availability_blocks ab
      where ab.business_id=p_business_id
        and ab.staff_id is null
        and ab.active
        and ab.starts_at<v_service_end
        and ab.ends_at>v_service_start
    ) then
      return null;
    end if;

    if v_prev_staff is not null and v_prev_staff=v_line.staff_id then
      v_occ_start := v_service_start;
    else
      v_occ_start := v_service_start-make_interval(mins=>v_line.buffer_before_minutes_snapshot);
    end if;
    v_occ_end := v_staff_active_end+make_interval(mins=>v_line.buffer_after_minutes_snapshot);

    if not public.f11_staff_slot_free(
      p_business_id,v_line.staff_id,v_line.service_id,v_date,
      v_occ_start,v_occ_end,p_group_id
    ) then
      return null;
    end if;

    if v_prev_staff is not null and v_prev_staff=v_line.staff_id then
      v_plan := jsonb_set(
        v_plan,
        array[(v_prev_index-1)::text,'occupiedEndsAt'],
        v_plan->(v_prev_index-1)->'staffActiveEndsAt'
      );
    end if;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'appointmentId',v_line.id,
      'lineOrdinal',v_line.line_ordinal,
      'serviceId',v_line.service_id,
      'serviceName',v_line.service_name_snapshot,
      'staffId',v_line.staff_id,
      'staffName',v_line.staff_name_snapshot,
      'startsAt',v_service_start,
      'endsAt',v_service_end,
      'staffActiveEndsAt',v_staff_active_end,
      'occupiedStartsAt',v_occ_start,
      'occupiedEndsAt',v_occ_end,
      'status',v_line.status,
      'durationMinutes',v_line.duration_minutes_snapshot,
      'bufferBeforeMinutes',v_line.buffer_before_minutes_snapshot,
      'bufferAfterMinutes',v_line.buffer_after_minutes_snapshot,
      'processingCapacityPolicy',v_line.processing_capacity_policy_snapshot,
      'passiveWaitMinutes',v_line.passive_wait_minutes_snapshot,
      'processingPolicyVersion',v_line.processing_policy_version_snapshot,
      'priceType',v_line.price_type_snapshot,
      'priceMinMinor',v_line.price_min_minor_snapshot,
      'priceMaxMinor',v_line.price_max_minor_snapshot,
      'priceMinor',v_line.price_minor_snapshot,
      'pricePolicyVersion',v_line.price_policy_version_snapshot,
      'currency',v_line.currency_snapshot
    ));

    v_prev_staff := v_line.staff_id;
    v_prev_index := v_prev_index+1;
    v_cursor := v_service_end;
  end loop;

  if jsonb_array_length(v_plan)=0 then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;
  return jsonb_build_object(
    'startsAt',p_starts_at,'endsAt',v_cursor,'timezone',v_timezone,
    'totalDurationMinutes',round(extract(epoch from (v_cursor-p_starts_at))/60)::integer,
    'lines',v_plan
  );
end
$$;

revoke all on function public.f11_plan_existing_group_at(uuid,uuid,timestamptz)
  from public,anon,authenticated;

create or replace function public.f11_validate_native_group_schedule_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_legacy uuid;
  v_timezone text;
  v_weekday smallint;
  v_staff_day record;
  v_require_active_service boolean;
begin
  if new.group_id is null or new.business_id is null then return null; end if;

  if tg_op='UPDATE'
     and new.service_id is not distinct from old.service_id
     and new.staff_id is not distinct from old.staff_id
     and new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at
     and new.occupied_starts_at is not distinct from old.occupied_starts_at
     and new.occupied_ends_at is not distinct from old.occupied_ends_at then
    return null;
  end if;

  select g.legacy_appointment_id into v_legacy
  from public.appointment_groups g
  where g.business_id=new.business_id and g.id=new.group_id;
  if not found or v_legacy is not null then return null; end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id=new.business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  -- Match accepted F10-04 authority namespaces. The group-management/command
  -- locks are already held by the calling F11 RPCs; these locks bind mutable
  -- schedule/catalog authority to the final durable state. Acquire every F10-04
  -- advisory family before row locks so guarded writes that later take FK key
  -- shares cannot form a row-lock/advisory-lock inversion with this trigger.
  for v_weekday in
    select distinct extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
    from public.appointments a
    where a.business_id=new.business_id and a.group_id=new.group_id
      and a.status in ('scheduled','confirmed')
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f10-04:business-hours:'||new.business_id::text||':'||v_weekday::text,0
    ));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:availability-blocks:'||new.business_id::text,0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:assignments:'||new.business_id::text,0
  ));

  for v_staff_day in
    select distinct
      a.staff_id,
      extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint as weekday
    from public.appointments a
    where a.business_id=new.business_id and a.group_id=new.group_id
      and a.status in ('scheduled','confirmed')
    order by a.staff_id,weekday
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f10-04:staff-hours:'||new.business_id::text||':'||v_staff_day.staff_id::text||':'||v_staff_day.weekday::text,0
    ));
  end loop;

  -- Stable row order prevents service/staff/assignment lock inversions between
  -- two multi-line groups. Existing reschedule/create paths already use the same
  -- stable staff ordering; this is the DB-final counterpart.
  perform 1
  from public.services s
  where s.business_id=new.business_id
    and s.id in (
      select a.service_id from public.appointments a
      where a.business_id=new.business_id and a.group_id=new.group_id
        and a.status in ('scheduled','confirmed')
    )
  order by s.id
  for update;

  perform 1
  from public.staff_profiles sp
  where sp.business_id=new.business_id
    and sp.id in (
      select a.staff_id from public.appointments a
      where a.business_id=new.business_id and a.group_id=new.group_id
        and a.status in ('scheduled','confirmed')
    )
  order by sp.id
  for update;

  perform 1
  from public.staff_services ss
  where ss.business_id=new.business_id
    and (ss.staff_id,ss.service_id) in (
      select a.staff_id,a.service_id
      from public.appointments a
      where a.business_id=new.business_id and a.group_id=new.group_id
        and a.status in ('scheduled','confirmed')
    )
  order by ss.staff_id,ss.service_id
  for update;

  v_require_active_service := tg_op='INSERT'
    or (tg_op='UPDATE' and new.service_id is distinct from old.service_id);
  if v_require_active_service and not exists (
    select 1 from public.services s
    where s.business_id=new.business_id and s.id=new.service_id and s.active
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Current staff eligibility, assignment, hours and blocks remain authoritative
  -- for every active line. Service active state is required for fresh create or
  -- an explicit service replacement; schedule-only moves preserve frozen
  -- historical service snapshots even if today's catalog is archived.
  if exists (
    select 1
    from public.appointments a
    where a.business_id=new.business_id and a.group_id=new.group_id
      and a.status in ('scheduled','confirmed')
      and (
        not exists (
          select 1 from public.staff_profiles sp
          where sp.business_id=a.business_id and sp.id=a.staff_id and sp.active
        )
        or not exists (
          select 1 from public.staff_services ss
          where ss.business_id=a.business_id and ss.staff_id=a.staff_id
            and ss.service_id=a.service_id and ss.active
        )
        or not exists (
          select 1
          from public.business_hours bh
          where bh.business_id=a.business_id
            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= a.starts_at
            and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= a.ends_at
        )
        or exists (
          select 1 from public.availability_blocks ab
          where ab.business_id=a.business_id and ab.staff_id is null and ab.active
            and ab.starts_at<a.ends_at and ab.ends_at>a.starts_at
        )
        or not exists (
          select 1
          from public.business_hours bh
          join public.staff_hours sh
            on sh.business_id=bh.business_id
           and sh.staff_id=a.staff_id
           and sh.weekday=bh.weekday
           and sh.active
          where bh.business_id=a.business_id
            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+greatest(bh.starts_local,sh.starts_local)) at time zone v_timezone) <= a.occupied_starts_at
            and ((((a.starts_at at time zone v_timezone)::date)+least(bh.ends_local,sh.ends_local)) at time zone v_timezone) >= a.occupied_ends_at
        )
        or exists (
          select 1 from public.availability_blocks ab
          where ab.business_id=a.business_id and ab.active
            and (ab.staff_id is null or ab.staff_id=a.staff_id)
            and ab.starts_at<a.occupied_ends_at and ab.ends_at>a.occupied_starts_at
        )
      )
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  return null;
end
$$;

revoke all on function public.f11_validate_native_group_schedule_authority()
  from public,anon,authenticated;

drop trigger if exists appointments_f11_schedule_authority_guard on public.appointments;
create constraint trigger appointments_f11_schedule_authority_guard
after insert or update on public.appointments
deferrable initially deferred
for each row execute function public.f11_validate_native_group_schedule_authority();

commit;
