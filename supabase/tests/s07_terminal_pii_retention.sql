begin;

-- C1 uses an explicit dispatcher secret so the fixture is independent of earlier
-- rotation tests. The secret itself never leaves this disposable PG17 database.
update public.notification_dispatch_config
set secret_hash = encode(digest(repeat('r', 43), 'sha256'), 'hex'),
    updated_at = now()
where config_key = 'default';

-- Reuse the durable Phase 9 email booking as the FK anchor. Its appointment and
-- customer record must survive this test; only terminal notification snapshots
-- are retention-managed here.
do $$
begin
  if not exists (
    select 1 from public.appointment_notification_jobs
    where recipient = 'notify@example.test'
  ) then
    raise exception 'S07 C1 base notification fixture missing';
  end if;
end
$$;

-- 501 deliberately old terminal rows prove one maintenance pass is bounded to
-- 500. They retain event/provider/fingerprint evidence while render inputs age.
with base as (
  select j.*
  from public.appointment_notification_jobs j
  where j.recipient = 'notify@example.test'
  order by j.created_at, j.id
  limit 1
)
insert into public.appointment_notification_jobs(
  business_id, appointment_id, recovery_id, kind, channel, recipient, provider,
  state, available_at, retry_until, provider_idempotency_key, last_error_class,
  last_attempt_at, terminal_at,
  event_id, event_version, event_reason, template_version, is_current,
  business_name_snapshot, customer_name_snapshot, starts_at_snapshot,
  timezone_snapshot, service_name_snapshot, staff_name_snapshot,
  price_minor_snapshot, currency_snapshot,
  sender_snapshot, origin_snapshot, request_fingerprint, request_locked_at,
  first_provider_attempt_at, provider_idempotency_expires_at, delivery_certainty
)
select
  b.business_id, b.appointment_id, b.recovery_id, b.kind, b.channel,
  's07-retention-' || g::text || '@example.test', b.provider,
  'failed_terminal', now() - interval '4001 days', now() - interval '4000 days',
  's07-retention/' || g::text, 'retention_test',
  now() - interval '4001 days', now() - interval '4000 days',
  gen_random_uuid(), 10000 + g, 'created', 1, false,
  b.business_name_snapshot, b.customer_name_snapshot, b.starts_at_snapshot,
  b.timezone_snapshot, b.service_name_snapshot, b.staff_name_snapshot,
  b.price_minor_snapshot, b.currency_snapshot,
  'Randevu <noreply@example.test>', 'https://example.test', repeat('f', 64),
  now() - interval '4001 days', now() - interval '4001 days',
  now() - interval '4000 days', 'rejected'
from base b
cross join generate_series(1, 501) g;

-- A terminal row just inside the 30-day window must retain its render inputs.
with base as (
  select j.*
  from public.appointment_notification_jobs j
  where j.recipient = 'notify@example.test'
  order by j.created_at, j.id
  limit 1
)
insert into public.appointment_notification_jobs(
  business_id, appointment_id, recovery_id, kind, channel, recipient, provider,
  state, available_at, retry_until, provider_idempotency_key, last_error_class,
  last_attempt_at, terminal_at,
  event_id, event_version, event_reason, template_version, is_current,
  business_name_snapshot, customer_name_snapshot, starts_at_snapshot,
  timezone_snapshot, service_name_snapshot, staff_name_snapshot,
  price_minor_snapshot, currency_snapshot, delivery_certainty
)
select
  b.business_id, b.appointment_id, b.recovery_id, b.kind, b.channel,
  's07-retention-recent@example.test', b.provider,
  'failed_terminal', now() - interval '29 days', now() - interval '28 days',
  's07-retention/recent', 'retention_recent',
  now() - interval '29 days', now() - interval '29 days',
  gen_random_uuid(), 11000, 'created', 1, false,
  b.business_name_snapshot, b.customer_name_snapshot, b.starts_at_snapshot,
  b.timezone_snapshot, b.service_name_snapshot, b.staff_name_snapshot,
  b.price_minor_snapshot, b.currency_snapshot, 'rejected'
from base b;

-- The Phase 9 phone-only booking has no notification row. Give it an active
-- lease to prove old created/appointment data cannot make maintenance scrub an
-- in-flight job.
insert into public.appointment_notification_jobs(
  business_id, appointment_id, recovery_id, kind, channel, recipient, provider,
  state, available_at, retry_until, lease_token, lease_expires_at,
  provider_idempotency_key, event_id, event_version, event_reason,
  template_version, is_current,
  business_name_snapshot, customer_name_snapshot, starts_at_snapshot,
  timezone_snapshot, service_name_snapshot, staff_name_snapshot,
  price_minor_snapshot, currency_snapshot, delivery_certainty
)
select
  r.business_id, r.appointment_id, r.recovery_id,
  'public_booking_confirmation', 'email', 's07-retention-active@example.test',
  'resend', 'leased', now() - interval '40 days', now() + interval '1 day',
  '8f000000-0000-4000-8000-000000000001', now() + interval '1 hour',
  's07-retention/active', gen_random_uuid(), 1, 'created', 1, true,
  b.name, a.customer_name_snapshot, a.starts_at, a.timezone,
  a.service_name_snapshot, a.staff_name_snapshot,
  a.price_minor_snapshot, a.currency_snapshot, 'unattempted'
