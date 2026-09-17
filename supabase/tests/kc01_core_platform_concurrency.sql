create extension if not exists dblink;

-- KC-01 concurrency: two physical sessions apply the same platform command with
-- the same idempotency key. The second session must block on the first claim
-- row, then return the identical result. Exactly one business, one alias, one
-- ledger row and one provisioning event may exist afterwards.

insert into auth.users(id, email, raw_user_meta_data)
values ('c0120000-0000-4000-8000-000000000001', 'kc01-race-owner@example.invalid', '{"full_name":"KC01 Race Owner"}'::jsonb)
on conflict (id) do nothing;

select core.register_service_principal('kepenk-race', core.hash_secret('kc01-race-secret-eeeeeeeeeeeeeeeeeeeeeeeeeeee'));

do $$
declare
  v_lock_key bigint := hashtextextended('tenant_alias:legacy-kepenk-firestore:esnaf-race', 0);
  v_lock_available boolean;
  v_attempt integer := 0;
  v_waited boolean := false;
  v_a jsonb;
  v_b jsonb;
  v_c jsonb;
  v_business uuid;
  v_command text := $c$
    select v.j
    from public.core_apply_platform_command(
      'kepenk-race',
      'kc01-race-secret-eeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'kc01-race-key-0001',
      'ProvisionBusiness',
      '{"owner_user_id":"c0120000-0000-4000-8000-000000000001","name":"KC01 Race","slug":"kc01-race","tenant_alias":{"provider":"legacy-kepenk-firestore","external_id":"esnaf-race"}}'::jsonb
    ) as v(j)
  $c$;
begin
  perform dblink_connect(
    'kc01_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=kc01_a'
  );
  perform dblink_connect(
    'kc01_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=kc01_b'
  );

  perform dblink_exec('kc01_a', 'set statement_timeout=5000');
  perform dblink_exec('kc01_b', 'set statement_timeout=5000');
  perform dblink_exec('kc01_a', 'set role anon');
  perform dblink_exec('kc01_b', 'set role anon');

  -- Session A applies the command and deliberately holds its transaction (and
  -- therefore the uncommitted ledger claim row) for two seconds.
  if dblink_send_query(
    'kc01_a',
    v_command || ' cross join lateral (select pg_sleep(2) where v.j is not null) hold_claim'
  ) <> 1 then
    raise exception 'could not start first platform command';
  end if;

  -- Wait until A owns the transaction-scoped alias advisory lock taken by ProvisionBusiness.
  loop
    v_lock_available := pg_try_advisory_lock(v_lock_key);
    if not v_lock_available then
      exit;
    end if;
    perform pg_advisory_unlock(v_lock_key);
    v_attempt := v_attempt + 1;
    if v_attempt > 100 then
      raise exception 'first platform command never acquired the alias advisory lock';
    end if;
    perform pg_sleep(0.02);
  end loop;

  -- Session B replays the same key while A is still open. It must wait on A.
  if dblink_send_query('kc01_b', v_command) <> 1 then
    raise exception 'could not start second platform command';
  end if;

  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
      from pg_stat_activity
      where application_name = 'kc01_b'
        and wait_event_type = 'Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then
    raise exception 'second platform command did not wait on the idempotency claim';
  end if;

  select t.j into v_a from dblink_get_result('kc01_a') as t(j jsonb);
  select t.j into v_b from dblink_get_result('kc01_b') as t(j jsonb);

  if v_a is null or not (v_a ->> 'ok')::boolean then
    raise exception 'first platform command failed: %', v_a;
  end if;
  if v_b is distinct from v_a then
    raise exception 'concurrent replay returned a different result: % vs %', v_a, v_b;
  end if;

  v_business := (v_a -> 'data' ->> 'business_id')::uuid;

  if (select count(*) from public.businesses where slug = 'kc01-race') <> 1 then
    raise exception 'concurrent provisioning created % businesses', (select count(*) from public.businesses where slug = 'kc01-race');
  end if;
  if (select count(*) from core.tenant_aliases where provider = 'legacy-kepenk-firestore' and external_id = 'esnaf-race') <> 1 then
    raise exception 'concurrent provisioning did not leave exactly one alias';
  end if;
  if (select count(*) from core.platform_commands where idempotency_key = 'kc01-race-key-0001') <> 1 then
    raise exception 'concurrent provisioning did not leave exactly one ledger row';
  end if;
  if (select count(*) from core.subscription_events where business_id = v_business and event_type = 'business_provisioned') <> 1 then
    raise exception 'concurrent provisioning did not leave exactly one provisioning event';
  end if;

  -- A later call with a different key but the same legacy alias resolves to the
  -- same business without creating anything.
  v_c := public.core_apply_platform_command(
    'kepenk-race',
    'kc01-race-secret-eeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'kc01-race-key-0002',
    'ProvisionBusiness',
    '{"owner_user_id":"c0120000-0000-4000-8000-000000000001","name":"KC01 Race Again","slug":"kc01-race-again","tenant_alias":{"provider":"legacy-kepenk-firestore","external_id":"esnaf-race"}}'::jsonb
  );
  if not (v_c ->> 'ok')::boolean
     or (v_c -> 'data' ->> 'created')::boolean
     or (v_c -> 'data' ->> 'business_id')::uuid <> v_business then
    raise exception 'cross-key alias replay did not resolve to the existing business: %', v_c;
  end if;
  if exists (select 1 from public.businesses where slug = 'kc01-race-again') then
    raise exception 'cross-key alias replay created a second business';
  end if;

  perform dblink_disconnect('kc01_a');
  perform dblink_disconnect('kc01_b');
  raise notice 'KC-01 idempotency race: one provisioning committed, concurrent replay returned the same result';
exception when others then
  begin perform dblink_disconnect('kc01_a'); exception when others then null; end;
  begin perform dblink_disconnect('kc01_b'); exception when others then null; end;
  raise;
end
$$;

-- This concurrency fixture intentionally commits into the disposable yzt_test DB.
-- No later product test depends on these IDs.
