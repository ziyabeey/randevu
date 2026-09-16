begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('e2100000-0000-4000-8000-000000000001','f11-02-owner@example.invalid','{}'::jsonb),
  ('e2100000-0000-4000-8000-000000000002','f11-02-recovery@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('e2110000-0000-4000-8000-000000000001','F11-02 A','f11-02-a','Europe/Istanbul','e2100000-0000-4000-8000-000000000001'),
  ('e2110000-0000-4000-8000-000000000002','F11-02 B','f11-02-b','Europe/Istanbul','e2100000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('e2120000-0000-4000-8000-000000000001','e2110000-0000-4000-8000-000000000001','e2100000-0000-4000-8000-000000000001','owner',true),
  ('e2120000-0000-4000-8000-000000000002','e2110000-0000-4000-8000-000000000002','e2100000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role=excluded.role,active=excluded.active;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,
  currency,active,processing_minutes,processing_staff_mode
) values
  ('e2130000-0000-4000-8000-000000000001','e2110000-0000-4000-8000-000000000001','Release Processing',30,0,0,'Renk',10,10000,'fixed',10000,10000,'TRY',true,60,'release'),
  ('e2130000-0000-4000-8000-000000000002','e2110000-0000-4000-8000-000000000001','Range Finish',30,0,0,'Bakım',20,20000,'range',20000,30000,'TRY',true,0,'hold'),
  ('e2130000-0000-4000-8000-000000000003','e2110000-0000-4000-8000-000000000001','Hold Processing',30,0,0,'Renk',30,12000,'fixed',12000,12000,'TRY',true,60,'hold'),
  ('e2130000-0000-4000-8000-000000000004','e2110000-0000-4000-8000-000000000001','Legacy Zero Processing',30,0,0,'Genel',40,5000,'fixed',5000,5000,'TRY',true,0,'hold'),
  ('e2130000-0000-4000-8000-000000000005','e2110000-0000-4000-8000-000000000001','Policy RPC Service',20,5,5,'Genel',50,6000,'fixed',6000,6000,'TRY',true,0,'hold'),
  ('e2130000-0000-4000-8000-000000000006','e2110000-0000-4000-8000-000000000002','Tenant B Service',30,0,0,'Genel',10,7000,'fixed',7000,7000,'TRY',true,0,'hold')
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values
  ('e2140000-0000-4000-8000-000000000001','e2110000-0000-4000-8000-000000000001','F11-02 Staff A',true),
  ('e2140000-0000-4000-8000-000000000002','e2110000-0000-4000-8000-000000000001','F11-02 Staff B',true),
  ('e2140000-0000-4000-8000-000000000003','e2110000-0000-4000-8000-000000000002','Tenant B Staff',true)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000001','e2130000-0000-4000-8000-000000000001',true),
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000001','e2130000-0000-4000-8000-000000000002',true),
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000001','e2130000-0000-4000-8000-000000000003',true),
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000001','e2130000-0000-4000-8000-000000000004',true),
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000002','e2130000-0000-4000-8000-000000000002',true),
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000002','e2130000-0000-4000-8000-000000000004',true),
  ('e2110000-0000-4000-8000-000000000001','e2140000-0000-4000-8000-000000000002','e2130000-0000-4000-8000-000000000005',true),
  ('e2110000-0000-4000-8000-000000000002','e2140000-0000-4000-8000-000000000003','e2130000-0000-4000-8000-000000000006',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'e2110000-0000-4000-8000-000000000001',
       extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
       time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'e2110000-0000-4000-8000-000000000001'::uuid,
       x.staff_id,
       extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
       time '09:00',time '18:00',true
from (values
  ('e2140000-0000-4000-8000-000000000001'::uuid),
  ('e2140000-0000-4000-8000-000000000002'::uuid)
) as x(staff_id);

insert into public.customers(id,business_id,name,phone,email,created_by)
values(
  'e2150000-0000-4000-8000-000000000001',
  'e2110000-0000-4000-8000-000000000001',
  'Existing Occupancy','05550000001','existing-occupancy@example.invalid',
  'e2100000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

-- New public functions are explicit, narrow API surfaces. Internal helpers remain
-- unreachable by API roles despite SECURITY DEFINER use.
do $$
begin
  if not has_function_privilege(
      'authenticated',
      'public.compute_booking_group_plans(uuid,jsonb,date,integer,integer)',
      'EXECUTE'
    )
     or has_function_privilege(
      'anon',
      'public.compute_booking_group_plans(uuid,jsonb,date,integer,integer)',
      'EXECUTE'
    ) then
    raise exception 'group planner ACL mismatch';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.create_booking_group(uuid,text,text,jsonb,timestamptz,text,text,text,text)',
      'EXECUTE'
    )
     or has_function_privilege(
      'anon',
      'public.create_booking_group(uuid,text,text,jsonb,timestamptz,text,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'group create ACL mismatch';
  end if;
  if has_function_privilege(
      'authenticated',
      'public.f11_build_group_plan_internal(uuid,timestamptz,jsonb)',
      'EXECUTE'
    )
     or has_function_privilege(
      'anon',
      'public.f11_claim_group_booking_command(uuid,text,text,text)',
      'EXECUTE'
    ) then
    raise exception 'internal F11-02 helper leaked EXECUTE';
  end if;
end
$$;

-- Guarded processing policy writes are manager-only, optimistic and versioned.
set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_before public.services;
  v_after public.services;
begin
  select * into v_before from public.services
  where id='e2130000-0000-4000-8000-000000000005';
  select * into v_after
  from public.update_service_processing_policy_guarded(
    'e2110000-0000-4000-8000-000000000001',
    v_before.id,
    v_before.updated_at,
    15,
    'release'
  );
  if v_after.processing_minutes <> 15
     or v_after.processing_staff_mode <> 'release'
     or v_after.processing_policy_version <> v_before.processing_policy_version + 1 then
    raise exception 'processing policy update did not version atomically';
  end if;
end
$$;
reset role;

-- Legacy zero-processing create remains compatible and supplies an existing
-- appointment during the future RELEASE/HOLD interval.
set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v public.appointments;
begin
  select * into v
  from public.create_appointment(
    'e2110000-0000-4000-8000-000000000001',
    'f11-02-existing-0001',
    'Existing Occupancy',
    'e2130000-0000-4000-8000-000000000004',
    'e2140000-0000-4000-8000-000000000001',
    (v_day+time '10:45') at time zone 'Europe/Istanbul',
    '05550000001','existing-occupancy@example.invalid',null
  );
  if v.processing_minutes_snapshot <> 0
     or v.processing_staff_mode_snapshot <> 'hold'
     or v.processing_policy_version_snapshot <> 1 then
    raise exception 'legacy zero-processing snapshot compatibility failed';
  end if;
end
$$;
reset role;

-- RELEASE permits another appointment during passive processing, while HOLD
-- retains the staff through that same customer processing interval.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_release jsonb;
  v_hold jsonb;
begin
  v_release := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000001','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000001')
    )
  );
  if v_release is null then raise exception 'RELEASE policy did not free passive staff capacity'; end if;
  if v_release->>'lowerMinor' <> '30000' or v_release->>'upperMinor' <> '40000' then
    raise exception 'group range estimate mismatch';
  end if;
  if v_release->'lines'->0->>'processingStaffMode' <> 'release'
     or v_release->'lines'->0->>'processingMinutes' <> '60'
     or (v_release->'lines'->0->>'endsAt')::timestamptz
        <= (v_release->'lines'->0->>'occupiedEndsAt')::timestamptz then
    raise exception 'RELEASE plan did not separate customer and staff timelines';
  end if;

  v_hold := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000003','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000001')
    )
  );
  if v_hold is not null then raise exception 'HOLD policy incorrectly released passive staff capacity'; end if;
