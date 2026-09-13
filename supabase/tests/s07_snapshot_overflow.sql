begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  'a6000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s07-c2b@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'a7000000-0000-4000-8000-000000000001',
  'S07 C2b Snapshot',
  's07-c2b-snapshot',
  'Europe/Istanbul',
  'a6000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'a7100000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  'owner',
  true
)
on conflict(id) do update set active=true;

update public.public_booking_settings
set enabled = true
where business_id = 'a7000000-0000-4000-8000-000000000001';

-- Start exactly at the authenticated catalog boundaries: 100 services,
-- 100 staff and 5,000 assignments. The assignment fixture deliberately exceeds
-- common hosted REST row caps while the RPC itself still returns one row.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active
)
select
  ('a8000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'a7000000-0000-4000-8000-000000000001'::uuid,
  'Snapshot Service ' || lpad(gs::text, 3, '0'),
  30,0,0,10000,'TRY',true
from generate_series(1,100) gs
on conflict(id) do update set active=true;

insert into public.staff_profiles(id,business_id,name,active)
select
  ('a9000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'a7000000-0000-4000-8000-000000000001'::uuid,
  'Snapshot Staff ' || lpad(gs::text, 3, '0'),
  true
from generate_series(1,100) gs
on conflict(id) do update set active=true;

insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'a7000000-0000-4000-8000-000000000001'::uuid,
  ('a9000000-0000-4000-8000-' || lpad(staff_no::text, 12, '0'))::uuid,
  ('a8000000-0000-4000-8000-' || lpad(service_no::text, 12, '0'))::uuid,
  true
from generate_series(1,50) staff_no
cross join generate_series(1,100) service_no
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_snapshot record;
begin
  select * into strict v_snapshot
  from public.get_catalog_snapshot('a7000000-0000-4000-8000-000000000001');

  if jsonb_array_length(v_snapshot.services) <> 100 then
    raise exception 'C2b authenticated service boundary 100 was incomplete';
  end if;
  if jsonb_array_length(v_snapshot.staff) <> 100 then
    raise exception 'C2b authenticated staff boundary 100 was incomplete';
  end if;
  if jsonb_array_length(v_snapshot.assignments) <> 5000 then
    raise exception 'C2b authenticated assignment boundary 5000 was incomplete';
  end if;
end
$$;
reset role;

-- A caller without a current active membership cannot use the definer RPC to
-- widen tenant scope.
set local role authenticated;
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000099',true);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform * from public.get_catalog_snapshot('a7000000-0000-4000-8000-000000000001');
  exception when others then
    if position('NOT_ALLOWED' in sqlerrm) > 0 then
      v_denied := true;
    else
      raise;
    end if;
  end;
  if not v_denied then
    raise exception 'C2b catalog snapshot widened tenant authority';
  end if;
end
$$;
reset role;

-- 101 services must reject the entire authenticated snapshot.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active
)
values (
  'a8000000-0000-4000-8000-000000000101',
  'a7000000-0000-4000-8000-000000000001',
  'Snapshot Service 101',30,0,0,10000,'TRY',true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform * from public.get_catalog_snapshot('a7000000-0000-4000-8000-000000000001');
  exception when others then
    if position('CATALOG_SERVICES_LIMIT_EXCEEDED' in sqlerrm) > 0 then
      v_failed := true;
    else
      raise;
    end if;
  end;
  if not v_failed then
    raise exception 'C2b 101-service authenticated snapshot was silently accepted';
  end if;
end
$$;
reset role;

delete from public.services
where id='a8000000-0000-4000-8000-000000000101';

-- 101 staff must reject the entire authenticated snapshot.
insert into public.staff_profiles(id,business_id,name,active)
values (
  'a9000000-0000-4000-8000-000000000101',
  'a7000000-0000-4000-8000-000000000001',
  'Snapshot Staff 101',true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform * from public.get_catalog_snapshot('a7000000-0000-4000-8000-000000000001');
  exception when others then
    if position('CATALOG_STAFF_LIMIT_EXCEEDED' in sqlerrm) > 0 then
      v_failed := true;
    else
      raise;
    end if;
  end;
  if not v_failed then
    raise exception 'C2b 101-staff authenticated snapshot was silently accepted';
  end if;
end
$$;
reset role;

delete from public.staff_profiles
where id='a9000000-0000-4000-8000-000000000101';

-- The 5,001st assignment is measured inside PostgreSQL, never through a raw
-- PostgREST list response.
insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'a7000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000051',
  'a8000000-0000-4000-8000-000000000001',
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','a6000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform * from public.get_catalog_snapshot('a7000000-0000-4000-8000-000000000001');
  exception when others then
    if position('CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED' in sqlerrm) > 0 then
      v_failed := true;
    else
      raise;
    end if;
  end;
  if not v_failed then
    raise exception 'C2b 5001-assignment snapshot was silently accepted';
  end if;
end
$$;
reset role;

delete from public.staff_services
where business_id='a7000000-0000-4000-8000-000000000001'
  and staff_id='a9000000-0000-4000-8000-000000000051'
  and service_id='a8000000-0000-4000-8000-000000000001';

-- Public boundary: make all 100 staff eligible for service 1. All 100 services
-- already have at least one eligible active staff member via the 5,000-row grid.
insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'a7000000-0000-4000-8000-000000000001'::uuid,
  ('a9000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'a8000000-0000-4000-8000-000000000001'::uuid,
  true
from generate_series(51,100) gs
on conflict(business_id,staff_id,service_id) do update set active=true;

do $$
begin
  if (select count(*) from public.get_public_booking_services('s07-c2b-snapshot')) <> 100 then
    raise exception 'C2b public service boundary 100 did not remain complete';
  end if;
  if (select count(*) from public.get_public_booking_staff(
    's07-c2b-snapshot','a8000000-0000-4000-8000-000000000001'
  )) <> 100 then
    raise exception 'C2b public staff boundary 100 did not remain complete';
  end if;
end
$$;

-- The public 101st rows also fail the whole snapshot with explicit codes.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active
)
values (
  'a8000000-0000-4000-8000-000000000101',
  'a7000000-0000-4000-8000-000000000001',
  'Snapshot Service 101',30,0,0,10000,'TRY',true
);
insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'a7000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000101',
  true
);

insert into public.staff_profiles(id,business_id,name,active)
values (
  'a9000000-0000-4000-8000-000000000101',
  'a7000000-0000-4000-8000-000000000001',
  'Snapshot Staff 101',true
);
insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'a7000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000101',
  'a8000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  v_services_failed boolean := false;
  v_staff_failed boolean := false;
begin
  begin
    perform count(*) from public.get_public_booking_services('s07-c2b-snapshot');
  exception when others then
    if position('PUBLIC_SERVICES_LIMIT_EXCEEDED' in sqlerrm) > 0 then
      v_services_failed := true;
    else
      raise;
    end if;
  end;
  if not v_services_failed then
    raise exception 'C2b 101-service public snapshot was silently accepted';
  end if;

  begin
    perform count(*) from public.get_public_booking_staff(
      's07-c2b-snapshot','a8000000-0000-4000-8000-000000000001'
    );
  exception when others then
    if position('PUBLIC_STAFF_LIMIT_EXCEEDED' in sqlerrm) > 0 then
      v_staff_failed := true;
    else
      raise;
    end if;
  end;
  if not v_staff_failed then
    raise exception 'C2b 101-staff public snapshot was silently accepted';
  end if;
end
$$;

-- The gated public-operation envelope must preserve, not redact, the two known
-- capacity failures so the Worker can expose an understandable *_LIMIT_EXCEEDED.
do $$
begin
  if public.public_operation_error('PUBLIC_SERVICES_LIMIT_EXCEEDED')->'error'->>'message'
      <> 'PUBLIC_SERVICES_LIMIT_EXCEEDED' then
    raise exception 'C2b service overflow was redacted at public operation boundary';
  end if;
  if public.public_operation_error('PUBLIC_STAFF_LIMIT_EXCEEDED')->'error'->>'message'
      <> 'PUBLIC_STAFF_LIMIT_EXCEEDED' then
    raise exception 'C2b staff overflow was redacted at public operation boundary';
  end if;
end
$$;

-- Every snapshot function has a DB-side fail-closed budget. The authenticated
-- aggregate is callable only by authenticated, while raw public helpers remain
-- inaccessible to browser roles.
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='get_catalog_snapshot'
      and coalesce(p.proconfig,'{}'::text[]) @> array['statement_timeout=5s']::text[]
  ) then
    raise exception 'C2b authenticated catalog snapshot statement timeout missing';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='get_public_booking_services'
      and coalesce(p.proconfig,'{}'::text[]) @> array['statement_timeout=5s']::text[]
  ) then
    raise exception 'C2b service snapshot statement timeout missing';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='get_public_booking_staff'
      and coalesce(p.proconfig,'{}'::text[]) @> array['statement_timeout=5s']::text[]
  ) then
    raise exception 'C2b staff snapshot statement timeout missing';
  end if;

  if has_function_privilege('anon','public.get_catalog_snapshot(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_catalog_snapshot(uuid)','EXECUTE') then
    raise exception 'C2b authenticated catalog snapshot ACL is wrong';
  end if;
  if has_function_privilege('anon','public.get_public_booking_services(text)','EXECUTE')
     or has_function_privilege('authenticated','public.get_public_booking_services(text)','EXECUTE') then
    raise exception 'C2b raw public service snapshot became executable';
  end if;
  if has_function_privilege('anon','public.get_public_booking_staff(text,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.get_public_booking_staff(text,uuid)','EXECUTE') then
    raise exception 'C2b raw public staff snapshot became executable';
  end if;
end
$$;

rollback;
