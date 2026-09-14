create extension if not exists dblink;

insert into auth.users(id, email, raw_user_meta_data)
values ('da000000-0000-4000-8000-000000000001', 'authority-race-owner@example.invalid', '{"full_name":"Authority Race Owner"}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values (
  'db000000-0000-4000-8000-000000000001',
  'Authority Race', 'authority-race', 'Europe/Istanbul',
  'da000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id, business_id, user_id, role, active)
values (
  'dc000000-0000-4000-8000-000000000001',
  'db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001',
  'owner', true
)
on conflict(business_id, user_id) do update set role='owner', active=true;

insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('dd000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'Race Service', 30, 12000, true)
on conflict(id) do nothing;

insert into public.staff_profiles(id, business_id, name, active)
values ('de000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000001', 'Race Staff', true)
on conflict(id) do nothing;

insert into public.staff_services(business_id, staff_id, service_id, active)
values ('db000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-000000000001', true)
on conflict(business_id, staff_id, service_id) do update set active=true;

insert into public.business_hours(business_id, weekday, starts_local, ends_local, active)
select 'db000000-0000-4000-8000-000000000001', d::smallint, '09:00'::time, '18:00'::time, true
from generate_series(0,6) d
on conflict do nothing;

insert into public.staff_hours(business_id, staff_id, weekday, starts_local, ends_local, active)
select 'db000000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', d::smallint, '09:00'::time, '18:00'::time, true
from generate_series(0,6) d
on conflict do nothing;

update public.public_booking_settings
set enabled=true, step_minutes=5, min_notice_minutes=0, horizon_days=60
where business_id='db000000-0000-4000-8000-000000000001';

delete from public.booking_commands where business_id='db000000-0000-4000-8000-000000000001';
delete from public.appointments where business_id='db000000-0000-4000-8000-000000000001';
delete from public.customers where business_id='db000000-0000-4000-8000-000000000001';

do $$
declare
  v_lock_key bigint := hashtextextended('db000000-0000-4000-8000-000000000001', 0);
  v_lock_available boolean;
  v_waited boolean;
  v_first uuid;
  v_public_appointment uuid;
  v_public_customer uuid;
  v_operator_appointment uuid;
  v_operator_customer uuid;
  v_count integer;
  v_date date := (now() at time zone 'Europe/Istanbul')::date + 7;
  v_public_starts timestamptz;
  v_operator_starts timestamptz;
begin
  v_public_starts := (v_date + time '10:00') at time zone 'Europe/Istanbul';
  v_operator_starts := (v_date + time '12:00') at time zone 'Europe/Istanbul';

  perform dblink_connect(
    'f10_authority_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f10_authority_a'
  );
  perform dblink_connect(
    'f10_authority_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f10_authority_b'
  );
  perform dblink_exec('f10_authority_a', 'set statement_timeout=5000');
  perform dblink_exec('f10_authority_b', 'set statement_timeout=5000');

  -- CRM -> public race.
  perform dblink_exec('f10_authority_a', 'begin');
  perform dblink_exec('f10_authority_b', 'begin');
  perform dblink_exec('f10_authority_a', 'set local role authenticated');
  perform dblink_exec('f10_authority_a', $q$set local "request.jwt.claim.sub" = 'da000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f10_authority_a', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  if dblink_send_query(
    'f10_authority_a',
    $q$
      select customer_id
      from public.create_business_customer(
        'db000000-0000-4000-8000-000000000001',
        'CRM Public Race', '0555 801 02 03', 'crm-public-race@example.invalid', null
      )
    $q$
  ) <> 1 then raise exception 'could not start CRM/public first create'; end if;

  select t.customer_id into v_first
  from dblink_get_result('f10_authority_a') as t(customer_id uuid);
  perform * from dblink_get_result('f10_authority_a') as t(customer_id uuid);
  if v_first is null then raise exception 'CRM/public first create returned no customer'; end if;

  v_lock_available := pg_try_advisory_lock(v_lock_key);
  if v_lock_available then
    perform pg_advisory_unlock(v_lock_key);
    raise exception 'CRM/public first transaction did not retain tenant lock';
  end if;

  if dblink_send_query(
    'f10_authority_b',
    format($q$
      select appointment_id
      from public.create_public_appointment(
        'authority-race',
        'authority-public-race-0001',
        'Public Race Snapshot',
        'dd000000-0000-4000-8000-000000000001',
        'de000000-0000-4000-8000-000000000001',
        %L::timestamptz,
        '+90 555 801 02 03',
        'CRM-PUBLIC-RACE@example.invalid',
        null
      )
    $q$, v_public_starts)
  ) <> 1 then raise exception 'could not start public race create'; end if;

  v_waited := false;
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f10_authority_b' and wait_event_type='Lock'
    ) then v_waited := true; exit; end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then raise exception 'public booking did not wait on shared customer lock'; end if;

  perform dblink_exec('f10_authority_a', 'commit');
  select t.appointment_id into v_public_appointment
  from dblink_get_result('f10_authority_b') as t(appointment_id uuid);
  perform * from dblink_get_result('f10_authority_b') as t(appointment_id uuid);
  perform dblink_exec('f10_authority_b', 'commit');

  select a.customer_id into v_public_customer
  from public.appointments a where a.id=v_public_appointment;
  if v_public_customer <> v_first then
    raise exception 'CRM/public race created or linked a different canonical customer';
  end if;
  select count(*) into v_count from public.customers c
  where c.business_id='db000000-0000-4000-8000-000000000001'
    and public.f10_normalize_customer_phone(c.phone)='5558010203';
  if v_count <> 1 then raise exception 'CRM/public race left % customer rows', v_count; end if;

  -- CRM -> operator race using a separate canonical contact and appointment slot.
  perform dblink_exec('f10_authority_a', 'begin');
  perform dblink_exec('f10_authority_b', 'begin');
  perform dblink_exec('f10_authority_a', 'set local role authenticated');
  perform dblink_exec('f10_authority_b', 'set local role authenticated');
  perform dblink_exec('f10_authority_a', $q$set local "request.jwt.claim.sub" = 'da000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f10_authority_b', $q$set local "request.jwt.claim.sub" = 'da000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f10_authority_a', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform dblink_exec('f10_authority_b', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  if dblink_send_query(
    'f10_authority_a',
    $q$
      select customer_id
      from public.create_business_customer(
        'db000000-0000-4000-8000-000000000001',
        'CRM Operator Race', '0555 804 05 06', 'crm-operator-race@example.invalid', null
      )
    $q$
  ) <> 1 then raise exception 'could not start CRM/operator first create'; end if;

  select t.customer_id into v_first
  from dblink_get_result('f10_authority_a') as t(customer_id uuid);
  perform * from dblink_get_result('f10_authority_a') as t(customer_id uuid);
  if v_first is null then raise exception 'CRM/operator first create returned no customer'; end if;

  if dblink_send_query(
    'f10_authority_b',
    format($q$
      select id, customer_id
      from public.create_appointment(
        'db000000-0000-4000-8000-000000000001',
        'authority-operator-race-0001',
        'Operator Race Snapshot',
        'dd000000-0000-4000-8000-000000000001',
        'de000000-0000-4000-8000-000000000001',
        %L::timestamptz,
        '+90 555 804 05 06',
        'CRM-OPERATOR-RACE@example.invalid',
        null
      )
    $q$, v_operator_starts)
  ) <> 1 then raise exception 'could not start operator race create'; end if;

  v_waited := false;
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
      where application_name='f10_authority_b' and wait_event_type='Lock'
    ) then v_waited := true; exit; end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then raise exception 'operator booking did not wait on shared customer lock'; end if;

  perform dblink_exec('f10_authority_a', 'commit');
  select t.id, t.customer_id into v_operator_appointment, v_operator_customer
  from dblink_get_result('f10_authority_b') as t(id uuid, customer_id uuid);
  perform * from dblink_get_result('f10_authority_b') as t(id uuid, customer_id uuid);
  perform dblink_exec('f10_authority_b', 'commit');

  if v_operator_appointment is null or v_operator_customer <> v_first then
    raise exception 'CRM/operator race did not reuse canonical customer';
  end if;
  select count(*) into v_count from public.customers c
  where c.business_id='db000000-0000-4000-8000-000000000001'
    and public.f10_normalize_customer_phone(c.phone)='5558040506';
  if v_count <> 1 then raise exception 'CRM/operator race left % customer rows', v_count; end if;

  perform dblink_disconnect('f10_authority_a');
  perform dblink_disconnect('f10_authority_b');
  raise notice 'F10-05 cross-writer customer races serialized and reused one canonical customer';
exception when others then
  begin perform dblink_exec('f10_authority_a', 'rollback'); exception when others then null; end;
  begin perform dblink_exec('f10_authority_b', 'rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f10_authority_a'); exception when others then null; end;
  begin perform dblink_disconnect('f10_authority_b'); exception when others then null; end;
  raise;
end
$$;

-- Disposable yzt_test only; IDs are isolated from other acceptance fixtures.
