create extension if not exists dblink;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('e2a00000-0000-4000-8000-000000000001','h19-bench-d0d5-a@example.invalid','{}'::jsonb),
  ('e2b00000-0000-4000-8000-000000000001','h19-bench-d0d5-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('e2a10000-0000-4000-8000-000000000001','H19 Bench D0D5 A','h19-bench-d0d5-a','Europe/Istanbul','e2a00000-0000-4000-8000-000000000001'),
  ('e2b10000-0000-4000-8000-000000000001','H19 Bench D0D5 B','h19-bench-d0d5-b','Europe/Istanbul','e2b00000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('e2a20000-0000-4000-8000-000000000001','e2a10000-0000-4000-8000-000000000001','e2a00000-0000-4000-8000-000000000001','owner',true),
  ('e2b20000-0000-4000-8000-000000000001','e2b10000-0000-4000-8000-000000000001','e2b00000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role='owner',active=true;

delete from public.customers
where business_id in (
  'e2a10000-0000-4000-8000-000000000001',
  'e2b10000-0000-4000-8000-000000000001'
);

insert into public.customers(
  id,business_id,name,phone,email,notes,created_by
)
values
  (
    'e2a30000-0000-4000-8000-000000000001',
    'e2a10000-0000-4000-8000-000000000001',
    'Tenant A Original','0555 920 10 01','h19-d0d5-a@example.invalid','original-a',
    'e2a00000-0000-4000-8000-000000000001'
  ),
  (
    'e2b30000-0000-4000-8000-000000000001',
    'e2b10000-0000-4000-8000-000000000001',
    'Tenant B Original','0555 920 10 02','h19-d0d5-b@example.invalid','original-b',
    'e2b00000-0000-4000-8000-000000000001'
  );

do $probe$
declare
  v_a_expected timestamptz;
  v_b_expected timestamptz;
  v_a_name text;
  v_b_name text;
  v_a_final text;
  v_b_final text;
  v_b_done boolean := false;
  v_b_blocked boolean := false;
  v_a_idle boolean := false;
  v_b_sql text;
begin
  select updated_at into v_a_expected
  from public.customers
  where business_id='e2a10000-0000-4000-8000-000000000001'
    and id='e2a30000-0000-4000-8000-000000000001';

  select updated_at into v_b_expected
  from public.customers
  where business_id='e2b10000-0000-4000-8000-000000000001'
    and id='e2b30000-0000-4000-8000-000000000001';

  perform dblink_connect(
    'h19_bench_d0d5_a',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=h19_bench_d0d5_a'
  );
  perform dblink_connect(
    'h19_bench_d0d5_b',
    'host=127.0.0.1 port=5432 dbname=yzt_test user=postgres password=postgres application_name=h19_bench_d0d5_b'
  );

  perform dblink_exec('h19_bench_d0d5_a','set statement_timeout=8000');
  perform dblink_exec('h19_bench_d0d5_b','set statement_timeout=8000');
  perform dblink_exec('h19_bench_d0d5_a','begin');
  perform dblink_exec('h19_bench_d0d5_b','begin');

  perform dblink_exec('h19_bench_d0d5_a','set local role authenticated');
  perform dblink_exec('h19_bench_d0d5_a',$q$set local "request.jwt.claim.sub"='e2a00000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('h19_bench_d0d5_a',$q$set local "request.jwt.claims"='{"amr":[{"method":"password"}]}'$q$);

  perform dblink_exec('h19_bench_d0d5_b','set local role authenticated');
  perform dblink_exec('h19_bench_d0d5_b',$q$set local "request.jwt.claim.sub"='e2b00000-0000-4000-8000-000000000001'$q$);
  perform dblink_exec('h19_bench_d0d5_b',$q$set local "request.jwt.claims"='{"amr":[{"method":"password"}]}'$q$);

  select t.name into v_a_name
  from dblink(
    'h19_bench_d0d5_a',
    format(
      $sql$
        select name
        from public.update_business_customer(
          'e2a10000-0000-4000-8000-000000000001',
          'e2a30000-0000-4000-8000-000000000001',
          %L::timestamptz,
          'Tenant A Updated','0555 920 10 01','h19-d0d5-a@example.invalid','updated-a'
        )
      $sql$,
      v_a_expected
    )
  ) as t(name text);

  if v_a_name<>'Tenant A Updated' then
    raise exception 'H19 benchmark baseline customers D0xD5 tenant A update did not succeed';
  end if;

  perform pg_stat_clear_snapshot();
  select exists(
    select 1 from pg_stat_activity
    where application_name='h19_bench_d0d5_a'
      and state='idle in transaction'
  ) into v_a_idle;

  if not v_a_idle then
    raise exception 'H19 benchmark baseline customers D0xD5 harness invalid: tenant A transaction not retained';
  end if;

  v_b_sql:=format(
    $sql$
      select name
      from public.update_business_customer(
        'e2b10000-0000-4000-8000-000000000001',
        'e2b30000-0000-4000-8000-000000000001',
        %L::timestamptz,
        'Tenant B Updated','0555 920 10 02','h19-d0d5-b@example.invalid','updated-b'
      )
    $sql$,
    v_b_expected
  );

  if dblink_send_query('h19_bench_d0d5_b',v_b_sql)<>1 then
    raise exception 'H19 benchmark baseline customers D0xD5 tenant B update did not start';
  end if;

  for i in 1..250 loop
    if dblink_is_busy('h19_bench_d0d5_b')=0 then
      v_b_done:=true;
      exit;
    end if;

    perform pg_stat_clear_snapshot();
    if exists(
      select 1 from pg_stat_activity
      where application_name='h19_bench_d0d5_b'
        and wait_event_type='Lock'
    ) then
      v_b_blocked:=true;
      exit;
    end if;

    perform pg_sleep(0.02);
  end loop;

  if v_b_blocked then
    raise exception 'H19 benchmark baseline customers D0xD5 foreign tenant update blocked on shared serialization lock';
  end if;

  if not v_b_done then
    raise exception 'H19 benchmark baseline customers D0xD5 harness invalid: tenant B did not finish while tenant A remained open';
  end if;

  select t.name into v_b_name
  from dblink_get_result('h19_bench_d0d5_b') as t(name text);
  perform * from dblink_get_result('h19_bench_d0d5_b',false) as t(name text);

  if v_b_name<>'Tenant B Updated' then
    raise exception 'H19 benchmark baseline customers D0xD5 tenant B returned unexpected result: %',v_b_name;
  end if;

  perform dblink_exec('h19_bench_d0d5_b','commit');
  perform dblink_exec('h19_bench_d0d5_a','commit');

  select name into v_a_final
  from public.customers
  where business_id='e2a10000-0000-4000-8000-000000000001'
    and id='e2a30000-0000-4000-8000-000000000001';

  select name into v_b_final
  from public.customers
  where business_id='e2b10000-0000-4000-8000-000000000001'
    and id='e2b30000-0000-4000-8000-000000000001';

  if v_a_final<>'Tenant A Updated' or v_b_final<>'Tenant B Updated' then
    raise exception
      'H19 benchmark baseline customers D0xD5 durable tenant isolation mismatch: A %, B %',
      v_a_final,v_b_final;
  end if;

  perform dblink_disconnect('h19_bench_d0d5_a');
  perform dblink_disconnect('h19_bench_d0d5_b');

  raise notice 'H19 benchmark baseline customers D0xD5 PASS: tenant B remained independent while tenant A transaction stayed open';
exception when others then
  begin perform dblink_exec('h19_bench_d0d5_a','rollback'); exception when others then null; end;
  begin perform dblink_exec('h19_bench_d0d5_b','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('h19_bench_d0d5_a'); exception when others then null; end;
  begin perform dblink_disconnect('h19_bench_d0d5_b'); exception when others then null; end;
  raise;
end
$probe$;
