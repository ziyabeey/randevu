\set ON_ERROR_STOP on

-- F17-01 staging fixture. The two owner UUIDs must already exist in auth.users.
-- Real customer data must never be copied into this dataset.

begin;

delete from public.businesses
where id in (
  'f1700000-0000-4000-8000-000000000001'::uuid,
  'f1700000-0000-4000-8000-000000000002'::uuid
);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('f1700000-0000-4000-8000-000000000001', 'Staging Salon A', 'staging-salon-a', 'Europe/Istanbul', :'owner_a'::uuid),
  ('f1700000-0000-4000-8000-000000000002', 'Staging Salon B', 'staging-salon-b', 'Europe/Istanbul', :'owner_b'::uuid);

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('f1710000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', :'owner_a'::uuid, 'owner', true),
  ('f1710000-0000-4000-8000-000000000002', 'f1700000-0000-4000-8000-000000000002', :'owner_b'::uuid, 'owner', true);

insert into public.services(
  id, business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
  price_minor, currency, active
)
values
  ('f1720000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', 'Saç Kesimi', 45, 0, 10, 65000, 'TRY', true),
  ('f1720000-0000-4000-8000-000000000002', 'f1700000-0000-4000-8000-000000000002', 'Fön', 30, 0, 5, 45000, 'TRY', true);

insert into public.staff_profiles(id, business_id, membership_id, name, phone, active)
values
  ('f1730000-0000-4000-8000-000000000001', 'f1700000-0000-4000-8000-000000000001', null, 'Ada Staging', null, true),
  ('f1730000-0000-4000-8000-000000000002', 'f1700000-0000-4000-8000-000000000002', null, 'Bora Staging', null, true);

insert into public.staff_services(business_id, staff_id, service_id, active)
values
  ('f1700000-0000-4000-8000-000000000001', 'f1730000-0000-4000-8000-000000000001', 'f1720000-0000-4000-8000-000000000001', true),
  ('f1700000-0000-4000-8000-000000000002', 'f1730000-0000-4000-8000-000000000002', 'f1720000-0000-4000-8000-000000000002', true);

insert into public.business_hours(business_id, weekday, starts_local, ends_local, active)
select b.id, d.weekday, '09:00'::time, '18:00'::time, true
from (
  values
    ('f1700000-0000-4000-8000-000000000001'::uuid),
    ('f1700000-0000-4000-8000-000000000002'::uuid)
) as b(id)
cross join generate_series(1, 6) as d(weekday);

insert into public.staff_hours(business_id, staff_id, weekday, starts_local, ends_local, active)
select x.business_id, x.staff_id, d.weekday, '09:00'::time, '18:00'::time, true
from (
  values
    ('f1700000-0000-4000-8000-000000000001'::uuid, 'f1730000-0000-4000-8000-000000000001'::uuid),
    ('f1700000-0000-4000-8000-000000000002'::uuid, 'f1730000-0000-4000-8000-000000000002'::uuid)
) as x(business_id, staff_id)
cross join generate_series(1, 6) as d(weekday);

update public.public_booking_settings
set enabled = true,
    step_minutes = 15,
    min_notice_minutes = 0,
    horizon_days = 30
where business_id in (
  'f1700000-0000-4000-8000-000000000001'::uuid,
  'f1700000-0000-4000-8000-000000000002'::uuid
);

commit;
