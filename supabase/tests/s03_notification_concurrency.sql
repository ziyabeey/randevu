create extension if not exists dblink;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000105','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s03-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000105','S03 Frozen Salon','s03-race-salon','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000105'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000105','4b000000-0000-4000-8000-000000000105',
  '19000000-0000-4000-8000-000000000105','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000105','4b000000-0000-4000-8000-000000000105',
  'S03 Hizmeti',30,5,5,210000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000105','4b000000-0000-4000-8000-000000000105','S03 Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000105','7b000000-0000-4000-8000-000000000105',
  '6b000000-0000-4000-8000-000000000105',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000105',false);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000105',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000105',
    '7b000000-0000-4000-8000-000000000105',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000105', true, 15, 0, 30
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
  for v_index in 1..4 loop
    v_start := (v_day + time '09:05') at time zone 'Europe/Istanbul'
      + make_interval(days => ((v_index - 1) / 8) * 7, hours => (v_index - 1) % 8);
    perform public.create_public_appointment_with_recovery(
      's03-race-salon',
      's03-create-000' || v_index,
      'S03 Müşteri ' || v_index,
      '6b000000-0000-4000-8000-000000000105',
      '7b000000-0000-4000-8000-000000000105',
      v_start,
      encode(digest(repeat(chr(96 + v_index),43),'sha256'),'hex'),
      ('8b000000-0000-4000-8000-' || lpad((500 + v_index)::text,12,'0'))::uuid,
      encode(digest(repeat(chr(102 + v_index),43),'sha256'),'hex'),
      'ciphertext-s03-' || v_index || '-abcdefghijklmnopqrstuvwxyz0123456789',
      'iv-s03-' || lpad(v_index::text,12,'0'),
      1::smallint,
      '+90 555 930 00 ' || lpad(v_index::text,2,'0'),
      's03-race-' || v_index || '@example.test',
      null
    );
  end loop;
end
$$;

-- Only these ephemeral fixtures may be claimed by the two CI sessions.
update public.appointment_notification_jobs
set state='failed_terminal',lease_token=null,lease_expires_at=null
where business_id <> '4b000000-0000-4000-8000-000000000105' and state not in ('sent','failed_terminal');
create temp table s03_race_claims as
select c.job_id,c.lease_token from public.claim_notification_jobs_v2(repeat('s',43),4,300) c;

-- Test-only wrappers return exact failures across dblink and bound all waits.
create function public._s03_try_gate(p_id uuid,p_lease uuid) returns text language plpgsql as $$
begin
  return public.lock_notification_request_v2(repeat('s',43),p_id,p_lease,
    'Race <race@example.test>','https://race.example.test',repeat('a',64))::text;
exception when others then return sqlerrm;
end $$;
create function pg_temp.s03_wait_for_lock() returns void language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where application_name='s03_b' and wait_event_type='Lock') then return; end if;
    perform pg_sleep(0.02);
  end loop;
  raise exception 'S03 concurrent operation never blocked at the appointment lock';
end $$;

do $$
declare
  v_job public.appointment_notification_jobs;
  v_gate jsonb;
  v_result text;
  v_case integer;
