begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000103','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s03-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000103','S03 Frozen Salon','s03-frozen-salon','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000103'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000103','4b000000-0000-4000-8000-000000000103',
  '19000000-0000-4000-8000-000000000103','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000103','4b000000-0000-4000-8000-000000000103',
  'S03 Hizmeti',30,5,5,210000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000103','4b000000-0000-4000-8000-000000000103','S03 Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000103','7b000000-0000-4000-8000-000000000103',
  '6b000000-0000-4000-8000-000000000103',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000103',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000103',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000103',
    '7b000000-0000-4000-8000-000000000103',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000103', true, 15, 0, 30
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

-- Create six independent public bookings. Their notification events are born in
-- the same outer transaction as recovery/capability binding.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_index integer;
  v_start timestamptz;
begin
  for v_index in 1..6 loop
    v_start := (v_day + time '09:05') at time zone 'Europe/Istanbul'
      + make_interval(hours => v_index - 1);
    perform public.create_public_appointment_with_recovery(
      's03-frozen-salon',
      's03-create-000' || v_index,
      'S03 Müşteri ' || v_index,
      '6b000000-0000-4000-8000-000000000103',
      '7b000000-0000-4000-8000-000000000103',
      v_start,
      encode(digest(repeat(chr(96 + v_index), 43),'sha256'),'hex'),
      ('8b000000-0000-4000-8000-' || lpad((100 + v_index)::text, 12, '0'))::uuid,
      encode(digest(repeat(chr(102 + v_index), 43),'sha256'),'hex'),
      'ciphertext-s03-' || v_index || '-abcdefghijklmnopqrstuvwxyz0123456789',
      'iv-s03-' || lpad(v_index::text, 12, '0'),
      1::smallint,
      '+90 555 930 00 ' || lpad(v_index::text, 2, '0'),
      's03-' || v_index || '@example.test',
      null
    );
  end loop;
end
$$;

-- Every new job is a frozen, versioned event with a key derived from event_id.
do $$
begin
  if (select count(*) from public.appointment_notification_jobs
      where business_id='4b000000-0000-4000-8000-000000000103') <> 6 then
    raise exception 'S03 did not create six notification events';
  end if;
  if exists (
    select 1
    from public.appointment_notification_jobs j
    where j.business_id='4b000000-0000-4000-8000-000000000103'
      and (
        j.event_version <> 1
        or j.event_reason <> 'created'
        or j.template_version <> 1
        or not j.is_current
        or j.business_name_snapshot <> 'S03 Frozen Salon'
        or j.provider_idempotency_key <> 'public-booking-confirmation/' || j.event_id::text
      )
  ) then raise exception 'S03 initial event snapshot/version/key mismatch'; end if;
end
$$;

-- Earlier F09 regression fixtures share this database and may contain ready
-- jobs. Keep the S03 claim assertions deterministic without changing production
-- ordering or discarding any row outside this rolled-back test transaction.
update public.appointment_notification_jobs
set state='failed_terminal',
    terminal_at=coalesce(terminal_at, now()),
    last_error_class='s03_test_isolation',
    lease_token=null,
    lease_expires_at=null,
    updated_at=now()
where business_id <> '4b000000-0000-4000-8000-000000000103'
  and state not in ('sent','failed_terminal');

-- Rename live rows after enqueue. Claim must still return the frozen event payload.
update public.businesses
set name='S03 Live Salon Renamed'
where id='4b000000-0000-4000-8000-000000000103';
update public.staff_profiles
set name='S03 Live Staff Renamed'
where id='7b000000-0000-4000-8000-000000000103';

set local role anon;
do $$
declare
  v_claim record;
  v_state text;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss', 1, 45
  );
  if v_claim.job_id is null then raise exception 'S03 first event was not claimed'; end if;
  if v_claim.recipient <> 's03-1@example.test' then
    raise exception 'S03 first claim selected an unexpected event';
  end if;
  if v_claim.business_name_snapshot <> 'S03 Frozen Salon'
     or v_claim.staff_name_snapshot <> 'S03 Ayşe' then
    raise exception 'S03 claim read mutable live business/staff data';
  end if;

  if not public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'Randevu <frozen@example.test>',
    'https://frozen.example.test',
    repeat('a',64)
  ) then raise exception 'S03 request lock returned false'; end if;

  v_state := public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend_network_error',
    true,
    1,
    false
  );
  if v_state <> 'retry_wait' then raise exception 'S03 ambiguous first attempt did not retry safely'; end if;
