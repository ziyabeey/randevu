begin;

-- Phase-11 field receipt #5693460041 requires independent line lifecycle inside
-- one reservation group. This fixture proves the irreversible schema can express
-- partial cancellation without weakening tenant/customer/source binding or the
-- legacy one-line status/version contract.
delete from public.businesses
where id in (
  'd1410000-0000-4000-8000-000000000001',
  'd1410000-0000-4000-8000-000000000002'
);

insert into auth.users(id,email,raw_user_meta_data)
values ('d1400000-0000-4000-8000-000000000001','f11-field-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('d1410000-0000-4000-8000-000000000001','F11 Field A','f11-field-a','Europe/Istanbul','d1400000-0000-4000-8000-000000000001'),
  ('d1410000-0000-4000-8000-000000000002','F11 Field B','f11-field-b','Europe/Istanbul','d1400000-0000-4000-8000-000000000001');

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('d1450000-0000-4000-8000-000000000001','d1410000-0000-4000-8000-000000000001','Field Customer','05554100001','field-a@example.invalid','d1400000-0000-4000-8000-000000000001'),
  ('d1450000-0000-4000-8000-000000000002','d1410000-0000-4000-8000-000000000001','Other Customer','05554100002','field-other@example.invalid','d1400000-0000-4000-8000-000000000001'),
  ('d1450000-0000-4000-8000-000000000003','d1410000-0000-4000-8000-000000000002','Tenant B Customer','05554100003','field-b@example.invalid','d1400000-0000-4000-8000-000000000001');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('d1430000-0000-4000-8000-000000000001','d1410000-0000-4000-8000-000000000001','Field Service A',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true),
  ('d1430000-0000-4000-8000-000000000002','d1410000-0000-4000-8000-000000000001','Field Service B',30,0,0,'Genel',20,10000,'fixed',10000,10000,'TRY',true),
  ('d1430000-0000-4000-8000-000000000003','d1410000-0000-4000-8000-000000000002','Tenant B Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('d1440000-0000-4000-8000-000000000001','d1410000-0000-4000-8000-000000000001','Field Staff A',true),
  ('d1440000-0000-4000-8000-000000000002','d1410000-0000-4000-8000-000000000001','Field Staff B',true),
  ('d1440000-0000-4000-8000-000000000003','d1410000-0000-4000-8000-000000000002','Tenant B Staff',true);

insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by
) values (
  'd1460000-0000-4000-8000-000000000001',
  'd1410000-0000-4000-8000-000000000001',
  'd1450000-0000-4000-8000-000000000001',
  'scheduled','operator',1,'d1400000-0000-4000-8000-000000000001'
);

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values
  (
    'd1470000-0000-4000-8000-000000000001','d1410000-0000-4000-8000-000000000001',
    'd1460000-0000-4000-8000-000000000001',1,
    'd1450000-0000-4000-8000-000000000001','d1430000-0000-4000-8000-000000000001','d1440000-0000-4000-8000-000000000001','scheduled',
    '2026-12-02T10:00:00+03','2026-12-02T10:30:00+03','2026-12-02T10:00:00+03','2026-12-02T10:30:00+03','Europe/Istanbul',
    'Field Customer','05554100001','field-a@example.invalid','Field Service A','Field Staff A',30,0,0,
    10000,'fixed',10000,10000,1,'TRY','d1400000-0000-4000-8000-000000000001','operator'
  ),
  (
    'd1470000-0000-4000-8000-000000000002','d1410000-0000-4000-8000-000000000001',
    'd1460000-0000-4000-8000-000000000001',2,
    'd1450000-0000-4000-8000-000000000001','d1430000-0000-4000-8000-000000000002','d1440000-0000-4000-8000-000000000002','scheduled',
    '2026-12-02T10:30:00+03','2026-12-02T11:00:00+03','2026-12-02T10:30:00+03','2026-12-02T11:00:00+03','Europe/Istanbul',
    'Field Customer','05554100001','field-a@example.invalid','Field Service B','Field Staff B',30,0,0,
    10000,'fixed',10000,10000,1,'TRY','d1400000-0000-4000-8000-000000000001','operator'
  );

do $$
begin
  if not exists (
    select 1 from public.appointment_groups g
    where g.id='d1460000-0000-4000-8000-000000000001'
      and g.status='scheduled' and g.version=1
  ) then
    raise exception 'uniform two-line group did not retain exact aggregate status';
  end if;
end
$$;

-- Real field flow: cancel one service while the sibling remains active.
update public.appointments
set status='cancelled',
    cancelled_at=now(),
    cancelled_by='d1400000-0000-4000-8000-000000000001',
    cancellation_reason='partial service cancellation'
where id='d1470000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1 from public.appointment_groups g
    where g.id='d1460000-0000-4000-8000-000000000001'
      and g.status='partial' and g.version=2
  ) then
    raise exception 'mixed line lifecycle did not produce partial group status';
  end if;

  if not exists (
    select 1 from public.appointments a
    where a.id='d1470000-0000-4000-8000-000000000001'
      and a.status='cancelled'
      and a.starts_at='2026-12-02T10:00:00+03'::timestamptz
  ) or not exists (
    select 1 from public.appointments a
    where a.id='d1470000-0000-4000-8000-000000000002'
      and a.status='scheduled'
      and a.starts_at='2026-12-02T10:30:00+03'::timestamptz
  ) then
    raise exception 'partial cancel mutated sibling lifecycle/time';
  end if;