end
$$;

-- Same-staff and different-staff sequential plans are both valid when their
-- staff occupancy fits. The authenticated date wrapper remains standard-session
-- only and returns server fingerprints rather than client-authored totals.
set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_same jsonb;
  v_diff jsonb;
  v_page jsonb;
begin
  v_same := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000004','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000001')
    )
  );
  v_diff := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000001','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000002')
    )
  );
  if v_same is null or v_diff is null then raise exception 'valid same/different staff plan missing'; end if;
  if v_diff->>'fingerprint' !~ '^[0-9a-f]{64}$' then raise exception 'plan fingerprint missing'; end if;

  v_page := public.compute_booking_group_plans(
    'e2110000-0000-4000-8000-000000000001',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000004','staffId','e2140000-0000-4000-8000-000000000002')
    ),
    v_day,
    30,
    3
  );
  if jsonb_array_length(v_page->'plans') < 1
     or not (v_page ? 'truncated') then
    raise exception 'bounded group plan page missing';
  end if;
end
$$;
reset role;

-- Recovery AMR cannot use the new normal operator planner.
set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $$
declare v_day date:=date_trunc('week',current_date)::date+7;
begin
  begin
    perform public.compute_booking_group_plans(
      'e2110000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'serviceId','e2130000-0000-4000-8000-000000000004',
        'staffId','e2140000-0000-4000-8000-000000000001'
      )),
      v_day,15,10
    );
    raise exception 'recovery unexpectedly planned group booking';
  exception when others then
    if sqlerrm='recovery unexpectedly planned group booking' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

