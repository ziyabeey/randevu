begin;

-- F16-01 recurring-series acceptance: bounded enumeration, DST wall-clock
-- preservation, whole-series idempotency and atomic conflict rollback.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1600000-0000-4000-8000-000000000001','f1601-owner@example.invalid','{}'::jsonb),
  ('f1600000-0000-4000-8000-000000000002','f1601-other@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1610000-0000-4000-8000-000000000001','F16-01 Berlin','f1601-berlin','Europe/Berlin','f1600000-0000-4000-8000-000000000001'),
  ('f1610000-0000-4000-8000-000000000002','F16-01 Other','f1601-other','Europe/Istanbul','f1600000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1620000-0000-4000-8000-000000000001','f1610000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000001','owner',true),
  ('f1620000-0000-4000-8000-000000000002','f1610000-0000-4000-8000-000000000002','f1600000-0000-4000-8000-000000000002','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f1630000-0000-4000-8000-000000000001',
  'f1610000-0000-4000-8000-000000000001',
  'Seri Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'EUR',true
);

insert into public.staff_profiles(id,business_id,name,active)
values (
  'f1640000-0000-4000-8000-000000000001',
  'f1610000-0000-4000-8000-000000000001',
  'Seri Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'f1610000-0000-4000-8000-000000000001',
  'f1640000-0000-4000-8000-000000000001',
  'f1630000-0000-4000-8000-000000000001',true
);

-- Sundays covering the 2027 spring DST transition.
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values ('f1610000-0000-4000-8000-000000000001',0,time '08:00',time '18:00',true);

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'f1610000-0000-4000-8000-000000000001',
  'f1640000-0000-4000-8000-000000000001',
  0,time '08:00',time '18:00',true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

-- Preview crosses spring-forward and keeps the requested 10:00 business-local time.
do $f16_preview$
declare
  v jsonb;
  v_bad integer;
begin
  v:=public.preview_appointment_series(
    'f1610000-0000-4000-8000-000000000001',
    '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2027-03-21 10:00 Europe/Berlin'::timestamptz,
    'weekly',3
  );
  if (v->>'allAvailable')::boolean is not true
     or jsonb_array_length(v->'occurrences')<>3 then
    raise exception 'F16-01 DST preview did not produce three available occurrences: %',v;
  end if;

  select count(*)::integer into v_bad
  from jsonb_array_elements(v->'occurrences') x
  where (x->>'localTime')::time<>time '10:00';
  if v_bad<>0 then raise exception 'F16-01 DST preview drifted local wall clock: %',v; end if;
end
$f16_preview$;

-- Fall-back also preserves the requested business-local wall clock instead of
-- drifting with the UTC offset change.
do $f16_fall_preview$
declare
  v jsonb;
  v_bad integer;
begin
  v:=public.preview_appointment_series(
    'f1610000-0000-4000-8000-000000000001',
    '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2026-10-18 10:00 Europe/Berlin'::timestamptz,
    'weekly',3
  );
  if (v->>'allAvailable')::boolean is not true
     or jsonb_array_length(v->'occurrences')<>3 then
    raise exception 'F16-01 fall DST preview did not produce three available occurrences: %',v;
  end if;

  select count(*)::integer into v_bad
  from jsonb_array_elements(v->'occurrences') x
  where (x->>'localTime')::time<>time '10:00';
  if v_bad<>0 then raise exception 'F16-01 fall DST preview drifted local wall clock: %',v; end if;
end
$f16_fall_preview$;