end
$$;
reset role;

update public.appointment_notification_jobs
set available_at=now()-interval '1 second'
where recipient='s03-1@example.test';

set local role anon;
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss', 1, 45
  );
  if v_claim.recipient <> 's03-1@example.test' then raise exception 'S03 retry claimed unexpected event'; end if;
  if v_claim.sender_snapshot <> 'Randevu <frozen@example.test>'
     or v_claim.origin_snapshot <> 'https://frozen.example.test'
     or v_claim.request_fingerprint <> repeat('a',64)
     or v_claim.business_name_snapshot <> 'S03 Frozen Salon' then
    raise exception 'S03 retry did not preserve frozen request inputs';
  end if;
  if not public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    v_claim.sender_snapshot,
    v_claim.origin_snapshot,
    v_claim.request_fingerprint
  ) then raise exception 'S03 retry lock failed'; end if;
  if not public.complete_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend-s03-frozen-1',
    v_claim.request_fingerprint
  ) then raise exception 'S03 completion returned false'; end if;
end
$$;
reset role;

-- A different fingerprint under the same event/key is rejected before provider use.
set local role anon;
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss', 1, 45
  );
  if v_claim.recipient <> 's03-2@example.test' then raise exception 'S03 mismatch test claimed unexpected event'; end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'Randevu <frozen@example.test>',
    'https://frozen.example.test',
    repeat('b',64)
  );
  begin
    perform public.lock_notification_request_v2(
      'sssssssssssssssssssssssssssssssssssssssssss',
      v_claim.job_id,
      v_claim.lease_token,
      'Randevu <changed@example.test>',
      'https://changed.example.test',
      repeat('c',64)
    );
    raise exception 'S03 accepted a different request under the same provider key';
  exception when others then
    if sqlerrm = 'S03 accepted a different request under the same provider key' then raise; end if;
    if position('NOTIFICATION_REQUEST_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;
  perform public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend_validation_error',
    false,
    60,
    true
  );
end
$$;
reset role;

-- A definitely-unsent confirmation is superseded transactionally on reschedule,
-- producing exactly one new event/version/key.
do $$
declare
  v_appointment uuid;
  v_old_job uuid;
  v_old_start timestamptz;
begin
  select a.id, a.starts_at into v_appointment, v_old_start
  from public.appointments a
  where a.customer_email_snapshot='s03-3@example.test';
  select j.id into v_old_job
  from public.appointment_notification_jobs j
  where j.appointment_id=v_appointment and j.is_current;

  update public.appointments
  set starts_at=starts_at+interval '1 day',
      ends_at=ends_at+interval '1 day',
      occupied_starts_at=occupied_starts_at+interval '1 day',
      occupied_ends_at=occupied_ends_at+interval '1 day'
  where id=v_appointment;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where id=v_old_job
      and not is_current
      and state='failed_terminal'
      and last_error_class='superseded_before_send'
  ) then raise exception 'S03 old unsent event was not superseded'; end if;

  if (select count(*) from public.appointment_notification_jobs
      where appointment_id=v_appointment) <> 2 then
    raise exception 'S03 reschedule did not create exactly one replacement event';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where appointment_id=v_appointment
      and is_current
      and event_version=2
      and event_reason='rescheduled'
      and starts_at_snapshot=v_old_start+interval '1 day'
      and provider_idempotency_key='public-booking-confirmation/' || event_id::text
  ) then raise exception 'S03 replacement event snapshot/version/key mismatch'; end if;
end
$$;

-- Cancellation terminalizes the unsent event and never creates a new confirmation.
do $$
declare
  v_appointment uuid;
