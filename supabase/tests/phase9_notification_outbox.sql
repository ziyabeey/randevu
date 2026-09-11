begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase9-notify-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000003','Notification Test','notification-test','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000003'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000003','4b000000-0000-4000-8000-000000000003',
  '19000000-0000-4000-8000-000000000003','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000003','4b000000-0000-4000-8000-000000000003',
  'Notification Hizmeti',30,5,5,210000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000003','4b000000-0000-4000-8000-000000000003','Notification Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000003','7b000000-0000-4000-8000-000000000003',
  '6b000000-0000-4000-8000-000000000003',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000003',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000003',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000003',
    '7b000000-0000-4000-8000-000000000003',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000003', true, 15, 0, 30
  );
end
$$;

reset role;
insert into public.notification_dispatch_config(config_key, secret_hash)
values (
  'default',
  encode(digest('sssssssssssssssssssssssssssssssssssssssssss','sha256'),'hex')
)
on conflict(config_key) do update set secret_hash=excluded.secret_hash, updated_at=now();

set local role anon;

-- E-mail booking must create appointment + recovery + outbox job atomically.
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:05') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_token text := 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';
  v_secret text := 'jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj';
begin
  select appointment_id into v_id
  from public.create_public_appointment_with_recovery(
    'notification-test','phase9-notify-0001','Notify Müşteri',
    '6b000000-0000-4000-8000-000000000003','7b000000-0000-4000-8000-000000000003',
    v_start,
    encode(digest(v_token,'sha256'),'hex'),
    '8b000000-0000-4000-8000-000000000003',
    encode(digest(v_secret,'sha256'),'hex'),
    'ciphertext-notify-abcdefghijklmnopqrstuvwxyz0123456789','iv-notify-12345678',1::smallint,
    '+90 555 900 00 10','notify@example.test',null
  );
  if v_id is null then raise exception 'notification booking was not created'; end if;
end
$$;

-- Public callers cannot inspect outbox/config tables directly.
do $$
begin
  begin
    perform count(*) from public.appointment_notification_jobs;
    raise exception 'anon can read notification jobs directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.notification_dispatch_config;
    raise exception 'anon can read dispatch config directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- A guessed dispatcher proof cannot claim jobs.
do $$
begin
  begin
    perform count(*) from public.claim_notification_jobs(
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 10, 45
    );
    raise exception 'wrong dispatch secret claimed jobs';
  exception when others then
    if sqlerrm = 'wrong dispatch secret claimed jobs' then raise; end if;
    if position('NOTIFICATION_DISPATCH_UNAUTHORIZED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Correct proof gets a lease. A second worker cannot claim the active lease.
do $$
declare
  v_claim record;
  v_second_count integer;
  v_state text;
begin
  select * into v_claim
  from public.claim_notification_jobs(
    'sssssssssssssssssssssssssssssssssssssssssss', 10, 45
  );
  if v_claim.job_id is null then raise exception 'dispatcher did not claim queued job'; end if;
  if v_claim.attempt_count <> 1 then raise exception 'first claim attempt count is not 1'; end if;
  if v_claim.recipient <> 'notify@example.test' then raise exception 'claim recipient mismatch'; end if;
  if v_claim.management_token_ciphertext is null or v_claim.management_token_iv is null then
    raise exception 'claim omitted encrypted management material';
  end if;

  select count(*) into v_second_count
  from public.claim_notification_jobs(
    'sssssssssssssssssssssssssssssssssssssssssss', 10, 45
  );
  if v_second_count <> 0 then raise exception 'second worker claimed active lease'; end if;

  begin
    perform public.complete_notification_job(
      'sssssssssssssssssssssssssssssssssssssssssss',
      v_claim.job_id,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'provider-wrong-lease'
    );
    raise exception 'wrong lease completed notification';
  exception when others then
    if sqlerrm = 'wrong lease completed notification' then raise; end if;
    if position('NOTIFICATION_LEASE_LOST' in sqlerrm)=0 then raise; end if;
  end;

  v_state := public.release_notification_job(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend_network_error',
    true,
    1
  );
  if v_state <> 'retry_wait' then raise exception 'retryable failure did not enter retry_wait'; end if;
end
$$;

reset role;
update public.appointment_notification_jobs
set available_at=now()-interval '1 second'
where appointment_id in (
  select id from public.appointments
  where business_id='4b000000-0000-4000-8000-000000000003'
    and customer_email_snapshot='notify@example.test'
);

set local role anon;
-- Retry claims the same durable job and authoritative completion requires its lease.
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs(
    'sssssssssssssssssssssssssssssssssssssssssss', 10, 45
  );
  if v_claim.job_id is null then raise exception 'retry job was not reclaimed'; end if;
  if v_claim.attempt_count <> 2 then raise exception 'retry attempt count did not increment'; end if;

  if not public.complete_notification_job(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend-message-0001'
  ) then raise exception 'completion returned false'; end if;
end
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.appointment_notification_jobs
    where business_id='4b000000-0000-4000-8000-000000000003'
      and state='sent'
      and attempt_count=2
      and provider_message_id='resend-message-0001'
  ) then raise exception 'sent receipt was not persisted'; end if;

  if not exists (
    select 1 from public.appointments
    where business_id='4b000000-0000-4000-8000-000000000003'
      and customer_email_snapshot='notify@example.test'
  ) then raise exception 'notification failure incorrectly removed appointment'; end if;
