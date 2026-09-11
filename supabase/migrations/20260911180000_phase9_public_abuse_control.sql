begin;

-- F09-04: public booking abuse boundary.
-- Raw public RPCs are no longer directly executable by anon. The Worker calls
-- guarded wrappers with a server-only proof; PostgreSQL stores only its SHA-256
-- hash plus derived actor/network counter keys, never raw IP/cookie material.

create table public.public_booking_abuse_config (
  config_key text primary key check (config_key = 'default'),
  gate_secret_hash text not null check (gate_secret_hash ~ '^[0-9a-f]{64}$'),
  read_window_seconds integer not null default 60 check (read_window_seconds between 10 and 3600),
  read_actor_limit integer not null default 120 check (read_actor_limit between 1 and 100000),
  read_network_limit integer not null default 1200 check (read_network_limit between 1 and 1000000),
  create_window_seconds integer not null default 600 check (create_window_seconds between 30 and 86400),
  create_actor_limit integer not null default 6 check (create_actor_limit between 1 and 10000),
  create_network_limit integer not null default 60 check (create_network_limit between 1 and 100000),
  create_business_limit integer not null default 30 check (create_business_limit between 1 and 100000),
  recover_window_seconds integer not null default 300 check (recover_window_seconds between 30 and 86400),
  recover_actor_limit integer not null default 30 check (recover_actor_limit between 1 and 10000),
  recover_network_limit integer not null default 300 check (recover_network_limit between 1 and 100000),
  updated_at timestamptz not null default now()
);

alter table public.public_booking_abuse_config enable row level security;
alter table public.public_booking_abuse_config force row level security;
revoke all on public.public_booking_abuse_config from anon;
revoke all on public.public_booking_abuse_config from authenticated;

