create extension if not exists dblink;
-- Different real sessions contend on prepare, including the initially empty row.
create function public._s05_prepare(p_operation uuid) returns text language plpgsql as $$
begin
  perform public.begin_staging_key_rotation(p_operation,
    encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),
    repeat('b',64),repeat('c',64),'50500000-0000-4000-8000-000000000001',repeat('a',40),'{}');
  return 'prepared';
exception when others then return sqlerrm;
end $$;
revoke all on function public._s05_prepare(uuid) from public,anon,authenticated,service_role;
do $$ declare a text; b text; waited boolean := false; begin
  perform dblink_connect('s05_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s05_a');
  perform dblink_connect('s05_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s05_b');
  perform dblink_exec('s05_a','set statement_timeout=5000');
  perform dblink_exec('s05_b','set statement_timeout=5000');
  perform dblink_exec('s05_a','begin');
  select result into a from dblink('s05_a', $q$select public._s05_prepare('50500000-0000-4000-8000-000000000021')$q$) as t(result text);
  if a <> 'prepared' then raise exception 'S05 first prepare failed'; end if;
  perform dblink_send_query('s05_b',$q$select public._s05_prepare('50500000-0000-4000-8000-000000000022')$q$);
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='s05_b' and wait_event_type='Lock') then waited:=true; exit; end if;
    perform pg_sleep(0.01);
  end loop;
  if not waited then raise exception 'S05 no real prepare contention'; end if;
  perform dblink_exec('s05_a','commit');
  select result into b from dblink_get_result('s05_b') as t(result text);
  if b <> 'STAGING_KEY_TRANSITION_PENDING' then raise exception 'S05 concurrent prepare overwrote pending generation'; end if;
  perform dblink_disconnect('s05_a'); perform dblink_disconnect('s05_b');
end $$;
drop function public._s05_prepare(uuid);
select public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000021',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),false);

-- A concurrent promote and abort cannot both succeed or produce a mixed pair.
select public.begin_staging_key_rotation('50500000-0000-4000-8000-000000000023',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),
  repeat('b',64),repeat('c',64),'50500000-0000-4000-8000-000000000001',repeat('a',40),'{}');
create function public._s05_finish(p_promote boolean) returns text language plpgsql as $$
begin
  perform public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000023',
    encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),p_promote);
  return 'finished';
exception when others then return sqlerrm;
end $$;
revoke all on function public._s05_finish(boolean) from public,anon,authenticated,service_role;
do $$ declare a text; b text; waited boolean := false; begin
  perform dblink_connect('s05_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s05_a');
  perform dblink_connect('s05_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=s05_b');
  perform dblink_exec('s05_a','set statement_timeout=5000'); perform dblink_exec('s05_b','set statement_timeout=5000');
  perform dblink_exec('s05_a','begin');
  select result into a from dblink('s05_a','select public._s05_finish(true)') as t(result text);
  if a <> 'finished' then raise exception 'S05 first finalizer failed'; end if;
  perform dblink_send_query('s05_b','select public._s05_finish(false)');
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists(select 1 from pg_stat_activity where application_name='s05_b' and wait_event_type='Lock') then waited:=true; exit; end if;
    perform pg_sleep(0.01);
  end loop;
  if not waited then raise exception 'S05 no real finalizer contention'; end if;
  perform dblink_exec('s05_a','commit');
  select result into b from dblink_get_result('s05_b') as t(result text);
  if b <> 'STAGING_KEY_STATE_CONFLICT' then raise exception 'S05 two finalizers succeeded'; end if;
  if exists(select 1 from public.staging_key_transition)
    or (select gate_secret_hash from public.public_booking_abuse_config where config_key='default') <> repeat('b',64)
    or (select secret_hash from public.notification_dispatch_config where config_key='default') <> repeat('c',64)
    then raise exception 'S05 concurrent finish left a mixed pair'; end if;
  perform dblink_disconnect('s05_a'); perform dblink_disconnect('s05_b');
end $$;
drop function public._s05_finish(boolean);
