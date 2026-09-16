begin;

-- KC-01: Kepenk Core platform schema v1 and command RPC surface.
--
-- K04 contract: public.profiles / public.businesses / public.memberships stay
-- where they are and remain the identity/tenant authority. This migration adds
-- the `core` schema for aliases, service principals, the platform command
-- ledger, plan policy, subscriptions, append-only subscription events and
-- entitlements. `core` is never exposed through PostgREST; API roles receive no
-- USAGE on the schema and no privileges on any object. All access goes through
-- the explicitly granted `public.core_*` / `public.has_entitlement` RPCs below.

-- ---------------------------------------------------------------------------
-- 1. Schema and S08-style default gate for every future core object.
-- ---------------------------------------------------------------------------
create schema if not exists core;

revoke all on schema core from public;
revoke all on schema core from anon, authenticated;

alter default privileges for role postgres in schema core
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema core
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema core
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema core
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------
create table core.tenant_aliases (
  provider text not null
    check (provider ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and char_length(provider) between 2 and 64),
  external_id text not null check (char_length(external_id) between 1 and 256),
  business_id uuid not null references public.businesses(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (provider, external_id),
  unique (business_id, provider)
);

create table core.identity_aliases (
  provider text not null
    check (provider ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and char_length(provider) between 2 and 64),
  external_subject text not null check (char_length(external_subject) between 1 and 256),
  user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (provider, external_subject),
  unique (user_id, provider)
);

create table core.service_principals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
    check (name ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' and char_length(name) between 2 and 64),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  previous_secret_hash text check (previous_secret_hash ~ '^[0-9a-f]{64}$'),
  previous_valid_until timestamptz,
  active boolean not null default true,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  check ((previous_secret_hash is null) = (previous_valid_until is null))
);

create table core.platform_commands (
  principal_id uuid not null references core.service_principals(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  command text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  business_id uuid references public.businesses(id) on delete restrict,
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (principal_id, idempotency_key)
);

create table core.plan_entitlements (
  plan_key text not null
    check (plan_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' and char_length(plan_key) between 2 and 64),
  entitlement_key text not null
    check (entitlement_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' and char_length(entitlement_key) between 2 and 64),
  granted boolean not null default true,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  policy_version integer not null default 1 check (policy_version >= 1),
  updated_at timestamptz not null default now(),
  primary key (plan_key, entitlement_key)
);

create table core.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete restrict,
  plan_key text not null check (plan_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  status text not null check (status in ('trial', 'active', 'past_due', 'cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  check (
    current_period_start is null
    or current_period_end is null
    or current_period_end > current_period_start
  )
);

create table core.subscription_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  event_type text not null check (event_type in (
    'business_provisioned',
    'tenant_alias_linked',
    'subscription_changed',
    'entitlement_granted',
    'entitlement_revoked'
  )),
  plan_key text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  principal_id uuid not null references core.service_principals(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  policy_version integer check (policy_version is null or policy_version >= 1),
  created_at timestamptz not null default now(),
  unique (principal_id, idempotency_key, event_type, business_id)
);

create index subscription_events_business_idx
  on core.subscription_events (business_id, id);

create table core.entitlements (
  business_id uuid not null references public.businesses(id) on delete restrict,
  entitlement_key text not null
    check (entitlement_key ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' and char_length(entitlement_key) between 2 and 64),
  granted boolean not null default true,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  source_event_id bigint not null references core.subscription_events(id) on delete restrict,
  valid_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, entitlement_key)
);

-- RLS enable + force on every core table. No policy exists, so even a role that
-- somehow reached the schema reads/writes nothing; the owner path used by the
-- SECURITY DEFINER RPCs below is the only writer.
alter table core.tenant_aliases enable row level security;
alter table core.tenant_aliases force row level security;
alter table core.identity_aliases enable row level security;
alter table core.identity_aliases force row level security;
alter table core.service_principals enable row level security;
alter table core.service_principals force row level security;
alter table core.platform_commands enable row level security;
alter table core.platform_commands force row level security;
alter table core.plan_entitlements enable row level security;
alter table core.plan_entitlements force row level security;
alter table core.subscriptions enable row level security;
alter table core.subscriptions force row level security;
alter table core.subscription_events enable row level security;
alter table core.subscription_events force row level security;
alter table core.entitlements enable row level security;
alter table core.entitlements force row level security;

revoke all on all tables in schema core from anon, authenticated;
revoke all on all sequences in schema core from anon, authenticated;

-- Commercial history is append-only (K04 §9). Corrections are new events.
create function core.subscription_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SUBSCRIPTION_EVENTS_APPEND_ONLY' using errcode = '42501';
end
$$;

create trigger subscription_events_append_only
before update or delete on core.subscription_events
for each row execute function core.subscription_events_append_only();

-- ---------------------------------------------------------------------------
-- 3. Launch plan policy (KC-00 product decision). Prices never live here.
-- ---------------------------------------------------------------------------
insert into core.plan_entitlements (plan_key, entitlement_key, granted, limit_value, policy_version)
values
  ('kepenk_standard', 'booking', true, null, 1),
  ('kepenk_standard', 'ai_booking_assistant', true, null, 1),
  -- messaging_credits is the bounded monthly consumable. Its launch allowance is a
  -- product/commercial decision that has not been fixed yet; the row keeps the key
  -- granted with no numeric limit, and the usage ledger (KC-04b) is out of scope.
  ('kepenk_standard', 'messaging_credits', true, null, 1);

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (schema core, never granted to API roles).
-- ---------------------------------------------------------------------------
create function core.hash_secret(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_secret, 'sha256'), 'hex')
$$;

-- Operator helper: register a service principal from an already-hashed secret.
-- The plaintext secret lives in the Kepenk Credential Envelope, never here.
create function core.register_service_principal(p_name text, p_secret_hash text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into core.service_principals (name, secret_hash)
  values (p_name, p_secret_hash)
  on conflict (name) do update set active = true
  returning id into v_id;
  return v_id;
end
$$;

-- Operator helper: rotate with an overlap window during which both hashes verify.
create function core.rotate_service_principal_secret(
  p_name text,
  p_new_secret_hash text,
  p_overlap interval default interval '1 hour'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_overlap is null or p_overlap < interval '0' then
    raise exception 'INVALID_ROTATION_OVERLAP';
  end if;
  update core.service_principals
  set previous_secret_hash = secret_hash,
      previous_valid_until = clock_timestamp() + p_overlap,
      secret_hash = p_new_secret_hash,
      rotated_at = clock_timestamp()
  where name = p_name;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'SERVICE_PRINCIPAL_NOT_FOUND';
  end if;
end
$$;

-- Returns the principal id when the presented secret matches the current hash,
-- or the previous hash inside its overlap window. Inactive principals never match.
create function core.authorize_service_principal(p_name text, p_secret text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select p.id
  from core.service_principals p
  where p.name = p_name
    and p.active
    and p_secret is not null
    and char_length(p_secret) between 43 and 256
    and (
      p.secret_hash = core.hash_secret(p_secret)
      or (
        p.previous_secret_hash is not null
        and p.previous_valid_until > clock_timestamp()
        and p.previous_secret_hash = core.hash_secret(p_secret)
      )
    )
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- 5. Error whitelist (execute_public_operation pattern).
-- ---------------------------------------------------------------------------
create function public.core_platform_error(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('message',
    case
      when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
      when p_message = any (array[
        'CORE_PRINCIPAL_UNAUTHORIZED',
        'INVALID_IDEMPOTENCY_KEY',
        'INVALID_PLATFORM_COMMAND',
        'INVALID_PLATFORM_PAYLOAD',
        'PLATFORM_IDEMPOTENCY_CONFLICT',
        'PLATFORM_IDEMPOTENCY_IN_PROGRESS',
        'BUSINESS_NOT_FOUND',
        'USER_NOT_FOUND',
        'TENANT_ALIAS_CONFLICT',
        'TENANT_ALIAS_BUSINESS_TAKEN',
        'IDENTITY_ALIAS_CONFLICT',
        'IDENTITY_ALIAS_USER_TAKEN',
        'INVALID_BUSINESS_NAME',
        'INVALID_BUSINESS_SLUG',
        'BUSINESS_SLUG_TAKEN',
        'PLAN_NOT_FOUND',
        'INVALID_SUBSCRIPTION_STATUS',
        'INVALID_SUBSCRIPTION_PERIOD',
        'INVALID_ENTITLEMENT_KEY',
        'INVALID_ENTITLEMENT_LIMIT',
        'INVALID_ENTITLEMENT_VALIDITY',
        'INVALID_FEED_CURSOR',
        'INVALID_FEED_LIMIT',
        'AUTH_REQUIRED',
        'AUTH_SESSION_CLASS_UNVERIFIED',
        'PASSWORD_UPDATE_REQUIRED',
        'BUSINESS_ACCESS_DENIED'
      ]) then p_message
      else 'CORE_INTERNAL_ERROR'
    end
  ))
$$;

revoke all on function public.core_platform_error(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Command implementations (schema core, owner-only).
-- ---------------------------------------------------------------------------
create function core.require_uuid(p_value text, p_error text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null then raise exception '%', p_error; end if;
  return p_value::uuid;
exception when invalid_text_representation then
  raise exception '%', p_error;
end
$$;

create function core.lock_business(p_business_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0))
$$;

create function core.lock_tenant_alias(p_provider text, p_external_id text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('tenant_alias:' || p_provider || ':' || p_external_id, 0))
$$;

create function core.command_link_tenant_alias(
  p_principal_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_payload->>'provider', '')));
  v_external_id text := btrim(coalesce(p_payload->>'external_id', ''));
  v_business_id uuid := core.require_uuid(p_payload->>'business_id', 'BUSINESS_NOT_FOUND');
  v_existing core.tenant_aliases;
begin
  if v_provider = '' or v_external_id = '' then
    raise exception 'INVALID_PLATFORM_PAYLOAD';
  end if;
  if not exists (select 1 from public.businesses b where b.id = v_business_id) then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;

  perform core.lock_business(v_business_id);
  perform core.lock_tenant_alias(v_provider, v_external_id);

  select * into v_existing
  from core.tenant_aliases a
  where a.provider = v_provider and a.external_id = v_external_id;

  if found then
    if v_existing.business_id <> v_business_id then
      raise exception 'TENANT_ALIAS_CONFLICT';
    end if;
    return jsonb_build_object(
      'business_id', v_existing.business_id,
      'provider', v_existing.provider,
      'external_id', v_existing.external_id,
      'linked', false
    );
  end if;

  if exists (
    select 1 from core.tenant_aliases a
    where a.business_id = v_business_id and a.provider = v_provider
  ) then
    raise exception 'TENANT_ALIAS_BUSINESS_TAKEN';
  end if;

  insert into core.tenant_aliases (provider, external_id, business_id)
  values (v_provider, v_external_id, v_business_id);

  insert into core.subscription_events (business_id, event_type, payload, principal_id, idempotency_key)
  values (
    v_business_id,
    'tenant_alias_linked',
    jsonb_build_object('provider', v_provider, 'external_id', v_external_id),
    p_principal_id,
    p_idempotency_key
  );

  return jsonb_build_object(
    'business_id', v_business_id,
    'provider', v_provider,
    'external_id', v_external_id,
    'linked', true
  );
end
$$;

create function core.command_link_identity_alias(
  p_principal_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_provider text := lower(btrim(coalesce(p_payload->>'provider', '')));
  v_subject text := btrim(coalesce(p_payload->>'external_subject', ''));
  v_user_id uuid := core.require_uuid(p_payload->>'user_id', 'USER_NOT_FOUND');
  v_existing core.identity_aliases;
begin
  if v_provider = '' or v_subject = '' then
    raise exception 'INVALID_PLATFORM_PAYLOAD';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('identity_alias:' || v_provider || ':' || v_subject, 0));

  select * into v_existing
  from core.identity_aliases a
  where a.provider = v_provider and a.external_subject = v_subject;

  if found then
    if v_existing.user_id <> v_user_id then
      raise exception 'IDENTITY_ALIAS_CONFLICT';
    end if;
    return jsonb_build_object(
      'user_id', v_existing.user_id,
      'provider', v_existing.provider,
      'external_subject', v_existing.external_subject,
      'linked', false
    );
  end if;

  if exists (
    select 1 from core.identity_aliases a
    where a.user_id = v_user_id and a.provider = v_provider
  ) then
    raise exception 'IDENTITY_ALIAS_USER_TAKEN';
  end if;

  insert into core.identity_aliases (provider, external_subject, user_id)
  values (v_provider, v_subject, v_user_id);

  return jsonb_build_object(
    'user_id', v_user_id,
    'provider', v_provider,
    'external_subject', v_subject,
    'linked', true
  );
end
$$;

-- ProvisionBusiness: business + owner membership for an existing platform user,
-- optionally linking a tenant alias in the same command. Re-running with the
-- same alias returns the existing business instead of creating a second one.
create function core.command_provision_business(
  p_principal_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_owner uuid := core.require_uuid(p_payload->>'owner_user_id', 'USER_NOT_FOUND');
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_slug text := lower(btrim(coalesce(p_payload->>'slug', '')));
  v_timezone text := coalesce(nullif(btrim(p_payload->>'timezone'), ''), 'Europe/Istanbul');
  v_alias jsonb := p_payload->'tenant_alias';
  v_alias_provider text;
  v_alias_external_id text;
  v_existing_alias core.tenant_aliases;
  v_business_id uuid;
  v_membership_id uuid;
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_prior_claims text := current_setting('request.jwt.claims', true);
  v_created jsonb;
begin
  if not exists (select 1 from public.profiles p where p.id = v_owner) then
    raise exception 'USER_NOT_FOUND';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_BUSINESS_NAME';
  end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(v_slug) > 60 then
    raise exception 'INVALID_BUSINESS_SLUG';
  end if;

  if v_alias is not null then
    if jsonb_typeof(v_alias) <> 'object' then
      raise exception 'INVALID_PLATFORM_PAYLOAD';
    end if;
    v_alias_provider := lower(btrim(coalesce(v_alias->>'provider', '')));
    v_alias_external_id := btrim(coalesce(v_alias->>'external_id', ''));
    if v_alias_provider = '' or v_alias_external_id = '' then
      raise exception 'INVALID_PLATFORM_PAYLOAD';
    end if;

    -- Deterministic replay: an already-linked legacy tenant maps to its business.
    -- Concurrent provisioning of the same alias serializes on this lock.
    perform core.lock_tenant_alias(v_alias_provider, v_alias_external_id);
    select * into v_existing_alias
    from core.tenant_aliases a
    where a.provider = v_alias_provider and a.external_id = v_alias_external_id;
    if found then
      select m.id into v_membership_id
      from public.memberships m
      where m.business_id = v_existing_alias.business_id and m.user_id = v_owner and m.active
      limit 1;
      return jsonb_build_object(
        'business_id', v_existing_alias.business_id,
        'slug', (select b.slug from public.businesses b where b.id = v_existing_alias.business_id),
        'membership_id', v_membership_id,
        'created', false,
        'tenant_alias_linked', true
      );
    end if;
  end if;

  -- S04 quota, keyed by principal instead of by user.
  perform public.consume_public_booking_rate(
    'business_create', 'user', core.hash_secret('principal:' || p_principal_id::text), 100, 3600
  );

  begin
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
    select to_jsonb(r) into v_created
    from public.create_business_with_owner(v_name, v_slug, v_timezone) r;
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  exception
    when unique_violation then
      perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
      perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
      raise exception 'BUSINESS_SLUG_TAKEN';
    when others then
      perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
      perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
      raise;
  end;

  v_business_id := (v_created->>'id')::uuid;
  perform core.lock_business(v_business_id);

  select m.id into v_membership_id
  from public.memberships m
  where m.business_id = v_business_id and m.user_id = v_owner;

  insert into core.subscription_events (business_id, event_type, payload, principal_id, idempotency_key)
  values (
    v_business_id,
    'business_provisioned',
    jsonb_build_object('owner_user_id', v_owner, 'slug', v_created->>'slug', 'name', v_created->>'name'),
    p_principal_id,
    p_idempotency_key
  );

  if v_alias_provider is not null then
    insert into core.tenant_aliases (provider, external_id, business_id)
    values (v_alias_provider, v_alias_external_id, v_business_id);
    insert into core.subscription_events (business_id, event_type, payload, principal_id, idempotency_key)
    values (
      v_business_id,
      'tenant_alias_linked',
      jsonb_build_object('provider', v_alias_provider, 'external_id', v_alias_external_id),
      p_principal_id,
      p_idempotency_key
    );
  end if;

  return jsonb_build_object(
    'business_id', v_business_id,
    'slug', v_created->>'slug',
    'membership_id', v_membership_id,
    'created', true,
    'tenant_alias_linked', v_alias_provider is not null
  );
end
$$;

-- Read-only derivation of the entitlement changes a plan transition implies:
-- every key of the target plan (granted when the subscription grants), plus a
-- revocation of every currently granted key that was itself plan-derived and
-- is absent from the target plan. Ad-hoc grants (entitlement_granted events)
-- survive plan changes. The list is stored on the subscription event so the
-- KC-05 projection can replay it without a read RPC.
create function core.plan_entitlement_changes(
  p_business_id uuid,
  p_plan_key text,
  p_grant boolean,
  p_valid_until timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.change order by x.change->>'entitlement_key'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'entitlement_key', pe.entitlement_key,
      'granted', (p_grant and pe.granted),
      'limit_value', pe.limit_value,
      'valid_until', p_valid_until
    ) as change
    from core.plan_entitlements pe
    where pe.plan_key = p_plan_key
    union all
    select jsonb_build_object(
      'entitlement_key', e.entitlement_key,
      'granted', false,
      'limit_value', e.limit_value,
      'valid_until', e.valid_until
    )
    from core.entitlements e
    join core.subscription_events se on se.id = e.source_event_id
    where e.business_id = p_business_id
      and e.granted
      and se.event_type = 'subscription_changed'
      and not exists (
        select 1 from core.plan_entitlements pe
        where pe.plan_key = p_plan_key and pe.entitlement_key = e.entitlement_key
      )
  ) x
$$;

create function core.apply_entitlement_changes(
  p_business_id uuid,
  p_changes jsonb,
  p_event_id bigint
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  insert into core.entitlements (business_id, entitlement_key, granted, limit_value, source_event_id, valid_until, updated_at)
  select
    p_business_id,
    x->>'entitlement_key',
    (x->>'granted')::boolean,
    (x->>'limit_value')::bigint,
    p_event_id,
    (x->>'valid_until')::timestamptz,
    now()
  from jsonb_array_elements(p_changes) x
  on conflict (business_id, entitlement_key) do update
    set granted = excluded.granted,
        limit_value = excluded.limit_value,
        source_event_id = excluded.source_event_id,
        valid_until = excluded.valid_until,
        updated_at = now();
  get diagnostics v_rows = row_count;
  return v_rows;
end
$$;

create function core.command_change_subscription(
  p_principal_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_business_id uuid := core.require_uuid(p_payload->>'business_id', 'BUSINESS_NOT_FOUND');
  v_plan_key text := lower(btrim(coalesce(p_payload->>'plan_key', '')));
  v_status text := lower(btrim(coalesce(p_payload->>'status', '')));
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_policy_version integer;
  v_event_id bigint;
  v_subscription core.subscriptions;
  v_exists boolean;
  v_grant boolean;
  v_changes jsonb;
begin
  if not exists (select 1 from public.businesses b where b.id = v_business_id) then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;
  select max(pe.policy_version) into v_policy_version
  from core.plan_entitlements pe where pe.plan_key = v_plan_key;
  if v_policy_version is null then
    raise exception 'PLAN_NOT_FOUND';
  end if;
  if v_status not in ('trial', 'active', 'past_due', 'cancelled') then
    raise exception 'INVALID_SUBSCRIPTION_STATUS';
  end if;
  begin
    v_period_start := (p_payload->>'current_period_start')::timestamptz;
    v_period_end := (p_payload->>'current_period_end')::timestamptz;
  exception when others then
    raise exception 'INVALID_SUBSCRIPTION_PERIOD';
  end;
  if v_period_start is not null and v_period_end is not null and v_period_end <= v_period_start then
    raise exception 'INVALID_SUBSCRIPTION_PERIOD';
  end if;

  -- trial/active grant the plan; cancelled revokes it; past_due keeps the
  -- current grants unchanged (grace) but is recorded as an event.
  if v_status in ('trial', 'active') then
    v_grant := true;
  elsif v_status = 'cancelled' then
    v_grant := false;
  else
    v_grant := null;
  end if;

  -- K04 §17 lock order: business advisory lock -> subscriptions row -> event -> entitlements.
  perform core.lock_business(v_business_id);
  select * into v_subscription
  from core.subscriptions s where s.business_id = v_business_id for update;
  v_exists := found;

  if v_grant is not null then
    v_changes := core.plan_entitlement_changes(v_business_id, v_plan_key, v_grant, v_period_end);
  end if;

  insert into core.subscription_events (
    business_id, event_type, plan_key, payload, principal_id, idempotency_key, policy_version
  ) values (
    v_business_id,
    'subscription_changed',
    v_plan_key,
    jsonb_build_object(
      'status', v_status,
      'current_period_start', v_period_start,
      'current_period_end', v_period_end,
      'source', coalesce(p_payload->'source', 'null'::jsonb),
      'entitlements', coalesce(v_changes, 'null'::jsonb)
    ),
    p_principal_id,
    p_idempotency_key,
    v_policy_version
  )
  returning id into v_event_id;

  if v_exists then
    update core.subscriptions
    set plan_key = v_plan_key,
        status = v_status,
        current_period_start = v_period_start,
        current_period_end = v_period_end,
        version = version + 1,
        updated_at = now()
    where business_id = v_business_id
    returning * into v_subscription;
  else
    insert into core.subscriptions (business_id, plan_key, status, current_period_start, current_period_end)
    values (v_business_id, v_plan_key, v_status, v_period_start, v_period_end)
    returning * into v_subscription;
  end if;

  if v_changes is not null then
    perform core.apply_entitlement_changes(v_business_id, v_changes, v_event_id);
  end if;

  return jsonb_build_object(
    'business_id', v_business_id,
    'plan_key', v_subscription.plan_key,
    'status', v_subscription.status,
    'version', v_subscription.version,
    'event_id', v_event_id,
    'policy_version', v_policy_version
  );
end
$$;

create function core.command_set_entitlement(
  p_principal_id uuid,
  p_idempotency_key text,
  p_payload jsonb,
  p_grant boolean
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_business_id uuid := core.require_uuid(p_payload->>'business_id', 'BUSINESS_NOT_FOUND');
  v_key text := lower(btrim(coalesce(p_payload->>'entitlement_key', '')));
  v_limit bigint;
  v_valid_until timestamptz;
  v_event_id bigint;
begin
  if not exists (select 1 from public.businesses b where b.id = v_business_id) then
    raise exception 'BUSINESS_NOT_FOUND';
  end if;
  if v_key !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' or char_length(v_key) > 64 then
    raise exception 'INVALID_ENTITLEMENT_KEY';
  end if;
  begin
    v_limit := (p_payload->>'limit_value')::bigint;
  exception when others then
    raise exception 'INVALID_ENTITLEMENT_LIMIT';
  end;
  if v_limit is not null and v_limit < 0 then
    raise exception 'INVALID_ENTITLEMENT_LIMIT';
  end if;
  begin
    v_valid_until := (p_payload->>'valid_until')::timestamptz;
  exception when others then
    raise exception 'INVALID_ENTITLEMENT_VALIDITY';
  end;

  perform core.lock_business(v_business_id);
  perform 1 from core.subscriptions s where s.business_id = v_business_id for update;

  insert into core.subscription_events (
    business_id, event_type, payload, principal_id, idempotency_key
  ) values (
    v_business_id,
    case when p_grant then 'entitlement_granted' else 'entitlement_revoked' end,
    jsonb_build_object('entitlement_key', v_key, 'limit_value', v_limit, 'valid_until', v_valid_until),
    p_principal_id,
    p_idempotency_key
  )
  returning id into v_event_id;

  insert into core.entitlements (business_id, entitlement_key, granted, limit_value, source_event_id, valid_until, updated_at)
  values (v_business_id, v_key, p_grant, v_limit, v_event_id, v_valid_until, now())
  on conflict (business_id, entitlement_key) do update
    set granted = excluded.granted,
        limit_value = case when excluded.granted then excluded.limit_value else core.entitlements.limit_value end,
        source_event_id = excluded.source_event_id,
        valid_until = case when excluded.granted then excluded.valid_until else core.entitlements.valid_until end,
        updated_at = now();

  return jsonb_build_object(
    'business_id', v_business_id,
    'entitlement_key', v_key,
    'granted', p_grant,
    'event_id', v_event_id
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Public RPC surface (explicit grants only).
-- ---------------------------------------------------------------------------
create function public.core_apply_platform_command(
  p_principal_name text,
  p_principal_secret text,
  p_idempotency_key text,
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_principal_id uuid;
  v_request_hash text;
  v_inserted integer;
  v_existing core.platform_commands;
  v_result jsonb;
  v_business_id uuid;
begin
  v_principal_id := core.authorize_service_principal(p_principal_name, p_principal_secret);
  if v_principal_id is null then
    return public.core_platform_error('CORE_PRINCIPAL_UNAUTHORIZED');
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 128 then
    return public.core_platform_error('INVALID_IDEMPOTENCY_KEY');
  end if;
  if p_command is null or p_command not in (
    'LinkTenantAlias', 'LinkIdentityAlias', 'ProvisionBusiness',
    'ChangeSubscription', 'GrantEntitlement', 'RevokeEntitlement'
  ) then
    return public.core_platform_error('INVALID_PLATFORM_COMMAND');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    return public.core_platform_error('INVALID_PLATFORM_PAYLOAD');
  end if;

  v_request_hash := core.hash_secret(p_command || E'\n' || p_payload::text);

  begin
    -- Idempotency claim. Concurrent callers with the same key serialize on the PK.
    insert into core.platform_commands (principal_id, idempotency_key, command, request_hash)
    values (v_principal_id, p_idempotency_key, p_command, v_request_hash)
    on conflict (principal_id, idempotency_key) do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 0 then
      select * into v_existing
      from core.platform_commands c
      where c.principal_id = v_principal_id and c.idempotency_key = p_idempotency_key;
      if v_existing.command <> p_command or v_existing.request_hash <> v_request_hash then
        raise exception 'PLATFORM_IDEMPOTENCY_CONFLICT';
      end if;
      if v_existing.result is null then
        raise exception 'PLATFORM_IDEMPOTENCY_IN_PROGRESS';
      end if;
      return v_existing.result;
    end if;

    case p_command
      when 'LinkTenantAlias' then
        v_result := core.command_link_tenant_alias(v_principal_id, p_idempotency_key, p_payload);
      when 'LinkIdentityAlias' then
        v_result := core.command_link_identity_alias(v_principal_id, p_idempotency_key, p_payload);
      when 'ProvisionBusiness' then
        v_result := core.command_provision_business(v_principal_id, p_idempotency_key, p_payload);
      when 'ChangeSubscription' then
        v_result := core.command_change_subscription(v_principal_id, p_idempotency_key, p_payload);
      when 'GrantEntitlement' then
        v_result := core.command_set_entitlement(v_principal_id, p_idempotency_key, p_payload, true);
      when 'RevokeEntitlement' then
        v_result := core.command_set_entitlement(v_principal_id, p_idempotency_key, p_payload, false);
    end case;

    v_business_id := nullif(v_result->>'business_id', '')::uuid;
    v_result := jsonb_build_object('ok', true, 'data', v_result);

    update core.platform_commands
    set result = v_result, business_id = v_business_id, completed_at = clock_timestamp()
    where principal_id = v_principal_id and idempotency_key = p_idempotency_key;

    return v_result;
  exception
    when invalid_text_representation or datetime_field_overflow then
      return public.core_platform_error('INVALID_PLATFORM_PAYLOAD');
    when others then
      -- The claim and every command effect roll back with this subtransaction;
      -- a later retry with the same key re-executes instead of hanging in progress.
      return public.core_platform_error(sqlerrm);
  end;
end
$$;

revoke all on function public.core_apply_platform_command(text, text, text, text, jsonb) from public;
grant execute on function public.core_apply_platform_command(text, text, text, text, jsonb) to anon;

-- Single authorization primitive for applications (K04 §10).
create function public.has_entitlement(p_business_id uuid, p_entitlement_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  if p_business_id is null or not public.is_active_member(p_business_id) then
    return false;
  end if;
  return coalesce((
    select e.granted and (e.valid_until is null or e.valid_until > clock_timestamp())
    from core.entitlements e
    where e.business_id = p_business_id
      and e.entitlement_key = lower(btrim(coalesce(p_entitlement_key, '')))
    limit 1
  ), false);
end
$$;

revoke all on function public.has_entitlement(uuid, text) from public;
grant execute on function public.has_entitlement(uuid, text) to authenticated;

create function public.get_business_platform_snapshot(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subscription jsonb;
  v_entitlements jsonb;
begin
  begin
    perform public.f10_require_standard_session();
  exception when others then
    return public.core_platform_error(sqlerrm);
  end;
  if p_business_id is null or not public.is_active_member(p_business_id) then
    return public.core_platform_error('BUSINESS_ACCESS_DENIED');
  end if;

  select jsonb_build_object(
    'plan_key', s.plan_key,
    'status', s.status,
    'current_period_start', s.current_period_start,
    'current_period_end', s.current_period_end,
    'version', s.version
  ) into v_subscription
  from core.subscriptions s where s.business_id = p_business_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entitlement_key', e.entitlement_key,
    'granted', e.granted and (e.valid_until is null or e.valid_until > clock_timestamp()),
    'limit_value', e.limit_value,
    'valid_until', e.valid_until
  ) order by e.entitlement_key), '[]'::jsonb) into v_entitlements
  from (
    select * from core.entitlements e where e.business_id = p_business_id
    order by e.entitlement_key limit 100
  ) e;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'business_id', p_business_id,
    'subscription', v_subscription,
    'entitlements', v_entitlements
  ));
end
$$;

revoke all on function public.get_business_platform_snapshot(uuid) from public;
grant execute on function public.get_business_platform_snapshot(uuid) to authenticated;

-- Cursor feed over append-only events for the KC-05 projection job.
create function public.core_read_change_feed(
  p_principal_name text,
  p_principal_secret text,
  p_after_event_id bigint,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_principal_id uuid;
  v_limit integer := coalesce(p_limit, 50);
  v_after bigint := coalesce(p_after_event_id, 0);
  v_events jsonb;
  v_count integer;
  v_last bigint;
begin
  v_principal_id := core.authorize_service_principal(p_principal_name, p_principal_secret);
  if v_principal_id is null then
    return public.core_platform_error('CORE_PRINCIPAL_UNAUTHORIZED');
  end if;
  if v_limit < 1 or v_limit > 100 then
    return public.core_platform_error('INVALID_FEED_LIMIT');
  end if;
  if v_after < 0 then
    return public.core_platform_error('INVALID_FEED_CURSOR');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', e.id,
    'business_id', e.business_id,
    'event_type', e.event_type,
    'plan_key', e.plan_key,
    'payload', e.payload,
    'policy_version', e.policy_version,
    'created_at', e.created_at
  ) order by e.id), '[]'::jsonb), count(*), max(e.id)
  into v_events, v_count, v_last
  from (
    select * from core.subscription_events e
    where e.id > v_after
    order by e.id
    limit v_limit + 1
  ) e;

  if v_count > v_limit then
    -- drop the probe row used to detect has_more
    v_events := (select coalesce(jsonb_agg(x order by (x->>'event_id')::bigint), '[]'::jsonb)
                 from jsonb_array_elements(v_events) x
                 where (x->>'event_id')::bigint < v_last);
    v_last := (select max((x->>'event_id')::bigint) from jsonb_array_elements(v_events) x);
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'events', v_events,
    'next_after_event_id', coalesce(v_last, v_after),
    'has_more', v_count > v_limit
  ));
end
$$;

revoke all on function public.core_read_change_feed(text, text, bigint, integer) from public;
grant execute on function public.core_read_change_feed(text, text, bigint, integer) to anon;

-- Bounded, secret-gated alias lookups for the KC-03 backfill and parity jobs.
create function public.core_resolve_tenant_aliases(
  p_principal_name text,
  p_principal_secret text,
  p_provider text,
  p_external_ids text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_principal_id uuid;
  v_aliases jsonb;
begin
  v_principal_id := core.authorize_service_principal(p_principal_name, p_principal_secret);
  if v_principal_id is null then
    return public.core_platform_error('CORE_PRINCIPAL_UNAUTHORIZED');
  end if;
  if p_provider is null or btrim(p_provider) = ''
     or p_external_ids is null
     or cardinality(p_external_ids) < 1 or cardinality(p_external_ids) > 100 then
    return public.core_platform_error('INVALID_PLATFORM_PAYLOAD');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'external_id', a.external_id,
    'business_id', a.business_id,
    'slug', b.slug
  ) order by a.external_id), '[]'::jsonb) into v_aliases
  from core.tenant_aliases a
  join public.businesses b on b.id = a.business_id
  where a.provider = lower(btrim(p_provider))
    and a.external_id = any (p_external_ids);

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('aliases', v_aliases));
end
$$;

revoke all on function public.core_resolve_tenant_aliases(text, text, text, text[]) from public;
grant execute on function public.core_resolve_tenant_aliases(text, text, text, text[]) to anon;

create function public.core_resolve_identity_aliases(
  p_principal_name text,
  p_principal_secret text,
  p_provider text,
  p_external_subjects text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_principal_id uuid;
  v_aliases jsonb;
begin
  v_principal_id := core.authorize_service_principal(p_principal_name, p_principal_secret);
  if v_principal_id is null then
    return public.core_platform_error('CORE_PRINCIPAL_UNAUTHORIZED');
  end if;
  if p_provider is null or btrim(p_provider) = ''
     or p_external_subjects is null
     or cardinality(p_external_subjects) < 1 or cardinality(p_external_subjects) > 100 then
    return public.core_platform_error('INVALID_PLATFORM_PAYLOAD');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'external_subject', a.external_subject,
    'user_id', a.user_id
  ) order by a.external_subject), '[]'::jsonb) into v_aliases
  from core.identity_aliases a
  where a.provider = lower(btrim(p_provider))
    and a.external_subject = any (p_external_subjects);

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('aliases', v_aliases));
end
$$;

revoke all on function public.core_resolve_identity_aliases(text, text, text, text[]) from public;
grant execute on function public.core_resolve_identity_aliases(text, text, text, text[]) to anon;

commit;
