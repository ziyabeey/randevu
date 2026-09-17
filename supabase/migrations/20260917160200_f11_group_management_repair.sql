begin;

-- F11-03 repair: partial lifecycle needs an explicit group-rooted line cancel
-- authority, while whole-group cancel must preserve the exact pre-transition
-- status of only the lines it actually changes.

alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in (
    'create','public_create','reschedule','status','public_reschedule','public_cancel',
    'create_group','public_create_group','group_reschedule','group_cancel',
    'public_group_reschedule','public_group_cancel','group_line_cancel'
  ));

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
  v_changed jsonb;
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

  perform 1
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  for update;

  select jsonb_agg(jsonb_build_object(
    'appointmentId',a.id,
    'lineOrdinal',a.line_ordinal,
    'fromStatus',a.status
  ) order by a.line_ordinal,a.id)
  into v_changed
  from public.appointments a
  where a.business_id=p_business_id
    and a.group_id=p_group_id
    and a.status in ('scheduled','confirmed');

  if v_changed is null or jsonb_array_length(v_changed)=0 then
    raise exception 'BOOKING_GROUP_NOT_CANCELLABLE';
  end if;

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
    changed.item->>'fromStatus',
    'cancelled',
    jsonb_build_object(
      'groupId',p_group_id,
      'groupVersion',v_new_version,
      'lineOrdinal',a.line_ordinal,
      'reason',v_reason
    )
  from jsonb_array_elements(v_changed) changed(item)
  join public.appointments a
    on a.business_id=p_business_id
   and a.group_id=p_group_id
   and a.id=(changed.item->>'appointmentId')::uuid
  order by a.line_ordinal,a.id;

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.f11_cancel_group_core(uuid,uuid,text,integer,text,text,text,uuid)
  from public, anon, authenticated;

create or replace function public.cancel_appointment_group_line(
  p_business_id uuid,
  p_group_id uuid,
  p_appointment_id uuid,
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
declare
  v_group public.appointment_groups;
  v_line public.appointments;
  v_reason text := nullif(btrim(p_reason),'');
  v_hash text;
  v_claim record;
  v_new_version integer;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_GROUP_VERSION';
  end if;
  if v_reason is not null and char_length(v_reason)>500 then
    raise exception 'CANCELLATION_REASON_TOO_LONG';
  end if;

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
  where a.business_id=p_business_id
    and a.group_id=p_group_id
    and a.id=p_appointment_id
  for update;
  if v_line.id is null then raise exception 'BOOKING_GROUP_LINE_NOT_FOUND'; end if;

  v_hash := md5(jsonb_build_object(
    'groupId',p_group_id,
    'appointmentId',p_appointment_id,
    'expectedVersion',p_expected_version,
    'reason',v_reason
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    p_business_id,p_idempotency_key,'group_line_cancel',v_hash,p_appointment_id
  );
  if not v_claim.is_new then
    return public.f11_group_management_payload(p_business_id,p_group_id);
  end if;

  if v_group.version <> p_expected_version then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;
  if v_line.status not in ('scheduled','confirmed') then
    raise exception 'BOOKING_GROUP_LINE_NOT_CANCELLABLE';
  end if;

  perform set_config('app.f11_group_management_id',p_group_id::text,true);
  update public.appointments a
  set status='cancelled',
      cancellation_reason=coalesce(v_reason,a.cancellation_reason)
  where a.business_id=p_business_id
    and a.group_id=p_group_id
    and a.id=p_appointment_id;
  perform set_config('app.f11_group_management_id','',true);

  select g.version into v_new_version
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=p_group_id;
  if v_new_version <> p_expected_version+1 then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  ) values (
    p_business_id,p_appointment_id,'status_changed',auth.uid(),'member',
    v_line.status,'cancelled',
    jsonb_build_object(
      'groupId',p_group_id,
      'groupVersion',v_new_version,
      'lineOrdinal',v_line.line_ordinal,
      'reason',v_reason,
      'scope','line'
    )
  );

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.cancel_appointment_group_line(uuid,uuid,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.cancel_appointment_group_line(uuid,uuid,uuid,text,integer,text)
  to authenticated;

commit;
