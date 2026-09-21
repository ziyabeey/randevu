create extension if not exists dblink;

delete from public.businesses where id='f12c1000-0000-4000-8000-000000000001';
delete from auth.users where id='f12c0000-0000-4000-8000-000000000001';

insert into auth.users(id,email,raw_user_meta_data)
values('f12c0000-0000-4000-8000-000000000001','f12-contact-race@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by)
values(
  'f12c1000-0000-4000-8000-000000000001',
  'F12 Contact Race','f12-contact-race','Europe/Istanbul',
  'f12c0000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values(
  'f12c2000-0000-4000-8000-000000000001',
  'f12c1000-0000-4000-8000-000000000001',
  'f12c0000-0000-4000-8000-000000000001',
  'owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values(
  'f12c3000-0000-4000-8000-000000000001',
  'f12c1000-0000-4000-8000-000000000001',
  'Contact Race Service',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values(
  'f12c4000-0000-4000-8000-000000000001',
  'f12c1000-0000-4000-8000-000000000001',
  'Contact Race Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values(
  'f12c1000-0000-4000-8000-000000000001',
  'f12c4000-0000-4000-8000-000000000001',
  'f12c3000-0000-4000-8000-000000000001',
  true
);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select
  'f12c1000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select
  'f12c1000-0000-4000-8000-000000000001',
  'f12c4000-0000-4000-8000-000000000001',
  extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
  time '09:00',time '18:00',true;

insert into public.business_public_profiles(
  business_id,public_name,public_phone,public_email,show_work_hours
) values(
  'f12c1000-0000-4000-8000-000000000001',
  'F12 Contact Race','+905550001299','contact-race@example.invalid',true
);

insert into public.public_booking_settings(
  business_id,enabled,step_minutes,min_notice_minutes,horizon_days
) values(
  'f12c1000-0000-4000-8000-000000000001',
  false,15,0,30
);

do $$
declare
  v_conn text;
  v_blocked boolean;
  v_error text;
  v_enabled boolean;
  v_phone text;
  v_connstr text :=
    'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres';
begin
  -- Scenario 1: contact removal wins the tenant lock first. Enable must wait,
  -- re-read readiness after the commit, and fail closed.
  perform dblink_connect('f12_contact_a',v_connstr);
  perform dblink_connect('f12_contact_b',v_connstr);
  for v_conn in select unnest(array['f12_contact_a','f12_contact_b']) loop
    perform dblink_exec(v_conn,format('set application_name=%L',v_conn));
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claim.sub"='f12c0000-0000-4000-8000-000000000001'$q$);
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims"='{"amr":[{"method":"password"}]}'$q$);
  end loop;

  perform *
  from dblink(
    'f12_contact_a',
    $remote$
      select count(*)::bigint
      from public.update_business_public_profile(
        'f12c1000-0000-4000-8000-000000000001',
        'F12 Contact Race',null,null,null,null,null,null,null,true,null
      )
    $remote$
  ) as t(n bigint);

  if dblink_send_query(
    'f12_contact_b',
    $remote$
      select (public.update_public_booking_settings(
        'f12c1000-0000-4000-8000-000000000001',true,15,0,30
      )).enabled
    $remote$
  )<>1 then
    raise exception 'could not start concurrent booking enable';
  end if;

  v_blocked:=false;
  for i in 1..300 loop
    perform pg_stat_clear_snapshot();
    if exists(
      select 1 from pg_stat_activity
      where application_name='f12_contact_b' and wait_event_type='Lock'
    ) then
      v_blocked:=true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_blocked then raise exception 'booking enable did not wait on the business-row lock'; end if;

  perform dblink_exec('f12_contact_a','commit');
  v_error:=null;
  begin
    perform * from dblink_get_result('f12_contact_b') as t(enabled boolean);
    raise exception 'booking enable unexpectedly succeeded after contact removal';
  exception when others then
    v_error:=sqlerrm;
  end;
  if position('PUBLIC_BOOKING_NOT_READY' in coalesce(v_error,''))=0 then
    raise exception 'booking enable returned wrong race result: %',v_error;
  end if;
  perform dblink_exec('f12_contact_b','rollback');
  perform dblink_disconnect('f12_contact_a');
  perform dblink_disconnect('f12_contact_b');

  select s.enabled,p.public_phone into v_enabled,v_phone
  from public.public_booking_settings s
  join public.business_public_profiles p on p.business_id=s.business_id
  where s.business_id='f12c1000-0000-4000-8000-000000000001';
  if v_enabled or v_phone is not null then
    raise exception 'contact-first race left an enabled or stale-contact state';
  end if;

  -- Reset for reverse ordering.
  update public.business_public_profiles
  set public_phone='+905550001299',public_email='contact-race@example.invalid'
  where business_id='f12c1000-0000-4000-8000-000000000001';
  update public.public_booking_settings
  set enabled=false
  where business_id='f12c1000-0000-4000-8000-000000000001';

  -- Scenario 2: enable wins first. Contact removal must wait and then fail,
  -- preserving at least one direct support path for the live public booking.
  perform dblink_connect('f12_enable_a',v_connstr);
  perform dblink_connect('f12_enable_b',v_connstr);
  for v_conn in select unnest(array['f12_enable_a','f12_enable_b']) loop
    perform dblink_exec(v_conn,format('set application_name=%L',v_conn));
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claim.sub"='f12c0000-0000-4000-8000-000000000001'$q$);
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims"='{"amr":[{"method":"password"}]}'$q$);
  end loop;

  perform *
  from dblink(
    'f12_enable_a',
    $remote$
      select (public.update_public_booking_settings(
        'f12c1000-0000-4000-8000-000000000001',true,15,0,30
      )).enabled
    $remote$
  ) as t(enabled boolean);

  if dblink_send_query(
    'f12_enable_b',
    $remote$
      select count(*)::bigint
      from public.update_business_public_profile(
        'f12c1000-0000-4000-8000-000000000001',
        'F12 Contact Race',null,null,null,null,null,null,null,true,null
      )
    $remote$
  )<>1 then
    raise exception 'could not start concurrent contact removal';
  end if;

  v_blocked:=false;
  for i in 1..300 loop
    perform pg_stat_clear_snapshot();
    if exists(
      select 1 from pg_stat_activity
      where application_name='f12_enable_b' and wait_event_type='Lock'
    ) then
      v_blocked:=true;
      exit;
    end if;
    perform pg_sleep(0.01);
  end loop;
  if not v_blocked then raise exception 'contact removal did not wait on the business-row lock'; end if;

  perform dblink_exec('f12_enable_a','commit');
  v_error:=null;
  begin
    perform * from dblink_get_result('f12_enable_b') as t(n bigint);
    raise exception 'contact removal unexpectedly succeeded after booking enable';
  exception when others then
    v_error:=sqlerrm;
  end;
  if position('PUBLIC_CONTACT_REQUIRED' in coalesce(v_error,''))=0 then
    raise exception 'contact removal returned wrong race result: %',v_error;
  end if;
  perform dblink_exec('f12_enable_b','rollback');
  perform dblink_disconnect('f12_enable_a');
  perform dblink_disconnect('f12_enable_b');

  select s.enabled,p.public_phone into v_enabled,v_phone
  from public.public_booking_settings s
  join public.business_public_profiles p on p.business_id=s.business_id
  where s.business_id='f12c1000-0000-4000-8000-000000000001';
  if not v_enabled or v_phone is null then
    raise exception 'enable-first race lost the required support contact';
  end if;

exception when others then
  foreach v_conn in array coalesce(dblink_get_connections(),array[]::text[]) loop
    if v_conn like 'f12_%' then
      begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
      begin perform dblink_disconnect(v_conn); exception when others then null; end;
    end if;
  end loop;
  raise;
end
$$;

delete from public.businesses where id='f12c1000-0000-4000-8000-000000000001';
delete from auth.users where id='f12c0000-0000-4000-8000-000000000001';