begin
  select id into v_appointment
  from public.appointments
  where customer_email_snapshot='s03-4@example.test';
  update public.appointments
  set status='cancelled', cancelled_at=now(), cancellation_reason='S03 test'
  where id=v_appointment;

  if (select count(*) from public.appointment_notification_jobs
      where appointment_id=v_appointment) <> 1 then
    raise exception 'S03 cancel created a new confirmation';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where appointment_id=v_appointment
      and not is_current
      and state='failed_terminal'
      and last_error_class='cancelled_before_send'
  ) then raise exception 'S03 cancel did not stop the unsent event'; end if;
end
$$;

-- Once a provider request may have been accepted, reschedule must not generate a
-- duplicate replacement confirmation.
set local role anon;
do $$
declare
  v_claim record;
  v_state text;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss', 50, 45
  )
  where recipient='s03-5@example.test';
  if v_claim.job_id is null then raise exception 'S03 ambiguous reschedule event not claimed'; end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'Randevu <frozen@example.test>',
    'https://frozen.example.test',
    repeat('d',64)
  );
  v_state := public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend_network_error',
    true,
    1,
    false
  );
  if v_state <> 'retry_wait' then raise exception 'S03 ambiguous event did not enter retry_wait'; end if;
end
$$;
reset role;

do $$
declare
  v_appointment uuid;
begin
  select id into v_appointment from public.appointments where customer_email_snapshot='s03-5@example.test';
  update public.appointments
  set starts_at=starts_at+interval '2 days',
      ends_at=ends_at+interval '2 days',
      occupied_starts_at=occupied_starts_at+interval '2 days',
      occupied_ends_at=occupied_ends_at+interval '2 days'
  where id=v_appointment;

  if (select count(*) from public.appointment_notification_jobs
      where appointment_id=v_appointment) <> 1 then
    raise exception 'S03 ambiguous old result created a duplicate event';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where appointment_id=v_appointment
      and not is_current
      and state='failed_terminal'
      and delivery_certainty='ambiguous'
      and last_error_class='rescheduled_after_attempt_needs_review'
  ) then raise exception 'S03 ambiguous reschedule was not preserved for review'; end if;
end
$$;

-- Unknown provider results outside Resend's 24-hour key window are terminalized,
-- never reported as sent and never reclaimed.
set local role anon;
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss', 50, 45
  )
  where recipient='s03-6@example.test';
  if v_claim.job_id is null then raise exception 'S03 expiry event not claimed'; end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'Randevu <frozen@example.test>',
    'https://frozen.example.test',
    repeat('e',64)
  );
  perform public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,
    v_claim.lease_token,
    'resend_network_error',
    true,
    1,
    false
  );
end
$$;
reset role;

update public.appointment_notification_jobs
set provider_idempotency_expires_at=now()-interval '1 second',
    available_at=now()-interval '1 second'
where recipient='s03-6@example.test';

set local role anon;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss', 50, 45
  )
  where recipient='s03-6@example.test';
  if v_count <> 0 then raise exception 'S03 reclaimed an ambiguous event outside provider window'; end if;
end
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.appointment_notification_jobs
    where recipient='s03-6@example.test'
      and state='failed_terminal'
      and delivery_certainty='ambiguous'
      and provider_message_id is null
      and last_error_class='idempotency_window_expired_ambiguous'
  ) then raise exception 'S03 provider-window expiry was not terminalized honestly'; end if;
end
$$;

-- v1 dispatcher RPCs are closed during migration-before-Worker deploy; only the
-- versioned surface is available through anon transport.
do $$
begin
  if has_function_privilege('anon','public.claim_notification_jobs(text,integer,integer)','execute') then
    raise exception 'S03 left v1 claim RPC executable by anon';
  end if;
  if not has_function_privilege('anon','public.claim_notification_jobs_v2(text,integer,integer)','execute') then
    raise exception 'S03 v2 claim RPC is not executable by anon';
  end if;
  if has_function_privilege('authenticated','public.lock_notification_request_v2(text,uuid,uuid,text,text,text)','execute') then
    raise exception 'S03 exposed dispatcher request lock to authenticated clients';
  end if;
end
$$;

rollback;
