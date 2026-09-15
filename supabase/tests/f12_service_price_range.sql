begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('c1300000-0000-4000-8000-000000000001','f12-owner-a@example.invalid','{}'::jsonb),
  ('c1300000-0000-4000-8000-000000000002','f12-manager-a@example.invalid','{}'::jsonb),
  ('c1300000-0000-4000-8000-000000000003','f12-staff-a@example.invalid','{}'::jsonb),
  ('c1300000-0000-4000-8000-000000000004','f12-owner-b@example.invalid','{}'::jsonb)
on conflict (id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('c1310000-0000-4000-8000-000000000001','F12 Price A','f12-price-a','Europe/Istanbul','c1300000-0000-4000-8000-000000000001'),
  ('c1310000-0000-4000-8000-000000000002','F12 Price B','f12-price-b','Europe/Istanbul','c1300000-0000-4000-8000-000000000004');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('c1320000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000001','owner',true),
  ('c1320000-0000-4000-8000-000000000002','c1310000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002','manager',true),
  ('c1320000-0000-4000-8000-000000000003','c1310000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000003','staff',true),
  ('c1320000-0000-4000-8000-000000000004','c1310000-0000-4000-8000-000000000002','c1300000-0000-4000-8000-000000000004','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  price_minor,currency,active,updated_at
) values
  ('c1330000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001','Legacy A',30,0,0,10000,'TRY',true,now()-interval '1 second'),
  ('c1330000-0000-4000-8000-000000000002','c1310000-0000-4000-8000-000000000001','Fixed A',30,0,0,5000,'TRY',true,now()-interval '1 second'),
  ('c1330000-0000-4000-8000-000000000003','c1310000-0000-4000-8000-000000000002','Tenant B',30,0,0,9000,'TRY',true,now()-interval '1 second');

insert into public.staff_profiles(id,business_id,name,active)
values
  ('c1340000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001','A Staff',true),
  ('c1340000-0000-4000-8000-000000000002','c1310000-0000-4000-8000-000000000002','B Staff',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('c1310000-0000-4000-8000-000000000001','c1340000-0000-4000-8000-000000000001','c1330000-0000-4000-8000-000000000001',true),
  ('c1310000-0000-4000-8000-000000000001','c1340000-0000-4000-8000-000000000001','c1330000-0000-4000-8000-000000000002',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values ('c1350000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001',1,'09:00','17:00',true);
insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values ('c1360000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001','c1340000-0000-4000-8000-000000000001',1,'09:00','17:00',true);

insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('c1310000-0000-4000-8000-000000000001',true,15,0,60)
on conflict (business_id) do update set enabled=true, step_minutes=15, min_notice_minutes=0, horizon_days=60;

insert into public.customers(id,business_id,name,phone,created_by)
values ('c1370000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001','History Customer','5551203030','c1300000-0000-4000-8000-000000000001');

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by
) values (
  'c1380000-0000-4000-8000-000000000001','c1310000-0000-4000-8000-000000000001',
  'c1370000-0000-4000-8000-000000000001','c1330000-0000-4000-8000-000000000001','c1340000-0000-4000-8000-000000000001','confirmed',
  '2026-11-02T10:00:00+03','2026-11-02T10:30:00+03','2026-11-02T10:00:00+03','2026-11-02T10:30:00+03','Europe/Istanbul',
  'History Customer','5551203030',null,'Legacy A','A Staff',30,0,0,10000,'TRY','c1300000-0000-4000-8000-000000000001'
);

do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.create_service_priced_guarded(uuid,text,integer,integer,integer,text,integer,text,integer,integer,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.create_service_priced_guarded(uuid,text,integer,integer,integer,text,integer,text,integer,integer,text)',
       'EXECUTE'
     ) then
    raise exception 'F12 priced service RPC ACL mismatch';
  end if;
  if has_function_privilege('authenticated','public.f12_price_estimate_internal(uuid,uuid[])','EXECUTE')
     or has_function_privilege('anon','public.f12_price_estimate_internal(uuid,uuid[])','EXECUTE')
     or has_function_privilege('authenticated','public.f12_require_fixed_price_legacy_appointment()','EXECUTE') then
    raise exception 'F12 internal function leaked browser EXECUTE';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $$
begin
  begin
    perform public.create_service_priced_guarded(
      'c1310000-0000-4000-8000-000000000001','Recovery Range',30,0,0,
      'Bakım',10,'range',10000,15000,'TRY'
    );
    raise exception 'recovery unexpectedly created priced service';
  exception when others then
    if sqlerrm = 'recovery unexpectedly created priced service' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  begin
    perform public.create_service_priced_guarded(
      'c1310000-0000-4000-8000-000000000001','Staff Range',30,0,0,
      'Bakım',10,'range',10000,15000,'TRY'
    );
    raise exception 'staff unexpectedly created priced service';
  exception when others then
    if sqlerrm = 'staff unexpectedly created priced service' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  perform public.create_service_priced_guarded(
    'c1310000-0000-4000-8000-000000000001','Renk Paketi',60,5,10,
    'Renk',20,'range',12000,18000,'TRY'
  );
end
$$;
reset role;

do $$
declare v public.services;
begin
  select * into strict v
  from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Renk Paketi';
  if v.category <> 'Renk' or v.sort_order <> 20 or v.price_type <> 'range'
     or v.price_min_minor <> 12000 or v.price_max_minor <> 18000
     or v.price_minor <> 12000 or v.price_policy_version <> 1 or v.currency <> 'TRY' then
    raise exception 'canonical range service fields did not persist';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  begin
    perform public.create_service_priced_guarded('c1310000-0000-4000-8000-000000000001','Negative',30,0,0,'Genel',30,'range',-1,100,'TRY');
    raise exception 'negative price unexpectedly accepted';
  exception when others then
    if sqlerrm = 'negative price unexpectedly accepted' then raise; end if;
    if position('INVALID_SERVICE' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_service_priced_guarded('c1310000-0000-4000-8000-000000000001','Inverted',30,0,0,'Genel',30,'range',200,100,'TRY');
    raise exception 'inverted range unexpectedly accepted';
  exception when others then
    if sqlerrm = 'inverted range unexpectedly accepted' then raise; end if;
    if position('INVALID_SERVICE' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_service_priced_guarded('c1310000-0000-4000-8000-000000000001','Bad Fixed',30,0,0,'Genel',30,'fixed',100,200,'TRY');
    raise exception 'fixed unequal bounds unexpectedly accepted';
  exception when others then
    if sqlerrm = 'fixed unequal bounds unexpectedly accepted' then raise; end if;
    if position('INVALID_SERVICE' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_service_priced_guarded('c1310000-0000-4000-8000-000000000001','Bad Currency',30,0,0,'Genel',30,'fixed',100,100,'TR');
    raise exception 'bad currency unexpectedly accepted';
  exception when others then
    if sqlerrm = 'bad currency unexpectedly accepted' then raise; end if;
    if position('INVALID_SERVICE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_old timestamptz; v public.services; v_id uuid;
begin
  select id, updated_at into strict v_id, v_old
  from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Renk Paketi';
  select * into v from public.update_service_guarded(
    'c1310000-0000-4000-8000-000000000001', v_id, v_old,
    '{"category":"Renk","sortOrder":20,"priceType":"range","priceMinMinor":13000,"priceMaxMinor":19000,"currency":"TRY"}'::jsonb
  );
  if v.price_min_minor <> 13000 or v.price_max_minor <> 19000
     or v.price_minor <> 13000 or v.price_policy_version <> 2 then
    raise exception 'range update/version contract failed';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_old timestamptz; v public.services; v_snapshot integer;
begin
  select updated_at into strict v_old from public.services where id='c1330000-0000-4000-8000-000000000001';
  select * into v from public.update_service_guarded(
    'c1310000-0000-4000-8000-000000000001','c1330000-0000-4000-8000-000000000001',v_old,
    '{"priceType":"range","priceMinMinor":11000,"priceMaxMinor":16000,"currency":"TRY"}'::jsonb
  );
  select price_minor_snapshot into strict v_snapshot from public.appointments where id='c1380000-0000-4000-8000-000000000001';
  if v.price_type <> 'range' or v.price_policy_version <> 2 or v_snapshot <> 10000 then
    raise exception 'catalog price edit rewrote or invalidated history';
  end if;
end
$$;
reset role;

insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'c1310000-0000-4000-8000-000000000001'::uuid,
  'c1340000-0000-4000-8000-000000000001'::uuid,
  s.id,
  true
from public.services s
where s.business_id='c1310000-0000-4000-8000-000000000001' and s.name='Renk Paketi';

do $$
declare v_range_id uuid; v_range_count integer; v_fixed_count integer;
begin
  select id into strict v_range_id from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Renk Paketi';
  select count(*) filter (where service_id=v_range_id),
         count(*) filter (where service_id='c1330000-0000-4000-8000-000000000002')
    into v_range_count, v_fixed_count
  from public.get_public_booking_services('f12-price-a');
  if v_range_count <> 0 or v_fixed_count <> 1 then
    raise exception 'legacy public service projection exposed range or lost fixed service';
  end if;
end
$$;

do $$
declare v_range_id uuid;
begin
  select id into strict v_range_id from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Renk Paketi';
  begin
    insert into public.appointments(
      business_id,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,staff_name_snapshot,
      duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,currency_snapshot,created_by
    ) values (
      'c1310000-0000-4000-8000-000000000001','c1370000-0000-4000-8000-000000000001',
      v_range_id,'c1340000-0000-4000-8000-000000000001','scheduled',
      '2026-11-09T10:00:00+03','2026-11-09T11:00:00+03','2026-11-09T09:55:00+03','2026-11-09T11:10:00+03','Europe/Istanbul',
      'History Customer','5551203030','Renk Paketi','A Staff',60,5,10,13000,'TRY','c1300000-0000-4000-8000-000000000001'
    );
    raise exception 'range service entered legacy appointment snapshot';
  exception when others then
    if sqlerrm = 'range service entered legacy appointment snapshot' then raise; end if;
    if position('SERVICE_PRICE_NOT_FINAL' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

do $$
declare v record; v_range_id uuid;
begin
  select id into strict v_range_id from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Renk Paketi';
  select * into strict v
  from public.f12_price_estimate_internal(
    'c1310000-0000-4000-8000-000000000001',
    array[v_range_id,'c1330000-0000-4000-8000-000000000002'::uuid]
  );
  if v.currency <> 'TRY' or v.lower_minor <> 18000 or v.upper_minor <> 24000
     or jsonb_array_length(v.lines) <> 2
     or (v.lines->0->>'pricePolicyVersion')::integer <> 2 then
    raise exception 'server price estimate contract failed';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  perform public.create_service_priced_guarded(
    'c1310000-0000-4000-8000-000000000001','Euro Fixed',30,0,0,
    'Genel',40,'fixed',4000,4000,'EUR'
  );
end
$$;
reset role;

do $$
declare v_euro_id uuid;
begin
  select id into strict v_euro_id from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Euro Fixed';
  begin
    perform * from public.f12_price_estimate_internal(
      'c1310000-0000-4000-8000-000000000001',
      array['c1330000-0000-4000-8000-000000000002'::uuid, v_euro_id]
    );
    raise exception 'mixed currency estimate unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'mixed currency estimate unexpectedly succeeded' then raise; end if;
    if position('CURRENCY_MISMATCH' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform * from public.f12_price_estimate_internal(
      'c1310000-0000-4000-8000-000000000001',
      array['c1330000-0000-4000-8000-000000000003'::uuid]
    );
    raise exception 'cross-tenant estimate unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant estimate unexpectedly succeeded' then raise; end if;
    if position('SERVICE_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','c1300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v record; v_range jsonb; v_range_id uuid;
begin
  select id into strict v_range_id from public.services
  where business_id='c1310000-0000-4000-8000-000000000001' and name='Renk Paketi';
  select * into strict v from public.get_catalog_snapshot('c1310000-0000-4000-8000-000000000001');
  select item into v_range
  from jsonb_array_elements(v.services) item
  where item->>'id'=v_range_id::text;
  if v_range is null
     or not (v_range ? 'category')
     or not (v_range ? 'sort_order')
     or not (v_range ? 'price_type')
     or not (v_range ? 'price_min_minor')
     or not (v_range ? 'price_max_minor')
     or not (v_range ? 'price_policy_version') then
    raise exception 'catalog snapshot missing F12 canonical fields';
  end if;
end
$$;
reset role;

rollback;
