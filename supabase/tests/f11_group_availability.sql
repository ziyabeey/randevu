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
  -- Services are consecutive: the cut starts exactly when the colour ends.
  if (v_l2->>'startsAt')::timestamptz <> (v_l1->>'endsAt')::timestamptz then
    raise exception 'F11-02 lines are not consecutive';
  end if;
  -- The run keeps the outer buffers only.
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

rollback;
