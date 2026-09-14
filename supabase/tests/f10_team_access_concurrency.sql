create extension if not exists dblink;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('a2000000-0000-4000-8000-000000000001', 'f10-race-owner-a@example.invalid', '{"full_name":"F10 Race Owner A"}'::jsonb),
  ('a2000000-0000-4000-8000-000000000002', 'f10-race-owner-b@example.invalid', '{"full_name":"F10 Race Owner B"}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values (
  'a2100000-0000-4000-8000-000000000001',
  'F10 Owner Race', 'f10-owner-race', 'Europe/Istanbul',
  'a2000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id, business_id, user_id, role, active)
values
  (
    'a2200000-0000-4000-8000-000000000001',
    'a2100000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'owner', true
  ),
  (
    'a2200000-0000-4000-8000-000000000002',
    'a2100000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000002',
    'owner', true
  )
on conflict(business_id, user_id) do update set role='owner', active=true;

-- Session A is deliberately started first and held after the mutation while the
-- transaction-scoped business advisory lock is still owned. Session B then
-- attempts to deactivate the only remaining owner. It must block, re-read the
-- post-A state, and fail with LAST_ACTIVE_OWNER instead of allowing zero owners.
do $$
declare
  v_business uuid := 'a2100000-0000-4000-8000-000000000001';
  v_lock_key bigint := hashtextextended('a2100000-0000-4000-8000-000000000001', 0);
  v_lock_available boolean;
  v_attempt integer := 0;
  v_waited boolean := false;
  v_a_membership uuid;
  v_owner_count integer;
  v_role_a public.membership_role;
  v_active_a boolean;
  v_role_b public.membership_role;
  v_active_b boolean;
begin
  perform dblink_connect(
    'f10_owner_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f10_owner_a'
  );
  perform dblink_connect(
    'f10_owner_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f10_owner_b'
  );

  perform dblink_exec('f10_owner_a', 'set statement_timeout=5000');
  perform dblink_exec('f10_owner_b', 'set statement_timeout=5000');
  perform dblink_exec('f10_owner_a', 'set role authenticated');
  perform dblink_exec('f10_owner_b', 'set role authenticated');
  perform dblink_exec(
    'f10_owner_a',
    $q$set "request.jwt.claim.sub" = 'a2000000-0000-4000-8000-000000000001'$q$
  );
  perform dblink_exec(
    'f10_owner_b',
    $q$set "request.jwt.claim.sub" = 'a2000000-0000-4000-8000-000000000002'$q$
  );

  if dblink_send_query(
    'f10_owner_a',
    $q$
      select u.membership_id
      from public.update_team_membership(
        'a2100000-0000-4000-8000-000000000001',
        'a2200000-0000-4000-8000-000000000001',
        'manager', true
      ) u
      cross join lateral (
        select pg_sleep(2)
        where u.membership_id is not null
      ) hold_lock
    $q$
  ) <> 1 then
    raise exception 'could not start first owner mutation';
  end if;

  loop
    v_lock_available := pg_try_advisory_lock(v_lock_key);
    if not v_lock_available then
      exit;
    end if;
    perform pg_advisory_unlock(v_lock_key);
    v_attempt := v_attempt + 1;
    if v_attempt > 100 then
      raise exception 'first owner mutation never acquired the business advisory lock';
    end if;
    perform pg_sleep(0.02);
  end loop;

  -- The second physical session must actually wait on the first session's lock.
  if dblink_send_query(
    'f10_owner_b',
    $q$
      select membership_id
      from public.update_team_membership(
        'a2100000-0000-4000-8000-000000000001',
        'a2200000-0000-4000-8000-000000000002',
        'owner', false
      )
    $q$
  ) <> 1 then
    raise exception 'could not start second owner mutation';
  end if;

  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
      from pg_stat_activity
      where application_name = 'f10_owner_b'
        and wait_event_type = 'Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then
    raise exception 'second owner mutation did not wait on the business lock';
  end if;

  select t.membership_id into v_a_membership
  from dblink_get_result('f10_owner_a') as t(membership_id uuid);
  if v_a_membership is distinct from 'a2200000-0000-4000-8000-000000000001'::uuid then
    raise exception 'first owner mutation returned unexpected membership: %', v_a_membership;
  end if;

  begin
    perform *
    from dblink_get_result('f10_owner_b') as t(
      membership_id uuid,
      role public.membership_role,
      active boolean
    );
    raise exception 'second concurrent owner mutation unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'second concurrent owner mutation unexpectedly succeeded' then
      raise;
    end if;
    if position('LAST_ACTIVE_OWNER' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  select count(*) into v_owner_count
  from public.memberships
  where business_id = v_business
    and role = 'owner'
    and active;
  if v_owner_count <> 1 then
    raise exception 'concurrent owner mutations left % active owners', v_owner_count;
  end if;

  select role, active into v_role_a, v_active_a
  from public.memberships
  where id = 'a2200000-0000-4000-8000-000000000001';
  select role, active into v_role_b, v_active_b
  from public.memberships
  where id = 'a2200000-0000-4000-8000-000000000002';

  if v_role_a <> 'manager' or not v_active_a then
    raise exception 'first owner mutation did not commit as manager/active';
  end if;
  if v_role_b <> 'owner' or not v_active_b then
    raise exception 'second owner was not preserved as the last active owner';
  end if;

  perform dblink_disconnect('f10_owner_a');
  perform dblink_disconnect('f10_owner_b');
  raise notice 'F10 last-owner race: one demotion committed, competing deactivation rejected';
exception when others then
  begin perform dblink_disconnect('f10_owner_a'); exception when others then null; end;
  begin perform dblink_disconnect('f10_owner_b'); exception when others then null; end;
  raise;
end
$$;

-- This concurrency fixture intentionally commits into the disposable yzt_test DB.
-- No later product test depends on these IDs.
