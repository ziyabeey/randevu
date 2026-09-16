begin;

-- F11-02 public planning is a narrow server-gated projection over the same
-- authoritative planner used by authenticated operators. It does not introduce
-- a second availability engine or expose any internal planner to browser roles.
create or replace function public.compute_public_booking_group_plans(
  p_slug text,
  p_lines jsonb,
  p_date date,
  p_limit integer default 25
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_business_id uuid;
  v_timezone text;
  v_step_minutes integer;
  v_min_notice_minutes integer;
  v_horizon_days integer;
  v_today date;
  v_local timestamp without time zone;
  v_absolute timestamptz;
  v_plan jsonb;
  v_plans jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_truncated boolean := false;
begin
  if p_date is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'INVALID_GROUP_PLAN_QUERY';
  end if;

  select b.id, b.timezone, s.step_minutes, s.min_notice_minutes, s.horizon_days
  into v_business_id, v_timezone, v_step_minutes, v_min_notice_minutes, v_horizon_days
  from public.businesses b
  join public.public_booking_settings s on s.business_id = b.id
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug) = lower(trim(p_slug))
    and s.enabled
    and r.publishable
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;

  v_today := (clock_timestamp() at time zone v_timezone)::date;
  if p_date < v_today or p_date > v_today + v_horizon_days then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  -- Service/currency/staff candidate validation happens once even when the day
  -- contains no valid slot. K03 candidate and estimate limits therefore fail
  -- before the wall-clock scan.
  perform public.f11_normalize_group_intent_internal(v_business_id, p_lines);

  v_local := p_date::timestamp;
  while v_local < (p_date + 1)::timestamp loop
    v_absolute := v_local at time zone v_timezone;

    -- Reject spring-forward wall times normalized by PostgreSQL. Public notice
    -- filtering is applied before invoking the shared planner.
    if (v_absolute at time zone v_timezone) = v_local
       and v_absolute >= clock_timestamp() + make_interval(mins => v_min_notice_minutes) then
      v_plan := public.f11_build_group_plan_internal(v_business_id, v_absolute, p_lines);
      if v_plan is not null then
        v_count := v_count + 1;
        if v_count <= p_limit then
          v_plans := v_plans || jsonb_build_array(v_plan);
        else
          v_truncated := true;
          exit;
        end if;
      end if;
    end if;

    v_local := v_local + make_interval(mins => v_step_minutes);
  end loop;

  return jsonb_build_object(
    'plans', v_plans,
    'truncated', v_truncated,
    'stepMinutes', v_step_minutes,
    'date', p_date,
    'timezone', v_timezone
  );
end
$$;

revoke all on function public.compute_public_booking_group_plans(text,jsonb,date,integer)
  from public, anon, authenticated;

