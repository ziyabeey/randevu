begin;

create function pg_temp.f1103i_assert(p_ok boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F11-03 integration: %',p_message;
  end if;
end
$$;
grant execute on function pg_temp.f1103i_assert(boolean,text) to authenticated;

insert into auth.users(id,email,raw_user_meta_data)
values ('fd100000-0000-4000-8000-000000000001','f1103-integration@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'fd110000-0000-4000-8000-000000000001','F11-03 Integration Salon','f1103-integration-salon',
  'Europe/Istanbul','fd100000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'fd120000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001','owner',true
);

-- A and B have the same scheduling/processing footprint so a line-local service
-- replacement is safe. C deliberately changes duration and must require replan.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('fd130000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','Bakım A',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true),
  ('fd130000-0000-4000-8000-000000000002','fd110000-0000-4000-8000-000000000001','Bakım B',30,0,0,'Genel',20,15000,'fixed',15000,15000,'TRY',true),
  ('fd130000-0000-4000-8000-000000000003','fd110000-0000-4000-8000-000000000001','Uzun Bakım',45,0,0,'Genel',30,18000,'fixed',18000,18000,'TRY',true);

-- RELEASE shortens staff occupancy by 30 minutes, but business authority must
-- continue to cover the complete 60-minute customer interval.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active,
  processing_capacity_policy,passive_wait_minutes
) values (
  'fd130000-0000-4000-8000-000000000004','fd110000-0000-4000-8000-000000000001',
  'Release Bakım',60,0,0,'Genel',40,20000,'fixed',20000,20000,'TRY',true,'RELEASE',30
);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('fd140000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','Ada',true),
  ('fd140000-0000-4000-8000-000000000002','fd110000-0000-4000-8000-000000000001','Bora',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
select 'fd110000-0000-4000-8000-000000000001'::uuid,sp::uuid,sv::uuid,true
from unnest(array[
  'fd140000-0000-4000-8000-000000000001',
  'fd140000-0000-4000-8000-000000000002'
]) sp
cross join unnest(array[
  'fd130000-0000-4000-8000-000000000001',
  'fd130000-0000-4000-8000-000000000002',
  'fd130000-0000-4000-8000-000000000003',
  'fd130000-0000-4000-8000-000000000004'
]) sv;

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'fd150000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true
);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('fd160000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000001',extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true),
  ('fd160000-0000-4000-8000-000000000002','fd110000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000002',extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true);

