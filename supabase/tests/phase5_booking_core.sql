begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('15000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-a@example.test','',now(),'{}','{}',now(),now()),
  ('25000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase5-b@example.test','',now(),'{}','{}',now(),now())
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('45000000-0000-4000-8000-000000000001','Booking A','booking-a','Europe/Istanbul','15000000-0000-4000-8000-000000000001'),
  ('46000000-0000-4000-8000-000000000002','Booking B','booking-b','Europe/Istanbul','25000000-0000-4000-8000-000000000002')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('55000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','owner',true),
  ('56000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000002','owner',true)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency)
values
  ('65000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','Booking Hizmeti A',30,0,0,125000,'TRY'),
  ('66000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002','Booking Hizmeti B',30,0,0,90000,'TRY')
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values
  ('75000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','Ayşe Booking'),
  ('76000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002','B Personeli')
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('45000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001',true),
  ('46000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000002',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);

-- Owner A configures a future day and creates the first booking.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_weekday smallint := extract(dow from (date_trunc('week', current_date)::date + 7))::smallint;
  v_start timestamptz;
  v_move timestamptz;
  v_id uuid;
  v_retry uuid;
  v_row public.appointments;
  v_count integer;
begin
  perform public.replace_business_hours(
    '45000000-0000-4000-8000-000000000001', v_weekday,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '45000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001', v_weekday,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );

  v_start := (v_day + time '10:00') at time zone 'Europe/Istanbul';
  v_move := (v_day + time '11:00') at time zone 'Europe/Istanbul';

  select (public.create_appointment(
    '45000000-0000-4000-8000-000000000001',
    'phase5-create-0001',
    'Ali Test',
    '65000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',
    v_start,
    '+90 555 111 22 33',
    'ali@example.test',
    'İlk randevu'
  )).id into v_id;

  if v_id is null then raise exception 'appointment was not created'; end if;

  -- Same command key and same payload must return the exact same appointment.
  select (public.create_appointment(
    '45000000-0000-4000-8000-000000000001',
    'phase5-create-0001',
    'Ali Test',
    '65000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',
    v_start,
    '+90 555 111 22 33',
    'ali@example.test',
    'İlk randevu'
  )).id into v_retry;

  if v_retry <> v_id then raise exception 'idempotent retry returned a different appointment'; end if;

  select count(*) into v_count
  from public.appointments
  where business_id='45000000-0000-4000-8000-000000000001';
  if v_count <> 1 then raise exception 'idempotent create produced % appointments', v_count; end if;

  -- Reusing the key with a different request is a hard conflict.
  begin
    perform public.create_appointment(
      '45000000-0000-4000-8000-000000000001',
      'phase5-create-0001',
      'Ali Test',
      '65000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      v_move,
      '+90 555 111 22 33',
      'ali@example.test',
      'İlk randevu'
    );
    raise exception 'different payload reused an idempotency key';
  exception when others then
    if sqlerrm = 'different payload reused an idempotency key' then raise; end if;
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;

  -- Normal availability must now subtract the appointment and every overlapping start.
  if exists (
    select 1 from public.compute_availability_slots(
      '45000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', v_day,
      '75000000-0000-4000-8000-000000000001', 15
    ) s
    where s.starts_at in (v_start, v_start + interval '15 minutes')
  ) then
    raise exception 'booked time leaked into public availability';
  end if;

  -- Reschedule preview ignores only the appointment being moved, so its own slot reappears.
  if not exists (
    select 1 from public.compute_reschedule_slots(
      '45000000-0000-4000-8000-000000000001', v_id, v_day,
      '75000000-0000-4000-8000-000000000001', 15
    ) s where s.starts_at = v_start
  ) then
    raise exception 'reschedule preview did not ignore the current appointment';
  end if;

  -- A scheduled appointment cannot jump directly to a terminal completion state.
  begin
    perform public.set_appointment_status(
      '45000000-0000-4000-8000-000000000001', v_id,
      'phase5-status-premature-0001', 'completed', null
    );
    raise exception 'scheduled appointment jumped directly to completed';
  exception when others then
    if sqlerrm = 'scheduled appointment jumped directly to completed' then raise; end if;
    if position('INVALID_STATUS_TRANSITION' in sqlerrm) = 0 then raise; end if;
  end;

  -- Existing bookings must remain movable using their original snapshot duration/buffers,
  -- even if the service catalog is later edited or deactivated.
  update public.services
  set active=false,
      duration_minutes=120,
      buffer_before_minutes=30,
      buffer_after_minutes=45
  where business_id='45000000-0000-4000-8000-000000000001'
    and id='65000000-0000-4000-8000-000000000001';

  select (public.create_appointment(
    '45000000-0000-4000-8000-000000000001',
    'phase5-create-0001',
    'Ali Test',
    '65000000-0000-4000-8000-000000000001',
    '75000000-0000-4000-8000-000000000001',
    v_start,
    '+90 555 111 22 33',
    'ali@example.test',
    'İlk randevu'
  )).id into v_retry;
  if v_retry <> v_id then raise exception 'idempotent retry failed after catalog mutation'; end if;

  if not exists (
    select 1 from public.compute_reschedule_slots(
      '45000000-0000-4000-8000-000000000001', v_id, v_day,
      '75000000-0000-4000-8000-000000000001', 15
    ) s where s.starts_at = v_move and s.ends_at = v_move + interval '30 minutes'
  ) then
    raise exception 'reschedule did not preserve appointment snapshot duration';
  end if;

  select * into v_row
  from public.reschedule_appointment(
    '45000000-0000-4000-8000-000000000001', v_id,
    'phase5-reschedule-0001',
    '75000000-0000-4000-8000-000000000001', v_move
  );

  if v_row.starts_at <> v_move then raise exception 'appointment was not rescheduled'; end if;
  if v_row.ends_at <> v_move + interval '30 minutes' then raise exception 'reschedule changed snapshot duration'; end if;
  if v_row.occupied_starts_at <> v_move or v_row.occupied_ends_at <> v_move + interval '30 minutes' then
    raise exception 'reschedule changed snapshot buffers';
  end if;

  -- Restore catalog state so public new-booking availability assertions stay comparable.
  update public.services
  set active=true,
      duration_minutes=30,
      buffer_before_minutes=0,
      buffer_after_minutes=0
  where business_id='45000000-0000-4000-8000-000000000001'
    and id='65000000-0000-4000-8000-000000000001';

  if not exists (
    select 1 from public.compute_availability_slots(
      '45000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', v_day,
      '75000000-0000-4000-8000-000000000001', 15
    ) s where s.starts_at = v_start
  ) then
    raise exception 'old slot did not reopen after reschedule';
  end if;

  if exists (
    select 1 from public.compute_availability_slots(
      '45000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', v_day,
      '75000000-0000-4000-8000-000000000001', 15
    ) s where s.starts_at = v_move
  ) then
    raise exception 'new booked slot remained publicly available';
  end if;

  select * into v_row
  from public.set_appointment_status(
    '45000000-0000-4000-8000-000000000001', v_id,
    'phase5-status-confirm-0001', 'confirmed', null
  );
  if v_row.status <> 'confirmed' then raise exception 'confirm transition failed'; end if;

  select * into v_row
  from public.set_appointment_status(
    '45000000-0000-4000-8000-000000000001', v_id,
    'phase5-status-cancel-0001', 'cancelled', 'Müşteri talebi'
  );
  if v_row.status <> 'cancelled' or v_row.cancelled_at is null then
    raise exception 'cancel transition failed';
  end if;

  -- Cancelled bookings release their occupied time.
  if not exists (
    select 1 from public.compute_availability_slots(
      '45000000-0000-4000-8000-000000000001',
      '65000000-0000-4000-8000-000000000001', v_day,
      '75000000-0000-4000-8000-000000000001', 15
    ) s where s.starts_at = v_move
  ) then
    raise exception 'cancelled appointment did not release the slot';
  end if;

  select count(*) into v_count
  from public.appointment_events
  where business_id='45000000-0000-4000-8000-000000000001'
    and appointment_id=v_id;
  if v_count <> 4 then raise exception 'expected 4 audit events, got %', v_count; end if;

  -- Cancelled is terminal.
  begin
    perform public.set_appointment_status(
      '45000000-0000-4000-8000-000000000001', v_id,
      'phase5-status-invalid-0001', 'confirmed', null
    );
    raise exception 'terminal appointment was reopened';
  exception when others then
    if sqlerrm = 'terminal appointment was reopened' then raise; end if;
    if position('INVALID_STATUS_TRANSITION' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- The database exclusion constraint is the final race-condition guard even if
-- application-level availability checks are bypassed.
reset role;
do $$
declare
  v_source public.appointments;
begin
  select * into v_source
  from public.appointments
  where business_id='45000000-0000-4000-8000-000000000001'
  limit 1;

  -- Reactivate the source so a duplicate range must conflict.
  update public.appointments
  set status='confirmed', cancelled_at=null, cancelled_by=null, cancellation_reason=null
  where id=v_source.id;

  begin
    insert into public.appointments(
      business_id,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
      service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,currency_snapshot,notes,created_by
    )
    select
      business_id,customer_id,service_id,staff_id,'scheduled',
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
      service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,currency_snapshot,notes,created_by
    from public.appointments where id=v_source.id;
    raise exception 'exclusion constraint accepted an overlapping appointment';
  exception when exclusion_violation then
    null;
  end;

  update public.appointments set status='cancelled' where id=v_source.id;
end
$$;

-- Tenant B creates its own booking; tenant A must not see or mutate it.
set local role authenticated;
select set_config('request.jwt.claim.sub','25000000-0000-4000-8000-000000000002',true);
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_weekday smallint := extract(dow from (date_trunc('week', current_date)::date + 7))::smallint;
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '13:00') at time zone 'Europe/Istanbul';
begin
  perform public.replace_business_hours(
    '46000000-0000-4000-8000-000000000002', v_weekday,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '46000000-0000-4000-8000-000000000002',
    '76000000-0000-4000-8000-000000000002', v_weekday,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.create_appointment(
    '46000000-0000-4000-8000-000000000002',
    'phase5-b-create-0001', 'B Müşterisi',
    '66000000-0000-4000-8000-000000000002',
    '76000000-0000-4000-8000-000000000002', v_start,
    null, 'b@example.test', null
  );
end
$$;

select set_config('request.jwt.claim.sub','15000000-0000-4000-8000-000000000001',true);
do $$
begin
  if exists(select 1 from public.appointments where business_id='46000000-0000-4000-8000-000000000002') then
    raise exception 'tenant A can see tenant B appointments';
  end if;
  if exists(select 1 from public.customers where business_id='46000000-0000-4000-8000-000000000002') then
    raise exception 'tenant A can see tenant B customers';
  end if;
  if exists(select 1 from public.appointment_events where business_id='46000000-0000-4000-8000-000000000002') then
    raise exception 'tenant A can see tenant B audit events';
  end if;

  begin
    perform public.compute_availability_slots(
      '46000000-0000-4000-8000-000000000002',
      '66000000-0000-4000-8000-000000000002',
      date_trunc('week', current_date)::date + 7,
      '76000000-0000-4000-8000-000000000002', 15
    );
    raise exception 'tenant A computed tenant B availability';
  exception when others then
    if sqlerrm = 'tenant A computed tenant B availability' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

rollback;
