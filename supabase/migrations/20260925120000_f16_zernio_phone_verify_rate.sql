begin;

-- F16-02 owns OTP attempt limiting now that Zernio is transport-only.
--
-- The OTP challenge is stateless, so the actor/network `verify` class alone
-- cannot bound guesses: an attacker can rotate the actor cookie and spread
-- checks across networks. Every start and check therefore also spends a
-- per-phone budget keyed by the Worker's HMAC of the normalized number (never
-- the number itself): 3 sends and 5 checks per 10 minutes and 30 operations
-- per 24 hours, whatever actor or network asks.
alter table public.public_booking_rate_counters
  drop constraint public_booking_rate_counters_action_check,
  add constraint public_booking_rate_counters_action_check check
    (action in ('read','create','recover','slot','request','manage_read','manage_slot','manage_change','manage_cancel','business_create','verify','verify_send','verify_check','verify_day')),
  drop constraint public_booking_rate_counters_dimension_check,
  add constraint public_booking_rate_counters_dimension_check check
    (dimension in ('actor','network','business','user','phone'));

create or replace function public.consume_public_booking_rate(
  p_action text,
  p_dimension text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_count integer;
  v_retry_after integer;
begin
  if p_action not in ('read','create','recover','slot','request','manage_read','manage_slot','manage_change','manage_cancel','business_create','verify','verify_send','verify_check','verify_day')
     or p_dimension not in ('actor','network','business','user','phone')
     or p_key_hash is null
     or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.public_booking_rate_counters(
    action, dimension, key_hash, window_started_at, count, updated_at
  ) values (
    p_action, p_dimension, p_key_hash, v_window_start, 1, v_now
  )
  on conflict (action, dimension, key_hash) do update
  set window_started_at = case
        when public.public_booking_rate_counters.window_started_at >= v_window_start
          then public.public_booking_rate_counters.window_started_at
        else v_window_start
      end,
      count = case
        when public.public_booking_rate_counters.window_started_at >= v_window_start
          then public.public_booking_rate_counters.count + 1
        else 1
      end,
      updated_at = v_now
  returning count, window_started_at into v_count, v_window_start;

  if v_count > p_limit then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_window_start + make_interval(secs => p_window_seconds) - clock_timestamp()
      )))::integer
    );
    raise exception 'PUBLIC_BOOKING_RATE_LIMITED:%', v_retry_after;
  end if;
end
$$;
revoke all on function public.consume_public_booking_rate(text,text,text,integer,integer)
  from public, anon, authenticated;

create or replace function public.enforce_public_booking_rate(
  p_action text, p_actor_hash text, p_network_hash text, p_business_id uuid default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_cfg public.public_booking_abuse_config;
  v_window integer;
  v_actor integer;
  v_network integer;
begin
  if p_actor_hash is null or p_actor_hash !~ '^[0-9a-f]{64}$'
     or p_network_hash is null or p_network_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
  end if;
  select * into v_cfg from public.public_booking_abuse_config where config_key = 'default';
  if v_cfg.config_key is null then raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE'; end if;
  case p_action
    when 'read' then v_window := v_cfg.read_window_seconds; v_actor := v_cfg.read_actor_limit; v_network := v_cfg.read_network_limit;
    when 'create' then v_window := v_cfg.create_window_seconds; v_actor := v_cfg.create_actor_limit; v_network := v_cfg.create_network_limit;
    when 'recover' then v_window := v_cfg.recover_window_seconds; v_actor := v_cfg.recover_actor_limit; v_network := v_cfg.recover_network_limit;
    when 'slot' then v_window := 60; v_actor := 30; v_network := 300;
    when 'request' then v_window := 60; v_actor := 60; v_network := 600;
    when 'verify' then v_window := 600; v_actor := 8; v_network := 80;
    when 'manage_read' then v_window := 60; v_actor := 60; v_network := 600;
    when 'manage_slot' then v_window := 60; v_actor := 30; v_network := 300;
    when 'manage_change' then v_window := 60; v_actor := 10; v_network := 100;
    when 'manage_cancel' then v_window := 60; v_actor := 10; v_network := 100;
    else raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
  end case;
  perform public.consume_public_booking_rate(p_action, 'network', p_network_hash, v_network, v_window);
  perform public.consume_public_booking_rate(p_action, 'actor', p_actor_hash, v_actor, v_window);
  if p_action = 'create' then
    if p_business_id is null then raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF'; end if;
    perform public.consume_public_booking_rate('create', 'business',
      encode(digest(p_business_id::text, 'sha256'), 'hex'), v_cfg.create_business_limit, v_window);
  end if;
end
$$;
revoke all on function public.enforce_public_booking_rate(text,text,text,uuid)
  from public, anon, authenticated;

-- Per-phone OTP budget. The key is the Worker's HMAC of the normalized phone,
-- so the counter never stores a reversible phone number.
create or replace function public.enforce_public_phone_verify_rate(p_phase text, p_phone_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $f1602phone$
begin
  if p_phase is null or p_phase not in ('start','check')
     or p_phone_key is null or p_phone_key !~ '^[0-9a-f]{64}$' then
    raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
  end if;
  if p_phase = 'start' then
    perform public.consume_public_booking_rate('verify_send', 'phone', p_phone_key, 3, 600);
  else
    perform public.consume_public_booking_rate('verify_check', 'phone', p_phone_key, 5, 600);
  end if;
  perform public.consume_public_booking_rate('verify_day', 'phone', p_phone_key, 30, 86400);
end
$f1602phone$;
revoke all on function public.enforce_public_phone_verify_rate(text,text)
  from public, anon, authenticated;

-- Keep execute_public_operation as the sole anonymous transport. phone_verify
-- returns only the same public business projection while consuming the stricter
-- 10-minute verification budget before Zernio send/check work happens.
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
    when 'business' then 'read' when 'phone_verify' then 'verify' when 'services' then 'read' when 'services_v2' then 'read' when 'staff' then 'read'
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

  if p_action = 'phone_verify' then
    begin
      perform public.enforce_public_phone_verify_rate(p_args->>'p_phase', p_args->>'p_phone_key');
    exception when others then return public.public_operation_error(sqlerrm);
    end;
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
      when 'phone_verify' then
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
        from public.get_public_business_profile_v2((p_args->>'p_slug')::text) r;
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
    if p_action in ('book','group_book','recover','resolve','manage_view')
       and jsonb_typeof(v_data)='array'
       and jsonb_array_length(v_data)>0
       and v_data #>> '{0,appointment_id}' is not null then
      v_data:=jsonb_set(
        v_data,
        '{0}',
        (v_data->0)||jsonb_build_object(
          'notification_status',
          public.f12_customer_notification_status((v_data#>>'{0,appointment_id}')::uuid)
        )
      );
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
