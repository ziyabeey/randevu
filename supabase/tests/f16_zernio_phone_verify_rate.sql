begin;

create function pg_temp.f16_verify_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F16-02 verify rate: %', p_message;
  end if;
end
$$;

insert into public.public_booking_abuse_config(
  config_key, gate_secret_hash,
  read_window_seconds, read_actor_limit, read_network_limit,
  create_window_seconds, create_actor_limit, create_network_limit, create_business_limit,
  recover_window_seconds, recover_actor_limit, recover_network_limit
)
values (
  'default', encode(digest(repeat('g',43),'sha256'),'hex'),
  60,120,1200,
  600,6,60,30,
  300,30,300
)
on conflict(config_key) do update
set gate_secret_hash=excluded.gate_secret_hash;

delete from public.public_booking_rate_counters where action='verify';

set local role anon;

-- The dispatcher exposes only the public business projection while consuming the
-- dedicated verification budget. A missing slug is deliberately enough here:
-- no customer or appointment state is needed to prove the admission boundary.
do $$
declare
  v_result jsonb;
begin
  for i in 1..8 loop
    v_result := public.execute_public_operation(
      'phone_verify',
      '{"p_slug":"f16-missing-salon"}'::jsonb,
      repeat('g',43),
      repeat('a',64),
      repeat('f',64)
    );
    perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'actor request '||i||' was unexpectedly rejected: '||v_result::text);
    perform pg_temp.f16_verify_assert(v_result->'data'='[]'::jsonb, 'phone_verify leaked or changed the public business projection');
  end loop;

  v_result := public.execute_public_operation(
    'phone_verify',
    '{"p_slug":"f16-missing-salon"}'::jsonb,
    repeat('g',43),
    repeat('a',64),
    repeat('f',64)
  );
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'ninth actor verification attempt was not limited: '||v_result::text
  );
end
$$;

reset role;

select pg_temp.f16_verify_assert(
  (select count=9 from public.public_booking_rate_counters
   where action='verify' and dimension='actor' and key_hash=repeat('a',64)),
  'actor verify counter did not retain rejected admission'
);

-- Isolate the shared-network limit. Every request gets a distinct actor hash so
-- only the 80/10-minute network budget can become the limiting dimension.
delete from public.public_booking_rate_counters where action='verify';

set local role anon;
do $$
declare
  v_result jsonb;
  v_actor text;
begin
  for i in 1..80 loop
    v_actor := encode(digest('f16-verify-actor-'||i::text,'sha256'),'hex');
    v_result := public.execute_public_operation(
      'phone_verify',
      '{"p_slug":"f16-missing-salon"}'::jsonb,
      repeat('g',43),
      v_actor,
      repeat('e',64)
    );
    perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'network request '||i||' was unexpectedly rejected: '||v_result::text);
  end loop;

  v_result := public.execute_public_operation(
    'phone_verify',
    '{"p_slug":"f16-missing-salon"}'::jsonb,
    repeat('g',43),
    encode(digest('f16-verify-actor-81','sha256'),'hex'),
    repeat('e',64)
  );
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'eighty-first network verification attempt was not limited: '||v_result::text
  );
end
$$;

reset role;

select pg_temp.f16_verify_assert(
  (select count=81 from public.public_booking_rate_counters
   where action='verify' and dimension='network' and key_hash=repeat('e',64)),
  'network verify counter did not retain rejected admission'
);

rollback;
