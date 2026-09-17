begin;

-- F11-03 public capability negatives. The authenticated operator surface is
-- covered by f11_group_management.sql; this file drives the ONLY authority an
-- anonymous caller has -- execute_public_operation -- and proves that the group
-- management actions behind it deny, stay silent about data, and speak a
-- vocabulary the /m#token client can actually act on.

create function pg_temp.f1104_assert(p_ok boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F11-03 public: %',p_message;
  end if;
end
$$;

grant execute on function pg_temp.f1104_assert(boolean,text) to anon;

-- Public create keys are the v2 intent proof, not free text: the deadline and
-- the HMAC over (recovery id, deadline, secret hash) are both re-derived by the
-- create RPC, so the fixture has to mint them the way the Worker does.
create function pg_temp.f1104_public_key(
  p_recovery_id uuid,
  p_deadline bigint,
  p_secret_hash text
)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_secret_hash,'UTF8'),'sha256'),'hex');
$$;

insert into auth.users(id,email,raw_user_meta_data)
values ('fd100000-0000-4000-8000-000000000001','f1104-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'fd110000-0000-4000-8000-000000000001','F11-04 Public Salon','f1104-public-salon',
  'Europe/Istanbul','fd100000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'fd120000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001',
  'fd100000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('fd130000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','Renk',60,0,0,'Genel',10,20000,'fixed',20000,20000,'TRY',true),
  ('fd130000-0000-4000-8000-000000000002','fd110000-0000-4000-8000-000000000001','Kesim',30,0,0,'Genel',20,12000,'fixed',12000,12000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values ('fd140000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','F11-04 Uzmanı',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('fd110000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000001','fd130000-0000-4000-8000-000000000001',true),
  ('fd110000-0000-4000-8000-000000000001','fd140000-0000-4000-8000-000000000001','fd130000-0000-4000-8000-000000000002',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'fd150000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true
);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'fd160000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001',
  'fd140000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '20:00',true
);

insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('fd110000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

-- The gate secret is the shared Worker proof; every anon call below carries it
-- except the deliberate gate negatives.
insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values (
  'default',
  encode(extensions.digest('f1104-public-group-gate-secret-00000000000000000000','sha256'),'hex')
)
on conflict(config_key) do update set gate_secret_hash=excluded.gate_secret_hash;

select set_config('f1104.day',(date_trunc('week',current_date)::date+7)::text,false);
select set_config('f1104.gate','f1104-public-group-gate-secret-'||repeat('0',20),false);
select set_config('f1104.bad_gate','f1104-public-group-gate-secret-'||repeat('9',20),false);
select set_config('f1104.group_token','f1104grouptoken'||repeat('a',28),false);
select set_config('f1104.legacy_token','f1104legacytoken'||repeat('b',27),false);
select set_config('f1104.unknown_token',repeat('z',43),false);
select set_config('f1104.group_secret',encode(extensions.digest('f1104:secret:group','sha256'),'hex'),false);
select set_config('f1104.legacy_secret',encode(extensions.digest('f1104:secret:legacy','sha256'),'hex'),false);
select set_config('f1104.group_key',pg_temp.f1104_public_key(
  'fd180000-0000-4000-8000-000000000001',
  floor(extract(epoch from clock_timestamp()))::bigint+300,
  encode(extensions.digest('f1104:secret:group','sha256'),'hex')),false);
select set_config('f1104.legacy_key',pg_temp.f1104_public_key(
  'fd180000-0000-4000-8000-000000000002',
  floor(extract(epoch from clock_timestamp()))::bigint+300,
  encode(extensions.digest('f1104:secret:legacy','sha256'),'hex')),false);

-- Fixture bookings are created through the same dispatcher a browser uses, so
-- both capabilities are real public-source capabilities.
do $$
declare
  v_day date:=current_setting('f1104.day')::date;
  v_result jsonb;
  v_actor text:=encode(extensions.digest('f1104:actor:fixture','sha256'),'hex');
  v_network text:=encode(extensions.digest('f1104:network','sha256'),'hex');
begin
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f1104-public-salon','p_idempotency_key',current_setting('f1104.group_key'),
    'p_customer_name','Public Group Customer',
    'p_lines','[{"serviceId":"fd130000-0000-4000-8000-000000000001"},{"serviceId":"fd130000-0000-4000-8000-000000000002"}]'::jsonb,
    'p_starts_at',(v_day+time '10:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',public.management_token_hash(current_setting('f1104.group_token')),
    'p_recovery_id','fd180000-0000-4000-8000-000000000001',
    'p_recovery_secret_hash',current_setting('f1104.group_secret'),
    'p_management_token_ciphertext',repeat('g',64),'p_management_token_iv',repeat('h',16),
    'p_key_version',1,'p_customer_phone','05550000101'
  ),current_setting('f1104.gate'),v_actor,v_network);
  perform pg_temp.f1104_assert(
    v_result->>'ok'='true' and v_result#>>'{data,0,group_payload,groupId}' is not null,
    'public group fixture did not book: '||v_result::text
  );
  perform set_config('f1104.group_id',v_result#>>'{data,0,group_payload,groupId}',false);

  -- A legacy single-service public booking. Its capability resolves to a shadow
  -- group carrying legacy_appointment_id, which the group actions must refuse.
  v_result:=public.execute_public_operation('book',jsonb_build_object(
    'p_slug','f1104-public-salon','p_idempotency_key',current_setting('f1104.legacy_key'),
    'p_customer_name','Public Legacy Customer',
    'p_service_id','fd130000-0000-4000-8000-000000000002',
    'p_staff_id','fd140000-0000-4000-8000-000000000001',
    'p_starts_at',(v_day+time '16:00') at time zone 'Europe/Istanbul',
    'p_management_token_hash',public.management_token_hash(current_setting('f1104.legacy_token')),
    'p_recovery_id','fd180000-0000-4000-8000-000000000002',
    'p_recovery_secret_hash',current_setting('f1104.legacy_secret'),
    'p_management_token_ciphertext',repeat('l',64),'p_management_token_iv',repeat('m',16),
    'p_key_version',1,'p_customer_phone','05550000102'
  ),current_setting('f1104.gate'),v_actor,v_network);
  perform pg_temp.f1104_assert(
    v_result->>'ok'='true' and v_result#>>'{data,0,appointment_id}' is not null,
    'legacy public fixture did not book: '||v_result::text
  );
  perform set_config('f1104.legacy_appointment_id',v_result#>>'{data,0,appointment_id}',false);
end
$$;

-- Object ACL: the dispatcher is the whole anonymous surface. Every group
-- management core and its token resolver stay unreachable by both API roles.
do $$
begin
  perform pg_temp.f1104_assert(
    has_function_privilege('anon','public.execute_public_operation(text,jsonb,text,text,text)','EXECUTE'),
    'anon lost the only public dispatcher'
  );
  perform pg_temp.f1104_assert(
    not has_function_privilege('anon','public.compute_public_group_management_slots(text,date,integer)','EXECUTE')
    and not has_function_privilege('anon','public.reschedule_public_managed_group(text,text,integer,timestamptz)','EXECUTE')
    and not has_function_privilege('anon','public.cancel_public_managed_group(text,text,integer,text)','EXECUTE')
    and not has_function_privilege('anon','public.f11_public_management_group_ref(text)','EXECUTE')
    and not has_function_privilege('anon','public.f11_public_managed_group_payload(text)','EXECUTE'),
    'anon reached a group management core directly'
  );
  perform pg_temp.f1104_assert(
    not has_function_privilege('authenticated','public.compute_public_group_management_slots(text,date,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.reschedule_public_managed_group(text,text,integer,timestamptz)','EXECUTE')
    and not has_function_privilege('authenticated','public.cancel_public_managed_group(text,text,integer,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.f11_public_management_group_ref(text)','EXECUTE'),
    'operator role inherited the anonymous group cores'
  );
  perform pg_temp.f1104_assert(
    not has_function_privilege('anon','public.get_booking_group_management(uuid,uuid)','EXECUTE')
    and not has_function_privilege('anon','public.reschedule_appointment_group(uuid,uuid,text,integer,timestamptz)','EXECUTE')
    and not has_function_privilege('anon','public.cancel_appointment_group(uuid,uuid,text,integer,text)','EXECUTE')
    and not has_function_privilege('anon','public.cancel_appointment_group_line(uuid,uuid,uuid,text,integer,text)','EXECUTE'),
    'anon reached the operator group surface'
  );
end
$$;

-- Everything below runs as the anonymous API role, so the calls are exactly the
-- ones a browser can make. Results are stashed and asserted after reset role,
-- because anon is never granted a read on the underlying tables.
set local role anon;

select set_config('f1104.r_gate_slots',public.execute_public_operation('manage_group_slots',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_date',current_setting('f1104.day'),'p_step_minutes',15),
  current_setting('f1104.bad_gate'),
  encode(extensions.digest('f1104:actor:gate','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_gate_resched',public.execute_public_operation('manage_group_reschedule',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-gate-resched-0001','p_expected_version',1,
    'p_starts_at',(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul'),
  current_setting('f1104.bad_gate'),
  encode(extensions.digest('f1104:actor:gate','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_gate_cancel',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-gate-cancel-0001','p_expected_version',1),
  repeat('s',10),
  encode(extensions.digest('f1104:actor:gate','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_gate_null',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-gate-cancel-0002','p_expected_version',1),
  null,
  encode(extensions.digest('f1104:actor:gate','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_unknown_slots',public.execute_public_operation('manage_group_slots',
  jsonb_build_object('p_token',current_setting('f1104.unknown_token'),
    'p_date',current_setting('f1104.day'),'p_step_minutes',15),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:unknown','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_unknown_resched',public.execute_public_operation('manage_group_reschedule',
  jsonb_build_object('p_token',current_setting('f1104.unknown_token'),
    'p_idempotency_key','f1104-unknown-resched-0001','p_expected_version',1,
    'p_starts_at',(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:unknown','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_unknown_cancel',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.unknown_token'),
    'p_idempotency_key','f1104-unknown-cancel-0001','p_expected_version',1),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:unknown','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_legacy_slots',public.execute_public_operation('manage_group_slots',
  jsonb_build_object('p_token',current_setting('f1104.legacy_token'),
    'p_date',current_setting('f1104.day'),'p_step_minutes',15),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:legacy','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_legacy_resched',public.execute_public_operation('manage_group_reschedule',
  jsonb_build_object('p_token',current_setting('f1104.legacy_token'),
    'p_idempotency_key','f1104-legacy-resched-0001','p_expected_version',1,
    'p_starts_at',(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:legacy','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_legacy_cancel',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.legacy_token'),
    'p_idempotency_key','f1104-legacy-cancel-0001','p_expected_version',1),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:legacy','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_horizon',public.execute_public_operation('manage_group_slots',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_date',(current_setting('f1104.day')::date+60)::text,'p_step_minutes',15),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:horizon','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_slots_ok',public.execute_public_operation('manage_group_slots',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_date',current_setting('f1104.day'),'p_step_minutes',15),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:slots','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

-- Optimistic concurrency over the public surface: a stale version must come
-- back as a conflict the client can act on, never as a retryable outage.
select set_config('f1104.r_stale_resched',public.execute_public_operation('manage_group_reschedule',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-stale-resched-0001','p_expected_version',7,
    'p_starts_at',(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:stale','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

reset role;

-- The gate is checked before anything else, so a wrong, short or absent proof
-- never reaches an action and never touches a row.
do $$
declare
  v_version integer;
  v_starts timestamptz;
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_gate_slots')::jsonb#>>'{error,message}'='PUBLIC_BOOKING_GATE_UNAVAILABLE'
    and current_setting('f1104.r_gate_resched')::jsonb#>>'{error,message}'='PUBLIC_BOOKING_GATE_UNAVAILABLE'
    and current_setting('f1104.r_gate_cancel')::jsonb#>>'{error,message}'='PUBLIC_BOOKING_GATE_UNAVAILABLE'
    and current_setting('f1104.r_gate_null')::jsonb#>>'{error,message}'='PUBLIC_BOOKING_GATE_UNAVAILABLE',
    'a group management action ran without a valid gate proof'
  );

  select g.version into v_version
  from public.appointment_groups g where g.id=current_setting('f1104.group_id')::uuid;
  select min(a.starts_at) into v_starts
  from public.appointments a where a.group_id=current_setting('f1104.group_id')::uuid;
  perform pg_temp.f1104_assert(
    v_version=1 and v_starts=(current_setting('f1104.day')::date+time '10:00') at time zone 'Europe/Istanbul',
    'gate, unknown-token and legacy denials still moved the group'
  );
end
$$;

-- An unresolvable capability is indistinguishable from an absent one.
do $$
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_unknown_slots')::jsonb#>>'{error,message}'='MANAGEMENT_NOT_FOUND'
    and current_setting('f1104.r_unknown_resched')::jsonb#>>'{error,message}'='MANAGEMENT_NOT_FOUND'
    and current_setting('f1104.r_unknown_cancel')::jsonb#>>'{error,message}'='MANAGEMENT_NOT_FOUND',
    'an unknown token got something other than MANAGEMENT_NOT_FOUND'
  );
end
$$;

-- A legacy single-service capability may not drive the group actions, and the
-- refusal must name the reason: the client has to fall back to the appointment
-- endpoint, which a retryable 503 would never tell it.
do $$
declare
  v_starts timestamptz;
  v_status text;
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_legacy_slots')::jsonb#>>'{error,message}'='MANAGEMENT_GROUP_REQUIRED'
    and current_setting('f1104.r_legacy_resched')::jsonb#>>'{error,message}'='MANAGEMENT_GROUP_REQUIRED'
    and current_setting('f1104.r_legacy_cancel')::jsonb#>>'{error,message}'='MANAGEMENT_GROUP_REQUIRED',
    'legacy capability on a group action was masked or accepted'
  );
  select a.starts_at,a.status into v_starts,v_status
  from public.appointments a where a.id=current_setting('f1104.legacy_appointment_id')::uuid;
  perform pg_temp.f1104_assert(
    v_status in ('scheduled','confirmed')
    and v_starts=(current_setting('f1104.day')::date+time '16:00') at time zone 'Europe/Istanbul',
    'the refused group action still touched the legacy appointment'
  );
end
$$;

-- Horizon and a working read stay distinguishable through the dispatcher.
do $$
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_horizon')::jsonb#>>'{error,message}'='DATE_OUT_OF_RANGE',
    'a date past the horizon was not reported as DATE_OUT_OF_RANGE'
  );
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_slots_ok')::jsonb->>'ok'='true'
    and jsonb_array_length(current_setting('f1104.r_slots_ok')::jsonb->'data')>0,
    'the public group reschedule slot read returned nothing'
  );
end
$$;

-- Optimistic concurrency over the public surface: a stale version must come
-- back as a conflict the client can act on, never as a retryable outage. Before
-- F11-03 extended the allow-list this collapsed to PUBLIC_OPERATION_UNAVAILABLE,
-- so the client was told to retry a request that could never succeed.
do $$
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_stale_resched')::jsonb#>>'{error,message}'='BOOKING_GROUP_VERSION_CONFLICT',
    'a stale public reschedule was masked as an outage: '||current_setting('f1104.r_stale_resched')
  );
end
$$;

-- Second anonymous window: the mutations that must succeed, and the guards
-- that only a moved group can prove.
set local role anon;

select set_config('f1104.r_resched_ok',public.execute_public_operation('manage_group_reschedule',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-resched-0001','p_expected_version',1,
    'p_starts_at',(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:resched','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_stale_cancel',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-stale-cancel-0001','p_expected_version',1,'p_reason','müşteri'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:cancel','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

reset role;

-- The move landed and the stale cancel bounced off it: the group is at version 2
-- on the new start with both lines still live.
do $$
declare
  v_active integer;
  v_version integer;
  v_starts timestamptz;
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_resched_ok')::jsonb->>'ok'='true'
    and (current_setting('f1104.r_resched_ok')::jsonb#>>'{data,0,group_payload,version}')::int=2
    and (current_setting('f1104.r_resched_ok')::jsonb#>>'{data,0,group_payload,startsAt}')::timestamptz
        =(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul',
    'the gated public group reschedule failed: '||current_setting('f1104.r_resched_ok')
  );
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_stale_cancel')::jsonb#>>'{error,message}'='BOOKING_GROUP_VERSION_CONFLICT',
    'a stale public cancel was masked as an outage: '||current_setting('f1104.r_stale_cancel')
  );

  select count(*)::integer into v_active
  from public.appointments a
  where a.group_id=current_setting('f1104.group_id')::uuid
    and a.status in ('scheduled','confirmed');
  select g.version into v_version
  from public.appointment_groups g where g.id=current_setting('f1104.group_id')::uuid;
  select min(a.starts_at) into v_starts
  from public.appointments a where a.group_id=current_setting('f1104.group_id')::uuid;
  perform pg_temp.f1104_assert(
    v_active=2 and v_version=2
    and v_starts=(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul',
    'the refused stale cancel still changed the moved group'
  );
end
$$;

set local role anon;

select set_config('f1104.r_cancel_ok',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-cancel-0001','p_expected_version',2,'p_reason','müşteri'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:cancel','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

select set_config('f1104.r_recancel',public.execute_public_operation('manage_group_cancel',
  jsonb_build_object('p_token',current_setting('f1104.group_token'),
    'p_idempotency_key','f1104-cancel-0002','p_expected_version',3,'p_reason','müşteri'),
  current_setting('f1104.gate'),
  encode(extensions.digest('f1104:actor:cancel','sha256'),'hex'),
  encode(extensions.digest('f1104:network','sha256'),'hex'))::text,false);

reset role;

-- The version contract must survive the envelope. Before F11-03 extended the
-- allow-list every one of these collapsed to PUBLIC_OPERATION_UNAVAILABLE, so
-- the client was told to retry a request that could never succeed.
do $$
declare
  v_version integer;
  v_starts timestamptz;
begin
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_cancel_ok')::jsonb->>'ok'='true',
    'the gated public group cancel failed: '||current_setting('f1104.r_cancel_ok')
  );
  perform pg_temp.f1104_assert(
    current_setting('f1104.r_recancel')::jsonb#>>'{error,message}'='BOOKING_GROUP_NOT_CANCELLABLE',
    'cancelling an already cancelled group was masked: '||current_setting('f1104.r_recancel')
  );

  select g.version into v_version
  from public.appointment_groups g where g.id=current_setting('f1104.group_id')::uuid;
  select min(a.starts_at) into v_starts
  from public.appointments a where a.group_id=current_setting('f1104.group_id')::uuid;
  perform pg_temp.f1104_assert(
    v_version=3
    and v_starts=(current_setting('f1104.day')::date+time '14:00') at time zone 'Europe/Istanbul'
    and not exists(
      select 1 from public.appointments a
      where a.group_id=current_setting('f1104.group_id')::uuid
        and a.status<>'cancelled'
    ),
    'the public group did not land on one cancelled, version-3 state'
  );
end
$$;

-- Widening the vocabulary must not widen what leaks. Unknown text still
-- sanitizes, and no denial carries customer data or the capability itself.
do $$
declare
  v_probe text;
begin
  perform pg_temp.f1104_assert(
    public.public_operation_error('private email=user@example.test token=secret')
      #>>'{error,message}'='PUBLIC_OPERATION_UNAVAILABLE'
    and public.public_operation_error('BOOKING_GROUP_EMPTY')
      #>>'{error,message}'='PUBLIC_OPERATION_UNAVAILABLE'
    and public.public_operation_error('BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT')
      #>>'{error,message}'='PUBLIC_OPERATION_UNAVAILABLE',
    'public error sanitization weakened'
  );

  v_probe:=concat_ws(' ',
    current_setting('f1104.r_gate_slots'),current_setting('f1104.r_unknown_resched'),
    current_setting('f1104.r_legacy_resched'),current_setting('f1104.r_legacy_cancel'),
    current_setting('f1104.r_stale_resched'),current_setting('f1104.r_stale_cancel'),
    current_setting('f1104.r_recancel'),current_setting('f1104.r_horizon'));
  perform pg_temp.f1104_assert(
    position('Public Group Customer' in v_probe)=0
    and position('Public Legacy Customer' in v_probe)=0
    and position('05550000101' in v_probe)=0
    and position('05550000102' in v_probe)=0
    and position(current_setting('f1104.group_token') in v_probe)=0
    and position(current_setting('f1104.legacy_token') in v_probe)=0
    and position(current_setting('f1104.gate') in v_probe)=0
    and position(current_setting('f1104.group_id') in v_probe)=0,
    'a public denial leaked customer data, a capability or the gate proof'
  );
end
$$;

rollback;
