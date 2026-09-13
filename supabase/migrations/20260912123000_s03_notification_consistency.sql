begin;

-- S03: freeze every provider-visible input before the first send and make
-- appointment lifecycle changes create explicit, versioned notification events.
-- Plain management bearers and full management links remain outside PostgreSQL.

alter table public.appointment_notification_jobs
  add column event_id uuid,
  add column event_version integer,
  add column event_reason text,
  add column template_version integer not null default 1,
  add column is_current boolean not null default true,
  add column superseded_at timestamptz,
  add column superseded_reason text,
  add column business_name_snapshot text,
  add column customer_name_snapshot text,
  add column starts_at_snapshot timestamptz,
  add column timezone_snapshot text,
  add column service_name_snapshot text,
  add column staff_name_snapshot text,
  add column price_minor_snapshot integer,
  add column currency_snapshot text,
  add column sender_snapshot text,
  add column origin_snapshot text,
  add column request_fingerprint text,
  add column request_locked_at timestamptz,
  add column first_provider_attempt_at timestamptz,
  add column provider_idempotency_expires_at timestamptz,
  add column delivery_certainty text not null default 'unattempted',
  add column has_ambiguous_history boolean not null default false,
  add column receipt_token uuid;

update public.appointment_notification_jobs j
set event_id = gen_random_uuid(),
    event_version = 1,
    event_reason = 'created',
    business_name_snapshot = b.name,
    customer_name_snapshot = a.customer_name_snapshot,
    starts_at_snapshot = a.starts_at,
    timezone_snapshot = a.timezone,
    service_name_snapshot = a.service_name_snapshot,
    staff_name_snapshot = a.staff_name_snapshot,
    price_minor_snapshot = a.price_minor_snapshot,
    currency_snapshot = a.currency_snapshot,
    first_provider_attempt_at = case
      when j.attempt_count > 0 or j.last_attempt_at is not null then coalesce(j.last_attempt_at, j.created_at)
      else null
    end,
    provider_idempotency_expires_at = case
      when j.attempt_count > 0 or j.last_attempt_at is not null
        then coalesce(j.last_attempt_at, j.created_at) + interval '24 hours'
      else null
    end,
    delivery_certainty = case
      when j.state = 'sent' then 'accepted'
      when j.attempt_count = 0 and j.last_attempt_at is null then 'unattempted'
      when j.state = 'failed_terminal' then 'legacy_unknown'
      else 'ambiguous'
    end
from public.appointments a
join public.businesses b on b.id = a.business_id
where a.business_id = j.business_id
  and a.id = j.appointment_id;

-- An older attempted job does not contain enough evidence to reproduce the exact
-- provider request. Preserve it for review instead of guessing and resending.
update public.appointment_notification_jobs
set state = 'failed_terminal',
    terminal_at = coalesce(terminal_at, now()),
    last_error_class = 'legacy_payload_unverifiable',
    lease_token = null,
    lease_expires_at = null,
    delivery_certainty = 'legacy_unknown',
    updated_at = now()
where state not in ('sent','failed_terminal')
  and (attempt_count > 0 or last_attempt_at is not null);

-- Legacy inactive appointments must not re-enter the delivery queue. Preserve
-- accepted/terminal evidence, including unverifiable attempted-job reasons.
update public.appointment_notification_jobs j
set is_current = false,
    superseded_at = now(),
    superseded_reason = 'legacy_appointment_inactive',
    state = case when j.state in ('sent','failed_terminal') then j.state else 'failed_terminal' end,
    terminal_at = coalesce(j.terminal_at, now()),
    last_error_class = case
      when j.state in ('sent','failed_terminal') then j.last_error_class
      else 'legacy_appointment_inactive'
    end,
    lease_token = null,
    lease_expires_at = null
from public.appointments a
where a.id = j.appointment_id and a.status not in ('scheduled','confirmed');

alter table public.appointment_notification_jobs
  alter column event_id set default gen_random_uuid(),
  alter column event_id set not null,
  alter column event_version set not null,
  alter column event_reason set not null,
  alter column business_name_snapshot set not null,
  alter column customer_name_snapshot set not null,
  alter column starts_at_snapshot set not null,
  alter column timezone_snapshot set not null,
  alter column service_name_snapshot set not null,
  alter column staff_name_snapshot set not null,
  alter column price_minor_snapshot set not null,
  alter column currency_snapshot set not null;

