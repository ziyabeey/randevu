begin;

-- Self-contained C2a fixture: one authorized business with 105 appointments and
-- 105 events, including many equal timestamps so UUID tie-break ordering is
-- exercised. A second business proves the caller cannot switch tenant scope.
insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  'a7000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  's07-page-owner@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
) on conflict (id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('a7100000-0000-4000-8000-000000000001','S07 Page Salon A','s07-page-a','Europe/Istanbul','a7000000-0000-4000-8000-000000000001'),
  ('a7100000-0000-4000-8000-000000000002','S07 Page Salon B','s07-page-b','Europe/Istanbul','a7000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'a7200000-0000-4000-8000-000000000001',
  'a7100000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000001','owner',true
) on conflict (business_id,user_id) do update set role='owner',active=true;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  price_minor,currency
) values
  ('a7300000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000001','S07 Page Service A',30,0,0,10000,'TRY'),
  ('a7300000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000002','S07 Page Service B',30,0,0,10000,'TRY')
on conflict (id) do nothing;

-- Busy-calendar coverage needs >100 active rows without violating the existing
-- per-staff overlap exclusion. Give each appointment its own valid staff member;
-- this tests calendar completeness without weakening booking integrity.
insert into public.staff_profiles(id,business_id,name)
select
  format('a7400000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'a7100000-0000-4000-8000-000000000001'::uuid,
  'S07 Page Staff '||g
from generate_series(1,105) g;

insert into public.staff_profiles(id,business_id,name)
values (
  'a74f0000-0000-4000-8000-999999999999',
  'a7100000-0000-4000-8000-000000000002',
  'S07 Page Staff B'
);

insert into public.customers(id,business_id,name,email,created_by)
select
  format('a7500000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'a7100000-0000-4000-8000-000000000001'::uuid,
  'S07 Page Customer '||g,'s07-page-'||g||'@example.test',
  'a7000000-0000-4000-8000-000000000001'::uuid
from generate_series(1,105) g;

insert into public.customers(id,business_id,name,email,created_by)
values (
  'a7500000-0000-4000-8000-999999999999',
  'a7100000-0000-4000-8000-000000000002',
  'S07 Other Customer','s07-other@example.test',
  'a7000000-0000-4000-8000-000000000001'
);

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,
  duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by,source
)
select
  format('a7600000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'a7100000-0000-4000-8000-000000000001'::uuid,
  format('a7500000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'a7300000-0000-4000-8000-000000000001'::uuid,
  format('a7400000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'scheduled',
  '2027-01-15 09:00:00+00'::timestamptz + make_interval(mins => ((g-1)/3)::integer),
  '2027-01-15 09:30:00+00'::timestamptz + make_interval(mins => ((g-1)/3)::integer),
  '2027-01-15 09:00:00+00'::timestamptz + make_interval(mins => ((g-1)/3)::integer),
  '2027-01-15 09:30:00+00'::timestamptz + make_interval(mins => ((g-1)/3)::integer),
  'Europe/Istanbul','S07 Page Customer '||g,'s07-page-'||g||'@example.test',
  'S07 Page Service A','S07 Page Staff '||g,30,0,0,10000,'TRY',
  'a7000000-0000-4000-8000-000000000001'::uuid,'operator'
from generate_series(1,105) g;

insert into public.appointments(
  id,business_id,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,
  duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,currency_snapshot,created_by,source
) values (
  'a7600000-0000-4000-8000-999999999999',
  'a7100000-0000-4000-8000-000000000002',
  'a7500000-0000-4000-8000-999999999999',
  'a7300000-0000-4000-8000-000000000002',
  'a74f0000-0000-4000-8000-999999999999','cancelled',
  '2027-01-15 09:00:00+00','2027-01-15 09:30:00+00',
  '2027-01-15 09:00:00+00','2027-01-15 09:30:00+00','Europe/Istanbul',
  'S07 Other Customer','s07-other@example.test','S07 Page Service B','S07 Page Staff B',
  30,0,0,10000,'TRY','a7000000-0000-4000-8000-000000000001','operator'
);

insert into public.appointment_events(
  id,business_id,appointment_id,event_type,actor_user_id,from_status,to_status,payload,created_at
)
select
  format('a7700000-0000-4000-8000-%s',lpad(g::text,12,'0'))::uuid,
  'a7100000-0000-4000-8000-000000000001'::uuid,
  'a7600000-0000-4000-8000-000000000001'::uuid,
  'created','a7000000-0000-4000-8000-000000000001'::uuid,
  null,'scheduled',jsonb_build_object('n',g),
  '2027-01-01 00:00:00+00'::timestamptz + make_interval(secs => ((g-1)/3)::integer)
from generate_series(1,105) g;

set local role authenticated;
select set_config('request.jwt.claim.sub','a7000000-0000-4000-8000-000000000001',true);

-- Basic boundary and tenant checks.
do $$
declare
  v_at timestamptz;
  v_id uuid;
begin
  if (select count(*) from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',26,null,null)) <> 26 then
    raise exception 'S07 C2a first probe did not return limit+1 rows';
  end if;

  select starts_at,id into v_at,v_id
  from public.list_appointments_page(
    'a7100000-0000-4000-8000-000000000001',25,null,null)
  order by starts_at desc,id desc limit 1;

  if (select count(*) from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',26,v_at,v_id)) <> 26 then
    raise exception 'S07 C2a second probe did not continue after stable key';
  end if;

  if exists (
    select 1 from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',101,null,null)
    where business_id <> 'a7100000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception 'S07 C2a appointment page leaked another tenant';
  end if;

  begin
    perform 1 from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',102,null,null);
    raise exception 'S07 C2a accepted p_limit > 101';
  exception when others then
    if sqlerrm not like '%INVALID_PAGE_LIMIT%' then raise; end if;
  end;

  begin
    perform 1 from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',25,now(),null);
    raise exception 'S07 C2a accepted half cursor';
  exception when others then
    if sqlerrm not like '%INVALID_PAGE_CURSOR%' then raise; end if;
  end;

  begin
    perform 1 from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000002',25,null,null);
    raise exception 'S07 C2a allowed caller to switch to unauthorized business';
  exception when others then
    if sqlerrm not like '%NOT_ALLOWED%' then raise; end if;
  end;
end
$$;

-- Walk all booking pages. The primary key on the temp table makes any duplicate
-- fail immediately; the final count proves no skipped row across equal times.
create temp table s07_booking_seen(id uuid primary key) on commit drop;
do $$
declare
  v_after_at timestamptz := null;
  v_after_id uuid := null;
  v_count integer;
  v_total integer := 0;
begin
  loop
    insert into pg_temp.s07_booking_seen(id)
    select p.id
    from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',25,v_after_at,v_after_id) p;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    exit when v_count = 0;

    select p.starts_at,p.id into v_after_at,v_after_id
    from public.list_appointments_page(
      'a7100000-0000-4000-8000-000000000001',25,v_after_at,v_after_id) p
    order by p.starts_at desc,p.id desc limit 1;

    exit when v_count < 25;
  end loop;

  if v_total <> 105 or (select count(*) from pg_temp.s07_booking_seen) <> 105 then
    raise exception 'S07 C2a booking pagination skipped/duplicated rows: total %, unique %',
      v_total,(select count(*) from pg_temp.s07_booking_seen);
  end if;
end
$$;

-- Walk all event pages using the same tie-break rule.
create temp table s07_event_seen(id uuid primary key) on commit drop;
do $$
declare
  v_after_at timestamptz := null;
  v_after_id uuid := null;
  v_count integer;
  v_total integer := 0;
begin
  loop
    insert into pg_temp.s07_event_seen(id)
    select p.id
    from public.list_appointment_events_page(
      'a7100000-0000-4000-8000-000000000001',
      'a7600000-0000-4000-8000-000000000001',25,v_after_at,v_after_id) p;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    exit when v_count = 0;

    select p.created_at,p.id into v_after_at,v_after_id
    from public.list_appointment_events_page(
      'a7100000-0000-4000-8000-000000000001',
      'a7600000-0000-4000-8000-000000000001',25,v_after_at,v_after_id) p
    order by p.created_at desc,p.id desc limit 1;

    exit when v_count < 25;
  end loop;

  if v_total <> 105 or (select count(*) from pg_temp.s07_event_seen) <> 105 then
    raise exception 'S07 C2a event pagination skipped/duplicated rows: total %, unique %',
      v_total,(select count(*) from pg_temp.s07_event_seen);
  end if;
end
$$;

-- Calendar is a bounded range, not a generic list. Even with >100 rows it must
-- return the complete valid day instead of pretending the first 100 are all.
do $$
begin
  if (select count(*) from public.get_calendar_appointments(
      'a7100000-0000-4000-8000-000000000001','2027-01-15',1,null)) <> 105 then
    raise exception 'S07 C2a calendar silently truncated a busy valid day';
  end if;
end
$$;

reset role;

-- Function-level DB safety budget and explicit ACL are part of the contract.
do $$
declare
  v_config text;
begin
  select array_to_string(proconfig,',') into v_config
  from pg_proc where oid='public.list_appointments_page(uuid,integer,timestamptz,uuid)'::regprocedure;
  if coalesce(v_config,'') not like '%statement_timeout=5s%' then
    raise exception 'S07 C2a booking page DB timeout missing: %',v_config;
  end if;

  select array_to_string(proconfig,',') into v_config
  from pg_proc where oid='public.list_appointment_events_page(uuid,uuid,integer,timestamptz,uuid)'::regprocedure;
  if coalesce(v_config,'') not like '%statement_timeout=5s%' then
    raise exception 'S07 C2a event page DB timeout missing: %',v_config;
  end if;

  select array_to_string(proconfig,',') into v_config
  from pg_proc where oid='public.get_calendar_appointments(uuid,date,integer,uuid)'::regprocedure;
  if coalesce(v_config,'') not like '%statement_timeout=5s%' then
    raise exception 'S07 C2a calendar DB timeout missing: %',v_config;
  end if;

  if has_function_privilege('anon','public.list_appointments_page(uuid,integer,timestamptz,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.list_appointments_page(uuid,integer,timestamptz,uuid)','EXECUTE') then
    raise exception 'S07 C2a booking page ACL mismatch';
  end if;
  if has_function_privilege('anon','public.list_appointment_events_page(uuid,uuid,integer,timestamptz,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.list_appointment_events_page(uuid,uuid,integer,timestamptz,uuid)','EXECUTE') then
    raise exception 'S07 C2a event page ACL mismatch';
  end if;
end
$$;

-- Prove the keyset indexes are usable for their intended query shapes. Forcing
-- seqscan off tests index compatibility, not production cost preference; C3
-- records the real load plans and timings.
create or replace function pg_temp.explain_text(p_sql text)
returns text language plpgsql as $$
declare r record; v_out text := '';
begin
  for r in execute 'explain (costs off) '||p_sql loop
    v_out := v_out || r."QUERY PLAN" || E'\n';
  end loop;
  return v_out;
end
$$;

set local enable_seqscan = off;
do $$
declare v_plan text;
begin
  v_plan := pg_temp.explain_text($q$
    select id from public.appointments
    where business_id='a7100000-0000-4000-8000-000000000001'::uuid
      and (starts_at,id) > ('2027-01-15 09:05:00+00'::timestamptz,'a7600000-0000-4000-8000-000000000010'::uuid)
    order by starts_at,id limit 26
  $q$);
  if v_plan not like '%appointments_business_page_idx%' then
    raise exception 'S07 C2a booking keyset index not usable: %',v_plan;
  end if;

  v_plan := pg_temp.explain_text($q$
    select id from public.appointment_events
    where business_id='a7100000-0000-4000-8000-000000000001'::uuid
      and appointment_id='a7600000-0000-4000-8000-000000000001'::uuid
      and (created_at,id) > ('2027-01-01 00:00:02+00'::timestamptz,'a7700000-0000-4000-8000-000000000010'::uuid)
    order by created_at,id limit 26
  $q$);
  if v_plan not like '%appointment_events_page_idx%' then
    raise exception 'S07 C2a event keyset index not usable: %',v_plan;
  end if;
end
$$;

rollback;
