-- KC-01 acceptance (clean lane on the shared chain): schema closure, service
-- principal authorization and rotation overlap, idempotency ledger, alias
-- uniqueness, ProvisionBusiness, subscription -> entitlement derivation,
-- has_entitlement / snapshot session guards, append-only events, change feed.
-- Authorization assertions run as anon/authenticated through the granted RPCs,
-- never through the table owner.
begin;

create function pg_temp.kc01_assert(p_ok boolean, p_msg text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'KC01 assertion failed: %', p_msg;
  end if;
end $$;

create function pg_temp.kc01_err(p_result jsonb)
returns text language sql immutable as $$
  select p_result -> 'error' ->> 'message'
$$;

-- Runs one platform command as the anon API role and restores the owner role.
create function pg_temp.kc01_cmd(
  p_key text, p_cmd text, p_payload jsonb,
  p_secret text default 'kc01-principal-secret-aaaaaaaaaaaaaaaaaaaaaaaa',
  p_name text default 'kepenk-web'
)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role anon';
  v := public.core_apply_platform_command(p_name, p_secret, p_key, p_cmd, p_payload);
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  raise;
end $$;

create function pg_temp.kc01_feed(
  p_after bigint, p_limit integer,
  p_secret text default 'kc01-principal-secret-aaaaaaaaaaaaaaaaaaaaaaaa'
)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role anon';
  v := public.core_read_change_feed('kepenk-web', p_secret, p_after, p_limit);
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  raise;
end $$;

-- Runs has_entitlement as an authenticated session with the given amr method.
create function pg_temp.kc01_has(p_user uuid, p_business uuid, p_key text, p_amr text default 'password')
returns boolean language plpgsql as $$
declare v boolean;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'amr', jsonb_build_array(jsonb_build_object('method', p_amr)))::text, true);
  v := public.has_entitlement(p_business, p_key);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
  return v;
exception when others then
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
  raise;
end $$;

create function pg_temp.kc01_snapshot(p_user uuid, p_business uuid, p_amr text default 'password')
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'amr', jsonb_build_array(jsonb_build_object('method', p_amr)))::text, true);
  v := public.get_business_platform_snapshot(p_business);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
  return v;
exception when others then
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
  raise;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: real tenant/role rows, disposable ids under the c01 prefix.
-- ---------------------------------------------------------------------------
insert into auth.users(id, email, raw_user_meta_data)
values
  ('c0100000-0000-4000-8000-000000000001', 'kc01-owner-a@example.invalid', '{"full_name":"KC01 Owner A"}'::jsonb),
  ('c0100000-0000-4000-8000-000000000002', 'kc01-owner-b@example.invalid', '{"full_name":"KC01 Owner B"}'::jsonb),
  ('c0100000-0000-4000-8000-000000000003', 'kc01-staff-c@example.invalid', '{"full_name":"KC01 Staff C"}'::jsonb),
  ('c0100000-0000-4000-8000-000000000004', 'kc01-outsider-d@example.invalid', '{"full_name":"KC01 Outsider D"}'::jsonb)
