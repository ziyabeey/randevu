begin;
do $$ declare v_role text; v_name text; begin
  if not public.public_booking_gate_authorized(repeat('old-gate-',8))
     or not public.notification_dispatch_authorized(repeat('old-dispatch-',6))
     or exists(select 1 from public.staging_key_transition) then raise exception 'S05 migration changed existing runtime keys'; end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(v_role,'public.staging_key_transition','SELECT') or has_table_privilege(v_role,'public.staging_key_transition','INSERT')
       or has_table_privilege(v_role,'public.staging_cron_heartbeat','SELECT') then raise exception 'S05 control tables exposed to %',v_role; end if;
    foreach v_name in array array['public.begin_staging_key_rotation(uuid,text,text,text,text,uuid,text,jsonb)',
      'public.finish_staging_key_rotation(uuid,text,text,boolean)','public.public_booking_gate_authorized(text)',
      'public.notification_dispatch_authorized(text)'] loop
      if has_function_privilege(v_role,v_name,'EXECUTE') then raise exception 'S05 control function exposed to %',v_role; end if;
    end loop;
  end loop;
end $$;

select public.begin_staging_key_rotation('50500000-0000-4000-8000-000000000011',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),
  encode(digest(repeat('new-gate-',8),'sha256'),'hex'),encode(digest(repeat('new-dispatch-',6),'sha256'),'hex'),
  '50500000-0000-4000-8000-000000000001',repeat('a',40),'{"gates":{"f09":true}}');
-- Exact preparation retry is idempotent, but another candidate cannot overwrite it.
select public.begin_staging_key_rotation('50500000-0000-4000-8000-000000000011',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),
  encode(digest(repeat('new-gate-',8),'sha256'),'hex'),encode(digest(repeat('new-dispatch-',6),'sha256'),'hex'),
  '50500000-0000-4000-8000-000000000001',repeat('a',40),'{"gates":{"f09":true}}');

do $$ begin
  if not public.public_booking_gate_authorized(repeat('old-gate-',8)) or not public.public_booking_gate_authorized(repeat('new-gate-',8))
     or not public.notification_dispatch_authorized(repeat('old-dispatch-',6)) or not public.notification_dispatch_authorized(repeat('new-dispatch-',6))
     or public.public_booking_gate_authorized(repeat('wrong',13)) then raise exception 'S05 overlap authorization failed'; end if;
  begin
    perform public.begin_staging_key_rotation('50500000-0000-4000-8000-000000000012',
      encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),
      repeat('b',64),repeat('c',64),'50500000-0000-4000-8000-000000000001',repeat('a',40),'{}');
    raise exception 'S05 second candidate accepted';
  exception when others then if sqlerrm <> 'STAGING_KEY_TRANSITION_PENDING' then raise; end if; end;
end $$;

set local role anon;
do $$ begin
  begin perform public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000011',repeat('a',64),repeat('b',64),true);
    raise exception 'S05 anon finalized'; exception when insufficient_privilege then null; end;
  begin perform public.record_staging_cron_heartbeat(repeat('wrong',13),'50500000-0000-4000-8000-000000000002');
    raise exception 'S05 forged heartbeat'; exception when others then if sqlerrm <> 'STAGING_HEARTBEAT_DENIED' then raise; end if; end;
  perform public.record_staging_cron_heartbeat(repeat('new-dispatch-',6),'50500000-0000-4000-8000-000000000002');
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.staging_cron_heartbeat where version_id='50500000-0000-4000-8000-000000000002'
    and dispatch_hash=encode(digest(repeat('new-dispatch-',6),'sha256'),'hex') and observed_at > clock_timestamp()-interval '10 seconds')
    then raise exception 'S05 heartbeat version/hash/server time not recorded'; end if;
end $$;

-- Abort preserves the original version's authority after a proven rollback.
select public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000011',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),false);
do $$ begin
  if not public.public_booking_gate_authorized(repeat('old-gate-',8)) or public.public_booking_gate_authorized(repeat('new-gate-',8))
    or not public.notification_dispatch_authorized(repeat('old-dispatch-',6)) then raise exception 'S05 abort revoked old keys'; end if;
end $$;
select public.begin_staging_key_rotation('50500000-0000-4000-8000-000000000013',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),
  encode(digest(repeat('new-gate-',8),'sha256'),'hex'),encode(digest(repeat('new-dispatch-',6),'sha256'),'hex'),
  '50500000-0000-4000-8000-000000000001',repeat('a',40),'{}');
-- Wrong operation and stale expected state must not revoke or promote either pair.
do $$ begin
  begin perform public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000011',
    encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),true);
    raise exception 'S05 stale operation accepted'; exception when others then if sqlerrm <> 'STAGING_KEY_STATE_CONFLICT' then raise; end if; end;
  begin perform public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000013',repeat('0',64),repeat('0',64),true);
    raise exception 'S05 stale pair accepted'; exception when others then if sqlerrm <> 'STAGING_KEY_STATE_CONFLICT' then raise; end if; end;
end $$;
select public.finish_staging_key_rotation('50500000-0000-4000-8000-000000000013',
  encode(digest(repeat('old-gate-',8),'sha256'),'hex'),encode(digest(repeat('old-dispatch-',6),'sha256'),'hex'),true);
do $$ begin
  if public.public_booking_gate_authorized(repeat('old-gate-',8)) or public.notification_dispatch_authorized(repeat('old-dispatch-',6))
    or not public.public_booking_gate_authorized(repeat('new-gate-',8)) or not public.notification_dispatch_authorized(repeat('new-dispatch-',6))
    or exists(select 1 from public.staging_key_transition) then raise exception 'S05 promotion did not atomically revoke old keys'; end if;
end $$;
set local role anon;
do $$ begin
  begin perform public.record_staging_cron_heartbeat(repeat('old-dispatch-',6),'50500000-0000-4000-8000-000000000001');
    raise exception 'S05 retired dispatch wrote heartbeat'; exception when others then if sqlerrm <> 'STAGING_HEARTBEAT_DENIED' then raise; end if; end;
end $$;
reset role;
rollback;
