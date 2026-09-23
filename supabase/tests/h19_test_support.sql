-- H19 test-only support.
-- All helpers live in pg_temp and disappear with the CI database session.

create extension if not exists dblink;

create or replace function pg_temp.h19_connect(
  p_conn text,
  p_begin boolean default true
)
returns void
language plpgsql
as $$
begin
  perform dblink_connect(
    p_conn,
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name='||p_conn
  );
  perform dblink_exec(p_conn,'set statement_timeout=30000');
  if p_begin then
    perform dblink_exec(p_conn,'begin');
  end if;
end
$$;

create or replace function pg_temp.h19_set_subject(
  p_conn text,
  p_user uuid,
  p_local boolean default true
)
returns void
language plpgsql
as $$
declare
  v_prefix text := case when p_local then 'set local ' else 'set ' end;
begin
  perform dblink_exec(
    p_conn,
    v_prefix||'"request.jwt.claim.sub" = '||quote_literal(p_user::text)
  );
end
$$;

create or replace function pg_temp.h19_set_authenticated(
  p_conn text,
  p_user uuid,
  p_local boolean default true
)
returns void
language plpgsql
as $$
declare
  v_prefix text := case when p_local then 'set local ' else 'set ' end;
begin
  perform dblink_exec(p_conn,v_prefix||'role authenticated');
  perform pg_temp.h19_set_subject(p_conn,p_user,p_local);
  perform dblink_exec(
    p_conn,
    v_prefix||'"request.jwt.claims" = '
      ||quote_literal('{"amr":[{"method":"password"}]}')
  );
end
$$;

create or replace function pg_temp.h19_wait_for_activity(
  p_application text,
  p_wait_type text,
  p_wait_event text default null,
  p_attempts integer default 500,
  p_delay_seconds double precision default 0.01
)
returns boolean
language plpgsql
as $$
begin
  for i in 1..p_attempts loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
      from pg_stat_activity a
      where a.application_name=p_application
        and a.wait_event_type=p_wait_type
        and (p_wait_event is null or a.wait_event=p_wait_event)
    ) then
      return true;
    end if;
    perform pg_sleep(p_delay_seconds);
  end loop;
  return false;
end
$$;

create or replace function pg_temp.h19_wait_until_idle(
  p_conn text,
  p_attempts integer default 3000,
  p_delay_seconds double precision default 0.01
)
returns boolean
language plpgsql
as $$
begin
  for i in 1..p_attempts loop
    if dblink_is_busy(p_conn)=0 then
      return true;
    end if;
    perform pg_sleep(p_delay_seconds);
  end loop;
  return dblink_is_busy(p_conn)=0;
end
$$;

create or replace function pg_temp.h19_safe_cleanup(
  p_conn text,
  p_rollback boolean default true
)
returns void
language plpgsql
as $$
begin
  if p_rollback then
    begin
      perform dblink_exec(p_conn,'rollback');
    exception when others then
      null;
    end;
  end if;
  begin
    perform dblink_disconnect(p_conn);
  exception when others then
    null;
  end;
end
$$;


-- Structured result registry for the single H19 Integrity Gate.
-- Scenario files stay focused on behavior; the gate owns registration/reporting.
create temporary table if not exists h19_gate_results (
  scenario_id text primary key,
  domain text not null,
  axis_a text not null check (axis_a ~ '^D[0-5]$'),
  axis_b text not null check (axis_b ~ '^D[0-5] not null check (baseline_ci > 0),
  probe_ci integer not null check (probe_ci > 0),
  clean_ci integer not null check (clean_ci > 0),
  status text not null default 'pending' check (status in ('pending','pass'))
) on commit preserve rows;

truncate table h19_gate_results;

create or replace function pg_temp.h19_expect(
  p_scenario_id text,
  p_domain text,
  p_axis_a text,
  p_axis_b text,
  p_origin text,
  p_baseline_ci integer,
  p_probe_ci integer,
  p_clean_ci integer
)
returns void
language plpgsql
as $$
begin
  if p_scenario_id is null or btrim(p_scenario_id)=''
     or p_domain is null or btrim(p_domain)=''
     or p_axis_a !~ '^D[0-5]$'
     or p_axis_b !~ '^D[0-5]$'
     or p_axis_a=p_axis_b
     or p_origin not in ('prospective','holdout')
     or p_baseline_ci is null or p_baseline_ci<1
     or p_probe_ci is null or p_probe_ci<1
     or p_clean_ci is null or p_clean_ci<1 then
    raise exception 'H19_INVALID_MANIFEST_ENTRY';
  end if;

  insert into pg_temp.h19_gate_results(
    scenario_id,domain,axis_a,axis_b,origin,baseline_ci,probe_ci,clean_ci,status
  ) values (
    p_scenario_id,p_domain,p_axis_a,p_axis_b,p_origin,
    p_baseline_ci,p_probe_ci,p_clean_ci,'pending'
  );
exception when unique_violation then
  raise exception 'H19_DUPLICATE_SCENARIO_ID: %',p_scenario_id;
end
$$;

create or replace function pg_temp.h19_pass(p_scenario_id text)
returns void
language plpgsql
as $$
begin
  update pg_temp.h19_gate_results
  set status='pass'
  where scenario_id=p_scenario_id and status='pending';

  if not found then
    raise exception 'H19_UNKNOWN_OR_DUPLICATE_PASS: %',p_scenario_id;
  end if;
end
$$;

create or replace function pg_temp.h19_assert_complete(p_expected integer)
returns jsonb
language plpgsql
as $$
declare
  v_total integer;
  v_passed integer;
  v_pending text;
  v_summary jsonb;
begin
  select count(*)::integer,
         count(*) filter (where status='pass')::integer
  into v_total,v_passed
  from pg_temp.h19_gate_results;

  select string_agg(scenario_id,', ' order by scenario_id)
  into v_pending
  from pg_temp.h19_gate_results
  where status<>'pass';

  if p_expected is null or p_expected<1 or v_total<>p_expected then
    raise exception
      'H19_MANIFEST_COUNT_MISMATCH expected=% registered=%',
      p_expected,v_total;
  end if;

  if v_passed<>p_expected then
    raise exception
      'H19_INTEGRITY_GATE_INCOMPLETE passed=% expected=% pending=%',
      v_passed,p_expected,coalesce(v_pending,'<none>');
  end if;

  select jsonb_build_object(
    'passed',v_passed,
    'expected',p_expected,
    'scenarios',
      jsonb_agg(
        jsonb_build_object(
          'id',scenario_id,
          'domain',domain,
          'axes',jsonb_build_array(axis_a,axis_b),
          'origin',origin,
          'evidence',jsonb_build_object(
            'baselineCi',baseline_ci,
            'probeCi',probe_ci,
            'cleanCi',clean_ci
          ),
          'status',status
        )
        order by scenario_id
      )
  )
  into v_summary
  from pg_temp.h19_gate_results;

  raise notice 'H19 INTEGRITY GATE SUMMARY: %',v_summary::text;
  return v_summary;
end
$$;
),
  origin text not null check (origin in ('prospective','holdout')),
  baseline_ci integer not null check (baseline_ci > 0),
  probe_ci integer not null check (probe_ci > 0),
  clean_ci integer not null check (clean_ci > 0),
  status text not null default 'pending' check (status in ('pending','pass'))
) on commit preserve rows;

