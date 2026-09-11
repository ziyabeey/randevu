insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase9-upgrade-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000005','Notification Upgrade','notification-upgrade','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000005'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000005','4b000000-0000-4000-8000-000000000005',
  '19000000-0000-4000-8000-000000000005','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000005','4b000000-0000-4000-8000-000000000005',
  'Upgrade Hizmeti',30,5,5,230000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000005','4b000000-0000-4000-8000-000000000005','Upgrade Ece'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000005','7b000000-0000-4000-8000-000000000005',
  '6b000000-0000-4000-8000-000000000005',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000005',false);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000005',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000005',
    '7b000000-0000-4000-8000-000000000005',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000005', true, 15, 0, 30
  );
end
$$;

reset role;
set role anon;
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '14:05') at time zone 'Europe/Istanbul';
begin
  perform public.create_public_appointment_with_recovery(
    'notification-upgrade','phase9-upgrade-0001','Upgrade Müşteri',
    '6b000000-0000-4000-8000-000000000005','7b000000-0000-4000-8000-000000000005',
    v_start,
    encode(digest('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq','sha256'),'hex'),
    '8b000000-0000-4000-8000-000000000007',
    encode(digest('rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr','sha256'),'hex'),
    'ciphertext-upgrade-abcdefghijklmnopqrstuvwxyz01234567','iv-upgrade-12345',1::smallint,
    '+90 555 900 00 14','upgrade@example.test',null
  );
end
$$;
reset role;