-- A nonexistent local wall time must fail explicitly instead of silently moving.
do $f16_gap$
declare v_error text;
begin
  begin
    perform public.preview_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-03-21 02:30 Europe/Berlin'::timestamptz,
      'weekly',2
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('SERIES_LOCAL_TIME_UNAVAILABLE:2027-03-28' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 nonexistent DST time did not fail explicitly: %',v_error;
  end if;
end
$f16_gap$;

-- DB and API share K03's hard 12-occurrence ceiling.
do $f16_limit$
declare v_error text;
begin
  begin
    perform public.preview_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      '[{"serviceId":"f1630000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-03-21 10:00 Europe/Berlin'::timestamptz,
      'weekly',13
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('SERIES_LIMIT_EXCEEDED' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 DB accepted a 13-occurrence series: %',v_error;
  end if;
end
$f16_limit$;

-- Initial series creation is one outer transaction and one external idempotency result.
do $f16_create$
declare
  v jsonb;
begin
  v:=public.create_appointment_series(
    'f1610000-0000-4000-8000-000000000001',
    'f1601-series-create-0001',
    'Seri Müşteri',
    '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2027-03-21 10:00 Europe/Berlin'::timestamptz,
    'weekly',3,
    '05551601001',null,'DST seri'
  );
  if v->>'seriesId' is null or (v->>'occurrenceCount')::integer<>3
     or jsonb_array_length(v->'occurrences')<>3 then
    raise exception 'F16-01 series create payload invalid: %',v;
  end if;
  perform set_config('f1601.series_id',v->>'seriesId',false);
end
$f16_create$;

reset role;
do $f16_shape$
declare
  v_series uuid:=current_setting('f1601.series_id')::uuid;
  v_groups integer;
  v_lines integer;
  v_events integer;
  v_bad integer;
begin
  select count(*)::integer into v_groups
  from public.appointment_groups
  where business_id='f1610000-0000-4000-8000-000000000001'
    and series_id=v_series;
  select count(*)::integer into v_lines
  from public.appointments a
  join public.appointment_groups g
    on g.business_id=a.business_id and g.id=a.group_id
  where g.business_id='f1610000-0000-4000-8000-000000000001'
    and g.series_id=v_series;
  select count(*)::integer into v_events
  from public.appointment_series_events
  where business_id='f1610000-0000-4000-8000-000000000001'
    and series_id=v_series and event_type='created';

  if v_groups<>3 or v_lines<>3 or v_events<>1 then
    raise exception 'F16-01 series durable shape wrong groups=% lines=% events=%',
      v_groups,v_lines,v_events;
  end if;

  select count(*)::integer into v_bad
  from public.appointment_groups g
  join public.appointments a
    on a.business_id=g.business_id and a.group_id=g.id
  where g.business_id='f1610000-0000-4000-8000-000000000001'
    and g.series_id=v_series
    and (a.starts_at at time zone 'Europe/Berlin')::time<>time '10:00';
  if v_bad<>0 then raise exception 'F16-01 committed series drifted local time'; end if;

  if (select array_agg(series_ordinal order by series_ordinal)
      from public.appointment_groups
      where business_id='f1610000-0000-4000-8000-000000000001'
        and series_id=v_series)<>array[1::smallint,2::smallint,3::smallint] then
    raise exception 'F16-01 occurrence ordinals are not stable';
  end if;
end
$f16_shape$;

-- Same key + same intent returns the exact same series and creates no duplicate.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f16_replay$
declare v jsonb;
begin
  v:=public.create_appointment_series(
    'f1610000-0000-4000-8000-000000000001',
    'f1601-series-create-0001',
    'Seri Müşteri',
    '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2027-03-21 10:00 Europe/Berlin'::timestamptz,
    'weekly',3,
    '05551601001',null,'DST seri'
  );
  if v->>'seriesId'<>current_setting('f1601.series_id') then
    raise exception 'F16-01 replay returned another series: %',v;
  end if;
end
$f16_replay$;

reset role;
do $f16_replay_shape$
begin
  if (select count(*) from public.appointment_series
      where business_id='f1610000-0000-4000-8000-000000000001')<>1 then
    raise exception 'F16-01 replay created another series header';
  end if;
  if (select count(*) from public.appointment_groups
      where business_id='f1610000-0000-4000-8000-000000000001'
        and series_id=current_setting('f1601.series_id')::uuid)<>3 then
    raise exception 'F16-01 replay created duplicate occurrence groups';
  end if;
end
$f16_replay_shape$;

-- Reusing the external key with a different cadence is a conflict.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f16_idempotency_conflict$
declare v_error text;
begin
  begin
    perform public.create_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      'f1601-series-create-0001',
      'Seri Müşteri',
      '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-03-21 10:00 Europe/Berlin'::timestamptz,
      'daily',3,'05551601001',null,'DST seri'
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('IDEMPOTENCY_CONFLICT' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 same key accepted a changed cadence: %',v_error;
  end if;
end
$f16_idempotency_conflict$;


-- Future-scope mutation preserves completed history and mutates only the
-- still-manageable future occurrences. Series version is its own CAS identity.
do $f16_future_scope$
declare
  v_series uuid:=current_setting('f1601.series_id')::uuid;
  v_first_group uuid;
  v_first_version integer;
  v_preview jsonb;
  v_move jsonb;
  v_replay jsonb;
  v_cancel jsonb;
  v_state jsonb;
  v_bad integer;
begin
  -- Exercise the same authenticated read surface used by the operator UI.
  -- The acceptance test must not bypass table grants just to discover group
  -- identity/version.
  v_state:=public.get_appointment_series(
    'f1610000-0000-4000-8000-000000000001',v_series
  );
  v_first_group:=(v_state->'occurrences'->0->>'groupId')::uuid;
  v_first_version:=(v_state->'occurrences'->0->>'version')::integer;
  if v_first_group is null or v_first_version is null then
    raise exception 'F16-01 series payload did not expose first occurrence identity: %',v_state;
  end if;

  perform public.set_appointment_group_status(
    'f1610000-0000-4000-8000-000000000001',
    v_first_group,'f1601-series-first-confirm',v_first_version,'confirmed'
  );
  v_state:=public.get_appointment_series(
    'f1610000-0000-4000-8000-000000000001',v_series
  );
  v_first_version:=(v_state->'occurrences'->0->>'version')::integer;

  perform public.set_appointment_group_status(
    'f1610000-0000-4000-8000-000000000001',
    v_first_group,'f1601-series-first-complete',v_first_version,'completed'
  );

  v_preview:=public.preview_appointment_series_future(
    'f1610000-0000-4000-8000-000000000001',
    v_series,1,'reschedule_future',
    '2027-03-21 12:00 Europe/Berlin'::timestamptz
  );
  if (v_preview->>'allAvailable')::boolean is not true
     or jsonb_array_length(v_preview->'targets')<>2
     or jsonb_array_length(v_preview->'skipped')<>1 then
    raise exception 'F16-01 future preview target set wrong: %',v_preview;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_preview->'skipped') x
    where (x->>'ordinal')::integer=1 and x->>'reason'='not_mutable'
  ) then
    raise exception 'F16-01 completed occurrence was not preserved by preview: %',v_preview;
  end if;
  select count(*)::integer into v_bad
  from jsonb_array_elements(v_preview->'targets') x
  where (x->>'ordinal')::integer not in (2,3)
     or (x->>'targetStartsAt')::timestamptz at time zone 'Europe/Berlin'::text
        is null;
  if v_bad<>0 then raise exception 'F16-01 future preview exposed wrong targets: %',v_preview; end if;
  select count(*)::integer into v_bad
  from jsonb_array_elements(v_preview->'targets') x
  where ((x->>'targetStartsAt')::timestamptz at time zone 'Europe/Berlin')::time<>time '12:00';
  if v_bad<>0 then raise exception 'F16-01 future preview drifted new local time: %',v_preview; end if;

  v_move:=public.reschedule_appointment_series_future(
    'f1610000-0000-4000-8000-000000000001',
    v_series,'f1601-series-future-move',1,1,
    '2027-03-21 12:00 Europe/Berlin'::timestamptz
  );
  if (v_move->>'version')::integer<>2 then
    raise exception 'F16-01 future reschedule did not bump series version once: %',v_move;
  end if;

  -- Completed occurrence stays at 10:00; only ordinals 2-3 move to 12:00.
  v_state:=public.get_appointment_series(
    'f1610000-0000-4000-8000-000000000001',v_series
  );
  select count(*)::integer into v_bad
  from jsonb_array_elements(v_state->'occurrences') o
  cross join lateral jsonb_array_elements(o->'lines') l
  where
    ((o->>'seriesOrdinal')::integer=1 and (
      l->>'status'<>'completed'
      or ((l->>'startsAt')::timestamptz at time zone 'Europe/Berlin')::time<>time '10:00'
    ))
    or
    ((o->>'seriesOrdinal')::integer in (2,3) and (
      l->>'status' not in ('scheduled','confirmed')
      or ((l->>'startsAt')::timestamptz at time zone 'Europe/Berlin')::time<>time '12:00'
    ));
  if v_bad<>0 then raise exception 'F16-01 future reschedule rewrote protected history or missed future targets'; end if;

  -- Exact replay returns the already-mutated series without another version bump.
  v_replay:=public.reschedule_appointment_series_future(
    'f1610000-0000-4000-8000-000000000001',
    v_series,'f1601-series-future-move',1,1,
    '2027-03-21 12:00 Europe/Berlin'::timestamptz
  );
  if (v_replay->>'version')::integer<>2 then
    raise exception 'F16-01 future reschedule replay mutated series again: %',v_replay;
  end if;
  if (select count(*) from jsonb_array_elements(v_replay->'events') e
      where e->>'eventType'='future_rescheduled')<>1 then
    raise exception 'F16-01 future reschedule replay duplicated audit';
  end if;

  v_cancel:=public.cancel_appointment_series_future(
    'f1610000-0000-4000-8000-000000000001',
    v_series,'f1601-series-future-cancel',2,1,'Plan değişti'
  );
  if (v_cancel->>'version')::integer<>3 or v_cancel->>'status'<>'cancelled' then
    raise exception 'F16-01 future cancel did not close the remaining series: %',v_cancel;
  end if;

  select count(*)::integer into v_bad
  from jsonb_array_elements(v_cancel->'occurrences') o
  cross join lateral jsonb_array_elements(o->'lines') l
  where
    ((o->>'seriesOrdinal')::integer=1 and l->>'status'<>'completed')
    or
    ((o->>'seriesOrdinal')::integer in (2,3) and l->>'status'<>'cancelled');
  if v_bad<>0 then raise exception 'F16-01 future cancel touched completed history or missed future groups'; end if;

  if (select count(*) from jsonb_array_elements(v_cancel->'events') e
      where e->>'eventType'='future_cancelled')<>1 then
    raise exception 'F16-01 future cancel audit missing';
  end if;
end
$f16_future_scope$;

-- Another tenant cannot inspect a future mutation scope either.
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000002',true);
do $f16_cross_tenant_future$
declare v_error text;
begin
  begin
    perform public.preview_appointment_series_future(
      'f1610000-0000-4000-8000-000000000001',
      current_setting('f1601.series_id')::uuid,
      1,'cancel_future',null
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('NOT_ALLOWED' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 foreign tenant could inspect future series scope: %',v_error;
  end if;
end
$f16_cross_tenant_future$;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);

-- Tenant-wide closure must reject the exact blocked occurrence date.
reset role;
insert into public.availability_blocks(
  id,business_id,staff_id,starts_at,ends_at,reason,active
) values (
  'f16a0000-0000-4000-8000-000000000001',
  'f1610000-0000-4000-8000-000000000001',
  null,
  '2027-05-09 11:30 Europe/Berlin'::timestamptz,
  '2027-05-09 12:30 Europe/Berlin'::timestamptz,
  'F16-01 closure',
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f16_closure_conflict$
declare v_error text;
begin
  begin
    perform public.create_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      'f1601-series-closure-fail',
      'Closure Seri',
      '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-05-02 12:00 Europe/Berlin'::timestamptz,
      'weekly',3,'05551601003'
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('SERIES_OCCURRENCE_UNAVAILABLE:2:2027-05-09' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 closure conflict did not identify occurrence date: %',v_error;
  end if;
end
$f16_closure_conflict$;

reset role;
delete from public.availability_blocks
where id='f16a0000-0000-4000-8000-000000000001';

-- Staff-specific leave uses the same canonical availability authority and must
-- also report the exact occurrence date.
insert into public.availability_blocks(
  id,business_id,staff_id,starts_at,ends_at,reason,active
) values (
  'f16a0000-0000-4000-8000-000000000002',
  'f1610000-0000-4000-8000-000000000001',
  'f1640000-0000-4000-8000-000000000001',
  '2027-06-13 11:30 Europe/Berlin'::timestamptz,
  '2027-06-13 12:30 Europe/Berlin'::timestamptz,
  'F16-01 staff leave',
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f16_leave_conflict$
declare v_error text;
begin
  begin
    perform public.create_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      'f1601-series-leave-fail',
      'Leave Seri',
      '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-06-06 12:00 Europe/Berlin'::timestamptz,
      'weekly',3,'05551601004'
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('SERIES_OCCURRENCE_UNAVAILABLE:2:2027-06-13' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 staff leave conflict did not identify occurrence date: %',v_error;
  end if;
end
$f16_leave_conflict$;

reset role;
delete from public.availability_blocks
where id='f16a0000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

-- Put one canonical group on the second occurrence of a different series intent.
-- The candidate's first occurrence would be placeable; the second conflicts.
do $f16_blocker$
begin
  perform public.create_appointment_group(
    'f1610000-0000-4000-8000-000000000001',
    'f1601-blocker-group-0001',
    'Bloklayan Müşteri',
    '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2027-04-11 12:00 Europe/Berlin'::timestamptz,
    '05551601999'
  );
end
$f16_blocker$;

reset role;
select set_config('f1601.series_before',
  (select count(*)::text from public.appointment_series
   where business_id='f1610000-0000-4000-8000-000000000001'),false);
select set_config('f1601.groups_before',
  (select count(*)::text from public.appointment_groups
   where business_id='f1610000-0000-4000-8000-000000000001'),false);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f16_atomic_conflict$
declare v_error text;
begin
  begin
    perform public.create_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      'f1601-series-create-fail',
      'Atomic Seri',
      '[{"serviceId":"f1630000-0000-4000-8000-000000000001","staffId":"f1640000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-04-04 12:00 Europe/Berlin'::timestamptz,
      'weekly',3,'05551601002'
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('SERIES_OCCURRENCE_UNAVAILABLE:2:2027-04-11' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 middle conflict was not occurrence-specific: %',v_error;
  end if;
end
$f16_atomic_conflict$;

reset role;
do $f16_atomic_shape$
begin
  if (select count(*) from public.appointment_series
      where business_id='f1610000-0000-4000-8000-000000000001')
     <>current_setting('f1601.series_before')::integer then
    raise exception 'F16-01 failed series left a header behind';
  end if;
  if (select count(*) from public.appointment_groups
      where business_id='f1610000-0000-4000-8000-000000000001')
     <>current_setting('f1601.groups_before')::integer then
    raise exception 'F16-01 failed series left a partial occurrence group behind';
  end if;
  if exists (
    select 1 from public.appointment_series_commands
    where business_id='f1610000-0000-4000-8000-000000000001'
      and idempotency_key='f1601-series-create-fail'
  ) then raise exception 'F16-01 failed series left its command behind'; end if;
  if exists (
    select 1 from public.booking_commands
    where business_id='f1610000-0000-4000-8000-000000000001'
      and idempotency_key like 'f16c:%'
      and created_at>statement_timestamp()-interval '1 minute'
      and appointment_id is null
  ) then raise exception 'F16-01 failed series left an unfinished child command'; end if;
end
$f16_atomic_shape$;

-- Another tenant cannot use the series RPC to inspect tenant A.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f16_cross_tenant$
declare v_error text;
begin
  begin
    perform public.get_appointment_series(
      'f1610000-0000-4000-8000-000000000001',
      current_setting('f1601.series_id')::uuid
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('NOT_ALLOWED' in coalesce(v_error,''))=0 then
    raise exception 'F16-01 foreign tenant could read series: %',v_error;
  end if;
end
$f16_cross_tenant$;

-- K03 performance evidence: 12 timezone-aware candidates remain trivially bounded.
reset role;
do $f16_measure$
declare
  v_started timestamptz:=clock_timestamp();
  v_count integer;
  v_elapsed_ms numeric;
begin
  select count(*)::integer into v_count
  from public.f16_series_candidates(
    'f1610000-0000-4000-8000-000000000001',
    '2027-03-21 10:00 Europe/Berlin'::timestamptz,
    'weekly',12
  );
  v_elapsed_ms:=extract(epoch from (clock_timestamp()-v_started))*1000;
  if v_count<>12 then raise exception 'F16-01 12-candidate measurement returned %',v_count; end if;
  if v_elapsed_ms>100 then raise exception 'F16-01 12-candidate enumeration exceeded 100ms: % ms',v_elapsed_ms; end if;
  raise notice 'F16-01 K03 enumeration: occurrences=12 elapsed_ms=%',round(v_elapsed_ms,3);
end
$f16_measure$;

rollback;