-- Create a two-line group with different staff and a range estimate. One command,
-- one group-level create event, exact replay and changed-payload conflict are all
-- asserted against the existing booking_commands ledger.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_plan jsonb;
begin
  v_plan := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000001','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000002')
    )
  );
  if v_plan is null then raise exception 'create plan missing'; end if;
  perform set_config('f11_02.create_fingerprint',v_plan->>'fingerprint',false);
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_result jsonb;
  v_replay jsonb;
  v_group uuid;
begin
  v_result := public.create_booking_group(
    'e2110000-0000-4000-8000-000000000001',
    'f11-02-group-create-0001',
    'Atomic Group Customer',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000001','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000002')
    ),
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    current_setting('f11_02.create_fingerprint'),
    '05551112222','atomic-group@example.invalid','group note'
  );
  v_group := (v_result->>'groupId')::uuid;
  if v_group is null
     or v_result->>'source' <> 'operator'
     or v_result->>'version' <> '1'
     or v_result->>'lowerMinor' <> '30000'
     or v_result->>'upperMinor' <> '40000'
     or jsonb_array_length(v_result->'lines') <> 2 then
    raise exception 'atomic group result mismatch';
  end if;
  perform set_config('f11_02.created_group',v_group::text,false);

  v_replay := public.create_booking_group(
    'e2110000-0000-4000-8000-000000000001',
    'f11-02-group-create-0001',
    'Atomic Group Customer',
    jsonb_build_array(
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000001','staffId','e2140000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000002')
    ),
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    current_setting('f11_02.create_fingerprint'),
    '05551112222','atomic-group@example.invalid','group note'
  );
  if (v_replay->>'groupId')::uuid <> v_group then
    raise exception 'same-key exact replay did not return original group';
  end if;

  begin
    perform public.create_booking_group(
      'e2110000-0000-4000-8000-000000000001',
      'f11-02-group-create-0001',
      'Atomic Group Customer',
      jsonb_build_array(
        jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000002','staffId','e2140000-0000-4000-8000-000000000002'),
        jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000001','staffId','e2140000-0000-4000-8000-000000000001')
      ),
      (v_day+time '12:00') at time zone 'Europe/Istanbul',
      current_setting('f11_02.create_fingerprint'),
      '05551112222','atomic-group@example.invalid','group note'
    );
    raise exception 'changed payload reused idempotency key';
  exception when others then
    if sqlerrm='changed payload reused idempotency key' then raise; end if;
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

