begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('ca000000-0000-4000-8000-000000000001', 'authority-owner@example.invalid', '{"full_name":"Authority Owner"}'::jsonb),
  ('ca000000-0000-4000-8000-000000000002', 'authority-inactive@example.invalid', '{"full_name":"Inactive Member"}'::jsonb),
  ('ca000000-0000-4000-8000-000000000003', 'authority-other@example.invalid', '{"full_name":"Other Owner"}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('cb000000-0000-4000-8000-000000000001', 'Authority Tenant A', 'authority-tenant-a', 'Europe/Istanbul', 'ca000000-0000-4000-8000-000000000001'),
  ('cb000000-0000-4000-8000-000000000002', 'Authority Tenant B', 'authority-tenant-b', 'Europe/Istanbul', 'ca000000-0000-4000-8000-000000000003')
on conflict(id) do nothing;

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('cc000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'owner', true),
  ('cc000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002', 'staff', false),
  ('cc000000-0000-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000003', 'owner', true)
on conflict(business_id, user_id) do update set role=excluded.role, active=excluded.active;

insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('cd000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'Authority Service', 30, 15000, true)
on conflict(id) do nothing;

insert into public.staff_profiles(id, business_id, name, active)
values ('ce000000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'Authority Staff', true)
on conflict(id) do nothing;

insert into public.staff_services(business_id, staff_id, service_id, active)
values ('cb000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', true)
on conflict(business_id, staff_id, service_id) do update set active=true;

insert into public.business_hours(business_id, weekday, starts_local, ends_local, active)
select 'cb000000-0000-4000-8000-000000000001', d::smallint, '09:00'::time, '18:00'::time, true
from generate_series(0,6) d
on conflict do nothing;

insert into public.staff_hours(business_id, staff_id, weekday, starts_local, ends_local, active)
select 'cb000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', d::smallint, '09:00'::time, '18:00'::time, true
from generate_series(0,6) d
on conflict do nothing;

update public.public_booking_settings
set enabled=true, step_minutes=5, min_notice_minutes=0, horizon_days=60
where business_id='cb000000-0000-4000-8000-000000000001';

-- Direct customer-bearing table reads are no longer an authenticated Data API surface.
do $$
begin
  if has_table_privilege('authenticated', 'public.customers', 'SELECT') then
    raise exception 'authenticated unexpectedly retains raw customer SELECT';
  end if;
  if has_table_privilege('authenticated', 'public.appointments', 'SELECT') then
    raise exception 'authenticated unexpectedly retains raw appointment SELECT';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.f10_resolve_or_create_customer(uuid,text,text,text,text,uuid,boolean)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'public.f10_resolve_or_create_customer(uuid,text,text,text,text,uuid,boolean)',
    'EXECUTE'
  ) then
    raise exception 'internal customer resolver unexpectedly exposed';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"recovery"}]}', true);

-- A recovery bearer cannot bypass the Worker through direct tables or operator RPC.
do $$
declare
  v_date date := (now() at time zone 'Europe/Istanbul')::date + 7;
  v_starts timestamptz := (v_date + time '11:00') at time zone 'Europe/Istanbul';
begin
  begin
    perform 1 from public.customers limit 1;
    raise exception 'recovery unexpectedly read raw customers';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read raw customers' then raise; end if;
  end;

  begin
    perform 1 from public.appointments limit 1;
    raise exception 'recovery unexpectedly read raw appointments';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read raw appointments' then raise; end if;
  end;

  begin
    perform public.create_appointment(
      'cb000000-0000-4000-8000-000000000001',
      'authority-recovery-create-0001',
      'Recovery Operator',
      'cd000000-0000-4000-8000-000000000001',
      'ce000000-0000-4000-8000-000000000001',
      v_starts,
      '0555 910 00 00',
      'recovery-operator@example.invalid',
      null
    );
    raise exception 'recovery unexpectedly called create_appointment';
  exception when others then
    if sqlerrm = 'recovery unexpectedly called create_appointment' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Inactive membership is still rejected under a normal password session.
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
begin
  begin
    perform * from public.list_business_customers_page(
      'cb000000-0000-4000-8000-000000000001', null, 26, null, null
    );
    raise exception 'inactive member unexpectedly read customer RPC';
  exception when others then
    if sqlerrm = 'inactive member unexpectedly read customer RPC' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- CRM creates the canonical master under a normal owner session.
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
do $$
declare
  v_customer_id uuid;
