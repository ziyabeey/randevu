create extension if not exists dblink;

-- Experimental H19 Round D probe.
-- Frozen invariant: a committed cross-business-local-day retime must invalidate
-- a previously issued range-aware continuation revision.

delete from public.businesses where id='f2910000-0000-4000-8000-000000000001';
delete from private.appointment_page_revisions where business_id='f2910000-0000-4000-8000-000000000001';
delete from auth.users where id='f2900000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f2900000-0000-4000-8000-000000000001','h19-calendar-d4d5@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f2910000-0000-4000-8000-000000000001',
  'H19 Calendar D4xD5',
  'h19-calendar-d4d5',
  'Europe/Istanbul',
  'f2900000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f2920000-0000-4000-8000-000000000001',
  'f2910000-0000-4000-8000-000000000001',
  'f2900000-0000-4000-8000-000000000001',
  'owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f2930000-0000-4000-8000-000000000001',
  'f2910000-0000-4000-8000-000000000001',
  'H19 Calendar Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('f2940000-0000-4000-8000-000000000001','f2910000-0000-4000-8000-000000000001','H19 Calendar Staff 1',true),
  ('f2940000-0000-4000-8000-000000000002','f2910000-0000-4000-8000-000000000001','H19 Calendar Staff 2',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('f2910000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000001','f2930000-0000-4000-8000-000000000001',true),
  ('f2910000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000002','f2930000-0000-4000-8000-000000000001',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values
  ('f2910000-0000-4000-8000-000000000001',1,time '08:00',time '18:00',true),
  ('f2910000-0000-4000-8000-000000000001',2,time '08:00',time '18:00',true);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('f2910000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000001',1,time '08:00',time '18:00',true),
  ('f2910000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000001',2,time '08:00',time '18:00',true),
  ('f2910000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000002',1,time '08:00',time '18:00',true),
  ('f2910000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000002',2,time '08:00',time '18:00',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values (
  'f2950000-0000-4000-8000-000000000001',
  'f2910000-0000-4000-8000-000000000001',
  'H19 Calendar Customer',
  '05552900001',
  'h19-calendar-customer@example.invalid',
  'f2900000-0000-4000-8000-000000000001'
);

insert into public.appointment_groups(id,business_id,customer_id,status,source,version,created_by)
values
  ('f2960000-0000-4000-8000-000000000001','f2910000-0000-4000-8000-000000000001','f2950000-0000-4000-8000-000000000001','scheduled','operator',1,'f2900000-0000-4000-8000-000000000001'),
  ('f2960000-0000-4000-8000-000000000002','f2910000-0000-4000-8000-000000000001','f2950000-0000-4000-8000-000000000001','scheduled','operator',1,'f2900000-0000-4000-8000-000000000001');

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
    'f2970000-0000-4000-8000-000000000001','f2910000-0000-4000-8000-000000000001',
    'f2960000-0000-4000-8000-000000000001',1,'f2950000-0000-4000-8000-000000000001',
    'f2930000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000001','scheduled',
    '2027-03-01 06:00+00','2027-03-01 06:30+00','2027-03-01 06:00+00','2027-03-01 06:30+00',
    'Europe/Istanbul','H19 Calendar Customer','05552900001','h19-calendar-customer@example.invalid',
    'H19 Calendar Service','H19 Calendar Staff 1',30,0,0,10000,'fixed',10000,10000,1,'TRY',
    'f2900000-0000-4000-8000-000000000001','operator'
  ),
  (
    'f2970000-0000-4000-8000-000000000002','f2910000-0000-4000-8000-000000000001',
    'f2960000-0000-4000-8000-000000000002',1,'f2950000-0000-4000-8000-000000000001',
    'f2930000-0000-4000-8000-000000000001','f2940000-0000-4000-8000-000000000002','scheduled',
    '2027-03-02 06:30+00','2027-03-02 07:00+00','2027-03-02 06:30+00','2027-03-02 07:00+00',
    'Europe/Istanbul','H19 Calendar Customer','05552900001','h19-calendar-customer@example.invalid',
    'H19 Calendar Service','H19 Calendar Staff 2',30,0,0,10000,'fixed',10000,10000,1,'TRY',
    'f2900000-0000-4000-8000-000000000001','operator'
  );

set role authenticated;
select set_config('request.jwt.claim.sub','f2900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

create temp table h19_calendar_d4d5_cursor(
  starts_at timestamptz not null,
  id uuid not null,
  revision uuid not null
) on commit preserve rows;

insert into h19_calendar_d4d5_cursor(starts_at,id,revision)
select p.starts_at,p.id,p.page_revision
from public.list_appointments_page_v3(
  'f2910000-0000-4000-8000-000000000001',
  1,null,null,null,'2027-03-01','2027-03-02'
) p;

do $h19pre$
declare
  v_count integer;
  v_id uuid;
begin
  select count(*) into v_count from pg_temp.h19_calendar_d4d5_cursor;
  select id into v_id from pg_temp.h19_calendar_d4d5_cursor limit 1;
  if v_count<>1 or v_id is distinct from 'f2970000-0000-4000-8000-000000000001'::uuid then
    raise exception 'H19 calendar D4xD5 invalid first page: count %, id %',v_count,v_id;
  end if;
end
$h19pre$;

reset role;

do $h19writer$
declare
  v_writer text := 'h19_calendar_d4d5_writer';
  v_conn text := 'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=h19_calendar_d4d5_writer';
  v_result jsonb;
begin
  perform dblink_connect(v_writer,v_conn);
  perform dblink_exec(v_writer,'begin');
  perform dblink_exec(v_writer,'set local role authenticated');
  perform dblink_exec(v_writer,$q$set local "request.jwt.claim.sub" = 'f2900000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec(v_writer,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  select t.result into v_result
  from dblink(v_writer,$q$
    select public.reschedule_appointment_group(
      'f2910000-0000-4000-8000-000000000001'::uuid,
      'f2960000-0000-4000-8000-000000000002'::uuid,
      'h19-calendar-d4d5-retime',
      1,
      '2027-03-01 07:00+00'::timestamptz
    )
  $q$) as t(result jsonb);
  perform dblink_exec(v_writer,'commit');
  perform dblink_disconnect(v_writer);

  if v_result->>'groupId' is distinct from 'f2960000-0000-4000-8000-000000000002' then
    raise exception 'H19 calendar D4xD5 writer returned unexpected group result: %',v_result;
  end if;
exception when others then
  begin perform dblink_exec(v_writer,'rollback'); exception when others then null; end;
  begin perform dblink_disconnect(v_writer); exception when others then null; end;
  raise;
end
$h19writer$;

set role authenticated;
select set_config('request.jwt.claim.sub','f2900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $h19oracle$
declare
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_revision uuid;
  v_ids uuid[];
  v_p2_at timestamptz;
  v_rows integer;
begin
  select starts_at,id,revision into v_cursor_at,v_cursor_id,v_revision
  from pg_temp.h19_calendar_d4d5_cursor;

  select array_agg(p.id order by p.starts_at,p.id),
         max(p.starts_at) filter (where p.id='f2970000-0000-4000-8000-000000000002'::uuid)
    into v_ids,v_p2_at
  from public.list_appointments_page_v3(
    'f2910000-0000-4000-8000-000000000001',
    10,null,null,null,'2027-03-01','2027-03-02'
  ) p;

  if v_ids is distinct from array[
      'f2970000-0000-4000-8000-000000000001'::uuid,
      'f2970000-0000-4000-8000-000000000002'::uuid
    ]
     or v_p2_at is distinct from '2027-03-01 07:00+00'::timestamptz then
    raise exception 'H19 calendar D4xD5 invalid retime harness: ids %, p2 %',v_ids,v_p2_at;
  end if;

  begin
    select count(*) into v_rows
    from public.list_appointments_page_v3(
      'f2910000-0000-4000-8000-000000000001',
      10,v_cursor_at,v_cursor_id,v_revision,'2027-03-01','2027-03-02'
    );
    raise exception 'H19 calendar D4xD5 stale continuation accepted after cross-day retime: rows %',v_rows;
  exception when others then
    if position('STALE_APPOINTMENT_PAGE' in sqlerrm)>0 then
      null;
    elsif position('H19 calendar D4xD5 stale continuation accepted after cross-day retime' in sqlerrm)>0 then
      raise;
    else
      raise;
    end if;
  end;
end
$h19oracle$;

reset role;
drop table pg_temp.h19_calendar_d4d5_cursor;
delete from public.businesses where id='f2910000-0000-4000-8000-000000000001';
delete from private.appointment_page_revisions where business_id='f2910000-0000-4000-8000-000000000001';
delete from auth.users where id='f2900000-0000-4000-8000-000000000001';

do $h19done$
begin
  raise notice 'H19 calendar D4xD5 prospective invariant accepted: cross-day retime invalidated range continuation';
end
$h19done$;
