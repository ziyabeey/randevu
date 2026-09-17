begin;

-- F11-02: preserve the legacy function identities and output signatures. The
-- gated JSON response adds a canonical typed group only for group commands.
-- No raw recovery/planner function becomes a browser authority.

create or replace function public.recover_public_appointment(
  p_recovery_id uuid,
  p_idempotency_key text,
  p_recovery_secret_hash text
)
returns table(
  appointment_id uuid,
  business_name text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  management_token_ciphertext text,
  management_token_iv text,
  key_version smallint,
  recovery_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recovery_id is null
     or p_idempotency_key is null
     or char_length(p_idempotency_key) < 8
     or char_length(p_idempotency_key) > 128
     or p_recovery_secret_hash is null
     or p_recovery_secret_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  -- If create is still in-flight for this recovery ID, wait for its transaction
  -- outcome before deciding whether the booking exists.
  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text, 0));

  -- Expired proof material is lazily removed. Encrypted management material stays
  -- for F09-03's bounded delivery window and is not itself a bearer credential.
  update public.public_booking_recoveries r
  set recovery_secret_hash = null
  where r.recovery_id = p_recovery_id
    and r.idempotency_key = p_idempotency_key
    and r.expires_at <= now();

  return query
  select
    a.id,
    b.name,
    a.status,
    a.starts_at,
    a.ends_at,
    a.timezone,
    a.service_name_snapshot,
    a.staff_name_snapshot,
    a.price_minor_snapshot,
    a.currency_snapshot,
    r.management_token_ciphertext,
    r.management_token_iv,
    r.key_version,
    r.expires_at
  from public.public_booking_recoveries r
  join public.appointments a
    on a.business_id = r.business_id
   and a.id = r.appointment_id
  join public.businesses b on b.id = r.business_id
  join public.booking_commands bc
    on bc.business_id = r.business_id
   and bc.idempotency_key = r.idempotency_key
   and bc.appointment_id = r.appointment_id
   and (
     bc.command = 'public_create'
     or (bc.command = 'public_create_group'
       and a.source = 'public' and a.line_ordinal = 1
       and bc.group_id = a.group_id and r.group_id = a.group_id
       and exists (
         select 1 from public.appointment_groups g
         join public.appointment_management_capabilities cap
           on cap.business_id = g.business_id and cap.group_id = g.id
         where g.business_id = r.business_id and g.id = a.group_id
           and g.source = 'public' and g.customer_id = a.customer_id
           and g.legacy_appointment_id is null
           and cap.appointment_id = a.id
           and cap.token_hash = r.management_token_hash
           and cap.revoked_at is null
       ))
   )
   and bc.source = 'public'
  where r.recovery_id = p_recovery_id
    and r.idempotency_key = p_idempotency_key
    and r.recovery_secret_hash = p_recovery_secret_hash
    and r.expires_at > now()
  limit 1;
end
$$;

