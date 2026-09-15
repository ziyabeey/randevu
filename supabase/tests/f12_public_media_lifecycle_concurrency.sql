create extension if not exists dblink;

insert into auth.users(id, email, raw_user_meta_data)
values ('ca000000-0000-4000-8000-000000000001', 'f12-lifecycle-race@example.invalid', '{"full_name":"F12 Lifecycle Race"}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values (
  'cb000000-0000-4000-8000-000000000001',
  'F12 Lifecycle Race', 'f12-lifecycle-race', 'Europe/Istanbul',
  'ca000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id, business_id, user_id, role, active)
values (
  'cc000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001',
  'ca000000-0000-4000-8000-000000000001',
  'owner', true
)
on conflict(business_id, user_id) do update set role='owner', active=true;

delete from public.business_public_media
where business_id='cb000000-0000-4000-8000-000000000001';

insert into public.business_public_media(
  id, business_id, storage_path, status, alt_text, sort_order,
  mime_type, size_bytes, width, height, created_by, updated_at
) values (
  'cd000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001/cd000000-0000-4000-8000-000000000001.webp',
  'pending', null, 0, 'image/webp', 1000, 800, 600,
  'ca000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '16 minutes'
);

do $$
declare
  v_waited boolean := false;
  v_count integer;
begin
  perform dblink_connect(
    'f12_lifecycle_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f12_lifecycle_a'
  );
  perform dblink_connect(
    'f12_lifecycle_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f12_lifecycle_b'
  );
  perform dblink_exec('f12_lifecycle_a', 'set statement_timeout=5000');
  perform dblink_exec('f12_lifecycle_b', 'set statement_timeout=5000');

  perform dblink_exec('f12_lifecycle_a', 'begin');
  perform dblink_exec('f12_lifecycle_a', 'set local role authenticated');
  perform dblink_exec('f12_lifecycle_a', $q$set local "request.jwt.claim.sub" = 'ca000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f12_lifecycle_a', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  -- Finalize wins the business lifecycle lock first, but the transaction stays
  -- open so the cleanup claimant must wait before observing the final state.
  if dblink_send_query(
    'f12_lifecycle_a',
    $q$
      select (public.finalize_business_public_media_upload(
        'cb000000-0000-4000-8000-000000000001',
        'cd000000-0000-4000-8000-000000000001'
      )).status
    $q$
  ) <> 1 then raise exception 'could not start F12 finalize race'; end if;
  perform * from dblink_get_result('f12_lifecycle_a') as t(status text);
  perform * from dblink_get_result('f12_lifecycle_a') as t(status text);

  perform dblink_exec('f12_lifecycle_b', 'begin');
  perform dblink_exec('f12_lifecycle_b', 'set local role authenticated');
  perform dblink_exec('f12_lifecycle_b', $q$set local "request.jwt.claim.sub" = 'ca000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f12_lifecycle_b', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  if dblink_send_query(
    'f12_lifecycle_b',
    $q$
      select count(*)::integer
      from public.list_business_public_media_cleanup('cb000000-0000-4000-8000-000000000001')
    $q$
  ) <> 1 then raise exception 'could not start F12 cleanup race'; end if;

  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f12_lifecycle_b' and wait_event_type='Lock'
    ) then v_waited := true; exit; end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then raise exception 'cleanup claimant did not serialize on the business lifecycle lock'; end if;

  perform dblink_exec('f12_lifecycle_a', 'commit');
  select t.count into v_count
  from dblink_get_result('f12_lifecycle_b') as t(count integer);
  perform * from dblink_get_result('f12_lifecycle_b') as t(count integer);
  perform dblink_exec('f12_lifecycle_b', 'commit');

  if v_count <> 0 then raise exception 'cleanup reclaimed media after finalize won the lifecycle race'; end if;
  if not exists(
    select 1 from public.business_public_media
    where business_id='cb000000-0000-4000-8000-000000000001'
      and id='cd000000-0000-4000-8000-000000000001'
      and status='ready'
  ) then raise exception 'finalize winner did not remain ready'; end if;

  perform dblink_disconnect('f12_lifecycle_a');
  perform dblink_disconnect('f12_lifecycle_b');
end
$$;

-- Opposite winner: a stale claim transitions to cleanup first. A late finalizer
-- must fail closed instead of resurrecting the object as public/ready.
insert into public.business_public_media(
  id, business_id, storage_path, status, alt_text, sort_order,
  mime_type, size_bytes, width, height, created_by, updated_at
) values (
  'cd000000-0000-4000-8000-000000000002',
  'cb000000-0000-4000-8000-000000000001',
  'cb000000-0000-4000-8000-000000000001/cd000000-0000-4000-8000-000000000002.webp',
  'pending', null, 1, 'image/webp', 1000, 800, 600,
  'ca000000-0000-4000-8000-000000000001',
  clock_timestamp() - interval '16 minutes'
);

set role authenticated;
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', false);

do $$
declare r record;
begin
  select * into r
  from public.list_business_public_media_cleanup('cb000000-0000-4000-8000-000000000001')
  where id='cd000000-0000-4000-8000-000000000002';
  if r.id is null then raise exception 'stale cleanup winner was not claimed'; end if;

  begin
    perform public.finalize_business_public_media_upload(
      'cb000000-0000-4000-8000-000000000001',
      'cd000000-0000-4000-8000-000000000002'
    );
    raise exception 'late finalize resurrected a reclaimed item';
  exception when others then
    if sqlerrm = 'late finalize resurrected a reclaimed item' then raise; end if;
    if position('PUBLIC_MEDIA_STATE_CONFLICT' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);

delete from public.businesses where id='cb000000-0000-4000-8000-000000000001';
delete from auth.users where id='ca000000-0000-4000-8000-000000000001';