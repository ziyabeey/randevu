begin;

create function pg_temp.f16_verify_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F16-02 verify rate: %', p_message;
  end if;
end
$$;
grant execute on function pg_temp.f16_verify_assert(boolean,text) to anon;

-- One phone_verify call: a missing slug is enough to prove the admission
-- boundary without customer or appointment state.
create function pg_temp.f16_verify_call(
  p_phase text, p_phone_key text, p_actor text, p_network text, p_challenge_key text default null
)
returns jsonb language sql as $$
  select public.execute_public_operation(
    'phone_verify',
    jsonb_strip_nulls(jsonb_build_object(
      'p_slug','f16-missing-salon','p_phase',p_phase,'p_phone_key',p_phone_key,'p_challenge_key',p_challenge_key
    )),
    repeat('g',43),
    p_actor,
    p_network
  )
$$;
grant execute on function pg_temp.f16_verify_call(text,text,text,text,text) to anon;

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

delete from public.public_booking_rate_counters where action like 'verify%';

set local role anon;

-- Actor budget: 8 per 10 minutes. Each call uses its own phone key so only the
-- actor dimension can become the limit.
do $$
declare
  v_result jsonb;
begin
  for i in 1..8 loop
    v_result := pg_temp.f16_verify_call('start', encode(digest('f16-actor-phone-'||i,'sha256'),'hex'), repeat('a',64), repeat('f',64));
    perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'actor request '||i||' was unexpectedly rejected: '||v_result::text);
    perform pg_temp.f16_verify_assert(v_result->'data'='[]'::jsonb, 'phone_verify leaked or changed the public business projection');
  end loop;

  v_result := pg_temp.f16_verify_call('start', encode(digest('f16-actor-phone-9','sha256'),'hex'), repeat('a',64), repeat('f',64));
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'ninth actor verification attempt was not limited: '||v_result::text
  );
end
$$;

reset role;

-- As for every S04 rate class, the rejected attempt's own increment rolls back
-- with its PUBLIC_BOOKING_RATE_LIMITED error: the counter holds the full budget
-- until the window turns, so each further attempt is rejected as well.
select pg_temp.f16_verify_assert(
  (select count=8 from public.public_booking_rate_counters
   where action='verify' and dimension='actor' and key_hash=repeat('a',64)),
  'actor verify counter does not hold exactly the spent budget'
);

-- Network budget: 80 per 10 minutes, isolated with a fresh actor and phone key
-- per request.
delete from public.public_booking_rate_counters where action like 'verify%';

set local role anon;
do $$
declare
  v_result jsonb;
begin
  for i in 1..80 loop
    v_result := pg_temp.f16_verify_call('check',
      encode(digest('f16-network-phone-'||i,'sha256'),'hex'),
      encode(digest('f16-verify-actor-'||i,'sha256'),'hex'),
      repeat('e',64));
    perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'network request '||i||' was unexpectedly rejected: '||v_result::text);
  end loop;

  v_result := pg_temp.f16_verify_call('check',
    encode(digest('f16-network-phone-81','sha256'),'hex'),
    encode(digest('f16-verify-actor-81','sha256'),'hex'),
    repeat('e',64));
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'eighty-first network verification attempt was not limited: '||v_result::text
  );
end
$$;

reset role;

select pg_temp.f16_verify_assert(
  (select count=80 from public.public_booking_rate_counters
   where action='verify' and dimension='network' and key_hash=repeat('e',64)),
  'network verify counter does not hold exactly the spent budget'
);

-- R1-B1: guesses against one phone are bounded whatever actor or network asks.
-- Five checks per 10 minutes with a fresh actor and network each time, then
-- the sixth is refused; sends are held to three the same way.
delete from public.public_booking_rate_counters where action like 'verify%';

set local role anon;
do $$
declare
  v_result jsonb;
  v_phone text := encode(digest('f16-victim-phone','sha256'),'hex');
