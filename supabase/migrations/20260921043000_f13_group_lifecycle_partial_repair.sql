begin;

-- F13-03 post-merge repair: a real non-legacy partial group must report the
-- explicit partial-status contract before normal lifecycle transition checks.
-- The existing group-management lock, CAS, idempotency and batch trigger fences
-- remain unchanged.
create or replace function public.set_appointment_group_status(
  p_business_id uuid,
  p_group_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_group public.appointment_groups;
  v_anchor_id uuid;
  v_hash text;
  v_claim record;
  v_new_version integer;
  v_from_status text;
  v_line_count integer;
  v_matching_count integer;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_GROUP_VERSION';
  end if;
  if p_status not in ('confirmed','completed','no_show') then
    raise exception 'INVALID_GROUP_STATUS';
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

  select a.id into v_anchor_id
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  limit 1;
  if v_anchor_id is null then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  v_hash := md5(jsonb_build_object(
    'groupId',p_group_id,
    'expectedVersion',p_expected_version,
    'status',p_status
  )::text);

  select * into v_claim
  from public.claim_booking_command(
    p_business_id,p_idempotency_key,'group_status',v_hash,v_anchor_id
  );
  if not v_claim.is_new then
    return public.f11_group_management_payload(p_business_id,p_group_id);
  end if;

  if v_group.version <> p_expected_version then
    raise exception 'BOOKING_GROUP_VERSION_CONFLICT';
  end if;

  v_from_status := v_group.status;
  select
    count(*)::integer,
    count(*) filter (where a.status=v_from_status)::integer
  into v_line_count,v_matching_count
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id;
  if v_line_count < 1 then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  -- A true aggregate partial status, or any inconsistent header/line snapshot,
  -- is a distinct operator condition. Do not collapse it into a normal
  -- transition error before the explicit partial contract can be observed.
  if v_from_status='partial' or v_matching_count <> v_line_count then
    raise exception 'BOOKING_GROUP_PARTIAL_STATUS';
  end if;

  if (p_status='confirmed' and v_from_status<>'scheduled')
     or (p_status in ('completed','no_show') and v_from_status<>'confirmed') then
    raise exception 'INVALID_GROUP_STATUS_TRANSITION';
  end if;

  perform 1
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  for update;

  perform set_config('app.f11_group_management_id',p_group_id::text,true);
  perform set_config('app.f11_group_status_batch_id',p_group_id::text,true);
  update public.appointments a
  set status=p_status
  where a.business_id=p_business_id
    and a.group_id=p_group_id
    and a.status=v_from_status;
  perform set_config('app.f11_group_status_batch_id','',true);
  perform set_config('app.f11_group_management_id','',true);

  update public.appointment_groups g
  set status=p_status,
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
    p_business_id,a.id,p_status,auth.uid(),'member',v_from_status,p_status,
    jsonb_build_object(
      'groupId',p_group_id,
      'groupVersion',v_new_version,
      'lineOrdinal',a.line_ordinal,
      'scope','group'
    )
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id;

  return public.f11_group_management_payload(p_business_id,p_group_id);
end
$$;

revoke all on function public.set_appointment_group_status(uuid,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.set_appointment_group_status(uuid,uuid,text,integer,text)
  to authenticated;

commit;
