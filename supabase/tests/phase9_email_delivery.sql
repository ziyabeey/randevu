begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase9-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '49100000-0000-4000-8000-000000000001','Mail Test','mail-test','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '59100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001',
  '19000000-0000-4000-8000-000000000001','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '69100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001',
  'Mail Hizmeti',30,0,0,125000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '79100000-0000-4000-8000-000000000001','49100000-0000-4000-8000-000000000001','Mail Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '49100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000001',
  '69100000-0000-4000-8000-000000000001',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '49100000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '49100000-0000-4000-8000-000000000001',
    '79100000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '49100000-0000-4000-8000-000000000001', true, 15, 0, 30
  );
end
$$;

select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:00') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_row record;
begin
  select appointment_id into v_id
  from public.create_public_appointment(
    'mail-test','phase9-create-0001','Mail Müşteri',
    '69100000-0000-4000-8000-000000000001','79100000-0000-4000-8000-000000000001',
    v_start,'+90 555 900 00 01','phase9-customer@example.test',null
  );

  if v_id is null then raise exception 'phase9 public booking was not created'; end if;

  select * into v_row
  from public.get_public_booking_email_payload(v_id,'phase9-create-0001');

  if v_row.customer_email <> 'phase9-customer@example.test' then
    raise exception 'notification payload returned wrong customer email';
  end if;
  if v_row.business_name <> 'Mail Test' or v_row.service_name <> 'Mail Hizmeti' then
    raise exception 'notification payload snapshots are wrong';
  end if;
  if v_row.already_delivered then
    raise exception 'fresh booking incorrectly marked delivered';
  end if;

  begin
    perform public.get_public_booking_email_payload(v_id,'wrong-key-0001');
    raise exception 'wrong booking proof resolved notification payload';
  exception when others then
    if sqlerrm = 'wrong booking proof resolved notification payload' then raise; end if;
    if position('INVALID_NOTIFICATION_BOOTSTRAP' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform count(*) from public.appointment_notification_deliveries;
    raise exception 'anon can read notification delivery table directly';
  exception when insufficient_privilege then null;
  end;

  if not public.record_public_booking_email_delivery(
    v_id,'phase9-create-0001','resend-phase9-message-0001'
  ) then
    raise exception 'notification receipt was not recorded';
  end if;

  select * into v_row
  from public.get_public_booking_email_payload(v_id,'phase9-create-0001');
  if not v_row.already_delivered then
    raise exception 'recorded notification was not reported as delivered';
  end if;

  -- Idempotent receipt recording must not create a second row.
  perform public.record_public_booking_email_delivery(
    v_id,'phase9-create-0001','resend-phase9-message-0001'
  );
end
$$;

reset role;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.appointment_notification_deliveries
  where appointment_id in (
    select appointment_id from public.booking_commands
    where idempotency_key='phase9-create-0001'
  );
  if v_count <> 1 then
    raise exception 'expected exactly one durable delivery receipt, saw %', v_count;
  end if;

  if exists (
    select 1 from public.appointment_notification_deliveries
    where recipient like '%/m#%'
       or provider_message_id like '%/m#%'
  ) then
    raise exception 'management capability leaked into delivery receipt';
  end if;
end
$$;

rollback;
