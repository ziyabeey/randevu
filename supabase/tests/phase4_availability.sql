begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('11000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4-a@example.test','',now(),'{}','{}',now(),now()),
  ('22000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4-b@example.test','',now(),'{}','{}',now(),now()),
  ('33000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4-staff@example.test','',now(),'{}','{}',now(),now())
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('41000000-0000-4000-8000-000000000001','Availability A','availability-a','Europe/Istanbul','11000000-0000-4000-8000-000000000001'),
  ('42000000-0000-4000-8000-000000000002','Availability B','availability-b','Europe/Istanbul','22000000-0000-4000-8000-000000000002'),
  ('43000000-0000-4000-8000-000000000003','DST Berlin','dst-berlin','Europe/Berlin','11000000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner',true),
  ('52000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','owner',true),
  ('53000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000003','staff',true),
  ('54000000-0000-4000-8000-000000000004','43000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor)
values
  ('61000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','Kesim',60,15,15,100000),
  ('62000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000002','B Hizmeti',30,0,0,100000),
  ('63000000-0000-4000-8000-000000000003','43000000-0000-4000-8000-000000000003','DST Hizmeti',30,0,0,100000)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values
  ('71000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','Ayşe'),
  ('72000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000002','B Personeli'),
  ('73000000-0000-4000-8000-000000000003','43000000-0000-4000-8000-000000000003','Berlin Personeli')
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('41000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',true),
  ('42000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002',true),
  ('43000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000003',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

-- All schedule mutations are performed as tenant A's authenticated owner.
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);

-- Next Monday keeps the test inside the RPC's accepted horizon.
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_count integer;
  v_block uuid;
begin
  perform public.replace_business_hours(
    '41000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"12:00"},{"start":"13:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '41000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"10:00","end":"17:00"}]'::jsonb
  );

  select count(*) into v_count
  from public.compute_availability_slots(
    '41000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    v_day,
    '71000000-0000-4000-8000-000000000001',
    30
  );
  if v_count <> 8 then
    raise exception 'expected 8 base slots, got %', v_count;
  end if;

  -- 12:00-13:00 is absent because the business day is split around a lunch break.
  if exists (
    select 1
    from public.compute_availability_slots(
      '41000000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      v_day,
      '71000000-0000-4000-8000-000000000001',
      30
    ) s
    where (s.starts_at at time zone 'Europe/Istanbul')::time >= time '12:00'
      and (s.starts_at at time zone 'Europe/Istanbul')::time < time '13:00'
  ) then
    raise exception 'lunch-break slot unexpectedly emitted';
  end if;

  select (public.create_availability_block_local(
    '41000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    v_day,
    time '14:00',
    time '15:00',
    'Personel izni'
  )).id into v_block;

  select count(*) into v_count
  from public.compute_availability_slots(
    '41000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    v_day,
    '71000000-0000-4000-8000-000000000001',
    30
  );
  if v_count <> 4 then
    raise exception 'staff block should leave 4 slots, got %', v_count;
  end if;

  perform public.delete_availability_block('41000000-0000-4000-8000-000000000001', v_block);

  select (public.create_availability_block_local(
    '41000000-0000-4000-8000-000000000001',
    null,
    v_day,
    time '00:00',
    time '00:00',
    'İşletme kapalı'
  )).id into v_block;

  select count(*) into v_count
  from public.compute_availability_slots(
    '41000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    v_day,
    null,
    30
  );
  if v_count <> 0 then
    raise exception 'full-day closure should emit no slots, got %', v_count;
  end if;

  perform public.delete_availability_block('41000000-0000-4000-8000-000000000001', v_block);

  begin
    perform public.replace_business_hours(
      '41000000-0000-4000-8000-000000000001',
      extract(dow from v_day)::smallint,
      '[{"start":"09:00","end":"12:00"},{"start":"11:00","end":"14:00"}]'::jsonb
    );
    raise exception 'overlapping intervals unexpectedly accepted';
  exception when others then
    if sqlerrm = 'overlapping intervals unexpectedly accepted' then raise; end if;
  end;
end
$$;

