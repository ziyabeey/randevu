-- H19 permanent interaction scenario: D4 x D5 (time/boundary x concurrency/version).
--
-- This fixture is intentionally minimal and self-contained so the canonical
-- H19 integrity gate does not depend on the broader F11-04 acceptance fixture.
-- The prospective probe below is preserved from the clean-control experiment.

delete from public.businesses where id='d1910000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('d1900000-0000-4000-8000-000000000001','h19-d4d5-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('d1910000-0000-4000-8000-000000000001','H19 D4D5 Authority','h19-d4d5-authority','Europe/Istanbul','d1900000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('d1920000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000001','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active,
  processing_capacity_policy,passive_wait_minutes
) values
  ('d1930000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','H19 D4D5 A',30,0,0,'H19',10,10000,'fixed',10000,10000,'TRY',true,null,0),
  ('d1930000-0000-4000-8000-000000000002','d1910000-0000-4000-8000-000000000001','H19 D4D5 B',30,0,0,'H19',20,12000,'fixed',12000,12000,'TRY',true,null,0);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('d1940000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000001','H19 D4D5 Ada',true),
  ('d1940000-0000-4000-8000-000000000002','d1910000-0000-4000-8000-000000000001','H19 D4D5 Bora',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000001','d1930000-0000-4000-8000-000000000001',true),
  ('d1910000-0000-4000-8000-000000000001','d1940000-0000-4000-8000-000000000002','d1930000-0000-4000-8000-000000000002',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'd1910000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '20:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'd1910000-0000-4000-8000-000000000001'::uuid,
  'd1940000-0000-4000-8000-000000000001'::uuid,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '20:00',true
union all
select
  'd1910000-0000-4000-8000-000000000001'::uuid,
  'd1940000-0000-4000-8000-000000000002'::uuid,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '20:00',true;

set role authenticated;
select set_config('request.jwt.claim.sub','d1900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $h19fixture$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_group jsonb;
begin
  v_group:=public.create_appointment_group(
    'd1910000-0000-4000-8000-000000000001',
    'h19-d4d5-seed-group',
    'H19 D4D5 Group',
    '[{"serviceId":"d1930000-0000-4000-8000-000000000001","staffId":"d1940000-0000-4000-8000-000000000001"},{"serviceId":"d1930000-0000-4000-8000-000000000002","staffId":"d1940000-0000-4000-8000-000000000002"}]'::jsonb,
    (v_day+time '12:00') at time zone 'Europe/Istanbul',
    '05553000002'
  );
  perform set_config('h19d4d5.group_id',v_group->>'groupId',false);
  perform set_config('h19d4d5.line2_id',v_group#>>'{lines,1,appointmentId}',false);
end
$h19fixture$;

reset role;

-- H19 D4 x D5 prospective probe: cross-day time authority x group version.
-- This block is identical in the experimental variant and clean-control arms.
-- It reuses group B, moves line 2 to the following day, then holds a guarded
-- day-2 business-hours change open while line 1 is edited on day 1.
--
-- Clean behavior must wait on the sibling-day authority, then revalidate after
-- the narrower day-2 hours commit and reject the line edit without version or
-- command-ledger movement.

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'd1910000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+8))::smallint,
  time '09:00',time '20:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'd1910000-0000-4000-8000-000000000001'::uuid,
  sp.id,
  extract(dow from (date_trunc('week',current_date)::date+8))::smallint,
  time '09:00',time '20:00',true
from public.staff_profiles sp
where sp.business_id='d1910000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','d1900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $h19setup$
declare
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_g uuid:=current_setting('h19d4d5.group_id')::uuid;
  v_line2 uuid:=current_setting('h19d4d5.line2_id')::uuid;
  v_staff uuid;
  v_v integer;
  v_day2 date:=date_trunc('week',current_date)::date+8;
  v_payload jsonb;
begin
  select version into strict v_v
  from public.appointment_groups
  where business_id=v_b and id=v_g;

  select staff_id into strict v_staff
  from public.appointments
  where business_id=v_b and id=v_line2;

  v_payload:=public.reschedule_appointment_group_line(
    v_b,v_g,v_line2,
    'h19-d4d5-setup-sibling-day',
    v_v,
    v_staff,
    (v_day2+time '10:00') at time zone 'Europe/Istanbul'
  );

  if (v_payload->>'version')::integer<>v_v+1 then
    raise exception 'H19 D4xD5 fixture version did not advance exactly once';
  end if;
  if (v_payload#>>'{lines,1,startsAt}')::timestamptz
     <>((v_day2+time '10:00') at time zone 'Europe/Istanbul') then
    raise exception 'H19 D4xD5 fixture did not place the sibling line on day 2';
  end if;
end
$h19setup$;

do $h19probe$
declare
  v_b uuid:='d1910000-0000-4000-8000-000000000001';
  v_u uuid:='d1900000-0000-4000-8000-000000000001';
  v_g uuid:=current_setting('h19d4d5.group_id')::uuid;
  v_line1 uuid;
  v_staff uuid;
  v_v integer;
  v_before timestamptz;
  v_target timestamptz:=((date_trunc('week',current_date)::date+7)+time '17:00') at time zone 'Europe/Istanbul';
  v_w2 smallint:=extract(dow from (date_trunc('week',current_date)::date+8))::smallint;
  v_key text:='h19-d4d5-probe-line1';
  v_q text;
  v_wait boolean:=false;
  v_finished boolean:=false;
  v_result jsonb;
  v_err text;
begin
  select id,staff_id,starts_at
  into strict v_line1,v_staff,v_before
  from public.appointments
  where business_id=v_b and group_id=v_g and line_ordinal=1;

  select version into strict v_v
  from public.appointment_groups
  where business_id=v_b and id=v_g;

  perform pg_temp.h19_connect('h19_d4d5_hours',true);
  perform pg_temp.h19_set_authenticated('h19_d4d5_hours',v_u,true);

  perform *
  from dblink(
    'h19_d4d5_hours',
    format(
      $q$
        select count(*)::bigint
        from public.replace_business_hours_guarded(
          %L::uuid,%s::smallint,
          '[{"start":"09:00","end":"09:30"}]'::jsonb,
          '[{"start":"09:00","end":"20:00"}]'::jsonb
        )
      $q$,
      v_b,v_w2
    )
  ) as t(n bigint);

  perform pg_temp.h19_connect('h19_d4d5_line',false);
  perform pg_temp.h19_set_authenticated('h19_d4d5_line',v_u,false);

  v_q:=format(
    $q$
      select public.reschedule_appointment_group_line(
        %L::uuid,%L::uuid,%L::uuid,%L,%s,%L::uuid,%L::timestamptz
      )
    $q$,
    v_b,v_g,v_line1,v_key,v_v,v_staff,v_target
  );

  if dblink_send_query('h19_d4d5_line',v_q)<>1 then
    raise exception 'H19 D4xD5 probe could not start the day-1 line edit';
  end if;

  for i in 1..300 loop
    perform pg_stat_clear_snapshot();
    if exists(
      select 1 from pg_stat_activity
      where application_name='h19_d4d5_line' and wait_event_type='Lock'
    ) then
      v_wait:=true;
      exit;
    end if;
    if dblink_is_busy('h19_d4d5_line')=0 then
      v_finished:=true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;

  if not v_wait then
    if v_finished then
      begin
        select x.r into strict v_result
        from dblink_get_result('h19_d4d5_line') x(r jsonb);
      exception when others then
        v_err:=sqlerrm;
      end;
      begin perform * from dblink_get_result('h19_d4d5_line',false) x(r jsonb);
      exception when others then null; end;
    end if;

    perform pg_temp.h19_safe_cleanup('h19_d4d5_hours',true);
    perform pg_temp.h19_safe_cleanup('h19_d4d5_line',false);

    if v_err is not null then
      raise exception 'H19 D4xD5 day-1 edit returned an unexpected pre-serialization result: %',v_err;
    end if;
    if not v_finished then
      raise exception 'H19 D4xD5 probe did not observe the sibling-day wait state';
    end if;
    raise exception 'H19 D4xD5 cross-day authority scope mismatch: day-1 edit completed while day-2 business-hours authority was pending';
  end if;

  perform dblink_exec('h19_d4d5_hours','commit');

  if not pg_temp.h19_wait_until_idle('h19_d4d5_line',3000) then
    raise exception 'H19 D4xD5 day-1 edit did not resolve after day-2 authority commit';
  end if;

  v_err:=null;
  begin
    select x.r into strict v_result
    from dblink_get_result('h19_d4d5_line') x(r jsonb);
  exception when others then
    v_err:=sqlerrm;
  end;
  begin perform * from dblink_get_result('h19_d4d5_line',false) x(r jsonb);
  exception when others then null; end;

  perform pg_temp.h19_safe_cleanup('h19_d4d5_hours',false);
  perform pg_temp.h19_safe_cleanup('h19_d4d5_line',false);

  if v_err is null or position('SLOT_UNAVAILABLE' in v_err)=0 then
    raise exception 'H19 D4xD5 expected SLOT_UNAVAILABLE after day-2 closure, got %',
      coalesce(v_err,coalesce(v_result::text,'<null>'));
  end if;

  if (select version from public.appointment_groups where business_id=v_b and id=v_g)<>v_v then
    raise exception 'H19 D4xD5 rejected edit changed group version';
  end if;
  if (select starts_at from public.appointments where business_id=v_b and id=v_line1)<>v_before then
    raise exception 'H19 D4xD5 rejected edit changed line-1 time';
  end if;
  if exists(
    select 1 from public.booking_commands
    where business_id=v_b and idempotency_key=v_key
  ) then
    raise exception 'H19 D4xD5 rejected edit retained a command claim';
  end if;

  raise notice 'H19 D4xD5 prospective invariant accepted: sibling-day authority serialized before group-version movement';
exception when others then
  perform pg_temp.h19_safe_cleanup('h19_d4d5_hours',true);
  perform pg_temp.h19_safe_cleanup('h19_d4d5_line',false);
  raise;
end
$h19probe$;


delete from public.businesses where id='d1910000-0000-4000-8000-000000000001';
