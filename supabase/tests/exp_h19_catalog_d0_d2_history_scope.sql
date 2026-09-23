begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('e4620000-0000-4000-8000-000000000001','h19-catalog-owner-a@example.invalid','{}'::jsonb),
  ('e4620000-0000-4000-8000-000000000002','h19-catalog-owner-b@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by) values
  ('e4621000-0000-4000-8000-000000000001','H19 Catalog A','h19-catalog-a','Europe/Istanbul','e4620000-0000-4000-8000-000000000001'),
  ('e4621000-0000-4000-8000-000000000002','H19 Catalog B','h19-catalog-b','Europe/Istanbul','e4620000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active) values
  ('e4622000-0000-4000-8000-000000000001','e4621000-0000-4000-8000-000000000001','e4620000-0000-4000-8000-000000000001','owner',true),
  ('e4622000-0000-4000-8000-000000000002','e4621000-0000-4000-8000-000000000002','e4620000-0000-4000-8000-000000000002','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  price_minor,currency,active,updated_at
) values
  ('e4623000-0000-4000-8000-000000000001','e4621000-0000-4000-8000-000000000001','Kesim',30,0,0,10000,'TRY',true,now() - interval '1 second'),
  ('e4623000-0000-4000-8000-000000000002','e4621000-0000-4000-8000-000000000002','Kesim',30,0,0,12000,'TRY',true,now() - interval '1 second');

insert into public.staff_profiles(id,business_id,name,phone,active)
values ('e4624000-0000-4000-8000-000000000002','e4621000-0000-4000-8000-000000000002','B Staff','5554620002',true);

insert into public.customers(id,business_id,name,phone,created_by)
values ('e4625000-0000-4000-8000-000000000002','e4621000-0000-4000-8000-000000000002','B Customer','5554620003','e4620000-0000-4000-8000-000000000002');

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,price_minor_snapshot,currency_snapshot,
  created_by
) values (
  'e4626000-0000-4000-8000-000000000002','e4621000-0000-4000-8000-000000000002',
  'e4625000-0000-4000-8000-000000000002','e4623000-0000-4000-8000-000000000002','e4624000-0000-4000-8000-000000000002','confirmed',
  '2026-10-12T10:00:00+03','2026-10-12T10:30:00+03','2026-10-12T10:00:00+03','2026-10-12T10:30:00+03','Europe/Istanbul',
  'B Customer','5554620003',null,'Kesim','B Staff',30,0,0,12000,'TRY',
  'e4620000-0000-4000-8000-000000000002'
);

select set_config(
  'h19.catalog_a_updated_at',
  (select updated_at::text from public.services where id='e4623000-0000-4000-8000-000000000001'),
  false
);

set local role authenticated;
select set_config('request.jwt.claim.sub','e4620000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $h19$
declare
  v_result public.services;
begin
  select * into v_result
  from public.update_service_guarded(
    'e4621000-0000-4000-8000-000000000001',
    'e4623000-0000-4000-8000-000000000001',
    current_setting('h19.catalog_a_updated_at')::timestamptz,
    '{"name":"Premium Kesim"}'::jsonb
  );

  if v_result.name <> 'Premium Kesim' then
    raise exception 'H19 catalog D0xD2 tenant-A service rename did not commit: %', v_result.name;
  end if;
end
$h19$;

reset role;

do $h19$
declare
  v_b_service text;
  v_b_snapshot text;
begin
  select name into v_b_service
  from public.services
  where business_id='e4621000-0000-4000-8000-000000000002'
    and id='e4623000-0000-4000-8000-000000000002';

  select service_name_snapshot into v_b_snapshot
  from public.appointments
  where business_id='e4621000-0000-4000-8000-000000000002'
    and id='e4626000-0000-4000-8000-000000000002';

  if v_b_service <> 'Kesim' then
    raise exception 'H19 catalog D0xD2 foreign current service changed: %', v_b_service;
  end if;

  if v_b_snapshot <> 'Kesim' then
    raise exception 'H19 catalog D0xD2 foreign historical snapshot drifted: %', v_b_snapshot;
  end if;

  raise notice 'H19 catalog D0xD2 prospective invariant accepted: tenant-A catalog mutation left tenant-B history unchanged';
end
$h19$;

rollback;
