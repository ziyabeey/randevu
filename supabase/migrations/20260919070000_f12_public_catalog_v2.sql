begin;

-- F12-04C: additive range-aware public catalog projection.
-- The legacy scalar public service RPC remains fixed-only and unchanged.
-- Preserve the bounded public snapshot error at the dispatcher boundary.
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
      'PUBLIC_BOOKING_NOT_FOUND','PUBLIC_BOOKING_DISABLED','PUBLIC_SERVICES_LIMIT_EXCEEDED','IDEMPOTENCY_CONFLICT',
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
      'INVALID_PUBLIC_OPERATION',
      -- F11-03 group management vocabulary.
      'MANAGEMENT_GROUP_REQUIRED','BOOKING_GROUP_MUTATION_REQUIRED',
      'BOOKING_GROUP_VERSION_CONFLICT','INVALID_GROUP_VERSION',
      'BOOKING_GROUP_NOT_RESCHEDULABLE','BOOKING_GROUP_NOT_CANCELLABLE',
      'CANCELLATION_REASON_TOO_LONG'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

revoke all on function public.public_operation_error(text)
  from public, anon, authenticated;

create or replace function public.get_public_booking_services_v2(p_slug text)
returns table(
  service_id uuid,
  name text,
  category text,
  sort_order integer,
  duration_minutes integer,
  price_type text,
  price_min_minor integer,
  price_max_minor integer,
  currency text,
  price_policy_version integer
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_rows integer;
begin
  return query
  select
    sv.id,
    sv.name,
    sv.category,
    sv.sort_order,
    sv.duration_minutes,
    sv.price_type,
    sv.price_min_minor,
    sv.price_max_minor,
    sv.currency,
    sv.price_policy_version
  from public.businesses b
  join public.public_booking_settings pbs
    on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  join public.services sv
    on sv.business_id = b.id and sv.active
  where lower(b.slug) = lower(trim(p_slug))
    and r.publishable
    and exists (
      select 1
      from public.staff_services ss
      join public.staff_profiles sp
        on sp.business_id = ss.business_id
       and sp.id = ss.staff_id
       and sp.active
      where ss.business_id = b.id
        and ss.service_id = sv.id
        and ss.active
    )
  order by lower(sv.category), sv.sort_order, lower(sv.name), sv.id
  limit 101;

  get diagnostics v_rows = row_count;
  if v_rows > 100 then raise exception 'PUBLIC_SERVICES_LIMIT_EXCEEDED'; end if;
end
$$;

revoke all on function public.get_public_booking_services_v2(text)
  from public, anon, authenticated;

-- Keep execute_public_operation as the only anonymous public data transport.
-- This migration only adds the read-class services_v2 action.
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
    when 'business' then 'read' when 'services' then 'read' when 'services_v2' then 'read' when 'staff' then 'read'
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
      when 'services_v2' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_services_v2((p_args->>'p_slug')::text) r;
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
