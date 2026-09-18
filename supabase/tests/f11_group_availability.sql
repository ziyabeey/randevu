begin;

-- F11-02: one engine plans every service of a reservation. These assertions
-- cover staff continuity, buffer collapse inside a same-staff run, a forced
-- staff change, the documented budgets and the ACL surface.

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

-- ACL: the engine internals stay closed, only the two operator RPCs are open.
do $$
begin
  if not has_function_privilege('authenticated','public.compute_group_availability_slots(uuid,date,jsonb,integer)','EXECUTE')
     or has_function_privilege('anon','public.compute_group_availability_slots(uuid,date,jsonb,integer)','EXECUTE') then
    raise exception 'F11-02 group slot RPC ACL mismatch';
  end if;
  if not has_function_privilege('authenticated','public.create_appointment_group(uuid,text,text,jsonb,timestamptz,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.create_appointment_group(uuid,text,text,jsonb,timestamptz,text,text,text)','EXECUTE') then
    raise exception 'F11-02 group create RPC ACL mismatch';
  end if;
  if has_function_privilege('authenticated','public.f11_plan_group_at(uuid,jsonb,timestamptz,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.f11_staff_slot_free(uuid,uuid,uuid,date,timestamptz,timestamptz,uuid)','EXECUTE')
     or has_function_privilege('anon','public.f11_group_line_defs(uuid,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.f11_group_payload(uuid,uuid)','EXECUTE') then
    raise exception 'F11-02 internal engine helper leaked EXECUTE';
  end if;
end
$$;

-- The planner is internal: it is probed with owner rights, while every
-- caller-facing assertion below runs as the authenticated operator.
reset role;

-- Continuity: colour then cut, no pinned staff. Ayla serves both, so the run is
-- one occupancy block and the inner buffers collapse.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_plan jsonb;
  v_l1 jsonb;
  v_l2 jsonb;
begin
  v_plan := public.f11_plan_group_at(
    'd1610000-0000-4000-8000-000000000001',
    '[{"serviceId":"d1630000-0000-4000-8000-000000000001"},{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul'
  );
  if v_plan is null then raise exception 'F11-02 continuity plan missing'; end if;

  v_l1 := v_plan->'lines'->0;
  v_l2 := v_plan->'lines'->1;

  if v_l1->>'staffId' <> 'd1640000-0000-4000-8000-000000000001'
     or v_l2->>'staffId' <> 'd1640000-0000-4000-8000-000000000001' then
    raise exception 'F11-02 expected one staff to serve the whole run';
  end if;
  if (v_l2->>'startsAt')::timestamptz <> (v_l1->>'endsAt')::timestamptz then
    raise exception 'F11-02 lines are not consecutive';
  end if;
  if (v_l1->>'occupiedStartsAt')::timestamptz <> (v_l1->>'startsAt')::timestamptz - interval '10 minutes' then
    raise exception 'F11-02 run lost its leading buffer';
  end if;
  if (v_l1->>'occupiedEndsAt')::timestamptz <> (v_l1->>'endsAt')::timestamptz then
    raise exception 'F11-02 inner buffer was not collapsed';
  end if;
  if (v_l2->>'occupiedStartsAt')::timestamptz <> (v_l2->>'startsAt')::timestamptz then
    raise exception 'F11-02 continuation line reapplied a leading buffer';
  end if;
  if (v_plan->>'endsAt')::timestamptz <> (v_l2->>'endsAt')::timestamptz then
    raise exception 'F11-02 group end does not match the last line';
  end if;
  raise notice 'F11-02 same-staff continuity plan accepted';
end
$$;

