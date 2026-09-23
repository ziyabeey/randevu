create extension if not exists dblink;

-- H19 prospective coverage test: D0 x D5 (tenant isolation x concurrency).
--
-- Two independent tenants intentionally reuse the same group idempotency key.
-- Tenant A is parked *after* acquiring its F11 group-command lock by holding
-- A's later customer-resolution tenant lock in this coordinator session.
-- Correct behavior: tenant B must still complete because the group-command
-- advisory namespace is scoped by business_id.
--
-- M4 removes business_id from that advisory key. Under M4, tenant B aliases
-- onto tenant A's group-command lock and blocks even though all durable data
-- predicates remain tenant-scoped.

delete from public.businesses
where id in (
  'a1b10000-0000-4000-8000-000000000001',
  'a1b10000-0000-4000-8000-000000000002'
);

insert into auth.users(id,email,raw_user_meta_data)
values
  ('a1b00000-0000-4000-8000-000000000001','h19-d0d5-a@example.invalid','{}'::jsonb),
  ('a1b00000-0000-4000-8000-000000000002','h19-d0d5-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('a1b10000-0000-4000-8000-000000000001','H19 D0D5 Tenant A','h19-d0d5-a','Europe/Istanbul','a1b00000-0000-4000-8000-000000000001'),
  ('a1b10000-0000-4000-8000-000000000002','H19 D0D5 Tenant B','h19-d0d5-b','Europe/Istanbul','a1b00000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('a1b20000-0000-4000-8000-000000000001','a1b10000-0000-4000-8000-000000000001','a1b00000-0000-4000-8000-000000000001','owner',true),
  ('a1b20000-0000-4000-8000-000000000002','a1b10000-0000-4000-8000-000000000002','a1b00000-0000-4000-8000-000000000002','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('a1b30000-0000-4000-8000-000000000001','a1b10000-0000-4000-8000-000000000001','H19 Service A',30,0,0,'H19',10,10000,'fixed',10000,10000,'TRY',true),
  ('a1b30000-0000-4000-8000-000000000002','a1b10000-0000-4000-8000-000000000002','H19 Service B',30,0,0,'H19',10,10000,'fixed',10000,10000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('a1b40000-0000-4000-8000-000000000001','a1b10000-0000-4000-8000-000000000001','H19 Staff A',true),
  ('a1b40000-0000-4000-8000-000000000002','a1b10000-0000-4000-8000-000000000002','H19 Staff B',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('a1b10000-0000-4000-8000-000000000001','a1b40000-0000-4000-8000-000000000001','a1b30000-0000-4000-8000-000000000001',true),
  ('a1b10000-0000-4000-8000-000000000002','a1b40000-0000-4000-8000-000000000002','a1b30000-0000-4000-8000-000000000002',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'a1b10000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true
union all
select 'a1b10000-0000-4000-8000-000000000002',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'a1b10000-0000-4000-8000-000000000001'::uuid,'a1b40000-0000-4000-8000-000000000001'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true
union all
select 'a1b10000-0000-4000-8000-000000000002'::uuid,'a1b40000-0000-4000-8000-000000000002'::uuid,extract(dow from (date_trunc('week',current_date)::date+7))::smallint,time '09:00',time '18:00',true;

do $$
declare
  v_business_a uuid := 'a1b10000-0000-4000-8000-000000000001';
  v_business_b uuid := 'a1b10000-0000-4000-8000-000000000002';
  v_owner_a uuid := 'a1b00000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'a1b00000-0000-4000-8000-000000000002';
  v_day date := date_trunc('week',current_date)::date+7;
  v_shared_key text := 'h19-d0d5-shared-key-0001';
  v_lock_a bigint := hashtextextended(v_business_a::text,0);
  v_lock_held boolean := false;
  v_a_waited boolean := false;
  v_b_done boolean := false;
  v_b_lock_wait boolean := false;
  v_result_a jsonb;
  v_result_b jsonb;
  v_sql_a text;
  v_sql_b text;
begin
  perform dblink_connect(
    'h19_d0d5_a',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d0d5_a'
  );
  perform dblink_connect(
    'h19_d0d5_b',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=h19_d0d5_b'
  );

  foreach v_sql_a in array array['h19_d0d5_a','h19_d0d5_b'] loop
    perform dblink_exec(v_sql_a,'set statement_timeout=30000');
    perform dblink_exec(v_sql_a,'begin');
  end loop;

  perform dblink_exec('h19_d0d5_a','set local role authenticated');
  perform dblink_exec('h19_d0d5_a','set local "request.jwt.claim.sub" = '''||v_owner_a::text||'''');
  perform dblink_exec('h19_d0d5_a',$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  perform dblink_exec('h19_d0d5_b','set local role authenticated');
  perform dblink_exec('h19_d0d5_b','set local "request.jwt.claim.sub" = '''||v_owner_b::text||'''');
  perform dblink_exec('h19_d0d5_b',$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  -- Park tenant A later in customer resolution. By the time A waits here,
  -- its group-command advisory lock is already held by the remote transaction.
  perform pg_advisory_lock(v_lock_a);
  v_lock_held := true;

  v_sql_a := format($q$
    select public.create_appointment_group(
      %L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L
    )
  $q$,
    v_business_a,
    v_shared_key,
    'H19 Customer A',
    '[{"serviceId":"a1b30000-0000-4000-8000-000000000001","staffId":"a1b40000-0000-4000-8000-000000000001"}]',
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    '05554000001'
  );

  if dblink_send_query('h19_d0d5_a',v_sql_a) <> 1 then
    raise exception 'H19 D0xD5 could not start tenant A writer';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists(
      select 1 from pg_stat_activity
      where application_name='h19_d0d5_a' and wait_event_type='Lock'
    ) then
      v_a_waited := true;
      exit;
    end if;
    perform pg_sleep(.01);
  end loop;
  if not v_a_waited then
    raise exception 'H19 D0xD5 tenant A did not reach the parked customer lock';
  end if;

  -- Tenant B uses the same idempotency key but is otherwise fully independent.
  -- Correct code must not inherit A's group-command lock.
  v_sql_b := format($q$
    select public.create_appointment_group(
      %L::uuid,%L,%L,%L::jsonb,%L::timestamptz,%L
    )
  $q$,
    v_business_b,
    v_shared_key,
    'H19 Customer B',
    '[{"serviceId":"a1b30000-0000-4000-8000-000000000002","staffId":"a1b40000-0000-4000-8000-000000000002"}]',
    (v_day+time '11:00') at time zone 'Europe/Istanbul',
    '05554000002'
  );

  if dblink_send_query('h19_d0d5_b',v_sql_b) <> 1 then
    raise exception 'H19 D0xD5 could not start tenant B writer';
  end if;

  for i in 1..500 loop
    if dblink_is_busy('h19_d0d5_b') = 0 then
      v_b_done := true;
      exit;
    end if;
    perform pg_stat_clear_snapshot();
    if exists(
      select 1 from pg_stat_activity
      where application_name='h19_d0d5_b' and wait_event_type='Lock'
    ) then
      v_b_lock_wait := true;
      exit;
    end if;
    perform pg_sleep(.01);
  end loop;

  if v_b_lock_wait then
    raise exception 'H19 D0xD5 cross-tenant group-command lock alias blocked tenant B';
  end if;
  if not v_b_done then
    raise exception 'H19 D0xD5 tenant B did not complete independently';
  end if;

  select x.r into strict v_result_b
  from dblink_get_result('h19_d0d5_b') x(r jsonb);
  perform * from dblink_get_result('h19_d0d5_b',false) x(r jsonb);
  perform dblink_exec('h19_d0d5_b','commit');
  perform dblink_disconnect('h19_d0d5_b');

  perform pg_advisory_unlock(v_lock_a);
  v_lock_held := false;

  for i in 1..3000 loop
    exit when dblink_is_busy('h19_d0d5_a') = 0;
    perform pg_sleep(.01);
  end loop;
  if dblink_is_busy('h19_d0d5_a') <> 0 then
    raise exception 'H19 D0xD5 tenant A did not resume after releasing its customer lock';
  end if;

  select x.r into strict v_result_a
  from dblink_get_result('h19_d0d5_a') x(r jsonb);
  perform * from dblink_get_result('h19_d0d5_a',false) x(r jsonb);
  perform dblink_exec('h19_d0d5_a','commit');
  perform dblink_disconnect('h19_d0d5_a');

  if v_result_a->>'groupId' is null or v_result_b->>'groupId' is null then
    raise exception 'H19 D0xD5 expected both independent tenant groups to commit';
  end if;

  if (
    select count(*)
    from public.booking_commands
    where idempotency_key=v_shared_key
      and business_id in (v_business_a,v_business_b)
  ) <> 2 then
    raise exception 'H19 D0xD5 expected one durable command per tenant';
  end if;

  raise notice 'H19 D0xD5 prospective invariant accepted: same key does not serialize independent tenants';
exception when others then
  if v_lock_held then
    perform pg_advisory_unlock(v_lock_a);
  end if;
  begin perform dblink_exec('h19_d0d5_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('h19_d0d5_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d0d5_a'); exception when others then null; end;
  begin perform dblink_disconnect('h19_d0d5_b'); exception when others then null; end;
  raise;
end
$$;

delete from public.businesses
where id in (
  'a1b10000-0000-4000-8000-000000000001',
  'a1b10000-0000-4000-8000-000000000002'
);
