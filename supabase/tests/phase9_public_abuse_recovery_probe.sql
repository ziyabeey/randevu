begin;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '19100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','abuse-probe-owner@example.test','',now(),'{}','{}',now(),now()
);

insert into public.businesses(id,name,slug,timezone,created_by)
values(
  '4c000000-0000-4000-8000-000000000001','Abuse Probe','abuse-probe','Europe/Istanbul',
  '19100000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values(
  '5c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001',
  '19100000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
) values (
  '6c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001',
  'Probe Hizmeti',30,0,0,100000,'TRY'
);

insert into public.staff_profiles(id,business_id,name)
values('7c000000-0000-4000-8000-000000000001','4c000000-0000-4000-8000-000000000001','Probe Ayşe');

insert into public.staff_services(business_id,staff_id,service_id,active)
values(
  '4c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001',
  '6c000000-0000-4000-8000-000000000001',true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','19100000-0000-4000-8000-000000000001',true);
do $$
declare
  v_day date := date_trunc('week',current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4c000000-0000-4000-8000-000000000001',extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,'[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4c000000-0000-4000-8000-000000000001',true,15,0,30
  );
end
$$;
reset role;

insert into public.public_booking_abuse_config(
  config_key,gate_secret_hash,
  read_window_seconds,read_actor_limit,read_network_limit,
  create_window_seconds,create_actor_limit,create_network_limit,create_business_limit,
  recover_window_seconds,recover_actor_limit,recover_network_limit
) values (
  'default',encode(digest('ppppppppppppppppppppppppppppppppppppppppppp','sha256'),'hex'),
  60,20,100,600,1,10,10,300,5,20
);

set local role anon;
do $$
declare
  v_day date := date_trunc('week',current_date)::date + 7;
  v_start timestamptz := (v_day + time '10:00') at time zone 'Europe/Istanbul';
  v_first uuid;
  v_retry uuid;
begin
  select appointment_id into v_first
  from public.create_public_appointment_with_recovery_guarded(
    'abuse-probe','abuse-probe-create-0001','Probe Customer',
    '6c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001',v_start,
    repeat('a',64),'8c000000-0000-4000-8000-000000000001',repeat('b',64),
    'ciphertext-probe-abcdefghijklmnopqrstuvwxyz0123456789','iv-probe-123456',1::smallint,
    'ppppppppppppppppppppppppppppppppppppppppppp',repeat('1',64),repeat('2',64),
    '+90 555 902 00 01','probe@example.test',null
  );
  if v_first is null then raise exception 'probe first create missing'; end if;

  select appointment_id into v_retry
  from public.create_public_appointment_with_recovery_guarded(
    'abuse-probe','abuse-probe-create-0001','Probe Customer',
    '6c000000-0000-4000-8000-000000000001','7c000000-0000-4000-8000-000000000001',v_start,
    repeat('a',64),'8c000000-0000-4000-8000-000000000001',repeat('b',64),
    'ciphertext-probe-retry-abcdefghijklmnopqrstuvwxyz012345','iv-probe-retry1',1::smallint,
    'ppppppppppppppppppppppppppppppppppppppppppp',repeat('1',64),repeat('2',64),
    '+90 555 902 00 01','probe@example.test',null
  );
  if v_retry <> v_first then raise exception 'probe safe retry changed appointment'; end if;
end
$$;
reset role;

-- Owner-level state assertions identify whether create/retry damaged recovery state.
do $$
declare
  v_appointment uuid;
begin
  select r.appointment_id into v_appointment
  from public.public_booking_recoveries r
  where r.recovery_id='8c000000-0000-4000-8000-000000000001'
    and r.business_id='4c000000-0000-4000-8000-000000000001'
    and r.idempotency_key='abuse-probe-create-0001'
    and r.management_token_hash=repeat('a',64)
    and r.recovery_secret_hash=repeat('b',64)
    and r.expires_at > now();
  if v_appointment is null then raise exception 'probe recovery row/link missing after safe retry'; end if;

  if not exists(
    select 1 from public.booking_commands bc
    where bc.business_id='4c000000-0000-4000-8000-000000000001'
      and bc.idempotency_key='abuse-probe-create-0001'
      and bc.appointment_id=v_appointment
      and bc.command='public_create'
      and bc.source='public'
  ) then raise exception 'probe booking command link missing after safe retry'; end if;

  if (select count(*) from public.recover_public_appointment(
    '8c000000-0000-4000-8000-000000000001','abuse-probe-create-0001',repeat('b',64)
  )) <> 1 then raise exception 'probe raw recovery returned no row'; end if;
end
$$;

set local role anon;
do $$
begin
  if (select count(*) from public.recover_public_appointment_guarded(
    '8c000000-0000-4000-8000-000000000001','abuse-probe-create-0001',repeat('b',64),
    'ppppppppppppppppppppppppppppppppppppppppppp',repeat('3',64),repeat('4',64)
  )) <> 1 then raise exception 'probe guarded recovery returned no row'; end if;
end
$$;

rollback;
