create extension if not exists dblink;

-- F13-01 diagnostic: the S07 appointments keyset cursor is (starts_at,id).
-- A committed writer between page requests can move that mutable ordering key.
-- Prove three separate states on the real current RPC:
--   1. no writer => stable traversal;
--   2. a later row moves before the stale cursor => skip;
--   3. an already-seen row moves after the stale cursor => repeat.
-- This is evidence only. It does not redefine the RPC or bless skip/repeat.

delete from public.businesses where id='f1310000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f1300000-0000-4000-8000-000000000001','f13-pagination-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1310000-0000-4000-8000-000000000001',
  'F13 Pagination Race',
  'f13-pagination-race',
  'Europe/Istanbul',
  'f1300000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1320000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000001',
  'f1300000-0000-4000-8000-000000000001',
  'owner',
  true
)
on conflict(business_id,user_id) do update set role='owner',active=true;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1330000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000001',
  'F13 Race Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('f1340000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','F13 Staff 1',true),
  ('f1340000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000001','F13 Staff 2',true),
  ('f1340000-0000-4000-8000-000000000003','f1310000-0000-4000-8000-000000000001','F13 Staff 3',true),
  ('f1340000-0000-4000-8000-000000000004','f1310000-0000-4000-8000-000000000001','F13 Staff 4',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values (
  'f1350000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000001',
  'F13 Race Customer','05551300001','f13-race@example.invalid',
  'f1300000-0000-4000-8000-000000000001'
);

insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by
) values
  ('f1360000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000003','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000004','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001');

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values
  ('f1370000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','f1360000-0000-4000-8000-000000000001',1,'f1350000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000001','scheduled','2027-03-01 09:00+00','2027-03-01 09:30+00','2027-03-01 09:00+00','2027-03-01 09:30+00','Europe/Istanbul','F13 Race Customer','05551300001','f13-race@example.invalid','F13 Race Service','F13 Staff 1',30,0,0,10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator'),
  ('f1370000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000001','f1360000-0000-4000-8000-000000000002',1,'f1350000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000002','scheduled','2027-03-01 10:00+00','2027-03-01 10:30+00','2027-03-01 10:00+00','2027-03-01 10:30+00','Europe/Istanbul','F13 Race Customer','05551300001','f13-race@example.invalid','F13 Race Service','F13 Staff 2',30,0,0,10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator'),
  ('f1370000-0000-4000-8000-000000000003','f1310000-0000-4000-8000-000000000001','f1360000-0000-4000-8000-000000000003',1,'f1350000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000003','scheduled','2027-03-01 11:00+00','2027-03-01 11:30+00','2027-03-01 11:00+00','2027-03-01 11:30+00','Europe/Istanbul','F13 Race Customer','05551300001','f13-race@example.invalid','F13 Race Service','F13 Staff 3',30,0,0,10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator'),
  ('f1370000-0000-4000-8000-000000000004','f1310000-0000-4000-8000-000000000001','f1360000-0000-4000-8000-000000000004',1,'f1350000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000004','scheduled','2027-03-01 12:00+00','2027-03-01 12:30+00','2027-03-01 12:00+00','2027-03-01 12:30+00','Europe/Istanbul','F13 Race Customer','05551300001','f13-race@example.invalid','F13 Race Service','F13 Staff 4',30,0,0,10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator');

select set_config('request.jwt.claim.sub','f1300000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_business uuid := 'f1310000-0000-4000-8000-000000000001';
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_first uuid[];
  v_second uuid[];
  v_writer text := 'f13_starts_writer';
  v_conn text := 'host=127.0.0.1 port=5432 dbname='||current_database()
    ||' user=postgres password=postgres application_name=f13_starts_writer';
begin
  -- Baseline: without an external writer, the two-page traversal is exact.
  select array_agg(p.id order by p.starts_at,p.id)
    into v_first
  from public.list_appointments_page(v_business,2,null,null) p;
  select p.starts_at,p.id into v_cursor_at,v_cursor_id
  from public.list_appointments_page(v_business,2,null,null) p
  order by p.starts_at desc,p.id desc limit 1;
  select array_agg(p.id order by p.starts_at,p.id)
    into v_second
  from public.list_appointments_page(v_business,10,v_cursor_at,v_cursor_id) p;

  if v_first is distinct from array[
      'f1370000-0000-4000-8000-000000000001'::uuid,
      'f1370000-0000-4000-8000-000000000002'::uuid
    ]
    or v_second is distinct from array[
      'f1370000-0000-4000-8000-000000000003'::uuid,
      'f1370000-0000-4000-8000-000000000004'::uuid
    ] then
    raise exception 'F13 baseline keyset traversal was not stable: first %, second %',v_first,v_second;
  end if;

  -- SKIP: move unseen row 3 behind the stale cursor, and commit from another
  -- physical session between page requests.
  perform dblink_connect(v_writer,v_conn);
  perform dblink_exec(v_writer,'begin');
  perform dblink_exec(v_writer,$q$
    update public.appointments
    set starts_at='2027-03-01 09:30+00',ends_at='2027-03-01 10:00+00',
        occupied_starts_at='2027-03-01 09:30+00',occupied_ends_at='2027-03-01 10:00+00'
    where id='f1370000-0000-4000-8000-000000000003'
  $q$);
  perform dblink_exec(v_writer,'commit');
  perform dblink_disconnect(v_writer);

  select array_agg(p.id order by p.starts_at,p.id)
    into v_second
  from public.list_appointments_page(v_business,10,v_cursor_at,v_cursor_id) p;

  if v_second is distinct from array['f1370000-0000-4000-8000-000000000004'::uuid] then
    raise exception 'F13 stale cursor did not reproduce the expected skip: second %',v_second;
  end if;
  if not exists (
    select 1 from public.appointments
    where id='f1370000-0000-4000-8000-000000000003'
      and starts_at='2027-03-01 09:30+00'::timestamptz
  ) then
    raise exception 'F13 skip writer did not commit the moved row';
  end if;

  -- Reset row 3, then take a fresh first page for the repeat scenario.
  update public.appointments
  set starts_at='2027-03-01 11:00+00',ends_at='2027-03-01 11:30+00',
      occupied_starts_at='2027-03-01 11:00+00',occupied_ends_at='2027-03-01 11:30+00'
  where id='f1370000-0000-4000-8000-000000000003';

  select array_agg(p.id order by p.starts_at,p.id)
    into v_first
  from public.list_appointments_page(v_business,2,null,null) p;
  select p.starts_at,p.id into v_cursor_at,v_cursor_id
  from public.list_appointments_page(v_business,2,null,null) p
  order by p.starts_at desc,p.id desc limit 1;

  -- REPEAT: move already-seen row 1 after the stale cursor. Page 2 sees it again.
  perform dblink_connect(v_writer,v_conn);
  perform dblink_exec(v_writer,'begin');
  perform dblink_exec(v_writer,$q$
    update public.appointments
    set starts_at='2027-03-01 11:30+00',ends_at='2027-03-01 12:00+00',
        occupied_starts_at='2027-03-01 11:30+00',occupied_ends_at='2027-03-01 12:00+00'
    where id='f1370000-0000-4000-8000-000000000001'
  $q$);
  perform dblink_exec(v_writer,'commit');
  perform dblink_disconnect(v_writer);

  select array_agg(p.id order by p.starts_at,p.id)
    into v_second
  from public.list_appointments_page(v_business,10,v_cursor_at,v_cursor_id) p;

  if v_second is distinct from array[
      'f1370000-0000-4000-8000-000000000003'::uuid,
      'f1370000-0000-4000-8000-000000000001'::uuid,
      'f1370000-0000-4000-8000-000000000004'::uuid
    ] then
    raise exception 'F13 stale cursor did not reproduce the expected repeat: second %',v_second;
  end if;
  if not ('f1370000-0000-4000-8000-000000000001'::uuid = any(v_first)
          and 'f1370000-0000-4000-8000-000000000001'::uuid = any(v_second)) then
    raise exception 'F13 repeat proof did not observe the same row on both pages';
  end if;

  raise notice 'F13-01 mutable starts_at evidence: stable without writer; committed between-page writer reproduces deterministic skip and repeat';
exception when others then
  begin perform dblink_disconnect(v_writer); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses where id='f1310000-0000-4000-8000-000000000001';
