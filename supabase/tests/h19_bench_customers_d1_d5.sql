create extension if not exists dblink;

insert into auth.users(id,email,raw_user_meta_data)
values (
  'e1a00000-0000-4000-8000-000000000001',
  'h19-bench-customers-d1d5@example.invalid',
  '{}'::jsonb
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'e1a10000-0000-4000-8000-000000000001',
  'H19 Bench Customers D1D5',
  'h19-bench-customers-d1d5',
  'Europe/Istanbul',
  'e1a00000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'e1a20000-0000-4000-8000-000000000001',
  'e1a10000-0000-4000-8000-000000000001',
  'e1a00000-0000-4000-8000-000000000001',
  'owner',
  true
)
on conflict(business_id,user_id) do update
set role='owner',active=true;

delete from public.customers
where business_id='e1a10000-0000-4000-8000-000000000001';

set role authenticated;
select set_config('request.jwt.claim.sub','e1a00000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $setup$
declare
  v_row record;
begin
  select * into v_row
  from public.create_business_customer(
    'e1a10000-0000-4000-8000-000000000001',
    'H19 Bench Original',
    '0555 910 11 22',
    'h19-bench-customer@example.invalid',
    'original'
  );

  if v_row.customer_id is null or v_row.updated_at is null then
    raise exception 'H19 benchmark customers D1xD5 setup did not create authoritative customer';
  end if;

  perform set_config('h19_bench_customers_d1d5.customer_id',v_row.customer_id::text,false);
  perform set_config('h19_bench_customers_d1d5.updated_at',v_row.updated_at::text,false);
end
$setup$;

reset role;

create or replace function pg_temp.h19_bench_customer_result(p_conn text)
returns table(
  ok boolean,
  customer_id uuid,
  customer_name text,
  updated_at timestamptz,
  error_text text
)
language plpgsql
as $collector$
declare
  v_id uuid;
  v_name text;
  v_updated timestamptz;
  v_error text;
begin
  begin
    select t.customer_id,t.name,t.updated_at
    into v_id,v_name,v_updated
    from dblink_get_result(p_conn)
      as t(customer_id uuid,name text,updated_at timestamptz);

    if v_id is null then
      raise exception 'remote customer update returned no row';
    end if;

    ok:=true;
    customer_id:=v_id;
    customer_name:=v_name;
    updated_at:=v_updated;
    error_text:=null;
  exception when others then
    v_error:=sqlerrm;
    ok:=false;
    customer_id:=null;
    customer_name:=null;
    updated_at:=null;
    error_text:=v_error;
  end;

  begin
    perform *
    from dblink_get_result(p_conn,false)
      as t(customer_id uuid,name text,updated_at timestamptz);
  exception when others then
    null;
  end;

  return next;
end
$collector$;

do $probe$
declare
  v_business constant uuid := 'e1a10000-0000-4000-8000-000000000001';
  v_user constant uuid := 'e1a00000-0000-4000-8000-000000000001';
  v_customer uuid := current_setting('h19_bench_customers_d1d5.customer_id')::uuid;
  v_expected timestamptz := current_setting('h19_bench_customers_d1d5.updated_at')::timestamptz;
  v_lock_key bigint := hashtextextended('e1a10000-0000-4000-8000-000000000001',0);
  v_sql_a text;
  v_sql_b text;
  v_a_wait boolean := false;
  v_b_wait boolean := false;
  v_leader text;
  v_other text;
  v_leader_result record;
  v_other_result record;
  v_successes integer := 0;
  v_loser_error text;
  v_winner_name text;
  v_final_name text;
begin
  perform dblink_connect(
    'h19_bench_cust_blocker',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=h19_bench_cust_blocker'
  );
  perform dblink_connect(
    'h19_bench_cust_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=h19_bench_cust_a'
  );
  perform dblink_connect(
    'h19_bench_cust_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=h19_bench_cust_b'
  );

  perform dblink_exec('h19_bench_cust_blocker','set statement_timeout=8000');
  perform dblink_exec('h19_bench_cust_a','set statement_timeout=8000');
  perform dblink_exec('h19_bench_cust_b','set statement_timeout=8000');

  perform dblink_exec('h19_bench_cust_blocker','begin');
  perform dblink_exec(
    'h19_bench_cust_blocker',
    format(
      'do $b$ begin perform pg_advisory_xact_lock(%s); end $b$;',
      v_lock_key
    )
  );

  perform dblink_exec('h19_bench_cust_a','begin');
  perform dblink_exec('h19_bench_cust_b','begin');

  for v_leader in select unnest(array['h19_bench_cust_a','h19_bench_cust_b']) loop
    perform dblink_exec(v_leader,'set local role authenticated');
    perform dblink_exec(
      v_leader,
      'set local "request.jwt.claim.sub" = ''e1a00000-0000-4000-8000-000000000001'''
    );
    perform dblink_exec(
      v_leader,
      'set local "request.jwt.claims" = ''{"amr":[{"method":"password"}]}'''
    );
  end loop;

  v_sql_a:=format(
    $q$
      select customer_id,name,updated_at
      from public.update_business_customer(
        %L::uuid,%L::uuid,%L::timestamptz,
        'H19 Writer A','0555 910 11 22','h19-bench-customer@example.invalid','writer-a'
      )
    $q$,
    v_business,v_customer,v_expected
  );

  v_sql_b:=format(
    $q$
      select customer_id,name,updated_at
      from public.update_business_customer(
        %L::uuid,%L::uuid,%L::timestamptz,
        'H19 Writer B','0555 910 11 22','h19-bench-customer@example.invalid','writer-b'
      )
    $q$,
    v_business,v_customer,v_expected
  );

  if dblink_send_query('h19_bench_cust_a',v_sql_a)<>1 then
    raise exception 'H19 benchmark customers D1xD5 writer A did not start';
  end if;
  if dblink_send_query('h19_bench_cust_b',v_sql_b)<>1 then
    raise exception 'H19 benchmark customers D1xD5 writer B did not start';
  end if;

  for i in 1..250 loop
    perform pg_stat_clear_snapshot();

    select exists(
      select 1 from pg_stat_activity
      where application_name='h19_bench_cust_a'
        and wait_event_type='Lock'
    ) into v_a_wait;

    select exists(
      select 1 from pg_stat_activity
      where application_name='h19_bench_cust_b'
        and wait_event_type='Lock'
    ) into v_b_wait;

    exit when v_a_wait and v_b_wait;
    perform pg_sleep(0.02);
  end loop;

  if not v_a_wait or not v_b_wait then
    raise exception
      'H19 benchmark customers D1xD5 overlap barrier invalid: A %, B %',
      v_a_wait,v_b_wait;
  end if;

  perform dblink_exec('h19_bench_cust_blocker','commit');
  perform dblink_disconnect('h19_bench_cust_blocker');

  v_leader:=null;
  for i in 1..400 loop
    if dblink_is_busy('h19_bench_cust_a')=0 then
      v_leader:='h19_bench_cust_a';
      v_other:='h19_bench_cust_b';
      exit;
    end if;
    if dblink_is_busy('h19_bench_cust_b')=0 then
      v_leader:='h19_bench_cust_b';
      v_other:='h19_bench_cust_a';
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;

  if v_leader is null then
    raise exception 'H19 benchmark customers D1xD5 no writer passed the released barrier';
  end if;

  select * into v_leader_result
  from pg_temp.h19_bench_customer_result(v_leader);

  if v_leader_result.ok then
    v_successes:=v_successes+1;
    v_winner_name:=v_leader_result.customer_name;
    perform dblink_exec(v_leader,'commit');
  else
    perform dblink_exec(v_leader,'rollback');
  end if;

  for i in 1..400 loop
    exit when dblink_is_busy(v_other)=0;
    perform pg_sleep(0.01);
  end loop;

  if dblink_is_busy(v_other)<>0 then
    raise exception 'H19 benchmark customers D1xD5 second writer did not finish';
  end if;

  select * into v_other_result
  from pg_temp.h19_bench_customer_result(v_other);

  if v_other_result.ok then
    v_successes:=v_successes+1;
    if v_winner_name is null then
      v_winner_name:=v_other_result.customer_name;
    end if;
    perform dblink_exec(v_other,'commit');
  else
    v_loser_error:=v_other_result.error_text;
    perform dblink_exec(v_other,'rollback');
  end if;

  select c.name into v_final_name
  from public.customers c
  where c.business_id=v_business and c.id=v_customer;

  if v_successes<>1 then
    raise exception
      'H19 benchmark customers D1xD5 stale version writer committed twice: successes %, final %',
      v_successes,v_final_name;
  end if;

  if v_loser_error is null
     or position('CUSTOMER_VERSION_CONFLICT' in v_loser_error)=0 then
    raise exception
      'H19 benchmark customers D1xD5 loser classification mismatch: %',
      coalesce(v_loser_error,'<none>');
  end if;

  if v_final_name is distinct from v_winner_name then
    raise exception
      'H19 benchmark customers D1xD5 durable row does not match sole winner: final %, winner %',
      v_final_name,v_winner_name;
  end if;

  perform dblink_disconnect('h19_bench_cust_a');
  perform dblink_disconnect('h19_bench_cust_b');

  raise notice
    'H19 benchmark customers D1xD5 PASS: one writer committed and stale writer classified CUSTOMER_VERSION_CONFLICT';
exception when others then
  begin perform dblink_exec('h19_bench_cust_blocker','rollback'); exception when others then null; end;
  begin perform dblink_exec('h19_bench_cust_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('h19_bench_cust_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_bench_cust_blocker'); exception when others then null; end;
  begin perform dblink_disconnect('h19_bench_cust_a'); exception when others then null; end;
  begin perform dblink_disconnect('h19_bench_cust_b'); exception when others then null; end;
  raise;
end
$probe$;
