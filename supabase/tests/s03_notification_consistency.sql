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

-- Independent public bookings give each lifecycle case its own event.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_index integer;
  v_start timestamptz;
begin
  for v_index in 1..16 loop
    v_start := (v_day + time '09:05') at time zone 'Europe/Istanbul'
      + make_interval(days => ((v_index - 1) / 8) * 7, hours => (v_index - 1) % 8);
    perform public.create_public_appointment_with_recovery(
      's03-frozen-salon',
      's03-create-000' || v_index,
      'S03 Müşteri ' || v_index,
      '6b000000-0000-4000-8000-000000000103',
      '7b000000-0000-4000-8000-000000000103',
      v_start,
      encode(digest('s03-management-' || v_index,'sha256'),'hex'),
      ('8b000000-0000-4000-8000-' || lpad((100 + v_index)::text,12,'0'))::uuid,
      encode(digest('s03-recovery-' || v_index,'sha256'),'hex'),
      'ciphertext-s03-' || v_index || '-abcdefghijklmnopqrstuvwxyz0123456789',
      'iv-s03-' || lpad(v_index::text,12,'0'),
      1::smallint,
      '+90 555 930 00 ' || lpad(v_index::text,2,'0'),
      's03-' || v_index || '@example.test',
      null
    );
  end loop;
end
$$;

do $$
begin
  if (select count(*) from public.appointment_notification_jobs
      where business_id='4b000000-0000-4000-8000-000000000103') <> 16 then
    raise exception 'S03 did not create sixteen notification events';
  end if;
  if exists (
    select 1 from public.appointment_notification_jobs j
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

-- Earlier F09 fixtures share yzt_test. They remain untouched outside this
-- rolled-back transaction, while S03 target claims are explicitly scheduled.
update public.appointment_notification_jobs
set state='failed_terminal',
    terminal_at=coalesce(terminal_at,now()),
    last_error_class='s03_test_isolation',
    lease_token=null,
    lease_expires_at=null,
    updated_at=now()
where business_id <> '4b000000-0000-4000-8000-000000000103'
  and state not in ('sent','failed_terminal');

update public.appointment_notification_jobs
set available_at=now()+interval '1 day'
where business_id='4b000000-0000-4000-8000-000000000103'
  and state in ('pending','retry_wait');

-- Live catalog edits must not alter the already-created event.
update public.businesses set name='S03 Live Salon Renamed'
where id='4b000000-0000-4000-8000-000000000103';
update public.staff_profiles set name='S03 Live Staff Renamed'
where id='7b000000-0000-4000-8000-000000000103';

-- First attempt and accepted-response-loss retry use the same frozen request.
update public.appointment_notification_jobs
set available_at=now()-interval '1 second'
where recipient='s03-1@example.test';

set local role anon;
do $$
declare
  v_claim record;
  v_state text;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',1,45
  );
  if v_claim.recipient <> 's03-1@example.test' then
    raise exception 'S03 first claim selected an unexpected event';
  end if;
  if v_claim.business_name_snapshot <> 'S03 Frozen Salon'
     or v_claim.staff_name_snapshot <> 'S03 Ayşe' then
    raise exception 'S03 claim read mutable live business/staff data';
  end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'Randevu <frozen@example.test>','https://frozen.example.test',repeat('a',64)
  );
  v_state := public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'resend_network_error',true,1,false
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
  v_permission jsonb;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',1,45
  );
  if v_claim.recipient <> 's03-1@example.test' then raise exception 'S03 retry claimed unexpected event'; end if;
  if v_claim.sender_snapshot <> 'Randevu <frozen@example.test>'
     or v_claim.origin_snapshot <> 'https://frozen.example.test'
     or v_claim.request_fingerprint <> repeat('a',64)
     or v_claim.business_name_snapshot <> 'S03 Frozen Salon' then
    raise exception 'S03 retry did not preserve frozen request inputs';
  end if;
  v_permission := public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    v_claim.sender_snapshot,v_claim.origin_snapshot,v_claim.request_fingerprint
  );
  perform public.complete_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,(v_permission->>'receipt_token')::uuid,
    'resend-s03-frozen-1',v_claim.request_fingerprint
  );
end
$$;
reset role;

-- A different request fingerprint under the same event/key is rejected.
update public.appointment_notification_jobs
set available_at=now()-interval '1 second'
where recipient='s03-2@example.test';

