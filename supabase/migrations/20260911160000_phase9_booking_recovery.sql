begin;

-- F09-02: public booking result recovery.
-- New public bookings bind the appointment, management capability and short-lived
-- recovery proof in one PostgreSQL transaction. Plain bearer/recovery secrets are
-- hashed in the Worker before they reach PostgreSQL; only encrypted management
-- material is persisted for short-lived recovery and later F09-03 delivery.

create table if not exists public.public_booking_recoveries (
  recovery_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  appointment_id uuid,
  management_token_hash text not null
    check (management_token_hash ~ '^[0-9a-f]{64}$'),
  recovery_secret_hash text
    check (recovery_secret_hash is null or recovery_secret_hash ~ '^[0-9a-f]{64}$'),
  management_token_ciphertext text not null
    check (char_length(management_token_ciphertext) between 32 and 512),
  management_token_iv text not null
    check (char_length(management_token_iv) between 12 and 64),
  key_version smallint not null check (key_version between 1 and 32767),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key),
  unique (business_id, appointment_id),
  foreign key (business_id, appointment_id)
    references public.appointments(business_id, id)
    on delete cascade
);

create index if not exists public_booking_recoveries_expiry_idx
  on public.public_booking_recoveries (expires_at);

alter table public.public_booking_recoveries enable row level security;
alter table public.public_booking_recoveries force row level security;
revoke all on public.public_booking_recoveries from anon;
revoke all on public.public_booking_recoveries from authenticated;

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
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_bootstrap public.public_booking_recoveries;
  v_created record;
  v_cap_hash text;
  v_expires_at timestamptz;
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

  select b.id into v_business_id
  from public.businesses b
  where lower(b.slug) = lower(trim(p_slug))
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;

  -- Bind bootstrap material before the stable Phase 6 create function claims the
  -- booking command. Concurrent same-key retries serialize on this unique key.
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
    -- A recovery UUID already belongs to a different booking intent.
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

  -- Stable Phase 6 booking validation/idempotency/concurrency remains authoritative.
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

  -- Management capability is born inside the same outer transaction as the
  -- appointment. A failure here rolls back a newly-created appointment.
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
   and bc.command = 'public_create'
   and bc.source = 'public'
  where r.recovery_id = p_recovery_id
    and r.idempotency_key = p_idempotency_key
    and r.recovery_secret_hash = p_recovery_secret_hash
    and r.expires_at > now()
  limit 1;
end
$$;

revoke all on function public.create_public_appointment_with_recovery(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text
) from public;
revoke all on function public.recover_public_appointment(uuid,text,text) from public;

grant execute on function public.create_public_appointment_with_recovery(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text
) to anon;
grant execute on function public.recover_public_appointment(uuid,text,text) to anon;

commit;
