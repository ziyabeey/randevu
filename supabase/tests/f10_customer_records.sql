begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('c5000000-0000-4000-8000-000000000001', 'f10-customer-owner@example.invalid', '{"full_name":"Customer Owner"}'::jsonb),
  ('c5000000-0000-4000-8000-000000000002', 'f10-customer-staff@example.invalid', '{"full_name":"Customer Staff"}'::jsonb),
  ('c5000000-0000-4000-8000-000000000003', 'f10-customer-other@example.invalid', '{"full_name":"Other Owner"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('c5100000-0000-4000-8000-000000000001', 'Customer Tenant A', 'customer-tenant-a', 'Europe/Istanbul', 'c5000000-0000-4000-8000-000000000001'),
  ('c5100000-0000-4000-8000-000000000002', 'Customer Tenant B', 'customer-tenant-b', 'Europe/Istanbul', 'c5000000-0000-4000-8000-000000000003');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('c5200000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'owner', true),
  ('c5200000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000002', 'staff', true),
  ('c5200000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000003', 'owner', true);

insert into public.customers(id, business_id, name, phone, email, notes, created_by, created_at, updated_at)
values
  ('c5300000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000002', 'Tenant B Müşteri', '+90 555 800 00 00', 'b@example.invalid', null, 'c5000000-0000-4000-8000-000000000003', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z');

-- S08 / public authority boundary.
do $$
begin
  if has_function_privilege('anon', 'public.list_business_customers_page(uuid,text,integer,timestamptz,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_business_customer_appointments_page(uuid,uuid,integer,timestamptz,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_business_customer(uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_business_customer(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE') then
    raise exception 'anon unexpectedly gained customer management RPC authority';
  end if;
  if not has_function_privilege('authenticated', 'public.list_business_customers_page(uuid,text,integer,timestamptz,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_business_customer_appointments_page(uuid,uuid,integer,timestamptz,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_business_customer(uuid,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_business_customer(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE') then
    raise exception 'authenticated customer RPC grant missing';
  end if;
  if has_function_privilege('anon', 'public.f10_normalize_customer_phone(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.f10_normalize_customer_phone(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.f10_normalize_customer_email(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.f10_normalize_customer_email(text)', 'EXECUTE') then
    raise exception 'internal customer normalizer unexpectedly exposed';
  end if;
  if has_table_privilege('anon', 'public.customers', 'SELECT') then
    raise exception 'anon unexpectedly reads customer table';
  end if;
end
$$;

-- Recovery sessions cannot read or mutate CRM data even with a valid membership.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"recovery"}]}', true);
do $$
begin
  begin
    perform * from public.list_business_customers_page('c5100000-0000-4000-8000-000000000001', null, 26, null, null);
    raise exception 'recovery unexpectedly read customers';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read customers' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform * from public.create_business_customer('c5100000-0000-4000-8000-000000000001', 'Recovery Customer', null, 'recovery@example.invalid', null);
    raise exception 'recovery unexpectedly created customer';
  exception when others then
    if sqlerrm = 'recovery unexpectedly created customer' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

