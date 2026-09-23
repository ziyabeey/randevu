create extension if not exists dblink;

delete from public.businesses where id='f1910000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values ('f1900000-0000-4000-8000-000000000001','f1503-race-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1910000-0000-4000-8000-000000000001',
  'F15-03 Race Salon',
  'f1503-race-salon',
  'Europe/Istanbul',
  'f1900000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'f1920000-0000-4000-8000-000000000001',
  'f1910000-0000-4000-8000-000000000001',
  'f1900000-0000-4000-8000-000000000001',
  'owner',
  true
);

set role authenticated;
select set_config('request.jwt.claim.sub','f1900000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $$
declare
  v_event jsonb;
begin
  v_event:=public.create_expense_guarded(
    'f1910000-0000-4000-8000-000000000001',
    'Malzeme',
    'Race source',
    15000,
    'TRY',
    'cash',
    '2026-09-23 10:00:00',
    'f1503-race-source',
    repeat('a',64)
  );
  perform set_config('f1503.race_expense',v_event->>'eventId',false);
end
$$;

reset role;

do $$
declare
  v_business uuid:='f1910000-0000-4000-8000-000000000001';
  v_user uuid:='f1900000-0000-4000-8000-000000000001';
  v_source uuid:=current_setting('f1503.race_expense')::uuid;
  v_conn text;
  v_blocked integer:=0;
  v_correct_ok boolean:=false;
  v_reverse_ok boolean:=false;
  v_correct_failed boolean:=false;
  v_reverse_failed boolean:=false;
  v_result jsonb;
  v_sql_correct text;
  v_sql_reverse text;
begin
  perform dblink_connect(
    'f1503_holder',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f1503_holder'
  );
  perform dblink_exec('f1503_holder','begin');
  if dblink_send_query(
    'f1503_holder',
    format(
      'select id from public.expense_events where business_id=%L::uuid and id=%L::uuid for update',
      v_business,v_source
    )
  )<>1 then
    raise exception 'F15-03 holder query did not start';
  end if;
  perform * from dblink_get_result('f1503_holder') as t(id uuid);
  -- Async dblink results must be fully drained before issuing COMMIT on the
  -- same connection; otherwise libpq still reports an in-progress command.
  perform * from dblink_get_result('f1503_holder',false) as t(id uuid);

  for v_conn in select unnest(array['f1503_correct','f1503_reverse']) loop
    perform dblink_connect(
      v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_conn
    );
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,'set local "request.jwt.claim.sub" = '''||v_user::text||'''');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  v_sql_correct:=format($q$
    select public.correct_expense_guarded(
      %L::uuid,%L::uuid,
      'Race correction',
      'Malzeme','Race replacement',12000,'TRY','card',
      '2026-09-23 10:00:00'::timestamp,
      '2026-09-23 11:00:00'::timestamp,
      'f1503-race-correct',%L
    )
  $q$,v_business,v_source,repeat('b',64));

  v_sql_reverse:=format($q$
    select public.reverse_expense_guarded(
      %L::uuid,%L::uuid,
      'Race cancellation',
      '2026-09-23 11:00:00'::timestamp,
      'f1503-race-reverse',%L
    )
  $q$,v_business,v_source,repeat('c',64));

  if dblink_send_query('f1503_correct',v_sql_correct)<>1
     or dblink_send_query('f1503_reverse',v_sql_reverse)<>1 then
    raise exception 'F15-03 race writers did not start';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1503_correct','f1503_reverse')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;

  if v_blocked<>2 then
    raise exception 'F15-03 race writers did not both park on source lock: %',v_blocked;
  end if;

  perform dblink_exec('f1503_holder','commit');
  perform dblink_disconnect('f1503_holder');

  for i in 1..3000 loop
    exit when dblink_is_busy('f1503_correct')=0 and dblink_is_busy('f1503_reverse')=0;
    perform pg_sleep(0.01);
  end loop;

  if dblink_is_busy('f1503_correct')<>0 or dblink_is_busy('f1503_reverse')<>0 then
    raise exception 'F15-03 timed out waiting for race writers';
  end if;

  begin
    select t.result into strict v_result
    from dblink_get_result('f1503_correct') as t(result jsonb);
    perform * from dblink_get_result('f1503_correct',false) as t(result jsonb);
    if v_result->'reversal' is null or v_result->'replacement' is null then
      raise exception 'F15-03 correction winner returned malformed result: %',v_result;
    end if;
    v_correct_ok:=true;
  exception when others then
    if position('EXPENSE_ALREADY_REVERSED' in sqlerrm)>0
       or position('duplicate key value violates unique constraint "expense_events_one_reversal_idx"' in sqlerrm)>0 then
      v_correct_failed:=true;
    else
      raise;
    end if;
  end;

  begin
    select t.result into strict v_result
    from dblink_get_result('f1503_reverse') as t(result jsonb);
    perform * from dblink_get_result('f1503_reverse',false) as t(result jsonb);
    if v_result->>'eventType'<>'reversal' then
      raise exception 'F15-03 reversal winner returned malformed result: %',v_result;
    end if;
    v_reverse_ok:=true;
  exception when others then
    if position('EXPENSE_ALREADY_REVERSED' in sqlerrm)>0
       or position('duplicate key value violates unique constraint "expense_events_one_reversal_idx"' in sqlerrm)>0 then
      v_reverse_failed:=true;
    else
      raise;
    end if;
  end;

  if v_correct_ok then
    perform dblink_exec('f1503_correct','commit');
  else
    begin perform dblink_exec('f1503_correct','rollback'); exception when others then null; end;
  end if;
  if v_reverse_ok then
    perform dblink_exec('f1503_reverse','commit');
  else
    begin perform dblink_exec('f1503_reverse','rollback'); exception when others then null; end;
  end if;

  perform dblink_disconnect('f1503_correct');
  perform dblink_disconnect('f1503_reverse');

  if (case when v_correct_ok then 1 else 0 end)+(case when v_reverse_ok then 1 else 0 end)<>1 then
    raise exception 'F15-03 race did not produce exactly one winner: correct %, reverse %',
      v_correct_ok,v_reverse_ok;
  end if;
  if not (v_correct_failed or v_reverse_failed) then
    raise exception 'F15-03 losing writer did not fail closed';
  end if;
exception when others then
  begin perform dblink_exec('f1503_holder','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1503_holder'); exception when others then null; end;
  for v_conn in select unnest(array['f1503_correct','f1503_reverse']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$$;

do $$
declare
  v_source uuid:=current_setting('f1503.race_expense')::uuid;
  v_reversals integer;
  v_replacements integer;
  v_finalized_commands integer;
begin
  select count(*)::integer into v_reversals
  from public.expense_events
  where business_id='f1910000-0000-4000-8000-000000000001'
    and source_expense_event_id=v_source
    and event_type='reversal';

  select count(*)::integer into v_replacements
  from public.expense_events
  where business_id='f1910000-0000-4000-8000-000000000001'
    and event_type='expense'
    and id<>v_source;

  select count(*)::integer into v_finalized_commands
  from public.expense_commands
  where business_id='f1910000-0000-4000-8000-000000000001'
    and command in ('correct_expense','reverse_expense')
    and result_payload is not null;

  if v_reversals<>1 then
    raise exception 'F15-03 concurrent correct/reverse persisted % reversals',v_reversals;
  end if;
  if v_replacements not in (0,1) then
    raise exception 'F15-03 concurrent correct/reverse persisted % replacements',v_replacements;
  end if;
  if v_finalized_commands<>1 then
    raise exception 'F15-03 concurrent correct/reverse finalized % command receipts',v_finalized_commands;
  end if;

  raise notice 'F15-03 concurrent correction vs cancellation produced one atomic winner';
end
$$;
