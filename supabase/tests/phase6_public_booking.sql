begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('16000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase6-a@example.test','',now(),'{}','{}',now(),now()),
  ('26000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase6-b@example.test','',now(),'{}','{}',now(),now())
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('47000000-0000-4000-8000-000000000001','Public Booking A','public-booking-a','Europe/Istanbul','16000000-0000-4000-8000-000000000001'),
  ('48000000-0000-4000-8000-000000000002','Public Booking B','public-booking-b','Europe/Istanbul','26000000-0000-4000-8000-000000000002')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('57000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','owner',true),
  ('58000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000002','owner',true)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values
  ('67000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','Public Hizmet A',30,0,0,150000,'TRY'),
  ('68000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','Public Hizmet B',45,0,0,200000,'TRY')
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values
  ('77000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','Ayşe Public'),
  ('78000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','B Public')
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('47000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000001',true),
  ('48000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000002',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

-- New businesses receive disabled public settings automatically.
do $$
begin
  if not exists (
    select 1 from public.public_booking_settings
    where business_id='47000000-0000-4000-8000-000000000001' and enabled=false
  ) then
    raise exception 'public booking settings were not provisioned disabled';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_weekday smallint := extract(dow from (date_trunc('week', current_date)::date + 7))::smallint;
  v_settings public.public_booking_settings;
begin
  perform public.replace_business_hours(
    '47000000-0000-4000-8000-000000000001', v_weekday,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '47000000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001', v_weekday,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );

  select * into v_settings
  from public.update_public_booking_settings(
    '47000000-0000-4000-8000-000000000001', true, 15, 0, 30
  );

  if not v_settings.enabled or v_settings.step_minutes <> 15 or v_settings.horizon_days <> 30 then
    raise exception 'owner settings update failed';
  end if;
end
$$;

-- Other tenant stays disabled and must not appear on the public surface.
select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
begin
  if (select count(*) from public.get_public_booking_business('public-booking-a')) <> 1 then
    raise exception 'enabled public business was not exposed';
  end if;
  if (select count(*) from public.get_public_booking_business('public-booking-b')) <> 0 then
    raise exception 'disabled public business leaked';
  end if;
  if (select count(*) from public.get_public_booking_services('public-booking-a')) <> 1 then
    raise exception 'public service catalog failed';
  end if;
  if (select count(*) from public.get_public_booking_staff(
    'public-booking-a','67000000-0000-4000-8000-000000000001'
  )) <> 1 then
    raise exception 'public staff catalog failed';
  end if;
end
$$;

-- Anon has RPC access only, never direct table read access.
do $$
begin
  begin
    perform count(*) from public.appointments;
    raise exception 'anon can read appointments directly';
  exception when insufficient_privilege then null;
  end;

  begin
    perform count(*) from public.public_booking_settings;
    raise exception 'anon can read public booking settings directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:00') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_retry uuid;
  v_count integer;