-- A forced staff change: blow-dry is only served by Berk, so the group spans two
-- people and each side keeps its own buffers.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_plan jsonb;
begin
  v_plan := public.f11_plan_group_at(
    'd1610000-0000-4000-8000-000000000001',
    '[{"serviceId":"d1630000-0000-4000-8000-000000000001"},{"serviceId":"d1630000-0000-4000-8000-000000000003"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul'
  );
  if v_plan is null then raise exception 'F11-02 mixed-staff plan missing'; end if;
  if v_plan->'lines'->0->>'staffId' <> 'd1640000-0000-4000-8000-000000000001'
     or v_plan->'lines'->1->>'staffId' <> 'd1640000-0000-4000-8000-000000000002' then
    raise exception 'F11-02 forced staff change not planned';
  end if;
  if (v_plan->'lines'->0->>'occupiedEndsAt')::timestamptz
     <> (v_plan->'lines'->0->>'endsAt')::timestamptz + interval '15 minutes' then
    raise exception 'F11-02 staff change dropped the trailing buffer';
  end if;
  raise notice 'F11-02 forced staff change accepted';
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

-- Slot search: every returned slot is a real plan and the advertised total is
-- the planned total.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_rows integer;
  v_bad integer;
begin
  select count(*)::integer into v_rows
  from public.compute_group_availability_slots(
    'd1610000-0000-4000-8000-000000000001', v_day,
    '[{"serviceId":"d1630000-0000-4000-8000-000000000001"},{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
    30
  );
  if v_rows = 0 then raise exception 'F11-02 expected group slots on an empty day'; end if;

  select count(*)::integer into v_bad
  from public.compute_group_availability_slots(
    'd1610000-0000-4000-8000-000000000001', v_day,
    '[{"serviceId":"d1630000-0000-4000-8000-000000000001"},{"serviceId":"d1630000-0000-4000-8000-000000000002"}]'::jsonb,
    30
  ) s
  where s.total_duration_minutes <> 90
     or s.ends_at <> s.starts_at + interval '90 minutes'
     or jsonb_array_length(s.lines) <> 2;
  if v_bad > 0 then raise exception 'F11-02 advertised slot does not match its plan'; end if;
  raise notice 'F11-02 slot search matches the committed plan';
end
$$;

-- Budgets are explicit errors, never a silently empty list.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_lines jsonb := '[]'::jsonb;
  v_raised boolean := false;
begin
  for i in 1..11 loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('serviceId','d1630000-0000-4000-8000-000000000002'));
  end loop;
  begin
    perform public.compute_group_availability_slots(
      'd1610000-0000-4000-8000-000000000001', v_day, v_lines, 30);
  exception when others then
    if sqlerrm not like '%GROUP_LINE_LIMIT_EXCEEDED%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'F11-02 line limit was not enforced'; end if;

  raise notice 'F11-02 line limit fails loudly';
end
$$;

-- The candidate budget stops a pathological single-date search: ten services at
-- a five minute step across a long opening day.
reset role;
update public.business_hours
set starts_local = time '07:00', ends_local = time '23:00'
where business_id = 'd1610000-0000-4000-8000-000000000001'
  and weekday = extract(dow from (date_trunc('week',current_date)::date+7))::smallint;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_lines jsonb := '[]'::jsonb;
  v_raised boolean := false;
begin
  for i in 1..10 loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('serviceId','d1630000-0000-4000-8000-000000000004'));
  end loop;
  begin
    perform public.compute_group_availability_slots(
      'd1610000-0000-4000-8000-000000000001', v_day, v_lines, 5);
  exception when others then
    if sqlerrm not like '%GROUP_SLOT_BUDGET_EXCEEDED%' then raise; end if;
    v_raised := true;
  end;
  if not v_raised then raise exception 'F11-02 probe budget was not enforced'; end if;
  raise notice 'F11-02 candidate budget fails loudly';
end
$$;

