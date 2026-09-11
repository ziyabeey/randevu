begin;

insert into public.public_booking_abuse_config(
  config_key, gate_secret_hash,
  read_window_seconds, read_actor_limit, read_network_limit,
  create_window_seconds, create_actor_limit, create_network_limit, create_business_limit,
  recover_window_seconds, recover_actor_limit, recover_network_limit
) values (
  'default', repeat('a',64),
  60, 10, 100,
  600, 10, 100, 100,
  300, 10, 100
)
on conflict(config_key) do update set
  gate_secret_hash = excluded.gate_secret_hash,
  read_window_seconds = excluded.read_window_seconds,
  read_actor_limit = excluded.read_actor_limit,
  read_network_limit = excluded.read_network_limit,
  create_window_seconds = excluded.create_window_seconds,
  create_actor_limit = excluded.create_actor_limit,
  create_network_limit = excluded.create_network_limit,
  create_business_limit = excluded.create_business_limit,
  recover_window_seconds = excluded.recover_window_seconds,
  recover_actor_limit = excluded.recover_actor_limit,
  recover_network_limit = excluded.recover_network_limit;

insert into public.public_booking_rate_counters(
  action, dimension, key_hash, window_started_at, count, updated_at
) values
  ('read','actor',repeat('e',64), now() - interval '3 days', 1, now() - interval '3 days'),
  ('read','network',repeat('f',64), now() - interval '3 days', 1, now() - interval '3 days'),
  ('recover','actor',repeat('d',64), now(), 1, now());

select public.enforce_public_booking_rate(
  'read', repeat('1',64), repeat('2',64), null
);

do $$
begin
  if exists (
    select 1 from public.public_booking_rate_counters
    where key_hash in (repeat('e',64), repeat('f',64))
  ) then
    raise exception 'stale abuse counters were not pruned';
  end if;

  if not exists (
    select 1 from public.public_booking_rate_counters
    where action='recover' and dimension='actor' and key_hash=repeat('d',64) and count=1
  ) then
    raise exception 'recent unrelated abuse counter was pruned';
  end if;

  if (select count(*) from public.public_booking_rate_counters
      where action='read' and dimension='actor' and key_hash=repeat('1',64) and count=1) <> 1 then
    raise exception 'current actor counter missing after retention prune';
  end if;

  if (select count(*) from public.public_booking_rate_counters
      where action='read' and dimension='network' and key_hash=repeat('2',64) and count=1) <> 1 then
    raise exception 'current network counter missing after retention prune';
  end if;
end
$$;

rollback;
