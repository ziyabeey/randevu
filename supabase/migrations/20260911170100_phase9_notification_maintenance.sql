begin;

-- F09-03 maintenance/backfill.
-- Existing F09-02 recoveries may predate the enqueue trigger. Backfill only
-- still-live public bookings with an e-mail and no existing confirmation job.
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
)
select
  r.business_id,
  r.appointment_id,
  r.recovery_id,
  'public_booking_confirmation',
  'email',
  btrim(a.customer_email_snapshot),
  'resend',
  'pending',
  now(),
  r.expires_at,
  'public-booking-confirmation/' || r.appointment_id::text
from public.public_booking_recoveries r
join public.appointments a
  on a.business_id = r.business_id
 and a.id = r.appointment_id
 and a.source = 'public'
where r.appointment_id is not null
  and r.expires_at > now()
  and nullif(btrim(a.customer_email_snapshot), '') is not null
on conflict (appointment_id, kind, channel) do nothing;

create or replace function public.maintain_notification_jobs(p_dispatch_secret text)
returns table(terminalized integer, recovery_material_cleaned integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_terminalized integer := 0;
  v_cleaned integer := 0;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;

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
  get diagnostics v_terminalized = row_count;

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

revoke all on function public.maintain_notification_jobs(text) from public;
grant execute on function public.maintain_notification_jobs(text) to anon;

commit;
