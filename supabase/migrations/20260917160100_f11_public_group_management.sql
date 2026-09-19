begin;

-- F11-03 public management keeps the opaque /m#token capability as the only
-- anonymous authority. The token resolves to exactly one group_id; appointment_id
-- remains a compatibility anchor and never authorizes a sibling by itself.

create or replace function public.f11_public_management_group_ref(p_token text)
returns table(
  business_id uuid,
  group_id uuid,
  appointment_id uuid,
  recovery_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_token is null or char_length(p_token) <> 43 then
    return;
  end if;

  return query
  select
    cap.business_id,
    cap.group_id,
    cap.appointment_id,
    r.recovery_id
  from public.appointment_management_capabilities cap
  join public.appointment_groups g
    on g.business_id=cap.business_id and g.id=cap.group_id
  join public.appointments a
    on a.business_id=cap.business_id and a.id=cap.appointment_id
   and a.group_id=cap.group_id
  left join lateral (
    select pr.recovery_id
    from public.public_booking_recoveries pr
    where pr.business_id=cap.business_id
      and pr.group_id=cap.group_id
      and pr.appointment_id=cap.appointment_id
      and pr.management_token_hash=cap.token_hash
    order by pr.created_at desc, pr.recovery_id
    limit 1
  ) r on true
  where cap.token_hash=public.management_token_hash(p_token)
    and cap.revoked_at is null
    and cap.group_id is not null
    and cap.appointment_id is not null
    and g.customer_id=a.customer_id
    and g.source=a.source
  limit 1;
end
$$;

revoke all on function public.f11_public_management_group_ref(text)
  from public, anon, authenticated;

create or replace function public.f11_public_managed_group_payload(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ref record;
  v_group public.appointment_groups;
begin
  select * into v_ref from public.f11_public_management_group_ref(p_token);
  if not found then return null; end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=v_ref.business_id and g.id=v_ref.group_id;

  -- Legacy one-line clients retain the exact historical response shape. The
  -- additive group payload is emitted only for native F11 group bookings.
  if v_group.id is null or v_group.legacy_appointment_id is not null then
    return null;
  end if;

  return public.f11_group_management_payload(v_ref.business_id,v_ref.group_id);
end
$$;

revoke all on function public.f11_public_managed_group_payload(text)
  from public, anon, authenticated;

create or replace function public.compute_public_group_management_slots(
  p_token text,
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
declare
  v_ref record;
  v_group public.appointment_groups;
  v_timezone text;
  v_horizon_days integer;
  v_min_notice_minutes integer;
  v_today date;
begin
  select * into v_ref from public.f11_public_management_group_ref(p_token);
  if not found then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=v_ref.business_id and g.id=v_ref.group_id;
  if v_group.id is null or v_group.legacy_appointment_id is not null then
    raise exception 'MANAGEMENT_GROUP_REQUIRED';
  end if;
  if v_group.source <> 'public' then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  select b.timezone,s.horizon_days,s.min_notice_minutes
  into v_timezone,v_horizon_days,v_min_notice_minutes
  from public.businesses b
  join public.public_booking_settings s on s.business_id=b.id
  where b.id=v_ref.business_id;
  if v_timezone is null then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  v_today := (now() at time zone v_timezone)::date;
  if p_date is null or p_date < v_today or p_date > v_today+v_horizon_days then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  return query
  select s.starts_at,s.ends_at,s.timezone,s.total_duration_minutes,s.lines
  from public.f11_existing_group_reschedule_slots_internal(
    v_ref.business_id,v_ref.group_id,p_date,p_step_minutes
  ) s
  where s.starts_at >= now()+make_interval(mins=>v_min_notice_minutes)
  order by s.starts_at;
end
$$;

revoke all on function public.compute_public_group_management_slots(text,date,integer)
  from public, anon, authenticated;

create or replace function public.reschedule_public_managed_group(
  p_token text,
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
declare
  v_ref record;
  v_group public.appointment_groups;
  v_timezone text;
  v_horizon_days integer;
  v_min_notice_minutes integer;
  v_today date;
  v_date date;
  v_hash text;
  v_preexisting boolean := false;
  v_result jsonb;
begin
  select * into v_ref from public.f11_public_management_group_ref(p_token);
  if not found then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=v_ref.business_id and g.id=v_ref.group_id;
  if v_group.id is null or v_group.legacy_appointment_id is not null or v_group.source<>'public' then
    raise exception 'MANAGEMENT_GROUP_REQUIRED';
  end if;

  select b.timezone,s.horizon_days,s.min_notice_minutes
  into v_timezone,v_horizon_days,v_min_notice_minutes
  from public.businesses b
  join public.public_booking_settings s on s.business_id=b.id
  where b.id=v_ref.business_id;
  if v_timezone is null or p_starts_at is null then raise exception 'SLOT_UNAVAILABLE'; end if;

  v_today := (now() at time zone v_timezone)::date;
  v_date := (p_starts_at at time zone v_timezone)::date;
  if v_date < v_today or v_date > v_today+v_horizon_days
     or p_starts_at < now()+make_interval(mins=>v_min_notice_minutes) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Serialize the wrapper with the core so only the transaction that creates
  -- the command emits the one frozen reschedule notification.
  perform pg_advisory_xact_lock(hashtextextended(
    'f11:group-management:'||v_ref.business_id::text||':'||v_ref.group_id::text,0
  ));
  v_hash := md5(jsonb_build_object(
    'groupId',v_ref.group_id,
    'expectedVersion',p_expected_version,
    'startsAt',p_starts_at
  )::text);
  select exists(
    select 1 from public.booking_commands bc
    where bc.business_id=v_ref.business_id and bc.idempotency_key=p_idempotency_key
  ) into v_preexisting;

  v_result := public.f11_reschedule_group_core(
    v_ref.business_id,v_ref.group_id,p_idempotency_key,p_expected_version,p_starts_at,
    'public_group_reschedule','public',null
  );

  if not v_preexisting and v_ref.recovery_id is not null then
    perform public.create_public_booking_confirmation_event(
      v_ref.business_id,v_ref.appointment_id,v_ref.recovery_id,'rescheduled'
    );
  end if;

  return v_result;
end
$$;

revoke all on function public.reschedule_public_managed_group(text,text,integer,timestamptz)
  from public, anon, authenticated;

create or replace function public.cancel_public_managed_group(
  p_token text,
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
  v_ref record;
  v_group public.appointment_groups;
begin
  select * into v_ref from public.f11_public_management_group_ref(p_token);
  if not found then raise exception 'MANAGEMENT_NOT_FOUND'; end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=v_ref.business_id and g.id=v_ref.group_id;
  if v_group.id is null or v_group.legacy_appointment_id is not null or v_group.source<>'public' then
    raise exception 'MANAGEMENT_GROUP_REQUIRED';
  end if;

  return public.f11_cancel_group_core(
    v_ref.business_id,v_ref.group_id,p_idempotency_key,p_expected_version,p_reason,
    'public_group_cancel','public',null
  );
end
$$;

revoke all on function public.cancel_public_managed_group(text,text,integer,text)
  from public, anon, authenticated;

-- Public dispatcher remains the only anon execution grant. Existing action
-- branches are copied byte-for-byte; F11-03 adds group management branches and
-- an additive group_payload on manage_view only for a native F11 group token.
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
  v_group_payload jsonb;
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
    when 'manage_group_slots' then 'manage_slot'
    when 'manage_reschedule' then 'manage_change' when 'manage_cancel' then 'manage_cancel'
    when 'manage_group_reschedule' then 'manage_change'
    when 'manage_group_cancel' then 'manage_cancel'
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
        if jsonb_array_length(v_data)>0 then
          v_group_payload:=public.f11_public_managed_group_payload((p_args->>'p_token')::text);
          if v_group_payload is not null then
            v_data:=jsonb_set(v_data,'{0}',
              (v_data->0)||jsonb_build_object('group_payload',v_group_payload));
          end if;
        end if;
      when 'manage_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_management_slots(
          (p_args->>'p_token')::text,(p_args->>'p_date')::date,
          (p_args->>'p_staff_id')::uuid
        ) r;
      when 'manage_group_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_group_management_slots(
          (p_args->>'p_token')::text,(p_args->>'p_date')::date,
          coalesce((p_args->>'p_step_minutes')::integer,15)
        ) r;
      when 'manage_reschedule' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.reschedule_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_staff_id')::uuid,(p_args->>'p_starts_at')::timestamptz
        ) r;
      when 'manage_group_reschedule' then
        v_group_payload:=public.reschedule_public_managed_group(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_expected_version')::integer,(p_args->>'p_starts_at')::timestamptz
        );
        v_data:=jsonb_build_array(jsonb_build_object('group_payload',v_group_payload));
      when 'manage_cancel' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.cancel_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_reason')::text
        ) r;
      when 'manage_group_cancel' then
        v_group_payload:=public.cancel_public_managed_group(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_expected_version')::integer,(p_args->>'p_reason')::text
        );
        v_data:=jsonb_build_array(jsonb_build_object('group_payload',v_group_payload));
    end case;

    -- Only an already authenticated recovery result may acquire the group
    -- projection. Absence/expired-link responses retain their PII-free shape;
    -- legacy single-service JSON is unchanged (no extra null group field).
    if p_action in ('recover','resolve')
       and v_data #>> '{0,appointment_id}' is not null then
      select public.f11_group_payload(r.business_id,r.group_id)
      into v_group_payload
      from public.public_booking_recoveries r
      join public.booking_commands bc
        on bc.business_id=r.business_id and bc.idempotency_key=r.idempotency_key
       and bc.appointment_id=r.appointment_id and bc.group_id=r.group_id
      where r.recovery_id=(p_args->>'p_recovery_id')::uuid
        and r.idempotency_key=p_args->>'p_idempotency_key'
        and r.appointment_id=(v_data#>>'{0,appointment_id}')::uuid
        and bc.command='public_create_group' and bc.source='public';
      if found then
        if v_group_payload is null then
          raise exception 'IDEMPOTENCY_RESULT_MISSING';
        end if;
        v_data:=jsonb_set(v_data,'{0}',
          (v_data->0)||jsonb_build_object('group_payload',v_group_payload));
      end if;
    end if;
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
