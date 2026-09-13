begin;

-- S04: keep expected domain failures inside a subtransaction so request counters
-- survive the normal PostgREST commit. Old RPCs remain owner-only implementation.
alter table public.public_booking_rate_counters
  drop constraint public_booking_rate_counters_action_check,
  drop constraint public_booking_rate_counters_dimension_check,
  add constraint public_booking_rate_counters_action_check check
    (action in ('read','create','recover','slot','request','manage_read','manage_slot','manage_change','manage_cancel','business_create')),
  add constraint public_booking_rate_counters_dimension_check check
    (dimension in ('actor','network','business','user'));

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
  if p_action not in ('read','create','recover','slot','request','manage_read','manage_slot','manage_change','manage_cancel','business_create')
     or p_dimension not in ('actor','network','business','user')
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

revoke all on function public.consume_public_booking_rate(text,text,text,integer,integer) from public;


create function public.public_operation_error(p_message text)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','PUBLIC_BOOKING_DISABLED','IDEMPOTENCY_CONFLICT',
      'IDEMPOTENCY_IN_PROGRESS','APPOINTMENT_CONFLICT','SLOT_UNAVAILABLE','DATE_OUT_OF_RANGE',
      'PUBLIC_CONTACT_REQUIRED','INVALID_CUSTOMER_NAME','INVALID_CUSTOMER_PHONE',
      'INVALID_CUSTOMER_EMAIL','NOTES_TOO_LONG','INVALID_START','INVALID_DATE',
      'INVALID_BOOKING_RECOVERY_BOOTSTRAP','INVALID_IDEMPOTENCY_KEY',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;
revoke all on function public.public_operation_error(text) from public, anon, authenticated;

-- All callers acquire network -> actor -> (optional) business counters in this
-- order. Rejection rolls back only this quota acquisition, never earlier budgets.
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
revoke all on function public.enforce_public_booking_rate(text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.consume_public_booking_rate(text,text,text,integer,integer) from public, anon, authenticated;

create function public.execute_public_operation(
  p_action text, p_args jsonb, p_gate_secret text, p_actor_hash text, p_network_hash text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
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
    when 'slots' then 'slot' when 'book' then 'request' when 'recover' then 'recover'
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
  exception when others then null; -- Opportunistic maintenance must not hide booking outcome.
  end;
  -- Before casting or touching booking/capability tables; invalid arguments still count.
  if p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text) > 16384 then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  if p_action = 'book' then
    begin
      v_recovery_id := (p_args->>'p_recovery_id')::uuid;
      if v_recovery_id is null then raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP'; end if;
      -- Same lock as raw create/recover, before classification of concurrent first requests.
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
    -- Public operations always use the capability, not an incidental auth JWT.
    -- Clear both claim representations used by local and hosted auth.uid().
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
    when 'slots' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.compute_public_booking_slots((p_args->>'p_slug')::text, (p_args->>'p_service_id')::uuid, (p_args->>'p_date')::date, (p_args->>'p_staff_id')::uuid) r;
    when 'book' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.create_public_appointment_with_recovery((p_args->>'p_slug')::text, (p_args->>'p_idempotency_key')::text, (p_args->>'p_customer_name')::text, (p_args->>'p_service_id')::uuid, (p_args->>'p_staff_id')::uuid, (p_args->>'p_starts_at')::timestamptz, (p_args->>'p_management_token_hash')::text, (p_args->>'p_recovery_id')::uuid, (p_args->>'p_recovery_secret_hash')::text, (p_args->>'p_management_token_ciphertext')::text, (p_args->>'p_management_token_iv')::text, (p_args->>'p_key_version')::smallint, (p_args->>'p_customer_phone')::text, (p_args->>'p_customer_email')::text, (p_args->>'p_notes')::text) r;
    when 'recover' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.recover_public_appointment((p_args->>'p_recovery_id')::uuid, (p_args->>'p_idempotency_key')::text, (p_args->>'p_recovery_secret_hash')::text) r;
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
    -- The subtransaction restores JWT settings AND rolls back all domain effects.
    -- Never forward SQL DETAIL/HINT/raw unknown messages (which may contain PII).
    return public.public_operation_error(sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'data', v_data);
end
$$;
revoke all on function public.execute_public_operation(text,jsonb,text,text,text) from public, anon, authenticated;
grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;

create function public.create_business_with_owner_guarded(
  p_name text, p_slug text, p_timezone text default 'Europe/Istanbul'
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid := auth.uid(); v_data jsonb;
begin
  if v_user is null then return public.public_operation_error('AUTH_REQUIRED'); end if;
  begin
    perform public.consume_public_booking_rate('business_create','user',
      encode(digest(v_user::text,'sha256'),'hex'),5,3600);
  exception when others then return public.public_operation_error(sqlerrm);
  end;
  begin
    perform public.prune_public_booking_rate_counters();
  exception when others then null;
  end;
  begin
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
    from public.create_business_with_owner(p_name,p_slug,p_timezone) r;
  exception when unique_violation then return public.public_operation_error('BUSINESS_SLUG_TAKEN');
  when others then return public.public_operation_error(sqlerrm);
  end;
  return jsonb_build_object('ok',true,'data',v_data);
end
$$;
revoke all on function public.create_business_with_owner_guarded(text,text,text) from public, anon, authenticated;
grant execute on function public.create_business_with_owner_guarded(text,text,text) to authenticated;

-- Cleanup runs only after successful admission. It is not run on rejected requests. SKIP LOCKED
-- avoids public transactions contending on the same 500 stale keys.
create or replace function public.prune_public_booking_rate_counters()
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.public_booking_rate_counters c where c.ctid in (
    select stale.ctid from public.public_booking_rate_counters stale
    where stale.updated_at < clock_timestamp() - interval '48 hours'
    order by stale.updated_at limit 500 for update skip locked
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;
revoke all on function public.prune_public_booking_rate_counters() from public, anon, authenticated;

revoke execute on function public.create_business_with_owner(text,text,text) from public, anon, authenticated;
revoke execute on function public.provision_public_management_token(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_managed_appointment(text) from public, anon, authenticated;
revoke execute on function public.compute_public_management_slots(text,date,uuid) from public, anon, authenticated;
revoke execute on function public.reschedule_public_managed_appointment(text,text,uuid,timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_public_managed_appointment(text,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_business(text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_services(text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_staff(text,uuid) from public, anon, authenticated;
revoke execute on function public.compute_public_booking_slots(text,uuid,date,uuid) from public, anon, authenticated;
revoke execute on function public.create_public_appointment(text,text,text,uuid,uuid,timestamptz,text,text,text) from public, anon, authenticated;
revoke execute on function public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text) from public, anon, authenticated;
revoke execute on function public.recover_public_appointment(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_business_guarded(text,text,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_services_guarded(text,text,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_staff_guarded(text,uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.recover_public_appointment_guarded(uuid,text,text,text,text,text) from public, anon, authenticated;

commit;
