begin;

create or replace function pg_temp.f12_notification_v2_key(
  p_recovery_id uuid,
  p_deadline bigint,
  p_secret_hash text
)
returns text
language sql
immutable
set search_path=pg_catalog,extensions
as $f12$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_secret_hash,'UTF8'),'sha256'),'hex');
$f12$;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
values(
  'f1260000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','f12-notification-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values(
  'f1261000-0000-4000-8000-000000000001','F12 Notification Salon','f12-notification-salon','Europe/Istanbul',
  'f1260000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values(
  'f1262000-0000-4000-8000-000000000001','f1261000-0000-4000-8000-000000000001',
  'f1260000-0000-4000-8000-000000000001','owner',true
)
on conflict(business_id,user_id) do update set active=true,role='owner';

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active
)
values(
  'f1263000-0000-4000-8000-000000000001','f1261000-0000-4000-8000-000000000001',
  'Notification Status',30,0,0,15000,'TRY',true
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values(
  'f1264000-0000-4000-8000-000000000001','f1261000-0000-4000-8000-000000000001','Status Usta',true
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values(
  'f1261000-0000-4000-8000-000000000001','f1264000-0000-4000-8000-000000000001',
  'f1263000-0000-4000-8000-000000000001',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

do $$
declare v_day date:=date_trunc('week',current_date)::date+7; v_dow smallint;
begin
  v_dow:=extract(dow from v_day)::smallint;
  insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
  values('f1265000-0000-4000-8000-000000000001','f1261000-0000-4000-8000-000000000001',v_dow,'09:00','17:00',true);
  insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
  values('f1266000-0000-4000-8000-000000000001','f1261000-0000-4000-8000-000000000001',
         'f1264000-0000-4000-8000-000000000001',v_dow,'09:00','17:00',true);
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1260000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select * from public.update_business_public_profile(
  'f1261000-0000-4000-8000-000000000001','F12 Notification Salon',null,null,
  '+905550006600','status@f12.example.test','https://status.f12.example.test',
  null,'İstanbul',true,null
);
select * from public.update_business_public_information(
  'f1261000-0000-4000-8000-000000000001',
  'F12 notification test aydınlatma metni.',null,
  'https://status.f12.example.test/privacy',
  'F12 notification test rezervasyon koşulları.',null
);
select * from public.update_public_booking_settings(
  'f1261000-0000-4000-8000-000000000001',true,15,0,30
);
reset role;

insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values('default',encode(digest(repeat('g',43),'sha256'),'hex'))
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash,updated_at=now();

do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_status jsonb;
  v_token text:=repeat('m',43);
  v_recovery uuid:='f1268000-0000-4000-8000-000000000001';
  v_secret_hash text:=encode(digest(repeat('r',43),'sha256'),'hex');
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_key text;
begin
  v_key:=pg_temp.f12_notification_v2_key(v_recovery,v_deadline,v_secret_hash);
  select appointment_id into v_id
  from public.create_public_appointment_with_recovery(
    'f12-notification-salon',v_key,'Mail Müşteri',
    'f1263000-0000-4000-8000-000000000001','f1264000-0000-4000-8000-000000000001',
    v_start,public.management_token_hash(v_token),
    v_recovery,
    v_secret_hash,
    repeat('c',48),repeat('i',24),1::smallint,
    '05550006600','mail-status@example.test',null
  );
  if v_id is null then raise exception 'F12 notification appointment missing'; end if;
  perform set_config('f12.notification.appointment',v_id::text,true);
  perform set_config('f12.notification.token',v_token,true);
  v_status:=public.f12_customer_notification_status(v_id);
  if v_status<>jsonb_build_object('channel','email','status','queued') then
    raise exception 'queued projection mismatch: %',v_status;
  end if;
  if (v_status-'channel'-'status')<>'{}'::jsonb then raise exception 'projection leaked extra fields'; end if;
end
$$;

do $$
declare v_id uuid:=current_setting('f12.notification.appointment')::uuid;
begin
  update public.appointment_notification_jobs
  set state='leased',lease_token='f1269000-0000-4000-8000-000000000001',
      lease_expires_at=now()+interval '5 minutes',delivery_certainty='unattempted'
  where appointment_id=v_id and is_current;
  if public.f12_customer_notification_status(v_id)#>>'{status}'<>'sending' then
    raise exception 'leased projection not sending';
  end if;

  update public.appointment_notification_jobs
  set state='sent',provider_message_id='f12-provider-accepted',sent_at=now(),terminal_at=now(),
      lease_token=null,lease_expires_at=null,delivery_certainty='accepted'
  where appointment_id=v_id and is_current;
  if public.f12_customer_notification_status(v_id)#>>'{status}'<>'accepted' then
    raise exception 'accepted projection mismatch';
  end if;

  update public.appointment_notification_jobs
  set state='failed_terminal',provider_message_id=null,delivery_certainty='rejected',terminal_at=now()
  where appointment_id=v_id and is_current;
  if public.f12_customer_notification_status(v_id)#>>'{status}'<>'failed' then
    raise exception 'rejected terminal projection mismatch';
  end if;

  update public.appointment_notification_jobs set delivery_certainty='ambiguous'
  where appointment_id=v_id and is_current;
  if public.f12_customer_notification_status(v_id)#>>'{status}'<>'unknown' then
    raise exception 'ambiguous projection mismatch';
  end if;

  update public.appointment_notification_jobs set is_current=false
  where appointment_id=v_id and is_current;
  if public.f12_customer_notification_status(v_id)#>>'{status}'<>'unknown' then
    raise exception 'stale event treated as current';
  end if;
end
$$;

do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '11:00') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_recovery uuid:='f1268000-0000-4000-8000-000000000002';
  v_secret_hash text:=encode(digest(repeat('s',43),'sha256'),'hex');
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_key text;
begin
  v_key:=pg_temp.f12_notification_v2_key(v_recovery,v_deadline,v_secret_hash);
  select appointment_id into v_id
  from public.create_public_appointment_with_recovery(
    'f12-notification-salon',v_key,'Telefon Müşteri',
    'f1263000-0000-4000-8000-000000000001','f1264000-0000-4000-8000-000000000001',
    v_start,public.management_token_hash(repeat('n',43)),
    v_recovery,
    v_secret_hash,
    repeat('d',48),repeat('j',24),1::smallint,
    '05550006601',null,null
  );
  if public.f12_customer_notification_status(v_id)<>jsonb_build_object('channel','email','status','not_requested') then
    raise exception 'phone-only projection mismatch';
  end if;
  if public.f12_customer_notification_status('f1267000-0000-4000-8000-000000000099')
     <>jsonb_build_object('channel','email','status','unknown') then
    raise exception 'unknown appointment leaked existence';
  end if;
end
$$;

do $$
begin
  if has_function_privilege('anon','public.f12_customer_notification_status(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.f12_customer_notification_status(uuid)','EXECUTE') then
    raise exception 'internal notification helper became executable';
  end if;
end
$$;

set local role anon;
do $$
declare v_payload jsonb;
begin
  v_payload:=public.execute_public_operation(
    'manage_view',
    jsonb_build_object('p_token',current_setting('f12.notification.token')),
    repeat('g',43),repeat('a',64),repeat('b',64)
  );
  if v_payload#>>'{ok}'<>'true' then raise exception 'manage_view projection failed: %',v_payload; end if;
  if v_payload#>>'{data,0,notification_status,channel}'<>'email'
     or v_payload#>>'{data,0,notification_status,status}'<>'unknown' then
    raise exception 'manage_view lost notification projection: %',v_payload;
  end if;
  if (v_payload#>'{data,0,notification_status}') ?| array['recipient','provider','provider_message_id','last_error_class','lease_token'] then
    raise exception 'manage_view leaked notification internals';
  end if;
end
$$;
reset role;

rollback;
