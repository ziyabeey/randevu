create extension if not exists dblink;

insert into auth.users(id, email, raw_user_meta_data)
values ('c6000000-0000-4000-8000-000000000001', 'f10-customer-race@example.invalid', '{"full_name":"Customer Race Owner"}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id, name, slug, timezone, created_by)
values (
  'c6100000-0000-4000-8000-000000000001',
  'Customer Race', 'customer-race', 'Europe/Istanbul',
  'c6000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id, business_id, user_id, role, active)
values (
  'c6200000-0000-4000-8000-000000000001',
  'c6100000-0000-4000-8000-000000000001',
  'c6000000-0000-4000-8000-000000000001',
  'owner', true
)
on conflict(business_id, user_id) do update set role='owner', active=true;

delete from public.customers where business_id = 'c6100000-0000-4000-8000-000000000001';

do $$
declare
  v_lock_key bigint := hashtextextended('c6100000-0000-4000-8000-000000000001', 0);
  v_lock_available boolean;
  v_waited boolean := false;
  v_first uuid;
  v_count integer;
begin
  perform dblink_connect(
    'f10_customer_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f10_customer_a'
  );
  perform dblink_connect(
    'f10_customer_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=f10_customer_b'
  );

  perform dblink_exec('f10_customer_a', 'set statement_timeout=5000');
  perform dblink_exec('f10_customer_b', 'set statement_timeout=5000');
  perform dblink_exec('f10_customer_a', 'begin');
  perform dblink_exec('f10_customer_b', 'begin');
  perform dblink_exec('f10_customer_a', 'set local role authenticated');
  perform dblink_exec('f10_customer_b', 'set local role authenticated');
  perform dblink_exec('f10_customer_a', $q$set local "request.jwt.claim.sub" = 'c6000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f10_customer_b', $q$set local "request.jwt.claim.sub" = 'c6000000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('f10_customer_a', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  perform dblink_exec('f10_customer_b', $q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);

  if dblink_send_query(
    'f10_customer_a',
    $q$
      select customer_id
      from public.create_business_customer(
        'c6100000-0000-4000-8000-000000000001',
        'Race First', '0555 123 45 67', 'race@example.invalid', null
      )
    $q$
  ) <> 1 then
    raise exception 'could not start first customer create';
  end if;

  select t.customer_id into v_first
  from dblink_get_result('f10_customer_a') as t(customer_id uuid);
  if v_first is null then raise exception 'first customer create returned no id'; end if;

  v_lock_available := pg_try_advisory_lock(v_lock_key);
  if v_lock_available then
    perform pg_advisory_unlock(v_lock_key);
    raise exception 'first customer transaction did not retain tenant advisory lock';
  end if;

  if dblink_send_query(
    'f10_customer_b',
    $q$
      select customer_id
      from public.create_business_customer(
        'c6100000-0000-4000-8000-000000000001',
        'Race Second', '+90 555 123 45 67', 'RACE@example.invalid', null
      )
    $q$
  ) <> 1 then
    raise exception 'could not start second customer create';
  end if;

  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
      from pg_stat_activity
      where application_name = 'f10_customer_b'
        and wait_event_type = 'Lock'
    ) then
      v_waited := true;
      exit;
    end if;
    perform pg_sleep(0.02);
  end loop;
  if not v_waited then raise exception 'second customer create did not wait on tenant lock'; end if;

  perform dblink_exec('f10_customer_a', 'commit');

  begin
    perform * from dblink_get_result('f10_customer_b') as t(customer_id uuid);
    raise exception 'concurrent duplicate customer unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'concurrent duplicate customer unexpectedly succeeded' then raise; end if;
    if position('CUSTOMER_CONTACT_EXISTS' in sqlerrm) = 0 then raise; end if;
  end;

  begin perform dblink_exec('f10_customer_b', 'rollback'); exception when others then null; end;

  select count(*) into v_count
  from public.customers c
  where c.business_id = 'c6100000-0000-4000-8000-000000000001'
    and public.f10_normalize_customer_email(c.email) = 'race@example.invalid';
  if v_count <> 1 then raise exception 'concurrent create left % canonical contact rows', v_count; end if;

  perform dblink_disconnect('f10_customer_a');
  perform dblink_disconnect('f10_customer_b');
  raise notice 'F10-05 concurrent customer create: first committed, duplicate rejected';
exception when others then
  begin perform dblink_disconnect('f10_customer_a'); exception when others then null; end;
  begin perform dblink_disconnect('f10_customer_b'); exception when others then null; end;
  raise;
end
$$;

-- Disposable yzt_test only; IDs are isolated from other acceptance fixtures.