do $$
declare v_group uuid:=current_setting('f11_02.created_group')::uuid;
begin
  if (select count(*) from public.appointments where group_id=v_group) <> 2 then
    raise exception 'atomic group did not persist exactly two lines';
  end if;
  if (select count(*) from public.booking_commands
      where business_id='e2110000-0000-4000-8000-000000000001'
        and idempotency_key='f11-02-group-create-0001'
        and group_id=v_group and appointment_id is null and command='group_create') <> 1 then
    raise exception 'group idempotency ledger mismatch';
  end if;
  if (select count(*) from public.appointment_events
      where business_id='e2110000-0000-4000-8000-000000000001'
        and group_id=v_group and appointment_id is null
        and event_type='created' and group_version=1) <> 1 then
    raise exception 'group create did not emit one group-level event';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.group_id=v_group
      and a.service_id='e2130000-0000-4000-8000-000000000002'
      and a.price_type_snapshot='range'
      and a.price_minor_snapshot is null
      and a.price_min_minor_snapshot=20000
      and a.price_max_minor_snapshot=30000
  ) then raise exception 'range line snapshot lost estimate semantics'; end if;
end
$$;

-- Catalog policy changes after creation cannot rewrite frozen history.
update public.services
set processing_staff_mode='hold'
where id='e2130000-0000-4000-8000-000000000001';

do $$
declare v_group uuid:=current_setting('f11_02.created_group')::uuid;
begin
  if not exists (
    select 1 from public.appointments a
    where a.group_id=v_group
      and a.service_id='e2130000-0000-4000-8000-000000000001'
      and a.processing_minutes_snapshot=60
      and a.processing_staff_mode_snapshot='release'
      and a.processing_policy_version_snapshot=1
  ) then raise exception 'processing policy edit rewrote frozen booking history'; end if;

  begin
    update public.appointments
    set processing_staff_mode_snapshot='hold'
    where group_id=v_group and line_ordinal=1;
    raise exception 'frozen processing snapshot unexpectedly mutated';
  exception when others then
    if sqlerrm='frozen processing snapshot unexpectedly mutated' then raise; end if;
    if position('APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- A stale server plan fingerprint after a price-policy edit fails closed and the
-- command/customer/group writes from the failed statement are rolled back.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_plan jsonb;
begin
  v_plan := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '14:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(jsonb_build_object(
      'serviceId','e2130000-0000-4000-8000-000000000005',
      'staffId','e2140000-0000-4000-8000-000000000002'
    ))
  );
  perform set_config('f11_02.stale_fingerprint',v_plan->>'fingerprint',false);
end
$$;

update public.services set price_minor=6500
where id='e2130000-0000-4000-8000-000000000005';

set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_day date:=date_trunc('week',current_date)::date+7;
begin
  begin
    perform public.create_booking_group(
      'e2110000-0000-4000-8000-000000000001',
      'f11-02-stale-plan-0001','Stale Plan Customer',
      jsonb_build_array(jsonb_build_object(
        'serviceId','e2130000-0000-4000-8000-000000000005',
        'staffId','e2140000-0000-4000-8000-000000000002'
      )),
      (v_day+time '14:00') at time zone 'Europe/Istanbul',
      current_setting('f11_02.stale_fingerprint'),
      '05553334444','stale-plan@example.invalid',null
    );
    raise exception 'stale plan unexpectedly committed';
  exception when others then
    if sqlerrm='stale plan unexpectedly committed' then raise; end if;
    if position('BOOKING_PLAN_STALE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.booking_commands
    where business_id='e2110000-0000-4000-8000-000000000001'
      and idempotency_key='f11-02-stale-plan-0001'
  ) or exists (
    select 1 from public.customers
    where business_id='e2110000-0000-4000-8000-000000000001'
      and email='stale-plan@example.invalid'
  ) then raise exception 'stale-plan failure left partial writes'; end if;
end
$$;

