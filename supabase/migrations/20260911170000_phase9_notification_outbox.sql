begin;

-- F09-03: durable public-booking notification outbox.
-- Notification jobs are born when F09-02 binds a recovery row to its appointment,
-- which happens inside the same outer PostgreSQL transaction as booking + capability.
-- Jobs never contain the plaintext management bearer or a full management URL.

alter table public.public_booking_recoveries
  alter column management_token_ciphertext drop not null,
  alter column management_token_iv drop not null;

create table public.notification_dispatch_config (
  config_key text primary key check (config_key = 'default'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.notification_dispatch_config enable row level security;
alter table public.notification_dispatch_config force row level security;
revoke all on public.notification_dispatch_config from anon;
revoke all on public.notification_dispatch_config from authenticated;

create table public.appointment_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid not null,
  recovery_id uuid not null references public.public_booking_recoveries(recovery_id) on delete cascade,
  kind text not null check (kind in ('public_booking_confirmation')),
  channel text not null check (channel in ('email')),
  recipient text not null check (char_length(recipient) between 3 and 254),
  provider text not null check (provider in ('resend')),
  state text not null default 'pending'
    check (state in ('pending','leased','retry_wait','sent','failed_terminal')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  max_attempts integer not null default 8 check (max_attempts between 1 and 100),
  available_at timestamptz not null default now(),
  retry_until timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_idempotency_key text not null check (char_length(provider_idempotency_key) between 1 and 256),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  last_error_class text check (last_error_class is null or char_length(last_error_class) between 1 and 120),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, appointment_id)
    references public.appointments(business_id, id)
    on delete cascade,
  unique (appointment_id, kind, channel),
  unique (provider, provider_idempotency_key),
  check (state <> 'leased' or (lease_token is not null and lease_expires_at is not null))
);

create index appointment_notification_jobs_ready_idx
  on public.appointment_notification_jobs(state, available_at)
  where state in ('pending','retry_wait','leased');

create unique index appointment_notification_jobs_provider_message_idx
  on public.appointment_notification_jobs(provider, provider_message_id)
  where provider_message_id is not null;

alter table public.appointment_notification_jobs enable row level security;
alter table public.appointment_notification_jobs force row level security;
revoke all on public.appointment_notification_jobs from anon;
revoke all on public.appointment_notification_jobs from authenticated;

create or replace function public.enqueue_public_booking_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if new.appointment_id is null or old.appointment_id is not null then
    return new;
  end if;

  select nullif(btrim(a.customer_email_snapshot), '')
  into v_email
  from public.appointments a
  where a.business_id = new.business_id
    and a.id = new.appointment_id
    and a.source = 'public';

  if v_email is null then
    return new;
  end if;

  insert into public.appointment_notification_jobs(
    business_id,
    appointment_id,
    recovery_id,
    kind,
    channel,
    recipient,
    provider,
    state,
    available_at,
    retry_until,
    provider_idempotency_key
  ) values (
    new.business_id,
    new.appointment_id,
    new.recovery_id,
    'public_booking_confirmation',
    'email',
    v_email,
    'resend',
    'pending',
    now(),
    least(new.expires_at, now() + interval '72 hours'),
    'public-booking-confirmation/' || new.appointment_id::text
  )
  on conflict (appointment_id, kind, channel) do nothing;

  return new;
end
$$;

revoke all on function public.enqueue_public_booking_confirmation() from public;

drop trigger if exists public_booking_confirmation_enqueue on public.public_booking_recoveries;
create trigger public_booking_confirmation_enqueue
after update of appointment_id on public.public_booking_recoveries
for each row
when (new.appointment_id is not null and old.appointment_id is null)
execute function public.enqueue_public_booking_confirmation();

create or replace function public.notification_dispatch_authorized(p_dispatch_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_dispatch_secret is not null
    and char_length(p_dispatch_secret) >= 43
    and exists (
      select 1
      from public.notification_dispatch_config c
      where c.config_key = 'default'
        and c.secret_hash = encode(digest(p_dispatch_secret, 'sha256'), 'hex')
    );
$$;

revoke all on function public.notification_dispatch_authorized(text) from public;

create or replace function public.claim_notification_jobs(
  p_dispatch_secret text,
  p_limit integer default 10,
  p_lease_seconds integer default 45
)
returns table(
  job_id uuid,
  lease_token uuid,
  appointment_id uuid,
  recovery_id uuid,
  recipient text,
  provider text,
  provider_idempotency_key text,
  attempt_count integer,
  retry_until timestamptz,
  business_name text,
  customer_name text,
  starts_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  management_token_ciphertext text,
  management_token_iv text,
  key_version smallint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_lease_seconds integer;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease_seconds := greatest(15, least(coalesce(p_lease_seconds, 45), 300));

  update public.appointment_notification_jobs j
  set state = 'failed_terminal',
      terminal_at = coalesce(j.terminal_at, now()),
      last_error_class = coalesce(j.last_error_class, 'retry_budget_exhausted'),
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where j.state not in ('sent','failed_terminal')
    and (
      j.retry_until <= now()
      or (
        j.attempt_count >= j.max_attempts
        and (j.state <> 'leased' or j.lease_expires_at <= now())
      )
    );

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

  return query
  with candidates as (
    select j.id
    from public.appointment_notification_jobs j
    where j.retry_until > now()
      and j.attempt_count < j.max_attempts
      and (
        (j.state in ('pending','retry_wait') and j.available_at <= now())
        or (j.state = 'leased' and j.lease_expires_at <= now())
      )
    order by j.available_at, j.created_at, j.id
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.appointment_notification_jobs j
    set state = 'leased',
        attempt_count = j.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        last_attempt_at = now(),
        updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select
    j.id,
    j.lease_token,
    j.appointment_id,
    j.recovery_id,
    j.recipient,
    j.provider,
    j.provider_idempotency_key,
    j.attempt_count,
    j.retry_until,
    b.name,
    a.customer_name_snapshot,
    a.starts_at,
    a.timezone,
    a.service_name_snapshot,
    a.staff_name_snapshot,
    a.price_minor_snapshot,
    a.currency_snapshot,
    r.management_token_ciphertext,
    r.management_token_iv,
    r.key_version
  from claimed j
  join public.appointments a
    on a.business_id = j.business_id
   and a.id = j.appointment_id
  join public.businesses b on b.id = j.business_id
  join public.public_booking_recoveries r
    on r.recovery_id = j.recovery_id
   and r.business_id = j.business_id;
end
$$;

create or replace function public.complete_notification_job(
  p_dispatch_secret text,
  p_job_id uuid,
  p_lease_token uuid,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
  v_recovery_id uuid;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_provider_message_id is null
     or char_length(p_provider_message_id) < 1
     or char_length(p_provider_message_id) > 200 then
    raise exception 'INVALID_PROVIDER_MESSAGE_ID';
  end if;

  update public.appointment_notification_jobs j
  set state = 'sent',
      provider_message_id = p_provider_message_id,
      sent_at = now(),
      terminal_at = now(),
      last_error_class = null,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where j.id = p_job_id
    and j.state = 'leased'
    and j.lease_token = p_lease_token
  returning j.recovery_id into v_recovery_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'NOTIFICATION_LEASE_LOST';
  end if;

  return true;
end
$$;

create or replace function public.release_notification_job(
  p_dispatch_secret text,
  p_job_id uuid,
  p_lease_token uuid,
  p_error_class text,
  p_retryable boolean,
  p_retry_after_seconds integer default 60
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.appointment_notification_jobs;
  v_delay integer;
  v_state text;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_error_class is null
     or char_length(p_error_class) < 1
     or char_length(p_error_class) > 120 then
    raise exception 'INVALID_NOTIFICATION_ERROR';
  end if;

  select * into v_job
  from public.appointment_notification_jobs j
  where j.id = p_job_id
    and j.state = 'leased'
    and j.lease_token = p_lease_token
  for update;

  if v_job.id is null then
    raise exception 'NOTIFICATION_LEASE_LOST';
  end if;

  v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400));

  if not coalesce(p_retryable, false)
     or v_job.attempt_count >= v_job.max_attempts
     or now() + make_interval(secs => v_delay) >= v_job.retry_until then
    v_state := 'failed_terminal';
    update public.appointment_notification_jobs
    set state = v_state,
        terminal_at = now(),
        last_error_class = p_error_class,
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_job_id;
  else
    v_state := 'retry_wait';
    update public.appointment_notification_jobs
    set state = v_state,
        available_at = now() + make_interval(secs => v_delay),
        last_error_class = p_error_class,
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
    where id = p_job_id;
  end if;

  return v_state;
end
$$;

revoke all on function public.claim_notification_jobs(text,integer,integer) from public;
revoke all on function public.complete_notification_job(text,uuid,uuid,text) from public;
revoke all on function public.release_notification_job(text,uuid,uuid,text,boolean,integer) from public;

grant execute on function public.claim_notification_jobs(text,integer,integer) to anon;
grant execute on function public.complete_notification_job(text,uuid,uuid,text) to anon;
grant execute on function public.release_notification_job(text,uuid,uuid,text,boolean,integer) to anon;

commit;