on conflict (id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('c0110000-0000-4000-8000-000000000001', 'KC01 Tenant A', 'kc01-tenant-a', 'Europe/Istanbul', 'c0100000-0000-4000-8000-000000000001'),
  ('c0110000-0000-4000-8000-000000000002', 'KC01 Tenant B', 'kc01-tenant-b', 'Europe/Istanbul', 'c0100000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

insert into public.memberships(business_id, user_id, role, active)
values
  ('c0110000-0000-4000-8000-000000000001', 'c0100000-0000-4000-8000-000000000001', 'owner', true),
  ('c0110000-0000-4000-8000-000000000001', 'c0100000-0000-4000-8000-000000000003', 'staff', true),
  ('c0110000-0000-4000-8000-000000000002', 'c0100000-0000-4000-8000-000000000002', 'owner', true)
on conflict (business_id, user_id) do update set active = true, role = excluded.role;

select core.register_service_principal('kepenk-web', core.hash_secret('kc01-principal-secret-aaaaaaaaaaaaaaaaaaaaaaaa'));
select core.register_service_principal('kepenk-inactive', core.hash_secret('kc01-inactive-secret-bbbbbbbbbbbbbbbbbbbbbbbb'));
update core.service_principals set active = false where name = 'kepenk-inactive';

-- ---------------------------------------------------------------------------
-- 1. Schema and object closure for API roles (S08 discipline).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  perform pg_temp.kc01_assert(
    not has_schema_privilege('anon', 'core', 'USAGE')
    and not has_schema_privilege('authenticated', 'core', 'USAGE'),
    'core schema USAGE leaked to an API role');

  for r in
    select c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'core' and c.relkind in ('r', 'v', 'S')
  loop
    if r.relkind = 'r' then
      perform pg_temp.kc01_assert(r.relrowsecurity and r.relforcerowsecurity,
        'core.' || r.relname || ' is not RLS enabled+forced');
      perform pg_temp.kc01_assert(
        not has_table_privilege('anon', 'core.' || quote_ident(r.relname), 'SELECT')
        and not has_table_privilege('anon', 'core.' || quote_ident(r.relname), 'INSERT')
        and not has_table_privilege('anon', 'core.' || quote_ident(r.relname), 'UPDATE')
        and not has_table_privilege('anon', 'core.' || quote_ident(r.relname), 'DELETE')
        and not has_table_privilege('authenticated', 'core.' || quote_ident(r.relname), 'SELECT')
        and not has_table_privilege('authenticated', 'core.' || quote_ident(r.relname), 'INSERT')
        and not has_table_privilege('authenticated', 'core.' || quote_ident(r.relname), 'UPDATE')
        and not has_table_privilege('authenticated', 'core.' || quote_ident(r.relname), 'DELETE'),
        'core.' || r.relname || ' privileges leaked to an API role');
    elsif r.relkind = 'S' then
      perform pg_temp.kc01_assert(
        not has_sequence_privilege('anon', 'core.' || quote_ident(r.relname), 'USAGE')
        and not has_sequence_privilege('authenticated', 'core.' || quote_ident(r.relname), 'USAGE'),
        'core.' || r.relname || ' sequence privileges leaked');
    end if;
  end loop;

  perform pg_temp.kc01_assert(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'core' and c.relkind = 'r') = 8,
    'unexpected core table count');

  -- Internal helpers and the error whitelist are not executable by API roles.
  perform pg_temp.kc01_assert(
    not has_function_privilege('anon', 'core.authorize_service_principal(text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'core.authorize_service_principal(text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'core.command_provision_business(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'core.command_provision_business(uuid,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.core_platform_error(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.core_platform_error(text)', 'EXECUTE'),
    'internal core function EXECUTE leaked');

  -- Explicit RPC grants: command + feed for the machine (anon key) path only,
  -- entitlement + snapshot for authenticated sessions only.
  perform pg_temp.kc01_assert(
    has_function_privilege('anon', 'public.core_apply_platform_command(text,text,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.core_apply_platform_command(text,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('anon', 'public.core_read_change_feed(text,text,bigint,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.core_read_change_feed(text,text,bigint,integer)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.has_entitlement(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.has_entitlement(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_business_platform_snapshot(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_business_platform_snapshot(uuid)', 'EXECUTE'),
    'RPC grant matrix differs from the KC-01 contract');
end $$;

-- Disposable future-object probe inside core: no grant appears without an explicit GRANT.
create table core.kc01_acl_probe (
  id bigint generated by default as identity primary key,
  payload text not null
);
create function core.kc01_acl_probe_fn() returns integer language sql as 'select 1';
do $$
begin
  perform pg_temp.kc01_assert(
    not has_table_privilege('anon', 'core.kc01_acl_probe', 'SELECT')
    and not has_table_privilege('authenticated', 'core.kc01_acl_probe', 'SELECT')
    and not has_sequence_privilege('anon', 'core.kc01_acl_probe_id_seq', 'USAGE')
    and not has_sequence_privilege('authenticated', 'core.kc01_acl_probe_id_seq', 'USAGE')
    and not has_function_privilege('anon', 'core.kc01_acl_probe_fn()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'core.kc01_acl_probe_fn()', 'EXECUTE'),
    'future core object inherited API-role privileges');
end $$;
drop function core.kc01_acl_probe_fn();
drop table core.kc01_acl_probe;

-- ---------------------------------------------------------------------------
-- 2. Principal authorization negatives and request validation.
-- ---------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := pg_temp.kc01_cmd('kc01-key-auth-0001', 'LinkTenantAlias', '{}'::jsonb, 'kc01-wrong-secret-cccccccccccccccccccccccccccc');
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'CORE_PRINCIPAL_UNAUTHORIZED', 'wrong secret accepted: ' || v::text);

  v := pg_temp.kc01_cmd('kc01-key-auth-0002', 'LinkTenantAlias', '{}'::jsonb, 'short');
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'CORE_PRINCIPAL_UNAUTHORIZED', 'short secret accepted');

  v := pg_temp.kc01_cmd('kc01-key-auth-0003', 'LinkTenantAlias', '{}'::jsonb, 'kc01-inactive-secret-bbbbbbbbbbbbbbbbbbbbbbbb', 'kepenk-inactive');
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'CORE_PRINCIPAL_UNAUTHORIZED', 'inactive principal accepted');

  v := pg_temp.kc01_cmd('kc01-key-auth-0004', 'LinkTenantAlias', '{}'::jsonb, 'kc01-principal-secret-aaaaaaaaaaaaaaaaaaaaaaaa', 'no-such-principal');
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'CORE_PRINCIPAL_UNAUTHORIZED', 'unknown principal accepted');

  v := pg_temp.kc01_cmd('short', 'LinkTenantAlias', '{}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_IDEMPOTENCY_KEY', 'short idempotency key accepted');

  v := pg_temp.kc01_cmd('kc01-key-auth-0005', 'DropEverything', '{}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_PLATFORM_COMMAND', 'unknown command accepted');

  v := pg_temp.kc01_cmd('kc01-key-auth-0006', 'LinkTenantAlias', '[]'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_PLATFORM_PAYLOAD', 'array payload accepted');

  perform pg_temp.kc01_assert(
    (select count(*) from core.platform_commands) = 0,
    'rejected commands must not enter the ledger');
end $$;

-- ---------------------------------------------------------------------------
-- 3. LinkTenantAlias: idempotency ledger and alias uniqueness.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"c0100000-0000-4000-8000-000000000004"}', true);

do $$
declare
  v jsonb; v2 jsonb;
  v_payload jsonb := jsonb_build_object(
    'provider', 'legacy-kepenk-firestore', 'external_id', 'esnaf-001',
    'business_id', 'c0110000-0000-4000-8000-000000000001');
begin
  v := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload);
  perform pg_temp.kc01_assert((v->>'ok')::boolean and (v->'data'->>'linked')::boolean, 'first alias link failed: ' || v::text);
  perform pg_temp.kc01_assert(
    (select count(*) from core.tenant_aliases where provider = 'legacy-kepenk-firestore' and external_id = 'esnaf-001') = 1,
    'alias row missing');
  perform pg_temp.kc01_assert(
    (select count(*) from core.subscription_events
     where business_id = 'c0110000-0000-4000-8000-000000000001' and event_type = 'tenant_alias_linked') = 1,
    'alias event missing');

  -- Same key + same payload: identical result, no new rows.
  v2 := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload);
  perform pg_temp.kc01_assert(v2 = v, 'replay result differs');
  perform pg_temp.kc01_assert((select count(*) from core.tenant_aliases) = 1, 'replay created a second alias');
  perform pg_temp.kc01_assert(
    (select count(*) from core.subscription_events where event_type = 'tenant_alias_linked') = 1,
    'replay created a second event');

  -- Same key + different payload: conflict.
  v2 := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload || '{"external_id":"esnaf-002"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'PLATFORM_IDEMPOTENCY_CONFLICT', 'payload drift accepted: ' || v2::text);

  -- Same alias bound to another business: fail closed.
  v2 := pg_temp.kc01_cmd('kc01-key-alias-0002', 'LinkTenantAlias', v_payload || '{"business_id":"c0110000-0000-4000-8000-000000000002"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'TENANT_ALIAS_CONFLICT', 'alias rebind accepted: ' || v2::text);

  -- Second alias of the same provider on the same business: taken.
  v2 := pg_temp.kc01_cmd('kc01-key-alias-0003', 'LinkTenantAlias', v_payload || '{"external_id":"esnaf-003"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'TENANT_ALIAS_BUSINESS_TAKEN', 'second provider alias accepted: ' || v2::text);

  v2 := pg_temp.kc01_cmd('kc01-key-alias-0004', 'LinkTenantAlias', v_payload || '{"business_id":"c0110000-0000-4000-8000-0000000000ff"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'BUSINESS_NOT_FOUND', 'unknown business accepted');

  v2 := pg_temp.kc01_cmd('kc01-key-alias-0005', 'LinkTenantAlias', v_payload || '{"business_id":"not-a-uuid"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'BUSINESS_NOT_FOUND', 'malformed business id leaked an internal error: ' || v2::text);

  -- Different key, same alias, same business: idempotent success without a new row.
  v2 := pg_temp.kc01_cmd('kc01-key-alias-0006', 'LinkTenantAlias', v_payload);
  perform pg_temp.kc01_assert((v2->>'ok')::boolean and not (v2->'data'->>'linked')::boolean, 'cross-key replay failed: ' || v2::text);
  perform pg_temp.kc01_assert((select count(*) from core.tenant_aliases) = 1, 'cross-key replay created a row');

  -- Failed commands leave no ledger row; successful ones are completed.
  perform pg_temp.kc01_assert(
    (select count(*) from core.platform_commands) = 2
    and (select bool_and(result is not null and completed_at is not null) from core.platform_commands),
    'ledger shape differs (expected two completed rows)');
end $$;

-- Incidental JWT settings survive a command round trip.
select pg_temp.kc01_assert(
  current_setting('request.jwt.claim.sub', true) = 'c0100000-0000-4000-8000-000000000004'
  and current_setting('request.jwt.claims', true)::jsonb ->> 'sub' = 'c0100000-0000-4000-8000-000000000004',
  'jwt settings were not restored after LinkTenantAlias');

-- ---------------------------------------------------------------------------
-- 4. LinkIdentityAlias.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb; v2 jsonb;
  v_payload jsonb := jsonb_build_object(
    'provider', 'firebase', 'external_subject', 'firebase-uid-a',
    'user_id', 'c0100000-0000-4000-8000-000000000001');
begin
  v := pg_temp.kc01_cmd('kc01-key-ident-0001', 'LinkIdentityAlias', v_payload);
  perform pg_temp.kc01_assert((v->>'ok')::boolean and (v->'data'->>'linked')::boolean, 'identity link failed: ' || v::text);
  v2 := pg_temp.kc01_cmd('kc01-key-ident-0001', 'LinkIdentityAlias', v_payload);
  perform pg_temp.kc01_assert(v2 = v, 'identity replay differs');

  v2 := pg_temp.kc01_cmd('kc01-key-ident-0002', 'LinkIdentityAlias', v_payload || '{"user_id":"c0100000-0000-4000-8000-000000000002"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'IDENTITY_ALIAS_CONFLICT', 'subject rebind accepted');

  v2 := pg_temp.kc01_cmd('kc01-key-ident-0003', 'LinkIdentityAlias', v_payload || '{"external_subject":"firebase-uid-a2"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'IDENTITY_ALIAS_USER_TAKEN', 'second provider subject accepted');

  v2 := pg_temp.kc01_cmd('kc01-key-ident-0004', 'LinkIdentityAlias', v_payload || '{"user_id":"c0100000-0000-4000-8000-0000000000ff"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'USER_NOT_FOUND', 'unknown user accepted');

  perform pg_temp.kc01_assert((select count(*) from core.identity_aliases) = 1, 'identity alias count differs');
end $$;

-- ---------------------------------------------------------------------------
-- 5. ProvisionBusiness.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb; v2 jsonb;
  v_business uuid;
  v_before integer := (select count(*) from public.businesses);
  v_payload jsonb := jsonb_build_object(
    'owner_user_id', 'c0100000-0000-4000-8000-000000000002',
    'name', 'Kepenk Berber',
    'slug', 'kc01-kepenk-berber',
    'tenant_alias', jsonb_build_object('provider', 'legacy-kepenk-firestore', 'external_id', 'esnaf-100'));
begin
  v := pg_temp.kc01_cmd('kc01-key-prov-0001', 'ProvisionBusiness', v_payload);
  perform pg_temp.kc01_assert((v->>'ok')::boolean and (v->'data'->>'created')::boolean, 'provision failed: ' || v::text);
  v_business := (v->'data'->>'business_id')::uuid;
  perform pg_temp.kc01_assert(
    (select b.slug = 'kc01-kepenk-berber' and b.created_by = 'c0100000-0000-4000-8000-000000000002'
     from public.businesses b where b.id = v_business),
    'business row differs');
  perform pg_temp.kc01_assert(
    (select m.role = 'owner' and m.active from public.memberships m
     where m.business_id = v_business and m.user_id = 'c0100000-0000-4000-8000-000000000002'),
    'owner membership missing');
  perform pg_temp.kc01_assert(
    (select a.business_id = v_business from core.tenant_aliases a
     where a.provider = 'legacy-kepenk-firestore' and a.external_id = 'esnaf-100'),
    'tenant alias not linked');
  perform pg_temp.kc01_assert(
    (select count(*) from core.subscription_events where business_id = v_business) = 2
    and exists (select 1 from core.subscription_events where business_id = v_business and event_type = 'business_provisioned')
    and exists (select 1 from core.subscription_events where business_id = v_business and event_type = 'tenant_alias_linked'),
    'provision events differ');
  perform pg_temp.kc01_assert((select count(*) from public.businesses) = v_before + 1, 'business count differs after provision');

  -- Same key: identical result, zero new rows.
  v2 := pg_temp.kc01_cmd('kc01-key-prov-0001', 'ProvisionBusiness', v_payload);
  perform pg_temp.kc01_assert(v2 = v, 'provision replay differs');
  perform pg_temp.kc01_assert((select count(*) from public.businesses) = v_before + 1, 'provision replay created a business');

  -- Different key, same legacy alias: existing business is returned, nothing new.
  v2 := pg_temp.kc01_cmd('kc01-key-prov-0002', 'ProvisionBusiness', v_payload || '{"slug":"kc01-kepenk-berber-2"}'::jsonb);
  perform pg_temp.kc01_assert(
    (v2->>'ok')::boolean and not (v2->'data'->>'created')::boolean
    and (v2->'data'->>'business_id')::uuid = v_business,
    'alias replay did not return the existing business: ' || v2::text);
  perform pg_temp.kc01_assert((select count(*) from public.businesses) = v_before + 1, 'alias replay created a business');

  -- Slug already taken: fail closed, no partial rows, no ledger row.
  v2 := pg_temp.kc01_cmd('kc01-key-prov-0003', 'ProvisionBusiness',
    jsonb_build_object('owner_user_id', 'c0100000-0000-4000-8000-000000000002', 'name', 'Taken Slug', 'slug', 'kc01-tenant-a'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'BUSINESS_SLUG_TAKEN', 'slug collision was renamed or accepted: ' || v2::text);
  perform pg_temp.kc01_assert((select count(*) from public.businesses) = v_before + 1, 'slug collision created a business');
  perform pg_temp.kc01_assert(
    not exists (select 1 from core.platform_commands where idempotency_key = 'kc01-key-prov-0003'),
    'failed provision left a ledger row');

  v2 := pg_temp.kc01_cmd('kc01-key-prov-0004', 'ProvisionBusiness',
    jsonb_build_object('owner_user_id', 'c0100000-0000-4000-8000-000000000002', 'name', 'Bad Slug', 'slug', 'Bad Slug'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'INVALID_BUSINESS_SLUG', 'invalid slug accepted');

  v2 := pg_temp.kc01_cmd('kc01-key-prov-0005', 'ProvisionBusiness',
    jsonb_build_object('owner_user_id', 'c0100000-0000-4000-8000-0000000000ff', 'name', 'No Owner', 'slug', 'kc01-no-owner'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'USER_NOT_FOUND', 'unknown owner accepted');

  v2 := pg_temp.kc01_cmd('kc01-key-prov-0006', 'ProvisionBusiness',
    jsonb_build_object('owner_user_id', 'c0100000-0000-4000-8000-000000000002', 'name', 'x', 'slug', 'kc01-short-name'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'INVALID_BUSINESS_NAME', 'short name accepted');

  -- Cross-tenant negative: an alias already owned by tenant A cannot be
  -- re-provisioned under a different owner as a new business.
  v2 := pg_temp.kc01_cmd('kc01-key-prov-0007', 'ProvisionBusiness',
    jsonb_build_object('owner_user_id', 'c0100000-0000-4000-8000-000000000004', 'name', 'Hijack', 'slug', 'kc01-hijack',
      'tenant_alias', jsonb_build_object('provider', 'legacy-kepenk-firestore', 'external_id', 'esnaf-001')));
  perform pg_temp.kc01_assert(
    (v2->>'ok')::boolean and not (v2->'data'->>'created')::boolean
    and (v2->'data'->>'business_id')::uuid = 'c0110000-0000-4000-8000-000000000001'
    and (v2->'data'->>'membership_id') is null,
    'foreign alias provisioning created a business or membership: ' || v2::text);
  perform pg_temp.kc01_assert(
    not exists (select 1 from public.memberships where business_id = 'c0110000-0000-4000-8000-000000000001'
                and user_id = 'c0100000-0000-4000-8000-000000000004'),
    'outsider gained membership through alias replay');
  perform pg_temp.kc01_assert((select count(*) from public.businesses) = v_before + 1, 'hijack attempt created a business');
end $$;

select pg_temp.kc01_assert(
  current_setting('request.jwt.claim.sub', true) = 'c0100000-0000-4000-8000-000000000004'
  and current_setting('request.jwt.claims', true)::jsonb ->> 'sub' = 'c0100000-0000-4000-8000-000000000004',
  'jwt settings were not restored after ProvisionBusiness');

-- Principal quota (S04 counter keyed by principal): the 101st creation in the window is limited.
do $$
declare
  v jsonb;
  v_hash text := core.hash_secret('principal:' || (select id from core.service_principals where name = 'kepenk-web')::text);
begin
  for i in 1..100 loop
    perform public.consume_public_booking_rate('business_create', 'user', v_hash, 1000, 3600);
  end loop;
  v := pg_temp.kc01_cmd('kc01-key-prov-0010', 'ProvisionBusiness',
    jsonb_build_object('owner_user_id', 'c0100000-0000-4000-8000-000000000002', 'name', 'Quota Hit', 'slug', 'kc01-quota-hit'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$', 'principal quota not enforced: ' || v::text);
  perform pg_temp.kc01_assert(not exists (select 1 from public.businesses where slug = 'kc01-quota-hit'), 'quota-limited provision created a business');
  delete from public.public_booking_rate_counters where action = 'business_create' and dimension = 'user' and key_hash = v_hash;
end $$;

-- ---------------------------------------------------------------------------
-- 6. ChangeSubscription -> entitlements -> has_entitlement / snapshot.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb; v2 jsonb;
  v_a uuid := 'c0110000-0000-4000-8000-000000000001';
  v_owner_a uuid := 'c0100000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'c0100000-0000-4000-8000-000000000002';
  v_staff_c uuid := 'c0100000-0000-4000-8000-000000000003';
  v_payload jsonb := jsonb_build_object(
    'business_id', v_a, 'plan_key', 'kepenk_standard', 'status', 'active',
    'current_period_start', '2026-09-16T00:00:00Z', 'current_period_end', '2026-10-16T00:00:00Z',
    'source', jsonb_build_object('provider', 'iyzico', 'event_id', 'evt-0001'));
begin
  -- Before any subscription: closed.
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'booking'), 'entitlement granted before subscription');

  v := pg_temp.kc01_cmd('kc01-key-sub-0001', 'ChangeSubscription', v_payload);
  perform pg_temp.kc01_assert((v->>'ok')::boolean and (v->'data'->>'version')::bigint = 1 and (v->'data'->>'policy_version')::integer = 1,
    'subscription change failed: ' || v::text);
  perform pg_temp.kc01_assert(
    (select s.plan_key = 'kepenk_standard' and s.status = 'active' from core.subscriptions s where s.business_id = v_a),
    'subscription row differs');
  perform pg_temp.kc01_assert(
    (select count(*) from core.entitlements e where e.business_id = v_a and e.granted) = 3,
    'plan entitlements not derived');
  perform pg_temp.kc01_assert(
    (select e.valid_until = '2026-10-16T00:00:00Z'::timestamptz from core.entitlements e where e.business_id = v_a and e.entitlement_key = 'booking'),
    'entitlement validity not bound to the period end');

  perform pg_temp.kc01_assert(pg_temp.kc01_has(v_owner_a, v_a, 'booking'), 'owner lost booking entitlement');
  perform pg_temp.kc01_assert(pg_temp.kc01_has(v_staff_c, v_a, 'ai_booking_assistant'), 'active staff member lost entitlement');
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_b, v_a, 'booking'), 'non-member gained entitlement');
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'custom_domain'), 'missing entitlement did not fail closed');
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, null, 'booking'), 'null business did not fail closed');

  -- Replay is stable.
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0001', 'ChangeSubscription', v_payload);
  perform pg_temp.kc01_assert(v2 = v, 'subscription replay differs');
  perform pg_temp.kc01_assert(
    (select count(*) from core.subscription_events where business_id = v_a and event_type = 'subscription_changed') = 1,
    'subscription replay appended an event');

  -- Snapshot for a member, denied for a non-member.
  v2 := pg_temp.kc01_snapshot(v_owner_a, v_a);
  perform pg_temp.kc01_assert(
    (v2->>'ok')::boolean and v2->'data'->'subscription'->>'plan_key' = 'kepenk_standard'
    and jsonb_array_length(v2->'data'->'entitlements') = 3,
    'snapshot differs: ' || v2::text);
  v2 := pg_temp.kc01_snapshot(v_owner_b, v_a);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'BUSINESS_ACCESS_DENIED', 'non-member read the snapshot: ' || v2::text);

  -- Validation negatives.
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0002', 'ChangeSubscription', v_payload || '{"plan_key":"no_such_plan"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'PLAN_NOT_FOUND', 'unknown plan accepted');
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0003', 'ChangeSubscription', v_payload || '{"status":"weird"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'INVALID_SUBSCRIPTION_STATUS', 'unknown status accepted');
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0004', 'ChangeSubscription', v_payload || '{"current_period_end":"2026-09-01T00:00:00Z"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'INVALID_SUBSCRIPTION_PERIOD', 'inverted period accepted');
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0005', 'ChangeSubscription', v_payload || '{"current_period_end":"garbage"}'::jsonb);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v2) = 'INVALID_SUBSCRIPTION_PERIOD', 'garbage period leaked an internal error: ' || v2::text);

  -- Cancel: the next entitlement read fails closed.
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0006', 'ChangeSubscription', v_payload || '{"status":"cancelled"}'::jsonb);
  perform pg_temp.kc01_assert((v2->>'ok')::boolean and (v2->'data'->>'version')::bigint = 2, 'cancel failed: ' || v2::text);
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'booking'), 'cancelled subscription kept booking');

  -- Re-activate.
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0007', 'ChangeSubscription', v_payload);
  perform pg_temp.kc01_assert((v2->'data'->>'version')::bigint = 3, 'reactivation version differs');
  perform pg_temp.kc01_assert(pg_temp.kc01_has(v_owner_a, v_a, 'booking'), 'reactivation did not restore booking');

  -- past_due keeps grants (grace) but records the event.
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0008', 'ChangeSubscription', v_payload || '{"status":"past_due"}'::jsonb);
  perform pg_temp.kc01_assert((v2->>'ok')::boolean, 'past_due failed');
  perform pg_temp.kc01_assert(pg_temp.kc01_has(v_owner_a, v_a, 'booking'), 'past_due revoked booking');
  perform pg_temp.kc01_assert(
    (select count(*) from core.subscription_events where business_id = v_a and event_type = 'subscription_changed') = 4,
    'subscription event count differs');

  -- Plan downgrade: keys absent from the new plan are revoked.
  insert into core.plan_entitlements (plan_key, entitlement_key, granted, limit_value, policy_version)
  values ('kc01_lite', 'booking', true, null, 7);
  v2 := pg_temp.kc01_cmd('kc01-key-sub-0009', 'ChangeSubscription', v_payload || '{"plan_key":"kc01_lite"}'::jsonb);
  perform pg_temp.kc01_assert((v2->>'ok')::boolean and (v2->'data'->>'policy_version')::integer = 7, 'downgrade failed: ' || v2::text);
  perform pg_temp.kc01_assert(pg_temp.kc01_has(v_owner_a, v_a, 'booking'), 'downgrade lost the retained key');
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'ai_booking_assistant'), 'downgrade kept a revoked key');
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'messaging_credits'), 'downgrade kept a revoked key (messaging)');
end $$;

-- Recovery sessions cannot read entitlements or the snapshot.
do $$
begin
  begin
    perform pg_temp.kc01_has('c0100000-0000-4000-8000-000000000001', 'c0110000-0000-4000-8000-000000000001', 'booking', 'recovery');
    raise exception 'KC01 assertion failed: recovery session read has_entitlement';
  exception when others then
    if sqlerrm <> 'PASSWORD_UPDATE_REQUIRED' then raise; end if;
  end;
  perform pg_temp.kc01_assert(
    pg_temp.kc01_err(pg_temp.kc01_snapshot('c0100000-0000-4000-8000-000000000001', 'c0110000-0000-4000-8000-000000000001', 'recovery'))
      = 'PASSWORD_UPDATE_REQUIRED',
    'recovery session read the snapshot');
end $$;

-- Anonymous callers cannot execute the authenticated read primitives at all.
do $$
begin
  execute 'set local role anon';
  begin
    perform public.has_entitlement('c0110000-0000-4000-8000-000000000001', 'booking');
    execute 'reset role';
    raise exception 'KC01 assertion failed: anon executed has_entitlement';
  exception when insufficient_privilege then
    execute 'reset role';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. GrantEntitlement / RevokeEntitlement.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_a uuid := 'c0110000-0000-4000-8000-000000000001';
  v_owner_a uuid := 'c0100000-0000-4000-8000-000000000001';
begin
  v := pg_temp.kc01_cmd('kc01-key-ent-0001', 'GrantEntitlement',
    jsonb_build_object('business_id', v_a, 'entitlement_key', 'custom_domain', 'valid_until', (clock_timestamp() + interval '1 day')::text));
  perform pg_temp.kc01_assert((v->>'ok')::boolean, 'grant failed: ' || v::text);
  perform pg_temp.kc01_assert(pg_temp.kc01_has(v_owner_a, v_a, 'custom_domain'), 'granted entitlement not visible');

  v := pg_temp.kc01_cmd('kc01-key-ent-0002', 'RevokeEntitlement', jsonb_build_object('business_id', v_a, 'entitlement_key', 'custom_domain'));
  perform pg_temp.kc01_assert((v->>'ok')::boolean and not (v->'data'->>'granted')::boolean, 'revoke failed: ' || v::text);
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'custom_domain'), 'revoked entitlement still visible');

  v := pg_temp.kc01_cmd('kc01-key-ent-0003', 'GrantEntitlement',
    jsonb_build_object('business_id', v_a, 'entitlement_key', 'custom_domain', 'valid_until', (clock_timestamp() - interval '1 second')::text));
  perform pg_temp.kc01_assert((v->>'ok')::boolean, 'expired grant command failed');
  perform pg_temp.kc01_assert(not pg_temp.kc01_has(v_owner_a, v_a, 'custom_domain'), 'expired entitlement treated as granted');

  v := pg_temp.kc01_cmd('kc01-key-ent-0004', 'GrantEntitlement', jsonb_build_object('business_id', v_a, 'entitlement_key', 'custom_domain', 'limit_value', -1));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_ENTITLEMENT_LIMIT', 'negative limit accepted');
  v := pg_temp.kc01_cmd('kc01-key-ent-0005', 'GrantEntitlement', jsonb_build_object('business_id', v_a, 'entitlement_key', 'Bad Key'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_ENTITLEMENT_KEY', 'bad key accepted');
  v := pg_temp.kc01_cmd('kc01-key-ent-0006', 'GrantEntitlement', jsonb_build_object('business_id', v_a, 'entitlement_key', 'custom_domain', 'valid_until', 'garbage'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_ENTITLEMENT_VALIDITY', 'garbage validity accepted');
  v := pg_temp.kc01_cmd('kc01-key-ent-0007', 'RevokeEntitlement', jsonb_build_object('business_id', 'c0110000-0000-4000-8000-0000000000ff', 'entitlement_key', 'custom_domain'));
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'BUSINESS_NOT_FOUND', 'revoke on unknown business accepted');
end $$;

-- ---------------------------------------------------------------------------
-- 8. Commercial history is append-only even for the owner role.
-- ---------------------------------------------------------------------------
do $$
declare v_id bigint := (select min(id) from core.subscription_events);
begin
  begin
    update core.subscription_events set plan_key = 'tampered' where id = v_id;
    raise exception 'KC01 assertion failed: subscription event was updated';
  exception when others then
    if sqlerrm <> 'SUBSCRIPTION_EVENTS_APPEND_ONLY' then raise; end if;
  end;
  begin
    delete from core.subscription_events where id = v_id;
    raise exception 'KC01 assertion failed: subscription event was deleted';
  exception when others then
    if sqlerrm <> 'SUBSCRIPTION_EVENTS_APPEND_ONLY' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Change feed cursor for the projection job.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_total bigint := (select count(*) from core.subscription_events);
  v_seen bigint := 0;
  v_after bigint := 0;
  v_pages integer := 0;
begin
  perform pg_temp.kc01_assert(v_total >= 5, 'fixture produced too few events for the feed test');

  v := pg_temp.kc01_feed(0, 2);
  perform pg_temp.kc01_assert(
    (v->>'ok')::boolean and jsonb_array_length(v->'data'->'events') = 2 and (v->'data'->>'has_more')::boolean
    and (v->'data'->>'next_after_event_id')::bigint = (v->'data'->'events'->1->>'event_id')::bigint,
    'first feed page differs: ' || v::text);

  loop
    v := pg_temp.kc01_feed(v_after, 3);
    perform pg_temp.kc01_assert((v->>'ok')::boolean, 'feed page failed: ' || v::text);
    v_seen := v_seen + jsonb_array_length(v->'data'->'events');
    v_pages := v_pages + 1;
    exit when not (v->'data'->>'has_more')::boolean;
    v_after := (v->'data'->>'next_after_event_id')::bigint;
    perform pg_temp.kc01_assert(v_pages < 1000, 'feed never terminated');
  end loop;
  perform pg_temp.kc01_assert(v_seen = v_total, 'feed pagination lost or duplicated events');

  v := pg_temp.kc01_feed(v_total, 10);
  perform pg_temp.kc01_assert(
    jsonb_array_length(v->'data'->'events') = 0 and not (v->'data'->>'has_more')::boolean
    and (v->'data'->>'next_after_event_id')::bigint = v_total,
    'empty feed page differs: ' || v::text);

  v := pg_temp.kc01_feed(0, 101);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_FEED_LIMIT', 'oversized feed limit accepted');
  v := pg_temp.kc01_feed(-1, 10);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'INVALID_FEED_CURSOR', 'negative cursor accepted');
  v := pg_temp.kc01_feed(0, 10, 'kc01-wrong-secret-cccccccccccccccccccccccccccc');
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'CORE_PRINCIPAL_UNAUTHORIZED', 'feed served with a wrong secret');
end $$;

-- ---------------------------------------------------------------------------
-- 10. Secret rotation with an overlap window.
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_old text := 'kc01-principal-secret-aaaaaaaaaaaaaaaaaaaaaaaa';
  v_new text := 'kc01-principal-secret-dddddddddddddddddddddddd';
  v_payload jsonb := jsonb_build_object(
    'provider', 'legacy-kepenk-firestore', 'external_id', 'esnaf-001',
    'business_id', 'c0110000-0000-4000-8000-000000000001');
begin
  perform core.rotate_service_principal_secret('kepenk-web', core.hash_secret(v_new), interval '1 hour');

  v := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload, v_old);
  perform pg_temp.kc01_assert((v->>'ok')::boolean, 'old secret rejected inside the overlap window');
  v := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload, v_new);
  perform pg_temp.kc01_assert((v->>'ok')::boolean, 'new secret rejected after rotation');

  update core.service_principals
  set previous_valid_until = clock_timestamp() - interval '1 second'
  where name = 'kepenk-web';

  v := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload, v_old);
  perform pg_temp.kc01_assert(pg_temp.kc01_err(v) = 'CORE_PRINCIPAL_UNAUTHORIZED', 'old secret accepted after the overlap window');
  v := pg_temp.kc01_cmd('kc01-key-alias-0001', 'LinkTenantAlias', v_payload, v_new);
  perform pg_temp.kc01_assert((v->>'ok')::boolean, 'new secret rejected after the overlap window');

  begin
    perform core.rotate_service_principal_secret('no-such-principal', core.hash_secret(v_new));
    raise exception 'KC01 assertion failed: rotating an unknown principal succeeded';
  exception when others then
    if sqlerrm <> 'SERVICE_PRINCIPAL_NOT_FOUND' then raise; end if;
  end;
end $$;

commit;