end
$$;

-- A line-local reschedule changes only that physical line. The cancelled sibling
-- remains frozen and the aggregate lifecycle stays partial.
update public.appointments
set starts_at='2026-12-02T11:00:00+03',
    ends_at='2026-12-02T11:30:00+03',
    occupied_starts_at='2026-12-02T11:00:00+03',
    occupied_ends_at='2026-12-02T11:30:00+03'
where id='d1470000-0000-4000-8000-000000000002';

do $$
begin
  if not exists (
    select 1 from public.appointments a
    where a.id='d1470000-0000-4000-8000-000000000001'
      and a.status='cancelled'
      and a.starts_at='2026-12-02T10:00:00+03'::timestamptz
  ) or not exists (
    select 1 from public.appointments a
    where a.id='d1470000-0000-4000-8000-000000000002'
      and a.status='scheduled'
      and a.starts_at='2026-12-02T11:00:00+03'::timestamptz
  ) then
    raise exception 'line-local reschedule leaked into sibling';
  end if;

  if (select status from public.appointment_groups where id='d1460000-0000-4000-8000-000000000001') <> 'partial' then
    raise exception 'line-local reschedule corrupted aggregate status';
  end if;
end
$$;

-- Another lifecycle change may keep the aggregate at partial, but still advances
-- the optimistic group version because the group state materially changed.
update public.appointments
set status='confirmed'
where id='d1470000-0000-4000-8000-000000000002';

do $$
begin
  if not exists (
    select 1 from public.appointment_groups g
    where g.id='d1460000-0000-4000-8000-000000000001'
      and g.status='partial' and g.version=3
  ) then
    raise exception 'partial aggregate failed to advance group version';
  end if;
end
$$;