from public.public_booking_recoveries r
join public.appointments a
  on a.business_id = r.business_id and a.id = r.appointment_id
join public.businesses b on b.id = r.business_id
where r.recovery_id = '8b000000-0000-4000-8000-000000000004'::uuid;

do $$
begin
  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key = 's07-retention/active'
      and state = 'leased'
  ) then
    raise exception 'S07 C1 active lease fixture missing';
  end if;
end
$$;

set local role anon;
select * from public.maintain_notification_jobs(repeat('r', 43));
reset role;

do $$
declare
  v_purged integer;
begin
  select count(*) into v_purged
  from public.appointment_notification_jobs
  where provider_idempotency_key like 's07-retention/%'
    and provider_idempotency_key not in ('s07-retention/recent','s07-retention/active')
    and pii_purged_at is not null;
  if v_purged <> 500 then
    raise exception 'S07 C1 first maintenance batch expected 500 purges, got %', v_purged;
  end if;

  if exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key like 's07-retention/%'
      and pii_purged_at is not null
      and (
        recipient is not null
        or business_name_snapshot is not null
        or customer_name_snapshot is not null
        or starts_at_snapshot is not null
        or timezone_snapshot is not null
        or service_name_snapshot is not null
        or staff_name_snapshot is not null
        or price_minor_snapshot is not null
        or currency_snapshot is not null
      )
  ) then
    raise exception 'S07 C1 purged row retained terminal render PII';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key like 's07-retention/%'
      and pii_purged_at is not null
      and event_id is not null
      and provider = 'resend'
      and request_fingerprint = repeat('f', 64)
      and delivery_certainty = 'rejected'
      and state = 'failed_terminal'
  ) then
    raise exception 'S07 C1 minimal audit evidence was not retained';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key = 's07-retention/recent'
      and pii_purged_at is null
      and recipient = 's07-retention-recent@example.test'
  ) then
    raise exception 'S07 C1 purged a terminal row before 30 days';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key = 's07-retention/active'
      and state = 'leased'
      and pii_purged_at is null
      and recipient = 's07-retention-active@example.test'
  ) then
    raise exception 'S07 C1 scrubbed or terminalized an active lease';
  end if;

  if not exists (
    select 1 from public.appointments
    where customer_email_snapshot = 'notify@example.test'
  ) then
    raise exception 'S07 C1 retention modified the appointment/customer record';
  end if;
end
$$;

-- The remaining old row is removed by the next bounded pass.
set local role anon;
select * from public.maintain_notification_jobs(repeat('r', 43));
reset role;

do $$
declare
  v_purged integer;
begin
  select count(*) into v_purged
  from public.appointment_notification_jobs
  where provider_idempotency_key like 's07-retention/%'
    and provider_idempotency_key not in ('s07-retention/recent','s07-retention/active')
    and pii_purged_at is not null;
  if v_purged <> 501 then
    raise exception 'S07 C1 second maintenance pass did not finish old batch: %', v_purged;
  end if;

  -- A purged audit row cannot be resurrected into a dispatchable state because
  -- its frozen inputs are gone.
  begin
    update public.appointment_notification_jobs
    set state = 'retry_wait'
    where provider_idempotency_key = (
      select provider_idempotency_key
      from public.appointment_notification_jobs
      where provider_idempotency_key like 's07-retention/%'
        and pii_purged_at is not null
      order by provider_idempotency_key
      limit 1
    );
    raise exception 'S07 C1 purged row was resurrected';
  exception when check_violation then null;
  end;

  -- Partial manual scrubbing before the retention marker is equally forbidden.
  begin
    update public.appointment_notification_jobs
    set recipient = null
    where provider_idempotency_key = 's07-retention/recent';
    raise exception 'S07 C1 allowed partial unmarked PII scrub';
  exception when check_violation then null;
  end;
end
$$;

-- Once the boundary is actually crossed, the recent terminal row becomes
-- eligible on the following pass.
update public.appointment_notification_jobs
set terminal_at = now() - interval '31 days'
where provider_idempotency_key = 's07-retention/recent';

set local role anon;
select * from public.maintain_notification_jobs(repeat('r', 43));
reset role;

do $$
begin
  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key = 's07-retention/recent'
      and pii_purged_at is not null
      and recipient is null
      and customer_name_snapshot is null
  ) then
    raise exception 'S07 C1 did not scrub terminal PII after 30-day boundary';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key = 's07-retention/active'
      and state = 'leased'
      and pii_purged_at is null
  ) then
    raise exception 'S07 C1 later maintenance touched active lease';
  end if;
end
$$;

rollback;