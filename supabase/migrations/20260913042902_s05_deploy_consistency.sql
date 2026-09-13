begin;

-- Owner-only control plane. No plaintext secret, bearer, or provider credential.
create table public.staging_key_transition (
  singleton boolean primary key default true check (singleton),
  operation_id uuid not null unique,
  gate_hash text not null check (gate_hash ~ '^[0-9a-f]{64}$'),
  dispatch_hash text not null check (dispatch_hash ~ '^[0-9a-f]{64}$'),
  previous_version uuid not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.staging_key_transition enable row level security;
alter table public.staging_key_transition force row level security;
revoke all on public.staging_key_transition from public, anon, authenticated;

create table public.staging_cron_heartbeat (
  version_id uuid primary key,
  dispatch_hash text not null check (dispatch_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default clock_timestamp()
);
alter table public.staging_cron_heartbeat enable row level security;
alter table public.staging_cron_heartbeat force row level security;
revoke all on public.staging_cron_heartbeat from public, anon, authenticated;

create function public.begin_staging_key_rotation(
  p_operation uuid, p_expected_gate text, p_expected_dispatch text,
  p_gate text, p_dispatch text, p_previous uuid, p_commit text, p_evidence jsonb
) returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  -- Serializes empty-row creation as well as prepare/finalize from distinct runners.
  perform pg_advisory_xact_lock(505, 1);
  if not exists (select 1 from public.public_booking_abuse_config where config_key = 'default' and gate_secret_hash = p_expected_gate)
     or not exists (select 1 from public.notification_dispatch_config where config_key = 'default' and secret_hash = p_expected_dispatch)
     or p_gate = p_expected_gate or p_dispatch = p_expected_dispatch then
    raise exception 'STAGING_KEY_STATE_CONFLICT';
  end if;
  if exists (select 1 from public.staging_key_transition) then
    if exists (select 1 from public.staging_key_transition where operation_id = p_operation
      and gate_hash = p_gate and dispatch_hash = p_dispatch and previous_version = p_previous
      and commit_sha = p_commit and evidence = p_evidence) then return; end if;
    raise exception 'STAGING_KEY_TRANSITION_PENDING';
  end if;
  insert into public.staging_key_transition(operation_id, gate_hash, dispatch_hash, previous_version, commit_sha, evidence)
    values (p_operation, p_gate, p_dispatch, p_previous, p_commit, p_evidence);
end $$;

create function public.finish_staging_key_rotation(
  p_operation uuid, p_expected_gate text, p_expected_dispatch text, p_promote boolean
) returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_pending public.staging_key_transition;
begin
  perform pg_advisory_xact_lock(505, 1);
  select * into v_pending from public.staging_key_transition where operation_id = p_operation for update;
  if not found or p_promote is null
     or not exists (select 1 from public.public_booking_abuse_config where config_key = 'default' and gate_secret_hash = p_expected_gate)
     or not exists (select 1 from public.notification_dispatch_config where config_key = 'default' and secret_hash = p_expected_dispatch) then
    raise exception 'STAGING_KEY_STATE_CONFLICT';
  end if;
  if p_promote then
    update public.public_booking_abuse_config set gate_secret_hash = v_pending.gate_hash, updated_at = clock_timestamp() where config_key = 'default';
    update public.notification_dispatch_config set secret_hash = v_pending.dispatch_hash, updated_at = clock_timestamp() where config_key = 'default';
  end if;
  delete from public.staging_key_transition where operation_id = p_operation;
end $$;

revoke all on function public.begin_staging_key_rotation(uuid,text,text,text,text,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.finish_staging_key_rotation(uuid,text,text,boolean) from public, anon, authenticated;

-- Backward-compatible with the currently deployed S04 Worker during cutover.
create or replace function public.public_booking_gate_authorized(p_gate_secret text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select p_gate_secret is not null and char_length(p_gate_secret) between 43 and 256
    and (exists (select 1 from public.public_booking_abuse_config where config_key = 'default'
      and gate_secret_hash = encode(digest(p_gate_secret, 'sha256'), 'hex'))
    or exists (select 1 from public.staging_key_transition where gate_hash = encode(digest(p_gate_secret, 'sha256'), 'hex')));
$$;
create or replace function public.notification_dispatch_authorized(p_dispatch_secret text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select p_dispatch_secret is not null and char_length(p_dispatch_secret) between 43 and 256
    and (exists (select 1 from public.notification_dispatch_config where config_key = 'default'
      and secret_hash = encode(digest(p_dispatch_secret, 'sha256'), 'hex'))
    or exists (select 1 from public.staging_key_transition where dispatch_hash = encode(digest(p_dispatch_secret, 'sha256'), 'hex')));
$$;
revoke all on function public.public_booking_gate_authorized(text) from public, anon, authenticated;
revoke all on function public.notification_dispatch_authorized(text) from public, anon, authenticated;

create function public.record_staging_cron_heartbeat(p_dispatch_secret text, p_version_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_version_id is null or not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'STAGING_HEARTBEAT_DENIED';
  end if;
  insert into public.staging_cron_heartbeat(version_id, dispatch_hash, observed_at)
    values (p_version_id, encode(digest(p_dispatch_secret, 'sha256'), 'hex'), clock_timestamp())
    on conflict (version_id) do update set dispatch_hash = excluded.dispatch_hash, observed_at = excluded.observed_at;
  delete from public.staging_cron_heartbeat where observed_at < clock_timestamp() - interval '1 day';
end $$;
revoke all on function public.record_staging_cron_heartbeat(text,uuid) from public, anon, authenticated;
grant execute on function public.record_staging_cron_heartbeat(text,uuid) to anon;

-- service_role exists on hosted Supabase, but not in the minimal CI bootstrap.
do $$ declare r record; begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on public.staging_key_transition, public.staging_cron_heartbeat from service_role;
    for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('begin_staging_key_rotation','finish_staging_key_rotation',
        'public_booking_gate_authorized','notification_dispatch_authorized','record_staging_cron_heartbeat')
    loop execute format('revoke all on function %s from service_role', r.signature); end loop;
  end if;
end $$;

commit;