begin
  for v_case in 1..3 loop
    select * into strict v_job from public.appointment_notification_jobs
    where recipient='s03-race-' || v_case || '@example.test';
    perform dblink_connect('s03_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s03_a');
    perform dblink_connect('s03_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s03_b');
    perform dblink_exec('s03_a','set statement_timeout=5000');
    perform dblink_exec('s03_b','set statement_timeout=5000');
    perform dblink_exec('s03_a','begin');

    if v_case=1 then
      -- Cancellation owns appointment and job before the send decision.
      perform dblink_exec('s03_a',format('update public.appointments set status=''cancelled'',cancelled_at=now() where id=%L',v_job.appointment_id));
      perform dblink_send_query('s03_b',format('select public._s03_try_gate(%L,%L)',v_job.id,v_job.lease_token));
      perform pg_temp.s03_wait_for_lock();
      perform dblink_exec('s03_a','commit');
      select result into v_result from dblink_get_result('s03_b') as t(result text);
      if v_result <> 'NOTIFICATION_LEASE_LOST' then raise exception 'S03 cancel-first allowed send: %',v_result; end if;
    elsif v_case=2 then
      -- Send decision wins; concurrent cancellation must wait, then supersede.
      select result::jsonb into v_gate from dblink('s03_a',format('select public._s03_try_gate(%L,%L)',v_job.id,v_job.lease_token)) as t(result text);
      perform dblink_send_query('s03_b',format('update public.appointments set status=''cancelled'',cancelled_at=now() where id=%L returning id::text',v_job.appointment_id));
      perform pg_temp.s03_wait_for_lock();
      perform dblink_exec('s03_a','commit');
      select result into v_result from dblink_get_result('s03_b') as t(result text);
      perform public.complete_notification_job_v2(repeat('s',43),v_job.id,(v_gate->>'receipt_token')::uuid,'s03-concurrent-accepted',repeat('a',64));
      if not exists (select 1 from public.appointment_notification_jobs where id=v_job.id and not is_current and state='sent') then
        raise exception 'S03 send-first cancellation lost acceptance or reactivated event';
      end if;
      if (select count(*) from public.appointment_notification_jobs where appointment_id=v_job.appointment_id) <> 1 then
        raise exception 'S03 send-first cancellation created another event';
      end if;
    else
      -- The RPC starts before expiry but blocks until after expiry. now() would
      -- incorrectly accept it; the post-lock wall-clock check must reject it.
      perform dblink_exec('s03_b',format('update public.appointment_notification_jobs set lease_expires_at=clock_timestamp()+interval ''1 second'' where id=%L',v_job.id));
      perform dblink_exec('s03_a',format('update public.appointments set updated_at=updated_at where id=%L',v_job.appointment_id));
      perform dblink_send_query('s03_b',format('select public._s03_try_gate(%L,%L)',v_job.id,v_job.lease_token));
      perform pg_temp.s03_wait_for_lock();
      perform pg_sleep(1.1);
      perform dblink_exec('s03_a','commit');
      select result into v_result from dblink_get_result('s03_b') as t(result text);
      if v_result <> 'NOTIFICATION_LEASE_EXPIRED' then raise exception 'S03 lock wait reused expired lease: %',v_result; end if;
    end if;
    perform dblink_disconnect('s03_a');
    perform dblink_disconnect('s03_b');
  end loop;
exception when others then
  begin perform dblink_disconnect('s03_a'); exception when others then null; end;
  begin perform dblink_disconnect('s03_b'); exception when others then null; end;
  raise;
end $$;

-- Two dispatchers must still SKIP LOCKED under v2 rather than duplicate a claim.
update public.appointment_notification_jobs set state='failed_terminal',lease_token=null,lease_expires_at=null
where recipient='s03-race-3@example.test';
update public.appointment_notification_jobs set state='pending',lease_token=null,lease_expires_at=null,available_at=now()
where recipient='s03-race-4@example.test';
do $$
declare v_first bigint; v_second bigint;
begin
  perform dblink_connect('s03_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres');
  perform dblink_connect('s03_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres');
  perform dblink_exec('s03_b','set statement_timeout=2000');
  perform dblink_exec('s03_a','begin');
  select n into v_first from dblink('s03_a','select count(*) from public.claim_notification_jobs_v2(repeat(''s'',43),1,45)') as t(n bigint);
  select n into v_second from dblink('s03_b','select count(*) from public.claim_notification_jobs_v2(repeat(''s'',43),1,45)') as t(n bigint);
  if v_first <> 1 or v_second <> 0 then raise exception 'S03 concurrent claims duplicated a job: %, %',v_first,v_second; end if;
  perform dblink_exec('s03_a','commit');
  perform dblink_disconnect('s03_a');
  perform dblink_disconnect('s03_b');
exception when others then
  begin perform dblink_disconnect('s03_a'); exception when others then null; end;
  begin perform dblink_disconnect('s03_b'); exception when others then null; end;
  raise;
end $$;
drop function public._s03_try_gate(uuid,uuid);
