begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('ba000000-0000-4000-8000-000000000001', 'f10-04-read-owner@example.invalid', '{}'::jsonb),
  ('ba000000-0000-4000-8000-000000000002', 'f10-04-read-other@example.invalid', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('ba100000-0000-4000-8000-000000000001', 'F10 04 Read A', 'f10-04-read-a', 'Europe/Istanbul', 'ba000000-0000-4000-8000-000000000001'),
  ('ba100000-0000-4000-8000-000000000002', 'F10 04 Read B', 'f10-04-read-b', 'Europe/Istanbul', 'ba000000-0000-4000-8000-000000000002');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('ba200000-0000-4000-8000-000000000001', 'ba100000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'owner', true),
  ('ba200000-0000-4000-8000-000000000002', 'ba100000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000002', 'owner', true);

insert into public.services(id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active)
values
  ('ba300000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','Read Service A',30,0,0,1000,'TRY',true),
  ('ba300000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000002','Read Service B',30,0,0,1000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('ba400000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','Read Staff A',true),
  ('ba400000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000002','Read Staff B',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('ba100000-0000-4000-8000-000000000001','ba400000-0000-4000-8000-000000000001','ba300000-0000-4000-8000-000000000001',true),
  ('ba100000-0000-4000-8000-000000000002','ba400000-0000-4000-8000-000000000002','ba300000-0000-4000-8000-000000000002',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values
  ('ba500000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001',1,'09:00','17:00',true),
  ('ba500000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000002',1,'09:00','17:00',true);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('ba600000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','ba400000-0000-4000-8000-000000000001',1,'09:00','17:00',true),
  ('ba600000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000002','ba400000-0000-4000-8000-000000000002',1,'09:00','17:00',true);

insert into public.availability_blocks(id,business_id,staff_id,starts_at,ends_at,reason,active)
values
  ('ba700000-0000-4000-8000-000000000001','ba100000-0000-4000-8000-000000000001','ba400000-0000-4000-8000-000000000001','2026-10-01T12:00:00+03','2026-10-01T13:00:00+03','Read A',true),
  ('ba700000-0000-4000-8000-000000000002','ba100000-0000-4000-8000-000000000002','ba400000-0000-4000-8000-000000000002','2026-10-01T12:00:00+03','2026-10-01T13:00:00+03','Read B',true);

-- The RLS predicate is authenticated-only and does not widen anonymous access.
do $$
begin
  if has_function_privilege('anon','public.f10_has_standard_session()','EXECUTE') then
    raise exception 'anon unexpectedly gained standard-session predicate access';
  end if;
  if not has_function_privilege('authenticated','public.f10_has_standard_session()','EXECUTE') then
    raise exception 'authenticated cannot evaluate F10-04 SELECT policy';
  end if;
  if has_table_privilege('anon','public.services','SELECT')
     or has_table_privilege('anon','public.staff_profiles','SELECT')
     or has_table_privilege('anon','public.staff_services','SELECT')
     or has_table_privilege('anon','public.business_hours','SELECT')
     or has_table_privilege('anon','public.staff_hours','SELECT')
     or has_table_privilege('anon','public.availability_blocks','SELECT') then
    raise exception 'anon unexpectedly gained F10-04 raw read privilege';
  end if;
end
$$;

-- Active-member recovery bearer must see no rows through raw Data API SELECT.
set local role authenticated;
select set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ba000000-0000-4000-8000-000000000001","role":"authenticated","amr":[{"method":"recovery"}]}',true);
do $$
begin
  if (select count(*) from public.services) <> 0 then raise exception 'recovery read services bypassed session boundary'; end if;
  if (select count(*) from public.staff_profiles) <> 0 then raise exception 'recovery read staff_profiles bypassed session boundary'; end if;
  if (select count(*) from public.staff_services) <> 0 then raise exception 'recovery read staff_services bypassed session boundary'; end if;
  if (select count(*) from public.business_hours) <> 0 then raise exception 'recovery read business_hours bypassed session boundary'; end if;
  if (select count(*) from public.staff_hours) <> 0 then raise exception 'recovery read staff_hours bypassed session boundary'; end if;
  if (select count(*) from public.availability_blocks) <> 0 then raise exception 'recovery read availability_blocks bypassed session boundary'; end if;
end
$$;
reset role;

-- Password AMR keeps the intended active-Membership read path and tenant isolation.
set local role authenticated;
select set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"ba000000-0000-4000-8000-000000000001","role":"authenticated","amr":[{"method":"password"}]}',true);
do $$
begin
  if (select count(*) from public.services) <> 1 then raise exception 'password session services read path broken'; end if;
  if (select count(*) from public.staff_profiles) <> 1 then raise exception 'password session staff read path broken'; end if;
  if (select count(*) from public.staff_services) <> 1 then raise exception 'password session assignment read path broken'; end if;
  if (select count(*) from public.business_hours) <> 1 then raise exception 'password session business hours read path broken'; end if;
  if (select count(*) from public.staff_hours) <> 1 then raise exception 'password session staff hours read path broken'; end if;
  if (select count(*) from public.availability_blocks) <> 1 then raise exception 'password session blocks read path broken'; end if;
  if exists (select 1 from public.services where business_id='ba100000-0000-4000-8000-000000000002') then
    raise exception 'password session crossed tenant boundary';
  end if;
end
$$;
reset role;

rollback;
