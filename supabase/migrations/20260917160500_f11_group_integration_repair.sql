begin;

-- F11-03 integration repair after independent browser/integration review.
--
-- Goals:
--   * page logical booking groups atomically instead of physical service lines;
--   * give native groups explicit line-local service/schedule mutation authority;
--   * keep the F11-01 frozen-snapshot boundary fail-closed outside that exact RPC;
--   * make every line-local write participate in the group optimistic version.

alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in (
    'create','public_create','reschedule','status','public_reschedule','public_cancel',
    'create_group','public_create_group','group_reschedule','group_cancel',
    'public_group_reschedule','public_group_cancel','group_line_cancel',
    'group_line_service_change','group_line_reschedule'
  ));

-- The phase-5 check was created inline and its generated name is not part of the
-- contract. Find only the event_type CHECK and extend it with one explicit audit
-- verb for a line-local service replacement.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid='public.appointment_events'::regclass
    and c.contype='c'
    and pg_get_constraintdef(c.oid) ilike '%event_type%'
    and pg_get_constraintdef(c.oid) ilike '%created%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.appointment_events drop constraint %I',v_name);
  end if;
end
$$;

alter table public.appointment_events
  add constraint appointment_events_event_type_f11_check
  check (event_type in (
    'created','rescheduled','confirmed','cancelled','completed','no_show','service_changed'
  ));

-- F11-01 freezes service identity and financial/catalog snapshots after insert.
-- A native-group service replacement is the only exception, and only for the
-- exact line marked by the SECURITY DEFINER authority below. Tenant/customer/
-- group/source/ordinal/created identity, duration/buffers and processing
-- snapshots remain immutable even inside that operation.
create or replace function public.f11_enforce_appointment_line_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_service_change_line text := nullif(current_setting('app.f11_line_service_change_id',true),'');
begin
  if old.business_id is distinct from new.business_id
     or old.group_id is distinct from new.group_id
     or old.line_ordinal is distinct from new.line_ordinal
     or old.customer_id is distinct from new.customer_id
     or old.source is distinct from new.source
     or old.customer_name_snapshot is distinct from new.customer_name_snapshot
     or old.customer_phone_snapshot is distinct from new.customer_phone_snapshot
     or old.customer_email_snapshot is distinct from new.customer_email_snapshot
     or old.duration_minutes_snapshot is distinct from new.duration_minutes_snapshot
     or old.buffer_before_minutes_snapshot is distinct from new.buffer_before_minutes_snapshot
     or old.buffer_after_minutes_snapshot is distinct from new.buffer_after_minutes_snapshot
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE';
  end if;

  if v_service_change_line is distinct from old.id::text
     and (
       old.service_id is distinct from new.service_id
       or old.service_name_snapshot is distinct from new.service_name_snapshot
       or old.price_minor_snapshot is distinct from new.price_minor_snapshot
       or old.price_type_snapshot is distinct from new.price_type_snapshot
       or old.price_min_minor_snapshot is distinct from new.price_min_minor_snapshot
       or old.price_max_minor_snapshot is distinct from new.price_max_minor_snapshot
       or old.price_policy_version_snapshot is distinct from new.price_policy_version_snapshot
       or old.currency_snapshot is distinct from new.currency_snapshot
     ) then
    raise exception 'APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE';
  end if;

  return new;
end
$$;

revoke all on function public.f11_enforce_appointment_line_immutability()
  from public, anon, authenticated;