truncate table h19_gate_results;

create or replace function pg_temp.h19_expect(
  p_scenario_id text,
  p_domain text,
  p_axis_a text,
  p_axis_b text,
  p_baseline_ci integer,
  p_probe_ci integer,
  p_clean_ci integer
)
returns void
language plpgsql
as $$
begin
  if p_scenario_id is null or btrim(p_scenario_id)=''
     or p_domain is null or btrim(p_domain)=''
     or p_axis_a !~ '^D[0-5]$'
     or p_axis_b !~ '^D[0-5]$'
     or p_axis_a=p_axis_b
     or p_baseline_ci is null or p_baseline_ci<1
     or p_probe_ci is null or p_probe_ci<1
     or p_clean_ci is null or p_clean_ci<1 then
    raise exception 'H19_INVALID_MANIFEST_ENTRY';
  end if;

  insert into pg_temp.h19_gate_results(
    scenario_id,domain,axis_a,axis_b,baseline_ci,probe_ci,clean_ci,status
  ) values (
    p_scenario_id,p_domain,p_axis_a,p_axis_b,
    p_baseline_ci,p_probe_ci,p_clean_ci,'pending'
  );
exception when unique_violation then
  raise exception 'H19_DUPLICATE_SCENARIO_ID: %',p_scenario_id;
end
$$;

create or replace function pg_temp.h19_pass(p_scenario_id text)
returns void
language plpgsql
as $$
begin
  update pg_temp.h19_gate_results
  set status='pass'
  where scenario_id=p_scenario_id and status='pending';

  if not found then
    raise exception 'H19_UNKNOWN_OR_DUPLICATE_PASS: %',p_scenario_id;
  end if;
end
$$;

create or replace function pg_temp.h19_assert_complete(p_expected integer)
returns jsonb
language plpgsql
as $$
declare
  v_total integer;
  v_passed integer;
  v_pending text;
  v_summary jsonb;
begin
  select count(*)::integer,
         count(*) filter (where status='pass')::integer
  into v_total,v_passed
  from pg_temp.h19_gate_results;

  select string_agg(scenario_id,', ' order by scenario_id)
  into v_pending
  from pg_temp.h19_gate_results
  where status<>'pass';

  if p_expected is null or p_expected<1 or v_total<>p_expected then
    raise exception
      'H19_MANIFEST_COUNT_MISMATCH expected=% registered=%',
      p_expected,v_total;
  end if;

  if v_passed<>p_expected then
    raise exception
      'H19_INTEGRITY_GATE_INCOMPLETE passed=% expected=% pending=%',
      v_passed,p_expected,coalesce(v_pending,'<none>');
  end if;

  select jsonb_build_object(
    'passed',v_passed,
    'expected',p_expected,
    'scenarios',
      jsonb_agg(
        jsonb_build_object(
          'id',scenario_id,
          'domain',domain,
          'axes',jsonb_build_array(axis_a,axis_b),
          'evidence',jsonb_build_object(
            'baselineCi',baseline_ci,
            'probeCi',probe_ci,
            'cleanCi',clean_ci
          ),
          'status',status
        )
        order by scenario_id
      )
  )
  into v_summary
  from pg_temp.h19_gate_results;

  raise notice 'H19 INTEGRITY GATE SUMMARY: %',v_summary::text;
  return v_summary;
end
$$;