begin
  select customer_id into v_customer_id
  from public.create_business_customer(
    'cb000000-0000-4000-8000-000000000001',
    'Canonical Master',
    '0555 912 34 56',
    'CANONICAL@EXAMPLE.INVALID',
    'CRM note'
  );
  perform set_config('f10.repair_customer_id', v_customer_id::text, true);
end
$$;
reset role;

-- Same canonical contact is independent in another tenant.
insert into public.customers(business_id, name, phone, email, created_by)
values(
  'cb000000-0000-4000-8000-000000000002',
  'Other Tenant Canonical',
  '+90 555 912 34 56',
  'canonical@example.invalid',
  'ca000000-0000-4000-8000-000000000003'
);

-- Public booking reuses the CRM master with +90 form, but never edits it.
do $$
declare
  v_date date := (now() at time zone 'Europe/Istanbul')::date + 7;
  v_starts timestamptz := (v_date + time '10:00') at time zone 'Europe/Istanbul';
  v_appointment_id uuid;
  v_customer_id uuid;
  v_master_name text;
  v_snapshot_name text;
  v_snapshot_phone text;
begin
  select appointment_id into v_appointment_id
  from public.create_public_appointment(
    'authority-tenant-a',
    'authority-public-create-0001',
    'Public Submitted Name',
    'cd000000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    v_starts,
    '+90 555 912 34 56',
    'canonical@example.invalid',
    null
  );

  select a.customer_id, a.customer_name_snapshot, a.customer_phone_snapshot
    into v_customer_id, v_snapshot_name, v_snapshot_phone
  from public.appointments a
  where a.id = v_appointment_id;
  select c.name into v_master_name from public.customers c where c.id = v_customer_id;

  if v_customer_id <> current_setting('f10.repair_customer_id')::uuid then
    raise exception 'public booking did not reuse CRM canonical customer';
  end if;
  if v_master_name <> 'Canonical Master' then
    raise exception 'public booking rewrote CRM master name: %', v_master_name;
  end if;
  if v_snapshot_name <> 'Public Submitted Name' or v_snapshot_phone <> '+90 555 912 34 56' then
    raise exception 'public booking did not preserve submitted snapshot';
  end if;
end
$$;

-- Operator booking uses the same canonical resolver and also never silently edits master.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare
  v_date date := (now() at time zone 'Europe/Istanbul')::date + 7;
  v_starts timestamptz := (v_date + time '11:00') at time zone 'Europe/Istanbul';
  v_row public.appointments;
  v_master record;
begin
  v_row := public.create_appointment(
    'cb000000-0000-4000-8000-000000000001',
    'authority-operator-create-0001',
    'Operator Submitted Name',
    'cd000000-0000-4000-8000-000000000001',
    'ce000000-0000-4000-8000-000000000001',
    v_starts,
    '0090 555 912 34 56',
    'CANONICAL@example.invalid',
    null
  );

  if v_row.customer_id <> current_setting('f10.repair_customer_id')::uuid then
    raise exception 'operator booking did not reuse CRM canonical customer';
  end if;
  if v_row.customer_name_snapshot <> 'Operator Submitted Name'
     or v_row.customer_phone_snapshot <> '0090 555 912 34 56' then
    raise exception 'operator booking did not preserve submitted snapshot';
  end if;

  select * into v_master
  from public.list_business_customers_page(
    'cb000000-0000-4000-8000-000000000001', 'Canonical Master', 26, null, null
  )
  where customer_id = current_setting('f10.repair_customer_id')::uuid;
  if v_master.name <> 'Canonical Master' or v_master.notes <> 'CRM note' then
    raise exception 'operator booking silently rewrote customer master';
  end if;
end
$$;
reset role;

-- One canonical row remains in tenant A while tenant B remains independent.
do $$
declare
  v_a integer;
  v_b integer;
begin
  select count(*) into v_a
  from public.customers c
  where c.business_id='cb000000-0000-4000-8000-000000000001'
    and public.f10_normalize_customer_phone(c.phone)='5559123456';
  select count(*) into v_b
  from public.customers c
  where c.business_id='cb000000-0000-4000-8000-000000000002'
    and public.f10_normalize_customer_phone(c.phone)='5559123456';
  if v_a <> 1 then raise exception 'tenant A canonical count is %', v_a; end if;
  if v_b <> 1 then raise exception 'tenant B canonical count is %', v_b; end if;
end
$$;

rollback;
