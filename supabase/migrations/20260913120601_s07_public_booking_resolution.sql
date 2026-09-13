begin;

-- S07 A: a v2 booking intent can be resolved under the same recovery lock as
-- creation. A short-lived closure proves absence without retaining customer or
-- capability material, while committed booking evidence survives recovery-secret
-- and ciphertext cleanup.

create table public.public_booking_resolution_closures (
  idempotency_key text primary key
    check (char_length(idempotency_key) = 80
      and idempotency_key ~ '^pub2_[1-9][0-9]{9}_[0-9a-f]{64}$'),
  recovery_id uuid not null,
  submit_deadline bigint not null check (submit_deadline between 1000000000 and 9999999999),
  closed_at timestamptz not null default clock_timestamp(),
  check (substr(idempotency_key, 6, 10)::bigint = submit_deadline)
);

create index public_booking_resolution_closures_prune_idx
  on public.public_booking_resolution_closures (submit_deadline, idempotency_key);

-- Resolve has no business slug. These two key-only indexes bound its checks for
-- orphaned or conflicting durable evidence without weakening either ledger key.
create index public_booking_recoveries_idempotency_key_idx
  on public.public_booking_recoveries (idempotency_key);
create index booking_commands_idempotency_key_idx
  on public.booking_commands (idempotency_key);

alter table public.public_booking_resolution_closures enable row level security;
alter table public.public_booking_resolution_closures force row level security;
revoke all on table public.public_booking_resolution_closures from public, anon, authenticated;

create function public.public_booking_v2_key_matches(
  p_idempotency_key text,
  p_recovery_id uuid,
  p_recovery_secret_hash text
)
returns boolean
language sql
immutable
strict
parallel safe
security invoker
set search_path = pg_catalog, extensions
as $$
  select case
    when char_length(p_idempotency_key) = 80
      and p_idempotency_key ~ '^pub2_[1-9][0-9]{9}_[0-9a-f]{64}$'
      and char_length(p_recovery_id::text) = 36
      and p_recovery_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and char_length(p_recovery_secret_hash) = 64
      and p_recovery_secret_hash ~ '^[0-9a-f]{64}$'
    then substr(p_idempotency_key, 17, 64) = encode(
      extensions.digest(
        convert_to(
          'yzt:public-booking:intent:v2' || chr(10)
          || p_recovery_id::text || chr(10)
          || substr(p_idempotency_key, 6, 10) || chr(10)
          || p_recovery_secret_hash,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    else false
  end;
$$;

create function public.resolve_public_booking_intent_v2(
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
       or v_command.command is distinct from 'public_create'
       or v_command.source is distinct from 'public' then
      return;
    end if;

    select cap.token_hash, cap.revoked_at
    into v_capability_hash, v_capability_revoked_at
    from public.appointment_management_capabilities cap
    where cap.business_id = v_recovery.business_id
      and cap.appointment_id = v_recovery.appointment_id;
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

create function public.prune_public_booking_resolution_closures()
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
  v_cutoff bigint := floor(extract(epoch from clock_timestamp()))::bigint - 60;
begin
  with stale as (
    select f.idempotency_key
    from public.public_booking_resolution_closures f
    where f.submit_deadline <= v_cutoff
    order by f.submit_deadline, f.idempotency_key
    limit 500
    for update skip locked
  )
  delete from public.public_booking_resolution_closures f
  using stale
  where f.idempotency_key = stale.idempotency_key;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

-- Keep the established signature. This is the only raw recovery-aware create
-- implementation, so no renamed legacy implementation can bypass the v2 guard.
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
      'BOOKING_INTENT_CLOSED','BOOKING_INTENT_DEADLINE_EXPIRED',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION'
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
    when 'slots' then 'slot' when 'book' then 'request'
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
    when 'slots' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.compute_public_booking_slots((p_args->>'p_slug')::text, (p_args->>'p_service_id')::uuid, (p_args->>'p_date')::date, (p_args->>'p_staff_id')::uuid) r;
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

create or replace function public.maintain_notification_jobs(p_dispatch_secret text)
returns table(terminalized integer, recovery_material_cleaned integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_terminalized integer := 0;
  v_cleaned integer := 0;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;

  update public.appointment_notification_jobs j
  set state = 'failed_terminal',
      terminal_at = coalesce(j.terminal_at, now()),
      last_error_class = case
        when not j.is_current then 'stale_notification_event'
        when j.delivery_certainty = 'ambiguous'
          and j.provider_idempotency_expires_at <= now()
          then 'idempotency_window_expired_ambiguous'
        else coalesce(j.last_error_class, 'retry_budget_exhausted')
      end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where j.state not in ('sent','failed_terminal')
    and (
      not j.is_current
      or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now())
      or j.retry_until <= now()
      or (j.attempt_count >= j.max_attempts and (j.state <> 'leased' or j.lease_expires_at <= now()))
    );
  get diagnostics v_count = row_count;
  v_terminalized := v_terminalized + v_count;

  update public.public_booking_recoveries r
  set recovery_secret_hash = null,
      management_token_ciphertext = null,
      management_token_iv = null
  where r.expires_at <= now()
    and (
      r.recovery_secret_hash is not null
      or r.management_token_ciphertext is not null
      or r.management_token_iv is not null
    )
    and not exists (
      select 1
      from public.appointment_notification_jobs j
      where j.recovery_id = r.recovery_id
        and j.state not in ('sent','failed_terminal')
    );
  get diagnostics v_cleaned = row_count;

  -- Closure cleanup is bounded and opportunistic. Its failure cannot roll back
  -- notification maintenance or weaken the create-time fence/deadline checks.
  begin
    perform public.prune_public_booking_resolution_closures();
  exception when others then null;
  end;

  return query select v_terminalized, v_cleaned;
end
$$;

revoke all on function public.public_booking_v2_key_matches(text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.resolve_public_booking_intent_v2(text,text,text)
  from public, anon, authenticated;
revoke all on function public.prune_public_booking_resolution_closures()
  from public, anon, authenticated;
revoke all on function public.create_public_appointment_with_recovery(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text
) from public, anon, authenticated;
revoke all on function public.public_operation_error(text)
  from public, anon, authenticated;
revoke all on function public.execute_public_operation(text,jsonb,text,text,text)
  from public, anon, authenticated;
revoke all on function public.maintain_notification_jobs(text)
  from public, anon, authenticated;

grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;
grant execute on function public.maintain_notification_jobs(text) to anon;

commit;