begin
  for i in 1..5 loop
    v_result := pg_temp.f16_verify_call('check', v_phone,
      encode(digest('f16-rotating-actor-'||i,'sha256'),'hex'),
      encode(digest('f16-rotating-network-'||i,'sha256'),'hex'));
    perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'phone check '||i||' was unexpectedly rejected: '||v_result::text);
  end loop;
  v_result := pg_temp.f16_verify_call('check', v_phone,
    encode(digest('f16-rotating-actor-6','sha256'),'hex'),
    encode(digest('f16-rotating-network-6','sha256'),'hex'));
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'sixth check for one phone from a new actor and network was not limited: '||v_result::text
  );

  for i in 1..3 loop
    v_result := pg_temp.f16_verify_call('start', v_phone,
      encode(digest('f16-send-actor-'||i,'sha256'),'hex'),
      encode(digest('f16-send-network-'||i,'sha256'),'hex'));
    perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'phone send '||i||' was unexpectedly rejected: '||v_result::text);
  end loop;
  v_result := pg_temp.f16_verify_call('start', v_phone,
    encode(digest('f16-send-actor-4','sha256'),'hex'),
    encode(digest('f16-send-network-4','sha256'),'hex'));
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'fourth send for one phone from a new actor and network was not limited: '||v_result::text
  );

  -- Another phone is unaffected.
  v_result := pg_temp.f16_verify_call('check', encode(digest('f16-other-phone','sha256'),'hex'),
    encode(digest('f16-rotating-actor-7','sha256'),'hex'),
    encode(digest('f16-rotating-network-7','sha256'),'hex'));
  perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'another phone was limited by the victim budget: '||v_result::text);

  -- Malformed phase or key never reaches the business projection.
  v_result := pg_temp.f16_verify_call('guess', v_phone, repeat('b',64), repeat('c',64));
  perform pg_temp.f16_verify_assert(v_result#>>'{error,message}'='PUBLIC_BOOKING_GATE_INVALID_PROOF', 'unknown phase was accepted: '||v_result::text);
  v_result := pg_temp.f16_verify_call('check', '05551602001', repeat('b',64), repeat('c',64));
  perform pg_temp.f16_verify_assert(v_result#>>'{error,message}'='PUBLIC_BOOKING_GATE_INVALID_PROOF', 'a raw phone number was accepted as the rate key: '||v_result::text);
end
$$;

reset role;

select pg_temp.f16_verify_assert(
  (select count=5 from public.public_booking_rate_counters
   where action='verify_check' and dimension='phone' and key_hash=encode(digest('f16-victim-phone','sha256'),'hex'))
  and (select count=3 from public.public_booking_rate_counters
   where action='verify_send' and dimension='phone' and key_hash=encode(digest('f16-victim-phone','sha256'),'hex'))
  and (select count=8 from public.public_booking_rate_counters
   where action='verify_day' and dimension='phone' and key_hash=encode(digest('f16-victim-phone','sha256'),'hex')),
  'per-phone send/check/day counters do not hold exactly the spent budget'
);

-- Daily cap: 30 sends and checks per phone per 24 hours, even when the
-- 10-minute phase budgets are fresh.
delete from public.public_booking_rate_counters where action like 'verify%';
insert into public.public_booking_rate_counters(action, dimension, key_hash, window_started_at, count, updated_at)
values ('verify_day', 'phone', encode(digest('f16-daily-phone','sha256'),'hex'),
  to_timestamp(floor(extract(epoch from clock_timestamp()) / 86400) * 86400), 29, clock_timestamp());

set local role anon;
do $$
declare
  v_result jsonb;
  v_phone text := encode(digest('f16-daily-phone','sha256'),'hex');
begin
  v_result := pg_temp.f16_verify_call('check', v_phone, repeat('b',64), repeat('c',64));
  perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'thirtieth daily phone operation was unexpectedly rejected: '||v_result::text);
  v_result := pg_temp.f16_verify_call('start', v_phone, repeat('d',64), repeat('9',64));
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%',
    'thirty-first daily phone operation was not limited: '||v_result::text
  );
end
$$;

reset role;

-- R1-B1 single use: a check whose code matched consumes its challenge once. A
-- replay of the same challenge is refused and still spends the phone budget;
-- another challenge for the same phone is unaffected.
delete from public.public_booking_rate_counters where action like 'verify%';

set local role anon;
do $$
declare
  v_result jsonb;
  v_phone text := encode(digest('f16-single-use-phone','sha256'),'hex');
  v_first text := encode(digest('f16-challenge-1','sha256'),'hex');
  v_second text := encode(digest('f16-challenge-2','sha256'),'hex');
begin
  v_result := pg_temp.f16_verify_call('check', v_phone, repeat('b',64), repeat('c',64), v_first);
  perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'first use of a matched challenge was rejected: '||v_result::text);

  v_result := pg_temp.f16_verify_call('check', v_phone, encode(digest('f16-replay-actor','sha256'),'hex'),
    encode(digest('f16-replay-network','sha256'),'hex'), v_first);
  perform pg_temp.f16_verify_assert(
    v_result#>>'{error,message}'='WHATSAPP_OTP_CHALLENGE_USED',
    'a replayed challenge from a new actor and network was accepted: '||v_result::text
  );

  v_result := pg_temp.f16_verify_call('check', v_phone, repeat('b',64), repeat('c',64), v_second);
  perform pg_temp.f16_verify_assert(v_result->>'ok'='true', 'a fresh challenge for the same phone was rejected: '||v_result::text);

  v_result := pg_temp.f16_verify_call('start', v_phone, repeat('b',64), repeat('c',64), v_second);
  perform pg_temp.f16_verify_assert(v_result#>>'{error,message}'='PUBLIC_BOOKING_GATE_INVALID_PROOF', 'a start carried a challenge key: '||v_result::text);
  v_result := pg_temp.f16_verify_call('check', v_phone, repeat('b',64), repeat('c',64), 'not-a-challenge-key');
  perform pg_temp.f16_verify_assert(v_result#>>'{error,message}'='PUBLIC_BOOKING_GATE_INVALID_PROOF', 'a malformed challenge key was accepted: '||v_result::text);
end
$$;

reset role;

select pg_temp.f16_verify_assert(
  (select count=3 from public.public_booking_rate_counters
   where action='verify_check' and dimension='phone' and key_hash=encode(digest('f16-single-use-phone','sha256'),'hex')),
  'a replayed challenge did not spend the per-phone check budget'
);
select pg_temp.f16_verify_assert(
  (select count(*)=2 from public.public_booking_rate_counters
   where action='verify_used' and dimension='challenge'
     and key_hash in (encode(digest('f16-challenge-1','sha256'),'hex'), encode(digest('f16-challenge-2','sha256'),'hex'))),
  'verified challenges were not recorded as used'
);
select pg_temp.f16_verify_assert(
  public.public_operation_error('WHATSAPP_OTP_CHALLENGE_USED')#>>'{error,message}'='WHATSAPP_OTP_CHALLENGE_USED'
  and public.public_operation_error('private email=user@example.test token=secret')#>>'{error,message}'='PUBLIC_OPERATION_UNAVAILABLE',
  'public error vocabulary lost the challenge refusal or leaked an unknown error'
);

select pg_temp.f16_verify_assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enforce_public_phone_verify_rate'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  'per-phone rate function is callable by API roles'
);
select pg_temp.f16_verify_assert(
  (select p.proconfig @> array['search_path=""'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='enforce_public_phone_verify_rate'),
  'per-phone rate function does not pin an empty search_path'
);

rollback;
