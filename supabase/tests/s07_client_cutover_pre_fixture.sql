begin;

-- This command commits through the A-era implementation immediately before the
-- B cutover migration. The following test must still recover and exactly replay it.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '19000000-0000-4000-8000-000000000232','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s07-cutover-owner@example.test','',now(),'{}','{}',now(),now()
);
insert into public.businesses(id,name,slug,timezone,created_by) values (
  '4c000000-0000-4000-8000-000000000232','S07 Cutover Salon','s07-cutover-salon',
  'Europe/Istanbul','19000000-0000-4000-8000-000000000232'
);
insert into public.memberships(id,business_id,user_id,role,active) values (
  '5c000000-0000-4000-8000-000000000232','4c000000-0000-4000-8000-000000000232',
  '19000000-0000-4000-8000-000000000232','owner',true
);
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
) values (
  '6c000000-0000-4000-8000-000000000232','4c000000-0000-4000-8000-000000000232',
  'S07 Cutover Service',30,0,0,23200,'TRY'
);
insert into public.staff_profiles(id,business_id,name) values (
  '7c000000-0000-4000-8000-000000000232','4c000000-0000-4000-8000-000000000232',
  'S07 Cutover Staff'
);
insert into public.staff_services(business_id,staff_id,service_id,active) values (
  '4c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
  '6c000000-0000-4000-8000-000000000232',true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000232',true);
do $$
declare v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4c000000-0000-4000-8000-000000000232',extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
    extract(dow from v_day)::smallint,'[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4c000000-0000-4000-8000-000000000232',true,15,0,30
  );
end
$$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_appointment_id uuid;
begin
  select appointment_id into v_appointment_id
  from public.create_public_appointment_with_recovery(
    's07-cutover-salon','s07-cutover-v1-0001','S07 Cutover Existing',
    '6c000000-0000-4000-8000-000000000232','7c000000-0000-4000-8000-000000000232',
    (v_day + time '12:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000231','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000231',repeat('3',64),
    repeat('c',64),repeat('i',16),1::smallint,
    '+90 555 207 02 31','s07-cutover-existing@example.test',null
  );

  if v_appointment_id is null
     or (select count(*) from public.public_booking_recoveries
         where recovery_id='8c000000-0000-4000-8000-000000000231'
           and appointment_id=v_appointment_id) <> 1
     or (select count(*) from public.booking_commands
         where business_id='4c000000-0000-4000-8000-000000000232'
           and idempotency_key='s07-cutover-v1-0001'
           and command='public_create' and source='public'
           and appointment_id=v_appointment_id) <> 1
     or (select count(*) from public.appointment_management_capabilities
         where business_id='4c000000-0000-4000-8000-000000000232'
           and appointment_id=v_appointment_id) <> 1 then
    raise exception 'S07 cutover fixture did not create one atomic legacy command';
  end if;
end
$$;

commit;
