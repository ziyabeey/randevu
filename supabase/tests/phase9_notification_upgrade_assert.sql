do $$
begin
  if (select count(*) from public.appointment_notification_jobs
      where recovery_id='8b000000-0000-4000-8000-000000000007') <> 1 then
    raise exception 'F09-03 upgrade did not backfill notification job';
  end if;

  if not exists (
    select 1 from public.appointment_notification_jobs
    where recovery_id='8b000000-0000-4000-8000-000000000007'
      and state='pending'
      and recipient='upgrade@example.test'
      and provider_idempotency_key like 'public-booking-confirmation/%'
  ) then raise exception 'backfilled notification job payload is incorrect'; end if;
end
$$;

insert into public.notification_dispatch_config(config_key, secret_hash)
values (
  'default',
  encode(digest('uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu','sha256'),'hex')
)
on conflict(config_key) do update set secret_hash=excluded.secret_hash, updated_at=now();

-- Simulate a terminal job whose recovery window has ended, then verify scheduled
-- maintenance can remove encrypted management material even without provider send.
update public.appointment_notification_jobs
set state='failed_terminal',
    terminal_at=now(),
    last_error_class='upgrade-test-terminal'
where recovery_id='8b000000-0000-4000-8000-000000000007';

update public.public_booking_recoveries
set expires_at=now()-interval '1 minute'
where recovery_id='8b000000-0000-4000-8000-000000000007';

set role anon;
do $$
declare
  v_result record;
begin
  select * into v_result
  from public.maintain_notification_jobs(
    'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu'
  );
  if v_result.recovery_material_cleaned < 1 then
    raise exception 'notification maintenance did not clean expired recovery material';
  end if;
end
$$;
reset role;

do $$
begin
  if exists (
    select 1 from public.public_booking_recoveries
    where recovery_id='8b000000-0000-4000-8000-000000000007'
      and (recovery_secret_hash is not null
        or management_token_ciphertext is not null
        or management_token_iv is not null)
  ) then raise exception 'expired terminal recovery material remained after maintenance'; end if;
end
$$;
