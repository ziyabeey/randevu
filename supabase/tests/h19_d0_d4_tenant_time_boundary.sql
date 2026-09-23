begin;

-- H19 prospective coverage test: D0 x D4 (tenant isolation x time/boundary).
--
-- The frozen S1 suite allowed M4 to survive after the business_id predicate was
-- removed from f11_plan_group_at's full-customer business-hours check.
-- This probe was designed only after that mutant-only run completed.
--
-- Tenant A has a RELEASE service whose staff occupancy ends exactly at A's
-- 18:00 close while the customer-facing service continues until 18:30.
-- With only A's hours present the planner must reject it. Adding Tenant B's
-- unrelated 09:00-20:00 hours must not change A's result.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('a2900000-0000-4000-8000-000000000001','h19-d0d4-a@example.invalid','{}'::jsonb),
  ('a2900000-0000-4000-8000-000000000002','h19-d0d4-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('a2910000-0000-4000-8000-000000000001','H19 D0D4 Tenant A','h19-d0d4-a','Europe/Istanbul','a2900000-0000-4000-8000-000000000001'),
  ('a2910000-0000-4000-8000-000000000002','H19 D0D4 Tenant B','h19-d0d4-b','Europe/Istanbul','a2900000-0000-4000-8000-000000000002');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active,
  processing_capacity_policy,passive_wait_minutes
) values (
  'a2930000-0000-4000-8000-000000000001',
  'a2910000-0000-4000-8000-000000000001',
  'H19 Release Boundary',60,0,0,'H19',10,10000,'fixed',10000,10000,'TRY',true,
  'RELEASE',30
);

insert into public.staff_profiles(id,business_id,name,active)
values (
  'a2940000-0000-4000-8000-000000000001',
  'a2910000-0000-4000-8000-000000000001',
  'H19 Boundary Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'a2910000-0000-4000-8000-000000000001',
  'a2940000-0000-4000-8000-000000000001',
  'a2930000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  v_day date := date_trunc('week',current_date)::date + 7;
  v_weekday smallint := extract(dow from (date_trunc('week',current_date)::date + 7))::smallint;
  v_start timestamptz := ((date_trunc('week',current_date)::date + 7) + time '17:30') at time zone 'Europe/Istanbul';
  v_lines jsonb := '[{"serviceId":"a2930000-0000-4000-8000-000000000001"}]'::jsonb;
  v_plan jsonb;
begin
  insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
  values (
    'a2910000-0000-4000-8000-000000000001',
    v_weekday,time '09:00',time '18:00',true
  );

  insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
  values (
    'a2910000-0000-4000-8000-000000000001',
    'a2940000-0000-4000-8000-000000000001',
    v_weekday,time '09:00',time '18:00',true
  );

  -- Control inside the same fixture: without foreign hours, even the mutant
  -- must reject the 18:30 customer end.
  v_plan := public.f11_plan_group_at(
    'a2910000-0000-4000-8000-000000000001',
    v_lines,v_start,null
  );
  if v_plan is not null then
    raise exception 'H19 D0xD4 fixture was placeable before foreign hours';
  end if;

  -- Introduce only another tenant's wider business window.
  insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
  values (
    'a2910000-0000-4000-8000-000000000002',
    v_weekday,time '09:00',time '20:00',true
  );

  v_plan := public.f11_plan_group_at(
    'a2910000-0000-4000-8000-000000000001',
    v_lines,v_start,null
  );

  if v_plan is not null then
    raise exception 'H19 D0xD4 cross-tenant business-hours bleed';
  end if;

  raise notice 'H19 D0xD4 prospective invariant accepted: foreign hours cannot extend tenant boundary';
end
$$;

rollback;