alter table public.appointment_notification_jobs
  drop constraint if exists appointment_notification_jobs_appointment_id_kind_channel_key;

alter table public.appointment_notification_jobs
  add constraint appointment_notification_jobs_event_version_check
    check (event_version > 0),
  add constraint appointment_notification_jobs_event_reason_check
    check (event_reason in ('created','rescheduled')),
  add constraint appointment_notification_jobs_template_version_check
    check (template_version > 0),
  add constraint appointment_notification_jobs_delivery_certainty_check
    check (delivery_certainty in ('unattempted','ambiguous','accepted','rejected','legacy_unknown')),
  add constraint appointment_notification_jobs_snapshot_text_check
    check (
      char_length(business_name_snapshot) between 1 and 120
      and char_length(customer_name_snapshot) between 1 and 200
      and char_length(timezone_snapshot) between 1 and 120
      and char_length(service_name_snapshot) between 1 and 120
      and char_length(staff_name_snapshot) between 1 and 120
      and currency_snapshot ~ '^[A-Z]{3}$'
    ),
  add constraint appointment_notification_jobs_snapshot_price_check
    check (price_minor_snapshot between 0 and 100000000),
  add constraint appointment_notification_jobs_sender_snapshot_check
    check (sender_snapshot is null or char_length(sender_snapshot) between 3 and 320),
  add constraint appointment_notification_jobs_origin_snapshot_check
    check (origin_snapshot is null or char_length(origin_snapshot) between 8 and 500),
  add constraint appointment_notification_jobs_request_fingerprint_check
    check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint appointment_notification_jobs_request_lock_check
    check (
      request_fingerprint is null
      or (
        sender_snapshot is not null
        and origin_snapshot is not null
        and request_locked_at is not null
        and first_provider_attempt_at is not null
        and provider_idempotency_expires_at is not null
      )
    ),
  add constraint appointment_notification_jobs_accepted_receipt_check
    check (delivery_certainty <> 'accepted' or provider_message_id is not null);

create unique index appointment_notification_jobs_event_id_idx
  on public.appointment_notification_jobs(event_id);
create unique index appointment_notification_jobs_event_version_idx
  on public.appointment_notification_jobs(appointment_id, kind, channel, event_version);
create unique index appointment_notification_jobs_current_idx
  on public.appointment_notification_jobs(appointment_id, kind, channel)
  where is_current;
create index appointment_notification_jobs_event_ready_idx
  on public.appointment_notification_jobs(is_current, state, available_at)
  where is_current and state in ('pending','retry_wait','leased');

create or replace function public.create_public_booking_confirmation_event(
  p_business_id uuid,
  p_appointment_id uuid,
  p_recovery_id uuid,
  p_event_reason text default 'created'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_recovery public.public_booking_recoveries;
  v_email text;
  v_event_id uuid := gen_random_uuid();
  v_event_version integer;
begin
  if p_event_reason not in ('created','rescheduled') then
    raise exception 'INVALID_NOTIFICATION_EVENT_REASON';
  end if;

  select * into v_appointment
  from public.appointments a
  where a.business_id = p_business_id
    and a.id = p_appointment_id
    and a.source = 'public'
  for share;

  if v_appointment.id is null then
    raise exception 'NOTIFICATION_APPOINTMENT_NOT_FOUND';
  end if;
  if v_appointment.status not in ('scheduled','confirmed') then
    raise exception 'NOTIFICATION_APPOINTMENT_NOT_ACTIVE';
  end if;

  select * into v_business
  from public.businesses b
  where b.id = p_business_id;

  select * into v_recovery
  from public.public_booking_recoveries r
  where r.recovery_id = p_recovery_id
    and r.business_id = p_business_id
    and r.appointment_id = p_appointment_id
  for share;

  v_email := nullif(btrim(v_appointment.customer_email_snapshot), '');
  if v_business.id is null or v_recovery.recovery_id is null or v_email is null then
    return null;
  end if;

  select coalesce(max(j.event_version), 0) + 1
  into v_event_version
  from public.appointment_notification_jobs j
  where j.appointment_id = p_appointment_id
    and j.kind = 'public_booking_confirmation'
    and j.channel = 'email';

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
    provider_idempotency_key,
    event_id,
    event_version,
    event_reason,
    template_version,
    is_current,
    business_name_snapshot,
    customer_name_snapshot,
    starts_at_snapshot,
    timezone_snapshot,
    service_name_snapshot,
    staff_name_snapshot,
    price_minor_snapshot,
    currency_snapshot,
    delivery_certainty
  ) values (
    p_business_id,
    p_appointment_id,
    p_recovery_id,
    'public_booking_confirmation',
    'email',
    v_email,
    'resend',
    'pending',
    now(),
    least(v_recovery.expires_at, now() + interval '72 hours'),
    'public-booking-confirmation/' || v_event_id::text,
    v_event_id,
    v_event_version,
    p_event_reason,
    1,
    true,
    v_business.name,
    v_appointment.customer_name_snapshot,
    v_appointment.starts_at,
    v_appointment.timezone,
    v_appointment.service_name_snapshot,
    v_appointment.staff_name_snapshot,
    v_appointment.price_minor_snapshot,
    v_appointment.currency_snapshot,
    'unattempted'
  );

  return v_event_id;
