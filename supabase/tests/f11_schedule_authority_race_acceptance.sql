create extension if not exists dblink;

-- F11-04 D: real schedule/catalog mutation races. Every booking writer below
-- starts while the old authority is visible. The competing F10-04 mutation wins
-- its accepted lock/row first; the deferred F11 DB-final authority guard must
-- then reject the stale booking write and roll the entire command/group/version
-- movement back.

delete from public.businesses where id='d1910000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('d1900000-0000-4000-8000-000000000001','f1104-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'd1910000-0000-4000-8000-000000000001','F11-04 Authority Race','f1104-authority-race',
  'Europe/Istanbul','d1900000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'd1920000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001',
  'd1900000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active,
  processing_capacity_policy,passive_wait_minutes
) values
  ('d1930000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','Race A',30,0,0,'Race',10,10000,'fixed',10000,10000,'TRY',true,null,0),
  ('d1930000-0000-4000-8000-000000000002','d1910000-0000-4000-8000-000000000001','Race B',30,0,0,'Race',20,12000,'fixed',12000,12000,'TRY',true,null,0),
  ('d1930000-0000-4000-8000-000000000003','d1910000-0000-4000-8000-000000000001','Race Release',60,0,0,'Race',30,14000,'fixed',14000,14000,'TRY',true,'RELEASE',30);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('d1940000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','Race Ada',true),
  ('d1940000-0000-4000-8000-000000000002','d1910000-0000-4000-8000-000000000001','Race Bora',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000001',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000003',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000002','d1930000-0000-4000-8000-000000000002',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd1910000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '20:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd1910000-0000-4000-8000-000000000001'::uuid,'d1940000-0000-4000-8000-000000000001'::uuid,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true
union all
select 'd1910000-0000-4000-8000-000000000001'::uuid,'d1940000-0000-4000-8000-000000000002'::uuid,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true;

-- Seed three native groups used by reschedule/line/RELEASE assertions.
set role authenticated;
select set_config('request.jwt.claim.sub','d1900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_a jsonb;
  v_b jsonb;
  v_release jsonb;
begin
  v_a:=public.create_appointment_group(
    'd1910000-0000-4000-8000-000000000001','f1104-race-seed-group-a','Race Group A',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul','05553000001'
  );
  perform set_config('f1104.race_group_a',v_a->>'groupId',false);
  perform set_config('f1104.race_group_a_line',v_a#>>'{lines,0,appointmentId}',false);

  v_b:=public.create_appointment_group(
    'd1910000-0000-4000-8000-000000000001','f1104-race-seed-group-b','Race Group B',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"},{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '12:00') at time zone 'Europe/Istanbul','05553000002'
  );
  perform set_config('f1104.race_group_b',v_b->>'groupId',false);
  perform set_config('f1104.race_group_b_line2',v_b#>>'{lines,1,appointmentId}',false);

  v_release:=public.create_appointment_group(
    'd1910000-0000-4000-8000-000000000001','f1104-race-seed-release','Race Release Group',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000003","staffId":"d1940000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '14:00') at time zone 'Europe/Istanbul','05553000003'
  );
  perform set_config('f1104.race_release_group',v_release->>'groupId',false);
end
$$;
reset role;

-- Whole-group RELEASE must retain full customer-interval authority, matching the
-- already accepted line-local repair. Both failures leave version/command/time
-- untouched.
insert into public.availability_blocks(id,business_id,staff_id,starts_at,ends_at,reason,active)
values (
  'd1950000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001',null,
  ((date_trunc('week',current_date)::date+7)+time '18:30') at time zone 'Europe/Istanbul',
  ((date_trunc('week',current_date)::date+7)+time '19:00') at time zone 'Europe/Istanbul',
  'f1104 release tail tenant block',true
);

set role authenticated;
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001';
  v_group uuid:=current_setting('f1104.race_release_group')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_version integer;
  v_start timestamptz;
  v_raised boolean;
begin
  select g.version,a.starts_at into v_version,v_start
  from public.appointment_groups g
  join public.appointments a on a.group_id=g.id and a.line_ordinal=1
  where g.id=v_group;

  v_raised:=false;
  begin
    perform public.reschedule_appointment_group(v_business,v_group,'f1104-release-group-close',v_version,
      (v_day+time '19:30') at time zone 'Europe/Istanbul');
  exception when others then
    if sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' and sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if;
    v_raised:=true;
  end;
  if not v_raised then raise exception 'F11-04 whole-group RELEASE crossed business close'; end if;
  if (select version from public.appointment_groups where id=v_group)<>v_version
     or (select starts_at from public.appointments where group_id=v_group and line_ordinal=1)<>v_start
     or exists(select 1 from public.booking_commands where business_id=v_business and idempotency_key='f1104-release-group-close') then
    raise exception 'F11-04 past-close group rejection left durable movement';
  end if;

  v_raised:=false;
  begin
    perform public.reschedule_appointment_group(v_business,v_group,'f1104-release-group-tenant',v_version,
      (v_day+time '18:00') at time zone 'Europe/Istanbul');
  exception when others then
    if sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' and sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if;
    v_raised:=true;
  end;
  if not v_raised then raise exception 'F11-04 whole-group RELEASE ignored tenant block in passive tail'; end if;
  if (select version from public.appointment_groups where id=v_group)<>v_version
     or (select starts_at from public.appointments where group_id=v_group and line_ordinal=1)<>v_start
     or exists(select 1 from public.booking_commands where business_id=v_business and idempotency_key='f1104-release-group-tenant') then
    raise exception 'F11-04 tenant-tail group rejection left durable movement';
  end if;
end
$$;
reset role;
delete from public.availability_blocks where id='d1950000-0000-4000-8000-000000000001';

-- Helper convention used by the races: coordinator holds the exact F10-04 lock,
-- launches a real autocommit booking writer, proves it reaches that lock, then
-- commits the guarded authority mutation. The booking must observe the committed
-- authority when its deferred guard resumes.

-- 1) Fresh create vs business-hours replacement.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001';
  v_owner uuid:='d1900000-0000-4000-8000-000000000001';
  v_day date:=date_trunc('week',current_date)::date+7;
  v_weekday smallint:=extract(dow from v_day)::smallint;
  v_lock bigint:=hashtextextended('f10-04:business-hours:'||v_business::text||':'||v_weekday::text,0);
  v_sql text;
  v_blocked boolean:=false;
begin
  perform dblink_connect('f1104_create_hours','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_create_hours');
  perform dblink_exec('f1104_create_hours','set role authenticated');
  perform dblink_exec('f1104_create_hours','set "request.jwt.claim.sub" = '''||v_owner::text||'''');
  perform dblink_exec('f1104_create_hours',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_lock);
  v_sql:=format($q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,
    v_business,'f1104-race-create-hours','Race Create Hours',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"}]',
    (v_day+time '18:00') at time zone 'Europe/Istanbul','05553000101');
  if dblink_send_query('f1104_create_hours',v_sql)<>1 then raise exception 'F11-04 create/hours writer did not start'; end if;
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='f1104_create_hours' and wait_event_type='Lock') then v_blocked:=true; exit; end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_blocked then raise exception 'F11-04 create writer never reached business-hours authority lock'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform * from public.replace_business_hours_guarded(v_business,v_weekday,'[{"start":"09:00","end":"17:00"}]'::jsonb,null);
  execute 'reset role';
  perform pg_advisory_unlock(v_lock);
end
$$;

do $$
declare v_result jsonb; v_failed boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_create_hours')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_create_hours') as t(result jsonb);
  exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_create_hours',false) as t(result jsonb); exception when others then null; end;
  perform dblink_disconnect('f1104_create_hours');
  if not v_failed then raise exception 'F11-04 create survived losing business-hours race'; end if;
  if exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-create-hours') then
    raise exception 'F11-04 failed create/hours race retained command';
  end if;
end $$;

-- Restore hours for later scenarios.
set role authenticated;
select count(*) from public.replace_business_hours_guarded(
  'd1910000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  '[{"start":"09:00","end":"20:00"}]'::jsonb,null
);
reset role;

-- 2) Whole-group reschedule vs staff-hours replacement.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001';
  v_owner uuid:='d1900000-0000-4000-8000-000000000001';
  v_staff uuid:='d1940000-0000-4000-8000-000000000001';
  v_group uuid:=current_setting('f1104.race_group_a')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7;
  v_weekday smallint:=extract(dow from v_day)::smallint;
  v_version integer;
  v_lock bigint:=hashtextextended('f10-04:staff-hours:'||v_business::text||':'||v_staff::text||':'||v_weekday::text,0);
  v_sql text; v_blocked boolean:=false;
begin
  select version into v_version from public.appointment_groups where id=v_group;
  perform set_config('f1104.race_group_a_version',v_version::text,false);
  perform dblink_connect('f1104_group_staff_hours','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_group_staff_hours');
  perform dblink_exec('f1104_group_staff_hours','set role authenticated');
  perform dblink_exec('f1104_group_staff_hours','set "request.jwt.claim.sub" = '''||v_owner::text||'''');
  perform dblink_exec('f1104_group_staff_hours',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_lock);
  v_sql:=format($q$select public.reschedule_appointment_group(%L::uuid,%L::uuid,%L,%s,%L::timestamptz)$q$,
    v_business,v_group,'f1104-race-group-staff-hours',v_version,(v_day+time '18:00') at time zone 'Europe/Istanbul');
  perform dblink_send_query('f1104_group_staff_hours',v_sql);
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='f1104_group_staff_hours' and wait_event_type='Lock') then v_blocked:=true; exit; end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_blocked then raise exception 'F11-04 group writer never reached staff-hours authority lock'; end if;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform * from public.replace_staff_hours_guarded(v_business,v_staff,v_weekday,'[{"start":"09:00","end":"17:00"}]'::jsonb,null);
  execute 'reset role';
  perform pg_advisory_unlock(v_lock);
end $$;

do $$
declare v_result jsonb; v_failed boolean:=false; v_group uuid:=current_setting('f1104.race_group_a')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_group_staff_hours')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_group_staff_hours') as t(result jsonb);
  exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_group_staff_hours',false) as t(result jsonb); exception when others then null; end;
  perform dblink_disconnect('f1104_group_staff_hours');
  if not v_failed then raise exception 'F11-04 group reschedule survived losing staff-hours race'; end if;
  if (select version from public.appointment_groups where id=v_group)<>current_setting('f1104.race_group_a_version')::integer
     or (select starts_at from public.appointments where group_id=v_group and line_ordinal=1)
        <>((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul'
     or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-group-staff-hours') then
    raise exception 'F11-04 failed group/staff-hours race left durable movement';
  end if;
end $$;

set role authenticated;
select count(*) from public.replace_staff_hours_guarded(
  'd1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  '[{"start":"09:00","end":"20:00"}]'::jsonb,null
);
reset role;

-- 3) Whole-group reschedule vs tenant-wide block creation.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001'; v_owner uuid:='d1900000-0000-4000-8000-000000000001';
  v_group uuid:=current_setting('f1104.race_group_a')::uuid; v_day date:=date_trunc('week',current_date)::date+7;
  v_version integer; v_lock bigint:=hashtextextended('f10-04:availability-blocks:'||v_business::text,0); v_sql text; v_blocked boolean:=false;
begin
  select version into v_version from public.appointment_groups where id=v_group;
  perform dblink_connect('f1104_group_tenant_block','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_group_tenant_block');
  perform dblink_exec('f1104_group_tenant_block','set role authenticated');
  perform dblink_exec('f1104_group_tenant_block','set "request.jwt.claim.sub" = '''||v_owner::text||'''');
  perform dblink_exec('f1104_group_tenant_block',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_lock);
  v_sql:=format($q$select public.reschedule_appointment_group(%L::uuid,%L::uuid,%L,%s,%L::timestamptz)$q$,
    v_business,v_group,'f1104-race-group-tenant-block',v_version,(v_day+time '16:00') at time zone 'Europe/Istanbul');
  perform dblink_send_query('f1104_group_tenant_block',v_sql);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_group_tenant_block' and wait_event_type='Lock') then v_blocked:=true; exit; end if; perform pg_sleep(0.01); end loop;
  if not v_blocked then raise exception 'F11-04 group writer never reached availability-block authority lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_owner::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform public.create_availability_block_local_guarded(v_business,null,v_day,time '16:10',time '16:20','f1104 tenant race');
  execute 'reset role'; perform pg_advisory_unlock(v_lock);
end $$;

do $$
declare v_result jsonb; v_failed boolean:=false; v_group uuid:=current_setting('f1104.race_group_a')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_group_tenant_block')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_group_tenant_block') as t(result jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_group_tenant_block',false) as t(result jsonb); exception when others then null; end; perform dblink_disconnect('f1104_group_tenant_block');
  if not v_failed then raise exception 'F11-04 group reschedule survived tenant-block race'; end if;
  if exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-group-tenant-block') then raise exception 'F11-04 failed tenant-block race retained command'; end if;
end $$;
delete from public.availability_blocks where business_id='d1910000-0000-4000-8000-000000000001' and reason='f1104 tenant race';

-- 4) Line-local reschedule vs staff-specific block creation.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001'; v_owner uuid:='d1900000-0000-4000-8000-000000000001';
  v_group uuid:=current_setting('f1104.race_group_b')::uuid; v_line uuid:=current_setting('f1104.race_group_b_line2')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7; v_version integer;
  v_lock bigint:=hashtextextended('f10-04:availability-blocks:'||v_business::text,0); v_sql text; v_blocked boolean:=false;
begin
  select version into v_version from public.appointment_groups where id=v_group; perform set_config('f1104.race_group_b_version',v_version::text,false);
  perform dblink_connect('f1104_line_staff_block','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_line_staff_block');
  perform dblink_exec('f1104_line_staff_block','set role authenticated'); perform dblink_exec('f1104_line_staff_block','set "request.jwt.claim.sub" = '''||v_owner::text||''''); perform dblink_exec('f1104_line_staff_block',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_lock);
  v_sql:=format($q$select public.reschedule_appointment_group_line(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz)$q$,
    v_business,v_group,v_line,'f1104-race-line-staff-block',v_version,'d1940000-0000-4000-8000-000000000002',(v_day+time '16:00') at time zone 'Europe/Istanbul');
  perform dblink_send_query('f1104_line_staff_block',v_sql);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_line_staff_block' and wait_event_type='Lock') then v_blocked:=true; exit; end if; perform pg_sleep(0.01); end loop;
  if not v_blocked then raise exception 'F11-04 line writer never reached availability-block authority lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_owner::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform public.create_availability_block_local_guarded(v_business,'d1940000-0000-4000-8000-000000000002',v_day,time '16:00',time '16:30','f1104 staff race');
  execute 'reset role'; perform pg_advisory_unlock(v_lock);
end $$;

do $$
declare v_result jsonb; v_failed boolean:=false; v_group uuid:=current_setting('f1104.race_group_b')::uuid; v_line uuid:=current_setting('f1104.race_group_b_line2')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_line_staff_block')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_line_staff_block') as t(result jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_line_staff_block',false) as t(result jsonb); exception when others then null; end; perform dblink_disconnect('f1104_line_staff_block');
  if not v_failed then raise exception 'F11-04 line reschedule survived staff-block race'; end if;
  if (select version from public.appointment_groups where id=v_group)<>current_setting('f1104.race_group_b_version')::integer
     or (select starts_at from public.appointments where id=v_line)<>((date_trunc('week',current_date)::date+7)+time '12:30') at time zone 'Europe/Istanbul'
     or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-line-staff-block') then
    raise exception 'F11-04 failed line/staff-block race left durable movement';
  end if;
end $$;
delete from public.availability_blocks where business_id='d1910000-0000-4000-8000-000000000001' and reason='f1104 staff race';

-- 5) Line-local reschedule vs assignment removal.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001'; v_owner uuid:='d1900000-0000-4000-8000-000000000001';
  v_group uuid:=current_setting('f1104.race_group_b')::uuid; v_line uuid:=current_setting('f1104.race_group_b_line2')::uuid;
  v_day date:=date_trunc('week',current_date)::date+7; v_version integer;
  v_lock bigint:=hashtextextended('f10-04:assignments:'||v_business::text,0); v_sql text; v_blocked boolean:=false;
begin
  select version into v_version from public.appointment_groups where id=v_group;
  perform dblink_connect('f1104_line_assignment','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_line_assignment');
  perform dblink_exec('f1104_line_assignment','set role authenticated'); perform dblink_exec('f1104_line_assignment','set "request.jwt.claim.sub" = '''||v_owner::text||''''); perform dblink_exec('f1104_line_assignment',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_lock);
  v_sql:=format($q$select public.reschedule_appointment_group_line(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz)$q$,
    v_business,v_group,v_line,'f1104-race-line-assignment',v_version,'d1940000-0000-4000-8000-000000000002',(v_day+time '17:00') at time zone 'Europe/Istanbul');
  perform dblink_send_query('f1104_line_assignment',v_sql);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_line_assignment' and wait_event_type='Lock') then v_blocked:=true; exit; end if; perform pg_sleep(0.01); end loop;
  if not v_blocked then raise exception 'F11-04 line writer never reached assignment authority lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_owner::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform public.set_staff_service_guarded(v_business,'d1940000-0000-4000-8000-000000000002','d1930000-0000-4000-8000-000000000002',false,null);
  execute 'reset role'; perform pg_advisory_unlock(v_lock);
end $$;

do $$
declare v_result jsonb; v_failed boolean:=false; v_group uuid:=current_setting('f1104.race_group_b')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_line_assignment')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_line_assignment') as t(result jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_line_assignment',false) as t(result jsonb); exception when others then null; end; perform dblink_disconnect('f1104_line_assignment');
  if not v_failed then raise exception 'F11-04 line reschedule survived assignment-removal race'; end if;
  if (select version from public.appointment_groups where id=v_group)<>current_setting('f1104.race_group_b_version')::integer
     or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-line-assignment') then
    raise exception 'F11-04 failed assignment race left durable movement';
  end if;
end $$;

-- Restore assignment before catalog-row races.
set role authenticated;
select public.set_staff_service_guarded(
  'd1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000002',
  'd1930000-0000-4000-8000-000000000002',true,null
);
reset role;

-- 6) Fresh create vs service deactivation. The mutation transaction holds the
-- exact service row; the booking plans against the old committed catalog, then
-- waits at the DB-final service FOR UPDATE and must see inactive after commit.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001'; v_owner uuid:='d1900000-0000-4000-8000-000000000001'; v_day date:=date_trunc('week',current_date)::date+7;
  v_result uuid; v_sql text; v_blocked boolean:=false;
begin
  perform dblink_connect('f1104_service_mut','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_service_mut');
  perform dblink_connect('f1104_service_book','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_service_book');
  for v_conn in select unnest(array['f1104_service_mut','f1104_service_book']) loop
    perform dblink_exec(v_conn,'set role authenticated'); perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_owner::text||''''); perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;
  perform dblink_exec('f1104_service_mut','begin');
  select t.id into strict v_result from dblink('f1104_service_mut',format($q$select (public.update_service_guarded(%L::uuid,%L::uuid,null,%L::jsonb)).id$q$,v_business,'d1930000-0000-4000-8000-000000000002','{"active":false}')) as t(id uuid);
  v_sql:=format($q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,v_business,'f1104-race-service-off','Race Service Off','[{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]',(v_day+time '15:00') at time zone 'Europe/Istanbul','05553000106');
  perform dblink_send_query('f1104_service_book',v_sql);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_service_book' and wait_event_type='Lock') then v_blocked:=true; exit; end if; perform pg_sleep(0.01); end loop;
  if not v_blocked then raise exception 'F11-04 create writer never reached service row authority lock'; end if;
  perform dblink_exec('f1104_service_mut','commit'); perform dblink_disconnect('f1104_service_mut');
end $$;

do $$
declare v_result jsonb; v_failed boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_service_book')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_service_book') as t(result jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_service_book',false) as t(result jsonb); exception when others then null; end; perform dblink_disconnect('f1104_service_book');
  if not v_failed then raise exception 'F11-04 create survived service-deactivation race'; end if;
  if exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-service-off') then raise exception 'F11-04 failed service race retained command'; end if;
end $$;

set role authenticated;
select (public.update_service_guarded('d1910000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000002',null,'{"active":true}'::jsonb)).id;
reset role;

-- 7) Fresh create vs staff deactivation, same row-lock proof for staff authority.
do $$
declare
  v_business uuid:='d1910000-0000-4000-8000-000000000001'; v_owner uuid:='d1900000-0000-4000-8000-000000000001'; v_day date:=date_trunc('week',current_date)::date+7;
  v_result uuid; v_sql text; v_blocked boolean:=false; v_conn text;
begin
  perform dblink_connect('f1104_staff_mut','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_mut');
  perform dblink_connect('f1104_staff_book','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_book');
  for v_conn in select unnest(array['f1104_staff_mut','f1104_staff_book']) loop
    perform dblink_exec(v_conn,'set role authenticated'); perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_owner::text||''''); perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;
  perform dblink_exec('f1104_staff_mut','begin');
  select t.id into strict v_result from dblink('f1104_staff_mut',format($q$select (public.update_staff_guarded(%L::uuid,%L::uuid,null,%L::jsonb)).id$q$,v_business,'d1940000-0000-4000-8000-000000000002','{"active":false}')) as t(id uuid);
  v_sql:=format($q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,v_business,'f1104-race-staff-off','Race Staff Off','[{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]',(v_day+time '15:30') at time zone 'Europe/Istanbul','05553000107');
  perform dblink_send_query('f1104_staff_book',v_sql);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_staff_book' and wait_event_type='Lock') then v_blocked:=true; exit; end if; perform pg_sleep(0.01); end loop;
  if not v_blocked then raise exception 'F11-04 create writer never reached staff row authority lock'; end if;
  perform dblink_exec('f1104_staff_mut','commit'); perform dblink_disconnect('f1104_staff_mut');
end $$;

do $$
declare v_result jsonb; v_failed boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_staff_book')=0; perform pg_sleep(0.01); end loop;
  begin select t.result into strict v_result from dblink_get_result('f1104_staff_book') as t(result jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if; v_failed:=true; end;
  begin perform * from dblink_get_result('f1104_staff_book',false) as t(result jsonb); exception when others then null; end; perform dblink_disconnect('f1104_staff_book');
  if not v_failed then raise exception 'F11-04 create survived staff-deactivation race'; end if;
  if exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-staff-off') then raise exception 'F11-04 failed staff race retained command'; end if;
end $$;

raise notice 'F11-04 schedule authority race acceptance passed: business/staff hours, tenant/staff blocks, assignment, service and staff mutations';

delete from public.businesses where id='d1910000-0000-4000-8000-000000000001';
