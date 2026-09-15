begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('d1100000-0000-4000-8000-000000000001','f11-owner@example.invalid','{}'::jsonb),
  ('d1100000-0000-4000-8000-000000000002','f11-inactive@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('d1110000-0000-4000-8000-000000000001','F11 Contract A','f11-contract-a','Europe/Istanbul','d1100000-0000-4000-8000-000000000001'),
  ('d1110000-0000-4000-8000-000000000002','F11 Contract B','f11-contract-b','Europe/Istanbul','d1100000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('d1120000-0000-4000-8000-000000000001','d1110000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000001','owner',true),
  ('d1120000-0000-4000-8000-000000000002','d1110000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002','staff',false),
  ('d1120000-0000-4000-8000-000000000003','d1110000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000001','owner',true)
on conflict(business_id,user_id) do update set role=excluded.role,active=excluded.active;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('d1130000-0000-4000-8000-000000000001','d1110000-0000-4000-8000-000000000001','F11 Fixed',30,0,0,'Genel',10,10000,'fixed',10000,10000,'TRY',true),
  ('d1130000-0000-4000-8000-000000000002','d1110000-0000-4000-8000-000000000001','F11 Range',30,0,0,'Renk',20,12000,'range',12000,18000,'TRY',true),
  ('d1130000-0000-4000-8000-000000000003','d1110000-0000-4000-8000-000000000002','Tenant B',30,0,0,'Genel',10,9000,'fixed',9000,9000,'TRY',true)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values
  ('d1140000-0000-4000-8000-000000000001','d1110000-0000-4000-8000-000000000001','F11 Staff A',true),
  ('d1140000-0000-4000-8000-000000000002','d1110000-0000-4000-8000-000000000001','F11 Staff B',true),
  ('d1140000-0000-4000-8000-000000000003','d1110000-0000-4000-8000-000000000002','Tenant B Staff',true)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('d1110000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000001',true),
  ('d1110000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000002',true),
  ('d1110000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000002','d1130000-0000-4000-8000-000000000001',true),
  ('d1110000-0000-4000-8000-000000000002','d1140000-0000-4000-8000-000000000003','d1130000-0000-4000-8000-000000000003',true)
on conflict(business_id,staff_id,service_id) do update set active=true;

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'd1110000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,'09:00','18:00',true;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'd1110000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000001',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,'09:00','18:00',true
union all
select 'd1110000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000002',extract(dow from (date_trunc('week',current_date)::date+7))::smallint,'09:00','18:00',true;

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('d1150000-0000-4000-8000-000000000001','d1110000-0000-4000-8000-000000000001','Range Customer','05550000111','range@example.invalid','d1100000-0000-4000-8000-000000000001'),
  ('d1150000-0000-4000-8000-000000000002','d1110000-0000-4000-8000-000000000002','Tenant B Customer','05550000222','b@example.invalid','d1100000-0000-4000-8000-000000000001')
on conflict(id) do nothing;

-- Object ACL and RLS/FORCE are separate gates. Raw group rows stay closed; the
-- bounded operator projection is the only new authenticated read surface.
do $$
declare v_rls boolean; v_force boolean;
begin
  if has_table_privilege('anon','public.appointment_groups','SELECT')
     or has_table_privilege('authenticated','public.appointment_groups','SELECT') then
    raise exception 'appointment_groups raw SELECT leaked to API roles';
  end if;
  if has_table_privilege('anon','public.appointment_groups','INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.appointment_groups','INSERT,UPDATE,DELETE') then
    raise exception 'appointment_groups raw mutation leaked to API roles';
  end if;
  if not has_function_privilege('authenticated','public.get_booking_group_contract(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_booking_group_contract(uuid,uuid)','EXECUTE') then
    raise exception 'group contract RPC ACL mismatch';
  end if;
  if has_function_privilege('authenticated','public.f11_prepare_appointment_line()','EXECUTE')
     or has_function_privilege('authenticated','public.f11_capability_group_bridge()','EXECUTE')
     or has_function_privilege('anon','public.f11_recovery_group_bridge()','EXECUTE') then
    raise exception 'internal F11 trigger helper leaked EXECUTE';
  end if;
  select c.relrowsecurity,c.relforcerowsecurity into v_rls,v_force
  from pg_class c where c.oid='public.appointment_groups'::regclass;
  if not v_rls or not v_force then raise exception 'appointment_groups RLS/FORCE missing'; end if;
end
$$;

-- Legacy single-service operator create keeps its old request shape and receives
-- a deterministic one-line group with fixed canonical price snapshots.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v public.appointments;
  v_group public.appointment_groups;
  v_contract record;
begin
  select * into v
  from public.create_appointment(
    'd1110000-0000-4000-8000-000000000001',
    'f11-fixed-create-0001','Legacy Fixed Customer',
    'd1130000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000001',
    (v_day+time '10:00') at time zone 'Europe/Istanbul',
    '05551234567','legacy-fixed@example.invalid',null
  );
  if v.id is null or v.group_id <> v.id or v.line_ordinal <> 1
     or v.price_type_snapshot <> 'fixed'
     or v.price_min_minor_snapshot <> 10000 or v.price_max_minor_snapshot <> 10000
     or v.price_policy_version_snapshot <> 1 then
    raise exception 'legacy create did not map to deterministic one-line group';
  end if;
  select * into strict v_group from public.appointment_groups where id=v.id;
  if v_group.legacy_appointment_id <> v.id or v_group.version <> 1
     or v_group.status <> 'scheduled' or v_group.customer_id <> v.customer_id then
    raise exception 'legacy group header mismatch';
  end if;
  if (select group_id from public.booking_commands where business_id=v.business_id and idempotency_key='f11-fixed-create-0001') <> v.id then
    raise exception 'booking command did not bridge to group';
  end if;
  select * into strict v_contract from public.get_booking_group_contract(v.business_id,v.id);
  if jsonb_array_length(v_contract.lines) <> 1
     or (v_contract.lines->0->>'lineId')::uuid <> v.id
     or (v_contract.lines->0->>'ordinal')::integer <> 1 then
    raise exception 'group contract projection lost legacy line identity';
  end if;
end
$$;
reset role;

-- Old range create remains fail-closed. Supplying no canonical F11 line snapshot
-- cannot turn a range lower bound into a definitive legacy appointment price.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_day date:=date_trunc('week',current_date)::date+7;
begin
  begin
    perform public.create_appointment(
      'd1110000-0000-4000-8000-000000000001',
      'f11-range-legacy-001','Legacy Range Customer',
      'd1130000-0000-4000-8000-000000000002','d1140000-0000-4000-8000-000000000001',
      (v_day+time '11:00') at time zone 'Europe/Istanbul',
      '05557654321','legacy-range@example.invalid',null
    );
    raise exception 'legacy range create unexpectedly succeeded';
  exception when others then
    if sqlerrm='legacy range create unexpectedly succeeded' then raise; end if;
    if position('SERVICE_PRICE_NOT_FINAL' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

-- A current catalog price edit must never re-price or block a historical line.
update public.services set price_minor=15000
where id='d1130000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','d1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_id uuid; v_group public.appointment_groups; v public.appointments;
begin
  select appointment_id into strict v_id from public.booking_commands
  where business_id='d1110000-0000-4000-8000-000000000001'
    and idempotency_key='f11-fixed-create-0001';
  select * into v from public.set_appointment_status(
    'd1110000-0000-4000-8000-000000000001',v_id,
    'f11-fixed-confirm-01','confirmed',null
  );
  if v.price_minor_snapshot <> 10000 or v.price_min_minor_snapshot <> 10000
     or v.price_max_minor_snapshot <> 10000 or v.price_policy_version_snapshot <> 1 then
    raise exception 'status update rewrote historical price snapshot';
  end if;
  select * into strict v_group from public.appointment_groups where id=v_id;
  if v_group.status <> 'confirmed' or v_group.version <> 2 then
    raise exception 'legacy status did not synchronize group version/status';
  end if;
  if not exists (
    select 1 from public.appointment_events e
    where e.group_id=v_id and e.group_version=2 and e.event_type='confirmed'
  ) then raise exception 'appointment event did not capture group version'; end if;
  if (select group_id from public.booking_commands where idempotency_key='f11-fixed-confirm-01') <> v_id then
    raise exception 'status command did not bridge group identity';
  end if;
end
$$;
reset role;

do $$
declare v_id uuid;
begin
  select appointment_id into strict v_id from public.booking_commands
  where business_id='d1110000-0000-4000-8000-000000000001'
    and idempotency_key='f11-fixed-create-0001';
  begin
    update public.appointments set price_minor_snapshot=9999 where id=v_id;
    raise exception 'frozen price snapshot unexpectedly mutated';
  exception when others then
    if sqlerrm='frozen price snapshot unexpectedly mutated' then raise; end if;
    if position('APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Explicit canonical range snapshots are valid in the F11 line model. Two lines
-- may touch at [start,end) but overlapping customer service intervals are blocked.
insert into public.appointment_groups(
  id,business_id,customer_id,status,source,version,created_by
) values (
  'd1160000-0000-4000-8000-000000000001','d1110000-0000-4000-8000-000000000001',
  'd1150000-0000-4000-8000-000000000001','scheduled','operator',1,
  'd1100000-0000-4000-8000-000000000001'
);

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
  buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values (
  'd1170000-0000-4000-8000-000000000001','d1110000-0000-4000-8000-000000000001',
  'd1160000-0000-4000-8000-000000000001',1,
  'd1150000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000002','d1140000-0000-4000-8000-000000000001','scheduled',
  '2026-12-01T12:00:00+03','2026-12-01T12:30:00+03','2026-12-01T12:00:00+03','2026-12-01T12:30:00+03','Europe/Istanbul',
  'Range Customer','05550000111','range@example.invalid','F11 Range','F11 Staff A',30,0,0,
  12000,'range',12000,18000,1,'TRY','d1100000-0000-4000-8000-000000000001','operator'
);

do $$
begin
  begin
    insert into public.appointments(
      id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,staff_name_snapshot,
      duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
      price_policy_version_snapshot,currency_snapshot,created_by,source
    ) values (
      'd1170000-0000-4000-8000-000000000002','d1110000-0000-4000-8000-000000000001',
      'd1160000-0000-4000-8000-000000000001',2,
      'd1150000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000002','scheduled',
      '2026-12-01T12:15:00+03','2026-12-01T12:45:00+03','2026-12-01T12:15:00+03','2026-12-01T12:45:00+03','Europe/Istanbul',
      'Range Customer','05550000111','F11 Fixed','F11 Staff B',30,0,0,
      15000,'fixed',15000,15000,2,'TRY','d1100000-0000-4000-8000-000000000001','operator'
    );
    raise exception 'overlapping group service unexpectedly accepted';
  exception when exclusion_violation then null;
  end;
end
$$;

insert into public.appointments(
  id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
  starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
  customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,staff_name_snapshot,
  duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
  price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
  price_policy_version_snapshot,currency_snapshot,created_by,source
) values (
  'd1170000-0000-4000-8000-000000000003','d1110000-0000-4000-8000-000000000001',
  'd1160000-0000-4000-8000-000000000001',2,
  'd1150000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000002','scheduled',
  '2026-12-01T12:30:00+03','2026-12-01T13:00:00+03','2026-12-01T12:30:00+03','2026-12-01T13:00:00+03','Europe/Istanbul',
  'Range Customer','05550000111','F11 Fixed','F11 Staff B',30,0,0,
  15000,'fixed',15000,15000,2,'TRY','d1100000-0000-4000-8000-000000000001','operator'
);

do $$
declare v_lines jsonb;
begin
  select lines into strict v_lines
  from public.get_booking_group_contract(
    'd1110000-0000-4000-8000-000000000001','d1160000-0000-4000-8000-000000000001'
  );
  if jsonb_array_length(v_lines) <> 2
     or (v_lines->0->>'priceType') <> 'range'
     or (v_lines->1->>'ordinal')::integer <> 2 then
    raise exception 'multi-line contract projection mismatch';
  end if;
end
$$;

-- Cross-tenant group IDs and ordinal overflow fail before they can create a line.
insert into public.appointment_groups(id,business_id,customer_id,status,source,version,created_by)
values (
  'd1160000-0000-4000-8000-000000000002','d1110000-0000-4000-8000-000000000002',
  'd1150000-0000-4000-8000-000000000002','scheduled','operator',1,'d1100000-0000-4000-8000-000000000001'
);

do $$
begin
  begin
    insert into public.appointments(
      id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
      price_policy_version_snapshot,currency_snapshot,created_by,source
    ) values (
      'd1170000-0000-4000-8000-000000000004','d1110000-0000-4000-8000-000000000001',
      'd1160000-0000-4000-8000-000000000002',3,
      'd1150000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000002','scheduled',
      '2026-12-01T14:00:00+03','2026-12-01T14:30:00+03','2026-12-01T14:00:00+03','2026-12-01T14:30:00+03','Europe/Istanbul',
      'Range Customer','F11 Fixed','F11 Staff B',30,0,0,15000,'fixed',15000,15000,2,'TRY',
      'd1100000-0000-4000-8000-000000000001','operator'
    );
    raise exception 'cross-tenant group unexpectedly accepted';
  exception when others then
    if sqlerrm='cross-tenant group unexpectedly accepted' then raise; end if;
    if position('BOOKING_GROUP_CONTRACT_MISMATCH' in sqlerrm)=0 then raise; end if;
  end;

  begin
    insert into public.appointments(
      id,business_id,group_id,line_ordinal,customer_id,service_id,staff_id,status,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,service_name_snapshot,staff_name_snapshot,duration_minutes_snapshot,
      buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      price_minor_snapshot,price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,
      price_policy_version_snapshot,currency_snapshot,created_by,source
    ) values (
      'd1170000-0000-4000-8000-000000000005','d1110000-0000-4000-8000-000000000001',
      'd1160000-0000-4000-8000-000000000001',11,
      'd1150000-0000-4000-8000-000000000001','d1130000-0000-4000-8000-000000000001','d1140000-0000-4000-8000-000000000002','scheduled',
      '2026-12-01T14:00:00+03','2026-12-01T14:30:00+03','2026-12-01T14:00:00+03','2026-12-01T14:30:00+03','Europe/Istanbul',
      'Range Customer','F11 Fixed','F11 Staff B',30,0,0,15000,'fixed',15000,15000,2,'TRY',
      'd1100000-0000-4000-8000-000000000001','operator'
    );
    raise exception 'line ordinal >10 unexpectedly accepted';
  exception when check_violation then null;
  end;
end
$$;

-- Legacy capability insert still names only appointment_id; the preserved pkey
-- name now arbitrates group_id after the BEFORE INSERT bridge.
do $$
declare v_id uuid; v_group uuid;
begin
  select appointment_id into strict v_id from public.booking_commands
  where idempotency_key='f11-fixed-create-0001';
  select group_id into strict v_group from public.appointments where id=v_id;
  insert into public.appointment_management_capabilities(appointment_id,business_id,token_hash)
  values(v_id,'d1110000-0000-4000-8000-000000000001',repeat('a',64));
  if (select group_id from public.appointment_management_capabilities where appointment_id=v_id) <> v_group then
    raise exception 'capability did not bridge to group';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.appointment_management_capabilities'::regclass
      and c.conname='appointment_management_capabilities_pkey'
      and pg_get_constraintdef(c.oid) like 'PRIMARY KEY (group_id)%'
  ) then raise exception 'management pkey is not group-rooted'; end if;
end
$$;

-- Recovery and notification evidence get additive group bridges without changing
-- existing IDs/provider evidence fields.
do $$
declare v_id uuid; v_group uuid; v_recovery uuid:='d1180000-0000-4000-8000-000000000001';
begin
  select appointment_id into strict v_id from public.booking_commands
  where idempotency_key='f11-fixed-create-0001';
  select group_id into strict v_group from public.appointments where id=v_id;

  insert into public.public_booking_recoveries(
    recovery_id,business_id,idempotency_key,appointment_id,
    management_token_hash,recovery_secret_hash,management_token_ciphertext,
    management_token_iv,key_version,expires_at
  ) values (
    v_recovery,'d1110000-0000-4000-8000-000000000001','f11-recovery-0001',v_id,
    repeat('b',64),repeat('c',64),repeat('d',32),repeat('e',16),1,now()+interval '1 day'
  );
  if (select group_id from public.public_booking_recoveries where recovery_id=v_recovery) <> v_group then
    raise exception 'recovery did not bridge to group';
  end if;

  insert into public.appointment_notification_jobs(
    business_id,appointment_id,recovery_id,kind,channel,recipient,provider,
    retry_until,provider_idempotency_key,event_version,event_reason,
    business_name_snapshot,customer_name_snapshot,starts_at_snapshot,timezone_snapshot,
    service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot
  )
  select
    a.business_id,a.id,v_recovery,'public_booking_confirmation','email','f11@example.invalid','resend',
    now()+interval '1 day','f11-provider-key-0001',1,'created',
    'F11 Contract A',a.customer_name_snapshot,a.starts_at,a.timezone,
    a.service_name_snapshot,a.staff_name_snapshot,a.price_minor_snapshot,a.currency_snapshot
  from public.appointments a where a.id=v_id;

  if not exists (
    select 1 from public.appointment_notification_jobs j
    where j.provider_idempotency_key='f11-provider-key-0001'
      and j.group_id=v_group and j.group_version=2
  ) then raise exception 'notification job did not bridge current group version'; end if;
end
$$;

-- Active standard session can read its group; recovery AMR and inactive membership
-- cannot turn the new RPC into normal tenant authority.
set local role authenticated;
select set_config('request.jwt.claim.sub','d1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $$
declare v_group uuid;
begin
  select appointment_id into strict v_group from public.booking_commands where idempotency_key='f11-fixed-create-0001';
  begin
    perform * from public.get_booking_group_contract('d1110000-0000-4000-8000-000000000001',v_group);
    raise exception 'recovery unexpectedly read group contract';
  exception when others then
    if sqlerrm='recovery unexpectedly read group contract' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1100000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare v_group uuid;
begin
  select appointment_id into strict v_group from public.booking_commands where idempotency_key='f11-fixed-create-0001';
  begin
    perform * from public.get_booking_group_contract('d1110000-0000-4000-8000-000000000001',v_group);
    raise exception 'inactive member unexpectedly read group contract';
  exception when others then
    if sqlerrm='inactive member unexpectedly read group contract' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm)=0 then raise; end if;
  end;
end
$$;
reset role;

-- Constraint metadata is part of the forward contract.
do $$
declare v_def boolean; v_deferred boolean;
begin
  select condeferrable,condeferred into v_def,v_deferred
  from pg_constraint
  where conrelid='public.appointments'::regclass and conname='appointments_staff_no_overlap';
  if not v_def or v_deferred then raise exception 'staff exclusion deferrability mismatch'; end if;
  select condeferrable,condeferred into v_def,v_deferred
  from pg_constraint
  where conrelid='public.appointments'::regclass and conname='appointments_group_service_no_overlap';
  if not v_def or v_deferred then raise exception 'group service exclusion deferrability mismatch'; end if;
end
$$;

raise notice 'F11-01 group/line clean contract accepted';
rollback;