end
$$;

revoke all on function public.create_public_booking_confirmation_event(uuid,uuid,uuid,text)
  from public, anon, authenticated;

create or replace function public.enqueue_public_booking_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.appointment_id is null or old.appointment_id is not null then
    return new;
  end if;

  perform public.create_public_booking_confirmation_event(
    new.business_id,
    new.appointment_id,
    new.recovery_id,
    'created'
  );
  return new;
end
$$;

revoke all on function public.enqueue_public_booking_confirmation()
  from public, anon, authenticated;

create or replace function public.reconcile_public_booking_confirmation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.appointment_notification_jobs;
  v_safe_to_replace boolean;
  v_changed boolean;
begin
  if old.source <> 'public' or new.source <> 'public' then
    return new;
  end if;

  v_changed := new.starts_at is distinct from old.starts_at
    or new.staff_id is distinct from old.staff_id
    or new.staff_name_snapshot is distinct from old.staff_name_snapshot
    or new.timezone is distinct from old.timezone;

  if new.status not in ('scheduled','confirmed') then
    if new.status = old.status and not v_changed then return new; end if;
  elsif not v_changed then
    return new;
  end if;

  select * into v_job
  from public.appointment_notification_jobs j
  where j.appointment_id = new.id
    and j.kind = 'public_booking_confirmation'
    and j.channel = 'email'
    and j.is_current
  for update;

  if v_job.id is null then
    return new;
  end if;

  v_safe_to_replace := (
    v_job.delivery_certainty in ('unattempted','rejected')
    and not v_job.has_ambiguous_history
    and v_job.provider_message_id is null
  );

  if new.status not in ('scheduled','confirmed') then
    update public.appointment_notification_jobs
    set is_current = false,
        superseded_at = now(),
        superseded_reason = case
          when v_safe_to_replace then new.status || '_before_send'
          else new.status || '_after_attempt'
        end,
        state = case when state = 'sent' then state else 'failed_terminal' end,
        terminal_at = case when state = 'sent' then terminal_at else coalesce(terminal_at, now()) end,
        last_error_class = case
          when state = 'sent' then last_error_class
          when v_safe_to_replace then new.status || '_before_send'
          else new.status || '_after_attempt_needs_review'
        end,
        lease_token = null,
        lease_expires_at = null,
        delivery_certainty = case
          when v_safe_to_replace then 'rejected'
          else delivery_certainty
        end,
        updated_at = now()
    where id = v_job.id;
    return new;
  end if;

  if v_changed and new.status in ('scheduled','confirmed') then
    update public.appointment_notification_jobs
    set is_current = false,
        superseded_at = now(),
        superseded_reason = case
          when v_safe_to_replace then 'rescheduled_before_send'
          else 'rescheduled_after_attempt_no_reissue'
        end,
        state = case
          when state = 'sent' then state
          else 'failed_terminal'
        end,
        terminal_at = case
          when state = 'sent' then terminal_at
          else coalesce(terminal_at, now())
        end,
        last_error_class = case
          when state = 'sent' then last_error_class
          when v_safe_to_replace then 'superseded_before_send'
          else 'rescheduled_after_attempt_needs_review'
        end,
        lease_token = null,
        lease_expires_at = null,
        updated_at = now()
    where id = v_job.id;

    if v_safe_to_replace then
      perform public.create_public_booking_confirmation_event(
        new.business_id,
        new.id,
        v_job.recovery_id,
        'rescheduled'
      );
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.reconcile_public_booking_confirmation_event()
  from public, anon, authenticated;

