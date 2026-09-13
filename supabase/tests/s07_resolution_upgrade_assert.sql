begin;

create function pg_temp.s07_upgrade_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'S07 upgrade: %', p_message; end if;
end
$$;

select pg_temp.s07_upgrade_assert(
  (select count(*) = 1 from public.recover_public_appointment(
    '8c000000-0000-4000-8000-000000000201','s07-v1-live-0001',repeat('a',64)
  )), 'live v1 recovery changed'
);
select pg_temp.s07_upgrade_assert(
  (select count(*) = 0 from public.recover_public_appointment(
    '8c000000-0000-4000-8000-000000000202','s07-v1-scrub-001',repeat('b',64)
  )), 'scrubbed v1 proof became recoverable'
);
select pg_temp.s07_upgrade_assert(
  (select count(*) = 0 from public.resolve_public_booking_intent_v2(
    '8c000000-0000-4000-8000-000000000201','s07-v1-live-0001',repeat('a',64)
  )), 'v2 resolver accepted a v1 key'
);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_first uuid;
  v_replay uuid;
  v_new uuid;
begin
  select appointment_id into v_first
  from public.create_public_appointment_with_recovery(
    's07-upgrade-salon','s07-v1-live-0001','S07 V1 Live',
    '6c000000-0000-4000-8000-000000000207','7c000000-0000-4000-8000-000000000207',
    (v_day + time '10:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000201','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000201',repeat('a',64),
    repeat('c',64),repeat('i',16),1::smallint,
    '+90 555 207 00 01','s07-v1-live@example.test',null
  );
  select appointment_id into v_replay
  from public.public_booking_recoveries
  where recovery_id='8c000000-0000-4000-8000-000000000201';
  perform pg_temp.s07_upgrade_assert(v_first=v_replay,'exact v1 replay changed appointment');

  select appointment_id into v_new
  from public.create_public_appointment_with_recovery(
    's07-upgrade-salon','s07-v1-new-000001','S07 V1 New',
    '6c000000-0000-4000-8000-000000000207','7c000000-0000-4000-8000-000000000207',
    (v_day + time '12:00') at time zone 'Europe/Istanbul',
    encode(extensions.digest('s07:management:8c000000-0000-4000-8000-000000000203','sha256'),'hex'),
    '8c000000-0000-4000-8000-000000000203',repeat('c',64),
    repeat('e',64),repeat('k',16),1::smallint,
    '+90 555 207 00 03','s07-v1-new@example.test',null
  );
  perform pg_temp.s07_upgrade_assert(v_new is not null,'A package closed new v1 first create');
end
$$;

select pg_temp.s07_upgrade_assert(
  (select count(*) = 3 from public.appointments where business_id='4c000000-0000-4000-8000-000000000207'),
  'v1 replay duplicated or new v1 create disappeared'
);
select pg_temp.s07_upgrade_assert(
  (select recovery_secret_hash is null
     and management_token_ciphertext is null
     and management_token_iv is null
   from public.public_booking_recoveries
   where recovery_id='8c000000-0000-4000-8000-000000000202'),
  'migration recreated scrubbed v1 material'
);
select pg_temp.s07_upgrade_assert(
  (select count(*) = 3 from public.appointment_notification_jobs
   where business_id='4c000000-0000-4000-8000-000000000207'),
  'v1 replay/outbox behavior changed'
);

rollback;
