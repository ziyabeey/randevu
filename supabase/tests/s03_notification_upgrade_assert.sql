do $$
begin
  if (select count(*) from public.appointment_notification_jobs
      where business_id='4b000000-0000-4000-8000-000000000104') <> 8 then
    raise exception 'S03 upgrade lost legacy jobs';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where recipient='s03-upgrade-1@example.test'
      and state='pending'
      and attempt_count=0
      and delivery_certainty='unattempted'
      and request_fingerprint is null
      and event_version=1
      and event_reason='created'
      and business_name_snapshot='S03 Upgrade Salon'
  ) then raise exception 'S03 upgrade did not preserve safe unattempted job'; end if;

  if exists (
    select 1 from public.appointment_notification_jobs
    where recipient in ('s03-upgrade-2@example.test','s03-upgrade-3@example.test')
      and (
        state <> 'failed_terminal'
        or delivery_certainty <> 'legacy_unknown'
        or last_error_class <> 'legacy_payload_unverifiable'
        or lease_token is not null
        or lease_expires_at is not null
      )
  ) then raise exception 'S03 upgrade would resend an unverifiable attempted job'; end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where recipient='s03-upgrade-4@example.test'
      and state='sent'
      and delivery_certainty='accepted'
      and provider_message_id='legacy-sent-s03-4'
  ) then raise exception 'S03 upgrade did not preserve accepted provider receipt'; end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where recipient='s03-upgrade-5@example.test'
      and state='failed_terminal'
      and delivery_certainty='legacy_unknown'
      and last_error_class='legacy_validation_error'
  ) then raise exception 'S03 upgrade rewrote legacy terminal evidence'; end if;

  if exists (
    select 1 from public.appointment_notification_jobs
    where business_id='4b000000-0000-4000-8000-000000000104'
      and (
        event_id is null
        or event_version is null
        or business_name_snapshot is null
        or customer_name_snapshot is null
        or starts_at_snapshot is null
        or timezone_snapshot is null
        or service_name_snapshot is null
        or staff_name_snapshot is null
        or price_minor_snapshot is null
        or currency_snapshot is null
      )
  ) then raise exception 'S03 upgrade left incomplete frozen event snapshots'; end if;

  if (select count(*) from public.appointment_notification_jobs
      where recipient in ('s03-upgrade-6@example.test','s03-upgrade-7@example.test','s03-upgrade-8@example.test')
        and state='failed_terminal' and not is_current
        and last_error_class='legacy_appointment_inactive'
        and request_fingerprint is null and receipt_token is null) <> 3 then
    raise exception 'S03 upgrade left inactive legacy confirmations sendable';
  end if;

  if has_function_privilege('anon','public.claim_notification_jobs(text,integer,integer)','execute') then
    raise exception 'S03 upgrade left legacy claim RPC open';
  end if;
  if not has_function_privilege('anon','public.claim_notification_jobs_v2(text,integer,integer)','execute') then
    raise exception 'S03 upgrade did not expose v2 dispatcher claim';
  end if;
end
$$;

-- The unattempted legacy row remains dispatchable under the versioned protocol.
insert into public.notification_dispatch_config(config_key, secret_hash)
values (
  'default',
  encode(digest('vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv','sha256'),'hex')
)
on conflict(config_key) do update set secret_hash=excluded.secret_hash, updated_at=now();

set role anon;
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv', 50, 45
  )
  where recipient='s03-upgrade-1@example.test';
  if v_claim.job_id is null then raise exception 'S03 safe legacy pending job was not claimable'; end if;
  if v_claim.business_name_snapshot <> 'S03 Upgrade Salon'
     or v_claim.template_version <> 1
     or v_claim.delivery_certainty <> 'unattempted' then
    raise exception 'S03 safe legacy pending claim snapshot mismatch';
  end if;
end
$$;
reset role;
