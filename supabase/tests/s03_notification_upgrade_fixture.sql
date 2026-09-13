insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000104','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s03-upgrade-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000104','S03 Upgrade Salon','s03-upgrade-salon','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000104'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000104','4b000000-0000-4000-8000-000000000104',
  '19000000-0000-4000-8000-000000000104','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000104','4b000000-0000-4000-8000-000000000104',
  'S03 Upgrade Hizmeti',30,5,5,240000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000104','4b000000-0000-4000-8000-000000000104','S03 Upgrade Ece'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000104','7b000000-0000-4000-8000-000000000104',
  '6b000000-0000-4000-8000-000000000104',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000104',false);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 14;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000104',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000104',
    '7b000000-0000-4000-8000-000000000104',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000104', true, 15, 0, 30
  );
end
$$;
reset role;

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 14;
  v_index integer;
  v_start timestamptz;
begin
  for v_index in 1..8 loop
    v_start := (v_day + time '09:05') at time zone 'Europe/Istanbul'
      + make_interval(hours => v_index - 1);
    perform public.create_public_appointment_with_recovery(
      's03-upgrade-salon',
      's03-upgrade-000' || v_index,
      'S03 Upgrade ' || v_index,
      '6b000000-0000-4000-8000-000000000104',
      '7b000000-0000-4000-8000-000000000104',
      v_start,
      encode(digest(repeat(chr(106 + v_index),43),'sha256'),'hex'),
      ('8b000000-0000-4000-8000-' || lpad((200 + v_index)::text,12,'0'))::uuid,
      encode(digest(repeat(chr(112 + v_index),43),'sha256'),'hex'),
      'ciphertext-s03-upgrade-' || v_index || '-abcdefghijklmnopqrstuvwxyz0123',
      'iv-s03-up-' || lpad(v_index::text,10,'0'),
      1::smallint,
      '+90 555 940 00 ' || lpad(v_index::text,2,'0'),
      's03-upgrade-' || v_index || '@example.test',
      null
    );
  end loop;
end
$$;

update public.appointment_notification_jobs
set state='retry_wait',
    attempt_count=1,
    last_attempt_at=now()-interval '1 hour',
    last_error_class='resend_network_error',
    available_at=now()+interval '1 minute'
where recipient='s03-upgrade-2@example.test';

update public.appointment_notification_jobs
set state='leased',
    attempt_count=1,
    last_attempt_at=now()-interval '30 minutes',
    lease_token='aa000000-0000-4000-8000-000000000204',
    lease_expires_at=now()+interval '5 minutes'
where recipient='s03-upgrade-3@example.test';

update public.appointment_notification_jobs
set state='sent',
    attempt_count=1,
    last_attempt_at=now()-interval '2 hours',
    provider_message_id='legacy-sent-s03-4',
    sent_at=now()-interval '2 hours',
    terminal_at=now()-interval '2 hours'
where recipient='s03-upgrade-4@example.test';

update public.appointment_notification_jobs
set state='failed_terminal',
    attempt_count=1,
    last_attempt_at=now()-interval '3 hours',
    last_error_class='legacy_validation_error',
    terminal_at=now()-interval '3 hours'
where recipient='s03-upgrade-5@example.test';

-- Inactive legacy appointments still have unsent jobs under the old schema.
update public.appointments
set status='cancelled', cancelled_at=now()
where customer_email_snapshot='s03-upgrade-6@example.test';
update public.appointments set status='completed'
where customer_email_snapshot='s03-upgrade-7@example.test';
update public.appointments set status='no_show'
where customer_email_snapshot='s03-upgrade-8@example.test';