create table public.public_booking_rate_counters (
  action text not null check (action in ('read','create','recover')),
  dimension text not null check (dimension in ('actor','network','business')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  count integer not null check (count >= 1),
  updated_at timestamptz not null default now(),
  primary key (action, dimension, key_hash)
);

alter table public.public_booking_rate_counters enable row level security;
alter table public.public_booking_rate_counters force row level security;
revoke all on public.public_booking_rate_counters from anon;
revoke all on public.public_booking_rate_counters from authenticated;

create or replace function public.public_booking_gate_authorized(p_gate_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_gate_secret is not null
    and char_length(p_gate_secret) between 43 and 256
    and exists (
      select 1
      from public.public_booking_abuse_config c
      where c.config_key = 'default'
        and c.gate_secret_hash = encode(digest(p_gate_secret, 'sha256'), 'hex')
    );
$$;

revoke all on function public.public_booking_gate_authorized(text) from public;

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
  if p_action not in ('read','create','recover')
     or p_dimension not in ('actor','network','business')
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
        when public.public_booking_rate_counters.window_started_at = v_window_start
          then public.public_booking_rate_counters.window_started_at
        else v_window_start
      end,
      count = case
        when public.public_booking_rate_counters.window_started_at = v_window_start
          then public.public_booking_rate_counters.count + 1
        else 1
      end,
      updated_at = v_now
  returning count into v_count;

  if v_count > p_limit then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (
        v_window_start + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    );
    raise exception 'PUBLIC_BOOKING_RATE_LIMITED:%', v_retry_after;
  end if;
end
$$;

revoke all on function public.consume_public_booking_rate(text,text,text,integer,integer) from public;

create or replace function public.enforce_public_booking_rate(
  p_action text,
  p_actor_hash text,
  p_network_hash text,
  p_business_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.public_booking_abuse_config;
  v_business_hash text;
begin
  select * into v_cfg
  from public.public_booking_abuse_config c
  where c.config_key = 'default';

  if v_cfg.config_key is null then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[0-9a-f]{64}$'
     or p_network_hash is null or p_network_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
  end if;

  if p_action = 'read' then
    perform public.consume_public_booking_rate(
      'read','actor',p_actor_hash,v_cfg.read_actor_limit,v_cfg.read_window_seconds
    );
    perform public.consume_public_booking_rate(
      'read','network',p_network_hash,v_cfg.read_network_limit,v_cfg.read_window_seconds
    );
    return;
  end if;

  if p_action = 'recover' then
    perform public.consume_public_booking_rate(
      'recover','actor',p_actor_hash,v_cfg.recover_actor_limit,v_cfg.recover_window_seconds
    );
    perform public.consume_public_booking_rate(
      'recover','network',p_network_hash,v_cfg.recover_network_limit,v_cfg.recover_window_seconds
    );
    return;
  end if;

  if p_action = 'create' then
    if p_business_id is null then
      raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
    end if;
    v_business_hash := encode(digest(p_business_id::text, 'sha256'), 'hex');
    perform public.consume_public_booking_rate(
      'create','actor',p_actor_hash,v_cfg.create_actor_limit,v_cfg.create_window_seconds
    );
    perform public.consume_public_booking_rate(
      'create','network',p_network_hash,v_cfg.create_network_limit,v_cfg.create_window_seconds
    );
    perform public.consume_public_booking_rate(
      'create','business',v_business_hash,v_cfg.create_business_limit,v_cfg.create_window_seconds
    );
    return;
  end if;

  raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
end
$$;

revoke all on function public.enforce_public_booking_rate(text,text,text,uuid) from public;

create or replace function public.get_public_booking_business_guarded(
  p_slug text,
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text
)
returns table(
  name text,
  slug text,
  timezone text,
  local_date date,
  max_date date,
  step_minutes integer,
  min_notice_minutes integer,
  horizon_days integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  perform public.enforce_public_booking_rate('read', p_actor_hash, p_network_hash, null);
  return query select * from public.get_public_booking_business(p_slug);
end
$$;

create or replace function public.get_public_booking_services_guarded(
  p_slug text,
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text
)
returns table(
  service_id uuid,
  name text,
  duration_minutes integer,
  price_minor integer,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  perform public.enforce_public_booking_rate('read', p_actor_hash, p_network_hash, null);
  return query select * from public.get_public_booking_services(p_slug);
end
$$;

create or replace function public.get_public_booking_staff_guarded(
  p_slug text,
  p_service_id uuid,
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text
)
returns table(staff_id uuid, staff_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  perform public.enforce_public_booking_rate('read', p_actor_hash, p_network_hash, null);
  return query select * from public.get_public_booking_staff(p_slug, p_service_id);
end
$$;

create or replace function public.compute_public_booking_slots_guarded(
  p_slug text,
  p_service_id uuid,
  p_date date,
  p_staff_id uuid,
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text
)
returns table(
  staff_id uuid,
  staff_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  perform public.enforce_public_booking_rate('read', p_actor_hash, p_network_hash, null);
  return query select * from public.compute_public_booking_slots(p_slug, p_service_id, p_date, p_staff_id);
end
$$;

create or replace function public.create_public_appointment_with_recovery_guarded(
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
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text,
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
  v_safe_retry boolean := false;
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;

  select b.id into v_business_id
  from public.businesses b
  where lower(b.slug) = lower(trim(p_slug))
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.public_booking_recoveries r
    where r.business_id = v_business_id
      and r.idempotency_key = p_idempotency_key
      and r.recovery_id = p_recovery_id
      and r.management_token_hash = p_management_token_hash
      and r.recovery_secret_hash is not distinct from p_recovery_secret_hash
      and r.appointment_id is not null
  ) into v_safe_retry;

  if not v_safe_retry then
    perform public.enforce_public_booking_rate(
      'create', p_actor_hash, p_network_hash, v_business_id
    );
  end if;

  return query
  select *
  from public.create_public_appointment_with_recovery(
    p_slug,
    p_idempotency_key,
    p_customer_name,
    p_service_id,
    p_staff_id,
    p_starts_at,
    p_management_token_hash,
    p_recovery_id,
    p_recovery_secret_hash,
    p_management_token_ciphertext,
    p_management_token_iv,
    p_key_version,
    p_customer_phone,
    p_customer_email,
    p_notes
  );
end
$$;

create or replace function public.recover_public_appointment_guarded(
  p_recovery_id uuid,
  p_idempotency_key text,
  p_recovery_secret_hash text,
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text
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
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  perform public.enforce_public_booking_rate('recover', p_actor_hash, p_network_hash, null);
  return query
  select * from public.recover_public_appointment(
    p_recovery_id, p_idempotency_key, p_recovery_secret_hash
  );
end
$$;

-- Close direct PostgREST bypasses. The implementation functions remain usable by
-- their owner/security-definer wrappers but are no longer public anonymous APIs.
revoke execute on function public.get_public_booking_business(text) from anon, authenticated;
revoke execute on function public.get_public_booking_services(text) from anon, authenticated;
revoke execute on function public.get_public_booking_staff(text,uuid) from anon, authenticated;
revoke execute on function public.compute_public_booking_slots(text,uuid,date,uuid) from anon, authenticated;
revoke execute on function public.create_public_appointment(text,text,text,uuid,uuid,timestamptz,text,text,text) from anon, authenticated;
revoke execute on function public.create_public_appointment_with_recovery(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text
) from anon, authenticated;
revoke execute on function public.recover_public_appointment(uuid,text,text) from anon, authenticated;

revoke all on function public.get_public_booking_business_guarded(text,text,text,text) from public;
revoke all on function public.get_public_booking_services_guarded(text,text,text,text) from public;
revoke all on function public.get_public_booking_staff_guarded(text,uuid,text,text,text) from public;
revoke all on function public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text) from public;
revoke all on function public.create_public_appointment_with_recovery_guarded(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text
) from public;
revoke all on function public.recover_public_appointment_guarded(uuid,text,text,text,text,text) from public;

grant execute on function public.get_public_booking_business_guarded(text,text,text,text) to anon;
grant execute on function public.get_public_booking_services_guarded(text,text,text,text) to anon;
grant execute on function public.get_public_booking_staff_guarded(text,uuid,text,text,text) to anon;
grant execute on function public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text) to anon;
grant execute on function public.create_public_appointment_with_recovery_guarded(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text
) to anon;
grant execute on function public.recover_public_appointment_guarded(uuid,text,text,text,text,text) to anon;

commit;
