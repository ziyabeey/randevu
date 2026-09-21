create extension if not exists dblink;

-- F13-02: business-local [start,end) booking range. America/New_York
-- 2026-11-01 is a 25-hour local day, so both repeated 01:30 instants must be
-- included while the exact next-local-midnight boundary is excluded.
delete from public.businesses where id='f2310000-0000-4000-8000-000000000001';
delete from private.appointment_page_revisions where business_id='f2310000-0000-4000-8000-000000000001';
delete from auth.users where id='f2300000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f2300000-0000-4000-8000-000000000001','f13-range-owner@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f2310000-0000-4000-8000-000000000001',
  'F13 Range Salon',
  'f13-range-salon',
  'America/New_York',
  'f2300000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f2320000-0000-4000-8000-000000000001',
  'f2310000-0000-4000-8000-000000000001',
  'f2300000-0000-4000-8000-000000000001',
  'owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f2330000-0000-4000-8000-000000000001',
  'f2310000-0000-4000-8000-000000000001',
  'F13 Range Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
select
  format('f2340000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'f2310000-0000-4000-8000-000000000001'::uuid,
  'F13 Range Staff '||g,
  true
from generate_series(1,6) g;

insert into public.staff_services(business_id,staff_id,service_id,active)
select
  'f2310000-0000-4000-8000-000000000001'::uuid,
  format('f2340000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'f2330000-0000-4000-8000-000000000001'::uuid,
  true
from generate_series(1,6) g;

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values
  ('f2310000-0000-4000-8000-000000000001',6,time '00:00',time '23:59',true),
  ('f2310000-0000-4000-8000-000000000001',0,time '00:00',time '23:59',true),
  ('f2310000-0000-4000-8000-000000000001',1,time '00:00',time '23:59',true);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'f2310000-0000-4000-8000-000000000001'::uuid,
  format('f2340000-0000-4000-8000-%s',lpad(s::text,12,'0'))::uuid,
  d,
  time '00:00',
  time '23:59',
  true
from generate_series(1,6) s
cross join (values (6),(0),(1)) days(d);

insert into public.customers(id,business_id,name,phone,email,created_by)
values (
  'f2350000-0000-4000-8000-000000000001',
  'f2310000-0000-4000-8000-000000000001',
  'F13 Range Customer',
  '05552300001',
  'f13-range@example.invalid',
  'f2300000-0000-4000-8000-000000000001'
);

insert into public.appointment_groups(id,business_id,customer_id,status,source,version,created_by)
select
  format('f2360000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'f2310000-0000-4000-8000-000000000001'::uuid,
  'f2350000-0000-4000-8000-000000000001'::uuid,
  'scheduled','operator',1,
  'f2300000-0000-4000-8000-000000000001'::uuid
from generate_series(1,6) g;

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values
  ('f2370000-0000-4000-8000-000000000001','f2310000-0000-4000-8000-000000000001','f2360000-0000-4000-8000-000000000001',1,'f2350000-0000-4000-8000-000000000001','f2330000-0000-4000-8000-000000000001','f2340000-0000-4000-8000-000000000001','scheduled','2026-11-01 03:00+00','2026-11-01 03:30+00','2026-11-01 03:00+00','2026-11-01 03:30+00','America/New_York','F13 Range Customer','05552300001','f13-range@example.invalid','F13 Range Service','F13 Range Staff 1',30,0,0,10000,'fixed',10000,10000,1,'TRY','f2300000-0000-4000-8000-000000000001','operator'),
  ('f2370000-0000-4000-8000-000000000002','f2310000-0000-4000-8000-000000000001','f2360000-0000-4000-8000-000000000002',1,'f2350000-0000-4000-8000-000000000001','f2330000-0000-4000-8000-000000000001','f2340000-0000-4000-8000-000000000002','scheduled','2026-11-01 04:00+00','2026-11-01 04:30+00','2026-11-01 04:00+00','2026-11-01 04:30+00','America/New_York','F13 Range Customer','05552300001','f13-range@example.invalid','F13 Range Service','F13 Range Staff 2',30,0,0,10000,'fixed',10000,10000,1,'TRY','f2300000-0000-4000-8000-000000000001','operator'),
  ('f2370000-0000-4000-8000-000000000003','f2310000-0000-4000-8000-000000000001','f2360000-0000-4000-8000-000000000003',1,'f2350000-0000-4000-8000-000000000001','f2330000-0000-4000-8000-000000000001','f2340000-0000-4000-8000-000000000003','scheduled','2026-11-01 05:30+00','2026-11-01 06:00+00','2026-11-01 05:30+00','2026-11-01 06:00+00','America/New_York','F13 Range Customer','05552300001','f13-range@example.invalid','F13 Range Service','F13 Range Staff 3',30,0,0,10000,'fixed',10000,10000,1,'TRY','f2300000-0000-4000-8000-000000000001','operator'),
  ('f2370000-0000-4000-8000-000000000004','f2310000-0000-4000-8000-000000000001','f2360000-0000-4000-8000-000000000004',1,'f2350000-0000-4000-8000-000000000001','f2330000-0000-4000-8000-000000000001','f2340000-0000-4000-8000-000000000004','scheduled','2026-11-01 06:30+00','2026-11-01 07:00+00','2026-11-01 06:30+00','2026-11-01 07:00+00','America/New_York','F13 Range Customer','05552300001','f13-range@example.invalid','F13 Range Service','F13 Range Staff 4',30,0,0,10000,'fixed',10000,10000,1,'TRY','f2300000-0000-4000-8000-000000000001','operator'),
  ('f2370000-0000-4000-8000-000000000005','f2310000-0000-4000-8000-000000000001','f2360000-0000-4000-8000-000000000005',1,'f2350000-0000-4000-8000-000000000001','f2330000-0000-4000-8000-000000000001','f2340000-0000-4000-8000-000000000005','scheduled','2026-11-02 04:00+00','2026-11-02 04:30+00','2026-11-02 04:00+00','2026-11-02 04:30+00','America/New_York','F13 Range Customer','05552300001','f13-range@example.invalid','F13 Range Service','F13 Range Staff 5',30,0,0,10000,'fixed',10000,10000,1,'TRY','f2300000-0000-4000-8000-000000000001','operator'),
  ('f2370000-0000-4000-8000-000000000006','f2310000-0000-4000-8000-000000000001','f2360000-0000-4000-8000-000000000006',1,'f2350000-0000-4000-8000-000000000001','f2330000-0000-4000-8000-000000000001','f2340000-0000-4000-8000-000000000006','scheduled','2026-11-02 05:00+00','2026-11-02 05:30+00','2026-11-02 05:00+00','2026-11-02 05:30+00','America/New_York','F13 Range Customer','05552300001','f13-range@example.invalid','F13 Range Service','F13 Range Staff 6',30,0,0,10000,'fixed',10000,10000,1,'TRY','f2300000-0000-4000-8000-000000000001','operator');

do $$
declare v_config text;
begin
  if has_function_privilege('authenticated','public.list_appointments_page_v2(uuid,integer,timestamptz,uuid,uuid)','EXECUTE') then
    raise exception 'F13-02 old v2 appointment page grant is still reachable';
  end if;
  if not has_function_privilege('authenticated','public.list_appointments_page_v3(uuid,integer,timestamptz,uuid,uuid,date,date)','EXECUTE') then
    raise exception 'F13-02 authenticated lost exact v3 appointment page authority';
  end if;
  if has_function_privilege('anon','public.list_appointments_page_v3(uuid,integer,timestamptz,uuid,uuid,date,date)','EXECUTE') then
    raise exception 'F13-02 anon reached v3 appointment page';
  end if;
  select array_to_string(proconfig,',') into v_config
  from pg_proc
  where oid='public.list_appointments_page_v3(uuid,integer,timestamptz,uuid,uuid,date,date)'::regprocedure;
  if coalesce(v_config,'') not like '%statement_timeout=5s%' then
    raise exception 'F13-02 v3 appointment page lost 5s statement timeout';
  end if;
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','f2300000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',false);
do $$
begin
  begin
    perform * from public.list_appointments_page_v3(
      'f2310000-0000-4000-8000-000000000001',10,null,null,null,'2026-11-01','2026-11-02'
    );
    raise exception 'F13-02 recovery unexpectedly read v3 appointment page';
  exception when others then
    if sqlerrm='F13-02 recovery unexpectedly read v3 appointment page' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_ids uuid[];
  v_all integer;
begin
  select array_agg(p.id order by p.starts_at,p.id) into v_ids
  from public.list_appointments_page_v3(
    'f2310000-0000-4000-8000-000000000001',10,null,null,null,'2026-11-01','2026-11-02'
  ) p;
  if v_ids is distinct from array[
    'f2370000-0000-4000-8000-000000000002'::uuid,
    'f2370000-0000-4000-8000-000000000003'::uuid,
    'f2370000-0000-4000-8000-000000000004'::uuid,
    'f2370000-0000-4000-8000-000000000005'::uuid
  ] then
    raise exception 'F13-02 New York local-day range mismatch: %',v_ids;
  end if;

  select count(*) into v_all
  from public.list_appointments_page_v3(
    'f2310000-0000-4000-8000-000000000001',10,null,null,null,null,null
  );
  if v_all<>6 then
    raise exception 'F13-02 unbounded compatibility expected 6 rows, got %',v_all;
  end if;

  begin
    perform * from public.list_appointments_page_v3(
      'f2310000-0000-4000-8000-000000000001',10,null,null,null,'2026-11-01',null
    );
    raise exception 'F13-02 accepted half range';
  exception when others then
    if sqlerrm='F13-02 accepted half range' then raise; end if;
    if position('INVALID_PAGE_RANGE' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform * from public.list_appointments_page_v3(
      'f2310000-0000-4000-8000-000000000001',10,null,null,null,'2026-11-02','2026-11-01'
    );
    raise exception 'F13-02 accepted reversed range';
  exception when others then
    if sqlerrm='F13-02 accepted reversed range' then raise; end if;
    if position('INVALID_PAGE_RANGE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

create temp table f1302_cursor(starts_at timestamptz,id uuid,revision uuid) on commit preserve rows;
insert into f1302_cursor
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v3(
  'f2310000-0000-4000-8000-000000000001',2,null,null,null,'2026-11-01','2026-11-02'
) p
order by p.starts_at desc,p.id desc
limit 1;

do $$
declare
  v_at timestamptz;
  v_id uuid;
  v_revision uuid;
  v_ids uuid[];
begin
  select starts_at,id,revision into v_at,v_id,v_revision from pg_temp.f1302_cursor;
  select array_agg(p.id order by p.starts_at,p.id) into v_ids
  from public.list_appointments_page_v3(
    'f2310000-0000-4000-8000-000000000001',10,v_at,v_id,v_revision,'2026-11-01','2026-11-02'
  ) p;
  if v_ids is distinct from array[
    'f2370000-0000-4000-8000-000000000004'::uuid,
    'f2370000-0000-4000-8000-000000000005'::uuid
  ] then
    raise exception 'F13-02 range continuation mismatch: %',v_ids;
  end if;
end
$$;

reset role;
drop table pg_temp.f1302_cursor;
delete from public.businesses where id='f2310000-0000-4000-8000-000000000001';
delete from private.appointment_page_revisions where business_id='f2310000-0000-4000-8000-000000000001';
delete from auth.users where id='f2300000-0000-4000-8000-000000000001';

do $$
begin
  raise notice 'F13-02 date range: business-local [start,end), DST repeated-hour inclusion, exact end exclusion, cursor continuity and v2 grant removal passed';
end
$$;
