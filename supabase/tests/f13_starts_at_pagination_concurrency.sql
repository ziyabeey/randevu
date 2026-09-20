create extension if not exists dblink;

-- F13-01-DB-RACE-1 acceptance: bind mutable (starts_at,id) traversal to one
-- business-scoped revision. A committed writer between page requests must fail
-- stale instead of silently skipping or repeating rows.

delete from public.businesses
where id in (
  'f1310000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000002'
);
delete from private.appointment_page_revisions
where business_id in (
  'f1310000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000002'
);

insert into auth.users(id,email,raw_user_meta_data)
values ('f1300000-0000-4000-8000-000000000001','f13-pagination-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1310000-0000-4000-8000-000000000001','F13 Pagination Race','f13-pagination-race','Europe/Istanbul','f1300000-0000-4000-8000-000000000001'),
  ('f1310000-0000-4000-8000-000000000002','F13 Other Tenant','f13-pagination-other','Europe/Istanbul','f1300000-0000-4000-8000-000000000001');

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
) values
  ('f1330000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','F13 Race Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true),
  ('f1330000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000002','F13 Other Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('f1340000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','F13 Staff 1',true),
  ('f1340000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000001','F13 Staff 2',true),
  ('f1340000-0000-4000-8000-000000000003','f1310000-0000-4000-8000-000000000001','F13 Staff 3',true),
  ('f1340000-0000-4000-8000-000000000004','f1310000-0000-4000-8000-000000000001','F13 Staff 4',true),
  ('f1340000-0000-4000-8000-000000000005','f1310000-0000-4000-8000-000000000002','F13 Other Staff',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001',true),
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000002','f1330000-0000-4000-8000-000000000001',true),
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000003','f1330000-0000-4000-8000-000000000001',true),
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000004','f1330000-0000-4000-8000-000000000001',true),
  ('f1310000-0000-4000-8000-000000000002','f1340000-0000-4000-8000-000000000005','f1330000-0000-4000-8000-000000000002',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values
  ('f1310000-0000-4000-8000-000000000001',1,time '00:00',time '23:59',true),
  ('f1310000-0000-4000-8000-000000000002',1,time '00:00',time '23:59',true);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000001',1,time '00:00',time '23:59',true),
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000002',1,time '00:00',time '23:59',true),
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000003',1,time '00:00',time '23:59',true),
  ('f1310000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000004',1,time '00:00',time '23:59',true),
  ('f1310000-0000-4000-8000-000000000002','f1340000-0000-4000-8000-000000000005',1,time '00:00',time '23:59',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('f1350000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','F13 Race Customer','05551300001','f13-race@example.invalid','f1300000-0000-4000-8000-000000000001'),
  ('f1350000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000002','F13 Other Customer','05551300002','f13-other@example.invalid','f1300000-0000-4000-8000-000000000001');

insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by
) values
  ('f1360000-0000-4000-8000-000000000001','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000002','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000003','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000004','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000005','f1310000-0000-4000-8000-000000000001','f1350000-0000-4000-8000-000000000001','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001'),
  ('f1360000-0000-4000-8000-000000000006','f1310000-0000-4000-8000-000000000002','f1350000-0000-4000-8000-000000000002','scheduled','operator',1,'f1300000-0000-4000-8000-000000000001');

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
  ('f1370000-0000-4000-8000-000000000004','f1310000-0000-4000-8000-000000000001','f1360000-0000-4000-8000-000000000004',1,'f1350000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000004','scheduled','2027-03-01 12:00+00','2027-03-01 12:30+00','2027-03-01 12:00+00','2027-03-01 12:30+00','Europe/Istanbul','F13 Race Customer','05551300001','f13-race@example.invalid','F13 Race Service','F13 Staff 4',30,0,0,10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator'),
  ('f1370000-0000-4000-8000-000000000006','f1310000-0000-4000-8000-000000000002','f1360000-0000-4000-8000-000000000006',1,'f1350000-0000-4000-8000-000000000002','f1330000-0000-4000-8000-000000000002','f1340000-0000-4000-8000-000000000005','scheduled','2027-03-01 14:00+00','2027-03-01 14:30+00','2027-03-01 14:00+00','2027-03-01 14:30+00','Europe/Istanbul','F13 Other Customer','05551300002','f13-other@example.invalid','F13 Other Service','F13 Other Staff',30,0,0,10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator');

-- F: old unsafe authority is gone; v2 is exact; revision storage is private.
do $$
begin
  if has_function_privilege('authenticated','public.list_appointments_page(uuid,integer,timestamptz,uuid)','EXECUTE') then
    raise exception 'F13 old v1 appointment page grant is still reachable';
  end if;
  if not has_function_privilege('authenticated','public.list_appointments_page_v2(uuid,integer,timestamptz,uuid,uuid)','EXECUTE') then
    raise exception 'F13 authenticated lost exact v2 appointment page authority';
  end if;
  if has_schema_privilege('authenticated','private','USAGE') then
    raise exception 'F13 authenticated unexpectedly has private schema usage';
  end if;
  if has_table_privilege('authenticated','private.appointment_page_revisions','SELECT') then
    raise exception 'F13 authenticated unexpectedly reads internal page revisions';
  end if;
end
$$;

select set_config('request.jwt.claim.sub','f1300000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

-- G: recovery sessions and non-members cannot use v2 authority.
do $$
begin
  perform set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',false);
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null);
    raise exception 'F13 recovery session unexpectedly read v2 appointment page';
  exception when others then
    if sqlerrm = 'F13 recovery session unexpectedly read v2 appointment page' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000002',2,null,null,null);
    raise exception 'F13 non-member unexpectedly read other-business v2 page';
  exception when others then
    if sqlerrm = 'F13 non-member unexpectedly read other-business v2 page' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- A: no writer => exact-once deterministic traversal.
do $$
declare
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_revision uuid;
  v_first uuid[];
  v_second uuid[];
begin
  select array_agg(p.id order by p.starts_at,p.id)
    into v_first
  from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p;
  select p.starts_at,p.id,p.page_revision
    into v_cursor_at,v_cursor_id,v_revision
  from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
  order by p.starts_at desc,p.id desc limit 1;
  select array_agg(p.id order by p.starts_at,p.id)
    into v_second
  from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_cursor_at,v_cursor_id,v_revision) p;
  if v_first is distinct from array['f1370000-0000-4000-8000-000000000001'::uuid,'f1370000-0000-4000-8000-000000000002'::uuid]
     or v_second is distinct from array['f1370000-0000-4000-8000-000000000003'::uuid,'f1370000-0000-4000-8000-000000000004'::uuid] then
    raise exception 'F13 v2 baseline traversal was not exact: first %, second %',v_first,v_second;
  end if;
end
$$;

create temp table f13_page_cursor(
  starts_at timestamptz not null,
  id uuid not null,
  revision uuid not null
) on commit preserve rows;

insert into f13_page_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
order by p.starts_at desc,p.id desc limit 1;

-- B: unseen row moves before stale cursor via canonical authenticated writer.
do $$
declare
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_revision uuid;
  v_writer text := 'f13_skip_writer';
  v_conn text := 'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f13_skip_writer';
  v_result jsonb;
begin
  select starts_at,id,revision into v_cursor_at,v_cursor_id,v_revision from pg_temp.f13_page_cursor;
  perform dblink_connect(v_writer,v_conn);
  perform dblink_exec(v_writer,'begin');
  perform dblink_exec(v_writer,'set local role authenticated');
  perform dblink_exec(v_writer,$q$set local "request.jwt.claim.sub" = 'f1300000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec(v_writer,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  select t.result into v_result from dblink(v_writer,$q$
    select public.reschedule_appointment_group(
      'f1310000-0000-4000-8000-000000000001'::uuid,
      'f1360000-0000-4000-8000-000000000003'::uuid,
      'f13-skip-writer',1,'2027-03-01 09:30+00'::timestamptz)
  $q$) as t(result jsonb);
  perform dblink_exec(v_writer,'commit');
  perform dblink_disconnect(v_writer);
  if v_result->>'groupId' is distinct from 'f1360000-0000-4000-8000-000000000003' then
    raise exception 'F13 skip writer returned unexpected group result: %',v_result;
  end if;
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_cursor_at,v_cursor_id,v_revision);
    raise exception 'F13 unseen-earlier continuation unexpectedly returned rows';
  exception when others then
    if sqlerrm = 'F13 unseen-earlier continuation unexpectedly returned rows' then raise; end if;
    if position('STALE_APPOINTMENT_PAGE' in sqlerrm) = 0 then raise; end if;
  end;
exception when others then
  begin perform dblink_disconnect(v_writer); exception when others then null; end;
  raise;
end
$$;

select public.reschedule_appointment_group(
  'f1310000-0000-4000-8000-000000000001'::uuid,
  'f1360000-0000-4000-8000-000000000003'::uuid,
  'f13-reset-after-skip',2,'2027-03-01 11:00+00'::timestamptz
);

truncate pg_temp.f13_page_cursor;
insert into f13_page_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
order by p.starts_at desc,p.id desc limit 1;

-- C: already-seen row moves after stale cursor via canonical writer.
do $$
declare
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_revision uuid;
  v_writer text := 'f13_repeat_writer';
  v_conn text := 'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f13_repeat_writer';
  v_result jsonb;
begin
  select starts_at,id,revision into v_cursor_at,v_cursor_id,v_revision from pg_temp.f13_page_cursor;
  perform dblink_connect(v_writer,v_conn);
  perform dblink_exec(v_writer,'begin');
  perform dblink_exec(v_writer,'set local role authenticated');
  perform dblink_exec(v_writer,$q$set local "request.jwt.claim.sub" = 'f1300000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec(v_writer,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  select t.result into v_result from dblink(v_writer,$q$
    select public.reschedule_appointment_group(
      'f1310000-0000-4000-8000-000000000001'::uuid,
      'f1360000-0000-4000-8000-000000000001'::uuid,
      'f13-repeat-writer',1,'2027-03-01 11:30+00'::timestamptz)
  $q$) as t(result jsonb);
  perform dblink_exec(v_writer,'commit');
  perform dblink_disconnect(v_writer);
  if v_result->>'groupId' is distinct from 'f1360000-0000-4000-8000-000000000001' then
    raise exception 'F13 repeat writer returned unexpected group result: %',v_result;
  end if;
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_cursor_at,v_cursor_id,v_revision);
    raise exception 'F13 seen-later continuation unexpectedly returned rows';
  exception when others then
    if sqlerrm = 'F13 seen-later continuation unexpectedly returned rows' then raise; end if;
    if position('STALE_APPOINTMENT_PAGE' in sqlerrm) = 0 then raise; end if;
  end;
exception when others then
  begin perform dblink_disconnect(v_writer); exception when others then null; end;
  raise;
end
$$;

select public.reschedule_appointment_group(
  'f1310000-0000-4000-8000-000000000001'::uuid,
  'f1360000-0000-4000-8000-000000000001'::uuid,
  'f13-reset-after-repeat',2,'2027-03-01 09:00+00'::timestamptz
);

-- D1: committed INSERT invalidates the bound business revision.
truncate pg_temp.f13_page_cursor;
insert into f13_page_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
order by p.starts_at desc,p.id desc limit 1;

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values (
  'f1370000-0000-4000-8000-000000000005','f1310000-0000-4000-8000-000000000001',
  'f1360000-0000-4000-8000-000000000005',1,
  'f1350000-0000-4000-8000-000000000001','f1330000-0000-4000-8000-000000000001','f1340000-0000-4000-8000-000000000001','scheduled',
  '2027-03-01 13:00+00','2027-03-01 13:30+00','2027-03-01 13:00+00','2027-03-01 13:30+00','Europe/Istanbul',
  'F13 Race Customer','05551300001','f13-race@example.invalid','F13 Race Service','F13 Staff 1',30,0,0,
  10000,'fixed',10000,10000,1,'TRY','f1300000-0000-4000-8000-000000000001','operator'
);

do $$
declare v_at timestamptz; v_id uuid; v_revision uuid;
begin
  select starts_at,id,revision into v_at,v_id,v_revision from pg_temp.f13_page_cursor;
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_at,v_id,v_revision);
    raise exception 'F13 insert continuation unexpectedly returned rows';
  exception when others then
    if sqlerrm = 'F13 insert continuation unexpectedly returned rows' then raise; end if;
    if position('STALE_APPOINTMENT_PAGE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- D2: committed DELETE also invalidates a newly bound revision.
truncate pg_temp.f13_page_cursor;
insert into f13_page_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
order by p.starts_at desc,p.id desc limit 1;

delete from public.appointments where id='f1370000-0000-4000-8000-000000000005';

do $$
declare v_at timestamptz; v_id uuid; v_revision uuid;
begin
  select starts_at,id,revision into v_at,v_id,v_revision from pg_temp.f13_page_cursor;
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_at,v_id,v_revision);
    raise exception 'F13 delete continuation unexpectedly returned rows';
  exception when others then
    if sqlerrm = 'F13 delete continuation unexpectedly returned rows' then raise; end if;
    if position('STALE_APPOINTMENT_PAGE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- D3: a rolled-back schedule mutation must not advance the durable revision.
truncate pg_temp.f13_page_cursor;
insert into f13_page_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
order by p.starts_at desc,p.id desc limit 1;

do $
declare
  v_at timestamptz;
  v_id uuid;
  v_revision uuid;
  v_store_revision uuid;
  v_writer text := 'f13_rollback_writer';
  v_conn text := 'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f13_rollback_writer';
  v_result jsonb;
  v_second uuid[];
begin
  select starts_at,id,revision into v_at,v_id,v_revision from pg_temp.f13_page_cursor;
  perform dblink_connect(v_writer,v_conn);
  perform dblink_exec(v_writer,'begin');
  perform dblink_exec(v_writer,'set local role authenticated');
  perform dblink_exec(v_writer,$q$set local "request.jwt.claim.sub" = 'f1300000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec(v_writer,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  select t.result into v_result from dblink(v_writer,$q$
    select public.reschedule_appointment_group(
      'f1310000-0000-4000-8000-000000000001'::uuid,
      'f1360000-0000-4000-8000-000000000004'::uuid,
      'f13-rollback-writer',1,'2027-03-01 12:30+00'::timestamptz)
  $q$) as t(result jsonb);
  if v_result->>'groupId' is distinct from 'f1360000-0000-4000-8000-000000000004' then
    raise exception 'F13 rollback writer returned unexpected group result: %',v_result;
  end if;
  perform dblink_exec(v_writer,'rollback');
  perform dblink_disconnect(v_writer);

  select revision into v_store_revision
  from private.appointment_page_revisions
  where business_id='f1310000-0000-4000-8000-000000000001';
  if v_store_revision is distinct from v_revision then
    raise exception 'F13 rolled-back mutation advanced durable revision: bound %, stored %',v_revision,v_store_revision;
  end if;

  select array_agg(p.id order by p.starts_at,p.id) into v_second
  from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_at,v_id,v_revision) p;
  if v_second is distinct from array['f1370000-0000-4000-8000-000000000003'::uuid,'f1370000-0000-4000-8000-000000000004'::uuid] then
    raise exception 'F13 rollback changed continuation despite durable revision rollback: %',v_second;
  end if;
exception when others then
  begin perform dblink_disconnect(v_writer); exception when others then null; end;
  raise;
end
$;

-- E: another business mutates its own ordering key; A's continuation is valid.
truncate pg_temp.f13_page_cursor;
insert into f13_page_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null) p
order by p.starts_at desc,p.id desc limit 1;

update public.appointments
set starts_at='2027-03-01 15:00+00',
    ends_at='2027-03-01 15:30+00',
    occupied_starts_at='2027-03-01 15:00+00',
    occupied_ends_at='2027-03-01 15:30+00'
where id='f1370000-0000-4000-8000-000000000006';

do $$
declare
  v_at timestamptz;
  v_id uuid;
  v_revision uuid;
  v_second uuid[];
begin
  select starts_at,id,revision into v_at,v_id,v_revision from pg_temp.f13_page_cursor;
  select array_agg(p.id order by p.starts_at,p.id) into v_second
  from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_at,v_id,v_revision) p;
  if v_second is distinct from array['f1370000-0000-4000-8000-000000000003'::uuid,'f1370000-0000-4000-8000-000000000004'::uuid] then
    raise exception 'F13 other-business mutation changed A continuation: %',v_second;
  end if;
  begin
    perform * from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',10,v_at,v_id,null);
    raise exception 'F13 cursor without revision unexpectedly accepted';
  exception when others then
    if sqlerrm = 'F13 cursor without revision unexpectedly accepted' then raise; end if;
    if position('INVALID_PAGE_CURSOR' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- G positive: exact authenticated grant + standard session + active membership.
set role authenticated;
select set_config('request.jwt.claim.sub','f1300000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);
do $$
begin
  if (select count(*) from public.list_appointments_page_v2('f1310000-0000-4000-8000-000000000001',2,null,null,null)) <> 2 then
    raise exception 'F13 authenticated standard member did not retain v2 read authority';
  end if;
end
$$;
reset role;

drop table pg_temp.f13_page_cursor;
delete from public.businesses
where id in (
  'f1310000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000002'
);
delete from private.appointment_page_revisions
where business_id in (
  'f1310000-0000-4000-8000-000000000001',
  'f1310000-0000-4000-8000-000000000002'
);

do $$
begin
  raise notice 'F13-01 v2 pagination repair: exact baseline; reschedule/insert/delete stale-fail; other-business isolated; v1 authority revoked';
end
$$;