create or replace function public.resolve_public_booking_intent_v2(
  p_recovery_id text,
  p_idempotency_key text,
  p_recovery_secret_hash text
)
returns table(
  resolution text,
  recovery_id uuid,
  appointment_id uuid,
  business_name text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  management_token_ciphertext text,
  management_token_iv text,
  key_version smallint,
  recovery_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_recovery_id uuid;
  v_deadline bigint;
  v_recovery public.public_booking_recoveries;
  v_appointment public.appointments;
  v_business_name text;
  v_command public.booking_commands;
  v_capability_hash text;
  v_capability_revoked_at timestamptz;
  v_fence public.public_booking_resolution_closures;
begin
  -- This function deliberately returns no row for every malformed or unbound
  -- proof. Only a well-formed, cryptographically bound v2 intent can take a lock
  -- or write a closure.
  if p_recovery_id is null
     or char_length(p_recovery_id) <> 36
     or p_recovery_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_idempotency_key is null
     or char_length(p_idempotency_key) <> 80
     or p_idempotency_key !~ '^pub2_[1-9][0-9]{9}_[0-9a-f]{64}$'
     or p_recovery_secret_hash is null
     or char_length(p_recovery_secret_hash) <> 64
     or p_recovery_secret_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  v_recovery_id := p_recovery_id::uuid;
  v_deadline := substr(p_idempotency_key, 6, 10)::bigint;
  if not public.public_booking_v2_key_matches(
      p_idempotency_key, v_recovery_id, p_recovery_secret_hash
    )
     or v_deadline > floor(extract(epoch from clock_timestamp()))::bigint + 330 then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_recovery_id::text, 0));

  select r.* into v_recovery
  from public.public_booking_recoveries r
  where r.recovery_id = v_recovery_id;

  if found then
    if v_recovery.idempotency_key is distinct from p_idempotency_key
       or v_recovery.appointment_id is null then
      return;
    end if;

    select a.* into v_appointment
    from public.appointments a
    where a.business_id = v_recovery.business_id
      and a.id = v_recovery.appointment_id;
    if not found or v_appointment.source is distinct from 'public' then
      return;
    end if;

    select bc.* into v_command
    from public.booking_commands bc
    where bc.business_id = v_recovery.business_id
      and bc.idempotency_key = p_idempotency_key;
    if not found
       or v_command.appointment_id is distinct from v_recovery.appointment_id
       or v_command.command not in ('public_create', 'public_create_group')
       or v_command.source is distinct from 'public' then
      return;
    end if;

    -- Group recovery is bound to the canonical first line, never an arbitrary
    -- sibling or a command whose group/tenant identity does not agree.
    if v_command.command = 'public_create_group' and (
      v_appointment.line_ordinal is distinct from 1
      or v_recovery.group_id is distinct from v_appointment.group_id
      or v_command.group_id is distinct from v_appointment.group_id
      or not exists (
        select 1 from public.appointment_groups g
        where g.business_id = v_recovery.business_id
          and g.id = v_appointment.group_id and g.source = 'public'
          and g.customer_id = v_appointment.customer_id
          and g.legacy_appointment_id is null
      )
    ) then return; end if;

    select cap.token_hash, cap.revoked_at
    into v_capability_hash, v_capability_revoked_at
    from public.appointment_management_capabilities cap
    where cap.business_id = v_recovery.business_id
      and cap.appointment_id = v_recovery.appointment_id
      and (v_command.command = 'public_create'
        or cap.group_id = v_appointment.group_id);
    if not found or v_capability_hash is distinct from v_recovery.management_token_hash then
      return;
    end if;

    if v_recovery.expires_at > clock_timestamp()
       and v_capability_revoked_at is null
       and v_recovery.management_token_ciphertext is not null
       and v_recovery.management_token_iv is not null then
      select b.name into v_business_name
      from public.businesses b
      where b.id = v_recovery.business_id;
      if not found then return; end if;

      return query select
        'committed'::text,
        v_recovery_id,
        v_appointment.id,
        v_business_name,
        v_appointment.status,
        v_appointment.starts_at,
        v_appointment.ends_at,
        v_appointment.timezone,
        v_appointment.service_name_snapshot,
        v_appointment.staff_name_snapshot,
        v_appointment.price_minor_snapshot,
        v_appointment.currency_snapshot,
        v_recovery.management_token_ciphertext,
        v_recovery.management_token_iv,
        v_recovery.key_version,
        v_recovery.expires_at;
      return;
    end if;

    -- This result intentionally contains no booking snapshot, customer data, or
    -- encrypted capability material.
    return query select
      'exists_nolink'::text, v_recovery_id,
      null::uuid, null::text, null::text, null::timestamptz, null::timestamptz,
      null::text, null::text, null::text, null::integer, null::text,
      null::text, null::text, null::smallint, null::timestamptz;
    return;
  end if;

  -- An orphan command or a recovery row using this exact key is inconsistent
  -- evidence. Never turn it into a terminal absence claim.
  if exists (
      select 1 from public.public_booking_recoveries r
      where r.idempotency_key = p_idempotency_key
    )
     or exists (
      select 1 from public.booking_commands bc
      where bc.idempotency_key = p_idempotency_key
    ) then
    return;
  end if;

  select f.* into v_fence
  from public.public_booking_resolution_closures f
  where f.idempotency_key = p_idempotency_key
  for key share;

  if found then
    if v_fence.recovery_id is distinct from v_recovery_id
       or v_fence.submit_deadline is distinct from v_deadline then
      return;
    end if;
  elsif clock_timestamp() < to_timestamp(v_deadline::double precision) then
    insert into public.public_booking_resolution_closures(
      idempotency_key, recovery_id, submit_deadline
    ) values (
      p_idempotency_key, v_recovery_id, v_deadline
    )
    on conflict (idempotency_key) do nothing;

    select f.* into v_fence
    from public.public_booking_resolution_closures f
    where f.idempotency_key = p_idempotency_key
    for key share;
    if not found
       or v_fence.recovery_id is distinct from v_recovery_id
       or v_fence.submit_deadline is distinct from v_deadline then
      return;
    end if;
  end if;

  return query select
    'closed_absent'::text, v_recovery_id,
    null::uuid, null::text, null::text, null::timestamptz, null::timestamptz,
    null::text, null::text, null::text, null::integer, null::text,
    null::text, null::text, null::smallint, null::timestamptz;
end
$$;

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
    when 'manage_reschedule' then 'manage_change' when 'manage_cancel' then 'manage_cancel'
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
      when 'manage_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_management_slots(
          (p_args->>'p_token')::text,(p_args->>'p_date')::date,
          (p_args->>'p_staff_id')::uuid
        ) r;
      when 'manage_reschedule' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.reschedule_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_staff_id')::uuid,(p_args->>'p_starts_at')::timestamptz
        ) r;
      when 'manage_cancel' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.cancel_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_reason')::text
        ) r;
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

revoke all on function public.recover_public_appointment(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.resolve_public_booking_intent_v2(text,text,text)
  from public, anon, authenticated;
revoke all on function public.execute_public_operation(text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;

commit;
