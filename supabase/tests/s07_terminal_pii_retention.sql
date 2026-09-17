begin;

-- S07 C1 owns its fixture. No assertion depends on rows left behind by an older
-- test because the canonical PG plan intentionally runs most feature tests in
-- transactions that roll back.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '97000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s07-retention-owner@example.test','',now(),
  '{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict (id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '94000000-0000-4000-8000-000000000001',
  'S07 Retention Salon','s07-retention-salon','Europe/Istanbul',
  '97000000-0000-4000-8000-000000000001'
) on conflict (id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '98000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001','owner',true
) on conflict (business_id,user_id) do update set role='owner', active=true;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  price_minor,currency
) values (
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'S07 Retention Service',30,0,0,25000,'TRY'
) on conflict (id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '96000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'S07 Retention Staff'
) on conflict (id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',true
) on conflict (business_id,staff_id,service_id) do update set active=true;

-- Keep this fixture publishable when the same retention assertions are rerun
-- after F10's public-appointment readiness guard has been installed.
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values (
  '94000000-0000-4000-8000-000000000001',1,time '09:00',time '18:00',true
);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  '94000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',1,time '09:00',time '18:00',true
);

-- 503 independent appointment/recovery anchors:
-- 1..501 old terminal jobs, 502 just inside the retention boundary, 503 active.
insert into public.customers(id,business_id,name,email,created_by)
select
  format('91000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  '94000000-0000-4000-8000-000000000001'::uuid,
  'S07 Retention Customer ' || g,
  's07-retention-customer-' || g || '@example.test',
  null
from generate_series(1,503) g;

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,
  duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by,source
)
select
  format('92000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  '94000000-0000-4000-8000-000000000001'::uuid,
  format('91000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  '95000000-0000-4000-8000-000000000001'::uuid,
  '96000000-0000-4000-8000-000000000001'::uuid,
  case when g=503 then 'scheduled' else 'cancelled' end,
  now() + interval '500 days' + make_interval(mins => g),
  now() + interval '500 days' + make_interval(mins => g + 30),
  now() + interval '500 days' + make_interval(mins => g),
  now() + interval '500 days' + make_interval(mins => g + 30),
  'Europe/Istanbul',
  'S07 Retention Customer ' || g,
  's07-retention-customer-' || g || '@example.test',
  'S07 Retention Service','S07 Retention Staff',30,0,0,25000,'TRY',null,'public'
from generate_series(1,503) g;

insert into public.public_booking_recoveries(
  recovery_id,business_id,idempotency_key,appointment_id,
  management_token_hash,recovery_secret_hash,
  management_token_ciphertext,management_token_iv,key_version,expires_at
)
select
  format('93000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  '94000000-0000-4000-8000-000000000001'::uuid,
  's07-retention-command-' || g,
  format('92000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  repeat('a',64),repeat('b',64),null,null,1,now()+interval '7 days'
from generate_series(1,503) g;

-- The dispatcher secret is explicit and private to this disposable PG fixture.
insert into public.notification_dispatch_config(config_key,secret_hash)
values (
  'default',encode(extensions.digest(repeat('r',43),'sha256'),'hex')
)
on conflict (config_key) do update
set secret_hash=excluded.secret_hash,updated_at=now();

insert into public.appointment_notification_jobs(
  business_id,appointment_id,recovery_id,kind,channel,recipient,provider,
  state,available_at,retry_until,lease_token,lease_expires_at,
  provider_idempotency_key,last_error_class,last_attempt_at,terminal_at,
  event_id,event_version,event_reason,template_version,is_current,
  business_name_snapshot,customer_name_snapshot,starts_at_snapshot,
  timezone_snapshot,service_name_snapshot,staff_name_snapshot,
  price_minor_snapshot,currency_snapshot,
  sender_snapshot,origin_snapshot,request_fingerprint,request_locked_at,
  first_provider_attempt_at,provider_idempotency_expires_at,delivery_certainty
)
select
  '94000000-0000-4000-8000-000000000001'::uuid,
  format('92000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  format('93000000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'public_booking_confirmation','email',
  case
    when g=502 then 's07-retention-recent@example.test'
    when g=503 then 's07-retention-active@example.test'
    else 's07-retention-' || g || '@example.test'
  end,
  'resend',
  case when g=503 then 'leased' else 'failed_terminal' end,
  case when g=503 then now()-interval '40 days'
       when g=502 then now()-interval '29 days'
       else now()-interval '4001 days' end,
  case when g=503 then now()+interval '1 day'
       when g=502 then now()-interval '28 days'
       else now()-interval '4000 days' end,
  case when g=503 then '8f000000-0000-4000-8000-000000000001'::uuid else null end,
  case when g=503 then now()+interval '1 hour' else null end,
  case when g=502 then 's07-retention/recent'
       when g=503 then 's07-retention/active'
       else 's07-retention/' || g end,
  case when g=503 then null when g=502 then 'retention_recent' else 'retention_test' end,
  case when g=503 then null when g=502 then now()-interval '29 days'
       else now()-interval '4001 days' end,
  case when g=503 then null when g=502 then now()-interval '29 days'
       else now()-interval '4000 days' end,
  gen_random_uuid(),1,'created',1,case when g=503 then true else false end,
  'S07 Retention Salon','S07 Retention Customer ' || g,
  now()+interval '500 days'+make_interval(mins=>g),
  'Europe/Istanbul','S07 Retention Service','S07 Retention Staff',25000,'TRY',
  case when g<=501 then 'Randevu <noreply@example.test>' else null end,
  case when g<=501 then 'https://example.test' else null end,
  case when g<=501 then repeat('f',64) else null end,
  case when g<=501 then now()-interval '4001 days' else null end,
  case when g<=501 then now()-interval '4001 days' else null end,
  case when g<=501 then now()-interval '4000 days' else null end,
  case when g<=502 then 'rejected' else 'unattempted' end
from generate_series(1,503) g;

do $$
begin
  if (select count(*) from public.appointment_notification_jobs
      where provider_idempotency_key like 's07-retention/%') <> 503 then
    raise exception 'S07 C1 self-contained fixture did not create 503 jobs';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key='s07-retention/active'
      and state='leased' and lease_expires_at>now()
  ) then
    raise exception 'S07 C1 active lease fixture missing';
  end if;
end
$$;

set local role anon;
select * from public.maintain_notification_jobs(repeat('r',43));
reset role;

do $$
declare v_purged integer;
begin
  select count(*) into v_purged
  from public.appointment_notification_jobs
  where provider_idempotency_key like 's07-retention/%'
    and provider_idempotency_key not in ('s07-retention/recent','s07-retention/active')
    and pii_purged_at is not null;
  if v_purged<>500 then
    raise exception 'S07 C1 first maintenance batch expected 500 purges, got %',v_purged;
  end if;

  if exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key like 's07-retention/%'
      and pii_purged_at is not null
      and (
        recipient is not null or business_name_snapshot is not null
        or customer_name_snapshot is not null or starts_at_snapshot is not null
        or timezone_snapshot is not null or service_name_snapshot is not null
        or staff_name_snapshot is not null or price_minor_snapshot is not null
        or currency_snapshot is not null
      )
  ) then
    raise exception 'S07 C1 purged row retained terminal render PII';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key like 's07-retention/%'
      and pii_purged_at is not null and event_id is not null
      and provider='resend' and request_fingerprint=repeat('f',64)
      and delivery_certainty='rejected' and state='failed_terminal'
  ) then
    raise exception 'S07 C1 minimal audit evidence was not retained';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key='s07-retention/recent'
      and pii_purged_at is null
      and recipient='s07-retention-recent@example.test'
  ) then
    raise exception 'S07 C1 purged a terminal row before 30 days';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key='s07-retention/active'
      and state='leased' and pii_purged_at is null
      and recipient='s07-retention-active@example.test'
  ) then
    raise exception 'S07 C1 scrubbed or terminalized an active lease';
  end if;

  if not exists (
    select 1 from public.appointments
    where id='92000000-0000-4000-8000-000000000001'::uuid
      and customer_email_snapshot='s07-retention-customer-1@example.test'
  ) or not exists (
    select 1 from public.customers
    where id='91000000-0000-4000-8000-000000000001'::uuid
      and email='s07-retention-customer-1@example.test'
  ) then
    raise exception 'S07 C1 retention modified appointment/customer records';
  end if;
