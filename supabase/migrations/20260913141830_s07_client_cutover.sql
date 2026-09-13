begin;

-- S07 B: complete the browser cutover without creating a second booking path.
-- Legacy v1 requests can still recover or replay an already committed command,
-- while a new v1 first-create is rejected under the recovery advisory lock.

create or replace function public.create_public_appointment_with_recovery(
  p_slug text,
  p_idempotency_key text,
  p_customer_name text,
  p_service_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_management_token_hash text,
  p_recovery_id uuid,
  p_recovery_secret_hash text,
  p_management_token_ciphertext text,
  p_management_token_iv text,
  p_key_version smallint,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns table(
  appointment_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  recovery_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_business_id uuid;
  v_bootstrap public.public_booking_recoveries;
  v_created record;
  v_cap_hash text;
  v_expires_at timestamptz;
  v_is_v2 boolean := false;
  v_deadline bigint;
  v_fence public.public_booking_resolution_closures;
  v_command public.booking_commands;
begin
  if p_idempotency_key is null
     or char_length(p_idempotency_key) < 8
     or char_length(p_idempotency_key) > 128
     or p_recovery_id is null
     or p_management_token_hash is null
     or p_management_token_hash !~ '^[0-9a-f]{64}$'
     or p_recovery_secret_hash is null
     or p_recovery_secret_hash !~ '^[0-9a-f]{64}$'
     or p_management_token_ciphertext is null
     or char_length(p_management_token_ciphertext) < 32
     or char_length(p_management_token_ciphertext) > 512
     or p_management_token_iv is null
     or char_length(p_management_token_iv) < 12
     or char_length(p_management_token_iv) > 64
     or p_key_version is null
     or p_key_version < 1 then
    raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP';
  end if;

  -- Namespace lookalikes never fall back to the legacy v1 key contract.
  if p_idempotency_key ~* '^[[:space:]]*pub2_' then
    if not public.public_booking_v2_key_matches(
        p_idempotency_key, p_recovery_id, p_recovery_secret_hash
      ) then
      raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP';
    end if;
    v_is_v2 := true;
    v_deadline := substr(p_idempotency_key, 6, 10)::bigint;
    if v_deadline > floor(extract(epoch from clock_timestamp()))::bigint + 330 then
      raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP';
    end if;
  end if;

  -- Validation above is side-effect free. The established recovery lock remains
  -- the first serialized operation for this intent.
  perform pg_advisory_xact_lock(hashtextextended(p_recovery_id::text, 0));

  if v_is_v2 then
    -- Exact fence lookup precedes the fresh wall-clock decision. FOR KEY SHARE
    -- also makes maintenance skip a fence while this decision consumes it.
    select f.* into v_fence
    from public.public_booking_resolution_closures f
    where f.idempotency_key = p_idempotency_key
    for key share;

    if found then
      if v_fence.recovery_id is distinct from p_recovery_id
         or v_fence.submit_deadline is distinct from v_deadline then
        raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP';
      end if;
      raise exception 'BOOKING_INTENT_CLOSED';
    end if;

    if clock_timestamp() >= to_timestamp(v_deadline::double precision) then
      raise exception 'BOOKING_INTENT_DEADLINE_EXPIRED';
    end if;
  end if;

  select b.id into v_business_id
  from public.businesses b
  where lower(b.slug) = lower(trim(p_slug))
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;

  if not v_is_v2 then
    -- A legacy create may only replay durable, fully bound pre-cutover evidence.
    -- The command check happens under the established recovery lock, before a
    -- bootstrap, appointment, capability or outbox row can be created.
    select * into v_bootstrap
    from public.public_booking_recoveries r
    where r.business_id = v_business_id
      and r.idempotency_key = p_idempotency_key;

    select * into v_command
    from public.booking_commands bc
    where bc.business_id = v_business_id
      and bc.idempotency_key = p_idempotency_key;

    if v_command.business_id is null then
      raise exception 'BOOKING_CLIENT_UPDATE_REQUIRED';
    end if;

    if v_bootstrap.recovery_id is null
       or v_bootstrap.recovery_id is distinct from p_recovery_id
       or v_bootstrap.management_token_hash is distinct from p_management_token_hash
       or v_bootstrap.recovery_secret_hash is distinct from p_recovery_secret_hash
       or v_bootstrap.appointment_id is null
       or v_command.command is distinct from 'public_create'
       or v_command.source is distinct from 'public'
       or v_command.appointment_id is null
       or v_command.appointment_id is distinct from v_bootstrap.appointment_id
       or not exists (
         select 1
         from public.appointments a
         where a.business_id = v_business_id
           and a.id = v_command.appointment_id
           and a.source = 'public'
       )
       or not exists (
         select 1
         from public.appointment_management_capabilities cap
         where cap.business_id = v_business_id
           and cap.appointment_id = v_command.appointment_id
           and cap.token_hash = p_management_token_hash
       ) then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  begin
    insert into public.public_booking_recoveries(
      recovery_id, business_id, idempotency_key,
      management_token_hash, recovery_secret_hash,
      management_token_ciphertext, management_token_iv, key_version,
      expires_at
    ) values (
      p_recovery_id, v_business_id, p_idempotency_key,
      p_management_token_hash, p_recovery_secret_hash,
      p_management_token_ciphertext, p_management_token_iv, p_key_version,
      now() + interval '72 hours'
    )
    on conflict (business_id, idempotency_key) do nothing;
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  select * into v_bootstrap
  from public.public_booking_recoveries r
  where r.business_id = v_business_id
    and r.idempotency_key = p_idempotency_key;

  if v_bootstrap.recovery_id is null
     or v_bootstrap.recovery_id <> p_recovery_id
     or v_bootstrap.management_token_hash <> p_management_token_hash
     or v_bootstrap.recovery_secret_hash is distinct from p_recovery_secret_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  select * into v_created
  from public.create_public_appointment(
    p_slug,
    p_idempotency_key,
    p_customer_name,
    p_service_id,
    p_staff_id,
    p_starts_at,
    p_customer_phone,
    p_customer_email,
    p_notes
  );

  if v_created.appointment_id is null then
    raise exception 'IDEMPOTENCY_RESULT_MISSING';
  end if;

  if v_bootstrap.appointment_id is not null
     and v_bootstrap.appointment_id <> v_created.appointment_id then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  begin
    insert into public.appointment_management_capabilities(
      appointment_id, business_id, token_hash
    ) values (
      v_created.appointment_id, v_business_id, p_management_token_hash
    )
    on conflict on constraint appointment_management_capabilities_pkey do nothing;
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end;

  select cap.token_hash into v_cap_hash
  from public.appointment_management_capabilities cap
  where cap.appointment_id = v_created.appointment_id
    and cap.business_id = v_business_id;

  if v_cap_hash is null or v_cap_hash <> p_management_token_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  update public.public_booking_recoveries r
  set appointment_id = v_created.appointment_id
  where r.recovery_id = p_recovery_id
    and r.business_id = v_business_id
    and (r.appointment_id is null or r.appointment_id = v_created.appointment_id);

  select r.expires_at into v_expires_at
  from public.public_booking_recoveries r
  where r.recovery_id = p_recovery_id
    and r.business_id = v_business_id
    and r.appointment_id = v_created.appointment_id;

  if v_expires_at is null then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  return query select
    v_created.appointment_id,
    v_created.status,
    v_created.starts_at,
    v_created.ends_at,
    v_created.timezone,
    v_created.service_name,
    v_created.staff_name,
    v_created.price_minor,
    v_created.currency,
    v_expires_at;
end
$$;

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
      'BOOKING_CLIENT_UPDATE_REQUIRED',
      'BOOKING_INTENT_CLOSED','BOOKING_INTENT_DEADLINE_EXPIRED',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

revoke all on function public.create_public_appointment_with_recovery(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text
) from public, anon, authenticated;
revoke all on function public.public_operation_error(text)
  from public, anon, authenticated;

commit;
