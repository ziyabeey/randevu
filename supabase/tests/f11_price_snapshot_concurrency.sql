create extension if not exists dblink;

-- Dedicated F11-01 race fixture. Each create reads service v1, then blocks in the
-- canonical customer resolver on the tenant advisory lock. A separate catalog
-- session commits a price/currency edit before releasing that lock. A coherent
-- F11 snapshot must therefore fail cleanly instead of mixing v1 money with v2
-- policy metadata.
delete from public.businesses
where id = 'd1310000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values (
  'd1300000-0000-4000-8000-000000000001',
  'f11-price-race-owner@example.invalid',
  '{}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'd1310000-0000-4000-8000-000000000001',
  'F11 Price Race Salon',
  'f11-price-race-salon',
  'Europe/Istanbul',
  'd1300000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'd1320000-0000-4000-8000-000000000001',
  'd1310000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,
  price_policy_version,currency,active
) values (
  'd1330000-0000-4000-8000-000000000001',
  'd1310000-0000-4000-8000-000000000001',
  'F11 Coherent Fixed',30,0,0,
  'Genel',10,10000,'fixed',10000,10000,1,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values (
  'd1340000-0000-4000-8000-000000000001',
  'd1310000-0000-4000-8000-000000000001',
  'F11 Price Race Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'd1310000-0000-4000-8000-000000000001',
  'd1340000-0000-4000-8000-000000000001',
  'd1330000-0000-4000-8000-000000000001',true
);

insert into public.business_hours(
  id,business_id,weekday,starts_local,ends_local,active
) values (
  'd1350000-0000-4000-8000-000000000001',
  'd1310000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,
  time '09:00',time '18:00',true
);

insert into public.staff_hours(
  id,business_id,staff_id,weekday,starts_local,ends_local,active
) values (
  'd1360000-0000-4000-8000-000000000001',
  'd1310000-0000-4000-8000-000000000001',
  'd1340000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,
  time '09:00',time '18:00',true
);

insert into public.public_booking_settings(
  business_id,enabled,step_minutes,min_notice_minutes,horizon_days
) values (
  'd1310000-0000-4000-8000-000000000001',true,15,0,30
)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

do $$
declare
  v_business_id uuid := 'd1310000-0000-4000-8000-000000000001';
  v_service_id uuid := 'd1330000-0000-4000-8000-000000000001';
  v_staff_id uuid := 'd1340000-0000-4000-8000-000000000001';
  v_owner_id uuid := 'd1300000-0000-4000-8000-000000000001';
  v_day date := date_trunc('week',current_date)::date+7;
  v_operator_start timestamptz;
  v_public_start timestamptz;
  v_lock_key bigint := hashtextextended(v_business_id::text,0);
  v_lock_held boolean := false;
  v_waited boolean;
  v_sql text;
begin
  v_operator_start := (v_day+time '10:00') at time zone 'Europe/Istanbul';
  v_public_start := (v_day+time '12:00') at time zone 'Europe/Istanbul';

  -- Catalog edits must commit independently of this DO block. Otherwise the
  -- creator cannot observe the new service policy after leaving the lock wait.
  perform dblink_connect(
    'f11_price_catalog',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f11_price_catalog'
  );
  perform dblink_exec('f11_price_catalog','set statement_timeout=8000');

  -- Operator legacy fixed create reads v1=10000/TRY, then waits on the canonical
  -- customer resolver. While blocked, commit v2=12000/USD. The F11 insert fence
  -- must reject the stale legacy tuple instead of stamping v2 policy metadata.
  perform dblink_connect(
    'f11_price_operator',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f11_price_operator'
  );
  perform dblink_exec('f11_price_operator','set statement_timeout=8000');
  perform dblink_exec('f11_price_operator','begin');
  perform dblink_exec('f11_price_operator','set local role authenticated');
  perform dblink_exec(
    'f11_price_operator',
    'set local "request.jwt.claim.sub" = '''||v_owner_id::text||''''
  );
  perform dblink_exec(
    'f11_price_operator',
    $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$
  );

  perform pg_advisory_lock(v_lock_key);
  v_lock_held := true;
  v_sql := format($q$
    select id,price_minor_snapshot,currency_snapshot,price_policy_version_snapshot
    from public.create_appointment(
      'd1310000-0000-4000-8000-000000000001',
      'f11-price-operator-race-0001',
      'F11 Operator Race',
      'd1330000-0000-4000-8000-000000000001',
      'd1340000-0000-4000-8000-000000000001',
      %L::timestamptz,
      '+90 555 130 00 01',
      'f11-price-operator-race@example.invalid',
      null
    )
  $q$,v_operator_start);
  if dblink_send_query('f11_price_operator',v_sql) <> 1 then
    raise exception 'could not start operator price race';
  end if;

  v_waited := false;
  for i in 1..250 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f11_price_operator'
        and wait_event_type='Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then
    raise exception 'operator create did not reach the post-service customer lock';
  end if;

  perform dblink_exec(
    'f11_price_catalog',
    $q$update public.services
       set price_minor=12000,currency='USD'
       where id='d1330000-0000-4000-8000-000000000001'$q$
  );
  perform pg_advisory_unlock(v_lock_key);
  v_lock_held := false;

  begin
    perform *
    from dblink_get_result('f11_price_operator')
      as t(id uuid,price_minor_snapshot integer,currency_snapshot text,price_policy_version_snapshot integer);
    raise exception 'operator price race unexpectedly succeeded';
  exception when others then
    if sqlerrm='operator price race unexpectedly succeeded' then raise; end if;
    if position('SERVICE_PRICE_SNAPSHOT_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;
  perform *
  from dblink_get_result('f11_price_operator',false)
    as t(id uuid,price_minor_snapshot integer,currency_snapshot text,price_policy_version_snapshot integer);
  perform dblink_exec('f11_price_operator','rollback');
  perform dblink_disconnect('f11_price_operator');

  if exists (
    select 1 from public.appointments
    where business_id=v_business_id
      and customer_email_snapshot='f11-price-operator-race@example.invalid'
  ) then
    raise exception 'operator race persisted an appointment after snapshot mismatch';
  end if;

  -- Establish a distinct coherent baseline for the public authority-class race.
  -- The F12 trigger bumps policy version for this normal catalog mutation.
  perform dblink_exec(
    'f11_price_catalog',
    $q$update public.services
       set price_minor=20000,currency='TRY'
       where id='d1330000-0000-4000-8000-000000000001'$q$
  );

  perform dblink_connect(
    'f11_price_public',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=f11_price_public'
  );
  perform dblink_exec('f11_price_public','set statement_timeout=8000');
  perform dblink_exec('f11_price_public','begin');

  perform pg_advisory_lock(v_lock_key);
  v_lock_held := true;
  v_sql := format($q$
    select appointment_id,status,starts_at,ends_at,timezone,service_name,staff_name,price_minor,currency
    from public.create_public_appointment(
      'f11-price-race-salon',
      'f11-price-public-race-0001',
      'F11 Public Race',
      'd1330000-0000-4000-8000-000000000001',
      'd1340000-0000-4000-8000-000000000001',
      %L::timestamptz,
      '+90 555 130 00 02',
      'f11-price-public-race@example.invalid',
      null
    )
  $q$,v_public_start);
  if dblink_send_query('f11_price_public',v_sql) <> 1 then
    raise exception 'could not start public price race';
  end if;

  v_waited := false;
  for i in 1..250 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f11_price_public'
        and wait_event_type='Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then
    raise exception 'public create did not reach the post-service customer lock';
  end if;

  perform dblink_exec(
    'f11_price_catalog',
    $q$update public.services
       set price_minor=23000,currency='EUR'
       where id='d1330000-0000-4000-8000-000000000001'$q$
  );
  perform pg_advisory_unlock(v_lock_key);
  v_lock_held := false;

  begin
    perform *
    from dblink_get_result('f11_price_public')
      as t(
        appointment_id uuid,status text,starts_at timestamptz,ends_at timestamptz,
        timezone text,service_name text,staff_name text,price_minor integer,currency text
      );
    raise exception 'public price race unexpectedly succeeded';
  exception when others then
    if sqlerrm='public price race unexpectedly succeeded' then raise; end if;
    if position('SERVICE_PRICE_SNAPSHOT_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;
  perform *
  from dblink_get_result('f11_price_public',false)
    as t(
      appointment_id uuid,status text,starts_at timestamptz,ends_at timestamptz,
      timezone text,service_name text,staff_name text,price_minor integer,currency text
    );
  perform dblink_exec('f11_price_public','rollback');
  perform dblink_disconnect('f11_price_public');
  perform dblink_disconnect('f11_price_catalog');

  if exists (
    select 1 from public.appointments
    where business_id=v_business_id
      and customer_email_snapshot='f11-price-public-race@example.invalid'
  ) then
    raise exception 'public race persisted an appointment after snapshot mismatch';
  end if;

  if not exists (
    select 1 from public.services
    where id=v_service_id
      and price_type='fixed'
      and price_minor=23000
      and price_min_minor=23000
      and price_max_minor=23000
      and currency='EUR'
      and price_policy_version=4
  ) then
    raise exception 'race fixture did not produce four coherent service policy states';
  end if;

  raise notice 'F11-01 operator/public fixed-price concurrency fence accepted';
exception when others then
  if v_lock_held then
    perform pg_advisory_unlock(v_lock_key);
  end if;
  begin perform dblink_exec('f11_price_operator','rollback'); exception when others then null; end;
  begin perform dblink_exec('f11_price_public','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f11_price_operator'); exception when others then null; end;
  begin perform dblink_disconnect('f11_price_public'); exception when others then null; end;
  begin perform dblink_disconnect('f11_price_catalog'); exception when others then null; end;
  raise;
end
$$;