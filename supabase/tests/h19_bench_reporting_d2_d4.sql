begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('f19d0000-0000-4000-8000-000000000001','h19-report-snapshot@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f19d1000-0000-4000-8000-000000000001',
  'H19 D2D4 Report',
  'h19-d2d4-report',
  'Europe/Istanbul',
  'f19d0000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f19d2000-0000-4000-8000-000000000001',
  'f19d1000-0000-4000-8000-000000000001',
  'f19d0000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.customers(id,business_id,name,created_by)
values (
  'f19d3000-0000-4000-8000-000000000001',
  'f19d1000-0000-4000-8000-000000000001',
  'H19 Snapshot Customer',
  'f19d0000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f19d4000-0000-4000-8000-000000000001',
  'f19d1000-0000-4000-8000-000000000001',
  'H19 Snapshot Service',
  30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,membership_id,name,active)
values (
  'f19d5000-0000-4000-8000-000000000001',
  'f19d1000-0000-4000-8000-000000000001',
  'f19d2000-0000-4000-8000-000000000001',
  'H19 Snapshot Staff',
  true
);

insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by,created_at,updated_at
) values (
  'f19d6000-0000-4000-8000-000000000001',
  'f19d1000-0000-4000-8000-000000000001',
  'f19d3000-0000-4000-8000-000000000001',
  'scheduled','operator',1,
  'f19d0000-0000-4000-8000-000000000001',
  '2026-09-23 08:00+03','2026-09-23 08:00+03'
);

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,price_minor_snapshot,
  currency_snapshot,notes,created_by,created_at,updated_at,source,
  group_id,line_ordinal,price_type_snapshot,price_min_minor_snapshot,
  price_max_minor_snapshot,price_policy_version_snapshot
) values (
  'f19d7000-0000-4000-8000-000000000001',
  'f19d1000-0000-4000-8000-000000000001',
  'f19d3000-0000-4000-8000-000000000001',
  'f19d4000-0000-4000-8000-000000000001',
  'f19d5000-0000-4000-8000-000000000001',
  'scheduled',
  '2026-09-23 12:00+03','2026-09-23 12:30+03',
  '2026-09-23 12:00+03','2026-09-23 12:30+03',
  'Europe/Istanbul',
  'H19 Snapshot Customer',null,null,
  'H19 Snapshot Service','H19 Snapshot Staff',30,0,0,10000,
  'TRY',null,
  'f19d0000-0000-4000-8000-000000000001',
  '2026-09-23 08:00+03','2026-09-23 08:00+03',
  'operator',
  'f19d6000-0000-4000-8000-000000000001',
  1,'fixed',10000,10000,1
);

update public.services
set price_minor=25000,
    price_min_minor=25000,
    price_max_minor=25000
where business_id='f19d1000-0000-4000-8000-000000000001'
  and id='f19d4000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','f19d0000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $h19_reporting_d2d4$
declare
  v jsonb;
begin
  v:=public.get_financial_day_report(
    'f19d1000-0000-4000-8000-000000000001',
    '2026-09-23',
    '2026-09-23'
  );

  if (v->>'appointmentCount')::integer<>1
     or (v->>'expectedAppointmentMinMinor')::bigint<>10000
     or (v->>'expectedAppointmentMaxMinor')::bigint<>10000
     or v->>'timezone'<>'Europe/Istanbul'
     or (v->>'fromInstant')::timestamptz<>'2026-09-22 21:00+00'::timestamptz
     or (v->>'toInstant')::timestamptz<>'2026-09-23 21:00+00'::timestamptz then
    raise exception 'H19 benchmark reporting D2xD4 local-day appointment snapshot drifted after service reprice: %',v;
  end if;

  raise notice 'H19 benchmark reporting D2xD4 PASS: local-day report retained appointment price snapshot after service reprice';
end
$h19_reporting_d2d4$;

reset role;
rollback;
