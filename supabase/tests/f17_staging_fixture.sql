\set ON_ERROR_STOP on
\set owner_a 'f1740000-0000-4000-8000-000000000001'
\set owner_b 'f1740000-0000-4000-8000-000000000002'

insert into auth.users(id, email, raw_user_meta_data)
values
  (:'owner_a'::uuid, 'owner-a@staging.invalid', '{"full_name":"Owner A"}'::jsonb),
  (:'owner_b'::uuid, 'owner-b@staging.invalid', '{"full_name":"Owner B"}'::jsonb)
on conflict (id) do update
set email = excluded.email,
    raw_user_meta_data = excluded.raw_user_meta_data;

\ir ../seeds/staging_fixture.sql

begin;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', true);

do $$
begin
  if (select count(*) from public.businesses) <> 1 then
    raise exception 'F17 staging fixture leaked business rows across tenants';
  end if;
  if not exists (
    select 1 from public.businesses
    where id = 'f1700000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'F17 owner A cannot see its fixture business';
  end if;
  if (select count(*) from public.services) <> 1 then
    raise exception 'F17 staging fixture leaked services across tenants';
  end if;
  if (select count(*) from public.staff_profiles) <> 1 then
    raise exception 'F17 staging fixture leaked staff across tenants';
  end if;
end
$$;

reset role;

-- The fixture should create complete bookable skeletons for both fake businesses.
do $$
begin
  if (select count(*) from public.businesses where id::text like 'f1700000-%') <> 2 then
    raise exception 'F17 staging fixture did not create exactly two businesses';
  end if;
  if (select count(*) from public.business_hours where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )) <> 12 then
    raise exception 'F17 staging fixture business hours are incomplete';
  end if;
  if (select count(*) from public.staff_hours where business_id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )) <> 12 then
    raise exception 'F17 staging fixture staff hours are incomplete';
  end if;
  if (select count(*) from public.public_booking_settings
      where business_id in (
        'f1700000-0000-4000-8000-000000000001'::uuid,
        'f1700000-0000-4000-8000-000000000002'::uuid
      ) and enabled) <> 2 then
    raise exception 'F17 staging fixture public booking settings are not enabled';
  end if;
end
$$;

rollback;

\ir ../seeds/staging_reset.sql

do $$
begin
  if exists (
    select 1 from public.businesses
    where id in (
      'f1700000-0000-4000-8000-000000000001'::uuid,
      'f1700000-0000-4000-8000-000000000002'::uuid
    )
  ) then
    raise exception 'F17 staging reset left fixture businesses behind';
  end if;
end
$$;

delete from auth.users
where id in (:'owner_a'::uuid, :'owner_b'::uuid);
