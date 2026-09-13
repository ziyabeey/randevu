begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '19000000-0000-4000-8000-000000000207','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s07-upgrade-owner@example.test','',now(),'{}','{}',now(),now()
);

insert into public.businesses(id,name,slug,timezone,created_by) values (
  '4c000000-0000-4000-8000-000000000207','S07 Upgrade Salon','s07-upgrade-salon',
  'Europe/Istanbul','19000000-0000-4000-8000-000000000207'
);
insert into public.memberships(id,business_id,user_id,role,active) values (
  '5c000000-0000-4000-8000-000000000207','4c000000-0000-4000-8000-000000000207',
  '19000000-0000-4000-8000-000000000207','owner',true
);
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
) values (
  '6c000000-0000-4000-8000-000000000207','4c000000-0000-4000-8000-000000000207',
  'S07 Upgrade Service',30,0,0,20700,'TRY'
);
insert into public.staff_profiles(id,business_id,name) values (
  '7c000000-0000-4000-8000-000000000207','4c000000-0000-4000-8000-000000000207',
  'S07 Upgrade Staff'
);
insert into public.staff_services(business_id,staff_id,service_id,active) values (
  '4c000000-0000-4000-8000-000000000207','7c000000-0000-4000-8000-000000000207',
  '6c000000-0000-4000-8000-000000000207',true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000207',true);
do $$
declare v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4c000000-0000-4000-8000-000000000207', extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4c000000-0000-4000-8000-000000000207','7c000000-0000-4000-8000-000000000207',
    extract(dow from v_day)::smallint,'[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4c000000-0000-4000-8000-000000000207',true,15,0,30
  );
end
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.create_public_appointment_with_recovery(
    's07-upgrade-salon','s07-v1-live-0001','S07 V1 Live',
    '6c000000-0000-4000-8000-000000000207','7c000000-0000-4000-8000-000000000207',
    (v_day + time '10:00') at time zone 'Europe/Istanbul',
    repeat('1',64),'8c000000-0000-4000-8000-000000000201',repeat('a',64),
    repeat('c',64),repeat('i',16),1::smallint,
    '+90 555 207 00 01','s07-v1-live@example.test',null
  );
  perform public.create_public_appointment_with_recovery(
    's07-upgrade-salon','s07-v1-scrub-001','S07 V1 Scrubbed',
    '6c000000-0000-4000-8000-000000000207','7c000000-0000-4000-8000-000000000207',
    (v_day + time '11:00') at time zone 'Europe/Istanbul',
    repeat('2',64),'8c000000-0000-4000-8000-000000000202',repeat('b',64),
    repeat('d',64),repeat('j',16),1::smallint,
    '+90 555 207 00 02','s07-v1-scrub@example.test',null
  );
end
$$;

update public.public_booking_recoveries
set recovery_secret_hash=null,
    management_token_ciphertext=null,
    management_token_iv=null,
    expires_at=now()-interval '1 second'
where recovery_id='8c000000-0000-4000-8000-000000000202';

do $$
begin
  if (select count(*) from public.appointments where business_id='4c000000-0000-4000-8000-000000000207') <> 2
     or (select count(*) from public.booking_commands where business_id='4c000000-0000-4000-8000-000000000207') <> 2
     or (select count(*) from public.appointment_notification_jobs where business_id='4c000000-0000-4000-8000-000000000207') <> 2 then
    raise exception 'S07 upgrade fixture did not preserve two atomic v1 commits';
  end if;
end
$$;

commit;