-- F11-04 timezone/DST acceptance: the multi-service engine must keep real
-- timestamptz identity and duration across IANA clock transitions. Phase-4
-- already proves the single-service engine; this is the group-level proof.
reset role;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'd1650000-0000-4000-8000-000000000001','F11-04 Berlin DST','f1104-berlin-dst',
  'Europe/Berlin','d1600000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'd1660000-0000-4000-8000-000000000001','d1650000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('d1670000-0000-4000-8000-000000000001','d1650000-0000-4000-8000-000000000001','DST A',30,0,0,'DST',10,1000,'fixed',1000,1000,'TRY',true),
  ('d1670000-0000-4000-8000-000000000002','d1650000-0000-4000-8000-000000000001','DST B',30,0,0,'DST',20,1000,'fixed',1000,1000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values ('d1680000-0000-4000-8000-000000000001','d1650000-0000-4000-8000-000000000001','Berlin Staff',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1650000-0000-4000-8000-000000000001','d1680000-0000-4000-8000-000000000001','d1670000-0000-4000-8000-000000000001',true),
  ('d1650000-0000-4000-8000-000000000001','d1680000-0000-4000-8000-000000000001','d1670000-0000-4000-8000-000000000002',true);

-- DST transitions are Sundays. Monday is also present for the local-day/UTC-day
-- boundary proof near midnight.
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values
  ('d1650000-0000-4000-8000-000000000001',0,time '01:00',time '04:00',true),
  ('d1650000-0000-4000-8000-000000000001',1,time '00:00',time '03:00',true);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('d1650000-0000-4000-8000-000000000001','d1680000-0000-4000-8000-000000000001',0,time '01:00',time '04:00',true),
  ('d1650000-0000-4000-8000-000000000001','d1680000-0000-4000-8000-000000000001',1,time '00:00',time '03:00',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','d1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_year integer := extract(year from current_date)::integer;
  v_spring date;
  v_fall date;
  v_boundary date := date_trunc('week',current_date)::date+7;
  v_lines jsonb := '[{"serviceId":"d1670000-0000-4000-8000-000000000001","staffId":"d1680000-0000-4000-8000-000000000001"},{"serviceId":"d1670000-0000-4000-8000-000000000002","staffId":"d1680000-0000-4000-8000-000000000001"}]'::jsonb;
  v_count integer;
  v_bad integer;
  v_start timestamptz;
  v_end timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_tz text;
  v_plan jsonb;
  v_l1 jsonb;
  v_l2 jsonb;
begin
  v_spring := make_date(v_year,3,31)-extract(dow from make_date(v_year,3,31))::integer;
  if v_spring < current_date-1 then
    v_year := v_year+1;
    v_spring := make_date(v_year,3,31)-extract(dow from make_date(v_year,3,31))::integer;
  end if;

  v_year := extract(year from current_date)::integer;
  v_fall := make_date(v_year,10,31)-extract(dow from make_date(v_year,10,31))::integer;
  if v_fall < current_date-1 then
    v_year := v_year+1;
    v_fall := make_date(v_year,10,31)-extract(dow from make_date(v_year,10,31))::integer;
  end if;

  -- Spring-forward: 02:xx never exists. A group starting at local 01:30 still
  -- has two real 30-minute lines: wall-clock labels jump 01:30 -> 03:00 while
  -- timestamptz duration remains exact.
  select count(*)::integer into v_count
  from public.compute_group_availability_slots(
    'd1650000-0000-4000-8000-000000000001',v_spring,v_lines,30
  ) s
  where (s.starts_at at time zone 'Europe/Berlin')::time >= time '02:00'
    and (s.starts_at at time zone 'Europe/Berlin')::time < time '03:00';
  if v_count <> 0 then raise exception 'F11-04 group engine emitted nonexistent spring 02:xx start'; end if;

  select s.starts_at,s.ends_at,s.timezone,s.lines
    into v_start,v_end,v_tz,v_plan
  from public.compute_group_availability_slots(
    'd1650000-0000-4000-8000-000000000001',v_spring,v_lines,30
  ) s
  where (s.starts_at at time zone 'Europe/Berlin')::time = time '01:30'
  limit 1;
  if v_start is null then raise exception 'F11-04 spring 01:30 group slot missing'; end if;
  v_l1 := v_plan->0;
  v_l2 := v_plan->1;
  if v_tz <> 'Europe/Berlin' or v_end-v_start <> interval '60 minutes' then
    raise exception 'F11-04 spring group lost timezone or real 60m duration';
  end if;
  if (v_l1->>'endsAt')::timestamptz-(v_l1->>'startsAt')::timestamptz <> interval '30 minutes'
     or (v_l2->>'endsAt')::timestamptz-(v_l2->>'startsAt')::timestamptz <> interval '30 minutes' then
    raise exception 'F11-04 spring line real duration drifted';
  end if;
  if ((v_l1->>'endsAt')::timestamptz at time zone 'Europe/Berlin')::time <> time '03:00' then
    raise exception 'F11-04 spring wall-clock jump did not land at 03:00';
  end if;
  if (v_l2->>'startsAt')::timestamptz <> (v_l1->>'endsAt')::timestamptz
     or (v_l1->>'occupiedEndsAt')::timestamptz <> (v_l1->>'endsAt')::timestamptz
     or (v_l2->>'occupiedStartsAt')::timestamptz <> (v_l2->>'startsAt')::timestamptz then
    raise exception 'F11-04 spring group sequence/zero-buffer occupancy drifted';
  end if;

  -- Fall-back: the two local 02:00 labels are two distinct instants one hour
  -- apart. Both are valid group starts and every service remains 30 real minutes.
  select count(*)::integer,min(s.starts_at),max(s.starts_at)
    into v_count,v_first,v_last
  from public.compute_group_availability_slots(
    'd1650000-0000-4000-8000-000000000001',v_fall,v_lines,30
  ) s
  where (s.starts_at at time zone 'Europe/Berlin')::time = time '02:00';
  if v_count <> 2 or v_last-v_first <> interval '1 hour' then
    raise exception 'F11-04 repeated fall 02:00 instants were collapsed: count=% span=%',v_count,v_last-v_first;
  end if;

  select count(*)::integer into v_bad
  from public.compute_group_availability_slots(
    'd1650000-0000-4000-8000-000000000001',v_fall,v_lines,30
  ) s
  cross join lateral jsonb_array_elements(s.lines) l
  where (s.starts_at at time zone 'Europe/Berlin')::time = time '02:00'
    and (l->>'endsAt')::timestamptz-(l->>'startsAt')::timestamptz <> interval '30 minutes';
  if v_bad <> 0 then raise exception 'F11-04 repeated-hour line duration drifted'; end if;

  select count(*)::integer into v_bad
  from public.compute_group_availability_slots(
    'd1650000-0000-4000-8000-000000000001',v_fall,v_lines,30
  ) s
  where (s.starts_at at time zone 'Europe/Berlin')::time = time '02:00'
    and s.ends_at-s.starts_at <> interval '60 minutes';
  if v_bad <> 0 then raise exception 'F11-04 repeated-hour group duration drifted'; end if;

  -- Local-day authority must not accidentally follow UTC. At Berlin 00:30 the
  -- UTC calendar date is still the previous day, while the slot belongs to the
  -- requested Monday business-local date.
  select s.starts_at,s.ends_at,s.timezone,s.lines
    into v_start,v_end,v_tz,v_plan
  from public.compute_group_availability_slots(
    'd1650000-0000-4000-8000-000000000001',v_boundary,v_lines,30
  ) s
  where (s.starts_at at time zone 'Europe/Berlin')::time = time '00:30'
  limit 1;
  if v_start is null then raise exception 'F11-04 local-day boundary slot missing'; end if;
  if (v_start at time zone 'Europe/Berlin')::date <> v_boundary
     or (v_start at time zone 'UTC')::date <> v_boundary-1 then
    raise exception 'F11-04 business-local date followed UTC at midnight boundary';
  end if;
  if v_end-v_start <> interval '60 minutes' or v_tz <> 'Europe/Berlin' then
    raise exception 'F11-04 local-day boundary duration/timezone drifted';
  end if;

  raise notice 'F11-04 group DST/timezone acceptance passed: spring skip, fall repeat, local-day identity';
end
$$;

rollback;
