begin;

-- F11-02: atomic multi-service creation. Either the whole reservation exists or
-- none of it does, one command carries one request hash, and a replay returns
-- the same group instead of a second one.

insert into auth.users(id,email,raw_user_meta_data)
values ('d1600000-0000-4000-8000-000000000001','f1102-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('d1610000-0000-4000-8000-000000000001','F11-02 Salon','f1102-salon','Europe/Istanbul','d1600000-0000-4000-8000-000000000001')
;

insert into public.memberships(id,business_id,user_id,role,active)
values ('d1620000-0000-4000-8000-000000000001','d1610000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role=excluded.role,active=excluded.active;

-- Colour carries buffers on both sides; cut is buffer free. Blow-dry is only
-- served by the second stylist, which forces a staff change inside one group.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('d1630000-0000-4000-8000-000000000001','d1610000-0000-4000-8000-000000000001','Boya',60,10,15,'Renk',10,null,'range',20000,35000,'TRY',true),
  ('d1630000-0000-4000-8000-000000000002','d1610000-0000-4000-8000-000000000001','Kesim',30,0,0,'Genel',20,15000,'fixed',15000,15000,'TRY',true),
  ('d1630000-0000-4000-8000-000000000003','d1610000-0000-4000-8000-000000000001','Fön',20,0,0,'Genel',30,8000,'fixed',8000,8000,'TRY',true),
  ('d1630000-0000-4000-8000-000000000004','d1610000-0000-4000-8000-000000000001','Kaş',5,0,0,'Genel',40,5000,'fixed',5000,5000,'TRY',true)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values
  ('d1640000-0000-4000-8000-000000000001','d1610000-0000-4000-8000-000000000001','Ayla',true),
  ('d1640000-0000-4000-8000-000000000002','d1610000-0000-4000-8000-000000000001','Berk',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1610000-0000-4000-8000-000000000001','d1640000-0000-4000-8000-000000000001','d1630000-0000-4000-8000-000000000001',true),
  ('d1610000-0000-4000-8000-000000000001','d1640000-0000-4000-8000-000000000001','d1630000-0000-4000-8000-000000000002',true),
  ('d1610000-0000-4000-8000-000000000001','d1640000-0000-4000-8000-000000000002','d1630000-0000-4000-8000-000000000002',true),
  ('d1610000-0000-4000-8000-000000000001','d1640000-0000-4000-8000-000000000002','d1630000-0000-4000-8000-000000000003',true),
  ('d1610000-0000-4000-8000-000000000001','d1640000-0000-4000-8000-000000000001','d1630000-0000-4000-8000-000000000004',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd1610000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd1610000-0000-4000-8000-000000000001'::uuid,'d1640000-0000-4000-8000-000000000001'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true
union all
select 'd1610000-0000-4000-8000-000000000001'::uuid,'d1640000-0000-4000-8000-000000000002'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;


set local role authenticated;
select set_config('request.jwt.claim.sub','d1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

-- A colour plus a cut booked as one reservation.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_result jsonb;
begin
  v_result := public.create_appointment_group(
    'd1610000-0000-4000-8000-000000000001',
    'f1102-group-create-0001',
    'Deniz Yıldız',
    '[{"serviceId":"d1630000-0000-4000-8000-000000000001"},{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    '05551112233'
  );
  perform pg_catalog.set_config('f1102.result', v_result::text, false);
  perform pg_catalog.set_config('f1102.group_id', v_result->>'groupId', false);
end
$$;

-- Ledger shape is asserted with owner rights; API roles never read raw tables.
reset role;
do $$
declare
  v_group uuid := current_setting('f1102.group_id')::uuid;
  v_result jsonb := current_setting('f1102.result')::jsonb;
  v_lines integer;
  v_commands integer;
  v_events integer;
  v_l1 jsonb;
  v_l2 jsonb;
begin
  if v_group is null then raise exception 'F11-02 group create returned no group'; end if;

  select count(*)::integer into v_lines
  from public.appointments a
  where a.business_id = 'd1610000-0000-4000-8000-000000000001' and a.group_id = v_group;
  if v_lines <> 2 then raise exception 'F11-02 expected two lines, found %', v_lines; end if;

  -- One reservation is one command with one request hash, never N commands.
  select count(*)::integer into v_commands
  from public.booking_commands bc
  where bc.business_id = 'd1610000-0000-4000-8000-000000000001' and bc.group_id = v_group;
  if v_commands <> 1 then raise exception 'F11-02 expected one booking command, found %', v_commands; end if;

  select count(*)::integer into v_events
  from public.appointment_events e
  where e.business_id = 'd1610000-0000-4000-8000-000000000001'
    and e.group_id = v_group and e.event_type = 'created';
  if v_events <> 1 then raise exception 'F11-02 expected one create event, found %', v_events; end if;

  -- Lines are consecutive and ordered.
  if exists (
    select 1
    from public.appointments a
    join public.appointments b
      on b.business_id = a.business_id and b.group_id = a.group_id
     and b.line_ordinal = a.line_ordinal + 1
    where a.business_id = 'd1610000-0000-4000-8000-000000000001'
      and a.group_id = v_group
      and b.starts_at <> a.ends_at
  ) then
    raise exception 'F11-02 committed lines are not consecutive';
  end if;

  -- Price meaning is frozen per line: the range service never collapses into a
  -- definitive amount, the fixed one keeps its scalar.
  select jsonb_agg(l order by (l->>'lineOrdinal')::int) into v_l1
  from jsonb_array_elements(v_result->'lines') l;
  v_l2 := v_l1->1;
  v_l1 := v_l1->0;
  if v_l1->>'priceType' <> 'range' or (v_l1->'priceMinor') <> 'null'::jsonb
     or (v_l1->>'priceMinMinor')::int <> 20000 or (v_l1->>'priceMaxMinor')::int <> 35000 then
    raise exception 'F11-02 range line price snapshot is wrong';
  end if;
  if v_l2->>'priceType' <> 'fixed' or (v_l2->>'priceMinor')::int <> 15000 then
    raise exception 'F11-02 fixed line price snapshot is wrong';
  end if;
  raise notice 'F11-02 atomic group create accepted';
end
$$;

-- A replay of the same command returns the same reservation.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_result jsonb;
begin
  v_result := public.create_appointment_group(
    'd1610000-0000-4000-8000-000000000001',
    'f1102-group-create-0001',
    'Deniz Yıldız',
    '[{"serviceId":"d1630000-0000-4000-8000-000000000001"},{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    '05551112233'
  );
  if (v_result->>'groupId') <> current_setting('f1102.group_id') then
    raise exception 'F11-02 replay produced a different group';
  end if;
end
$$;

reset role;
do $$
declare
  v_groups integer;
  v_lines integer;
begin
  select count(*)::integer into v_groups
  from public.appointment_groups g where g.business_id = 'd1610000-0000-4000-8000-000000000001';
  if v_groups <> 1 then raise exception 'F11-02 replay created a second group'; end if;

  select count(*)::integer into v_lines
  from public.appointments a where a.business_id = 'd1610000-0000-4000-8000-000000000001';
  if v_lines <> 2 then raise exception 'F11-02 replay created extra lines'; end if;
  raise notice 'F11-02 idempotent replay accepted';
end
$$;

-- The same key with a different reservation is refused, and an unplaceable
-- reservation leaves nothing behind.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_raised boolean := false;
begin
  begin
    perform public.create_appointment_group(
      'd1610000-0000-4000-8000-000000000001',
      'f1102-group-create-0001',
      'Deniz Yıldız',
      '[{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
      (v_day+time '10:00') at time zone 'Europe/Istanbul',
      '05551112233'
    );
  exception when others then
    if sqlerrm not like '%IDEMPOTENCY_CONFLICT%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'F11-02 same key accepted a different payload'; end if;

  v_raised := false;
  begin
    -- Berk cannot serve the colour, so this pinned line has no placement.
    perform public.create_appointment_group(
      'd1610000-0000-4000-8000-000000000001',
      'f1102-group-create-0002',
      'Yarım Grup',
      '[{"serviceId":"d1630000-0000-4000-8000-000000000002","staffId":"d1640000-0000-4000-8000-000000000002"},
        {"serviceId":"d1630000-0000-4000-8000-000000000001","staffId":"d1640000-0000-4000-8000-000000000002"}]'::jsonb,
      (v_day+time '14:00') at time zone 'Europe/Istanbul',
      '05559998877'
    );
  exception when others then
    if sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'F11-02 unplaceable group was accepted'; end if;

  v_raised := false;
  begin
    perform public.create_appointment_group(
      'd1610000-0000-4000-8000-000000000001',
      'f1102-group-create-0003',
      'Kapalı Saat',
      '[{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
      (v_day+time '05:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'F11-02 accepted a start outside working hours'; end if;
end
$$;

reset role;
do $$
declare
  v_groups integer;
  v_lines integer;
begin
  select count(*)::integer into v_groups
  from public.appointment_groups g where g.business_id = 'd1610000-0000-4000-8000-000000000001';
  select count(*)::integer into v_lines
  from public.appointments a where a.business_id = 'd1610000-0000-4000-8000-000000000001';
  if v_groups <> 1 then raise exception 'F11-02 refused group left a header behind'; end if;
  if v_lines <> 2 then raise exception 'F11-02 refused group left lines behind'; end if;
  raise notice 'F11-02 refused reservations leave nothing behind';
end
$$;

rollback;