end
$$;

-- Phone-only booking remains valid and intentionally creates no e-mail job.
set local role anon;
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '11:05') at time zone 'Europe/Istanbul';
begin
  perform public.create_public_appointment_with_recovery(
    'notification-test','phase9-notify-0002','Phone Only',
    '6b000000-0000-4000-8000-000000000003','7b000000-0000-4000-8000-000000000003',
    v_start,
    encode(digest('kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk','sha256'),'hex'),
    '8b000000-0000-4000-8000-000000000004',
    encode(digest('lllllllllllllllllllllllllllllllllllllllllll','sha256'),'hex'),
    'ciphertext-phone-abcdefghijklmnopqrstuvwxyz01234567890','iv-phone-123456789',1::smallint,
    '+90 555 900 00 11',null,null
  );
end
$$;

reset role;
do $$
begin
  if exists (
    select 1 from public.appointment_notification_jobs j
    join public.appointments a on a.id=j.appointment_id and a.business_id=j.business_id
    where a.customer_name_snapshot='Phone Only'
  ) then raise exception 'phone-only booking created email job'; end if;
end
$$;

-- Non-retryable provider failure becomes terminal without rolling back booking.
set local role anon;
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '12:05') at time zone 'Europe/Istanbul';
  v_claim record;
  v_state text;
begin
  perform public.create_public_appointment_with_recovery(
    'notification-test','phase9-notify-0003','Terminal Mail',
    '6b000000-0000-4000-8000-000000000003','7b000000-0000-4000-8000-000000000003',
    v_start,
    encode(digest('mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm','sha256'),'hex'),
    '8b000000-0000-4000-8000-000000000005',
    encode(digest('nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn','sha256'),'hex'),
    'ciphertext-terminal-abcdefghijklmnopqrstuvwxyz01234567','iv-terminal-12345',1::smallint,
    '+90 555 900 00 12','terminal@example.test',null
  );

  select * into v_claim
  from public.claim_notification_jobs(
    'sssssssssssssssssssssssssssssssssssssssssss', 10, 45
  );
  if v_claim.recipient <> 'terminal@example.test' then
    raise exception 'terminal test claimed unexpected job';
  end if;

  v_state := public.release_notification_job(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend_validation_error',
    false,
    60
  );
  if v_state <> 'failed_terminal' then raise exception 'non-retryable failure did not terminate'; end if;
end
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.appointments
    where business_id='4b000000-0000-4000-8000-000000000003'
      and customer_email_snapshot='terminal@example.test'
  ) then raise exception 'terminal notification failure removed appointment'; end if;
end
$$;

-- Once recovery is expired and all jobs are terminal, encrypted recovery material is cleaned.
update public.public_booking_recoveries
set expires_at=now()-interval '1 minute'
where business_id='4b000000-0000-4000-8000-000000000003';

set local role anon;
select count(*) from public.claim_notification_jobs(
  'sssssssssssssssssssssssssssssssssssssssssss', 10, 45
);

reset role;
do $$
begin
  if exists (
    select 1 from public.public_booking_recoveries r
    where r.business_id='4b000000-0000-4000-8000-000000000003'
      and r.expires_at <= now()
      and not exists (
        select 1 from public.appointment_notification_jobs j
        where j.recovery_id=r.recovery_id
          and j.state not in ('sent','failed_terminal')
      )
      and (r.recovery_secret_hash is not null
        or r.management_token_ciphertext is not null
        or r.management_token_iv is not null)
  ) then raise exception 'terminal expired recovery material was not cleaned'; end if;
end
$$;

rollback;
