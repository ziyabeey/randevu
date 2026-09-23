-- H19 permanent interaction scenario: D3 x D4 (staff/capacity x time/boundary).
-- Probe semantics preserved from the prospective experiment; current-main CI supplies the clean control.
--
-- Original H19 T6 D3 x D4 runtime probe.
-- Staff/capacity x time/boundary: creator first plans Staff A at 11:00, then
-- blocks before finishing schedule-authority acquisition. A separate authenticated
-- transaction shrinks Staff A's working hours so A cannot serve 11:00, while
-- Staff B remains fully eligible. The creator must replan to B or fail this proof.

delete from public.businesses
where id = 'a2910000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values (
  'a2900000-0000-4000-8000-000000000001',
  'h19-d3d4-owner@example.invalid',
  '{}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'a2910000-0000-4000-8000-000000000001',
  'H19 D3D4 Salon',
  'h19-d3d4-salon',
  'Europe/Istanbul',
  'a2900000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'a2920000-0000-4000-8000-000000000001',
  'a2910000-0000-4000-8000-000000000001',
  'a2900000-0000-4000-8000-000000000001',
  'owner',
  true
)
on conflict(business_id,user_id) do update
set role=excluded.role,active=excluded.active;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,
  currency,active
) values (
  'a2930000-0000-4000-8000-000000000001',
  'a2910000-0000-4000-8000-000000000001',
  'H19 Schedule Fallback',
  30,0,0,'H19',10,
  10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values
  (
    'a2940000-0000-4000-8000-000000000001',
    'a2910000-0000-4000-8000-000000000001',
    'A First',
    true
  ),
  (
    'a2940000-0000-4000-8000-000000000002',
    'a2910000-0000-4000-8000-000000000001',
    'B Backup',
    true
  );

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  (
    'a2910000-0000-4000-8000-000000000001',
    'a2940000-0000-4000-8000-000000000001',
    'a2930000-0000-4000-8000-000000000001',
    true
  ),
  (
    'a2910000-0000-4000-8000-000000000001',
    'a2940000-0000-4000-8000-000000000002',
    'a2930000-0000-4000-8000-000000000001',
    true
  );

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'a2910000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

insert into public.staff_hours(
  business_id,staff_id,weekday,starts_local,ends_local,active
)
select
  'a2910000-0000-4000-8000-000000000001'::uuid,
  x.staff_id,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true
from (values
  ('a2940000-0000-4000-8000-000000000001'::uuid),
  ('a2940000-0000-4000-8000-000000000002'::uuid)
) x(staff_id);

do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_plan jsonb;
begin
  v_plan := public.f11_plan_group_at(
    'a2910000-0000-4000-8000-000000000001',
    '[{"serviceId":"a2930000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '11:00') at time zone 'Europe/Istanbul'
  );
  if v_plan is null then
    raise exception 'H19 D3D4 precondition: initial plan missing';
  end if;
  if v_plan#>>'{lines,0,staffId}' <> 'a2940000-0000-4000-8000-000000000001' then
    raise exception 'H19 D3D4 precondition: staff A was not initial authority';
  end if;
end
$$;

do $$
declare
  v_business uuid := 'a2910000-0000-4000-8000-000000000001';
  v_owner uuid := 'a2900000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'a2940000-0000-4000-8000-000000000001';
  v_staff_b uuid := 'a2940000-0000-4000-8000-000000000002';
  v_day date := date_trunc('week',current_date)::date+7;
  v_weekday smallint := extract(dow from (date_trunc('week',current_date)::date+7))::smallint;
  v_start timestamptz;
  v_assignment_lock bigint;
  v_waited boolean := false;
  v_lock_held boolean := false;
  v_creator_result jsonb;
  v_result_rows integer;
  v_drain_rows integer;
  v_group uuid;
  v_line record;
  v_commands integer;
  v_events integer;
begin
  v_start := (v_day+time '11:00') at time zone 'Europe/Istanbul';
  v_assignment_lock := hashtextextended(
    'f10-04:assignments:'||v_business::text,0
  );

  perform dblink_connect(
    'h19_d3d4_creator',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d3d4_creator'
  );
  perform dblink_exec('h19_d3d4_creator','set statement_timeout=30000');
  perform dblink_exec('h19_d3d4_creator','set role authenticated');
  perform dblink_exec(
    'h19_d3d4_creator',
    'set "request.jwt.claim.sub" = '''||v_owner::text||''''
  );
  perform dblink_exec(
    'h19_d3d4_creator',
    $q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$
  );

  perform dblink_connect(
    'h19_d3d4_mutator',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d3d4_mutator'
  );
  perform dblink_exec('h19_d3d4_mutator','set statement_timeout=30000');
  perform dblink_exec('h19_d3d4_mutator','begin');
  perform dblink_exec('h19_d3d4_mutator','set local role authenticated');
  perform dblink_exec(
    'h19_d3d4_mutator',
    'set local "request.jwt.claim.sub" = '''||v_owner::text||''''
  );
  perform dblink_exec(
    'h19_d3d4_mutator',
    $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$
  );

  -- Creator has already built its first plan before it reaches this advisory.
  perform pg_advisory_lock(v_assignment_lock);
  v_lock_held := true;

  if dblink_send_query(
    'h19_d3d4_creator',
    format(
      $q$select public.create_appointment_group(
        %L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L
      )$q$,
      v_business,
      'h19-d3d4-create-0001',
      'H19 Schedule Customer',
      '[{"serviceId":"a2930000-0000-4000-8000-000000000001"}]',
      v_start,
      '05552919001'
    )
  ) <> 1 then
    raise exception 'H19 D3D4 creator could not start';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='h19_d3d4_creator'
        and wait_event_type='Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_waited then
    raise exception 'H19 D3D4 creator did not reach the post-plan assignment barrier';
  end if;

  -- Shrink A's current authority so 11:00 is no longer legal. B remains 09–18.
  perform dblink_exec(
    'h19_d3d4_mutator',
    format(
      $m$
      do $inner$
      begin
        perform *
        from public.replace_staff_hours_guarded(
          %L::uuid,%L::uuid,%s::smallint,
          '[{"start":"09:00","end":"10:00"}]'::jsonb,
          '[{"start":"09:00","end":"18:00"}]'::jsonb
        );
      end
      $inner$;
      $m$,
      v_business,v_staff_a,v_weekday
    )
  );
  perform dblink_exec('h19_d3d4_mutator','commit');
  perform dblink_disconnect('h19_d3d4_mutator');

  if exists (
    select 1
    from public.staff_hours sh
    where sh.business_id=v_business and sh.staff_id=v_staff_a
      and sh.weekday=v_weekday and sh.active
      and sh.starts_local <= time '11:00' and sh.ends_local >= time '11:30'
  ) then
    raise exception 'H19 D3D4 mutator did not remove staff A from the target interval';
  end if;

  perform pg_advisory_unlock(v_assignment_lock);
  v_lock_held := false;

  select t.result into v_creator_result
  from dblink_get_result('h19_d3d4_creator') as t(result jsonb);
  get diagnostics v_result_rows = row_count;
  if v_result_rows <> 1 or v_creator_result is null
     or v_creator_result->>'groupId' is null then
    raise exception 'H19 D3D4 creator did not return one coherent group: %',
      v_creator_result;
  end if;

  perform * from dblink_get_result('h19_d3d4_creator',false) as t(result jsonb);
  get diagnostics v_drain_rows = row_count;
  if v_drain_rows <> 0 then
    raise exception 'H19 D3D4 creator had unexpected trailing rows: %',v_drain_rows;
  end if;
  perform dblink_disconnect('h19_d3d4_creator');

  v_group := (v_creator_result->>'groupId')::uuid;

  select a.* into v_line
  from public.appointments a
  where a.business_id=v_business and a.group_id=v_group;

  if v_line.id is null then
    raise exception 'H19 D3D4 coherent group persisted no line';
  end if;
  if v_line.staff_id <> v_staff_b then
    raise exception 'H19 D3D4 committed stale staff/time authority: %',v_line.staff_id;
  end if;
  if v_line.starts_at <> v_start then
    raise exception 'H19 D3D4 changed customer start while falling back';
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.business_id=v_business and a.group_id=v_group and a.staff_id=v_staff_a
  ) then
    raise exception 'H19 D3D4 stale staff A line survived';
  end if;

  select count(*)::integer into v_commands
  from public.booking_commands bc
  where bc.business_id=v_business
    and bc.idempotency_key='h19-d3d4-create-0001'
    and bc.group_id=v_group;
  if v_commands <> 1 then
    raise exception 'H19 D3D4 expected one durable command, found %',v_commands;
  end if;

  select count(*)::integer into v_events
  from public.appointment_events e
  where e.business_id=v_business and e.group_id=v_group
    and e.event_type='created';
  if v_events <> 1 then
    raise exception 'H19 D3D4 expected one create event, found %',v_events;
  end if;

  raise notice
    'H19 T6 D3xD4 PASS: stale staff-hours plan replanned coherently to backup staff';
exception when others then
  if v_lock_held then
    perform pg_advisory_unlock(v_assignment_lock);
  end if;
  begin perform dblink_exec('h19_d3d4_mutator','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d3d4_mutator'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d3d4_creator'); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses
where id = 'a2910000-0000-4000-8000-000000000001';
