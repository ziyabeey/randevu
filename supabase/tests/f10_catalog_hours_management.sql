begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('b8000000-0000-4000-8000-000000000001', 'f10-04-owner-a@example.invalid', '{}'::jsonb),
  ('b8000000-0000-4000-8000-000000000002', 'f10-04-manager-a@example.invalid', '{}'::jsonb),
  ('b8000000-0000-4000-8000-000000000003', 'f10-04-staff-a@example.invalid', '{}'::jsonb),
  ('b8000000-0000-4000-8000-000000000004', 'f10-04-owner-b@example.invalid', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('b8100000-0000-4000-8000-000000000001', 'F10 04 A', 'f10-04-a', 'Europe/Istanbul', 'b8000000-0000-4000-8000-000000000001'),
  ('b8100000-0000-4000-8000-000000000002', 'F10 04 B', 'f10-04-b', 'Europe/Istanbul', 'b8000000-0000-4000-8000-000000000004');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('b8200000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'owner', true),
  ('b8200000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000002', 'manager', true),
  ('b8200000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000003', 'staff', true),
  ('b8200000-0000-4000-8000-000000000004', 'b8100000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-000000000004', 'owner', true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency,active,updated_at
) values
  ('b8300000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','A Service',30,5,10,12000,'TRY',true,now() - interval '1 second'),
  ('b8300000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000002','B Service',30,0,0,9000,'TRY',true,now() - interval '1 second');

insert into public.staff_profiles(id,business_id,name,phone,active)
values
  ('b8400000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','A Staff','5550000001',true),
  ('b8400000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000002','B Staff','5550000002',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values ('b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values ('b8500000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001',1,'09:00','17:00',true);
insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values ('b8600000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001',1,'09:00','17:00',true);

insert into public.customers(id,business_id,name,phone,created_by)
values ('b8700000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001','Snapshot Customer','5551112233','b8000000-0000-4000-8000-000000000001');

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,price_minor_snapshot,currency_snapshot,
  created_by
) values (
  'b8800000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000001',
  'b8700000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001','confirmed',
  '2026-10-05T10:00:00+03','2026-10-05T10:30:00+03','2026-10-05T09:55:00+03','2026-10-05T10:40:00+03','Europe/Istanbul',
  'Snapshot Customer','5551112233',null,'A Service','A Staff',30,5,10,12000,'TRY',
  'b8000000-0000-4000-8000-000000000001'
);

-- S08 ACL: raw table writes and old availability functions are no longer browser surfaces.
do $$
begin
  if has_table_privilege('authenticated','public.services','INSERT')
     or has_table_privilege('authenticated','public.services','UPDATE')
     or has_table_privilege('authenticated','public.staff_profiles','INSERT')
     or has_table_privilege('authenticated','public.staff_profiles','UPDATE')
     or has_table_privilege('authenticated','public.staff_services','INSERT')
     or has_table_privilege('authenticated','public.staff_services','UPDATE') then
    raise exception 'authenticated retained raw catalog mutation privilege';
  end if;
  if has_function_privilege('authenticated','public.replace_business_hours(uuid,smallint,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.replace_staff_hours(uuid,uuid,smallint,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.create_availability_block_local(uuid,uuid,date,time without time zone,time without time zone,text)','EXECUTE')
     or has_function_privilege('authenticated','public.delete_availability_block(uuid,uuid)','EXECUTE') then
    raise exception 'authenticated retained legacy availability mutation RPC';
  end if;
  if not has_function_privilege('authenticated','public.create_service_guarded(uuid,text,integer,integer,integer,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.update_service_guarded(uuid,uuid,timestamp with time zone,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.replace_business_hours_guarded(uuid,smallint,jsonb,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.create_service_guarded(uuid,text,integer,integer,integer,integer)','EXECUTE') then
    raise exception 'F10-04 guarded RPC ACL mismatch';
  end if;
end
$$;

-- Recovery bearers cannot bypass the Worker by calling the Data API RPC directly.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $$
begin
  begin
    perform public.create_service_guarded('b8100000-0000-4000-8000-000000000001','Recovery Service',30,0,0,1000);
    raise exception 'recovery unexpectedly mutated catalog';
  exception when others then
    if sqlerrm = 'recovery unexpectedly mutated catalog' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

-- Staff cannot mutate; manager can.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  begin
    perform public.create_staff_guarded('b8100000-0000-4000-8000-000000000001','Forbidden Staff',null);
    raise exception 'staff unexpectedly mutated catalog';
  exception when others then
    if sqlerrm = 'staff unexpectedly mutated catalog' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_id uuid;
begin
  select (public.create_service_guarded(
    'b8100000-0000-4000-8000-000000000001','Manager Service',45,5,5,15000
  )).id into v_id;
  if v_id is null then raise exception 'manager could not create service'; end if;
end
$$;
reset role;

-- Cross-tenant IDs are rejected inside the selected business and never re-homed.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  begin
    perform public.update_service_guarded(
      'b8100000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000002',null,
      '{"name":"Forged"}'::jsonb
    );
    raise exception 'cross-tenant service update succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant service update succeeded' then raise; end if;
    if position('SERVICE_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.set_staff_service_guarded(
      'b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001',
      'b8300000-0000-4000-8000-000000000002',true,null
    );
    raise exception 'cross-tenant assignment succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant assignment succeeded' then raise; end if;
    if position('SERVICE_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

-- Optimistic versioning makes concurrent editor writes deterministic.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_old timestamptz;
  v_new public.services;
begin
  select updated_at into v_old from public.services where id='b8300000-0000-4000-8000-000000000001';
  select * into v_new
  from public.update_service_guarded(
    'b8100000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001',v_old,
    '{"durationMinutes":40,"bufferBeforeMinutes":7,"bufferAfterMinutes":12,"priceMinor":13500}'::jsonb
  );
  if v_new.duration_minutes <> 40 or v_new.buffer_before_minutes <> 7
     or v_new.buffer_after_minutes <> 12 or v_new.price_minor <> 13500 then
    raise exception 'service edit did not persist validated fields';
  end if;
  begin
    perform public.update_service_guarded(
      'b8100000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001',v_old,
      '{"priceMinor":14000}'::jsonb
    );
    raise exception 'stale service write unexpectedly won';
  exception when others then
    if sqlerrm = 'stale service write unexpectedly won' then raise; end if;
    if position('STALE_WRITE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Schedule stale-write protection runs through browser authority; the fixture invariant is checked as the test owner.
do $$
begin
  perform * from public.replace_business_hours_guarded(
    'b8100000-0000-4000-8000-000000000001',1::smallint,
    '[{"start":"10:00","end":"18:00"}]'::jsonb,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  begin
    perform * from public.replace_business_hours_guarded(
      'b8100000-0000-4000-8000-000000000001',1::smallint,
      '[{"start":"11:00","end":"19:00"}]'::jsonb,
      '[{"start":"09:00","end":"17:00"}]'::jsonb
    );
    raise exception 'stale business-hours write unexpectedly won';
  exception when others then
    if sqlerrm = 'stale business-hours write unexpectedly won' then raise; end if;
    if position('STALE_WRITE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.appointments a
    where a.id='b8800000-0000-4000-8000-000000000001'
      and a.starts_at='2026-10-05T10:00:00+03'::timestamptz
      and a.status='confirmed'
  ) then
    raise exception 'hours change silently moved or cancelled existing appointment';
  end if;
end
$$;

-- Archiving never rewrites historical snapshots; inactive resources disappear from fresh slot selection.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_service_version timestamptz;
  v_staff_version timestamptz;
  v_slots integer;
begin
  select updated_at into v_service_version from public.services where id='b8300000-0000-4000-8000-000000000001';
  select updated_at into v_staff_version from public.staff_profiles where id='b8400000-0000-4000-8000-000000000001';
  perform public.update_service_guarded(
    'b8100000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001',v_service_version,
    '{"active":false,"name":"Archived Service"}'::jsonb
  );
  perform public.update_staff_guarded(
    'b8100000-0000-4000-8000-000000000001','b8400000-0000-4000-8000-000000000001',v_staff_version,
    '{"active":false,"name":"Archived Staff"}'::jsonb
  );

  select count(*) into v_slots
  from public.compute_availability_slots(
    'b8100000-0000-4000-8000-000000000001','b8300000-0000-4000-8000-000000000001',
    '2026-10-05','b8400000-0000-4000-8000-000000000001',15
  );
  if v_slots <> 0 then raise exception 'archived resource remained selectable for new slot'; end if;
end
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.appointments a
    where a.id='b8800000-0000-4000-8000-000000000001'
      and a.starts_at='2026-10-05T10:00:00+03'::timestamptz
      and a.service_name_snapshot='A Service'
      and a.staff_name_snapshot='A Staff'
      and a.duration_minutes_snapshot=30
      and a.price_minor_snapshot=12000
      and a.status='confirmed'
  ) then
    raise exception 'archive rewrote historical appointment snapshot';
  end if;
end
$$;

-- Catalog snapshots expose additive versions for UI compare-and-swap edits.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v record;
begin
  select * into v from public.get_catalog_snapshot('b8100000-0000-4000-8000-000000000001');
  if jsonb_array_length(v.services) < 1 or not ((v.services->0) ? 'updated_at')
     or jsonb_array_length(v.staff) < 1 or not ((v.staff->0) ? 'updated_at')
     or jsonb_array_length(v.assignments) < 1 or not ((v.assignments->0) ? 'updated_at') then
    raise exception 'catalog snapshot missing optimistic version fields';
  end if;
end
$$;
reset role;

-- Resource caps are write-side, so concurrent creates cannot push an otherwise valid
-- tenant into S07 silent-overflow territory.
insert into public.services(business_id,name,duration_minutes,price_minor,active)
select 'b8100000-0000-4000-8000-000000000001', 'Cap Service ' || g, 30, 1000, true
from generate_series(1,98) g;
insert into public.staff_profiles(business_id,name,active)
select 'b8100000-0000-4000-8000-000000000001', 'Cap Staff ' || g, true
from generate_series(1,99) g;

set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
begin
  begin
    perform public.create_service_guarded('b8100000-0000-4000-8000-000000000001','Overflow Service',30,0,0,1000);
    raise exception 'service write cap not enforced';
  exception when others then
    if sqlerrm = 'service write cap not enforced' then raise; end if;
    if position('CATALOG_SERVICES_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.create_staff_guarded('b8100000-0000-4000-8000-000000000001','Overflow Staff',null);
    raise exception 'staff write cap not enforced';
  exception when others then
    if sqlerrm = 'staff write cap not enforced' then raise; end if;
    if position('CATALOG_STAFF_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

-- Fill assignments to exactly 5000 and prove a fresh pair is rejected.
insert into public.staff_services(business_id,staff_id,service_id,active)
select 'b8100000-0000-4000-8000-000000000001', sp.id, s.id, true
from public.staff_profiles sp
cross join public.services s
where sp.business_id='b8100000-0000-4000-8000-000000000001'
  and s.business_id='b8100000-0000-4000-8000-000000000001'
  and not exists (
    select 1 from public.staff_services ss
    where ss.business_id='b8100000-0000-4000-8000-000000000001'
      and ss.staff_id=sp.id and ss.service_id=s.id
  )
limit 4999;

set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_staff uuid;
  v_service uuid;
begin
  select sp.id,s.id into v_staff,v_service
  from public.staff_profiles sp
  cross join public.services s
  where sp.business_id='b8100000-0000-4000-8000-000000000001'
    and s.business_id='b8100000-0000-4000-8000-000000000001'
    and sp.active and s.active
    and not exists (
      select 1 from public.staff_services ss
      where ss.business_id='b8100000-0000-4000-8000-000000000001'
        and ss.staff_id=sp.id and ss.service_id=s.id
    )
  limit 1;
  if v_staff is null or v_service is null then raise exception 'assignment cap fixture exhausted all pairs'; end if;
  begin
    perform public.set_staff_service_guarded(
      'b8100000-0000-4000-8000-000000000001',v_staff,v_service,true,null
    );
    raise exception 'assignment write cap not enforced';
  exception when others then
    if sqlerrm = 'assignment write cap not enforced' then raise; end if;
    if position('CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;


-- H19 blind discovery #4 frozen D2 x D4 prospective probe.
-- Current service duration may change; an already-created appointment keeps
-- the authoritative timing captured when it was created.
insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  price_minor,currency,active,updated_at
) values (
  'b8310000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000002',
  'H19 D2D4 Service',60,0,0,10000,'TRY',true,now() - interval '1 second'
);

insert into public.customers(id,business_id,name,phone,email,created_by)
values (
  'b8710000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000002',
  'H19 D2D4 Customer','5559090909','h19-d2d4@example.invalid',
  'b8000000-0000-4000-8000-000000000004'
);

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by
) values (
  'b8810000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000002',
  'b8710000-0000-4000-8000-000000000001',
  'b8310000-0000-4000-8000-000000000001',
  'b8400000-0000-4000-8000-000000000002',
  'confirmed',
  '2026-10-06T10:00:00+03','2026-10-06T11:00:00+03',
  '2026-10-06T10:00:00+03','2026-10-06T11:00:00+03',
  'Europe/Istanbul',
  'H19 D2D4 Customer','5559090909','h19-d2d4@example.invalid',
  'H19 D2D4 Service','B Staff',60,0,0,10000,'TRY',
  'b8000000-0000-4000-8000-000000000004'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','b8000000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $h19d2d4write$
declare
  v_old timestamptz;
  v_service public.services;
begin
  select updated_at into v_old
  from public.services
  where id='b8310000-0000-4000-8000-000000000001';

  select * into v_service
  from public.update_service_guarded(
    'b8100000-0000-4000-8000-000000000002',
    'b8310000-0000-4000-8000-000000000001',
    v_old,
    '{"durationMinutes":90}'::jsonb
  );

  if v_service.duration_minutes <> 90 then
    raise exception 'H19 D2xD4 probe setup failed: service duration did not update';
  end if;
end
$h19d2d4write$;
reset role;

do $h19d2d4read$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  select starts_at,ends_at into v_start,v_end
  from public.appointments
  where id='b8810000-0000-4000-8000-000000000001';

  if v_start <> '2026-10-06T10:00:00+03'::timestamptz
     or v_end <> '2026-10-06T11:00:00+03'::timestamptz then
    raise exception 'H19 D2xD4 appointment timing snapshot changed: start %, end %',v_start,v_end;
  end if;
end
$h19d2d4read$;

rollback;