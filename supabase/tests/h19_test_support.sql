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
