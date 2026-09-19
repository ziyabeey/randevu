begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('f2000000-0000-4000-8000-000000000001','f12-v2-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f2100000-0000-4000-8000-000000000001',
  'F12 Catalog V2',
  'f12-catalog-v2',
  'Europe/Istanbul',
  'f2000000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f2200000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  (
    'f2300000-0000-4000-8000-000000000001',
    'f2100000-0000-4000-8000-000000000001',
    'Fixed V2',30,0,0,'Bakım',10,5000,'fixed',5000,5000,'TRY',true
  ),
  (
    'f2300000-0000-4000-8000-000000000002',
    'f2100000-0000-4000-8000-000000000001',
    'Range V2',60,5,10,'Renk',20,12000,'range',12000,18000,'TRY',true
  ),
  (
    'f2300000-0000-4000-8000-000000000003',
    'f2100000-0000-4000-8000-000000000001',
    'Unassigned V2',45,0,0,'Bakım',30,7000,'fixed',7000,7000,'TRY',true
  );

insert into public.staff_profiles(id,business_id,name,active)
values (
  'f2400000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000001',
  'V2 Staff',
  true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  (
    'f2100000-0000-4000-8000-000000000001',
    'f2400000-0000-4000-8000-000000000001',
    'f2300000-0000-4000-8000-000000000001',
    true
  ),
  (
    'f2100000-0000-4000-8000-000000000001',
    'f2400000-0000-4000-8000-000000000001',
    'f2300000-0000-4000-8000-000000000002',
    true
  );

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'f2500000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000001',
  1,'09:00','18:00',true
);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'f2600000-0000-4000-8000-000000000001',
  'f2100000-0000-4000-8000-000000000001',
  'f2400000-0000-4000-8000-000000000001',
  1,'09:00','18:00',true
);

insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('f2100000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update set enabled=true;

insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values (
  'default',
  encode(extensions.digest(convert_to(repeat('G',48),'UTF8'),'sha256'),'hex')
)
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash;

do $$
declare
  v_fixed integer;
  v_range integer;
  v_v2_count integer;
  v_unassigned integer;
  v_range_row record;
begin
  select
    count(*) filter (where service_id='f2300000-0000-4000-8000-000000000001'),
    count(*) filter (where service_id='f2300000-0000-4000-8000-000000000002')
  into v_fixed,v_range
  from public.get_public_booking_services('f12-catalog-v2');

  if v_fixed<>1 or v_range<>0 then
    raise exception 'legacy public catalog no longer fixed-only';
  end if;

  select count(*),
         count(*) filter (where service_id='f2300000-0000-4000-8000-000000000003')
  into v_v2_count,v_unassigned
  from public.get_public_booking_services_v2('f12-catalog-v2');

  if v_v2_count<>2 or v_unassigned<>0 then
    raise exception 'v2 catalog readiness/assignment boundary mismatch';
  end if;

  select * into strict v_range_row
  from public.get_public_booking_services_v2('f12-catalog-v2')
  where service_id='f2300000-0000-4000-8000-000000000002';

  if v_range_row.category<>'Renk'
     or v_range_row.sort_order<>20
     or v_range_row.duration_minutes<>60
     or v_range_row.price_type<>'range'
     or v_range_row.price_min_minor<>12000
     or v_range_row.price_max_minor<>18000
     or v_range_row.currency<>'TRY'
     or v_range_row.price_policy_version<>1 then
    raise exception 'v2 range metadata mismatch';
  end if;
end
$$;

do $$
begin
  if has_function_privilege('anon','public.get_public_booking_services_v2(text)','EXECUTE')
     or has_function_privilege('authenticated','public.get_public_booking_services_v2(text)','EXECUTE') then
    raise exception 'raw v2 catalog leaked browser EXECUTE';
  end if;
  if not has_function_privilege(
    'anon',
    'public.execute_public_operation(text,jsonb,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'public dispatcher lost anon execute';
  end if;
end
$$;

delete from public.public_booking_rate_counters;
set local role anon;

do $$
declare
  v_result jsonb;
  v_range jsonb;
begin
  v_result:=public.execute_public_operation(
    'services_v2',
    '{"p_slug":"f12-catalog-v2"}'::jsonb,
    repeat('G',48),
    repeat('a',64),
    repeat('b',64)
  );

  if v_result->>'ok'<>'true' or jsonb_array_length(v_result->'data')<>2 then
    raise exception 'services_v2 dispatcher result mismatch: %',v_result;
  end if;

  select item into v_range
  from jsonb_array_elements(v_result->'data') item
  where item->>'service_id'='f2300000-0000-4000-8000-000000000002';

  if v_range is null
     or v_range->>'price_type'<>'range'
     or (v_range->>'price_min_minor')::integer<>12000
     or (v_range->>'price_max_minor')::integer<>18000
     or v_range ? 'price_minor' then
    raise exception 'services_v2 exposed invalid range contract: %',v_range;
  end if;
end
$$;

reset role;
rollback;
