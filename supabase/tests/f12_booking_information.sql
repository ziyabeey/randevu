begin;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values(
  'f1250000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','f12-info-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values(
  'f1251000-0000-4000-8000-000000000001','F12 Bilgi Salon','f12-info-salon','Europe/Istanbul',
  'f1250000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values(
  'f1252000-0000-4000-8000-000000000001','f1251000-0000-4000-8000-000000000001',
  'f1250000-0000-4000-8000-000000000001','owner',true
)
on conflict(business_id,user_id) do update set active=true,role='owner';

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active
)
values(
  'f1253000-0000-4000-8000-000000000001','f1251000-0000-4000-8000-000000000001',
  'Bilgi Hizmeti',30,0,0,10000,'TRY',true
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values(
  'f1254000-0000-4000-8000-000000000001','f1251000-0000-4000-8000-000000000001','Bilgi Usta',true
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values(
  'f1251000-0000-4000-8000-000000000001','f1254000-0000-4000-8000-000000000001',
  'f1253000-0000-4000-8000-000000000001',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

do $$
declare v_day date:=date_trunc('week',current_date)::date+7; v_dow smallint;
begin
  v_dow:=extract(dow from v_day)::smallint;
  insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
  values('f1255000-0000-4000-8000-000000000001','f1251000-0000-4000-8000-000000000001',v_dow,'09:00','17:00',true);
  insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
  values('f1256000-0000-4000-8000-000000000001','f1251000-0000-4000-8000-000000000001',
         'f1254000-0000-4000-8000-000000000001',v_dow,'09:00','17:00',true);
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1250000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('f1251000-0000-4000-8000-000000000001');
  if r.publishable or not ('PUBLIC_CONTACT_REQUIRED'=any(r.missing_reasons)) then
    raise exception 'public booking became publishable without a support contact';
  end if;
  begin
    perform public.update_public_booking_settings('f1251000-0000-4000-8000-000000000001',true,15,0,30);
    raise exception 'public booking enabled without a support contact';
  exception when others then
    if sqlerrm='public booking enabled without a support contact' then raise; end if;
    if position('PUBLIC_BOOKING_NOT_READY' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

select * from public.update_business_public_profile(
  'f1251000-0000-4000-8000-000000000001',
  'F12 Bilgi Salon','Bilgilendirme sözleşmesi fixture',null,
  '+905550001122','destek@f12.example.test','https://f12.example.test',
  '+905550001122','İstanbul',true,null
);
select * from public.update_public_booking_settings(
  'f1251000-0000-4000-8000-000000000001',true,15,0,30
);

do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('f1251000-0000-4000-8000-000000000001');
  if not r.publishable or cardinality(r.missing_reasons)<>0 then
    raise exception 'real support contact did not satisfy public readiness';
  end if;
end
$$;

reset role;

do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_token text:='F12informationSupportToken__________________';
  v_managed record;
begin
  select appointment_id into v_id
  from public.create_public_appointment(
    'f12-info-salon','f12-info-create-0001','Bilgi Müşteri',
    'f1253000-0000-4000-8000-000000000001','f1254000-0000-4000-8000-000000000001',
    v_start,'05550001122',null,null
  );
  if v_id is null then raise exception 'F12 information fixture booking missing'; end if;
  if not public.provision_public_management_token(v_id,'f12-info-create-0001',v_token) then
    raise exception 'F12 information management capability missing';
  end if;
  select * into strict v_managed from public.get_public_managed_appointment(v_token);
  if v_managed.support_slug<>'f12-info-salon'
     or v_managed.support_phone<>'+905550001122'
     or v_managed.support_email<>'destek@f12.example.test'
     or v_managed.support_whatsapp<>'+905550001122'
     or v_managed.support_website<>'https://f12.example.test'
     or v_managed.support_address<>'İstanbul' then
    raise exception 'management view lost public support contact';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1250000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
begin
  begin
    perform public.update_business_public_profile(
      'f1251000-0000-4000-8000-000000000001',
      'F12 Bilgi Salon',null,null,null,null,'https://f12.example.test',null,'İstanbul',true,null
    );
    raise exception 'all direct support contacts were cleared while public booking remained live';
  exception when others then
    if sqlerrm='all direct support contacts were cleared while public booking remained live' then raise; end if;
    if position('PUBLIC_CONTACT_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;
do $$
begin
  if has_function_privilege('anon','public.get_public_managed_appointment(text)','EXECUTE')
     or has_function_privilege('authenticated','public.get_public_managed_appointment(text)','EXECUTE') then
    raise exception 'F12 information repair reopened raw management RPC';
  end if;
end
$$;

rollback;