-- Cross-tenant list/history/mutation fail closed from current membership authority.
do $$
begin
  begin
    perform * from public.list_business_customers_page('c5100000-0000-4000-8000-000000000002', null, 26, null, null);
    raise exception 'tenant A unexpectedly listed tenant B customers';
  exception when others then
    if sqlerrm = 'tenant A unexpectedly listed tenant B customers' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform * from public.list_business_customer_appointments_page(
      'c5100000-0000-4000-8000-000000000001',
      'c5300000-0000-4000-8000-000000000001', 26, null, null
    );
    raise exception 'foreign customer id unexpectedly produced history';
  exception when others then
    if sqlerrm = 'foreign customer id unexpectedly produced history' then raise; end if;
    if position('CUSTOMER_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Same name is not identity. Exact normalized phone/e-mail is an explicit conflict.
do $$
declare
  v_first uuid;
  v_second uuid;
begin
  select customer_id into v_first
  from public.create_business_customer(
    'c5100000-0000-4000-8000-000000000001',
    'Ayşe Yılmaz', '+90 (555) 111 22 33', 'AYSE@EXAMPLE.INVALID', 'ilk kayıt'
  );
  select customer_id into v_second
  from public.create_business_customer(
    'c5100000-0000-4000-8000-000000000001',
    'Ayşe Yılmaz', '+90 555 999 88 77', 'ayse-2@example.invalid', null
  );
  if v_first = v_second then raise exception 'same-name customers were silently linked'; end if;

  begin
    perform * from public.create_business_customer(
      'c5100000-0000-4000-8000-000000000001',
      'Başka İsim', '0555 111 22 33', 'other@example.invalid', null
    );
    raise exception 'normalized duplicate phone unexpectedly created';
  exception when others then
    if sqlerrm = 'normalized duplicate phone unexpectedly created' then raise; end if;
    if position('CUSTOMER_CONTACT_EXISTS' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform * from public.create_business_customer(
      'c5100000-0000-4000-8000-000000000001',
      'Başka İsim', '+90 555 333 44 55', ' AySe@Example.Invalid ', null
    );
    raise exception 'normalized duplicate email unexpectedly created';
  exception when others then
    if sqlerrm = 'normalized duplicate email unexpectedly created' then raise; end if;
    if position('CUSTOMER_CONTACT_EXISTS' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

-- Staff is an active business member and may perform day-to-day customer record work.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare v_id uuid;
begin
  select customer_id into v_id
  from public.create_business_customer(
    'c5100000-0000-4000-8000-000000000001', 'Staff Kaydı', '0555 700 00 00', null, null
  );
  if v_id is null then raise exception 'staff customer create did not return id'; end if;
end
$$;
reset role;

-- Prepare an appointment whose historical customer values differ from a later CRM edit.
insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('c5400000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'Tarihsel Hizmet', 30, 12500, true);
insert into public.staff_profiles(id, business_id, name, active)
values ('c5500000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'Tarihsel Personel', true);
insert into public.staff_services(business_id, staff_id, service_id, active)
values ('c5100000-0000-4000-8000-000000000001', 'c5500000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001', true);

insert into public.customers(id, business_id, name, phone, email, notes, created_by, created_at, updated_at)
values (
  'c5300000-0000-4000-8000-000000000010', 'c5100000-0000-4000-8000-000000000001',
  'Eski Müşteri Adı', '0555 444 33 22', 'snapshot@example.invalid', null,
  'c5000000-0000-4000-8000-000000000001', '2026-08-01T09:00:00Z', '2026-08-01T09:00:00Z'
);

insert into public.appointments(
  id, business_id, customer_id, service_id, staff_id, status,
  starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
  customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
  service_name_snapshot, staff_name_snapshot,
  duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
  price_minor_snapshot, currency_snapshot, notes, created_by
) values (
  'c5600000-0000-4000-8000-000000000001',
  'c5100000-0000-4000-8000-000000000001',
  'c5300000-0000-4000-8000-000000000010',
  'c5400000-0000-4000-8000-000000000001',
  'c5500000-0000-4000-8000-000000000001',
  'completed',
  '2026-08-15T07:00:00Z', '2026-08-15T07:30:00Z',
  '2026-08-15T07:00:00Z', '2026-08-15T07:30:00Z', 'Europe/Istanbul',
  'Randevu Anındaki Ad', '0555 000 00 01', 'old-snapshot@example.invalid',
  'Tarihsel Hizmet', 'Tarihsel Personel', 30, 0, 0, 12500, 'TRY', 'tarihsel not',
  'c5000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
declare
  v_version timestamptz;
  v_current_name text;
  v_snapshot_name text;
  v_snapshot_phone text;
begin
  select updated_at into v_version
  from public.customers
  where id = 'c5300000-0000-4000-8000-000000000010';

  perform * from public.update_business_customer(
    'c5100000-0000-4000-8000-000000000001',
    'c5300000-0000-4000-8000-000000000010',
    v_version,
    'Yeni Müşteri Adı', '0555 444 33 22', 'snapshot@example.invalid', 'güncel kart'
  );

  select name into v_current_name from public.customers where id = 'c5300000-0000-4000-8000-000000000010';
  select h.customer_name_snapshot, h.customer_phone_snapshot
    into v_snapshot_name, v_snapshot_phone
  from public.list_business_customer_appointments_page(
    'c5100000-0000-4000-8000-000000000001',
    'c5300000-0000-4000-8000-000000000010', 26, null, null
  ) h;

  if v_current_name <> 'Yeni Müşteri Adı' then raise exception 'master customer edit failed'; end if;
  if v_snapshot_name <> 'Randevu Anındaki Ad' or v_snapshot_phone <> '0555 000 00 01' then
    raise exception 'customer edit rewrote appointment snapshot';
  end if;

  begin
    perform * from public.update_business_customer(
      'c5100000-0000-4000-8000-000000000001',
      'c5300000-0000-4000-8000-000000000010',
      v_version,
      'Stale Edit', '0555 444 33 22', 'snapshot@example.invalid', null
    );
    raise exception 'stale customer version unexpectedly updated';
  exception when others then
    if sqlerrm = 'stale customer version unexpectedly updated' then raise; end if;
    if position('CUSTOMER_VERSION_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- History and customer lists are bounded by the requested max+1 size rather than
-- a silent fixed first-N cap. The Worker owns the opaque continuation cursor.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.list_business_customers_page(
    'c5100000-0000-4000-8000-000000000001', null, 2, null, null
  );
  if v_count <> 2 then raise exception 'customer page did not honor explicit bound: %', v_count; end if;
end
$$;
reset role;

rollback;
