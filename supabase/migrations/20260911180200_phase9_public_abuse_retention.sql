begin;

-- F09-04 retention hardening.
-- Actor proofs are intentionally pseudonymous and rotatable, so an attacker can
-- create many distinct derived hashes over time. Keep the fixed-window table
-- bounded by pruning only counters that are safely older than every allowed
-- rate-limit window. The indexed, capped delete avoids turning cleanup into a
-- long blocking maintenance query after a large burst.
create index if not exists public_booking_rate_counters_updated_at_idx
  on public.public_booking_rate_counters (updated_at);

create or replace function public.prune_public_booking_rate_counters()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.public_booking_rate_counters c
  where c.ctid in (
    select stale.ctid
    from public.public_booking_rate_counters stale
    where stale.updated_at < clock_timestamp() - interval '48 hours'
    order by stale.updated_at
    limit 500
  );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$$;

revoke all on function public.prune_public_booking_rate_counters() from public;

create or replace function public.enforce_public_booking_rate(
  p_action text,
  p_actor_hash text,
  p_network_hash text,
  p_business_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.public_booking_abuse_config;
  v_business_hash text;
begin
  -- Opportunistic bounded cleanup. Every public request can remove far more stale
  -- keys than it can create, so churn cannot leave an unbounded historical tail.
  perform public.prune_public_booking_rate_counters();

  select * into v_cfg
  from public.public_booking_abuse_config c
  where c.config_key = 'default';

  if v_cfg.config_key is null then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[0-9a-f]{64}$'
     or p_network_hash is null or p_network_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
  end if;

  if p_action = 'read' then
    perform public.consume_public_booking_rate(
      'read','actor',p_actor_hash,v_cfg.read_actor_limit,v_cfg.read_window_seconds
    );
    perform public.consume_public_booking_rate(
      'read','network',p_network_hash,v_cfg.read_network_limit,v_cfg.read_window_seconds
    );
    return;
  end if;

  if p_action = 'recover' then
    perform public.consume_public_booking_rate(
      'recover','actor',p_actor_hash,v_cfg.recover_actor_limit,v_cfg.recover_window_seconds
    );
    perform public.consume_public_booking_rate(
      'recover','network',p_network_hash,v_cfg.recover_network_limit,v_cfg.recover_window_seconds
    );
    return;
  end if;

  if p_action = 'create' then
    if p_business_id is null then
      raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
    end if;
    v_business_hash := encode(digest(p_business_id::text, 'sha256'), 'hex');
    perform public.consume_public_booking_rate(
      'create','actor',p_actor_hash,v_cfg.create_actor_limit,v_cfg.create_window_seconds
    );
    perform public.consume_public_booking_rate(
      'create','network',p_network_hash,v_cfg.create_network_limit,v_cfg.create_window_seconds
    );
    perform public.consume_public_booking_rate(
      'create','business',v_business_hash,v_cfg.create_business_limit,v_cfg.create_window_seconds
    );
    return;
  end if;

  raise exception 'PUBLIC_BOOKING_GATE_INVALID_PROOF';
end
$$;

revoke all on function public.enforce_public_booking_rate(text,text,text,uuid) from public;

commit;
