begin;

-- F11-04 G / K03 measurement only. This is a disposable runner receipt, not a
-- production SLA. One SQL invocation represents one Worker -> DB group-slot RPC.
insert into auth.users(id,email,raw_user_meta_data)
values ('d2000000-0000-4000-8000-000000000001','f1104-k03-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;
insert into public.businesses(id,name,slug,timezone,created_by)
values ('d2010000-0000-4000-8000-000000000001','F11-04 K03 Salon','f1104-k03','Europe/Istanbul','d2000000-0000-4000-8000-000000000001');
insert into public.memberships(id,business_id,user_id,role,active)
values ('d2020000-0000-4000-8000-000000000001','d2010000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
)
select format('d2030000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'd2010000-0000-4000-8000-000000000001','K03 Service '||g,5,0,0,'K03',g,1000,'fixed',1000,1000,'TRY',true
from generate_series(1,10) g;

insert into public.staff_profiles(id,business_id,name,active)
select format('d2040000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'd2010000-0000-4000-8000-000000000001','K03 Staff '||g,true
from generate_series(1,5) g;

insert into public.staff_services(business_id,staff_id,service_id,active)
select 'd2010000-0000-4000-8000-000000000001',
  format('d2040000-0000-4000-8000-%s',lpad(staff_no::text,12,'0'))::uuid,
  format('d2030000-0000-4000-8000-%s',lpad(service_no::text,12,'0'))::uuid,true
from generate_series(1,5) staff_no cross join generate_series(1,10) service_no;

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd2010000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd2010000-0000-4000-8000-000000000001',sp.id,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true
from public.staff_profiles sp where sp.business_id='d2010000-0000-4000-8000-000000000001';

-- Representative existing occupancy and closures.
insert into public.availability_blocks(id,business_id,staff_id,starts_at,ends_at,reason,active)
values
  ('d2050000-0000-4000-8000-000000000001','d2010000-0000-4000-8000-000000000001',null,
   ((date_trunc('week',current_date)::date+7)+time '13:00') at time zone 'Europe/Istanbul',
   ((date_trunc('week',current_date)::date+7)+time '13:30') at time zone 'Europe/Istanbul','K03 tenant block',true),
  ('d2050000-0000-4000-8000-000000000002','d2010000-0000-4000-8000-000000000001','d2040000-0000-4000-8000-000000000003',
   ((date_trunc('week',current_date)::date+7)+time '15:00') at time zone 'Europe/Istanbul',
   ((date_trunc('week',current_date)::date+7)+time '16:00') at time zone 'Europe/Istanbul','K03 staff block',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$ declare v_day date:=date_trunc('week',current_date)::date+7; begin
  perform public.create_appointment_group(
    'd2010000-0000-4000-8000-000000000001','f1104-k03-existing','K03 Existing',
    '[{"serviceId":"d2030000-0000-4000-8000-000000000001","staffId":"d2040000-0000-4000-8000-000000000001"},{"serviceId":"d2030000-0000-4000-8000-000000000002","staffId":"d2040000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul','05554000001'
  );
end $$;

create temp table f1104_k03_measurements(sample_no integer primary key,elapsed_ms numeric(20,6) not null,slot_count integer not null) on commit drop;
grant select,insert on table pg_temp.f1104_k03_measurements to authenticated;

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_lines jsonb:='[]'::jsonb;
  v_start timestamptz;
  v_ms numeric(20,6);
  v_slots integer;
begin
  for service_no in 1..10 loop
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('serviceId',format('d2030000-0000-4000-8000-%s',lpad(service_no::text,12,'0'))));
  end loop;

  for i in 1..3 loop
    select count(*) into v_slots from public.compute_group_availability_slots('d2010000-0000-4000-8000-000000000001',v_day,v_lines,15);
    if v_slots<=0 then raise exception 'F11 K03 warmup returned no bounded group slots'; end if;
  end loop;

  for i in 1..30 loop
    v_start:=clock_timestamp();
    select count(*) into v_slots from public.compute_group_availability_slots('d2010000-0000-4000-8000-000000000001',v_day,v_lines,15);
    v_ms:=extract(epoch from (clock_timestamp()-v_start))::numeric*1000;
    if v_slots<=0 or v_ms<=0 then raise exception 'F11 K03 sample % invalid: slots=% ms=%',i,v_slots,v_ms; end if;
    insert into pg_temp.f1104_k03_measurements values(i,v_ms,v_slots);
  end loop;
end $$;

reset role;
do $$
declare v_n integer; v_p50 numeric; v_p95 numeric; v_min_slots integer; v_max_slots integer; v_candidate_upper integer:=33; v_probe_upper integer:=330;
begin
  select count(*),percentile_cont(.50) within group(order by elapsed_ms),percentile_cont(.95) within group(order by elapsed_ms),min(slot_count),max(slot_count)
  into v_n,v_p50,v_p95,v_min_slots,v_max_slots from pg_temp.f1104_k03_measurements;
  if v_n<>30 or v_p50<=0 or v_p95<v_p50 or v_probe_upper>public.f11_group_probe_budget() then
    raise exception 'F11 K03 measurement invalid: n=% p50=% p95=% probe=%',v_n,v_p50,v_p95,v_probe_upper;
  end if;
  raise notice 'F11_K03_METRIC workload=group_slots warmup=3 samples=% services=10 staff=5 candidate_upper=% probe_upper=% slots_min=% slots_max=% db_rpc_calls=% p50_ms=% p95_ms=% errors=0',
    v_n,v_candidate_upper,v_probe_upper,v_min_slots,v_max_slots,v_n,round(v_p50,3),round(v_p95,3);
end $$;

rollback;