-- Preserve the existing sanitized public envelope while admitting explicit F11
-- planning failures. Internal SQL text and unrecognized failures still collapse
-- to PUBLIC_OPERATION_UNAVAILABLE.
create or replace function public.public_operation_error(p_message text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','PUBLIC_BOOKING_DISABLED','IDEMPOTENCY_CONFLICT',
      'IDEMPOTENCY_IN_PROGRESS','APPOINTMENT_CONFLICT','SLOT_UNAVAILABLE','DATE_OUT_OF_RANGE',
      'PUBLIC_CONTACT_REQUIRED','INVALID_CUSTOMER_NAME','INVALID_CUSTOMER_PHONE',
      'INVALID_CUSTOMER_EMAIL','NOTES_TOO_LONG','INVALID_START','INVALID_DATE',
      'INVALID_BOOKING_RECOVERY_BOOTSTRAP','INVALID_IDEMPOTENCY_KEY',
      'BOOKING_INTENT_CLOSED','BOOKING_INTENT_DEADLINE_EXPIRED',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION','PUBLIC_SERVICES_LIMIT_EXCEEDED','PUBLIC_STAFF_LIMIT_EXCEEDED',
      'INVALID_BOOKING_GROUP','INVALID_BOOKING_GROUP_LINES','INVALID_GROUP_PLAN_QUERY',
      'BOOKING_CANDIDATE_BUDGET_EXCEEDED','BOOKING_ESTIMATE_LIMIT_EXCEEDED','CURRENCY_MISMATCH'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

create or replace function public.execute_public_operation(
  p_action text, p_args jsonb, p_gate_secret text, p_actor_hash text, p_network_hash text
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
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_prior_claims text := current_setting('request.jwt.claims', true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    return public.public_operation_error('PUBLIC_BOOKING_GATE_UNAVAILABLE');
  end if;
  v_class := case p_action
    when 'business' then 'read' when 'services' then 'read' when 'staff' then 'read'
    when 'profile' then 'read' when 'media' then 'read'
    when 'slots' then 'slot' when 'group_plans' then 'slot' when 'book' then 'request'
    when 'recover' then 'recover' when 'resolve' then 'recover'
    when 'manage_view' then 'manage_read' when 'manage_slots' then 'manage_slot'
    when 'manage_reschedule' then 'manage_change' when 'manage_cancel' then 'manage_cancel'
    else null end;
  if v_class is null then return public.public_operation_error('INVALID_PUBLIC_OPERATION'); end if;
  begin
    perform public.enforce_public_booking_rate(v_class, p_actor_hash, p_network_hash);
  exception when others then return public.public_operation_error(sqlerrm);
  end;
  begin
    perform public.prune_public_booking_rate_counters();
  exception when others then null;
  end;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text) > 16384 then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  if p_action = 'book' then
    begin
      v_recovery_id := (p_args->>'p_recovery_id')::uuid;
      if v_recovery_id is null then raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_recovery_id::text, 0));
      select b.id into v_business_id from public.businesses b
        where b.slug = lower(trim(p_args->>'p_slug')) limit 1;
      if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
      select exists(select 1 from public.public_booking_recoveries r
        where r.business_id = v_business_id and r.recovery_id = v_recovery_id
          and r.idempotency_key = p_args->>'p_idempotency_key'
          and r.management_token_hash = p_args->>'p_management_token_hash'
          and r.recovery_secret_hash = p_args->>'p_recovery_secret_hash'
          and r.appointment_id is not null) into v_safe_retry;
    exception when invalid_text_representation then
      return public.public_operation_error('INVALID_BOOKING_RECOVERY_BOOTSTRAP');
    when others then return public.public_operation_error(sqlerrm);
    end;
    if not v_safe_retry then
      begin
        perform public.enforce_public_booking_rate('create', p_actor_hash, p_network_hash, v_business_id);
      exception when others then return public.public_operation_error(sqlerrm);
      end;
    end if;
  end if;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    case p_action
    when 'business' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_booking_business((p_args->>'p_slug')::text) r;
    when 'services' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_booking_services((p_args->>'p_slug')::text) r;
    when 'staff' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_booking_staff((p_args->>'p_slug')::text, (p_args->>'p_service_id')::uuid) r;
    when 'profile' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_business_profile((p_args->>'p_slug')::text) r;
    when 'media' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_media_object((p_args->>'p_media_id')::uuid) r;
    when 'slots' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.compute_public_booking_slots((p_args->>'p_slug')::text, (p_args->>'p_service_id')::uuid, (p_args->>'p_date')::date, (p_args->>'p_staff_id')::uuid) r;
    when 'group_plans' then
      select public.compute_public_booking_group_plans(
        (p_args->>'p_slug')::text,
        p_args->'p_lines',
        (p_args->>'p_date')::date,
        coalesce((p_args->>'p_limit')::integer, 25)
      ) into v_data;
    when 'book' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.create_public_appointment_with_recovery(
        (p_args->>'p_slug')::text,
        (p_args->>'p_idempotency_key')::text,
        (p_args->>'p_customer_name')::text,
        (p_args->>'p_service_id')::uuid,
        (p_args->>'p_staff_id')::uuid,
        (p_args->>'p_starts_at')::timestamptz,
        (p_args->>'p_management_token_hash')::text,
        (p_args->>'p_recovery_id')::uuid,
        (p_args->>'p_recovery_secret_hash')::text,
        (p_args->>'p_management_token_ciphertext')::text,
        (p_args->>'p_management_token_iv')::text,
        (p_args->>'p_key_version')::smallint,
        (p_args->>'p_customer_phone')::text,
        (p_args->>'p_customer_email')::text,
        (p_args->>'p_notes')::text
      ) r;
    when 'recover' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.recover_public_appointment(
        (p_args->>'p_recovery_id')::uuid,
        (p_args->>'p_idempotency_key')::text,
        (p_args->>'p_recovery_secret_hash')::text
      ) r;
    when 'resolve' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.resolve_public_booking_intent_v2(
        (p_args->>'p_recovery_id')::text,
        (p_args->>'p_idempotency_key')::text,
        (p_args->>'p_recovery_secret_hash')::text
      ) r;
    when 'manage_view' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_managed_appointment((p_args->>'p_token')::text) r;
    when 'manage_slots' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.compute_public_management_slots((p_args->>'p_token')::text, (p_args->>'p_date')::date, (p_args->>'p_staff_id')::uuid) r;
    when 'manage_reschedule' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.reschedule_public_managed_appointment((p_args->>'p_token')::text, (p_args->>'p_idempotency_key')::text, (p_args->>'p_staff_id')::uuid, (p_args->>'p_starts_at')::timestamptz) r;
    when 'manage_cancel' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.cancel_public_managed_appointment((p_args->>'p_token')::text, (p_args->>'p_idempotency_key')::text, (p_args->>'p_reason')::text) r;
    end case;
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  exception when invalid_text_representation or datetime_field_overflow then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  when others then
    return public.public_operation_error(sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'data', v_data);
end
$$;

revoke all on function public.public_operation_error(text) from public, anon, authenticated;
revoke all on function public.execute_public_operation(text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;

commit;