-- A staff-role user can read own tenant availability but cannot mutate schedules.
select set_config('request.jwt.claim.sub','33000000-0000-4000-8000-000000000003',true);
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  if (select count(*) from public.business_hours where business_id='41000000-0000-4000-8000-000000000001') = 0 then
    raise exception 'staff member cannot read own tenant schedule';
  end if;
  begin
    perform public.replace_business_hours(
      '41000000-0000-4000-8000-000000000001',
      extract(dow from v_day)::smallint,
      '[{"start":"08:00","end":"18:00"}]'::jsonb
    );
    raise exception 'staff role unexpectedly changed business hours';
  exception when others then
    if sqlerrm = 'staff role unexpectedly changed business hours' then raise; end if;
  end;
end
$$;

-- Tenant A cannot see or compute Tenant B availability.
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  if exists(select 1 from public.business_hours where business_id='42000000-0000-4000-8000-000000000002') then
    raise exception 'tenant A can see tenant B business hours';
  end if;
  begin
    perform * from public.compute_availability_slots(
      '42000000-0000-4000-8000-000000000002',
      '62000000-0000-4000-8000-000000000002',
      v_day,
      null,
      15
    );
    raise exception 'tenant A unexpectedly computed tenant B slots';
  exception when others then
    if sqlerrm = 'tenant A unexpectedly computed tenant B slots' then raise; end if;
  end;
end
$$;

-- DST contract in Europe/Berlin. Find the next spring/fall transition dates dynamically,
-- then verify the slot engine on the actual UTC timeline.
do $$
declare
  v_year integer := extract(year from current_date)::integer;
  v_spring date;
  v_fall date;
  v_count integer;
  v_hour2 integer;
  y integer;
begin
  for y in v_year..v_year+1 loop
    if v_spring is null then
      v_spring := make_date(y,3,31) - extract(dow from make_date(y,3,31))::integer;
      if v_spring < current_date - 1 then v_spring := null; end if;
    end if;
    if v_fall is null then
      v_fall := make_date(y,10,31) - extract(dow from make_date(y,10,31))::integer;
      if v_fall < current_date - 1 then v_fall := null; end if;
    end if;
  end loop;

  if v_spring is null or v_fall is null then
    raise exception 'could not resolve DST dates';
  end if;

  perform public.replace_business_hours(
    '43000000-0000-4000-8000-000000000003',
    0,
    '[{"start":"01:00","end":"04:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '43000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000003',
    0,
    '[{"start":"01:00","end":"04:00"}]'::jsonb
  );

  select count(*) into v_count
  from public.compute_availability_slots(
    '43000000-0000-4000-8000-000000000003',
    '63000000-0000-4000-8000-000000000003',
    v_spring,
    '73000000-0000-4000-8000-000000000003',
    30
  );
  if v_count <> 4 then
    raise exception 'spring-forward should produce 4 real half-hour slots, got %', v_count;
  end if;
  if exists (
    select 1 from public.compute_availability_slots(
      '43000000-0000-4000-8000-000000000003',
      '63000000-0000-4000-8000-000000000003',
      v_spring,
      '73000000-0000-4000-8000-000000000003',
      30
    ) s
    where extract(hour from s.starts_at at time zone 'Europe/Berlin') = 2
  ) then
    raise exception 'nonexistent spring-forward 02:xx slot emitted';
  end if;

  select count(*), count(*) filter (where extract(hour from starts_at at time zone 'Europe/Berlin') = 2)
  into v_count, v_hour2
  from public.compute_availability_slots(
    '43000000-0000-4000-8000-000000000003',
    '63000000-0000-4000-8000-000000000003',
    v_fall,
    '73000000-0000-4000-8000-000000000003',
    30
  );
  if v_count <> 8 or v_hour2 <> 4 then
    raise exception 'fall-back should produce 8 slots with four real 02:xx instants, got total %, hour2 %', v_count, v_hour2;
  end if;
end
$$;

reset role;

-- Invalid IANA timezone is rejected at the DB boundary.
do $$
begin
  begin
    update public.businesses
    set timezone='Mars/Olympus'
    where id='41000000-0000-4000-8000-000000000001';
    raise exception 'invalid timezone unexpectedly accepted';
  exception when others then
    if sqlerrm = 'invalid timezone unexpectedly accepted' then raise; end if;
  end;
end
$$;

rollback;
