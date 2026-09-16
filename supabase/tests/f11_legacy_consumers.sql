begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('d1300000-0000-4000-8000-000000000001','f11-legacy-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'd1310000-0000-4000-8000-000000000001','F11 Legacy Consumers','f11-legacy-consumers','Europe/Istanbul',
  'd1300000-0000-4000-8000-000000000001'
) on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'd1320000-0000-4000-8000-000000000001','d1310000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001','owner',true
) on conflict(business_id,user_id) do update set role='owner',active=true;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'd1330000-0000-4000-8000-000000000001','d1310000-0000-4000-8000-000000000001',
  'Legacy Kesim',45,5,10,'Saç',10,27500,'fixed',27500,27500,'TRY',true
) on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values (
  'd1340000-0000-4000-8000-000000000001','d1310000-0000-4000-8000-000000000001','Legacy Personel',true
) on conflict(id) do nothing;
insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'd1310000-0000-4000-8000-000000000001','d1340000-0000-4000-8000-000000000001',
  'd1330000-0000-4000-8000-000000000001',true
) on conflict(business_id,staff_id,service_id) do update set active=true;

-- Schedule rows are fixture setup. F10-04/S08 deliberately revoked the old
-- replace_*_hours RPCs from browser roles, so this test must not resurrect that
-- retired mutation surface merely to prepare availability.
insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'd1350000-0000-4000-8000-000000000001','d1310000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '18:00',true
) on conflict(id) do update
set weekday=excluded.weekday,starts_local=excluded.starts_local,ends_local=excluded.ends_local,active=true;

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'd1360000-0000-4000-8000-000000000001','d1310000-0000-4000-8000-000000000001',
  'd1340000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '18:00',true
) on conflict(id) do update
set weekday=excluded.weekday,starts_local=excluded.starts_local,ends_local=excluded.ends_local,active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v public.appointments;
  v_list_id uuid;
  v_calendar_id uuid;
  v_history_id uuid;
  v_event_count integer;
begin
  select * into v
  from public.create_appointment(
    'd1310000-0000-4000-8000-000000000001','f11-legacy-consumer-create-001',
    'Legacy Tüketici Müşteri','d1330000-0000-4000-8000-000000000001',
    'd1340000-0000-4000-8000-000000000001',
    (v_day+time '13:00') at time zone 'Europe/Istanbul',
    '+90 555 130 00 01','legacy-consumer@example.invalid','legacy consumer note'
  );
  if v.id is null or v.group_id<>v.id then raise exception 'legacy consumer fixture create failed'; end if;

  select p.id into strict v_list_id
  from public.list_appointments_page(
    'd1310000-0000-4000-8000-000000000001',26,null,null
  ) p
  where p.id=v.id;
  if v_list_id<>v.id then raise exception 'legacy booking list lost appointment identity'; end if;

  select c.appointment_id into strict v_calendar_id
  from public.get_calendar_appointments(
    'd1310000-0000-4000-8000-000000000001',v_day,1,null
  ) c
  where c.appointment_id=v.id;
  if v_calendar_id<>v.id then raise exception 'legacy calendar lost appointment identity'; end if;

  select h.appointment_id into strict v_history_id
  from public.list_business_customer_appointments_page(
    'd1310000-0000-4000-8000-000000000001',v.customer_id,26,null,null
  ) h
  where h.appointment_id=v.id;
  if v_history_id<>v.id then raise exception 'legacy customer history lost appointment identity'; end if;

  select count(*) into v_event_count
  from public.list_appointment_events_page(
    'd1310000-0000-4000-8000-000000000001',v.id,26,null,null
  );
  if v_event_count<>1 then raise exception 'legacy audit consumer expected one create event, got %',v_event_count; end if;
end
$$;

reset role;

-- Capability rows and the hash helper are intentionally not browser-granted.
-- Provision this legacy compatibility fixture as the privileged test owner, then
-- exercise the old bearer-token resolver below. This keeps the S08/F17 ACL
-- boundary intact while still proving the F11 appointment -> group bridge.
do $$
declare
  v_id uuid;
  v_group uuid;
  v_token text:=repeat('M',43);
begin
  select appointment_id into strict v_id
  from public.booking_commands
  where business_id='d1310000-0000-4000-8000-000000000001'
    and idempotency_key='f11-legacy-consumer-create-001';

  select group_id into strict v_group
  from public.appointments
  where business_id='d1310000-0000-4000-8000-000000000001'
    and id=v_id;

  insert into public.appointment_management_capabilities(
    appointment_id,business_id,token_hash
  ) values (
    v_id,'d1310000-0000-4000-8000-000000000001',public.management_token_hash(v_token)
  );

  if (select group_id from public.appointment_management_capabilities where appointment_id=v_id)<>v_group then
    raise exception 'legacy management capability did not bridge group root';
  end if;
end
$$;

-- The old capability resolver still returns the historical single-appointment
-- DTO for a legacy one-line group and therefore old /m#token links remain valid.
do $$
declare
  v_token text:=repeat('M',43);
  v_id uuid;
  v_group uuid;
  v_managed record;
begin
  select c.appointment_id,c.group_id into strict v_id,v_group
  from public.appointment_management_capabilities c
  where c.token_hash=public.management_token_hash(v_token);

  select * into strict v_managed
  from public.get_public_managed_appointment(v_token);

  if v_managed.appointment_id<>v_id
     or v_group<>v_id
     or v_managed.service_name<>'Legacy Kesim'
     or v_managed.staff_name<>'Legacy Personel'
     or v_managed.price_minor<>27500
     or v_managed.currency<>'TRY' then
    raise exception 'legacy management DTO changed after group migration';
  end if;
end
$$;

-- Group-aware reads are additive. They describe the same legacy booking without
-- forcing old list/calendar/history/manage consumers to understand lines[] yet.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_group uuid; v_contract record;
begin
  select appointment_id into strict v_group
  from public.booking_commands
  where business_id='d1310000-0000-4000-8000-000000000001'
    and idempotency_key='f11-legacy-consumer-create-001';

  select * into strict v_contract
  from public.get_booking_group_contract('d1310000-0000-4000-8000-000000000001',v_group);
  if v_contract.legacy_appointment_id<>v_group
     or jsonb_array_length(v_contract.lines)<>1
     or (v_contract.lines->0->>'lineId')::uuid<>v_group
     or v_contract.lines->0->>'serviceName'<>'Legacy Kesim' then
    raise exception 'additive group projection diverged from legacy consumers';
  end if;
end
$$;
reset role;

do $$
begin
  raise notice 'F11-01 legacy booking consumers accepted';
end
$$;
rollback;
