\set ON_ERROR_STOP on

begin;

-- H19 permanent regression: public-booking D0xD4
-- Foreign tenant business-hours must not widen target public slot authority.

insert into auth.users(id, email, raw_user_meta_data)
values
  ('c1000000-0000-4000-8000-000000000001', 'h19-d0d4-a@example.invalid', '{}'::jsonb),
  ('c1000000-0000-4000-8000-000000000002', 'h19-d0d4-b@example.invalid', '{}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('c1100000-0000-4000-8000-000000000001', 'H19 Public A', 'h19-public-d0d4-a', 'Europe/Istanbul', 'c1000000-0000-4000-8000-000000000001'),
  ('c1100000-0000-4000-8000-000000000002', 'H19 Public B', 'h19-public-d0d4-b', 'Europe/Istanbul', 'c1000000-0000-4000-8000-000000000002');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('c1200000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner', true),
  ('c1200000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'owner', true);

insert into public.services(
  id, business_id, name, duration_minutes,
  buffer_before_minutes, buffer_after_minutes,
  price_minor, currency, active
)
values (
  'c1300000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'H19 Kesim', 30, 0, 0, 10000, 'TRY', true
);

insert into public.staff_profiles(id, business_id, name, active)
values (
  'c1400000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'H19 Staff A', true
);

insert into public.staff_services(business_id, staff_id, service_id, active)
values (
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  true
);

insert into public.business_hours(
  id, business_id, weekday, starts_local, ends_local, active
)
values
  (
    'c1500000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    extract(dow from (date_trunc('week', now() at time zone 'Europe/Istanbul')::date + 7))::smallint,
    '09:00', '10:00', true
  ),
  (
    'c1500000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000002',
    extract(dow from (date_trunc('week', now() at time zone 'Europe/Istanbul')::date + 7))::smallint,
    '15:00', '17:00', true
  );

insert into public.staff_hours(
  id, business_id, staff_id, weekday, starts_local, ends_local, active
)
values (
  'c1600000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week', now() at time zone 'Europe/Istanbul')::date + 7))::smallint,
  '09:00', '17:00', true
);

update public.public_booking_settings
set enabled = true,
    step_minutes = 30,
    min_notice_minutes = 0,
    horizon_days = 60
where business_id = 'c1100000-0000-4000-8000-000000000001';

do $h19$
declare
  v_day date := date_trunc('week', now() at time zone 'Europe/Istanbul')::date + 7;
  v_morning integer;
  v_outside integer;
  v_late integer;
begin
  if not exists (
    select 1
    from public.business_onboarding_readiness_internal(
      'c1100000-0000-4000-8000-000000000001'
    ) r
    where r.publishable
  ) then
    raise exception 'H19 public-booking D0xD4 harness invalid: target business not publishable';
  end if;

  select count(*) into v_morning
  from public.compute_public_booking_slots(
    'h19-public-d0d4-a',
    'c1300000-0000-4000-8000-000000000001',
    v_day,
    'c1400000-0000-4000-8000-000000000001'
  ) s
  where (s.starts_at at time zone 'Europe/Istanbul')::time >= time '09:00'
    and (s.ends_at at time zone 'Europe/Istanbul')::time <= time '10:00';

  if v_morning = 0 then
    raise exception 'H19 public-booking D0xD4 harness invalid: expected target morning slots missing';
  end if;

  select count(*) into v_outside
  from public.compute_public_booking_slots(
    'h19-public-d0d4-a',
    'c1300000-0000-4000-8000-000000000001',
    v_day,
    'c1400000-0000-4000-8000-000000000001'
  ) s
  where (s.starts_at at time zone 'Europe/Istanbul')::time < time '09:00'
     or (s.ends_at at time zone 'Europe/Istanbul')::time > time '10:00';

  select count(*) into v_late
  from public.compute_public_booking_slots(
    'h19-public-d0d4-a',
    'c1300000-0000-4000-8000-000000000001',
    v_day,
    'c1400000-0000-4000-8000-000000000001'
  ) s
  where (s.starts_at at time zone 'Europe/Istanbul')::time >= time '15:00';

  if v_outside > 0 or v_late > 0 then
    raise exception
      'H19 public-booking D0xD4 foreign business-hours widened target slots: outside %, late %',
      v_outside, v_late;
  end if;

  raise notice
    'H19 public-booking D0xD4 PASS: foreign tenant hours did not alter target slot boundary';
end
$h19$;

rollback;
