begin;

-- S07 C3 is measurement-only. This fixture is synthetic, lives entirely in the
-- disposable PG17 transaction, and is rolled back at the end. Setup time is not
-- included in p50/p95 samples.
insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  'b7000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  's07-c3-owner@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict (id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'b7100000-0000-4000-8000-000000000001',
  'S07 C3 Load Salon','s07-c3-load','Europe/Istanbul',
  'b7000000-0000-4000-8000-000000000001'
) on conflict (id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'b7200000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001','owner',true
) on conflict (business_id,user_id) do update set role='owner',active=true;

-- Workload A exact C2b boundary: 100 services, 100 staff, 5,000 assignments.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  price_minor,currency,active
)
select
  format('b7300000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'b7100000-0000-4000-8000-000000000001'::uuid,
  'S07 C3 Service '||lpad(g::text,3,'0'),30,0,0,10000,'TRY',true
from generate_series(1,100) g;

insert into public.staff_profiles(id,business_id,name,active)
select
  format('b7400000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'b7100000-0000-4000-8000-000000000001'::uuid,
  'S07 C3 Staff '||lpad(g::text,3,'0'),true
from generate_series(1,100) g;

insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'b7100000-0000-4000-8000-000000000001'::uuid,
  format('b7400000-0000-4000-8000-%s',lpad(staff_no::text,12,'0'))::uuid,
  format('b7300000-0000-4000-8000-%s',lpad(service_no::text,12,'0'))::uuid,
  true
from generate_series(1,50) staff_no
cross join generate_series(1,100) service_no;

-- Workload B: 2,500 appointments, but still only 100 staff. Each staff receives
-- one non-overlapping 30-minute booking in each of 25 slots. Equal starts_at
-- groups exercise the UUID tie-break used by the page index.
insert into public.customers(id,business_id,name,email,created_by)
select
  format('b7500000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'b7100000-0000-4000-8000-000000000001'::uuid,
  'S07 C3 Customer '||g,
  's07-c3-'||g||'@example.test',
  'b7000000-0000-4000-8000-000000000001'::uuid
from generate_series(1,2500) g;

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,
  duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by,source
)
select
  format('b7600000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'b7100000-0000-4000-8000-000000000001'::uuid,
  format('b7500000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'b7300000-0000-4000-8000-000000000001'::uuid,
  format('b7400000-0000-4000-8000-%s',lpad((((g-1)%100)+1)::text,12,'0'))::uuid,
  'scheduled',
  '2027-02-01 00:00:00+00'::timestamptz
    + make_interval(mins => (((g-1)/100)::integer * 30)),
  '2027-02-01 00:30:00+00'::timestamptz
    + make_interval(mins => (((g-1)/100)::integer * 30)),
  '2027-02-01 00:00:00+00'::timestamptz
    + make_interval(mins => (((g-1)/100)::integer * 30)),
  '2027-02-01 00:30:00+00'::timestamptz
    + make_interval(mins => (((g-1)/100)::integer * 30)),
  'Europe/Istanbul',
  'S07 C3 Customer '||g,
  's07-c3-'||g||'@example.test',
  'S07 C3 Service 001',
  'S07 C3 Staff '||lpad((((g-1)%100)+1)::text,3,'0'),
  30,0,0,10000,'TRY',
  'b7000000-0000-4000-8000-000000000001'::uuid,
  'operator'
from generate_series(1,2500) g;

create temp table s07_c3_measurements(
  workload text not null,
  sample_no integer not null,
  elapsed_ms numeric(20,6) not null,
  primary key(workload,sample_no)
) on commit drop;

set local role authenticated;
select set_config('request.jwt.claim.sub','b7000000-0000-4000-8000-000000000001',true);

-- Workload A: 3 warm-ups, then 30 individually timed snapshots. Every call must
-- still return the exact logical boundary and stay inside the existing 5s budget.
do $$
declare
  i integer;
  v_start timestamptz;
  v_elapsed numeric(20,6);
  v_services jsonb;
  v_staff jsonb;
  v_assignments jsonb;
begin
  for i in 1..3 loop
    select s.services,s.staff,s.assignments
      into strict v_services,v_staff,v_assignments
    from public.get_catalog_snapshot('b7100000-0000-4000-8000-000000000001') s;
    if jsonb_array_length(v_services) <> 100
       or jsonb_array_length(v_staff) <> 100
       or jsonb_array_length(v_assignments) <> 5000 then
      raise exception 'S07 C3 catalog warm-up returned incomplete snapshot';
    end if;
  end loop;

  for i in 1..30 loop
    v_start := clock_timestamp();
    select s.services,s.staff,s.assignments
      into strict v_services,v_staff,v_assignments
    from public.get_catalog_snapshot('b7100000-0000-4000-8000-000000000001') s;
    v_elapsed := extract(epoch from (clock_timestamp()-v_start))::numeric * 1000;

    if jsonb_array_length(v_services) <> 100
       or jsonb_array_length(v_staff) <> 100
       or jsonb_array_length(v_assignments) <> 5000 then
      raise exception 'S07 C3 catalog sample % returned incomplete snapshot',i;
    end if;
    if v_elapsed <= 0 or v_elapsed >= 5000 then
      raise exception 'S07 C3 catalog sample % exceeded measurement budget: % ms',i,v_elapsed;
    end if;

    insert into pg_temp.s07_c3_measurements(workload,sample_no,elapsed_ms)
    values ('catalog_snapshot',i,v_elapsed);
  end loop;
end
$$;

-- Workload B mirrors the Worker's max page request: 100 visible rows plus one
-- probe row. Setup/table size is 2,500; each sample is one bounded DB call.
do $$
declare
  i integer;
  v_start timestamptz;
  v_elapsed numeric(20,6);
  v_rows integer;
begin
  for i in 1..3 loop
    select count(*) into v_rows
    from public.list_appointments_page(
      'b7100000-0000-4000-8000-000000000001',101,null,null
    );
    if v_rows <> 101 then
      raise exception 'S07 C3 booking warm-up returned % rows, expected 101',v_rows;
    end if;
  end loop;

  for i in 1..30 loop
    v_start := clock_timestamp();
    select count(*) into v_rows
    from public.list_appointments_page(
      'b7100000-0000-4000-8000-000000000001',101,null,null
    );
    v_elapsed := extract(epoch from (clock_timestamp()-v_start))::numeric * 1000;

    if v_rows <> 101 then
      raise exception 'S07 C3 booking sample % returned % rows, expected 101',i,v_rows;
    end if;
    if v_elapsed <= 0 or v_elapsed >= 5000 then
      raise exception 'S07 C3 booking sample % exceeded measurement budget: % ms',i,v_elapsed;
    end if;

    insert into pg_temp.s07_c3_measurements(workload,sample_no,elapsed_ms)
    values ('booking_page',i,v_elapsed);
  end loop;
end
$$;

-- Stable, grep-friendly receipts. These numbers describe only this disposable
-- CI runner and are not a production SLA/capacity claim.
do $$
declare
  v_samples integer;
  v_total numeric;
  v_p50 numeric;
  v_p95 numeric;
begin
  select
    count(*),
    sum(elapsed_ms),
    percentile_cont(0.50) within group(order by elapsed_ms),
    percentile_cont(0.95) within group(order by elapsed_ms)
  into v_samples,v_total,v_p50,v_p95
  from pg_temp.s07_c3_measurements
  where workload='catalog_snapshot';

  if v_samples <> 30 or v_p50 <= 0 or v_p95 < v_p50 then
    raise exception 'S07 C3 catalog measurement set invalid: samples %, p50 %, p95 %',
      v_samples,v_p50,v_p95;
  end if;

  raise notice 'S07_C3_METRIC workload=catalog_snapshot warmup=3 samples=% rows=5200 db_calls=% total_ms=% p50_ms=% p95_ms=% errors=0',
    v_samples,v_samples,round(v_total,3),round(v_p50,3),round(v_p95,3);

  select
    count(*),
    sum(elapsed_ms),
    percentile_cont(0.50) within group(order by elapsed_ms),
    percentile_cont(0.95) within group(order by elapsed_ms)
  into v_samples,v_total,v_p50,v_p95
  from pg_temp.s07_c3_measurements
  where workload='booking_page';

  if v_samples <> 30 or v_p50 <= 0 or v_p95 < v_p50 then
    raise exception 'S07 C3 booking measurement set invalid: samples %, p50 %, p95 %',
      v_samples,v_p50,v_p95;
  end if;

  raise notice 'S07_C3_METRIC workload=booking_page warmup=3 samples=% fixture_rows=2500 rows=101 db_calls=% total_ms=% p50_ms=% p95_ms=% errors=0',
    v_samples,v_samples,round(v_total,3),round(v_p50,3),round(v_p95,3);
end
$$;

reset role;
rollback;