set local role anon;
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',1,45
  );
  if v_claim.recipient <> 's03-2@example.test' then raise exception 'S03 mismatch test claimed unexpected event'; end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'Randevu <frozen@example.test>','https://frozen.example.test',repeat('b',64)
  );
  begin
    perform public.lock_notification_request_v2(
      'sssssssssssssssssssssssssssssssssssssssssss',
      v_claim.job_id,v_claim.lease_token,
      'Randevu <changed@example.test>','https://changed.example.test',repeat('c',64)
    );
    raise exception 'S03 accepted a different request under the same provider key';
  exception when others then
    if sqlerrm='S03 accepted a different request under the same provider key' then raise; end if;
    if position('NOTIFICATION_REQUEST_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;
  perform public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'resend_validation_error',false,60,true
  );
end
$$;
reset role;

-- A definitely-unsent reschedule supersedes once and creates one versioned event.
do $$
declare
  v_appointment uuid;
  v_old_job uuid;
  v_old_start timestamptz;
begin
  select a.id,a.starts_at into v_appointment,v_old_start
  from public.appointments a where a.customer_email_snapshot='s03-3@example.test';
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
    where id=v_old_job and not is_current
      and state='failed_terminal' and last_error_class='superseded_before_send'
  ) then raise exception 'S03 old unsent event was not superseded'; end if;
  if (select count(*) from public.appointment_notification_jobs
      where appointment_id=v_appointment) <> 2 then
    raise exception 'S03 reschedule did not create exactly one replacement event';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where appointment_id=v_appointment and is_current
      and event_version=2 and event_reason='rescheduled'
      and starts_at_snapshot=v_old_start+interval '1 day'
      and provider_idempotency_key='public-booking-confirmation/' || event_id::text
  ) then raise exception 'S03 replacement event snapshot/version/key mismatch'; end if;
end
$$;

-- Keep the replacement out of the following targeted claim cases.
update public.appointment_notification_jobs
set available_at=now()+interval '1 day'
where recipient='s03-3@example.test' and is_current;

-- Cancellation stops an unsent event and does not create another confirmation.
do $$
declare
  v_appointment uuid;
begin
  select id into v_appointment
  from public.appointments where customer_email_snapshot='s03-4@example.test';
  update public.appointments
  set status='cancelled',cancelled_at=now(),cancellation_reason='S03 test'
  where id=v_appointment;

  if (select count(*) from public.appointment_notification_jobs
      where appointment_id=v_appointment) <> 1 then
    raise exception 'S03 cancel created a new confirmation';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where appointment_id=v_appointment and not is_current
      and state='failed_terminal' and last_error_class='cancelled_before_send'
  ) then raise exception 'S03 cancel did not stop the unsent event'; end if;
end
$$;

-- After send-start/ambiguous outcome, reschedule preserves evidence and creates no duplicate.
update public.appointment_notification_jobs
set available_at=now()-interval '1 second'
where recipient='s03-5@example.test';

set local role anon;
do $$
declare
  v_claim record;
  v_state text;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',1,45
  );
  if v_claim.recipient <> 's03-5@example.test' then raise exception 'S03 ambiguous test claimed unexpected event'; end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'Randevu <frozen@example.test>','https://frozen.example.test',repeat('d',64)
  );
  v_state := public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'resend_network_error',true,1,false
  );
  if v_state <> 'retry_wait' then raise exception 'S03 ambiguous event did not enter retry_wait'; end if;
end
$$;
reset role;

do $$
declare
  v_appointment uuid;
begin
  select id into v_appointment
  from public.appointments where customer_email_snapshot='s03-5@example.test';
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
    where appointment_id=v_appointment and not is_current
      and state='failed_terminal' and delivery_certainty='ambiguous'
      and last_error_class='rescheduled_after_attempt_needs_review'
  ) then raise exception 'S03 ambiguous reschedule was not preserved for review'; end if;
end
$$;

-- An unknown result outside Resend's 24-hour window is never reclaimed as sendable.
update public.appointment_notification_jobs
set available_at=now()-interval '1 second'
where recipient='s03-6@example.test';

set local role anon;
do $$
declare
  v_claim record;