end
$$;

-- The remaining old row is removed by the next bounded pass.
set local role anon;
select * from public.maintain_notification_jobs(repeat('r',43));
reset role;

do $$
declare v_purged integer;
begin
  select count(*) into v_purged
  from public.appointment_notification_jobs
  where provider_idempotency_key like 's07-retention/%'
    and provider_idempotency_key not in ('s07-retention/recent','s07-retention/active')
    and pii_purged_at is not null;
  if v_purged<>501 then
    raise exception 'S07 C1 second maintenance pass did not finish old batch: %',v_purged;
  end if;

  -- A scrubbed audit row cannot be resurrected into a dispatchable state.
  begin
    update public.appointment_notification_jobs
    set state='retry_wait'
    where provider_idempotency_key=(
      select provider_idempotency_key
      from public.appointment_notification_jobs
      where provider_idempotency_key like 's07-retention/%'
        and pii_purged_at is not null
      order by provider_idempotency_key limit 1
    );
    raise exception 'S07 C1 purged row was resurrected';
  exception when check_violation then null;
  end;

  -- Partial manual scrub without the marker is equally forbidden.
  begin
    update public.appointment_notification_jobs
    set recipient=null
    where provider_idempotency_key='s07-retention/recent';
    raise exception 'S07 C1 allowed partial unmarked PII scrub';
  exception when check_violation then null;
  end;
end
$$;

-- Once the boundary is crossed, the recent terminal row becomes eligible.
update public.appointment_notification_jobs
set terminal_at=now()-interval '31 days'
where provider_idempotency_key='s07-retention/recent';

set local role anon;
select * from public.maintain_notification_jobs(repeat('r',43));
reset role;

do $$
begin
  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key='s07-retention/recent'
      and pii_purged_at is not null and recipient is null
      and customer_name_snapshot is null
  ) then
    raise exception 'S07 C1 did not scrub terminal PII after 30-day boundary';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where provider_idempotency_key='s07-retention/active'
      and state='leased' and pii_purged_at is null
  ) then
    raise exception 'S07 C1 later maintenance touched active lease';
  end if;
end
$$;

rollback;
