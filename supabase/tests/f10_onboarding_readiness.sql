begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('a7000000-0000-4000-8000-000000000001', 'f10-onboarding-owner@example.invalid', '{"full_name":"F10 Onboarding Owner"}'::jsonb),
  ('a7000000-0000-4000-8000-000000000002', 'f10-onboarding-staff@example.invalid', '{"full_name":"F10 Onboarding Staff"}'::jsonb),
  ('a7000000-0000-4000-8000-000000000003', 'f10-onboarding-owner-b@example.invalid', '{"full_name":"F10 Onboarding Owner B"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('a7100000-0000-4000-8000-000000000001', 'F10 Onboarding A', 'f10-onboarding-a', 'Europe/Istanbul', 'a7000000-0000-4000-8000-000000000001'),
  ('a7100000-0000-4000-8000-000000000002', 'F10 Onboarding B', 'f10-onboarding-b', 'Europe/Istanbul', 'a7000000-0000-4000-8000-000000000003');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('a7200000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'owner', true),
  ('a7200000-0000-4000-8000-000000000002', 'a7100000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'staff', true),
  ('a7200000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003', 'owner', true);

-- Tenant B is fully configured before tenant A receives any setup records.
-- Its rows must never satisfy tenant A readiness.
insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('a7300000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000002', 'B Service', 30, 10000, true);
insert into public.staff_profiles(id, business_id, name, active)
values ('a7400000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000002', 'B Staff', true);
insert into public.staff_services(business_id, staff_id, service_id, active)
values ('a7100000-0000-4000-8000-000000000002', 'a7400000-0000-4000-8000-000000000003', 'a7300000-0000-4000-8000-000000000003', true);
insert into public.business_hours(id, business_id, weekday, starts_local, ends_local, active)
values ('a7500000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000002', 1, '09:00', '17:00', true);
insert into public.staff_hours(id, business_id, staff_id, weekday, starts_local, ends_local, active)
values ('a7600000-0000-4000-8000-000000000003', 'a7100000-0000-4000-8000-000000000002', 'a7400000-0000-4000-8000-000000000003', 1, '10:00', '16:00', true);

-- S08 object-ACL boundary: only authenticated onboarding wrappers are API surfaces.
do $$
begin
  if has_function_privilege('anon', 'public.get_business_onboarding_readiness(uuid)', 'EXECUTE') then
    raise exception 'anon unexpectedly executes onboarding readiness';
  end if;
  if not has_function_privilege('authenticated', 'public.get_business_onboarding_readiness(uuid)', 'EXECUTE') then
    raise exception 'authenticated onboarding readiness grant missing';
  end if;
  if has_function_privilege('anon', 'public.get_business_onboarding_snapshot(uuid)', 'EXECUTE') then
    raise exception 'anon unexpectedly executes onboarding snapshot';
  end if;
  if not has_function_privilege('authenticated', 'public.get_business_onboarding_snapshot(uuid)', 'EXECUTE') then
    raise exception 'authenticated onboarding snapshot grant missing';
  end if;
  if has_function_privilege('anon', 'public.business_onboarding_readiness_internal(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.business_onboarding_readiness_internal(uuid)', 'EXECUTE') then
    raise exception 'internal onboarding readiness unexpectedly exposed';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.update_public_booking_settings(uuid,boolean,integer,integer,integer)',
      'EXECUTE'
    ) then
    raise exception 'authenticated public settings grant missing';
  end if;
  if has_function_privilege('anon', 'public.update_public_booking_settings(uuid,boolean,integer,integer,integer)', 'EXECUTE') then
    raise exception 'anon unexpectedly mutates public settings';
  end if;
  if has_function_privilege('anon', 'public.get_public_booking_services(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_public_booking_services(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_public_booking_staff(text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_public_booking_staff(text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.compute_public_booking_slots(text,uuid,date,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.compute_public_booking_slots(text,uuid,date,uuid)', 'EXECUTE') then
    raise exception 'raw public booking implementation unexpectedly exposed';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and t.tgname = 'f10_public_appointment_readiness_guard'
      and not t.tgisinternal
  ) then
    raise exception 'public appointment readiness trigger missing';
  end if;
end
$$;

-- Owner A sees only tenant A state and recovery sessions fail closed at DB RPC.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"recovery"}]}', true);

do $$
begin
  begin
    perform public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
    raise exception 'recovery unexpectedly read onboarding readiness';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read onboarding readiness' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.get_business_onboarding_snapshot('a7100000-0000-4000-8000-000000000001');
    raise exception 'recovery unexpectedly read onboarding snapshot';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read onboarding snapshot' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare
  r record;