-- Operator payload used by /bookings and customer history. Management metadata
-- stays canonical; only stable customer snapshot fields are added for rendering.
create or replace function public.f11_operator_booking_payload(
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
  v_payload jsonb;
  v_anchor public.appointments;
begin
  v_payload := public.f11_group_management_payload(p_business_id,p_group_id);

  select * into v_anchor
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  limit 1;
  if v_anchor.id is null then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  return v_payload || jsonb_build_object(
    'customerName',v_anchor.customer_name_snapshot,
    'customerPhone',v_anchor.customer_phone_snapshot,
    'customerEmail',v_anchor.customer_email_snapshot,
    'notes',v_anchor.notes
  );
end
$$;

revoke all on function public.f11_operator_booking_payload(uuid,uuid)
  from public, anon, authenticated;

-- Group-rooted operator page. Cursor is (logical group start, group id), so a
-- multi-line reservation can never be split between pages.
create or replace function public.list_business_booking_groups_page_v3(
  p_business_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  group_id uuid,
  group_starts_at timestamptz,
  booking jsonb
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout='5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>101 then raise exception 'INVALID_PAGE'; end if;
  if (p_after_starts_at is null)<>(p_after_id is null) then raise exception 'INVALID_PAGE'; end if;

  return query
  with roots as (
    select a.group_id,min(a.starts_at) as starts_at
    from public.appointments a
    where a.business_id=p_business_id
    group by a.group_id
  ), paged as (
    select r.group_id,r.starts_at
    from roots r
    where p_after_starts_at is null
       or (r.starts_at,r.group_id)<(p_after_starts_at,p_after_id)
    order by r.starts_at desc,r.group_id desc
    limit p_limit
  )
  select p.group_id,p.starts_at,public.f11_operator_booking_payload(p_business_id,p.group_id)
  from paged p
  order by p.starts_at desc,p.group_id desc;
end
$$;

revoke all on function public.list_business_booking_groups_page_v3(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.list_business_booking_groups_page_v3(uuid,integer,timestamptz,uuid)
  to authenticated;

-- Customer history uses exactly the same logical root and therefore cannot
-- repeat/split one reservation at a page boundary.
create or replace function public.list_business_customer_booking_groups_page_v3(
  p_business_id uuid,
  p_customer_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  group_id uuid,
  group_starts_at timestamptz,
  booking jsonb
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout='5s'
as $$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>101 then raise exception 'INVALID_PAGE'; end if;
  if (p_after_starts_at is null)<>(p_after_id is null) then raise exception 'INVALID_PAGE'; end if;
  if not exists (
    select 1 from public.customers c
    where c.business_id=p_business_id and c.id=p_customer_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  return query
  with roots as (
    select a.group_id,min(a.starts_at) as starts_at
    from public.appointments a
    where a.business_id=p_business_id and a.customer_id=p_customer_id
    group by a.group_id
  ), paged as (
    select r.group_id,r.starts_at
    from roots r
    where p_after_starts_at is null
       or (r.starts_at,r.group_id)<(p_after_starts_at,p_after_id)
    order by r.starts_at desc,r.group_id desc
    limit p_limit
  )
  select p.group_id,p.starts_at,public.f11_operator_booking_payload(p_business_id,p.group_id)
  from paged p
  order by p.starts_at desc,p.group_id desc;
end
$$;

revoke all on function public.list_business_customer_booking_groups_page_v3(uuid,uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.list_business_customer_booking_groups_page_v3(uuid,uuid,integer,timestamptz,uuid)
  to authenticated;

-- Replace one service while keeping the line's staff/time/occupancy and every
-- sibling untouched. A different scheduling footprint requires a group replan;
-- this prevents a service edit from silently changing sibling occupancy.
create or replace function public.change_appointment_group_line_service(
  p_business_id uuid,
  p_group_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_service_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout='5s'
as $$
declare
  v_group public.appointment_groups;
  v_line public.appointments;
  v_service record;
  v_hash text;
  v_claim record;
  v_new_version integer;
  v_date date;
  v_timezone text;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_GROUP_VERSION'; end if;
  if p_service_id is null then raise exception 'SERVICE_NOT_FOUND'; end if;

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

  select * into v_line
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id and a.id=p_appointment_id
  for update;
  if v_line.id is null then raise exception 'BOOKING_GROUP_LINE_NOT_FOUND'; end if;

  v_hash := md5(jsonb_build_object(
    'groupId',p_group_id,'appointmentId',p_appointment_id,
    'expectedVersion',p_expected_version,'serviceId',p_service_id
  )::text);
  select * into v_claim
  from public.claim_booking_command(
    p_business_id,p_idempotency_key,'group_line_service_change',v_hash,p_appointment_id
  );
  if not v_claim.is_new then
    return public.f11_group_management_payload(p_business_id,p_group_id);
  end if;

  if v_group.version<>p_expected_version then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_CHANGEABLE';
  end if;

  select * into v_service
  from public.f11_group_line_defs_v2(
    p_business_id,
    jsonb_build_array(jsonb_build_object('serviceId',p_service_id,'staffId',v_line.staff_id))
  )
  limit 1;
  if v_service.service_id is null then raise exception 'SERVICE_NOT_FOUND'; end if;

  -- Only a service with the exact frozen scheduling footprint may replace the
  -- line locally. Anything else must use a group-level replan so siblings can be
  -- considered atomically.
  if v_service.duration_minutes<>v_line.duration_minutes_snapshot
     or v_service.buffer_before_minutes<>v_line.buffer_before_minutes_snapshot
     or v_service.buffer_after_minutes<>v_line.buffer_after_minutes_snapshot
     or v_service.processing_capacity_policy<>v_line.processing_capacity_policy_snapshot
     or v_service.passive_wait_minutes<>v_line.passive_wait_minutes_snapshot
     or v_service.processing_policy_version<>v_line.processing_policy_version_snapshot then
    raise exception 'BOOKING_GROUP_LINE_REPLAN_REQUIRED';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.id<>p_appointment_id and a.currency_snapshot<>v_service.currency
  ) then
    raise exception 'MIXED_CURRENCY';
  end if;

  select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date := (v_line.starts_at at time zone v_timezone)::date;
  if not public.f11_staff_slot_free(
    p_business_id,v_line.staff_id,p_service_id,v_date,
    v_line.occupied_starts_at,v_line.occupied_ends_at,p_group_id
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  perform set_config('app.f11_group_management_id',p_group_id::text,true);
  perform set_config('app.f11_line_service_change_id',p_appointment_id::text,true);
  update public.appointments a
  set service_id=p_service_id,
      service_name_snapshot=v_service.service_name,
      price_type_snapshot=v_service.price_type,
      price_min_minor_snapshot=v_service.price_min_minor,
      price_max_minor_snapshot=v_service.price_max_minor,
      price_minor_snapshot=case when v_service.price_type='fixed' then v_service.price_minor else null end,
      price_policy_version_snapshot=v_service.price_policy_version,
      currency_snapshot=v_service.currency,
      updated_at=now()
  where a.business_id=p_business_id and a.group_id=p_group_id and a.id=p_appointment_id;
  perform set_config('app.f11_line_service_change_id','',true);
  perform set_config('app.f11_group_management_id','',true);

  update public.appointment_groups g
  set version=g.version+1,updated_at=now()
  where g.business_id=p_business_id and g.id=p_group_id and g.version=p_expected_version
  returning g.version into v_new_version;
  if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  ) values (
    p_business_id,p_appointment_id,'service_changed',auth.uid(),'member',v_line.status,v_line.status,
    jsonb_build_object(
      'groupId',p_group_id,'groupVersion',v_new_version,'lineOrdinal',v_line.line_ordinal,
      'scope','line','oldServiceId',v_line.service_id,'newServiceId',p_service_id,
      'oldServiceName',v_line.service_name_snapshot,'newServiceName',v_service.service_name
    )
  );

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.change_appointment_group_line_service(uuid,uuid,uuid,text,integer,uuid)
  from public, anon, authenticated;
grant execute on function public.change_appointment_group_line_service(uuid,uuid,uuid,text,integer,uuid)
  to authenticated;

-- Move exactly one service line. Its frozen duration/buffers/processing policy
-- remain unchanged and the operation increments the same group CAS version used
-- by whole-group mutations. Lines that participated in a collapsed same-staff
-- occupancy run require a group replan because repairing that run would mutate a
-- sibling's occupancy window.
create or replace function public.reschedule_appointment_group_line(
  p_business_id uuid,
  p_group_id uuid,
  p_appointment_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_staff_id uuid,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout='5s'
as $$
declare
  v_group public.appointment_groups;
  v_line public.appointments;
  v_hash text;
  v_claim record;
  v_timezone text;
  v_date date;
  v_staff_name text;
  v_ends_at timestamptz;
  v_staff_active_end timestamptz;
  v_occupied_start timestamptz;
  v_occupied_end timestamptz;
  v_full_old_start timestamptz;
  v_full_old_end timestamptz;
  v_new_version integer;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version<1 then raise exception 'INVALID_GROUP_VERSION'; end if;
  if p_staff_id is null or p_starts_at is null then raise exception 'INVALID_START'; end if;

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

  select * into v_line
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id and a.id=p_appointment_id
  for update;
  if v_line.id is null then raise exception 'BOOKING_GROUP_LINE_NOT_FOUND'; end if;

  v_hash := md5(jsonb_build_object(
    'groupId',p_group_id,'appointmentId',p_appointment_id,
    'expectedVersion',p_expected_version,'staffId',p_staff_id,'startsAt',p_starts_at
  )::text);
  select * into v_claim
  from public.claim_booking_command(
    p_business_id,p_idempotency_key,'group_line_reschedule',v_hash,p_appointment_id
  );
  if not v_claim.is_new then
    return public.f11_group_management_payload(p_business_id,p_group_id);
  end if;

  if v_group.version<>p_expected_version then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;
  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_RESCHEDULABLE';
  end if;

  v_full_old_start := v_line.starts_at-make_interval(mins=>v_line.buffer_before_minutes_snapshot);
  v_full_old_end := case
    when v_line.processing_capacity_policy_snapshot='RELEASE'
      then v_line.ends_at-make_interval(mins=>v_line.passive_wait_minutes_snapshot)
    else v_line.ends_at
  end + make_interval(mins=>v_line.buffer_after_minutes_snapshot);
  if v_line.occupied_starts_at<>v_full_old_start or v_line.occupied_ends_at<>v_full_old_end then
    raise exception 'BOOKING_GROUP_LINE_REPLAN_REQUIRED';
  end if;

  select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date := (p_starts_at at time zone v_timezone)::date;
  v_ends_at := p_starts_at+make_interval(mins=>v_line.duration_minutes_snapshot);
  v_staff_active_end := case
    when v_line.processing_capacity_policy_snapshot='RELEASE'
      then v_ends_at-make_interval(mins=>v_line.passive_wait_minutes_snapshot)
    else v_ends_at
  end;
  v_occupied_start := p_starts_at-make_interval(mins=>v_line.buffer_before_minutes_snapshot);
  v_occupied_end := v_staff_active_end+make_interval(mins=>v_line.buffer_after_minutes_snapshot);

  -- F11-02 authority split: RELEASE shortens only staff occupancy. The full
  -- customer-facing service interval must still fit one active business-hours
  -- window and must not overlap a tenant-wide availability block.
  if not exists (
    select 1
    from public.business_hours bh
    where bh.business_id=p_business_id
      and bh.weekday=extract(dow from (p_starts_at at time zone v_timezone)::date)::smallint
      and bh.active
      and ((((p_starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= p_starts_at
      and ((((p_starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= v_ends_at
  ) or exists (
    select 1
    from public.availability_blocks ab
    where ab.business_id=p_business_id
      and ab.staff_id is null
      and ab.active
      and ab.starts_at<v_ends_at
      and ab.ends_at>p_starts_at
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.id<>p_appointment_id and a.status<>'cancelled'
      and a.starts_at<v_ends_at and a.ends_at>p_starts_at
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  if not public.f11_staff_slot_free(
    p_business_id,p_staff_id,v_line.service_id,v_date,
    v_occupied_start,v_occupied_end,p_group_id
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
      and a.id<>p_appointment_id and a.status<>'cancelled' and a.staff_id=p_staff_id
      and a.occupied_starts_at<v_occupied_end and a.occupied_ends_at>v_occupied_start
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  select sp.name into v_staff_name
  from public.staff_profiles sp
  where sp.business_id=p_business_id and sp.id=p_staff_id and sp.active;
  if v_staff_name is null then raise exception 'SLOT_UNAVAILABLE'; end if;

  perform set_config('app.f11_group_management_id',p_group_id::text,true);
  begin
    update public.appointments a
    set staff_id=p_staff_id,staff_name_snapshot=v_staff_name,
        starts_at=p_starts_at,ends_at=v_ends_at,
        occupied_starts_at=v_occupied_start,occupied_ends_at=v_occupied_end,
        timezone=v_timezone,updated_at=now()
    where a.business_id=p_business_id and a.group_id=p_group_id and a.id=p_appointment_id;
  exception when exclusion_violation then
    perform set_config('app.f11_group_management_id','',true);
    raise exception 'APPOINTMENT_CONFLICT';
  end;
  perform set_config('app.f11_group_management_id','',true);

  update public.appointment_groups g
  set version=g.version+1,updated_at=now()
  where g.business_id=p_business_id and g.id=p_group_id and g.version=p_expected_version
  returning g.version into v_new_version;
  if v_new_version is null then raise exception 'BOOKING_GROUP_VERSION_CONFLICT'; end if;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  ) values (
    p_business_id,p_appointment_id,'rescheduled',auth.uid(),'member',v_line.status,v_line.status,
    jsonb_build_object(
      'groupId',p_group_id,'groupVersion',v_new_version,'lineOrdinal',v_line.line_ordinal,'scope','line',
      'oldStartsAt',v_line.starts_at,'newStartsAt',p_starts_at,
      'oldStaffId',v_line.staff_id,'newStaffId',p_staff_id,
      'oldTimezone',v_line.timezone,'newTimezone',v_timezone
    )
  );

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.reschedule_appointment_group_line(uuid,uuid,uuid,text,integer,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reschedule_appointment_group_line(uuid,uuid,uuid,text,integer,uuid,timestamptz)
  to authenticated;

commit;