select set_config('request.jwt.claim.sub','fd100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_group jsonb;
  v_legacy jsonb;
  v_release jsonb;
  v_customer uuid;
begin
  v_group:=public.create_appointment_group(
    'fd110000-0000-4000-8000-000000000001',
    'f1103i-create-group-0001','Pagination Customer',
    '[{"serviceId":"fd130000-0000-4000-8000-000000000001","staffId":"fd140000-0000-4000-8000-000000000001"},{"serviceId":"fd130000-0000-4000-8000-000000000001","staffId":"fd140000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul','05551112233'
  );
  perform set_config('f1103i.group_id',v_group->>'groupId',false);
  perform set_config('f1103i.line1',v_group#>>'{lines,0,appointmentId}',false);
  perform set_config('f1103i.line2',v_group#>>'{lines,1,appointmentId}',false);
  v_customer:=(v_group->>'customerId')::uuid;
  perform set_config('f1103i.customer_id',v_customer::text,false);

  v_legacy:=to_jsonb(public.create_appointment(
    'fd110000-0000-4000-8000-000000000001','f1103i-create-legacy-0001','Pagination Customer',
    'fd130000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000001',
    (v_day+time '12:00') at time zone 'Europe/Istanbul','05551112233'
  ));
  perform set_config('f1103i.legacy_id',v_legacy->>'id',false);

  v_release:=public.create_appointment_group(
    'fd110000-0000-4000-8000-000000000001',
    'f1103i-create-release-0001','Release Boundary Customer',
    '[{"serviceId":"fd130000-0000-4000-8000-000000000004","staffId":"fd140000-0000-4000-8000-000000000001"},{"serviceId":"fd130000-0000-4000-8000-000000000001","staffId":"fd140000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '14:00') at time zone 'Europe/Istanbul','05559990000'
  );
  perform set_config('f1103i.release_group',v_release->>'groupId',false);
  perform set_config('f1103i.release_line',v_release#>>'{lines,0,appointmentId}',false);
  perform set_config('f1103i.release_sibling',v_release#>>'{lines,1,appointmentId}',false);
end
$$;

-- Tenant-wide closure lives only in the RELEASE passive tail for an 18:00 move.
insert into public.availability_blocks(
  id,business_id,staff_id,starts_at,ends_at,reason,active
) values (
  'fd170000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001',null,
  ((date_trunc('week',current_date)::date+7)+time '18:30') at time zone 'Europe/Istanbul',
  ((date_trunc('week',current_date)::date+7)+time '19:00') at time zone 'Europe/Istanbul',
  'tenant closure in release tail',true
);

-- One page row is one logical reservation. Cursoring after a one-row page lands
-- on the next group, never on the second physical line of the same group.
do $$
declare
  v_first record;
  v_second record;
  v_group uuid:=current_setting('f1103i.group_id')::uuid;
  v_customer uuid:=current_setting('f1103i.customer_id')::uuid;
begin
  select * into v_first
  from public.list_business_booking_groups_page_v3(
    'fd110000-0000-4000-8000-000000000001',1,null,null
  );
  perform pg_temp.f1103i_assert(v_first.group_id<>v_group,'newest logical booking root was not returned first');
  perform pg_temp.f1103i_assert((v_first.booking->>'lineCount')::int=2,'newest release booking was not one two-line logical item');

  select * into v_second
  from public.list_business_booking_groups_page_v3(
    'fd110000-0000-4000-8000-000000000001',1,v_first.group_starts_at,v_first.group_id
  );
  perform pg_temp.f1103i_assert(v_second.group_id<>v_first.group_id,'group cursor repeated the same logical reservation');

  -- Find the original native group explicitly; adding the RELEASE fixture must
  -- not weaken the one-row-per-group invariant.
  select * into v_second
  from public.list_business_booking_groups_page_v3(
    'fd110000-0000-4000-8000-000000000001',10,null,null
  ) p
  where p.group_id=v_group;
  perform pg_temp.f1103i_assert(v_second.group_id=v_group,'native reservation disappeared from group-rooted page');
  perform pg_temp.f1103i_assert((v_second.booking->>'lineCount')::int=2,'native group was not returned as one two-line item');
  perform pg_temp.f1103i_assert(jsonb_array_length(v_second.booking->'lines')=2,'native group payload lost a service line');

  select * into v_first
  from public.list_business_customer_booking_groups_page_v3(
    'fd110000-0000-4000-8000-000000000001',v_customer,1,null,null
  );
  select * into v_second
  from public.list_business_customer_booking_groups_page_v3(
    'fd110000-0000-4000-8000-000000000001',v_customer,1,v_first.group_starts_at,v_first.group_id
  );
  perform pg_temp.f1103i_assert(v_first.group_id<>v_second.group_id,'customer page cursor repeated the same logical group');
  perform pg_temp.f1103i_assert(
    (v_first.booking->>'lineCount')::int+(v_second.booking->>'lineCount')::int=3,
    'customer history did not preserve one legacy plus one two-line reservation'
  );
end
$$;

-- Safe service replacement changes only the exact target's service/financial
-- snapshot and the group CAS version. The sibling is unchanged. Stale CAS and a
-- footprint-changing service both fail closed.
do $$
declare
  v_group uuid:=current_setting('f1103i.group_id')::uuid;
  v_line1 uuid:=current_setting('f1103i.line1')::uuid;
  v_line2 uuid:=current_setting('f1103i.line2')::uuid;
  v_sibling_before jsonb;
  v_sibling_after jsonb;
  v_payload jsonb;
  v_raised boolean:=false;
begin
  select to_jsonb(a) into v_sibling_before from public.appointments a where a.id=v_line2;

  v_payload:=public.change_appointment_group_line_service(
    'fd110000-0000-4000-8000-000000000001',v_group,v_line1,
    'f1103i-service-change-0001',1,'fd130000-0000-4000-8000-000000000002'
  );
  perform pg_temp.f1103i_assert((v_payload->>'version')::int=2,'service replacement did not bump group version exactly once');
  perform pg_temp.f1103i_assert(v_payload#>>'{lines,0,serviceId}'='fd130000-0000-4000-8000-000000000002','target line service did not change');
  perform pg_temp.f1103i_assert((v_payload#>>'{lines,0,priceMinor}')::int=15000,'target line did not freeze the new authoritative price');

  select to_jsonb(a) into v_sibling_after from public.appointments a where a.id=v_line2;
  perform pg_temp.f1103i_assert(v_sibling_after=v_sibling_before,'service replacement mutated a sibling row');

  v_payload:=public.change_appointment_group_line_service(
    'fd110000-0000-4000-8000-000000000001',v_group,v_line1,
    'f1103i-service-change-0001',1,'fd130000-0000-4000-8000-000000000002'
  );
  perform pg_temp.f1103i_assert((v_payload->>'version')::int=2,'exact service-change replay manufactured a version');

  begin
    perform public.change_appointment_group_line_service(
      'fd110000-0000-4000-8000-000000000001',v_group,v_line1,
      'f1103i-service-change-stale',1,'fd130000-0000-4000-8000-000000000001'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_VERSION_CONFLICT%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103i_assert(v_raised,'stale service-change version was accepted');

  v_raised:=false;
  begin
    perform public.change_appointment_group_line_service(
      'fd110000-0000-4000-8000-000000000001',v_group,v_line1,
      'f1103i-service-change-replan',2,'fd130000-0000-4000-8000-000000000003'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_LINE_REPLAN_REQUIRED%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103i_assert(v_raised,'footprint-changing service replacement did not require a group replan');
  perform pg_temp.f1103i_assert(
    (select g.version=2 from public.appointment_groups g where g.id=v_group),
    'failed service replacement changed group version'
  );
end
$$;

-- Line-local schedule edit preserves the sibling row exactly and moves only the
-- target under the same group CAS. A stale follow-up is deterministic.
do $$
declare
  v_group uuid:=current_setting('f1103i.group_id')::uuid;
  v_line1 uuid:=current_setting('f1103i.line1')::uuid;
  v_line2 uuid:=current_setting('f1103i.line2')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_target timestamptz:=(date_trunc('week',current_date)::date+7+time '16:00') at time zone 'Europe/Istanbul';
  v_sibling_before jsonb;
  v_sibling_after jsonb;
  v_payload jsonb;
  v_raised boolean:=false;
begin
  select to_jsonb(a) into v_sibling_before from public.appointments a where a.id=v_line1;

  v_payload:=public.reschedule_appointment_group_line(
    'fd110000-0000-4000-8000-000000000001',v_group,v_line2,
    'f1103i-line-reschedule-0001',2,'fd140000-0000-4000-8000-000000000002',v_target
  );
  perform pg_temp.f1103i_assert((v_payload->>'version')::int=3,'line reschedule did not bump group version exactly once');
  perform pg_temp.f1103i_assert((v_payload#>>'{lines,1,startsAt}')::timestamptz=v_target,'target line did not move');

  select to_jsonb(a) into v_sibling_after from public.appointments a where a.id=v_line1;
  perform pg_temp.f1103i_assert(v_sibling_after=v_sibling_before,'line reschedule mutated a sibling row');

  begin
    perform public.reschedule_appointment_group_line(
      'fd110000-0000-4000-8000-000000000001',v_group,v_line2,
      'f1103i-line-reschedule-stale',2,'fd140000-0000-4000-8000-000000000002',
      (v_day+time '17:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_VERSION_CONFLICT%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103i_assert(v_raised,'stale line-reschedule version was accepted');
end
$$;

-- R1 integrity regression: RELEASE can shorten staff occupancy, but never the
-- customer interval used by business hours or tenant-wide availability blocks.
-- Both rejected moves must leave target, sibling, group CAS, audit and command
-- ledger exactly unchanged.
do $$
declare
  v_group uuid:=current_setting('f1103i.release_group')::uuid;
  v_target uuid:=current_setting('f1103i.release_line')::uuid;
  v_sibling uuid:=current_setting('f1103i.release_sibling')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_target_before jsonb;
  v_sibling_before jsonb;
  v_version_before integer;
  v_events_before bigint;
  v_commands_before bigint;
  v_raised boolean;
begin
  select to_jsonb(a) into v_target_before from public.appointments a where a.id=v_target;
  select to_jsonb(a) into v_sibling_before from public.appointments a where a.id=v_sibling;
  select g.version into v_version_before from public.appointment_groups g where g.id=v_group;
  select count(*) into v_events_before from public.appointment_events e where e.appointment_id=v_target;
  select count(*) into v_commands_before from public.booking_commands bc
  where bc.business_id='fd110000-0000-4000-8000-000000000001';

  v_raised:=false;
  begin
    perform public.reschedule_appointment_group_line(
      'fd110000-0000-4000-8000-000000000001',v_group,v_target,
      'f1103i-release-past-close',v_version_before,
      'fd140000-0000-4000-8000-000000000001',
      (v_day+time '19:30') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103i_assert(v_raised,'RELEASE passive tail beyond business close was accepted');
  perform pg_temp.f1103i_assert((select to_jsonb(a)=v_target_before from public.appointments a where a.id=v_target),'past-close rejection mutated target line');
  perform pg_temp.f1103i_assert((select to_jsonb(a)=v_sibling_before from public.appointments a where a.id=v_sibling),'past-close rejection mutated sibling line');
  perform pg_temp.f1103i_assert((select g.version=v_version_before from public.appointment_groups g where g.id=v_group),'past-close rejection moved group version');
  perform pg_temp.f1103i_assert((select count(*)=v_events_before from public.appointment_events e where e.appointment_id=v_target),'past-close rejection wrote audit event');
  perform pg_temp.f1103i_assert((select count(*)=v_commands_before from public.booking_commands bc where bc.business_id='fd110000-0000-4000-8000-000000000001'),'past-close rejection moved command ledger');
  perform pg_temp.f1103i_assert(not exists(select 1 from public.booking_commands bc where bc.business_id='fd110000-0000-4000-8000-000000000001' and bc.idempotency_key='f1103i-release-past-close'),'past-close rejection retained command claim');

  v_raised:=false;
  begin
    perform public.reschedule_appointment_group_line(
      'fd110000-0000-4000-8000-000000000001',v_group,v_target,
      'f1103i-release-tenant-tail',v_version_before,
      'fd140000-0000-4000-8000-000000000001',
      (v_day+time '18:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103i_assert(v_raised,'tenant-wide block in RELEASE passive tail was ignored');
  perform pg_temp.f1103i_assert((select to_jsonb(a)=v_target_before from public.appointments a where a.id=v_target),'tenant-tail rejection mutated target line');
  perform pg_temp.f1103i_assert((select to_jsonb(a)=v_sibling_before from public.appointments a where a.id=v_sibling),'tenant-tail rejection mutated sibling line');
  perform pg_temp.f1103i_assert((select g.version=v_version_before from public.appointment_groups g where g.id=v_group),'tenant-tail rejection moved group version');
  perform pg_temp.f1103i_assert((select count(*)=v_events_before from public.appointment_events e where e.appointment_id=v_target),'tenant-tail rejection wrote audit event');
  perform pg_temp.f1103i_assert((select count(*)=v_commands_before from public.booking_commands bc where bc.business_id='fd110000-0000-4000-8000-000000000001'),'tenant-tail rejection moved command ledger');
  perform pg_temp.f1103i_assert(not exists(select 1 from public.booking_commands bc where bc.business_id='fd110000-0000-4000-8000-000000000001' and bc.idempotency_key='f1103i-release-tenant-tail'),'tenant-tail rejection retained command claim');
end
$$;

-- Hosted roles receive only the intended authenticated RPC surface. Internal
-- payload authority and anonymous mutation remain closed.
do $$
begin
  perform pg_temp.f1103i_assert(
    has_function_privilege('authenticated','public.list_business_booking_groups_page_v3(uuid,integer,timestamptz,uuid)','EXECUTE'),
    'authenticated lost group-list execute'
  );
  perform pg_temp.f1103i_assert(
    has_function_privilege('authenticated','public.change_appointment_group_line_service(uuid,uuid,uuid,text,integer,uuid)','EXECUTE'),
    'authenticated lost line service mutation execute'
  );
  perform pg_temp.f1103i_assert(
    has_function_privilege('authenticated','public.reschedule_appointment_group_line(uuid,uuid,uuid,text,integer,uuid,timestamptz)','EXECUTE'),
    'authenticated lost line schedule mutation execute'
  );
  perform pg_temp.f1103i_assert(
    not has_function_privilege('anon','public.change_appointment_group_line_service(uuid,uuid,uuid,text,integer,uuid)','EXECUTE'),
    'anon gained line service mutation execute'
  );
  perform pg_temp.f1103i_assert(
    not has_function_privilege('anon','public.reschedule_appointment_group_line(uuid,uuid,uuid,text,integer,uuid,timestamptz)','EXECUTE'),
    'anon gained line schedule mutation execute'
  );
  perform pg_temp.f1103i_assert(
    not has_function_privilege('authenticated','public.f11_operator_booking_payload(uuid,uuid)','EXECUTE'),
    'internal booking payload helper leaked execute'
  );
end
$$;

rollback;