begin
  if not exists (
    select 1 from public.compute_public_booking_slots(
      'public-booking-a',
      '67000000-0000-4000-8000-000000000001',
      v_day,
      '77000000-0000-4000-8000-000000000001'
    ) s where s.starts_at = v_start
  ) then
    raise exception 'expected public slot was not emitted';
  end if;

  select appointment_id into v_id
  from public.create_public_appointment(
    'public-booking-a', 'public-create-0001', 'Ali Public',
    '67000000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    v_start, '+90 555 000 00 01', 'ali.public@example.test', 'Public not'
  );

  if v_id is null then raise exception 'public appointment was not created'; end if;

  select appointment_id into v_retry
  from public.create_public_appointment(
    'public-booking-a', 'public-create-0001', 'Ali Public',
    '67000000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    v_start, '+90 555 000 00 01', 'ali.public@example.test', 'Public not'
  );
  if v_retry <> v_id then raise exception 'public idempotent retry changed result'; end if;

  -- The occupied slot disappears immediately.
  if exists (
    select 1 from public.compute_public_booking_slots(
      'public-booking-a',
      '67000000-0000-4000-8000-000000000001',
      v_day,
      '77000000-0000-4000-8000-000000000001'
    ) s where s.starts_at = v_start
  ) then
    raise exception 'booked public slot remained available';
  end if;

  -- A second command cannot steal the same time.
  begin
    perform public.create_public_appointment(
      'public-booking-a', 'public-create-0002', 'Veli Public',
      '67000000-0000-4000-8000-000000000001',
      '77000000-0000-4000-8000-000000000001',
      v_start, '+90 555 000 00 02', null, null
    );
    raise exception 'double booking was accepted';
  exception when others then
    if sqlerrm = 'double booking was accepted' then raise; end if;
    if position('SLOT_UNAVAILABLE' in sqlerrm) = 0
       and position('APPOINTMENT_CONFLICT' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  -- At least one contact channel is mandatory.
  begin
    perform public.create_public_appointment(
      'public-booking-a', 'public-create-0003', 'Temassız Kişi',
      '67000000-0000-4000-8000-000000000001',
      '77000000-0000-4000-8000-000000000001',
      v_start + interval '1 hour', null, null, null
    );
    raise exception 'contactless public booking was accepted';
  exception when others then
    if sqlerrm = 'contactless public booking was accepted' then raise; end if;
    if position('PUBLIC_CONTACT_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  -- Horizon is enforced before any booking write.
  begin
    perform public.compute_public_booking_slots(
      'public-booking-a',
      '67000000-0000-4000-8000-000000000001',
      (now() at time zone 'Europe/Istanbul')::date + 31,
      null
    );
    raise exception 'public horizon was bypassed';
  exception when others then
    if sqlerrm = 'public horizon was bypassed' then raise; end if;
    if position('DATE_OUT_OF_RANGE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Operator can see public provenance and audit, while anon cannot.
set local role authenticated;
select set_config('request.jwt.claim.sub','16000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_appointment_id uuid;
  v_event_count integer;
begin
  select id into v_appointment_id
  from public.appointments
  where business_id='47000000-0000-4000-8000-000000000001'
    and source='public'
  limit 1;

  if v_appointment_id is null then raise exception 'operator cannot see public booking'; end if;

  if exists (
    select 1 from public.appointments
    where id=v_appointment_id and created_by is not null
  ) then
    raise exception 'public booking unexpectedly has an authenticated creator';
  end if;

  select count(*) into v_event_count
  from public.appointment_events
  where appointment_id=v_appointment_id
    and actor_type='public'
    and actor_user_id is null
    and event_type='created';
  if v_event_count <> 1 then raise exception 'public audit provenance missing'; end if;

  perform public.update_public_booking_settings(
    '47000000-0000-4000-8000-000000000001', false, 15, 0, 30
  );
end
$$;

-- Exact committed retry remains safe even if the owner disables the public page.
select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:00') at time zone 'Europe/Istanbul';
  v_id uuid;
begin
  if (select count(*) from public.get_public_booking_business('public-booking-a')) <> 0 then
    raise exception 'disabled public page still visible';
  end if;

  select appointment_id into v_id
  from public.create_public_appointment(
    'public-booking-a', 'public-create-0001', 'Ali Public',
    '67000000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    v_start, '+90 555 000 00 01', 'ali.public@example.test', 'Public not'
  );
  if v_id is null then raise exception 'disabled-page exact retry lost committed result'; end if;

  begin
    perform public.create_public_appointment(
      'public-booking-a', 'public-create-0004', 'Yeni Public',
      '67000000-0000-4000-8000-000000000001',
      '77000000-0000-4000-8000-000000000001',
      v_start + interval '2 hours', '+90 555 000 00 04', null, null
    );
    raise exception 'disabled public page accepted a new booking';
  exception when others then
    if sqlerrm = 'disabled public page accepted a new booking' then raise; end if;
    if position('PUBLIC_BOOKING_DISABLED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

rollback;
