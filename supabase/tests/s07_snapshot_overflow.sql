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

update public.public_booking_settings
set enabled = true
where business_id = 'a7000000-0000-4000-8000-000000000001';

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active
)
select
  ('a8000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'a7000000-0000-4000-8000-000000000001'::uuid,
  'Snapshot Service ' || lpad(gs::text, 3, '0'),
  30,0,0,10000,'TRY',true
from generate_series(1,101) gs
on conflict(id) do update set active=true;

insert into public.staff_profiles(id,business_id,name,active)
select
  ('a9000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'a7000000-0000-4000-8000-000000000001'::uuid,
  'Snapshot Staff ' || lpad(gs::text, 3, '0'),
  true
from generate_series(1,101) gs
on conflict(id) do update set active=true;

-- One active staff member makes all 101 services public-eligible.
insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'a7000000-0000-4000-8000-000000000001'::uuid,
  'a9000000-0000-4000-8000-000000000001'::uuid,
  ('a8000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  true
from generate_series(1,101) gs
on conflict(business_id,staff_id,service_id) do update set active=true;

-- All 101 staff members are eligible for service 1.
insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'a7000000-0000-4000-8000-000000000001'::uuid,
  ('a9000000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  'a8000000-0000-4000-8000-000000000001'::uuid,
  true
from generate_series(1,101) gs
on conflict(business_id,staff_id,service_id) do update set active=true;

-- Boundary 100 is a complete successful snapshot, never an overflow.
update public.services
set active=false
where id='a8000000-0000-4000-8000-000000000101';
update public.staff_profiles
set active=false
where id='a9000000-0000-4000-8000-000000000101';

do $$
begin
  if (select count(*) from public.get_public_booking_services('s07-c2b-snapshot')) <> 100 then
    raise exception 'C2b service boundary 100 did not remain complete';
  end if;
  if (select count(*) from public.get_public_booking_staff(
    's07-c2b-snapshot','a8000000-0000-4000-8000-000000000001'
  )) <> 100 then
    raise exception 'C2b staff boundary 100 did not remain complete';
  end if;
end
$$;

-- The 101st row must fail the entire snapshot with the explicit capacity code.
update public.services
set active=true
where id='a8000000-0000-4000-8000-000000000101';
update public.staff_profiles
set active=true
where id='a9000000-0000-4000-8000-000000000101';

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
    raise exception 'C2b 101-service snapshot was silently accepted';
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
    raise exception 'C2b 101-staff snapshot was silently accepted';
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

-- Public catalog reads have a DB-side fail-closed budget and raw functions stay
-- unavailable to browser roles.
do $$
begin
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