-- A slot lost after planning produces a clean conflict and leaves no group/line
-- state from the failed create.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_plan jsonb;
begin
  v_plan := public.f11_build_group_plan_internal(
    'e2110000-0000-4000-8000-000000000001',
    (v_day+time '15:00') at time zone 'Europe/Istanbul',
    jsonb_build_array(jsonb_build_object(
      'serviceId','e2130000-0000-4000-8000-000000000004',
      'staffId','e2140000-0000-4000-8000-000000000002'
    ))
  );
  perform set_config('f11_02.lost_fingerprint',v_plan->>'fingerprint',false);
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','e2100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_day date:=date_trunc('week',current_date)::date+7;
begin
  perform public.create_appointment(
    'e2110000-0000-4000-8000-000000000001',
    'f11-02-slot-taken-0001','Slot Winner',
    'e2130000-0000-4000-8000-000000000004',
    'e2140000-0000-4000-8000-000000000002',
    (v_day+time '15:00') at time zone 'Europe/Istanbul',
    '05555550000','slot-winner@example.invalid',null
  );

  begin
    perform public.create_booking_group(
      'e2110000-0000-4000-8000-000000000001',
      'f11-02-lost-slot-0001','Rollback Customer',
      jsonb_build_array(jsonb_build_object(
        'serviceId','e2130000-0000-4000-8000-000000000004',
        'staffId','e2140000-0000-4000-8000-000000000002'
      )),
      (v_day+time '15:00') at time zone 'Europe/Istanbul',
      current_setting('f11_02.lost_fingerprint'),
      '05556660000','rollback-customer@example.invalid',null
    );
    raise exception 'lost slot unexpectedly committed';
  exception when others then
    if sqlerrm='lost slot unexpectedly committed' then raise; end if;
    if position('SLOT_UNAVAILABLE' in sqlerrm)=0
       and position('APPOINTMENT_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.booking_commands
    where business_id='e2110000-0000-4000-8000-000000000001'
      and idempotency_key='f11-02-lost-slot-0001'
  ) or exists (
    select 1 from public.customers
    where business_id='e2110000-0000-4000-8000-000000000001'
      and email='rollback-customer@example.invalid'
  ) then raise exception 'lost-slot failure left partial group/customer/command state'; end if;
end
$$;

-- Tenant-scoped service/staff authority fails closed.
do $$
begin
  begin
    perform public.f11_normalize_group_intent_internal(
      'e2110000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'serviceId','e2130000-0000-4000-8000-000000000006',
        'staffId','e2140000-0000-4000-8000-000000000003'
      ))
    );
    raise exception 'cross-tenant service unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-tenant service unexpectedly accepted' then raise; end if;
    if position('SERVICE_NOT_FOUND' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.f11_normalize_group_intent_internal(
      'e2110000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'serviceId','e2130000-0000-4000-8000-000000000004',
        'staffId','e2140000-0000-4000-8000-000000000003'
      ))
    );
    raise exception 'cross-tenant staff unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-tenant staff unexpectedly accepted' then raise; end if;
    if position('STAFF_NOT_ELIGIBLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- K03 candidate combinations are bounded before slot search or any write.
with inserted_staff as (
  insert into public.staff_profiles(id,business_id,name,active)
  select gen_random_uuid(),'e2110000-0000-4000-8000-000000000001',
         'Budget Staff ' || g::text,true
  from generate_series(1,46) g
  returning id,business_id
)
insert into public.staff_services(business_id,staff_id,service_id,active)
select s.business_id,s.id,v.service_id,true
from inserted_staff s
cross join (values
  ('e2130000-0000-4000-8000-000000000004'::uuid),
  ('e2130000-0000-4000-8000-000000000005'::uuid)
) as v(service_id);

do $$
begin
  begin
    perform public.f11_normalize_group_intent_internal(
      'e2110000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000004'),
        jsonb_build_object('serviceId','e2130000-0000-4000-8000-000000000005')
      )
    );
    raise exception 'candidate budget overflow unexpectedly accepted';
  exception when others then
    if sqlerrm='candidate budget overflow unexpectedly accepted' then raise; end if;
    if position('BOOKING_CANDIDATE_BUDGET_EXCEEDED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

do $$
begin
  raise notice 'F11-02 multi-service planner and atomic operator create accepted';
end
$$;

rollback;
