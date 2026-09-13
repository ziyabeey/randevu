begin;

-- S07 C1: terminal notification audit rows retain only the minimal durable
-- delivery/idempotency evidence after the K03 30-day window. Customer-facing
-- recipient/render inputs are scrubbed in bounded batches; appointments and
-- customer records are explicitly outside this automatic retention policy.

alter table public.appointment_notification_jobs
  add column pii_purged_at timestamptz;

alter table public.appointment_notification_jobs
  alter column recipient drop not null,
  alter column business_name_snapshot drop not null,
  alter column customer_name_snapshot drop not null,
  alter column starts_at_snapshot drop not null,
  alter column timezone_snapshot drop not null,
  alter column service_name_snapshot drop not null,
  alter column staff_name_snapshot drop not null,
  alter column price_minor_snapshot drop not null,
  alter column currency_snapshot drop not null;

-- Before purge the complete frozen render inputs must remain present. After
-- purge they disappear atomically and the row must already be terminal.
alter table public.appointment_notification_jobs
  add constraint appointment_notification_jobs_pii_retention_check
  check (
    (
      pii_purged_at is null
      and recipient is not null
      and business_name_snapshot is not null
      and customer_name_snapshot is not null
      and starts_at_snapshot is not null
      and timezone_snapshot is not null
      and service_name_snapshot is not null
      and staff_name_snapshot is not null
      and price_minor_snapshot is not null
      and currency_snapshot is not null
    )
    or
    (
      pii_purged_at is not null
      and state in ('sent','failed_terminal')
      and recipient is null
      and business_name_snapshot is null
      and customer_name_snapshot is null
      and starts_at_snapshot is null
      and timezone_snapshot is null
      and service_name_snapshot is null
      and staff_name_snapshot is null
      and price_minor_snapshot is null
      and currency_snapshot is null
    )
  );

create index appointment_notification_jobs_pii_retention_idx
  on public.appointment_notification_jobs (
    (case when state = 'sent' then sent_at else terminal_at end), id
  )
  where pii_purged_at is null
    and state in ('sent','failed_terminal');

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
  v_pii_cutoff timestamptz := clock_timestamp() - interval '30 days';
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

  -- Terminal recipient/render PII is removed only after the full K03 window.
  -- LIMIT + SKIP LOCKED bounds one maintenance pass and allows concurrent cron
  -- attempts without double-owning a row. Request fingerprint, event/provider
  -- identity, delivery result and error class remain as the minimal audit trace.
  with stale as (
    select j.id
    from public.appointment_notification_jobs j
    where j.pii_purged_at is null
      and (
        (j.state = 'sent' and j.sent_at is not null and j.sent_at <= v_pii_cutoff)
        or
        (j.state = 'failed_terminal' and j.terminal_at is not null and j.terminal_at <= v_pii_cutoff)
      )
    order by
      case when j.state = 'sent' then j.sent_at else j.terminal_at end,
      j.id
    limit 500
    for update skip locked
  )
  update public.appointment_notification_jobs j
  set recipient = null,
      business_name_snapshot = null,
      customer_name_snapshot = null,
      starts_at_snapshot = null,
      timezone_snapshot = null,
      service_name_snapshot = null,
      staff_name_snapshot = null,
      price_minor_snapshot = null,
      currency_snapshot = null,
      pii_purged_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from stale
  where j.id = stale.id;

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

  -- Closure cleanup remains bounded and opportunistic. Its failure cannot roll
  -- back notification maintenance or weaken the create-time fence/deadline.
  begin
    perform public.prune_public_booking_resolution_closures();
  exception when others then null;
  end;

  return query select v_terminalized, v_cleaned;
end
$$;

revoke all on function public.maintain_notification_jobs(text)
  from public, anon, authenticated;
grant execute on function public.maintain_notification_jobs(text) to anon;

commit;