begin
  select * into v_claim
  from public.claim_notification_jobs_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',1,45
  );
  if v_claim.recipient <> 's03-6@example.test' then raise exception 'S03 expiry test claimed unexpected event'; end if;
  perform public.lock_notification_request_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'Randevu <frozen@example.test>','https://frozen.example.test',repeat('e',64)
  );
  perform public.release_notification_job_v2(
    'sssssssssssssssssssssssssssssssssssssssssss',
    v_claim.job_id,v_claim.lease_token,
    'resend_network_error',true,1,false
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
    'sssssssssssssssssssssssssssssssssssssssssss',1,45
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

-- Only the versioned dispatcher transport remains public to the server-held secret.
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


-- Targeted lifecycle/send boundaries. Helpers exist only in this rolled-back test.
create function pg_temp.s03_claim(p_index integer)
returns public.appointment_notification_jobs language plpgsql as $$
declare v_job public.appointment_notification_jobs;
begin
  update public.appointment_notification_jobs set available_at=now()-interval '1 second'
  where recipient='s03-' || p_index || '@example.test' and is_current;
  perform public.claim_notification_jobs_v2(repeat('s',43),1,45);
  select * into strict v_job from public.appointment_notification_jobs
  where recipient='s03-' || p_index || '@example.test' and is_current;
  if v_job.state <> 'leased' then raise exception 'S03 target was not claimed: %',p_index; end if;
  return v_job;
end $$;

create function pg_temp.s03_gate(p_job public.appointment_notification_jobs)
returns jsonb language sql as $$
  select public.lock_notification_request_v2(repeat('s',43),p_job.id,p_job.lease_token,
    'Sender <sender@example.test>','https://sender.example.test',repeat('f',64));
$$;

create function pg_temp.s03_move(p_id uuid)
returns void language sql as $$
  update public.appointments set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day',
    occupied_starts_at=occupied_starts_at+interval '1 day',occupied_ends_at=occupied_ends_at+interval '1 day'
  where id=p_id;
$$;

do $$
declare v_job public.appointment_notification_jobs; v_gate jsonb; v_second jsonb; v_index integer;
begin
  v_job := pg_temp.s03_claim(7);
  update public.appointment_notification_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_job.id;
  begin
    perform pg_temp.s03_gate(v_job);
    raise exception 'S03 expired lease was allowed to send';
  exception when others then
    if sqlerrm <> 'NOTIFICATION_LEASE_EXPIRED' then raise; end if;
  end;
  update public.appointment_notification_jobs set state='failed_terminal',lease_token=null,lease_expires_at=null where id=v_job.id;

  -- An earlier possibly accepted request cannot become safe after a later 401/422.
  v_job := pg_temp.s03_claim(8);
  v_gate := pg_temp.s03_gate(v_job);
  perform public.release_notification_job_v2(repeat('s',43),v_job.id,v_job.lease_token,'resend_network_error',true,1,false);
  v_job := pg_temp.s03_claim(8);
  perform pg_temp.s03_gate(v_job);
  perform public.release_notification_job_v2(repeat('s',43),v_job.id,v_job.lease_token,'resend_http_401',false,1,true);
  perform pg_temp.s03_move(v_job.appointment_id);
  if (select count(*) from public.appointment_notification_jobs where appointment_id=v_job.appointment_id) <> 1
     or not exists (select 1 from public.appointment_notification_jobs where id=v_job.id
       and delivery_certainty='ambiguous' and has_ambiguous_history and not is_current) then
    raise exception 'S03 later rejection erased earlier ambiguity or created a duplicate';
  end if;

  -- A first, definitely rejected attempt is still safe to replace.
  v_job := pg_temp.s03_claim(9);
  perform pg_temp.s03_gate(v_job);
  perform public.release_notification_job_v2(repeat('s',43),v_job.id,v_job.lease_token,'resend_http_422',false,1,true);
  perform pg_temp.s03_move(v_job.appointment_id);
  if (select count(*) from public.appointment_notification_jobs where appointment_id=v_job.appointment_id) <> 2 then
    raise exception 'S03 first definite rejection did not allow safe replacement';
  end if;
  update public.appointment_notification_jobs set available_at=now()+interval '1 day' where appointment_id=v_job.appointment_id;

  -- A retried rejected job becomes ambiguous again before external HTTP starts.
  v_job := pg_temp.s03_claim(10);
  perform pg_temp.s03_gate(v_job);
  perform public.release_notification_job_v2(repeat('s',43),v_job.id,v_job.lease_token,'test_definite_retry',true,1,true);
  v_job := pg_temp.s03_claim(10);
  v_gate := pg_temp.s03_gate(v_job);
  if not exists (select 1 from public.appointment_notification_jobs where id=v_job.id and delivery_certainty='ambiguous') then
    raise exception 'S03 retry remained replacement-safe while provider request was in flight';
  end if;
  perform pg_temp.s03_move(v_job.appointment_id);
  perform public.complete_notification_job_v2(repeat('s',43),v_job.id,(v_gate->>'receipt_token')::uuid,'late-after-move',repeat('f',64));
  if (select count(*) from public.appointment_notification_jobs where appointment_id=v_job.appointment_id) <> 1
     or not exists (select 1 from public.appointment_notification_jobs where id=v_job.id and not is_current
       and state='sent' and provider_message_id='late-after-move') then
    raise exception 'S03 late reschedule receipt was lost or reactivated';
  end if;

  -- Enough time for the bounded provider call must remain before every deadline.
  v_job := pg_temp.s03_claim(11);
  update public.appointment_notification_jobs set retry_until=clock_timestamp()+interval '5 seconds' where id=v_job.id;
  begin
    perform pg_temp.s03_gate(v_job);
    raise exception 'S03 insufficient send budget was allowed';
  exception when others then
    if sqlerrm <> 'NOTIFICATION_SEND_BUDGET_EXHAUSTED' then raise; end if;
  end;
  update public.appointment_notification_jobs set state='failed_terminal',lease_token=null,lease_expires_at=null where id=v_job.id;

  -- Receipt proof survives cancellation; a lease token cannot forge completion.
  v_job := pg_temp.s03_claim(12);
  begin
    perform public.complete_notification_job_v2(repeat('s',43),v_job.id,v_job.lease_token,'forged-before-send',repeat('f',64));
    raise exception 'S03 lease alone forged a send receipt';
  exception when others then
    if sqlerrm <> 'NOTIFICATION_LEASE_LOST' then raise; end if;
  end;
  v_gate := pg_temp.s03_gate(v_job);
  update public.appointments set status='cancelled',cancelled_at=now() where id=v_job.appointment_id;
  perform public.complete_notification_job_v2(repeat('s',43),v_job.id,(v_gate->>'receipt_token')::uuid,'late-after-cancel',repeat('f',64));
  if not exists (select 1 from public.appointment_notification_jobs where id=v_job.id and not is_current
    and state='sent' and provider_message_id='late-after-cancel' and superseded_reason='cancelled_after_attempt') then
    raise exception 'S03 late cancel receipt was lost or reactivated';
  end if;

  for v_index in 13..14 loop
    v_job := pg_temp.s03_claim(v_index);
    update public.appointments set status=case v_index when 13 then 'completed' else 'no_show' end where id=v_job.appointment_id;
    if not exists (select 1 from public.appointment_notification_jobs where id=v_job.id and not is_current and state='failed_terminal') then
      raise exception 'S03 inactive appointment retained a sendable confirmation';
    end if;
  end loop;

  -- A starts, its lease expires, B starts, then A returns a real receipt.
  v_job := pg_temp.s03_claim(15);
  v_gate := pg_temp.s03_gate(v_job);
  update public.appointment_notification_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=v_job.id;
  v_job := pg_temp.s03_claim(15);
  v_second := pg_temp.s03_gate(v_job);
  if v_gate->>'receipt_token' is distinct from v_second->>'receipt_token' then
    raise exception 'S03 reclamation replaced stable request receipt proof';
  end if;
  perform public.complete_notification_job_v2(repeat('s',43),v_job.id,(v_gate->>'receipt_token')::uuid,'accepted-by-A',repeat('f',64));
  perform public.complete_notification_job_v2(repeat('s',43),v_job.id,(v_second->>'receipt_token')::uuid,'accepted-by-A',repeat('f',64));
  if not exists (select 1 from public.appointment_notification_jobs where id=v_job.id and state='sent' and delivery_certainty='accepted') then
    raise exception 'S03 old attempt receipt was lost after reclaim';
  end if;
  begin
    perform public.complete_notification_job_v2(repeat('s',43),v_job.id,(v_gate->>'receipt_token')::uuid,'conflicting-id',repeat('f',64));
    raise exception 'S03 overwrote a real provider receipt';
  exception when others then
    if sqlerrm <> 'NOTIFICATION_LEASE_LOST' then raise; end if;
  end;

  v_job := pg_temp.s03_claim(16);
  update public.appointments set status='cancelled',cancelled_at=now() where id=v_job.appointment_id;
  begin
    perform pg_temp.s03_gate(v_job);
    raise exception 'S03 cancellation between claim and gate still sent';
  exception when others then
    if sqlerrm <> 'NOTIFICATION_LEASE_LOST' then raise; end if;
  end;
end $$;

rollback;