-- Customer/source/tenant identity remains fail-closed even though lifecycle status
-- is no longer part of the FK key.
do $$
begin
  begin
    insert into public.appointments(
      id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
      price_policy_version_snapshot,currency_snapshot,created_by,source
    ) values (
      'd1470000-0000-4000-8000-000000000003','d1410000-0000-4000-8000-000000000001',
      'd1460000-0000-4000-8000-000000000001',3,
      'd1450000-0000-4000-8000-000000000002','d1430000-0000-4000-8000-000000000001','d1440000-0000-4000-8000-000000000001','scheduled',
      '2026-12-02T12:00:00+03','2026-12-02T12:30:00+03','2026-12-02T12:00:00+03','2026-12-02T12:30:00+03','Europe/Istanbul',
      'Other Customer','Field Service A','Field Staff A',30,0,0,
      10000,'fixed',10000,10000,1,'TRY','d1400000-0000-4000-8000-000000000001','operator'
    );
    raise exception 'cross-customer line unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-customer line unexpectedly accepted' then raise; end if;
    if position('BOOKING_GROUP_CONTRACT_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;

  begin
    insert into public.appointments(
      id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
      price_policy_version_snapshot,currency_snapshot,created_by,source
    ) values (
      'd1470000-0000-4000-8000-000000000004','d1410000-0000-4000-8000-000000000001',
      'd1460000-0000-4000-8000-000000000001',3,
      'd1450000-0000-4000-8000-000000000001','d1430000-0000-4000-8000-000000000001','d1440000-0000-4000-8000-000000000001','scheduled',
      '2026-12-02T12:00:00+03','2026-12-02T12:30:00+03','2026-12-02T12:00:00+03','2026-12-02T12:30:00+03','Europe/Istanbul',
      'Field Customer','Field Service A','Field Staff A',30,0,0,
      10000,'fixed',10000,10000,1,'TRY','d1400000-0000-4000-8000-000000000001','public'
    );
    raise exception 'cross-source line unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-source line unexpectedly accepted' then raise; end if;
    if position('BOOKING_GROUP_CONTRACT_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by
) values (
  'd1460000-0000-4000-8000-000000000002',
  'd1410000-0000-4000-8000-000000000002',
  'd1450000-0000-4000-8000-000000000003',
  'scheduled','operator',1,'d1400000-0000-4000-8000-000000000001'
);

do $$
begin
  begin
    insert into public.appointments(
      id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
      price_policy_version_snapshot,currency_snapshot,created_by,source
    ) values (
      'd1470000-0000-4000-8000-000000000005','d1410000-0000-4000-8000-000000000001',
      'd1460000-0000-4000-8000-000000000002',3,
      'd1450000-0000-4000-8000-000000000001','d1430000-0000-4000-8000-000000000001','d1440000-0000-4000-8000-000000000001','scheduled',
      '2026-12-02T13:00:00+03','2026-12-02T13:30:00+03','2026-12-02T13:00:00+03','2026-12-02T13:30:00+03','Europe/Istanbul',
      'Field Customer','Field Service A','Field Staff A',30,0,0,
      10000,'fixed',10000,10000,1,'TRY','d1400000-0000-4000-8000-000000000001','operator'
    );
    raise exception 'cross-tenant group unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-tenant group unexpectedly accepted' then raise; end if;
    if position('BOOKING_GROUP_CONTRACT_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Legacy single-line direct insert still creates a deterministic anchored group;
-- its existing status sync trigger remains the exact version authority.
insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by,source
) values (
  'd1470000-0000-4000-8000-000000000010','d1410000-0000-4000-8000-000000000001',
  'd1450000-0000-4000-8000-000000000001','d1430000-0000-4000-8000-000000000001','d1440000-0000-4000-8000-000000000001','scheduled',
  '2026-12-02T16:00:00+03','2026-12-02T16:30:00+03','2026-12-02T16:00:00+03','2026-12-02T16:30:00+03','Europe/Istanbul',
  'Field Customer','05554100001','field-a@example.invalid','Field Service A','Field Staff A',30,0,0,
  10000,'TRY','d1400000-0000-4000-8000-000000000001','operator'
);

do $$
begin
  if not exists (
    select 1 from public.appointment_groups g
    where g.id='d1470000-0000-4000-8000-000000000010'
      and g.legacy_appointment_id='d1470000-0000-4000-8000-000000000010'
      and g.status='scheduled' and g.version=1
  ) then
    raise exception 'legacy one-line group anchor changed';
  end if;
end
$$;

update public.appointments
set status='confirmed'
where id='d1470000-0000-4000-8000-000000000010';

do $$
begin
  if not exists (
    select 1 from public.appointment_groups g
    where g.id='d1470000-0000-4000-8000-000000000010'
      and g.status='confirmed' and g.version=2
  ) then
    raise exception 'legacy one-line status/version sync regressed';
  end if;

  raise notice 'F11-01 partial line lifecycle field repair accepted';
end
$$;

rollback;