begin
  select * into r
  from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if r.publishable or r.has_active_service or not ('SERVICE_REQUIRED' = any(r.missing_reasons)) then
    raise exception 'cross-business rows incorrectly satisfied tenant A service readiness';
  end if;

  begin
    perform public.update_public_booking_settings(
      'a7100000-0000-4000-8000-000000000001', true, 15, 60, 60
    );
    raise exception 'incomplete business unexpectedly published';
  exception when others then
    if sqlerrm = 'incomplete business unexpectedly published' then raise; end if;
    if position('PUBLIC_BOOKING_NOT_READY' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Disabling is always allowed, even while setup is incomplete.
do $$
declare
  v_enabled boolean;
begin
  select (public.update_public_booking_settings(
    'a7100000-0000-4000-8000-000000000001', false, 15, 60, 60
  )).enabled into v_enabled;
  if v_enabled then raise exception 'incomplete business could not be disabled'; end if;
end
$$;
reset role;

-- An inactive service is not a completed service step.
insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('a7300000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'A Service', 30, 12000, false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if r.has_active_service then raise exception 'inactive service counted as ready'; end if;
end
$$;
reset role;
update public.services set active = true where id = 'a7300000-0000-4000-8000-000000000001';

-- An inactive staff profile is not a completed staff step.
insert into public.staff_profiles(id, business_id, membership_id, name, active)
values ('a7400000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', null, 'A Staff', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if r.has_active_staff or not ('STAFF_REQUIRED' = any(r.missing_reasons)) then
    raise exception 'inactive staff counted as ready';
  end if;
end
$$;
reset role;
update public.staff_profiles set active = true where id = 'a7400000-0000-4000-8000-000000000001';

-- An inactive service assignment is not enough to publish.
insert into public.staff_services(business_id, staff_id, service_id, active)
values ('a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000001', 'a7300000-0000-4000-8000-000000000001', false);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if r.has_active_assignment or not ('ASSIGNMENT_REQUIRED' = any(r.missing_reasons)) then
    raise exception 'inactive assignment counted as ready';
  end if;
end
$$;
reset role;
update public.staff_services set active = true
where business_id = 'a7100000-0000-4000-8000-000000000001'
  and staff_id = 'a7400000-0000-4000-8000-000000000001'
  and service_id = 'a7300000-0000-4000-8000-000000000001';

-- Business hours and assigned-staff hours are independent required steps.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if r.has_business_hours or not ('BUSINESS_HOURS_REQUIRED' = any(r.missing_reasons)) then
    raise exception 'missing business hours not reported';
  end if;
end
$$;
reset role;

insert into public.business_hours(id, business_id, weekday, starts_local, ends_local, active)
values ('a7500000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 1, '09:00', '17:00', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if r.has_staff_hours or not ('STAFF_HOURS_REQUIRED' = any(r.missing_reasons)) then
    raise exception 'missing staff hours not reported';
  end if;
end
$$;
reset role;

-- Assigned staff hours that never overlap business hours still fail readiness.
insert into public.staff_hours(id, business_id, staff_id, weekday, starts_local, ends_local, active)
values ('a7600000-0000-4000-8000-000000000001', 'a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000001', 1, '18:00', '19:00', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare r record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if not r.has_staff_hours or r.has_overlapping_hours or r.publishable
     or not ('OVERLAPPING_HOURS_REQUIRED' = any(r.missing_reasons)) then
    raise exception 'non-overlapping schedule incorrectly publishable';
  end if;
end
$$;
reset role;

update public.staff_hours
set starts_local = '10:00', ends_local = '16:00'
where id = 'a7600000-0000-4000-8000-000000000001';

-- Date-specific closures are operational availability, not setup completeness.
insert into public.availability_blocks(
  id, business_id, staff_id, starts_at, ends_at, reason, active
) values (
  'a7700000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001',
  'a7400000-0000-4000-8000-000000000001',
  '2026-09-21T00:00:00+03', '2026-09-22T00:00:00+03', 'Kapalı', true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare
  r record;
  s record;
begin
  select * into r from public.get_business_onboarding_readiness('a7100000-0000-4000-8000-000000000001');
  if not r.publishable or cardinality(r.missing_reasons) <> 0 then
    raise exception 'complete structural setup not publishable';
  end if;

  select * into s from public.get_business_onboarding_snapshot('a7100000-0000-4000-8000-000000000001');
  if s.business->>'id' <> 'a7100000-0000-4000-8000-000000000001'
     or jsonb_array_length(s.services) <> 1
     or jsonb_array_length(s.staff) <> 1
     or jsonb_array_length(s.assignments) <> 1
     or jsonb_array_length(s.business_hours) <> 1
     or jsonb_array_length(s.staff_hours) <> 1
     or coalesce((s.readiness->>'publishable')::boolean, false) is not true then
    raise exception 'bounded onboarding snapshot did not return complete tenant A state';
  end if;
end
$$;
reset role;

-- Hosted row caps must never turn oversized setup state into a partial success.
insert into public.business_hours(id, business_id, weekday, starts_local, ends_local, active)
select gen_random_uuid(), 'a7100000-0000-4000-8000-000000000001', (g % 7)::smallint, '06:00', '06:30', true
from generate_series(1, 100) g;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
begin
  begin
    perform public.get_business_onboarding_snapshot('a7100000-0000-4000-8000-000000000001');
    raise exception 'oversized business hours returned a partial snapshot';
  exception when others then
    if sqlerrm = 'oversized business hours returned a partial snapshot' then raise; end if;
    if position('ONBOARDING_BUSINESS_HOURS_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;
delete from public.business_hours
where business_id = 'a7100000-0000-4000-8000-000000000001'
  and starts_local = '06:00' and ends_local = '06:30';

insert into public.staff_hours(id, business_id, staff_id, weekday, starts_local, ends_local, active)
select gen_random_uuid(), 'a7100000-0000-4000-8000-000000000001', 'a7400000-0000-4000-8000-000000000001',
       (g % 7)::smallint, '06:30', '07:00', true
from generate_series(1, 5000) g;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
begin
  begin
    perform public.get_business_onboarding_snapshot('a7100000-0000-4000-8000-000000000001');
    raise exception 'oversized staff hours returned a partial snapshot';
  exception when others then
    if sqlerrm = 'oversized staff hours returned a partial snapshot' then raise; end if;
    if position('ONBOARDING_STAFF_HOURS_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;
delete from public.staff_hours
where business_id = 'a7100000-0000-4000-8000-000000000001'
  and starts_local = '06:30' and ends_local = '07:00';

-- A staff membership cannot publish even when the business is fully ready.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
begin
  begin
    perform public.update_public_booking_settings(
      'a7100000-0000-4000-8000-000000000001', true, 15, 60, 60
    );
    raise exception 'staff unexpectedly published business';
  exception when others then
    if sqlerrm = 'staff unexpectedly published business' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Owner publishes the ready business.
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
do $$
declare v_enabled boolean;
begin
  select (public.update_public_booking_settings(
    'a7100000-0000-4000-8000-000000000001', true, 15, 60, 60
  )).enabled into v_enabled;
  if not v_enabled then raise exception 'ready business did not publish'; end if;
end
$$;
reset role;

-- Public visibility follows live readiness on every browse/slot surface. Breaking
-- one prerequisite keeps the saved enabled preference but exposes no stale data.
do $$
declare
  v_count integer;
  v_enabled boolean;
begin
  select count(*) into v_count
  from public.get_public_booking_business('f10-onboarding-a');
  if v_count <> 1 then raise exception 'ready published business missing publicly'; end if;
  select count(*) into v_count
  from public.get_public_booking_services('f10-onboarding-a');
  if v_count <> 1 then raise exception 'ready published service missing publicly'; end if;
  select count(*) into v_count
  from public.get_public_booking_staff('f10-onboarding-a', 'a7300000-0000-4000-8000-000000000001');
  if v_count <> 1 then raise exception 'ready published staff missing publicly'; end if;

  update public.services
  set active = false
  where id = 'a7300000-0000-4000-8000-000000000001';

  select enabled into v_enabled
  from public.public_booking_settings
  where business_id = 'a7100000-0000-4000-8000-000000000001';
  if not v_enabled then raise exception 'dynamic readiness unexpectedly mutated enabled preference'; end if;

  select count(*) into v_count
  from public.get_public_booking_business('f10-onboarding-a');
  if v_count <> 0 then raise exception 'incomplete published business remained publicly visible'; end if;
  select count(*) into v_count
  from public.get_public_booking_services('f10-onboarding-a');
  if v_count <> 0 then raise exception 'incomplete published services remained publicly visible'; end if;
  select count(*) into v_count
  from public.get_public_booking_staff('f10-onboarding-a', 'a7300000-0000-4000-8000-000000000001');
  if v_count <> 0 then raise exception 'incomplete published staff remained publicly visible'; end if;

  begin
    perform * from public.compute_public_booking_slots(
      'f10-onboarding-a',
      'a7300000-0000-4000-8000-000000000001',
      (now() at time zone 'Europe/Istanbul')::date,
      'a7400000-0000-4000-8000-000000000001'
    );
    raise exception 'incomplete published business still exposed slot surface';
  exception when others then
    if sqlerrm = 'incomplete published business still exposed slot surface' then raise; end if;
    if position('PUBLIC_BOOKING_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- The owner can still disable the now-incomplete business.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare v_enabled boolean;
begin
  select (public.update_public_booking_settings(
    'a7100000-0000-4000-8000-000000000001', false, 15, 60, 60
  )).enabled into v_enabled;
  if v_enabled then raise exception 'owner could not disable incomplete business'; end if;
end
$$;
reset role;

rollback;