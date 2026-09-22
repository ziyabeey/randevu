create extension if not exists dblink;

-- H19 T5 D2 x D3 runtime probe.
-- Freeze point: the creator must first observe price=10000 and staff A, then
-- block after planning but before the F10-04 assignment advisory. A separate
-- authenticated catalog transaction atomically reprices the service and disables
-- staff A's assignment. The creator must replan to staff B and freeze the new
-- price/policy state, or fail closed. A mixed old-price/new-staff reservation is
-- never acceptable.

delete from public.businesses
where id = 'a1910000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values (
  'a1900000-0000-4000-8000-000000000001',
  'h19-d2d3-owner@example.invalid',
  '{}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'a1910000-0000-4000-8000-000000000001',
  'H19 D2D3 Salon',
  'h19-d2d3-salon',
  'Europe/Istanbul',
  'a1900000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'a1920000-0000-4000-8000-000000000001',
  'a1910000-0000-4000-8000-000000000001',
  'a1900000-0000-4000-8000-000000000001',
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
  'a1930000-0000-4000-8000-000000000001',
  'a1910000-0000-4000-8000-000000000001',
  'H19 Coherence Service',
  30,0,0,'H19',10,
  10000,'fixed',10000,10000,'TRY',true
);

-- Alphabetic order makes staff A the deterministic first plan. Staff B is a
-- fully eligible backup so a coherent replan can succeed after A is disabled.
insert into public.staff_profiles(id,business_id,name,active)
values
  (
    'a1940000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    'A First',
    true
  ),
  (
    'a1940000-0000-4000-8000-000000000002',
    'a1910000-0000-4000-8000-000000000001',
    'B Backup',
    true
  );

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  (
    'a1910000-0000-4000-8000-000000000001',
    'a1940000-0000-4000-8000-000000000001',
    'a1930000-0000-4000-8000-000000000001',
    true
  ),
  (
    'a1910000-0000-4000-8000-000000000001',
    'a1940000-0000-4000-8000-000000000002',
    'a1930000-0000-4000-8000-000000000001',
    true
  );

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'a1910000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

insert into public.staff_hours(
  business_id,staff_id,weekday,starts_local,ends_local,active
)
select
  'a1910000-0000-4000-8000-000000000001'::uuid,
  x.staff_id,
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true
from (values
  ('a1940000-0000-4000-8000-000000000001'::uuid),
  ('a1940000-0000-4000-8000-000000000002'::uuid)
) x(staff_id);

