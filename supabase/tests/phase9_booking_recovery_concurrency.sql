create extension if not exists dblink;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '18000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase9-concurrency-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4a000000-0000-4000-8000-000000000002','Recovery Race','recovery-race','Europe/Istanbul',
  '18000000-0000-4000-8000-000000000002'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5a000000-0000-4000-8000-000000000002','4a000000-0000-4000-8000-000000000002',
  '18000000-0000-4000-8000-000000000002','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6a000000-0000-4000-8000-000000000002','4a000000-0000-4000-8000-000000000002',
  'Race Hizmeti',30,5,5,200000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7a000000-0000-4000-8000-000000000002','4a000000-0000-4000-8000-000000000002','Race Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4a000000-0000-4000-8000-000000000002','7a000000-0000-4000-8000-000000000002',
  '6a000000-0000-4000-8000-000000000002',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set role authenticated;
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000002',false);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4a000000-0000-4000-8000-000000000002',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4a000000-0000-4000-8000-000000000002',
    '7a000000-0000-4000-8000-000000000002',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4a000000-0000-4000-8000-000000000002', true, 15, 0, 30
  );
end
$$;

reset role;

-- Two physical database sessions exercise the actual transaction advisory lock.
-- Session A creates the booking then sleeps inside the same statement transaction,
-- keeping the recovery-id lock held. Session B attempts recovery and must wait.
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:05') at time zone 'Europe/Istanbul';
  v_create_sql text;
  v_recover_sql text;
  v_count bigint;
  v_created uuid;
  v_started timestamptz;
  v_elapsed double precision;
begin
  perform dblink_connect('f09_create','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres');
  perform dblink_connect('f09_recover','host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres');

  v_create_sql := format($sql$
    select c.appointment_id
    from public.create_public_appointment_with_recovery(
      'recovery-race','phase9-race-create-0001','Race Müşteri',
      '6a000000-0000-4000-8000-000000000002','7a000000-0000-4000-8000-000000000002',
      %L::timestamptz,
      encode(digest('ggggggggggggggggggggggggggggggggggggggggggg','sha256'),'hex'),
      '8a000000-0000-4000-8000-000000000002',
      encode(digest('hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh','sha256'),'hex'),
      'ciphertext-race-abcdefghijklmnopqrstuvwxyz0123456789','iv-race-12345678',1::smallint,
      '+90 555 900 00 03','phase9-race@example.test',null
    ) c
    cross join lateral (select pg_sleep(2)) delay
  $sql$, v_start);

  if dblink_send_query('f09_create', v_create_sql) <> 1 then
    raise exception 'could not start concurrent create query';
  end if;

  perform pg_sleep(0.25);
  v_started := clock_timestamp();
  v_recover_sql := $sql$
    select count(*)::bigint as c
    from public.recover_public_appointment(
      '8a000000-0000-4000-8000-000000000002',
      'phase9-race-create-0001',
      encode(digest('hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh','sha256'),'hex')
    )
  $sql$;

  select t.c into v_count
  from dblink('f09_recover', v_recover_sql) as t(c bigint);
  v_elapsed := extract(epoch from (clock_timestamp() - v_started));

  if v_count <> 1 then
    raise exception 'concurrent recovery did not observe committed booking';
  end if;
  if v_elapsed < 1.25 then
    raise exception 'recovery did not wait for the in-flight create transaction: % seconds', v_elapsed;
  end if;

  select t.appointment_id into v_created
  from dblink_get_result('f09_create') as t(appointment_id uuid);
  if v_created is null then
    raise exception 'concurrent create did not return an appointment';
  end if;

  perform dblink_disconnect('f09_create');
  perform dblink_disconnect('f09_recover');
exception when others then
  begin perform dblink_disconnect('f09_create'); exception when others then null; end;
  begin perform dblink_disconnect('f09_recover'); exception when others then null; end;
  raise;
end
$$;

-- The concurrency test intentionally commits fixture data in the ephemeral CI DB.
-- No later test depends on these IDs.
