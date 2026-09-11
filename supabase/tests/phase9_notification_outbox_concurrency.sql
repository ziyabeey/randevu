create extension if not exists dblink;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase9-notify-race-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000004','Notification Race','notification-race','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000004'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000004','4b000000-0000-4000-8000-000000000004',
  '19000000-0000-4000-8000-000000000004','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000004','4b000000-0000-4000-8000-000000000004',
  'Notification Race Hizmeti',30,5,5,220000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000004','4b000000-0000-4000-8000-000000000004','Race Deniz'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000004','7b000000-0000-4000-8000-000000000004',
  '6b000000-0000-4000-8000-000000000004',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000004',false);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000004',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000004',
    '7b000000-0000-4000-8000-000000000004',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000004', true, 15, 0, 30
  );
end
$$;

reset role;
insert into public.notification_dispatch_config(config_key, secret_hash)
values (
  'default',
  encode(digest('ttttttttttttttttttttttttttttttttttttttttttt','sha256'),'hex')
)
on conflict(config_key) do update set secret_hash=excluded.secret_hash, updated_at=now();

set role anon;
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '13:05') at time zone 'Europe/Istanbul';
begin
  perform public.create_public_appointment_with_recovery(
    'notification-race','phase9-notify-race-0001','Race Notify',
    '6b000000-0000-4000-8000-000000000004','7b000000-0000-4000-8000-000000000004',
    v_start,
    encode(digest('ooooooooooooooooooooooooooooooooooooooooooo','sha256'),'hex'),
    '8b000000-0000-4000-8000-000000000006',
    encode(digest('ppppppppppppppppppppppppppppppppppppppp','sha256'),'hex'),
    'ciphertext-race-notify-abcdefghijklmnopqrstuvwxyz012345','iv-race-notify-12',1::smallint,
    '+90 555 900 00 13','race-notify@example.test',null
  );
end
$$;
reset role;

-- Session A claims the only job, acquires a synchronization advisory lock after
-- the row has been claimed, then sleeps while the transaction still owns the row
-- lock. Session B must SKIP LOCKED and return immediately with zero jobs.
do $$
declare
  v_query_a text;
  v_query_b text;
  v_count bigint;
  v_job uuid;
  v_sync_key bigint := 909030004;
  v_attempt integer := 0;
  v_sync_available boolean;
  v_started timestamptz;
  v_elapsed double precision;
begin
  perform dblink_connect('notify_claim_a','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres');
  perform dblink_connect('notify_claim_b','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres');

  v_query_a := format($sql$
    select c.job_id
    from public.claim_notification_jobs(
      'ttttttttttttttttttttttttttttttttttttttttttt', 1, 45
    ) c
    cross join lateral (
      select pg_advisory_lock(%s)
      where c.job_id is not null
    ) sync
    cross join lateral (
      select pg_sleep(2)
      where c.job_id is not null
    ) delay
  $sql$, v_sync_key);

  if dblink_send_query('notify_claim_a', v_query_a) <> 1 then
    raise exception 'could not start first dispatcher claim';
  end if;

  loop
    v_sync_available := pg_try_advisory_lock(v_sync_key);
    if not v_sync_available then exit; end if;
    perform pg_advisory_unlock(v_sync_key);
    v_attempt := v_attempt + 1;
    if v_attempt > 100 then
      raise exception 'first dispatcher never reached claimed-row synchronization point';
    end if;
    perform pg_sleep(0.02);
  end loop;

  v_started := clock_timestamp();
  v_query_b := $sql$
    select count(*)::bigint as c
    from public.claim_notification_jobs(
      'ttttttttttttttttttttttttttttttttttttttttttt', 1, 45
    )
  $sql$;

  select t.c into v_count
  from dblink('notify_claim_b', v_query_b) as t(c bigint);
  v_elapsed := extract(epoch from (clock_timestamp() - v_started));

  if v_count <> 0 then
    raise exception 'second dispatcher claimed a row already owned by first dispatcher';
  end if;
  if v_elapsed >= 1.25 then
    raise exception 'second dispatcher blocked instead of skip-locked: % seconds', v_elapsed;
  end if;

  select t.job_id into v_job
  from dblink_get_result('notify_claim_a') as t(job_id uuid);
  if v_job is null then raise exception 'first dispatcher did not claim job'; end if;

  perform dblink_disconnect('notify_claim_a');
  perform dblink_disconnect('notify_claim_b');
exception when others then
  begin perform dblink_disconnect('notify_claim_a'); exception when others then null; end;
  begin perform dblink_disconnect('notify_claim_b'); exception when others then null; end;
  raise;
end
$$;

-- Fixture intentionally persists only in the ephemeral CI database.
