begin;

create function pg_temp.f1103_assert(p_ok boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F11-03: %',p_message;
  end if;
end
$$;

-- S08 revokes the default EXECUTE on functions created by the migration role in
-- every schema, pg_temp included, so this helper needs an explicit grant before
-- the assertions run under the authenticated role.
grant execute on function pg_temp.f1103_assert(boolean,text) to authenticated;

insert into auth.users(id,email,raw_user_meta_data)
values ('fc100000-0000-4000-8000-000000000001','f1103-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'fc110000-0000-4000-8000-000000000001','F11-03 Salon','f1103-salon',
  'Europe/Istanbul','fc100000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'fc120000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',
  'fc100000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('fc130000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','Renk',60,0,0,'Genel',10,20000,'fixed',20000,20000,'TRY',true),
  ('fc130000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000001','Kesim',30,0,0,'Genel',20,12000,'fixed',12000,12000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values ('fc140000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','F11-03 Uzmanı',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001',true),
  ('fc110000-0000-4000-8000-000000000001','fc140000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000002',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'fc150000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true
);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'fc160000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001',
  'fc140000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true
);

insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('fc110000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

-- The behaviour assertions below read committed rows directly, which API roles
-- are never granted. They therefore run with owner rights while the JWT claims
-- stay set: every management RPC is SECURITY DEFINER and authorizes itself from
-- auth.uid() plus is_active_member, so the authorization path is still the one
-- under test. The object-ACL boundary for anon/authenticated is asserted
-- separately in this file.
select set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_group jsonb;
  v_second jsonb;
begin
  v_group:=public.create_appointment_group(
    'fc110000-0000-4000-8000-000000000001',
    'f1103-create-group-0001','F11 Yönetim',
    '[{"serviceId":"fc130000-0000-4000-8000-000000000001","staffId":"fc140000-0000-4000-8000-000000000001"},{"serviceId":"fc130000-0000-4000-8000-000000000002","staffId":"fc140000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul','05550000001'
  );
  perform set_config('f1103.group',v_group::text,false);
  perform set_config('f1103.group_id',v_group->>'groupId',false);
  perform set_config('f1103.customer_id',v_group->>'customerId',false);

  -- A second valid group supplies a real wrong-group line probe.
  v_second:=public.create_appointment_group(
    'fc110000-0000-4000-8000-000000000001',
    'f1103-create-group-0002','F11 Başka Grup',
    '[{"serviceId":"fc130000-0000-4000-8000-000000000002","staffId":"fc140000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '17:00') at time zone 'Europe/Istanbul','05550000002'
  );
  perform set_config('f1103.other_group_id',v_second->>'groupId',false);
  perform set_config('f1103.other_line_id',v_second#>>'{lines,0,appointmentId}',false);
end
$$;

-- Canonical read projection exposes one authority root and ordered lines.
do $$
declare
  v_payload jsonb;
begin
  v_payload:=public.get_booking_group_management(
    'fc110000-0000-4000-8000-000000000001',current_setting('f1103.group_id')::uuid
  );
  perform pg_temp.f1103_assert((v_payload->>'version')::int=1,'initial group version is not 1');
  perform pg_temp.f1103_assert((v_payload->>'lineCount')::int=2,'management projection lost a line');
  perform pg_temp.f1103_assert(v_payload->>'managementMode'='group','native group was treated as legacy');
  perform pg_temp.f1103_assert(v_payload->>'canRescheduleGroup'='true','active group should be reschedulable');
end
$$;

-- A native group can no longer be silently split through the old appointment-id
-- mutation RPC. The failed call must move zero sibling rows.
do $$
declare
  v_group uuid:=current_setting('f1103.group_id')::uuid;
  v_line uuid;
  v_before timestamptz;
  v_after timestamptz;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_raised boolean:=false;
begin
  select a.id,a.starts_at into v_line,v_before
  from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group
  order by a.line_ordinal limit 1;
  begin
    perform public.reschedule_appointment(
      'fc110000-0000-4000-8000-000000000001',v_line,'f1103-legacy-res-0001',
      'fc140000-0000-4000-8000-000000000001',(v_day+time '16:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_MUTATION_REQUIRED%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103_assert(v_raised,'legacy appointment reschedule mutated a native group');
  select a.starts_at into v_after from public.appointments a where a.id=v_line;
  perform pg_temp.f1103_assert(v_after=v_before,'failed legacy mutation moved the line');
end
$$;

-- Atomic group reschedule: all rows move, version increments once, exact replay
-- returns the committed group, stale/new commands fail closed.
do $$
declare
  v_group uuid:=current_setting('f1103.group_id')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_target timestamptz:=(date_trunc('week',current_date)::date+7+time '12:00') at time zone 'Europe/Istanbul';
  v_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_raised boolean:=false;
begin
  select jsonb_agg(jsonb_build_object('id',a.id,'start',a.starts_at) order by a.line_ordinal)
  into v_before from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group;

  v_result:=public.reschedule_appointment_group(
    'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-res-0001',1,v_target
  );
  perform pg_temp.f1103_assert((v_result->>'version')::int=2,'group reschedule did not increment version exactly once');
  perform pg_temp.f1103_assert((v_result->>'startsAt')::timestamptz=v_target,'group did not move to requested start');
  perform pg_temp.f1103_assert((v_result#>>'{lines,0,startsAt}')::timestamptz=v_target,'first line did not move');
  perform pg_temp.f1103_assert(
    (v_result#>>'{lines,1,startsAt}')::timestamptz=(v_result#>>'{lines,0,endsAt}')::timestamptz,
    'rescheduled lines are no longer consecutive'
  );

  v_result:=public.reschedule_appointment_group(
    'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-res-0001',1,v_target
  );
  perform pg_temp.f1103_assert((v_result->>'version')::int=2,'exact replay manufactured another version');

  begin
    perform public.reschedule_appointment_group(
      'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-res-stale',1,
      (v_day+time '13:00') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_VERSION_CONFLICT%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103_assert(v_raised,'stale expectedVersion was accepted');

  select jsonb_agg(jsonb_build_object('id',a.id,'start',a.starts_at) order by a.line_ordinal)
  into v_after from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group;
  perform pg_temp.f1103_assert(v_after<>v_before,'successful group reschedule did not move rows');
end
$$;

-- Install a real conflicting legacy appointment. A target that collides with
-- only one line must reject the whole group and preserve every old timestamp.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_group uuid:=current_setting('f1103.group_id')::uuid;
  v_before jsonb;
  v_after jsonb;
  v_raised boolean:=false;
begin
  perform public.create_appointment(
    'fc110000-0000-4000-8000-000000000001','f1103-blocker-0001','Bloker',
    'fc130000-0000-4000-8000-000000000002','fc140000-0000-4000-8000-000000000001',
    (v_day+time '15:00') at time zone 'Europe/Istanbul','05550000003'
  );

  select jsonb_agg(jsonb_build_object('id',a.id,'start',a.starts_at) order by a.line_ordinal)
  into v_before from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group;

  begin
    perform public.reschedule_appointment_group(
      'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-conflict',2,
      (v_day+time '14:30') at time zone 'Europe/Istanbul'
    );
  exception when others then
    if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%APPOINTMENT_CONFLICT%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103_assert(v_raised,'one-line conflict did not reject the group');

  select jsonb_agg(jsonb_build_object('id',a.id,'start',a.starts_at) order by a.line_ordinal)
  into v_after from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group;
  perform pg_temp.f1103_assert(v_after=v_before,'failed multi-line reschedule partially moved the group');
end
$$;

-- A valid line-local cancel produces partial lifecycle and exactly one group
-- version increment. A real line from another group is never accepted.
do $$
declare
  v_group uuid:=current_setting('f1103.group_id')::uuid;
  v_line uuid;
  v_other_line uuid:=current_setting('f1103.other_line_id')::uuid;
  v_payload jsonb;
  v_raised boolean:=false;
begin
  select a.id into v_line from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group
  order by a.line_ordinal limit 1;

  begin
    perform public.cancel_appointment_group_line(
      'fc110000-0000-4000-8000-000000000001',v_group,v_other_line,
      'f1103-wrong-line-0001',2,'yanlış grup'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_LINE_NOT_FOUND%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103_assert(v_raised,'a line from another group was accepted');

  v_payload:=public.cancel_appointment_group_line(
    'fc110000-0000-4000-8000-000000000001',v_group,v_line,
    'f1103-line-cancel-0001',2,'tek hizmet iptali'
  );
  perform pg_temp.f1103_assert(v_payload->>'status'='partial','line cancel did not create partial group status');
  perform pg_temp.f1103_assert((v_payload->>'version')::int=3,'line cancel did not increment group version once');
  perform pg_temp.f1103_assert(
    (select count(*)=1 from public.appointments a
      where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group and a.status='cancelled'),
    'line cancel changed a sibling'
  );
end
$$;

-- Whole-group cancel from partial cancels only remaining active lines. Replay is
-- stable and the audit rows preserve each actually changed line's prior status.
do $$
declare
  v_group uuid:=current_setting('f1103.group_id')::uuid;
  v_payload jsonb;
  v_raised boolean:=false;
  v_changed_events integer;
begin
  v_payload:=public.cancel_appointment_group(
    'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-cancel-0001',3,'grup iptali'
  );
  perform pg_temp.f1103_assert(v_payload->>'status'='cancelled','whole-group cancel did not close the group');
  perform pg_temp.f1103_assert((v_payload->>'version')::int=4,'whole-group cancel did not increment version once');
  perform pg_temp.f1103_assert(
    (select count(*)=2 from public.appointments a
      where a.business_id='fc110000-0000-4000-8000-000000000001' and a.group_id=v_group and a.status='cancelled'),
    'whole-group cancel left an active sibling'
  );

  select count(*)::integer into v_changed_events
  from public.appointment_events e
  where e.business_id='fc110000-0000-4000-8000-000000000001'
    and e.group_id=v_group and e.event_type='cancelled'
    and e.payload->>'reason'='grup iptali';
  perform pg_temp.f1103_assert(v_changed_events=1,'whole-group cancel audited an already-cancelled sibling');

  v_payload:=public.cancel_appointment_group(
    'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-cancel-0001',3,'grup iptali'
  );
  perform pg_temp.f1103_assert((v_payload->>'version')::int=4,'cancel replay manufactured another version');

  begin
    perform public.cancel_appointment_group(
      'fc110000-0000-4000-8000-000000000001',v_group,'f1103-group-cancel-stale',3,'stale'
    );
  exception when others then
    if sqlerrm not like '%BOOKING_GROUP_VERSION_CONFLICT%' then raise; end if;
    v_raised:=true;
  end;
  perform pg_temp.f1103_assert(v_raised,'stale whole-group cancel was accepted');
end
$$;

-- Live v2 consumers keep every physical line but expose the reservation root so
-- neither calendar nor customer history can mistake the group for unrelated rows.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_group uuid:=current_setting('f1103.group_id')::uuid;
  v_customer uuid:=current_setting('f1103.customer_id')::uuid;
  v_calendar_count integer;
  v_history_count integer;
begin
  select count(*)::integer into v_calendar_count
  from public.get_calendar_appointments_v2(
    'fc110000-0000-4000-8000-000000000001',v_day,1,null
  ) c where c.group_id=v_group and c.group_line_count=2 and c.group_version=4;
  perform pg_temp.f1103_assert(v_calendar_count=2,'calendar v2 collapsed or detached group lines');

  select count(*)::integer into v_history_count
  from public.list_business_customer_appointments_page_v2(
    'fc110000-0000-4000-8000-000000000001',v_customer,26,null,null
  ) h where h.group_id=v_group and h.group_line_count=2 and h.group_version=4;
  perform pg_temp.f1103_assert(v_history_count=2,'customer history v2 collapsed or detached group lines');
end
$$;

reset role;

-- Capability authority resolves exactly one group. Build two real public-source
-- groups through the internal creation core and bind distinct opaque tokens to
-- their canonical anchors.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_group_a jsonb;
  v_group_b jsonb;
  v_anchor_a uuid;
  v_anchor_b uuid;
  v_ref uuid;
  v_count integer;
  v_token_a text:=repeat('m',43);
  v_token_b text:=repeat('n',43);
begin
  v_group_a:=public.f11_create_group_internal(
    'fc110000-0000-4000-8000-000000000001','f1103-public-group-0001','Public A',
    '[{"serviceId":"fc130000-0000-4000-8000-000000000001","staffId":"fc140000-0000-4000-8000-000000000001"},{"serviceId":"fc130000-0000-4000-8000-000000000002","staffId":"fc140000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '17:30') at time zone 'Europe/Istanbul','public',null,'public-a@example.invalid',null
  );
  v_group_b:=public.f11_create_group_internal(
    'fc110000-0000-4000-8000-000000000001','f1103-public-group-0002','Public B',
    '[{"serviceId":"fc130000-0000-4000-8000-000000000002","staffId":"fc140000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '19:15') at time zone 'Europe/Istanbul','public',null,'public-b@example.invalid',null
  );

  select a.id into v_anchor_a from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001'
    and a.group_id=(v_group_a->>'groupId')::uuid and a.line_ordinal=1;
  select a.id into v_anchor_b from public.appointments a
  where a.business_id='fc110000-0000-4000-8000-000000000001'
    and a.group_id=(v_group_b->>'groupId')::uuid and a.line_ordinal=1;

  insert into public.appointment_management_capabilities(appointment_id,business_id,token_hash)
  values
    (v_anchor_a,'fc110000-0000-4000-8000-000000000001',public.management_token_hash(v_token_a)),
    (v_anchor_b,'fc110000-0000-4000-8000-000000000001',public.management_token_hash(v_token_b));

  select r.group_id into v_ref from public.f11_public_management_group_ref(v_token_a) r;
  perform pg_temp.f1103_assert(v_ref=(v_group_a->>'groupId')::uuid,'token A resolved another group');
  select count(*)::integer into v_count from public.f11_public_management_group_ref(repeat('z',43));
  perform pg_temp.f1103_assert(v_count=0,'unknown token acquired group authority');
  select r.group_id into v_ref from public.f11_public_management_group_ref(v_token_b) r;
  perform pg_temp.f1103_assert(v_ref=(v_group_b->>'groupId')::uuid,'token B resolved another group');
end
$$;

-- Hosted ACL: anonymous callers keep only the dispatcher; group helpers/cores are
-- never directly executable. Authenticated operator surface is explicit.
do $$
begin
  perform pg_temp.f1103_assert(
    has_function_privilege('authenticated','public.get_booking_group_management(uuid,uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.reschedule_appointment_group(uuid,uuid,text,integer,timestamptz)','EXECUTE')
    and has_function_privilege('authenticated','public.cancel_appointment_group(uuid,uuid,text,integer,text)','EXECUTE')
    and has_function_privilege('authenticated','public.cancel_appointment_group_line(uuid,uuid,uuid,text,integer,text)','EXECUTE'),
    'authenticated group-management grants missing'
  );
  perform pg_temp.f1103_assert(
    not has_function_privilege('anon','public.reschedule_public_managed_group(text,text,integer,timestamptz)','EXECUTE')
    and not has_function_privilege('anon','public.cancel_public_managed_group(text,text,integer,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.f11_group_management_payload(uuid,uuid)','EXECUTE')
    and has_function_privilege('anon','public.execute_public_operation(text,jsonb,text,text,text)','EXECUTE'),
    'public group-management authority widened'
  );
end
$$;

rollback;
