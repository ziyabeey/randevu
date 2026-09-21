-- F13-03 native group lifecycle acceptance.
delete from public.businesses where id='f3310000-0000-4000-8000-000000000001';
delete from auth.users where id='f3300000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f3300000-0000-4000-8000-000000000001','f13-lifecycle-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f3310000-0000-4000-8000-000000000001',
  'F13 Lifecycle Salon',
  'f13-lifecycle-salon',
  'Europe/Istanbul',
  'f3300000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f3320000-0000-4000-8000-000000000001',
  'f3310000-0000-4000-8000-000000000001',
  'f3300000-0000-4000-8000-000000000001',
  'owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f3330000-0000-4000-8000-000000000001',
  'f3310000-0000-4000-8000-000000000001',
  'F13 Lifecycle Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('f3340000-0000-4000-8000-000000000001','f3310000-0000-4000-8000-000000000001','F13 Staff A',true),
  ('f3340000-0000-4000-8000-000000000002','f3310000-0000-4000-8000-000000000001','F13 Staff B',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('f3310000-0000-4000-8000-000000000001','f3340000-0000-4000-8000-000000000001','f3330000-0000-4000-8000-000000000001',true),
  ('f3310000-0000-4000-8000-000000000001','f3340000-0000-4000-8000-000000000002','f3330000-0000-4000-8000-000000000001',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values ('f3310000-0000-4000-8000-000000000001',1,time '00:00',time '23:59',true);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('f3310000-0000-4000-8000-000000000001','f3340000-0000-4000-8000-000000000001',1,time '00:00',time '23:59',true),
  ('f3310000-0000-4000-8000-000000000001','f3340000-0000-4000-8000-000000000002',1,time '00:00',time '23:59',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values (
  'f3350000-0000-4000-8000-000000000001',
  'f3310000-0000-4000-8000-000000000001',
  'F13 Lifecycle Customer',
  '05553300001',
  'f13-lifecycle@example.invalid',
  'f3300000-0000-4000-8000-000000000001'
);

insert into public.appointment_groups(id,business_id,customer_id,status,source,version,created_by)
values (
  'f3360000-0000-4000-8000-000000000001',
  'f3310000-0000-4000-8000-000000000001',
  'f3350000-0000-4000-8000-000000000001',
  'scheduled','operator',1,
  'f3300000-0000-4000-8000-000000000001'
);

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values
  (
    'f3370000-0000-4000-8000-000000000001','f3310000-0000-4000-8000-000000000001',
    'f3360000-0000-4000-8000-000000000001',1,
    'f3350000-0000-4000-8000-000000000001','f3330000-0000-4000-8000-000000000001',
    'f3340000-0000-4000-8000-000000000001','scheduled',
    '2027-03-01 09:00+00','2027-03-01 09:30+00','2027-03-01 09:00+00','2027-03-01 09:30+00',
    'Europe/Istanbul','F13 Lifecycle Customer','05553300001','f13-lifecycle@example.invalid',
    'F13 Lifecycle Service','F13 Staff A',30,0,0,10000,'fixed',10000,10000,1,'TRY',
    'f3300000-0000-4000-8000-000000000001','operator'
  ),
  (
    'f3370000-0000-4000-8000-000000000002','f3310000-0000-4000-8000-000000000001',
    'f3360000-0000-4000-8000-000000000001',2,
    'f3350000-0000-4000-8000-000000000001','f3330000-0000-4000-8000-000000000001',
    'f3340000-0000-4000-8000-000000000002','scheduled',
    '2027-03-01 09:30+00','2027-03-01 10:00+00','2027-03-01 09:30+00','2027-03-01 10:00+00',
    'Europe/Istanbul','F13 Lifecycle Customer','05553300001','f13-lifecycle@example.invalid',
    'F13 Lifecycle Service','F13 Staff B',30,0,0,10000,'fixed',10000,10000,1,'TRY',
    'f3300000-0000-4000-8000-000000000001','operator'
  );

do $$
begin
  if not has_function_privilege('authenticated','public.set_appointment_group_status(uuid,uuid,text,integer,text)','EXECUTE')
     or has_function_privilege('anon','public.set_appointment_group_status(uuid,uuid,text,integer,text)','EXECUTE') then
    raise exception 'F13-03 group status RPC ACL mismatch';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','f3300000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_payload jsonb;
begin
  v_payload:=public.set_appointment_group_status(
    'f3310000-0000-4000-8000-000000000001',
    'f3360000-0000-4000-8000-000000000001',
    'f13-group-status-confirm',1,'confirmed'
  );
  if v_payload->>'status' <> 'confirmed' or (v_payload->>'version')::integer <> 2 then
    raise exception 'F13-03 confirmed payload mismatch: %',v_payload;
  end if;
  -- Same command key is a read-back, not a second version/event mutation.
  v_payload:=public.set_appointment_group_status(
    'f3310000-0000-4000-8000-000000000001',
    'f3360000-0000-4000-8000-000000000001',
    'f13-group-status-confirm',1,'confirmed'
  );
  if (v_payload->>'version')::integer<>2 then
    raise exception 'F13-03 idempotent replay changed version payload: %',v_payload;
  end if;

  v_payload:=public.set_appointment_group_status(
    'f3310000-0000-4000-8000-000000000001',
    'f3360000-0000-4000-8000-000000000001',
    'f13-group-status-complete',2,'completed'
  );
  if v_payload->>'status'<>'completed' or (v_payload->>'version')::integer<>3 then
    raise exception 'F13-03 completed payload mismatch: %',v_payload;
  end if;

  begin
    perform public.set_appointment_group_status(
      'f3310000-0000-4000-8000-000000000001',
      'f3360000-0000-4000-8000-000000000001',
      'f13-group-status-invalid',3,'no_show'
    );
    raise exception 'F13-03 accepted completed -> no_show';
  exception when others then
    if sqlerrm='F13-03 accepted completed -> no_show' then raise; end if;
    if position('INVALID_GROUP_STATUS_TRANSITION' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.set_appointment_group_status(
      'f3310000-0000-4000-8000-000000000001',
      'f3360000-0000-4000-8000-000000000001',
      'f13-group-status-stale',2,'no_show'
    );
    raise exception 'F13-03 accepted stale version';
  exception when others then
    if sqlerrm='F13-03 accepted stale version' then raise; end if;
    if position('BOOKING_GROUP_VERSION_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',false);
do $$
begin
  begin
    perform public.set_appointment_group_status(
      'f3310000-0000-4000-8000-000000000001',
      'f3360000-0000-4000-8000-000000000001',
      'f13-recovery-status',3,'completed'
    );
    raise exception 'F13-03 recovery session reached group status';
  exception when others then
    if sqlerrm='F13-03 recovery session reached group status' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;

do $f13lifecycle$
declare
  v_group_version integer;
  v_group_status text;
  v_bad_lines integer;
  v_confirmed_events integer;
  v_completed_events integer;
  v_commands integer;
begin
  select g.version,g.status into v_group_version,v_group_status
  from public.appointment_groups g
  where g.id='f3360000-0000-4000-8000-000000000001';

  select count(*) into v_bad_lines
  from public.appointments a
  where a.group_id='f3360000-0000-4000-8000-000000000001'
    and a.status<>'completed';

  select count(*) into v_confirmed_events
  from public.appointment_events e
  where e.business_id='f3310000-0000-4000-8000-000000000001'
    and e.appointment_id in (
      'f3370000-0000-4000-8000-000000000001',
      'f3370000-0000-4000-8000-000000000002'
    )
    and e.event_type='confirmed'
    and e.payload->>'scope'='group';

  select count(*) into v_completed_events
  from public.appointment_events e
  where e.business_id='f3310000-0000-4000-8000-000000000001'
    and e.appointment_id in (
      'f3370000-0000-4000-8000-000000000001',
      'f3370000-0000-4000-8000-000000000002'
    )
    and e.event_type='completed'
    and e.payload->>'scope'='group';

  select count(*) into v_commands
  from public.booking_commands bc
  where bc.business_id='f3310000-0000-4000-8000-000000000001'
    and bc.command='group_status';

  if v_group_version<>3 or v_group_status<>'completed' then
    raise exception 'F13-03 final group lifecycle mismatch: status %, version %',v_group_status,v_group_version;
  end if;
  if v_bad_lines<>0 then
    raise exception 'F13-03 final lifecycle left non-completed lines: %',v_bad_lines;
  end if;
  if v_confirmed_events<>2 or v_completed_events<>2 then
    raise exception 'F13-03 group audit mismatch: confirmed %, completed %',v_confirmed_events,v_completed_events;
  end if;
  if v_commands<>2 then
    raise exception 'F13-03 idempotency replay created unexpected command count: %',v_commands;
  end if;
end
$f13lifecycle$;

delete from public.businesses where id='f3310000-0000-4000-8000-000000000001';
delete from auth.users where id='f3300000-0000-4000-8000-000000000001';

do $$
begin
  raise notice 'F13-03 native group lifecycle: atomic lines, single version bump, audit, idempotent replay, stale/transition/recovery fail-closed passed';
end
$$;
