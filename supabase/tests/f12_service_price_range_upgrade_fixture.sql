-- Runs on yzt_s08_upgrade before the F12-03 migration. This is deliberately
-- legacy-only data: one fixed service and one historical appointment snapshot.
insert into auth.users(id, email, raw_user_meta_data)
values ('c1200000-0000-4000-8000-000000000001', 'f12-03-upgrade@example.invalid', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values (
  'c1210000-0000-4000-8000-000000000001', 'F12 03 Upgrade', 'f12-03-upgrade',
  'Europe/Istanbul', 'c1200000-0000-4000-8000-000000000001'
);

insert into public.memberships(id, business_id, user_id, role, active)
values (
  'c1220000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'owner', true
);

insert into public.services(
  id, business_id, name, duration_minutes, buffer_before_minutes,
  buffer_after_minutes, price_minor, currency, active
) values (
  'c1230000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000001',
  'Legacy Fixed', 45, 5, 10, 12345, 'TRY', true
);

insert into public.staff_profiles(id, business_id, name, active)
values (
  'c1240000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000001',
  'Legacy Staff', true
);

insert into public.staff_services(business_id, staff_id, service_id, active)
values (
  'c1210000-0000-4000-8000-000000000001',
  'c1240000-0000-4000-8000-000000000001',
  'c1230000-0000-4000-8000-000000000001', true
);

insert into public.customers(id, business_id, name, phone, created_by)
values (
  'c1250000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000001',
  'Legacy Customer', '5551200303', 'c1200000-0000-4000-8000-000000000001'
);

insert into public.appointments(
  id, business_id, customer_id, service_id, staff_id, status,
  starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
  customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
  service_name_snapshot, staff_name_snapshot, duration_minutes_snapshot,
  buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
  price_minor_snapshot, currency_snapshot, created_by
) values (
  'c1260000-0000-4000-8000-000000000001',
  'c1210000-0000-4000-8000-000000000001',
  'c1250000-0000-4000-8000-000000000001',
  'c1230000-0000-4000-8000-000000000001',
  'c1240000-0000-4000-8000-000000000001',
  'confirmed',
  '2026-10-19T10:00:00+03', '2026-10-19T10:45:00+03',
  '2026-10-19T09:55:00+03', '2026-10-19T10:55:00+03',
  'Europe/Istanbul',
  'Legacy Customer', '5551200303', null,
  'Legacy Fixed', 'Legacy Staff', 45, 5, 10,
  12345, 'TRY', 'c1200000-0000-4000-8000-000000000001'
);