-- Precondition: the frozen pre-race plan must actually carry the old financial
-- snapshot and choose staff A. Otherwise the race would not prove D2 x D3.
do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_plan jsonb;
begin
  v_plan := public.f11_plan_group_at(
    'a1910000-0000-4000-8000-000000000001',
    '[{"serviceId":"a1930000-0000-4000-8000-000000000001"}]'::jsonb,
    (v_day+time '11:00') at time zone 'Europe/Istanbul'
  );
  if v_plan is null then
    raise exception 'H19 D2D3 precondition: initial plan missing';
  end if;
  if v_plan#>>'{lines,0,staffId}' <> 'a1940000-0000-4000-8000-000000000001' then
    raise exception 'H19 D2D3 precondition: staff A was not initial authority';
  end if;
  if (v_plan#>>'{lines,0,priceMinor}')::integer <> 10000 then
    raise exception 'H19 D2D3 precondition: initial price snapshot was not 10000';
  end if;
end
$$;

do $$
declare
  v_business uuid := 'a1910000-0000-4000-8000-000000000001';
  v_owner uuid := 'a1900000-0000-4000-8000-000000000001';
  v_service uuid := 'a1930000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'a1940000-0000-4000-8000-000000000001';
  v_staff_b uuid := 'a1940000-0000-4000-8000-000000000002';
  v_day date := date_trunc('week',current_date)::date+7;
  v_start timestamptz;
  v_weekday smallint;
  v_hours_lock bigint;
  v_service_updated timestamptz;
  v_assignment_updated timestamptz;
  v_waited boolean := false;
  v_lock_held boolean := false;
  v_creator_result jsonb;
  v_result_rows integer;
  v_drain_rows integer;
  v_group uuid;
  v_line record;
  v_service_row record;
  v_commands integer;
  v_events integer;
begin
  v_start := (v_day+time '11:00') at time zone 'Europe/Istanbul';
  v_weekday := extract(dow from v_day)::smallint;
  v_hours_lock := hashtextextended(
    'f10-04:business-hours:'||v_business::text||':'||v_weekday::text,0
  );

  select s.updated_at into v_service_updated
  from public.services s
  where s.business_id=v_business and s.id=v_service;

  select ss.updated_at into v_assignment_updated
  from public.staff_services ss
  where ss.business_id=v_business
    and ss.staff_id=v_staff_a
    and ss.service_id=v_service;

  perform dblink_connect(
    'h19_d2d3_creator',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d2d3_creator'
  );
  perform dblink_exec('h19_d2d3_creator','set statement_timeout=30000');
  perform dblink_exec('h19_d2d3_creator','set role authenticated');
  perform dblink_exec(
    'h19_d2d3_creator',
    'set "request.jwt.claim.sub" = '''||v_owner::text||''''
  );
  perform dblink_exec(
    'h19_d2d3_creator',
    $q$set "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$
  );

  perform dblink_connect(
    'h19_d2d3_mutator',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d2d3_mutator'
  );
  perform dblink_exec('h19_d2d3_mutator','set statement_timeout=30000');
  perform dblink_exec('h19_d2d3_mutator','begin');
  perform dblink_exec('h19_d2d3_mutator','set local role authenticated');
  perform dblink_exec(
    'h19_d2d3_mutator',
    'set local "request.jwt.claim.sub" = '''||v_owner::text||''''
  );
  perform dblink_exec(
    'h19_d2d3_mutator',
    $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$
  );

  -- Park the creator after its first plan. At this point it has already seen
  -- price=10000/staff A but has not acquired the assignment advisory.
  perform pg_advisory_lock(v_hours_lock);
  v_lock_held := true;

  if dblink_send_query(
    'h19_d2d3_creator',
    format(
      $q$select public.create_appointment_group(
        %L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L
      )$q$,
      v_business,
      'h19-d2d3-create-0001',
      'H19 Coherence Customer',
      '[{"serviceId":"a1930000-0000-4000-8000-000000000001"}]',
      v_start,
      '05551919001'
    )
  ) <> 1 then
    raise exception 'H19 D2D3 creator could not start';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='h19_d2d3_creator'
        and wait_event_type='Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_waited then
    raise exception 'H19 D2D3 creator did not reach the post-plan authority lock';
  end if;

  -- One committed catalog transaction changes both dimensions:
  -- D2: financial snapshot -> 20000 and a new price policy version.
  -- D3: staff A assignment -> inactive, forcing staff B on replan.
  perform dblink_exec(
    'h19_d2d3_mutator',
    format(
      $m$
      do $inner$
      begin
        perform public.update_service_guarded(
          %L::uuid,%L::uuid,%L::timestamptz,'{"priceMinor":20000}'::jsonb
        );
        perform public.set_staff_service_guarded(
          %L::uuid,%L::uuid,%L::uuid,false,%L::timestamptz
        );
      end
      $inner$;
      $m$,
      v_business,v_service,v_service_updated,
      v_business,v_staff_a,v_service,v_assignment_updated
    )
  );
  perform dblink_exec('h19_d2d3_mutator','commit');
  perform dblink_disconnect('h19_d2d3_mutator');

  -- Prove the mutation really landed before the creator is released.
  if not exists (
    select 1 from public.services s
    where s.business_id=v_business and s.id=v_service
      and s.price_type='fixed'
      and s.price_minor=20000
      and s.price_min_minor=20000
      and s.price_max_minor=20000
  ) then
    raise exception 'H19 D2D3 mutator did not commit the new price state';
  end if;
  if exists (
    select 1 from public.staff_services ss
    where ss.business_id=v_business and ss.staff_id=v_staff_a
      and ss.service_id=v_service and ss.active
  ) then
    raise exception 'H19 D2D3 mutator did not disable staff A assignment';
  end if;

  perform pg_advisory_unlock(v_hours_lock);
  v_lock_held := false;

  select t.result into v_creator_result
  from dblink_get_result('h19_d2d3_creator') as t(result jsonb);
  get diagnostics v_result_rows = row_count;
  if v_result_rows <> 1 or v_creator_result is null
     or v_creator_result->>'groupId' is null then
    raise exception 'H19 D2D3 creator did not return one coherent group: %',
      v_creator_result;
  end if;

  perform * from dblink_get_result('h19_d2d3_creator',false) as t(result jsonb);
  get diagnostics v_drain_rows = row_count;
  if v_drain_rows <> 0 then
    raise exception 'H19 D2D3 creator had unexpected trailing rows: %',v_drain_rows;
  end if;
  perform dblink_disconnect('h19_d2d3_creator');

  v_group := (v_creator_result->>'groupId')::uuid;

  select a.* into v_line
  from public.appointments a
  where a.business_id=v_business and a.group_id=v_group;

  if v_line.id is null then
    raise exception 'H19 D2D3 coherent group persisted no line';
  end if;
  if v_line.staff_id <> v_staff_b then
    raise exception 'H19 D2D3 committed stale staff authority: %',v_line.staff_id;
  end if;
  if v_line.price_minor_snapshot <> 20000
     or v_line.price_min_minor_snapshot <> 20000
     or v_line.price_max_minor_snapshot <> 20000 then
    raise exception 'H19 D2D3 committed stale/mixed price snapshot: %, %, %',
      v_line.price_minor_snapshot,
      v_line.price_min_minor_snapshot,
      v_line.price_max_minor_snapshot;
  end if;

  select * into v_service_row
  from public.services s
  where s.business_id=v_business and s.id=v_service;

  if v_line.price_policy_version_snapshot <> v_service_row.price_policy_version then
    raise exception 'H19 D2D3 mixed price policy version: line=% current=%',
      v_line.price_policy_version_snapshot,v_service_row.price_policy_version;
  end if;
  if v_line.currency_snapshot <> v_service_row.currency then
    raise exception 'H19 D2D3 mixed currency snapshot';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.business_id=v_business and a.group_id=v_group
      and (a.staff_id=v_staff_a or a.price_minor_snapshot=10000)
  ) then
    raise exception 'H19 D2D3 Frankenstein line survived';
  end if;

  select count(*)::integer into v_commands
  from public.booking_commands bc
  where bc.business_id=v_business
    and bc.idempotency_key='h19-d2d3-create-0001'
    and bc.group_id=v_group;
  if v_commands <> 1 then
    raise exception 'H19 D2D3 expected one durable command, found %',v_commands;
  end if;

  select count(*)::integer into v_events
  from public.appointment_events e
  where e.business_id=v_business and e.group_id=v_group
    and e.event_type='created';
  if v_events <> 1 then
    raise exception 'H19 D2D3 expected one create event, found %',v_events;
  end if;

  raise notice
    'H19 T5 D2xD3 PASS: stale price/staff plan replanned coherently to new price + backup staff';
exception when others then
  if v_lock_held then
    perform pg_advisory_unlock(v_hours_lock);
  end if;
  begin perform dblink_exec('h19_d2d3_mutator','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d2d3_mutator'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d2d3_creator'); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses
where id = 'a1910000-0000-4000-8000-000000000001';
