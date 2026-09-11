begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@example.test','',now(),'{}','{}',now(),now()),
  ('20000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@example.test','',now(),'{}','{}',now(),now())
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('30000000-0000-4000-8000-000000000003','Tenant A','tenant-a','Europe/Istanbul','10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000004','Tenant B','tenant-b','Europe/Istanbul','20000000-0000-4000-8000-000000000002')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('50000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','owner',true),
  ('60000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','owner',true)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(id,business_id,name,duration_minutes,price_minor)
values
  ('70000000-0000-4000-8000-000000000007','30000000-0000-4000-8000-000000000003','A Hizmeti',30,100000),
  ('80000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000004','B Hizmeti',45,150000)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values
  ('90000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000003','A Personeli'),
  ('a0000000-0000-4000-8000-00000000000a','40000000-0000-4000-8000-000000000004','B Personeli')
on conflict(id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

do $$
begin
  if (select count(*) from public.services) <> 1 then
    raise exception 'tenant isolation failed for services';
  end if;
  if exists(select 1 from public.services where business_id='40000000-0000-4000-8000-000000000004') then
    raise exception 'tenant A can see tenant B service';
  end if;
  if (select count(*) from public.staff_profiles) <> 1 then
    raise exception 'tenant isolation failed for staff';
  end if;
end $$;

reset role;

update public.memberships
set active=false
where business_id='30000000-0000-4000-8000-000000000003'
  and user_id='10000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);

do $$
begin
  if exists(select 1 from public.services where business_id='30000000-0000-4000-8000-000000000003') then
    raise exception 'inactive membership still reads services';
  end if;
end $$;

reset role;

-- Database constraints are a second validation boundary.
do $$
begin
  begin
    insert into public.services(business_id,name,duration_minutes,price_minor)
    values('40000000-0000-4000-8000-000000000004','Bozuk Süre',0,1000);
    raise exception 'invalid duration unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.services(business_id,name,duration_minutes,price_minor)
    values('40000000-0000-4000-8000-000000000004','Bozuk Fiyat',30,-1);
    raise exception 'invalid price unexpectedly accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.staff_services(business_id,staff_id,service_id,active)
    values(
      '30000000-0000-4000-8000-000000000003',
      '90000000-0000-4000-8000-000000000009',
      '80000000-0000-4000-8000-000000000008',
      true
    );
    raise exception 'cross-tenant staff-service link unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
end $$;

rollback;
