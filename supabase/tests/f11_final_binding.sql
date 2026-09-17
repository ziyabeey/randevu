begin;

create function pg_temp.f11b_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F11 final binding: %', p_message;
  end if;
end
$$;

create function pg_temp.f11b_public_key(
  p_recovery_id uuid,
  p_deadline bigint,
  p_secret_hash text
)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_secret_hash,'UTF8'),'sha256'),'hex');
$$;

grant execute on function pg_temp.f11b_assert(boolean,text) to anon,authenticated;
grant execute on function pg_temp.f11b_public_key(uuid,bigint,text) to anon;

insert into auth.users(id,email,raw_user_meta_data)
values ('fb100000-0000-4000-8000-000000000001','f11-binding-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('fb110000-0000-4000-8000-000000000001','F11 Final Binding','f11-final-binding','Europe/Istanbul','fb100000-0000-4000-8000-000000000001'),
  ('fb110000-0000-4000-8000-000000000002','F11 Foreign Binding','f11-foreign-binding','Europe/Istanbul','fb100000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'fb120000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active,
  processing_capacity_policy,passive_wait_minutes
) values
  (
    'fb130000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
    'Snapshot Release',60,0,0,'F11',10,10000,'range',10000,14000,'TRY',true,'RELEASE',30
  ),
  (
    'fb130000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000001',
    'Hold',60,0,0,'F11',20,20000,'fixed',20000,20000,'TRY',true,'HOLD',30
  ),
  (
    'fb130000-0000-4000-8000-000000000003','fb110000-0000-4000-8000-000000000001',
    'Estimate Addon',30,0,0,'F11',30,7000,'fixed',7000,7000,'TRY',true,'HOLD',0
  ),
  (
    'fb130000-0000-4000-8000-000000000004','fb110000-0000-4000-8000-000000000001',
    'Euro Service',30,0,0,'F11',40,9000,'fixed',9000,9000,'EUR',true,'HOLD',0
  ),
  (
    'fb130000-0000-4000-8000-000000000005','fb110000-0000-4000-8000-000000000001',
    'Inactive Service',30,0,0,'F11',50,8000,'fixed',8000,8000,'TRY',false,'HOLD',0
  ),
  (
    'fb130000-0000-4000-8000-000000000007','fb110000-0000-4000-8000-000000000001',
    'Release',60,0,0,'F11',70,11000,'fixed',11000,11000,'TRY',true,'RELEASE',30
  ),
  (
    'fb130000-0000-4000-8000-000000000006','fb110000-0000-4000-8000-000000000002',
    'Foreign Service',30,0,0,'F11',10,6000,'fixed',6000,6000,'TRY',true,'HOLD',0
  );

insert into public.staff_profiles(id,business_id,name,active)
values (
  'fb140000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  'F11 Binding Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'fb110000-0000-4000-8000-000000000001'::uuid,
  'fb140000-0000-4000-8000-000000000001'::uuid,
  x.service_id,
  true
from (values
  ('fb130000-0000-4000-8000-000000000001'::uuid),
  ('fb130000-0000-4000-8000-000000000002'::uuid),
  ('fb130000-0000-4000-8000-000000000003'::uuid),
  ('fb130000-0000-4000-8000-000000000004'::uuid),
  ('fb130000-0000-4000-8000-000000000007'::uuid)
) x(service_id);

-- All weekdays are present so the public readiness gate and the dynamically
-- selected test date use the same complete operational fixture.
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'fb110000-0000-4000-8000-000000000001',d,time '09:00',time '18:00',true
from generate_series(0,6) d;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'fb110000-0000-4000-8000-000000000001',
  'fb140000-0000-4000-8000-000000000001',
  d,time '09:00',time '18:00',true
from generate_series(0,6) d;

insert into public.public_booking_settings(
  business_id,enabled,step_minutes,min_notice_minutes,horizon_days
) values ('fb110000-0000-4000-8000-000000000001',true,30,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=30,min_notice_minutes=0,horizon_days=30;

-- A staff-only block beginning at RELEASE active-end must not consume the
-- passive tail. HOLD at the same relative point remains unavailable.
insert into public.availability_blocks(
  id,business_id,staff_id,starts_at,ends_at,reason,active
)
select
  x.id,
  'fb110000-0000-4000-8000-000000000001',
  x.staff_id,
  ((date_trunc('week',current_date)::date+7)+x.starts_local) at time zone 'Europe/Istanbul',
  ((date_trunc('week',current_date)::date+7)+x.ends_local) at time zone 'Europe/Istanbul',
  x.reason,
  true
from (values
  ('fb170000-0000-4000-8000-000000000001'::uuid,'fb140000-0000-4000-8000-000000000001'::uuid,time '12:30',time '13:00','release tail'),
  ('fb170000-0000-4000-8000-000000000002'::uuid,'fb140000-0000-4000-8000-000000000001'::uuid,time '13:30',time '14:00','operator hold tail'),
  ('fb170000-0000-4000-8000-000000000003'::uuid,'fb140000-0000-4000-8000-000000000001'::uuid,time '15:30',time '16:00','public hold tail'),
  ('fb170000-0000-4000-8000-000000000004'::uuid,null::uuid,time '14:30',time '15:00','tenant closure in release tail'),
  ('fb170000-0000-4000-8000-000000000005'::uuid,null::uuid,time '11:00',time '11:30','half-open boundary')
) x(id,staff_id,starts_local,ends_local,reason);

-- Planner/slot binding: 17:00 has a full customer end at close and survives;
-- 17:30 releases staff at close but the customer interval ends after close.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_lines jsonb:='[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb;
  v_at_close jsonb;
  v_hold jsonb;
begin
  v_at_close:=public.f11_plan_group_at(
    'fb110000-0000-4000-8000-000000000001',v_lines,
    (v_day+time '17:00') at time zone 'Europe/Istanbul'
  );
  perform pg_temp.f11b_assert(
    v_at_close is not null
      and (v_at_close->>'endsAt')::timestamptz=(v_day+time '18:00') at time zone 'Europe/Istanbul'
      and (v_at_close#>>'{lines,0,occupiedEndsAt}')::timestamptz=(v_day+time '17:30') at time zone 'Europe/Istanbul',
    'RELEASE ending exactly at business close was not planned with shortened staff occupancy'
  );
  perform pg_temp.f11b_assert(
    public.f11_plan_group_at(
      'fb110000-0000-4000-8000-000000000001',v_lines,
      (v_day+time '17:30') at time zone 'Europe/Istanbul'
    ) is null,
    'RELEASE customer interval beyond business close was accepted'
  );
  perform pg_temp.f11b_assert(
    public.f11_plan_group_at(
      'fb110000-0000-4000-8000-000000000001',v_lines,
      (v_day+time '14:00') at time zone 'Europe/Istanbul'
    ) is null,
    'tenant closure overlapping only the RELEASE tail was ignored'
  );
  perform pg_temp.f11b_assert(
    public.f11_plan_group_at(
      'fb110000-0000-4000-8000-000000000001',v_lines,
      (v_day+time '10:00') at time zone 'Europe/Istanbul'
    ) is not null,
    'tenant closure touching the service end violated half-open behavior'
  );
  v_hold:=public.f11_plan_group_at(
    'fb110000-0000-4000-8000-000000000001',
    '[{"serviceId":"fb130000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '16:00') at time zone 'Europe/Istanbul'
  );
  perform pg_temp.f11b_assert(
    v_hold#>>'{lines,0,processingCapacityPolicy}'='HOLD'
      and (v_hold#>>'{lines,0,passiveWaitMinutes}')::integer=30
      and (v_hold#>>'{lines,0,endsAt}')::timestamptz=(v_day+time '17:00') at time zone 'Europe/Istanbul'
      and (v_hold#>>'{lines,0,occupiedEndsAt}')::timestamptz=(v_day+time '17:00') at time zone 'Europe/Istanbul',
    'HOLD incorrectly shortened staff occupancy by passive wait'
  );
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','fb100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_lines jsonb:='[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb;
begin
  perform pg_temp.f11b_assert(exists(
    select 1 from public.compute_group_availability_slots(
      'fb110000-0000-4000-8000-000000000001',v_day,v_lines,30
    ) s where s.starts_at=(v_day+time '17:00') at time zone 'Europe/Istanbul'
      and s.ends_at=(v_day+time '18:00') at time zone 'Europe/Istanbul'
  ),'slot engine omitted the exact-close RELEASE interval');
  perform pg_temp.f11b_assert(not exists(
    select 1 from public.compute_group_availability_slots(
      'fb110000-0000-4000-8000-000000000001',v_day,v_lines,30
    ) s where s.starts_at=(v_day+time '17:30') at time zone 'Europe/Istanbul'
  ),'slot engine advertised a RELEASE interval ending after close');
end
$$;

-- Server-derived estimate and ordered service snapshots are authoritative.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_result jsonb;
begin
  v_result:=public.create_appointment_group(
    'fb110000-0000-4000-8000-000000000001','f11-binding-estimate-operator',
    'Estimate Customer',jsonb_build_array(
      jsonb_build_object('serviceId','fb130000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','fb130000-0000-4000-8000-000000000003')
    ),(v_day+time '09:00') at time zone 'Europe/Istanbul'
  );
  perform pg_temp.f11b_assert(
    (v_result->>'estimateMinMinor')::integer=17000
      and (v_result->>'estimateMaxMinor')::integer=21000
      and v_result->>'currency'='TRY'
      and jsonb_array_length(v_result->'lines')=2,
    'operator create did not return the authoritative catalog estimate'
  );
  perform set_config('f11b.snapshot_group',v_result->>'groupId',false);
  perform set_config('f11b.snapshot_payload',v_result::text,false);
  perform set_config('f11b.snapshot_policy_version',v_result#>>'{lines,0,processingPolicyVersion}',false);
end
$$;

-- RELEASE accepts a staff-only closure in the passive tail.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_result jsonb;
begin
  v_result:=public.create_appointment_group(
    'fb110000-0000-4000-8000-000000000001','f11-binding-release-operator',
    'Release Operator Customer',
    '[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb,
    (v_day+time '12:00') at time zone 'Europe/Istanbul'
  );
  perform pg_temp.f11b_assert(
    v_result#>>'{lines,0,processingCapacityPolicy}'='RELEASE'
      and (v_result#>>'{lines,0,passiveWaitMinutes}')::integer=30
      and (v_result#>>'{lines,0,occupiedEndsAt}')::timestamptz=(v_day+time '12:30') at time zone 'Europe/Istanbul'
      and (v_result#>>'{lines,0,endsAt}')::timestamptz=(v_day+time '13:00') at time zone 'Europe/Istanbul',
    'operator RELEASE did not preserve the passive-tail occupancy contract'
  );
end
$$;

-- HOLD cannot ignore that same kind of staff-only tail closure. Tenant closure
-- overlap and a customer end beyond close also fail atomically.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_failed boolean;
begin
  v_failed:=false;
  begin
    perform public.create_appointment_group(
      'fb110000-0000-4000-8000-000000000001','f11-binding-hold-operator',
      'Hold Operator Customer','[{"serviceId":"fb130000-0000-4000-8000-000000000002"}]'::jsonb,
      (v_day+time '13:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if position('GROUP_SLOT_UNAVAILABLE' in sqlerrm)=0 then raise; end if;
    v_failed:=true;
  end;
  perform pg_temp.f11b_assert(v_failed,'operator HOLD ignored a staff closure');

  v_failed:=false;
  begin
    perform public.create_appointment_group(
      'fb110000-0000-4000-8000-000000000001','f11-binding-tenant-operator',
      'Tenant Closure Customer','[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb,
      (v_day+time '14:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if position('GROUP_SLOT_UNAVAILABLE' in sqlerrm)=0 then raise; end if;
    v_failed:=true;
  end;
  perform pg_temp.f11b_assert(v_failed,'operator RELEASE ignored a tenant closure in its tail');

  v_failed:=false;
  begin
    perform public.create_appointment_group(
      'fb110000-0000-4000-8000-000000000001','f11-binding-late-operator',
      'Late Customer','[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb,
      (v_day+time '17:30') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if position('GROUP_SLOT_UNAVAILABLE' in sqlerrm)=0 then raise; end if;
    v_failed:=true;
  end;
  perform pg_temp.f11b_assert(v_failed,'operator RELEASE accepted a customer end after close');
end
$$;

reset role;

-- Changing current catalog policy after create cannot rewrite the line's frozen
-- processing policy, passive wait, or combined policy version.
update public.services
set processing_capacity_policy='HOLD',passive_wait_minutes=0
where id='fb130000-0000-4000-8000-000000000001';

select pg_temp.f11b_assert(
  (select count(*)=2
   from public.appointments a
   where a.business_id='fb110000-0000-4000-8000-000000000001'
     and a.group_id=current_setting('f11b.snapshot_group')::uuid)
  and (select sum(a.price_min_minor_snapshot)=17000
            and sum(a.price_max_minor_snapshot)=21000
            and count(distinct a.currency_snapshot)=1
       from public.appointments a
       where a.business_id='fb110000-0000-4000-8000-000000000001'
         and a.group_id=current_setting('f11b.snapshot_group')::uuid)
  and exists(
    select 1 from public.appointments a
    where a.business_id='fb110000-0000-4000-8000-000000000001'
      and a.group_id=current_setting('f11b.snapshot_group')::uuid
      and a.line_ordinal=1
      and a.processing_capacity_policy_snapshot='RELEASE'
      and a.passive_wait_minutes_snapshot=30
      and a.processing_policy_version_snapshot=current_setting('f11b.snapshot_policy_version')::bigint
      and a.processing_policy_version_snapshot <>
        (select b.processing_policy_version::bigint*1000000+s.processing_policy_version::bigint
         from public.services s join public.businesses b on b.id=s.business_id
         where s.id='fb130000-0000-4000-8000-000000000001')
  ),
  'catalog update rewrote a frozen processing or estimate snapshot'
);

-- Completed command identity survives current catalog changes. The same
-- invalid current catalog must still reject a fresh command before writes.
select set_config('f11b.pre_replay_state',jsonb_build_object(
  'customers',(select count(*) from public.customers where business_id='fb110000-0000-4000-8000-000000000001'),
  'events',(select count(*) from public.appointment_events where business_id='fb110000-0000-4000-8000-000000000001'),
  'groups',(select count(*) from public.appointment_groups where business_id='fb110000-0000-4000-8000-000000000001'),
  'lines',(select count(*) from public.appointments where business_id='fb110000-0000-4000-8000-000000000001'),
  'commands',(select count(*) from public.booking_commands where business_id='fb110000-0000-4000-8000-000000000001')
)::text,false);
update public.services set active=false
where id='fb130000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','fb100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_lines jsonb:='[{"serviceId":"fb130000-0000-4000-8000-000000000001"},{"serviceId":"fb130000-0000-4000-8000-000000000003"}]'::jsonb;
  v_result jsonb;
  v_case record;
  v_failed boolean;
  v_too_many jsonb;
begin
  v_result:=public.create_appointment_group(
    'fb110000-0000-4000-8000-000000000001','f11-binding-estimate-operator',
    'Estimate Customer',v_lines,(v_day+time '09:00') at time zone 'Europe/Istanbul'
  );
  perform pg_temp.f11b_assert(
    v_result=current_setting('f11b.snapshot_payload')::jsonb,
    'same-key replay after service archive changed or lost the frozen result'
  );

  for v_case in select * from (values
    ('f11-binding-estimate-operator','Changed Estimate Customer','IDEMPOTENCY_CONFLICT'),
    ('f11-binding-fresh-archived','Estimate Customer','SERVICE_NOT_FOUND')
  ) x(command_key,customer_name,error_name)
  loop
    v_failed:=false;
    begin
      perform public.create_appointment_group(
        'fb110000-0000-4000-8000-000000000001',v_case.command_key,
        v_case.customer_name,v_lines,(v_day+time '09:00') at time zone 'Europe/Istanbul'
      );
    exception when others then
      if position(v_case.error_name in sqlerrm)=0 then raise; end if;
      v_failed:=true;
    end;
    perform pg_temp.f11b_assert(v_failed,v_case.command_key||' did not fail with '||v_case.error_name);
  end loop;

  select jsonb_agg(jsonb_build_object('serviceId','fb130000-0000-4000-8000-000000000001'))
  into v_too_many from generate_series(1,11);
  v_failed:=false;
  begin
    perform public.create_appointment_group(
      'fb110000-0000-4000-8000-000000000001','f11-binding-estimate-operator',
      'Estimate Customer',v_too_many,(v_day+time '09:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if position('GROUP_LINE_LIMIT_EXCEEDED' in sqlerrm)=0 then raise; end if;
    v_failed:=true;
  end;
  perform pg_temp.f11b_assert(v_failed,'existing-command replay bypassed the group line limit');
end
$$;

reset role;
update public.services set active=true,currency='EUR'
where id='fb130000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','fb100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_lines jsonb:='[{"serviceId":"fb130000-0000-4000-8000-000000000001"},{"serviceId":"fb130000-0000-4000-8000-000000000003"}]'::jsonb;
  v_result jsonb;
  v_failed boolean:=false;
begin
  v_result:=public.create_appointment_group(
    'fb110000-0000-4000-8000-000000000001','f11-binding-estimate-operator',
    'Estimate Customer',v_lines,(v_day+time '09:00') at time zone 'Europe/Istanbul'
  );
  perform pg_temp.f11b_assert(
    v_result=current_setting('f11b.snapshot_payload')::jsonb,
    'same-key replay after currency change changed or lost the frozen result'
  );
  begin
    perform public.create_appointment_group(
      'fb110000-0000-4000-8000-000000000001','f11-binding-fresh-currency',
      'Estimate Customer',v_lines,(v_day+time '09:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if position('MIXED_CURRENCY' in sqlerrm)=0 then raise; end if;
    v_failed:=true;
  end;
  perform pg_temp.f11b_assert(v_failed,'fresh mixed-currency request bypassed catalog validation');
end
$$;

reset role;
update public.services set currency='TRY'
where id='fb130000-0000-4000-8000-000000000001';

select pg_temp.f11b_assert(
  jsonb_build_object(
    'customers',(select count(*) from public.customers where business_id='fb110000-0000-4000-8000-000000000001'),
    'events',(select count(*) from public.appointment_events where business_id='fb110000-0000-4000-8000-000000000001'),
    'groups',(select count(*) from public.appointment_groups where business_id='fb110000-0000-4000-8000-000000000001'),
    'lines',(select count(*) from public.appointments where business_id='fb110000-0000-4000-8000-000000000001'),
    'commands',(select count(*) from public.booking_commands where business_id='fb110000-0000-4000-8000-000000000001')
  )=current_setting('f11b.pre_replay_state')::jsonb
  and (select count(*)=1 from public.booking_commands bc
   where bc.business_id='fb110000-0000-4000-8000-000000000001'
     and bc.idempotency_key='f11-binding-estimate-operator')
  and (select count(*)=2 from public.appointments a
       where a.group_id=current_setting('f11b.snapshot_group')::uuid)
  and (select count(*)=1 from public.appointment_events e
       join public.appointments a on a.business_id=e.business_id and a.id=e.appointment_id
       where a.group_id=current_setting('f11b.snapshot_group')::uuid and e.event_type='created')
  and not exists(select 1 from public.booking_commands bc
    where bc.business_id='fb110000-0000-4000-8000-000000000001'
      and bc.idempotency_key in ('f11-binding-fresh-archived','f11-binding-fresh-currency')),
  'catalog-change replay duplicated durable records or invalid fresh commands survived'
);

-- Binding validation happens before durable command/customer/group writes.
select set_config('f11b.pre_groups',(select count(*)::text from public.appointment_groups
  where business_id='fb110000-0000-4000-8000-000000000001'),false);
select set_config('f11b.pre_lines',(select count(*)::text from public.appointments
  where business_id='fb110000-0000-4000-8000-000000000001'),false);
select set_config('f11b.pre_customers',(select count(*)::text from public.customers
  where business_id='fb110000-0000-4000-8000-000000000001'),false);
select set_config('f11b.pre_events',(select count(*)::text from public.appointment_events
  where business_id='fb110000-0000-4000-8000-000000000001'),false);

set local role authenticated;
select set_config('request.jwt.claim.sub','fb100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_case record;
  v_failed boolean;
begin
  for v_case in select * from (values
    ('f11-binding-foreign-service','[{"serviceId":"fb130000-0000-4000-8000-000000000007"},{"serviceId":"fb130000-0000-4000-8000-000000000006"}]'::jsonb,'SERVICE_NOT_FOUND'),
    ('f11-binding-missing-service','[{"serviceId":"fb130000-0000-4000-8000-000000000007"},{"serviceId":"fb130000-0000-4000-8000-000000000099"}]'::jsonb,'SERVICE_NOT_FOUND'),
    ('f11-binding-inactive-service','[{"serviceId":"fb130000-0000-4000-8000-000000000007"},{"serviceId":"fb130000-0000-4000-8000-000000000005"}]'::jsonb,'SERVICE_NOT_FOUND'),
    ('f11-binding-mixed-currency','[{"serviceId":"fb130000-0000-4000-8000-000000000007"},{"serviceId":"fb130000-0000-4000-8000-000000000004"}]'::jsonb,'MIXED_CURRENCY')
  ) x(command_key,lines,error_name)
  loop
    v_failed:=false;
    begin
      perform public.create_appointment_group(
        'fb110000-0000-4000-8000-000000000001',v_case.command_key,
        'Rejected Binding Customer',v_case.lines,
        (v_day+time '16:00') at time zone 'Europe/Istanbul'
      );
    exception when others then
      if position(v_case.error_name in sqlerrm)=0 then raise; end if;
      v_failed:=true;
    end;
    perform pg_temp.f11b_assert(v_failed,v_case.command_key||' did not fail with '||v_case.error_name);
  end loop;
end
$$;

reset role;

select pg_temp.f11b_assert(
  (select count(*) from public.appointment_groups
   where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_groups')::integer
  and (select count(*) from public.appointments
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_lines')::integer
  and (select count(*) from public.customers
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_customers')::integer
  and (select count(*) from public.appointment_events
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_events')::integer,
  'invalid service binding or mixed currency left a group, line, customer, or event behind'
);

select pg_temp.f11b_assert(not exists(
  select 1 from public.booking_commands bc
  where bc.business_id='fb110000-0000-4000-8000-000000000001'
    and bc.idempotency_key=any(array[
      'f11-binding-foreign-service','f11-binding-missing-service',
      'f11-binding-inactive-service','f11-binding-mixed-currency',
      'f11-binding-hold-operator','f11-binding-tenant-operator','f11-binding-late-operator'
    ])
), 'rejected operator request retained a command, including a success command');

-- Restore normal bounded defaults inside this rolled-back fixture: the retained
-- S04 concurrency fixture commits deliberately tiny abuse limits. Independent
-- domain cases use distinct actors; exact retries keep their original actor.
delete from public.public_booking_rate_counters;
delete from public.public_booking_abuse_config where config_key='default';
insert into public.public_booking_abuse_config(
  config_key,gate_secret_hash
) values (
  'default',encode(extensions.digest('f11-final-binding-gate-secret-0000000000000000','sha256'),'hex')
)
on conflict(config_key) do update set
  gate_secret_hash=excluded.gate_secret_hash,
  updated_at=now();

do $$
declare
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
begin
  perform set_config('f11b.public_hold_key',pg_temp.f11b_public_key(
    'fb180000-0000-4000-8000-000000000001',v_deadline,encode(extensions.digest('f11-binding:secret:hold','sha256'),'hex')
  ),false);
  perform set_config('f11b.public_release_key',pg_temp.f11b_public_key(
    'fb180000-0000-4000-8000-000000000002',v_deadline,encode(extensions.digest('f11-binding:secret:release','sha256'),'hex')
  ),false);
  perform set_config('f11b.public_late_key',pg_temp.f11b_public_key(
    'fb180000-0000-4000-8000-000000000003',v_deadline,encode(extensions.digest('f11-binding:secret:late','sha256'),'hex')
  ),false);
  perform set_config('f11b.public_invalid_key',pg_temp.f11b_public_key(
    'fb180000-0000-4000-8000-000000000004',v_deadline,encode(extensions.digest('f11-binding:secret:invalid','sha256'),'hex')
  ),false);
  perform set_config('f11b.public_mixed_key',pg_temp.f11b_public_key(
    'fb180000-0000-4000-8000-000000000005',v_deadline,encode(extensions.digest('f11-binding:secret:mixed','sha256'),'hex')
  ),false);
end
$$;

set local role anon;
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_result jsonb;
  v_actor text:=encode(extensions.digest('f11-final-binding:actor:hold','sha256'),'hex');
  v_network text:=encode(extensions.digest('f11-final-binding:network','sha256'),'hex');
begin
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-final-binding','p_idempotency_key',current_setting('f11b.public_hold_key'),
    'p_customer_name','Public Hold Customer',
    'p_lines','[{"serviceId":"fb130000-0000-4000-8000-000000000002"}]'::jsonb,
    'p_starts_at',(v_day+time '15:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest('f11-binding:management:hold','sha256'),'hex'),
    'p_recovery_id','fb180000-0000-4000-8000-000000000001',
    'p_recovery_secret_hash',encode(extensions.digest('f11-binding:secret:hold','sha256'),'hex'),
    'p_management_token_ciphertext',repeat('h',64),'p_management_token_iv',repeat('i',16),
    'p_key_version',1,'p_customer_phone','05550000001'
  ),'f11-final-binding-gate-secret-0000000000000000',v_actor,v_network);
  perform pg_temp.f11b_assert(
    v_result#>>'{error,message}'='GROUP_SLOT_UNAVAILABLE',
    'gated HOLD ignored a staff closure: '||v_result::text
  );

  v_actor:=encode(extensions.digest('f11-final-binding:actor:release','sha256'),'hex');
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-final-binding','p_idempotency_key',current_setting('f11b.public_release_key'),
    'p_customer_name','Public Release Customer',
    'p_lines','[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb,
    'p_starts_at',(v_day+time '17:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest('f11-binding:management:release','sha256'),'hex'),
    'p_recovery_id','fb180000-0000-4000-8000-000000000002',
    'p_recovery_secret_hash',encode(extensions.digest('f11-binding:secret:release','sha256'),'hex'),
    'p_management_token_ciphertext',repeat('r',64),'p_management_token_iv',repeat('j',16),
    'p_key_version',1,'p_customer_phone','05550000002'
  ),'f11-final-binding-gate-secret-0000000000000000',v_actor,v_network);
  perform pg_temp.f11b_assert(
    v_result->>'ok'='true'
      and v_result#>>'{data,0,group_payload,lines,0,processingCapacityPolicy}'='RELEASE'
      and (v_result#>>'{data,0,group_payload,lines,0,endsAt}')::timestamptz=(v_day+time '18:00') at time zone 'Europe/Istanbul'
      and (v_result#>>'{data,0,group_payload,lines,0,occupiedEndsAt}')::timestamptz=(v_day+time '17:30') at time zone 'Europe/Istanbul',
    'gated RELEASE exact-close booking failed: '||v_result::text
  );
  perform set_config('f11b.public_release_payload',(v_result#>'{data,0,group_payload}')::text,false);

  v_actor:=encode(extensions.digest('f11-final-binding:actor:late','sha256'),'hex');
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-final-binding','p_idempotency_key',current_setting('f11b.public_late_key'),
    'p_customer_name','Public Late Customer',
    'p_lines','[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb,
    'p_starts_at',(v_day+time '17:30') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest('f11-binding:management:late','sha256'),'hex'),
    'p_recovery_id','fb180000-0000-4000-8000-000000000003',
    'p_recovery_secret_hash',encode(extensions.digest('f11-binding:secret:late','sha256'),'hex'),
    'p_management_token_ciphertext',repeat('l',64),'p_management_token_iv',repeat('k',16),
    'p_key_version',1,'p_customer_phone','05550000003'
  ),'f11-final-binding-gate-secret-0000000000000000',v_actor,v_network);
  perform pg_temp.f11b_assert(
    v_result#>>'{error,message}'='GROUP_SLOT_UNAVAILABLE',
    'gated RELEASE accepted a customer end after close: '||v_result::text
  );

  v_actor:=encode(extensions.digest('f11-final-binding:actor:invalid','sha256'),'hex');
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-final-binding','p_idempotency_key',current_setting('f11b.public_invalid_key'),
    'p_customer_name','Public Invalid Customer',
    'p_lines','[{"serviceId":"fb130000-0000-4000-8000-000000000007"},{"serviceId":"fb130000-0000-4000-8000-000000000005"}]'::jsonb,
    'p_starts_at',(v_day+time '16:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest('f11-binding:management:invalid','sha256'),'hex'),
    'p_recovery_id','fb180000-0000-4000-8000-000000000004',
    'p_recovery_secret_hash',encode(extensions.digest('f11-binding:secret:invalid','sha256'),'hex'),
    'p_management_token_ciphertext',repeat('n',64),'p_management_token_iv',repeat('m',16),
    'p_key_version',1,'p_customer_phone','05550000004'
  ),'f11-final-binding-gate-secret-0000000000000000',v_actor,v_network);
  perform pg_temp.f11b_assert(
    v_result#>>'{error,message}'='SERVICE_NOT_FOUND',
    'gated inactive service did not fail closed: '||v_result::text
  );

  v_actor:=encode(extensions.digest('f11-final-binding:actor:mixed','sha256'),'hex');
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-final-binding','p_idempotency_key',current_setting('f11b.public_mixed_key'),
    'p_customer_name','Public Mixed Customer',
    'p_lines','[{"serviceId":"fb130000-0000-4000-8000-000000000007"},{"serviceId":"fb130000-0000-4000-8000-000000000004"}]'::jsonb,
    'p_starts_at',(v_day+time '16:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest('f11-binding:management:mixed','sha256'),'hex'),
    'p_recovery_id','fb180000-0000-4000-8000-000000000005',
    'p_recovery_secret_hash',encode(extensions.digest('f11-binding:secret:mixed','sha256'),'hex'),
    'p_management_token_ciphertext',repeat('x',64),'p_management_token_iv',repeat('o',16),
    'p_key_version',1,'p_customer_phone','05550000005'
  ),'f11-final-binding-gate-secret-0000000000000000',v_actor,v_network);
  perform pg_temp.f11b_assert(
    v_result#>>'{error,message}'='MIXED_CURRENCY',
    'gated mixed currency did not fail closed: '||v_result::text
  );
end
$$;
reset role;

select pg_temp.f11b_assert(not exists(
  select 1 from public.booking_commands bc
  where bc.idempotency_key=any(array[
    current_setting('f11b.public_hold_key'),current_setting('f11b.public_late_key'),
    current_setting('f11b.public_invalid_key'),current_setting('f11b.public_mixed_key')
  ])
), 'rejected gated request retained a command, including a success command');

select pg_temp.f11b_assert(not exists(
  select 1 from public.public_booking_recoveries r
  where r.recovery_id=any(array[
    'fb180000-0000-4000-8000-000000000001'::uuid,
    'fb180000-0000-4000-8000-000000000003'::uuid,
    'fb180000-0000-4000-8000-000000000004'::uuid,
    'fb180000-0000-4000-8000-000000000005'::uuid
  ])
), 'rejected gated request retained recovery evidence');

select pg_temp.f11b_assert(
  (select count(*)=1
   from public.booking_commands bc
   where bc.idempotency_key=current_setting('f11b.public_release_key')
     and bc.command='public_create_group'
     and bc.appointment_id is not null)
  and (select count(*)=1 from public.appointment_groups g
       where g.business_id='fb110000-0000-4000-8000-000000000001'
         and g.source='public')
  and (select count(*)=1 from public.appointments a
       where a.business_id='fb110000-0000-4000-8000-000000000001'
         and a.source='public')
  and (select count(*) from public.appointment_groups
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_groups')::integer+1
  and (select count(*) from public.appointments
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_lines')::integer+1
  and (select count(*) from public.customers
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_customers')::integer+1
  and (select count(*) from public.appointment_events
       where business_id='fb110000-0000-4000-8000-000000000001')=current_setting('f11b.pre_events')::integer+1,
  'gated requests did not leave exactly one successful group/line/customer/event/command'
);

-- The anonymous group gateway also returns the original frozen group on a
-- valid same-intent retry after the booked service is archived. Other active
-- services keep the publication-readiness gate intact.
update public.services set active=false
where id='fb130000-0000-4000-8000-000000000007';

set local role anon;
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_result jsonb;
  v_actor text:=encode(extensions.digest('f11-final-binding:actor:release','sha256'),'hex');
  v_network text:=encode(extensions.digest('f11-final-binding:network','sha256'),'hex');
begin
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-final-binding','p_idempotency_key',current_setting('f11b.public_release_key'),
    'p_customer_name','Public Release Customer',
    'p_lines','[{"serviceId":"fb130000-0000-4000-8000-000000000007"}]'::jsonb,
    'p_starts_at',(v_day+time '17:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',encode(extensions.digest('f11-binding:management:release','sha256'),'hex'),
    'p_recovery_id','fb180000-0000-4000-8000-000000000002',
    'p_recovery_secret_hash',encode(extensions.digest('f11-binding:secret:release','sha256'),'hex'),
    'p_management_token_ciphertext',repeat('r',64),'p_management_token_iv',repeat('j',16),
    'p_key_version',1,'p_customer_phone','05550000002'
  ),'f11-final-binding-gate-secret-0000000000000000',v_actor,v_network);
  perform pg_temp.f11b_assert(
    v_result->>'ok'='true'
      and v_result#>'{data,0,group_payload}'=current_setting('f11b.public_release_payload')::jsonb,
    'gated same-intent replay after catalog archive lost the frozen group: '||v_result::text
  );
end
$$;
reset role;

select pg_temp.f11b_assert(
  (select count(*)=1 from public.booking_commands bc
   where bc.idempotency_key=current_setting('f11b.public_release_key'))
  and (select count(*)=1 from public.appointment_groups g
       where g.business_id='fb110000-0000-4000-8000-000000000001' and g.source='public')
  and (select count(*)=1 from public.public_booking_recoveries r
       where r.recovery_id='fb180000-0000-4000-8000-000000000002'),
  'gated catalog-change replay duplicated a group, command, or recovery'
);

rollback;
