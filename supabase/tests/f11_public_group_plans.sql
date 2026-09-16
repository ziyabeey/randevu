begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('e9100000-0000-4000-8000-000000000001','f11-public-plan-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'e9110000-0000-4000-8000-000000000001','F11 Public Plan','f11-public-plan','Europe/Istanbul',
  'e9100000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,
  currency,active,processing_minutes,processing_staff_mode
) values
  ('e9130000-0000-4000-8000-000000000001','e9110000-0000-4000-8000-000000000001','Public Fixed',30,5,5,'Genel',10,10000,'fixed',10000,10000,'TRY',true,0,'hold'),
  ('e9130000-0000-4000-8000-000000000002','e9110000-0000-4000-8000-000000000001','Public Range',30,0,0,'Bakım',20,15000,'range',15000,25000,'TRY',true,0,'hold')
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values
  ('e9140000-0000-4000-8000-000000000001','e9110000-0000-4000-8000-000000000001','Public Staff A',true),
  ('e9140000-0000-4000-8000-000000000002','e9110000-0000-4000-8000-000000000001','Public Staff B',true)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('e9110000-0000-4000-8000-000000000001','e9140000-0000-4000-8000-000000000001','e9130000-0000-4000-8000-000000000001',true),
  ('e9110000-0000-4000-8000-000000000001','e9140000-0000-4000-8000-000000000001','e9130000-0000-4000-8000-000000000002',true),
  ('e9110000-0000-4000-8000-000000000001','e9140000-0000-4000-8000-000000000002','e9130000-0000-4000-8000-000000000002',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'e9110000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'e9110000-0000-4000-8000-000000000001'::uuid,
  x.staff_id,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true
from (values
  ('e9140000-0000-4000-8000-000000000001'::uuid),
  ('e9140000-0000-4000-8000-000000000002'::uuid)
) x(staff_id);

update public.public_booking_settings
set enabled=true, step_minutes=15, min_notice_minutes=0, horizon_days=30
where business_id='e9110000-0000-4000-8000-000000000001';

-- The public dispatcher is the only browser-visible authority. The planner and
-- every private F11 planner helper remain closed to anon/authenticated.
do $$
begin
  if has_function_privilege(
      'anon','public.compute_public_booking_group_plans(text,jsonb,date,integer)','EXECUTE'
    ) or has_function_privilege(
      'authenticated','public.compute_public_booking_group_plans(text,jsonb,date,integer)','EXECUTE'
    ) then
    raise exception 'public group planner leaked direct EXECUTE';
  end if;
  if not has_function_privilege(
      'anon','public.execute_public_operation(text,jsonb,text,text,text)','EXECUTE'
    ) then
    raise exception 'public operation dispatcher missing anon EXECUTE';
  end if;
end
$$;

-- Install a transaction-local test gate hash in the existing server-side gate
-- authority. The plaintext remains only in this rolled-back test transaction.
update public.public_booking_abuse_config
set gate_secret_hash=encode(digest(repeat('P',48),'sha256'),'hex')
where config_key='default';

do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_result jsonb;
  v_plan jsonb;
  v_lines jsonb := jsonb_build_array(
    jsonb_build_object(
      'serviceId','e9130000-0000-4000-8000-000000000001',
      'staffId','e9140000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'serviceId','e9130000-0000-4000-8000-000000000002',
      'staffId',null
    )
  );
begin
  v_result := public.execute_public_operation(
    'group_plans',
    jsonb_build_object(
      'p_slug','F11-PUBLIC-PLAN',
      'p_lines',v_lines,
      'p_date',v_day,
      'p_limit',5
    ),
    repeat('P',48),repeat('a',64),repeat('b',64)
  );

  if coalesce((v_result->>'ok')::boolean,false) is not true then
    raise exception 'gated public group plan failed: %', v_result;
  end if;
  if jsonb_typeof(v_result->'data'->'plans') <> 'array'
     or jsonb_array_length(v_result->'data'->'plans') < 1
     or jsonb_array_length(v_result->'data'->'plans') > 5 then
    raise exception 'public group plan result cardinality invalid: %', v_result;
  end if;

  v_plan := v_result->'data'->'plans'->0;
  if jsonb_array_length(v_plan->'lines') <> 2
     or (v_plan->>'lowerMinor')::bigint <> 25000
     or (v_plan->>'upperMinor')::bigint <> 35000
     or v_plan->>'currency' <> 'TRY'
     or v_plan->>'timezone' <> 'Europe/Istanbul'
     or v_plan->>'fingerprint' !~ '^[0-9a-f]{64}$' then
    raise exception 'public group plan did not preserve ordered price/timing contract: %', v_plan;
  end if;
end
$$;

-- Publication readiness remains authoritative. Disabling the public booking
-- surface makes the same operation indistinguishable from a missing public link.
update public.public_booking_settings
set enabled=false
where business_id='e9110000-0000-4000-8000-000000000001';

do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_result jsonb;
begin
  v_result := public.execute_public_operation(
    'group_plans',
    jsonb_build_object(
      'p_slug','f11-public-plan',
      'p_lines',jsonb_build_array(
        jsonb_build_object('serviceId','e9130000-0000-4000-8000-000000000001','staffId',null)
      ),
      'p_date',v_day,
      'p_limit',5
    ),
    repeat('P',48),repeat('c',64),repeat('d',64)
  );
  if coalesce((v_result->>'ok')::boolean,true) is not false
     or v_result#>>'{error,message}' <> 'PUBLIC_BOOKING_NOT_FOUND' then
    raise exception 'disabled public group planner did not fail closed: %', v_result;
  end if;
end
$$;

raise notice 'F11-02 gated public group planning accepted';
rollback;