drop trigger if exists public_booking_confirmation_lifecycle on public.appointments;
create trigger public_booking_confirmation_lifecycle
after update of starts_at, staff_id, staff_name_snapshot, timezone, status
on public.appointments
for each row execute function public.reconcile_public_booking_confirmation_event();

create or replace function public.claim_notification_jobs_v2(
  p_dispatch_secret text,
  p_limit integer default 10,
  p_lease_seconds integer default 45
)
returns table(
  job_id uuid,
  lease_token uuid,
  event_id uuid,
  event_version integer,
  template_version integer,
  appointment_id uuid,
  recovery_id uuid,
  recipient text,
  provider text,
  provider_idempotency_key text,
  attempt_count integer,
  retry_until timestamptz,
  business_name_snapshot text,
  customer_name_snapshot text,
  starts_at_snapshot timestamptz,
  timezone_snapshot text,
  service_name_snapshot text,
  staff_name_snapshot text,
  price_minor_snapshot integer,
  currency_snapshot text,
  sender_snapshot text,
  origin_snapshot text,
  request_fingerprint text,
  first_provider_attempt_at timestamptz,
  provider_idempotency_expires_at timestamptz,
  delivery_certainty text,
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
      last_error_class = 'stale_notification_event',
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where not j.is_current
    and j.state not in ('sent','failed_terminal');

  update public.appointment_notification_jobs j
  set state = 'failed_terminal',
      terminal_at = coalesce(j.terminal_at, now()),
      last_error_class = 'idempotency_window_expired_ambiguous',
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where j.state not in ('sent','failed_terminal')
    and j.delivery_certainty = 'ambiguous'
    and j.provider_idempotency_expires_at <= now();

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
    where j.is_current
      and j.retry_until > now()
      and j.attempt_count < j.max_attempts
      and not (
        j.delivery_certainty = 'ambiguous'
        and j.provider_idempotency_expires_at <= now()
      )
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
    j.event_id,
    j.event_version,
    j.template_version,
    j.appointment_id,
    j.recovery_id,
    j.recipient,
    j.provider,
    j.provider_idempotency_key,
    j.attempt_count,
    j.retry_until,
    j.business_name_snapshot,
    j.customer_name_snapshot,
    j.starts_at_snapshot,
    j.timezone_snapshot,
    j.service_name_snapshot,
    j.staff_name_snapshot,
    j.price_minor_snapshot,
    j.currency_snapshot,
    j.sender_snapshot,
    j.origin_snapshot,
    j.request_fingerprint,
    j.first_provider_attempt_at,
    j.provider_idempotency_expires_at,
    j.delivery_certainty,
    r.management_token_ciphertext,
    r.management_token_iv,
    r.key_version
  from claimed j
  join public.public_booking_recoveries r
    on r.recovery_id = j.recovery_id
   and r.business_id = j.business_id;
end
$$;

create or replace function public.lock_notification_request_v2(
  p_dispatch_secret text,
  p_job_id uuid,
  p_lease_token uuid,
  p_sender text,
  p_origin text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.appointment_notification_jobs;
  v_appointment public.appointments;
  v_now timestamptz;
  v_window_end timestamptz;
  v_send_before timestamptz;
  v_receipt_token uuid;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_sender is null or char_length(btrim(p_sender)) not between 3 and 320 then
    raise exception 'INVALID_NOTIFICATION_SENDER';
  end if;
  if p_origin is null or p_origin !~ '^https://[^/@?#[:space:]]+$|^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?$' then
    raise exception 'INVALID_NOTIFICATION_ORIGIN';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_NOTIFICATION_FINGERPRINT';
  end if;

  -- Lifecycle updates lock appointment then job. Take the same order: a
  -- committed cancel/reschedule wins over a send that has not crossed this gate.
  select a.* into v_appointment
  from public.appointments a
  where a.id = (select j.appointment_id from public.appointment_notification_jobs j where j.id = p_job_id)
  for share;

  select * into v_job
  from public.appointment_notification_jobs j
  where j.id = p_job_id and j.state = 'leased' and j.lease_token = p_lease_token
  for update;

  if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;
  if not v_job.is_current or v_appointment.id is null
     or v_appointment.status not in ('scheduled','confirmed')
     or v_appointment.starts_at is distinct from v_job.starts_at_snapshot
     or v_appointment.timezone is distinct from v_job.timezone_snapshot then
    raise exception 'NOTIFICATION_EVENT_STALE';
  end if;

  -- now() is the transaction start; it can predate a long row-lock wait.
  v_now := clock_timestamp();
  if v_job.lease_expires_at is null or v_job.lease_expires_at <= v_now then
    raise exception 'NOTIFICATION_LEASE_EXPIRED';
  end if;
  if v_job.retry_until <= v_now then raise exception 'NOTIFICATION_RETRY_EXPIRED'; end if;
  v_window_end := coalesce(v_job.provider_idempotency_expires_at, v_now + interval '24 hours');
  if v_window_end <= v_now then raise exception 'NOTIFICATION_IDEMPOTENCY_WINDOW_EXPIRED'; end if;
  -- Worker provider timeout is 10 seconds; leave one further second of margin.
  v_send_before := least(v_job.lease_expires_at, v_job.retry_until, v_window_end) - interval '11 seconds';
  if v_send_before <= v_now then raise exception 'NOTIFICATION_SEND_BUDGET_EXHAUSTED'; end if;

  if v_job.request_fingerprint is null then
    if v_job.first_provider_attempt_at is not null or v_job.delivery_certainty <> 'unattempted' then
      raise exception 'NOTIFICATION_REQUEST_UNVERIFIABLE';
    end if;
  elsif v_job.request_fingerprint <> p_request_fingerprint
     or v_job.sender_snapshot <> btrim(p_sender)
     or v_job.origin_snapshot <> p_origin then
    raise exception 'NOTIFICATION_REQUEST_MISMATCH';
  end if;

  -- One receipt proof per immutable request, shared by its authorized attempts.
  -- It survives lease reclamation/cancellation so a late real acceptance is kept.
  v_receipt_token := coalesce(v_job.receipt_token, gen_random_uuid());
  update public.appointment_notification_jobs
  set sender_snapshot = btrim(p_sender),
      origin_snapshot = p_origin,
      request_fingerprint = p_request_fingerprint,
      request_locked_at = coalesce(request_locked_at, v_now),
      first_provider_attempt_at = coalesce(first_provider_attempt_at, v_now),
      provider_idempotency_expires_at = v_window_end,
      has_ambiguous_history = has_ambiguous_history or (
        first_provider_attempt_at is not null and delivery_certainty = 'ambiguous'
      ),
      delivery_certainty = 'ambiguous',
      receipt_token = v_receipt_token,
      updated_at = v_now
  where id = p_job_id;

  return jsonb_build_object('server_time', v_now, 'send_before', v_send_before, 'receipt_token', v_receipt_token);
end
$$;

create or replace function public.complete_notification_job_v2(
  p_dispatch_secret text,
  p_job_id uuid,
  p_receipt_token uuid,
  p_provider_message_id text,
  p_request_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_provider_message_id is null
     or char_length(p_provider_message_id) not between 1 and 200 then
    raise exception 'INVALID_PROVIDER_MESSAGE_ID';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_NOTIFICATION_FINGERPRINT';
  end if;

  update public.appointment_notification_jobs j
  set state = 'sent',
      provider_message_id = p_provider_message_id,
      sent_at = now(),
      terminal_at = now(),
      last_error_class = null,
      lease_token = null,
      lease_expires_at = null,
      delivery_certainty = 'accepted',
      updated_at = now()
  where j.id = p_job_id
    and j.receipt_token = p_receipt_token
    and j.request_fingerprint = p_request_fingerprint
    and (j.provider_message_id is null or j.provider_message_id = p_provider_message_id);

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'NOTIFICATION_LEASE_LOST'; end if;
  return true;
end
$$;

create or replace function public.release_notification_job_v2(
  p_dispatch_secret text,
  p_job_id uuid,
  p_lease_token uuid,
  p_error_class text,
  p_retryable boolean,
  p_retry_after_seconds integer default 60,
  p_definitely_rejected boolean default false
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
  v_error text;
  v_window_expired boolean;
  v_certainty text;
  v_ambiguous_history boolean;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_error_class is null or char_length(p_error_class) not between 1 and 120 then
    raise exception 'INVALID_NOTIFICATION_ERROR';
  end if;

  select * into v_job
  from public.appointment_notification_jobs j
  where j.id = p_job_id
    and j.state = 'leased'
    and j.lease_token = p_lease_token
  for update;

  if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;

  v_ambiguous_history := v_job.has_ambiguous_history or (
    v_job.first_provider_attempt_at is not null and not coalesce(p_definitely_rejected, false)
  );
  v_certainty := case
    when v_job.first_provider_attempt_at is null then v_job.delivery_certainty
    when coalesce(p_definitely_rejected, false) and not v_ambiguous_history then 'rejected'
    else 'ambiguous'
  end;

  v_delay := greatest(1, least(coalesce(p_retry_after_seconds, 60), 86400));
  v_window_expired := v_certainty = 'ambiguous'
    and v_job.provider_idempotency_expires_at is not null
    and now() + make_interval(secs => v_delay) >= v_job.provider_idempotency_expires_at;
  v_error := case
    when v_window_expired then 'idempotency_window_expired_ambiguous'
    else p_error_class
  end;

  if not v_job.is_current
     or not coalesce(p_retryable, false)
     or v_job.attempt_count >= v_job.max_attempts
     or now() + make_interval(secs => v_delay) >= v_job.retry_until
     or v_window_expired then
    v_state := 'failed_terminal';
    update public.appointment_notification_jobs
    set state = v_state,
        terminal_at = now(),
        last_error_class = v_error,
        lease_token = null,
        lease_expires_at = null,
        delivery_certainty = v_certainty,
        has_ambiguous_history = v_ambiguous_history,
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
        delivery_certainty = v_certainty,
        has_ambiguous_history = v_ambiguous_history,
        updated_at = now()
    where id = p_job_id;
  end if;

  return v_state;
end
$$;

create or replace function public.maintain_notification_jobs(p_dispatch_secret text)
returns table(terminalized integer, recovery_material_cleaned integer)
language plpgsql
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

  return query select v_terminalized, v_cleaned;
end
$$;

-- Pause the v1 transport after this migration. During migration-before-Worker
-- deploy, the previous Worker fails closed instead of sending mutable payloads.
revoke execute on function public.claim_notification_jobs(text,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.complete_notification_job(text,uuid,uuid,text)
  from public, anon, authenticated;
revoke execute on function public.release_notification_job(text,uuid,uuid,text,boolean,integer)
  from public, anon, authenticated;

revoke all on function public.claim_notification_jobs_v2(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.lock_notification_request_v2(text,uuid,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.complete_notification_job_v2(text,uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.release_notification_job_v2(text,uuid,uuid,text,boolean,integer,boolean)
  from public, anon, authenticated;
revoke all on function public.maintain_notification_jobs(text)
  from public, anon, authenticated;

grant execute on function public.claim_notification_jobs_v2(text,integer,integer) to anon;
grant execute on function public.lock_notification_request_v2(text,uuid,uuid,text,text,text) to anon;
grant execute on function public.complete_notification_job_v2(text,uuid,uuid,text,text) to anon;
grant execute on function public.release_notification_job_v2(text,uuid,uuid,text,boolean,integer,boolean) to anon;
grant execute on function public.maintain_notification_jobs(text) to anon;

commit;
