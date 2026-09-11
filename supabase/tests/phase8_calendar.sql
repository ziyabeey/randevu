begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('18000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','calendar-a@example.test','',now(),'{}','{}',now(),now()),
  ('18000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','calendar-b@example.test','',now(),'{}','{}',now(),now())
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('48000000-0000-4000-8000-000000000001','Calendar A','calendar-a','Europe/Istanbul','18000000-0000-4000-8000-000000000001'),
  ('48000000-0000-4000-8000-000000000002','Calendar B','calendar-b','Europe/Istanbul','18000000-0000-4000-8000-000000000002')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('58000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','18000000-0000-4000-8000-000000000001','owner',true),
  ('58000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','18000000-0000-4000-8000-000000000002','owner',true)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency)
values
  ('68000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','Calendar Service A',30,0,0,100000,'TRY'),
  ('68000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','Calendar Service B',30,0,0,100000,'TRY')
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values
  ('78000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','Ayşe'),
  ('78000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000001','Bora'),
  ('78000000-0000-4000-8000-000000000003','48000000-0000-4000-8000-000000000002','Cem')
on conflict(id) do nothing;

insert into public.customers(id,business_id,name,created_by)
values
  ('88000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','Calendar Customer A','18000000-0000-4000-8000-000000000001'),
  ('88000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000002','Calendar Customer B','18000000-0000-4000-8000-000000000002')
on conflict(id) do nothing;

do $$
declare
  v_day date := current_date + 14;
  v_a_early timestamptz := (v_day + time '00:30') at time zone 'Europe/Istanbul';
  v_a_late timestamptz := (v_day + time '23:30') at time zone 'Europe/Istanbul';
  v_next timestamptz := ((v_day + 1) + time '00:15') at time zone 'Europe/Istanbul';
  v_b timestamptz := (v_day + time '12:00') at time zone 'Europe/Istanbul';
begin
  insert into public.appointments(
    id,business_id,customer_id,service_id,staff_id,status,
    starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
    customer_name_snapshot,service_name_snapshot,staff_name_snapshot,
    duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
    price_minor_snapshot,currency_snapshot,created_by,source
  ) values
    ('98000000-0000-4000-8000-000000000001','48000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001','scheduled',v_a_early,v_a_early+interval '30 minutes',v_a_early,v_a_early+interval '30 minutes','Europe/Istanbul','Calendar Customer A','Calendar Service A','Ayşe',30,0,0,100000,'TRY','18000000-0000-4000-8000-000000000001','operator'),
    ('98000000-0000-4000-8000-000000000002','48000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000002','confirmed',v_a_late,v_a_late+interval '30 minutes',v_a_late,v_a_late+interval '30 minutes','Europe/Istanbul','Calendar Customer A','Calendar Service A','Bora',30,0,0,100000,'TRY','18000000-0000-4000-8000-000000000001','operator'),
    ('98000000-0000-4000-8000-000000000003','48000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001','scheduled',v_next,v_next+interval '30 minutes',v_next,v_next+interval '30 minutes','Europe/Istanbul','Calendar Customer A','Calendar Service A','Ayşe',30,0,0,100000,'TRY','18000000-0000-4000-8000-000000000001','operator'),
    ('98000000-0000-4000-8000-000000000004','48000000-0000-4000-8000-000000000002','88000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000003','scheduled',v_b,v_b+interval '30 minutes',v_b,v_b+interval '30 minutes','Europe/Istanbul','Calendar Customer B','Calendar Service B','Cem',30,0,0,100000,'TRY','18000000-0000-4000-8000-000000000002','operator');
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := current_date + 14;
  v_count integer;
  v_staff_count integer;
begin
  select count(*) into v_count
  from public.get_calendar_appointments('48000000-0000-4000-8000-000000000001',v_day,1,null);
  if v_count <> 2 then
    raise exception 'calendar local-day boundary failed: expected 2 rows, saw %', v_count;
  end if;

  select count(*) into v_staff_count
  from public.get_calendar_appointments(
    '48000000-0000-4000-8000-000000000001',v_day,1,'78000000-0000-4000-8000-000000000001'
  );
  if v_staff_count <> 1 then
    raise exception 'calendar staff filter failed: expected 1 row, saw %', v_staff_count;
  end if;

  begin
    perform count(*)
    from public.get_calendar_appointments('48000000-0000-4000-8000-000000000002',v_day,1,null);
    raise exception 'cross-tenant calendar read was allowed';
  exception when others then
    if sqlerrm = 'cross-tenant calendar read was allowed' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;
update public.memberships
set active=false
where business_id='48000000-0000-4000-8000-000000000001'
  and user_id='18000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := current_date + 14;
begin
  begin
    perform count(*)
    from public.get_calendar_appointments('48000000-0000-4000-8000-000000000001',v_day,7,null);
    raise exception 'inactive membership retained calendar access';
  exception when others then
    if sqlerrm = 'inactive membership retained calendar access' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;
rollback;
