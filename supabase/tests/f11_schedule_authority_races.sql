create extension if not exists dblink;

-- F11-04 D hard proof. Booking writers start against valid authority. A real
-- concurrent F10-04 mutation commits before the booking durability boundary.
-- The booking must then fail closed with no command/group/version half-state.

delete from public.businesses where id='d1910000-0000-4000-8000-000000000001';
insert into auth.users(id,email,raw_user_meta_data)
values ('d1900000-0000-4000-8000-000000000001','f1104-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;
insert into public.businesses(id,name,slug,timezone,created_by)
values ('d1910000-0000-4000-8000-000000000001','F11-04 Authority Race','f1104-authority-race','Europe/Istanbul','d1900000-0000-4000-8000-000000000001');
insert into public.memberships(id,business_id,user_id,role,active)
values ('d1920000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000001','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active,
  processing_capacity_policy,passive_wait_minutes
) values
  ('d1930000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','Race A',30,0,0,'Race',10,10000,'fixed',10000,10000,'TRY',true,null,0),
  ('d1930000-0000-4000-8000-000000000002','d1910000-0000-4000-8000-000000000001','Race B',30,0,0,'Race',20,12000,'fixed',12000,12000,'TRY',true,null,0),
  ('d1930000-0000-4000-8000-000000000003','d1910000-0000-4000-8000-000000000001','Race Release',60,0,0,'Race',30,14000,'fixed',14000,14000,'TRY',true,'RELEASE',30),
  ('d1930000-0000-4000-8000-000000000004','d1910000-0000-4000-8000-000000000001','Race Shared Target',30,0,0,'Race',40,10000,'fixed',10000,10000,'TRY',true,null,0);
insert into public.staff_profiles(id,business_id,name,active)
values
  ('d1940000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','Race Ada',true),
  ('d1940000-0000-4000-8000-000000000002','d1910000-0000-4000-8000-000000000001','Race Bora',true),
  ('d1940000-0000-4000-8000-000000000003','d1910000-0000-4000-8000-000000000001','Race Ceren',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000001',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000003',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000004',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000002','d1930000-0000-4000-8000-000000000002',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000003','d1930000-0000-4000-8000-000000000004',true);
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd1910000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd1910000-0000-4000-8000-000000000001'::uuid,'d1940000-0000-4000-8000-000000000001'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true
union all
select 'd1910000-0000-4000-8000-000000000001'::uuid,'d1940000-0000-4000-8000-000000000002'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true
union all
select 'd1910000-0000-4000-8000-000000000001'::uuid,'d1940000-0000-4000-8000-000000000003'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '20:00',true;

set role authenticated;
select set_config('request.jwt.claim.sub','d1900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);
do $$
declare v_day date:=date_trunc('week',current_date)::date+7; v_a jsonb; v_b jsonb; v_r jsonb;
begin
  v_a:=public.create_appointment_group('d1910000-0000-4000-8000-000000000001','f1104-race-seed-a','Race Group A',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '10:00') at time zone 'Europe/Istanbul','05553000001');
  v_b:=public.create_appointment_group('d1910000-0000-4000-8000-000000000001','f1104-race-seed-b','Race Group B',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"},{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '12:00') at time zone 'Europe/Istanbul','05553000002');
  v_r:=public.create_appointment_group('d1910000-0000-4000-8000-000000000001','f1104-race-seed-r','Race Release',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000003","staffId":"d1940000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '14:00') at time zone 'Europe/Istanbul','05553000003');
  perform set_config('f1104.ga',v_a->>'groupId',false);
  perform set_config('f1104.gb',v_b->>'groupId',false);
  perform set_config('f1104.gb2',v_b#>>'{lines,1,appointmentId}',false);
  perform set_config('f1104.gr',v_r->>'groupId',false);
end $$;
reset role;

-- Whole-group RELEASE keeps the full customer interval authoritative.
insert into public.availability_blocks(id,business_id,staff_id,starts_at,ends_at,reason,active)
values ('d1950000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001',null,
  ((date_trunc('week',current_date)::date+7)+time '18:30') at time zone 'Europe/Istanbul',
  ((date_trunc('week',current_date)::date+7)+time '19:00') at time zone 'Europe/Istanbul','f1104 release tail',true);
do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_g uuid:=current_setting('f1104.gr')::uuid; v_d date:=date_trunc('week',current_date)::date+7; v_v integer; v_s timestamptz; v_bad boolean;
begin
  select g.version,a.starts_at into v_v,v_s from public.appointment_groups g join public.appointments a on a.group_id=g.id and a.line_ordinal=1 where g.id=v_g;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub','d1900000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  foreach v_bad in array array[false,true] loop
    begin
      perform public.reschedule_appointment_group(v_b,v_g,case when v_bad then 'f1104-release-tail' else 'f1104-release-close' end,v_v,
        (v_d+case when v_bad then time '18:00' else time '19:30' end) at time zone 'Europe/Istanbul');
      raise exception 'F11-04 whole-group RELEASE authority accepted invalid move';
    exception when others then
      if sqlerrm='F11-04 whole-group RELEASE authority accepted invalid move' then raise; end if;
      if sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' and sqlerrm not like '%SLOT_UNAVAILABLE%' then raise; end if;
    end;
  end loop;
  execute 'reset role';
  if (select version from public.appointment_groups where id=v_g)<>v_v
     or (select starts_at from public.appointments where group_id=v_g and line_ordinal=1)<>v_s then
    raise exception 'F11-04 rejected RELEASE group move changed durable state';
  end if;
end $$;
delete from public.availability_blocks where id='d1950000-0000-4000-8000-000000000001';

-- Create vs business-hours mutation.
do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_d date:=date_trunc('week',current_date)::date+7; v_w smallint:=extract(dow from v_d)::smallint; v_l bigint; v_q text; v_wait boolean:=false;
begin
  v_l:=hashtextextended('f10-04:business-hours:'||v_b::text||':'||v_w::text,0);
  perform dblink_connect('f1104_hours','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_hours');
  perform dblink_exec('f1104_hours','set role authenticated'); perform dblink_exec('f1104_hours','set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec('f1104_hours',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_l);
  v_q:=format($q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,v_b,'f1104-race-hours','Race Hours','[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"}]',(v_d+time '18:00') at time zone 'Europe/Istanbul','05553000101');
  perform dblink_send_query('f1104_hours',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_hours' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop;
  if not v_wait then raise exception 'F11-04 create did not reach business-hours lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_u::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform * from public.replace_business_hours_guarded(v_b,v_w,'[{"start":"09:00","end":"17:00"}]'::jsonb,'[{"start":"09:00","end":"20:00"}]'::jsonb); execute 'reset role'; perform pg_advisory_unlock(v_l);
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_hours')=0; perform pg_sleep(.01); end loop;
  begin select x.r into strict v_r from dblink_get_result('f1104_hours') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if; v_fail:=true; end;
  begin perform * from dblink_get_result('f1104_hours',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_hours');
  if not v_fail or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-hours') then raise exception 'F11-04 business-hours race failed closed incorrectly'; end if;
end $$;
set role authenticated;
select count(*) from public.replace_business_hours_guarded('d1910000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,'[{"start":"09:00","end":"20:00"}]'::jsonb,'[{"start":"09:00","end":"17:00"}]'::jsonb);
reset role;

-- Group reschedule vs staff-hours mutation.
do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_s uuid:='d1940000-0000-4000-8000-000000000001'; v_g uuid:=current_setting('f1104.ga')::uuid; v_d date:=date_trunc('week',current_date)::date+7; v_w smallint:=extract(dow from v_d)::smallint; v_v integer; v_l bigint; v_q text; v_wait boolean:=false;
begin
  select version into v_v from public.appointment_groups where id=v_g; perform set_config('f1104.gav',v_v::text,false);
  v_l:=hashtextextended('f10-04:staff-hours:'||v_b::text||':'||v_s::text||':'||v_w::text,0);
  perform dblink_connect('f1104_staff_hours','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_hours');
  perform dblink_exec('f1104_staff_hours','set role authenticated'); perform dblink_exec('f1104_staff_hours','set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec('f1104_staff_hours',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_l); v_q:=format($q$select public.reschedule_appointment_group(%L::uuid,%L::uuid,%L,%s,%L::timestamptz)$q$,v_b,v_g,'f1104-race-staff-hours',v_v,(v_d+time '18:00') at time zone 'Europe/Istanbul'); perform dblink_send_query('f1104_staff_hours',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_staff_hours' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop;
  if not v_wait then raise exception 'F11-04 reschedule did not reach staff-hours lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_u::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true); perform * from public.replace_staff_hours_guarded(v_b,v_s,v_w,'[{"start":"09:00","end":"17:00"}]'::jsonb,'[{"start":"09:00","end":"20:00"}]'::jsonb); execute 'reset role'; perform pg_advisory_unlock(v_l);
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; v_g uuid:=current_setting('f1104.ga')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_staff_hours')=0; perform pg_sleep(.01); end loop;
  begin select x.r into strict v_r from dblink_get_result('f1104_staff_hours') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if; v_fail:=true; end;
  begin perform * from dblink_get_result('f1104_staff_hours',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_staff_hours');
  if not v_fail or (select version from public.appointment_groups where id=v_g)<>current_setting('f1104.gav')::integer or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-staff-hours') then raise exception 'F11-04 staff-hours race left durable movement'; end if;
end $$;
set role authenticated;
select count(*) from public.replace_staff_hours_guarded('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,'[{"start":"09:00","end":"20:00"}]'::jsonb,'[{"start":"09:00","end":"17:00"}]'::jsonb);
reset role;

-- Fresh create vs staff-hours mutation. The booking must reach the staff-hours
-- advisory before its strong participating-staff row lock; otherwise the
-- guarded replace and the deferred booking fence form a row/advisory deadlock.
do $$
declare
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_u uuid:='d1900000-0000-4000-8000-000000000001';
  v_s uuid:='d1940000-0000-4000-8000-000000000001';
  v_d date:=date_trunc('week',current_date)::date+7;
  v_w smallint:=extract(dow from v_d)::smallint;
  v_l bigint:=hashtextextended('f10-04:staff-hours:'||v_b::text||':'||v_s::text||':'||extract(dow from v_d)::smallint::text,0);
  v_q text; v_wait boolean:=false;
begin
  perform set_config('f1104.csh.groups',(select count(*)::text from public.appointment_groups where business_id=v_b),false);
  perform set_config('f1104.csh.lines',(select count(*)::text from public.appointments where business_id=v_b),false);
  perform set_config('f1104.csh.events',(select count(*)::text from public.appointment_events where business_id=v_b),false);
  perform set_config('f1104.csh.jobs',(select count(*)::text from public.appointment_notification_jobs where business_id=v_b),false);
  perform set_config('f1104.csh.commands',(select count(*)::text from public.booking_commands where business_id=v_b),false);

  perform dblink_connect('f1104_create_staff_hours','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_create_staff_hours');
  perform dblink_exec('f1104_create_staff_hours','set role authenticated');
  perform dblink_exec('f1104_create_staff_hours','set "request.jwt.claim.sub" = '''||v_u::text||'''');
  perform dblink_exec('f1104_create_staff_hours',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  perform pg_advisory_lock(v_l);
  v_q:=format(
    $q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,
    v_b,'f1104-race-create-staff-hours','Race Create Staff Hours',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"}]',
    (v_d+time '18:00') at time zone 'Europe/Istanbul','05553000108'
  );
  perform dblink_send_query('f1104_create_staff_hours',v_q);
  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='f1104_create_staff_hours' and wait_event_type='Lock') then
      v_wait:=true; exit;
    end if;
    perform pg_sleep(.01);
  end loop;
  if not v_wait then raise exception 'F11-04 create did not reach staff-hours advisory before staff row lock'; end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',v_u::text,true);
  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  perform * from public.replace_staff_hours_guarded(
    v_b,v_s,v_w,
    '[{"start":"09:00","end":"17:00"}]'::jsonb,
    '[{"start":"09:00","end":"20:00"}]'::jsonb
  );
  execute 'reset role';
  perform pg_advisory_unlock(v_l);
end $$;

do $$
declare v_r jsonb; v_fail boolean:=false; v_b uuid:='d1910000-0000-4000-8000-000000000001';
begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_create_staff_hours')=0; perform pg_sleep(.01); end loop;
  begin
    select x.r into strict v_r from dblink_get_result('f1104_create_staff_hours') x(r jsonb);
  exception when others then
    if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if;
    v_fail:=true;
  end;
  begin perform * from dblink_get_result('f1104_create_staff_hours',false) x(r jsonb); exception when others then null; end;
  perform dblink_disconnect('f1104_create_staff_hours');

  if not v_fail
     or exists(select 1 from public.booking_commands where business_id=v_b and idempotency_key='f1104-race-create-staff-hours')
     or (select count(*) from public.appointment_groups where business_id=v_b)<>current_setting('f1104.csh.groups')::bigint
     or (select count(*) from public.appointments where business_id=v_b)<>current_setting('f1104.csh.lines')::bigint
     or (select count(*) from public.appointment_events where business_id=v_b)<>current_setting('f1104.csh.events')::bigint
     or (select count(*) from public.appointment_notification_jobs where business_id=v_b)<>current_setting('f1104.csh.jobs')::bigint
     or (select count(*) from public.booking_commands where business_id=v_b)<>current_setting('f1104.csh.commands')::bigint then
    raise exception 'F11-04 create/staff-hours race left durable half-state';
  end if;
end $$;

set role authenticated;
select count(*) from public.replace_staff_hours_guarded(
  'd1910000-0000-4000-8000-000000000001',
  'd1940000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  '[{"start":"09:00","end":"20:00"}]'::jsonb,
  '[{"start":"09:00","end":"17:00"}]'::jsonb
);
reset role;

-- Group reschedule vs tenant-wide block; line reschedule vs staff-specific block.
do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_g uuid:=current_setting('f1104.ga')::uuid; v_d date:=date_trunc('week',current_date)::date+7; v_v integer; v_l bigint:=hashtextextended('f10-04:availability-blocks:'||'d1910000-0000-4000-8000-000000000001',0); v_q text; v_wait boolean:=false;
begin
  select version into v_v from public.appointment_groups where id=v_g;
  perform dblink_connect('f1104_tenant_block','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_tenant_block'); perform dblink_exec('f1104_tenant_block','set role authenticated'); perform dblink_exec('f1104_tenant_block','set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec('f1104_tenant_block',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_l); v_q:=format($q$select public.reschedule_appointment_group(%L::uuid,%L::uuid,%L,%s,%L::timestamptz)$q$,v_b,v_g,'f1104-race-tenant-block',v_v,(v_d+time '16:00') at time zone 'Europe/Istanbul'); perform dblink_send_query('f1104_tenant_block',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_tenant_block' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop; if not v_wait then raise exception 'F11-04 group did not reach block lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_u::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true); perform public.create_availability_block_local_guarded(v_b,null,v_d,time '16:10',time '16:20','f1104 tenant race'); execute 'reset role'; perform pg_advisory_unlock(v_l);
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_tenant_block')=0; perform pg_sleep(.01); end loop; begin select x.r into strict v_r from dblink_get_result('f1104_tenant_block') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if; v_fail:=true; end; begin perform * from dblink_get_result('f1104_tenant_block',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_tenant_block'); if not v_fail then raise exception 'F11-04 tenant-block race was accepted'; end if;
end $$;
delete from public.availability_blocks where business_id='d1910000-0000-4000-8000-000000000001' and reason='f1104 tenant race';

do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_g uuid:=current_setting('f1104.gb')::uuid; v_line uuid:=current_setting('f1104.gb2')::uuid; v_d date:=date_trunc('week',current_date)::date+7; v_v integer; v_l bigint:=hashtextextended('f10-04:availability-blocks:'||'d1910000-0000-4000-8000-000000000001',0); v_q text; v_wait boolean:=false;
begin
  select version into v_v from public.appointment_groups where id=v_g; perform set_config('f1104.gbv',v_v::text,false);
  perform dblink_connect('f1104_staff_block','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_block'); perform dblink_exec('f1104_staff_block','set role authenticated'); perform dblink_exec('f1104_staff_block','set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec('f1104_staff_block',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_l); v_q:=format($q$select public.reschedule_appointment_group_line(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz)$q$,v_b,v_g,v_line,'f1104-race-staff-block',v_v,'d1940000-0000-4000-8000-000000000002',(v_d+time '16:00') at time zone 'Europe/Istanbul'); perform dblink_send_query('f1104_staff_block',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_staff_block' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop; if not v_wait then raise exception 'F11-04 line did not reach block lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_u::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true); perform public.create_availability_block_local_guarded(v_b,'d1940000-0000-4000-8000-000000000002',v_d,time '16:00',time '16:30','f1104 staff race'); execute 'reset role'; perform pg_advisory_unlock(v_l);
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; v_g uuid:=current_setting('f1104.gb')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_staff_block')=0; perform pg_sleep(.01); end loop; begin select x.r into strict v_r from dblink_get_result('f1104_staff_block') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if; v_fail:=true; end; begin perform * from dblink_get_result('f1104_staff_block',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_staff_block'); if not v_fail or (select version from public.appointment_groups where id=v_g)<>current_setting('f1104.gbv')::integer then raise exception 'F11-04 staff-block race left durable movement'; end if;
end $$;
delete from public.availability_blocks where business_id='d1910000-0000-4000-8000-000000000001' and reason='f1104 staff race';

-- Line reschedule vs assignment removal.
do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_g uuid:=current_setting('f1104.gb')::uuid; v_line uuid:=current_setting('f1104.gb2')::uuid; v_d date:=date_trunc('week',current_date)::date+7; v_v integer; v_l bigint:=hashtextextended('f10-04:assignments:'||'d1910000-0000-4000-8000-000000000001',0); v_q text; v_wait boolean:=false; v_expected timestamptz;
begin
  select version into v_v from public.appointment_groups where id=v_g;
  select updated_at into v_expected from public.staff_services where business_id=v_b and staff_id='d1940000-0000-4000-8000-000000000002' and service_id='d1930000-0000-4000-8000-000000000002';
  perform dblink_connect('f1104_assignment','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_assignment'); perform dblink_exec('f1104_assignment','set role authenticated'); perform dblink_exec('f1104_assignment','set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec('f1104_assignment',$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform pg_advisory_lock(v_l); v_q:=format($q$select public.reschedule_appointment_group_line(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz)$q$,v_b,v_g,v_line,'f1104-race-assignment',v_v,'d1940000-0000-4000-8000-000000000002',(v_d+time '17:00') at time zone 'Europe/Istanbul'); perform dblink_send_query('f1104_assignment',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_assignment' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop; if not v_wait then raise exception 'F11-04 line did not reach assignment lock'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',v_u::text,true); perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true); perform public.set_staff_service_guarded(v_b,'d1940000-0000-4000-8000-000000000002','d1930000-0000-4000-8000-000000000002',false,v_expected); execute 'reset role'; perform pg_advisory_unlock(v_l);
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; v_g uuid:=current_setting('f1104.gb')::uuid; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_assignment')=0; perform pg_sleep(.01); end loop; begin select x.r into strict v_r from dblink_get_result('f1104_assignment') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if; v_fail:=true; end; begin perform * from dblink_get_result('f1104_assignment',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_assignment'); if not v_fail or (select version from public.appointment_groups where id=v_g)<>current_setting('f1104.gbv')::integer or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-assignment') then raise exception 'F11-04 assignment race left durable movement'; end if;
end $$;
set role authenticated;
do $$ declare v_expected timestamptz; begin
  select updated_at into v_expected from public.staff_services where business_id='d1910000-0000-4000-8000-000000000001' and staff_id='d1940000-0000-4000-8000-000000000002' and service_id='d1930000-0000-4000-8000-000000000002';
  perform public.set_staff_service_guarded('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000002','d1930000-0000-4000-8000-000000000002',true,v_expected);
end $$;
reset role;

-- Service and staff row-lock races use the real guarded edit RPCs in a remote
-- open transaction, then let the booking writer reach the same row before the
-- mutation commits.
do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_d date:=date_trunc('week',current_date)::date+7; v_q text; v_id uuid; v_wait boolean:=false; v_conn text; v_expected timestamptz;
begin
  select updated_at into v_expected from public.services where business_id=v_b and id='d1930000-0000-4000-8000-000000000002';
  perform dblink_connect('f1104_service_mut','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_service_mut'); perform dblink_connect('f1104_service_book','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_service_book');
  for v_conn in select unnest(array['f1104_service_mut','f1104_service_book']) loop perform dblink_exec(v_conn,'set role authenticated'); perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$); end loop;
  perform dblink_exec('f1104_service_mut','begin'); select x.id into strict v_id from dblink('f1104_service_mut',format($q$select (public.update_service_guarded(%L::uuid,%L::uuid,%L::timestamptz,%L::jsonb)).id$q$,v_b,'d1930000-0000-4000-8000-000000000002',v_expected,'{"active":false}')) x(id uuid);
  v_q:=format($q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,v_b,'f1104-race-service-off','Race Service Off','[{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]',(v_d+time '15:00') at time zone 'Europe/Istanbul','05553000106'); perform dblink_send_query('f1104_service_book',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_service_book' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop; if not v_wait then raise exception 'F11-04 create did not reach service row lock'; end if;
  perform dblink_exec('f1104_service_mut','commit'); perform dblink_disconnect('f1104_service_mut');
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_service_book')=0; perform pg_sleep(.01); end loop; begin select x.r into strict v_r from dblink_get_result('f1104_service_book') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' and sqlerrm not like '%SERVICE_NOT_FOUND%' then raise; end if; v_fail:=true; end; begin perform * from dblink_get_result('f1104_service_book',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_service_book'); if not v_fail or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-service-off') then raise exception 'F11-04 service race left durable movement'; end if;
end $$;
set role authenticated;
do $$ declare v_expected timestamptz; begin
  select updated_at into v_expected from public.services where business_id='d1910000-0000-4000-8000-000000000001' and id='d1930000-0000-4000-8000-000000000002';
  perform public.update_service_guarded('d1910000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000002',v_expected,'{"active":true}'::jsonb);
end $$;
reset role;

do $$
declare v_b uuid:='d1910000-0000-4000-8000-000000000001'; v_u uuid:='d1900000-0000-4000-8000-000000000001'; v_d date:=date_trunc('week',current_date)::date+7; v_q text; v_id uuid; v_wait boolean:=false; v_conn text; v_expected timestamptz;
begin
  select updated_at into v_expected from public.staff_profiles where business_id=v_b and id='d1940000-0000-4000-8000-000000000002';
  perform dblink_connect('f1104_staff_mut','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_mut'); perform dblink_connect('f1104_staff_book','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_book');
  for v_conn in select unnest(array['f1104_staff_mut','f1104_staff_book']) loop perform dblink_exec(v_conn,'set role authenticated'); perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_u::text||''''); perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$); end loop;
  perform dblink_exec('f1104_staff_mut','begin'); select x.id into strict v_id from dblink('f1104_staff_mut',format($q$select (public.update_staff_guarded(%L::uuid,%L::uuid,%L::timestamptz,%L::jsonb)).id$q$,v_b,'d1940000-0000-4000-8000-000000000002',v_expected,'{"active":false}')) x(id uuid);
  v_q:=format($q$select public.create_appointment_group(%L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L)$q$,v_b,'f1104-race-staff-off','Race Staff Off','[{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]',(v_d+time '15:30') at time zone 'Europe/Istanbul','05553000107'); perform dblink_send_query('f1104_staff_book',v_q);
  for i in 1..500 loop perform pg_stat_clear_snapshot(); if exists(select 1 from pg_stat_activity where application_name='f1104_staff_book' and wait_event_type='Lock') then v_wait:=true; exit; end if; perform pg_sleep(.01); end loop; if not v_wait then raise exception 'F11-04 create did not reach staff row lock'; end if;
  perform dblink_exec('f1104_staff_mut','commit'); perform dblink_disconnect('f1104_staff_mut');
end $$;
do $$ declare v_r jsonb; v_fail boolean:=false; begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_staff_book')=0; perform pg_sleep(.01); end loop; begin select x.r into strict v_r from dblink_get_result('f1104_staff_book') x(r jsonb); exception when others then if sqlerrm not like '%SLOT_UNAVAILABLE%' and sqlerrm not like '%GROUP_SLOT_UNAVAILABLE%' then raise; end if; v_fail:=true; end; begin perform * from dblink_get_result('f1104_staff_book',false) x(r jsonb); exception when others then null; end; perform dblink_disconnect('f1104_staff_book'); if not v_fail or exists(select 1 from public.booking_commands where business_id='d1910000-0000-4000-8000-000000000001' and idempotency_key='f1104-race-staff-off') then raise exception 'F11-04 staff race left durable movement'; end if;
end $$;
set role authenticated;
do $$ declare v_expected timestamptz; begin
  select updated_at into v_expected from public.staff_profiles where business_id='d1910000-0000-4000-8000-000000000001' and id='d1940000-0000-4000-8000-000000000002';
  perform public.update_staff_guarded('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000002',v_expected,'{"active":true}'::jsonb);
end $$;
reset role;

-- Two independent booking writers are forced to hold FK KEY SHARE on the same
-- target service before either can enter the deferred authority fence. The
-- fence must use a parent lock compatible with the other booking's KEY SHARE.
do $$
declare
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_u uuid:='d1900000-0000-4000-8000-000000000001';
  v_ga uuid:=current_setting('f1104.ga')::uuid;
  v_gb uuid:=current_setting('f1104.gb')::uuid;
  v_la uuid; v_lb uuid; v_va integer; v_vb integer;
  v_d date:=date_trunc('week',current_date)::date+7;
  v_w smallint:=extract(dow from v_d)::smallint;
  v_l bigint:=hashtextextended('f10-04:business-hours:'||v_b::text||':'||extract(dow from v_d)::smallint::text,0);
  v_qa text; v_qb text; v_wait_a boolean:=false; v_wait_b boolean:=false; v_conn text;
begin
  select id into strict v_la from public.appointments where business_id=v_b and group_id=v_ga and line_ordinal=1;
  select id into strict v_lb from public.appointments where business_id=v_b and group_id=v_gb and line_ordinal=1;
  select version into strict v_va from public.appointment_groups where business_id=v_b and id=v_ga;
  select version into strict v_vb from public.appointment_groups where business_id=v_b and id=v_gb;
  perform set_config('f1104.conv.ga_v',v_va::text,false);
  perform set_config('f1104.conv.gb_v',v_vb::text,false);
  perform set_config('f1104.conv.ga_line',v_la::text,false);
  perform set_config('f1104.conv.gb_line',v_lb::text,false);

  perform dblink_connect('f1104_service_conv_a','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_service_conv_a');
  perform dblink_connect('f1104_service_conv_b','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_service_conv_b');
  for v_conn in select unnest(array['f1104_service_conv_a','f1104_service_conv_b']) loop
    perform dblink_exec(v_conn,'set role authenticated');
    perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_u::text||'''');
    perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  perform pg_advisory_lock(v_l);
  v_qa:=format($q$select public.change_appointment_group_line_service(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid)$q$,
    v_b,v_ga,v_la,'f1104-conv-service-a',v_va,'d1930000-0000-4000-8000-000000000004');
  v_qb:=format($q$select public.change_appointment_group_line_service(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid)$q$,
    v_b,v_gb,v_lb,'f1104-conv-service-b',v_vb,'d1930000-0000-4000-8000-000000000004');
  perform dblink_send_query('f1104_service_conv_a',v_qa);
  perform dblink_send_query('f1104_service_conv_b',v_qb);

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    v_wait_a:=exists(select 1 from pg_stat_activity where application_name='f1104_service_conv_a' and wait_event_type='Lock');
    v_wait_b:=exists(select 1 from pg_stat_activity where application_name='f1104_service_conv_b' and wait_event_type='Lock');
    exit when v_wait_a and v_wait_b;
    perform pg_sleep(.01);
  end loop;
  if not (v_wait_a and v_wait_b) then raise exception 'F11-04 cross-group service writers did not reach shared authority barrier'; end if;
  perform pg_advisory_unlock(v_l);
end $$;

do $$
declare
  v_ra jsonb; v_rb jsonb;
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_ga uuid:=current_setting('f1104.ga')::uuid;
  v_gb uuid:=current_setting('f1104.gb')::uuid;
  v_la uuid:=current_setting('f1104.conv.ga_line')::uuid;
  v_lb uuid:=current_setting('f1104.conv.gb_line')::uuid;
begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_service_conv_a')=0 and dblink_is_busy('f1104_service_conv_b')=0; perform pg_sleep(.01); end loop;
  select x.r into strict v_ra from dblink_get_result('f1104_service_conv_a') x(r jsonb);
  select x.r into strict v_rb from dblink_get_result('f1104_service_conv_b') x(r jsonb);
  perform dblink_disconnect('f1104_service_conv_a');
  perform dblink_disconnect('f1104_service_conv_b');

  if (select service_id from public.appointments where business_id=v_b and id=v_la)<>'d1930000-0000-4000-8000-000000000004'
     or (select service_id from public.appointments where business_id=v_b and id=v_lb)<>'d1930000-0000-4000-8000-000000000004'
     or (select version from public.appointment_groups where business_id=v_b and id=v_ga)<>current_setting('f1104.conv.ga_v')::integer+1
     or (select version from public.appointment_groups where business_id=v_b and id=v_gb)<>current_setting('f1104.conv.gb_v')::integer+1 then
    raise exception 'F11-04 shared-service booking writers did not both commit';
  end if;
end $$;

-- Repeat the same barrier with both groups moving onto one new target staff.
-- Updating staff_id takes FK KEY SHARE on the target parent; the deferred staff
-- authority fence must not upgrade that parent to a lock that conflicts with
-- the other booking writer.
do $$
declare
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_u uuid:='d1900000-0000-4000-8000-000000000001';
  v_ga uuid:=current_setting('f1104.ga')::uuid;
  v_gb uuid:=current_setting('f1104.gb')::uuid;
  v_la uuid:=current_setting('f1104.conv.ga_line')::uuid;
  v_lb uuid:=current_setting('f1104.conv.gb_line')::uuid;
  v_va integer; v_vb integer;
  v_d date:=date_trunc('week',current_date)::date+7;
  v_l bigint:=hashtextextended('f10-04:business-hours:'||v_b::text||':'||extract(dow from v_d)::smallint::text,0);
  v_qa text; v_qb text; v_wait_a boolean:=false; v_wait_b boolean:=false; v_conn text;
begin
  select version into strict v_va from public.appointment_groups where business_id=v_b and id=v_ga;
  select version into strict v_vb from public.appointment_groups where business_id=v_b and id=v_gb;
  perform set_config('f1104.conv2.ga_v',v_va::text,false);
  perform set_config('f1104.conv2.gb_v',v_vb::text,false);

  perform dblink_connect('f1104_staff_conv_a','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_conv_a');
  perform dblink_connect('f1104_staff_conv_b','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1104_staff_conv_b');
  for v_conn in select unnest(array['f1104_staff_conv_a','f1104_staff_conv_b']) loop
    perform dblink_exec(v_conn,'set role authenticated');
    perform dblink_exec(v_conn,'set "request.jwt.claim.sub" = '''||v_u::text||'''');
    perform dblink_exec(v_conn,$q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  perform pg_advisory_lock(v_l);
  v_qa:=format($q$select public.reschedule_appointment_group_line(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz)$q$,
    v_b,v_ga,v_la,'f1104-conv-staff-a',v_va,'d1940000-0000-4000-8000-000000000003',(v_d+time '11:00') at time zone 'Europe/Istanbul');
  v_qb:=format($q$select public.reschedule_appointment_group_line(%L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz)$q$,
    v_b,v_gb,v_lb,'f1104-conv-staff-b',v_vb,'d1940000-0000-4000-8000-000000000003',(v_d+time '11:30') at time zone 'Europe/Istanbul');
  perform dblink_send_query('f1104_staff_conv_a',v_qa);
  perform dblink_send_query('f1104_staff_conv_b',v_qb);

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    v_wait_a:=exists(select 1 from pg_stat_activity where application_name='f1104_staff_conv_a' and wait_event_type='Lock');
    v_wait_b:=exists(select 1 from pg_stat_activity where application_name='f1104_staff_conv_b' and wait_event_type='Lock');
    exit when v_wait_a and v_wait_b;
    perform pg_sleep(.01);
  end loop;
  if not (v_wait_a and v_wait_b) then raise exception 'F11-04 cross-group staff writers did not reach shared authority barrier'; end if;
  perform pg_advisory_unlock(v_l);
end $$;

do $$
declare
  v_ra jsonb; v_rb jsonb;
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_ga uuid:=current_setting('f1104.ga')::uuid;
  v_gb uuid:=current_setting('f1104.gb')::uuid;
  v_la uuid:=current_setting('f1104.conv.ga_line')::uuid;
  v_lb uuid:=current_setting('f1104.conv.gb_line')::uuid;
  v_d date:=date_trunc('week',current_date)::date+7;
begin
  for i in 1..3000 loop exit when dblink_is_busy('f1104_staff_conv_a')=0 and dblink_is_busy('f1104_staff_conv_b')=0; perform pg_sleep(.01); end loop;
  select x.r into strict v_ra from dblink_get_result('f1104_staff_conv_a') x(r jsonb);
  select x.r into strict v_rb from dblink_get_result('f1104_staff_conv_b') x(r jsonb);
  perform dblink_disconnect('f1104_staff_conv_a');
  perform dblink_disconnect('f1104_staff_conv_b');

  if (select staff_id from public.appointments where business_id=v_b and id=v_la)<>'d1940000-0000-4000-8000-000000000003'
     or (select staff_id from public.appointments where business_id=v_b and id=v_lb)<>'d1940000-0000-4000-8000-000000000003'
     or (select starts_at from public.appointments where business_id=v_b and id=v_la)<>((v_d+time '11:00') at time zone 'Europe/Istanbul')
     or (select starts_at from public.appointments where business_id=v_b and id=v_lb)<>((v_d+time '11:30') at time zone 'Europe/Istanbul')
     or (select version from public.appointment_groups where business_id=v_b and id=v_ga)<>current_setting('f1104.conv2.ga_v')::integer+1
     or (select version from public.appointment_groups where business_id=v_b and id=v_gb)<>current_setting('f1104.conv2.gb_v')::integer+1 then
    raise exception 'F11-04 shared-staff booking writers did not both commit';
  end if;
end $$;

do $$ begin raise notice 'F11-04 schedule authority races accepted: create/group/line vs hours, blocks, assignment, service/staff mutations plus shared-parent booking writers'; end $$;
delete from public.businesses where id='d1910000-0000-4000-8000-000000000001';