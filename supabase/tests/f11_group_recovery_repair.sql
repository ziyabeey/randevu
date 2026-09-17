begin;

create function pg_temp.f11r_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F11 recovery repair: %',p_message;
  end if;
end
$$;

create function pg_temp.f11r_key(
  p_recovery_id uuid,
  p_deadline bigint,
  p_secret_hash text
)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_secret_hash,'UTF8'),'sha256'),'hex');
$$;

grant execute on function pg_temp.f11r_assert(boolean,text) to anon;
grant execute on function pg_temp.f11r_key(uuid,bigint,text) to anon;

insert into auth.users(id,email,raw_user_meta_data)
values ('fb100000-0000-4000-8000-000000000001','f11-recovery-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'fb110000-0000-4000-8000-000000000001','F11 Recovery Salon',
  'f11-recovery-salon','Europe/Istanbul','fb100000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'fb120000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  (
    'fb130000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
    'Renk Aralığı',60,0,0,'Renk',10,20000,'range',20000,35000,'TRY',true
  ),
  (
    'fb130000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000001',
    'Sabit Kesim',30,0,0,'Genel',20,12000,'fixed',12000,12000,'TRY',true
  );

insert into public.staff_profiles(id,business_id,name,active)
values (
  'fb140000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  'F11 Bildirim Uzmanı',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001','fb130000-0000-4000-8000-000000000001',true),
  ('fb110000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001','fb130000-0000-4000-8000-000000000002',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'fb150000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '19:00',true
);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'fb160000-0000-4000-8000-000000000001','fb110000-0000-4000-8000-000000000001',
  'fb140000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '19:00',true
);

insert into public.public_booking_settings(
  business_id,enabled,step_minutes,min_notice_minutes,horizon_days
) values ('fb110000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

-- Retained S04 concurrency fixtures leave deliberately tiny quotas behind.
-- Restore the normal bounded defaults inside this rollback-only fixture so
-- recovery/resolve assertions exercise domain behavior through the real gate.
delete from public.public_booking_abuse_config where config_key='default';
insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values ('default',encode(extensions.digest(repeat('g',43),'sha256'),'hex'));

insert into public.notification_dispatch_config(config_key,secret_hash)
values ('default',encode(extensions.digest(repeat('n',43),'sha256'),'hex'))
on conflict(config_key) do update
set secret_hash=excluded.secret_hash,updated_at=now();

delete from public.public_booking_rate_counters;

-- A second real tenant makes the cross-tenant recovery probe independent of
-- unrelated retained fixtures. It shares the operator, never data identities.
insert into public.businesses(id,name,slug,timezone,created_by)
values ('fb110000-0000-4000-8000-000000000002','Foreign Recovery Salon',
  'f11-recovery-foreign','Europe/Istanbul','fb100000-0000-4000-8000-000000000001');
insert into public.memberships(id,business_id,user_id,role,active)
values ('fb120000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000002',
  'fb100000-0000-4000-8000-000000000001','owner',true);
insert into public.services(id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,price_minor,price_type,price_min_minor,price_max_minor,currency,active)
values ('fb130000-0000-4000-8000-000000000003','fb110000-0000-4000-8000-000000000002',
  'Foreign Range',60,0,0,'Genel',20000,'range',20000,35000,'TRY',true);
insert into public.staff_profiles(id,business_id,name,active)
values ('fb140000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000002','Foreign Staff',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values ('fb110000-0000-4000-8000-000000000002','fb140000-0000-4000-8000-000000000002',
  'fb130000-0000-4000-8000-000000000003',true);
insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values ('fb150000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000002',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '19:00',true);
insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values ('fb160000-0000-4000-8000-000000000002','fb110000-0000-4000-8000-000000000002',
  'fb140000-0000-4000-8000-000000000002',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '19:00',true);
insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('fb110000-0000-4000-8000-000000000002',true,15,0,30)
on conflict(business_id) do update set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

-- Shared fixture helpers call the real public gate under anon, with bound v2
-- proofs. Inputs deliberately use fixture-specific capability hashes.
select set_config('f11r.deadline',(floor(extract(epoch from clock_timestamp()))::bigint+300)::text,true);

create function pg_temp.f11r_args(p_case integer)
returns jsonb language plpgsql as $$
declare
  v_id uuid:=('fb170000-0000-4000-8000-'||lpad(p_case::text,12,'0'))::uuid;
  v_hash text:=encode(extensions.digest('f11-recovery/secret/'||p_case,'sha256'),'hex');
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+
    case p_case when 1 then time '10:00' when 2 then time '11:00'
      when 3 then time '14:00' else time '15:00' end) at time zone 'Europe/Istanbul';
begin
  return jsonb_build_object(
    'p_slug',case when p_case=5 then 'f11-recovery-foreign' else 'f11-recovery-salon' end,
    'p_idempotency_key',pg_temp.f11r_key(v_id,current_setting('f11r.deadline')::bigint,v_hash),
    'p_customer_name','F11 Recovery '||p_case,
    'p_lines',case when p_case=2 then jsonb_build_array(
      jsonb_build_object('serviceId','fb130000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','fb130000-0000-4000-8000-000000000002'))
      else jsonb_build_array(jsonb_build_object('serviceId',case when p_case=5
        then 'fb130000-0000-4000-8000-000000000003' else 'fb130000-0000-4000-8000-000000000001' end)) end,
    'p_service_id','fb130000-0000-4000-8000-000000000002',
    'p_staff_id','fb140000-0000-4000-8000-000000000001',
    'p_starts_at',v_start,
    'p_management_token_hash',encode(extensions.digest('f11-recovery/management/'||p_case,'sha256'),'hex'),
    'p_recovery_id',v_id,
    'p_recovery_secret_hash',v_hash,
    'p_management_token_ciphertext',repeat('c',64),
    'p_management_token_iv',repeat('i',16),
    'p_key_version',1,
    'p_customer_email','f11-recovery-'||p_case||'@example.invalid'
  );
end
$$;

create function pg_temp.f11r_call(p_action text,p_args jsonb)
returns jsonb language sql as $$
  select public.execute_public_operation(p_action,p_args,repeat('g',43),
    encode(extensions.digest('f11-recovery/actor','sha256'),'hex'),
    encode(extensions.digest('f11-recovery/network','sha256'),'hex'));
$$;
grant execute on function pg_temp.f11r_args(integer),pg_temp.f11r_call(text,jsonb) to anon;

select pg_temp.f11r_assert(
  not has_function_privilege('anon','public.recover_public_appointment(uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.resolve_public_booking_intent_v2(text,text,text)','EXECUTE')
  and has_function_privilege('anon','public.execute_public_operation(text,jsonb,text,text,text)','EXECUTE'),
  'raw recovery authority widened or gate lost');

set local role anon;
do $$
declare
  v_case integer;
  v_args jsonb;
  v_create jsonb;
  v_recover jsonb;
  v_resolve jsonb;
  v_replay jsonb;
  v_bad jsonb;
begin
  for v_case in 1..3 loop
    v_args:=pg_temp.f11r_args(v_case);
    v_create:=pg_temp.f11r_call(case when v_case=3 then 'book' else 'group_book' end,v_args);
    perform pg_temp.f11r_assert(v_create->>'ok'='true','create failed: '||v_create::text);
    perform pg_temp.f11r_assert(jsonb_array_length(v_create->'data')=1,'missing create result');
    perform set_config('f11r.create_'||v_case,v_create::text,true);
    v_replay:=pg_temp.f11r_call(case when v_case=3 then 'book' else 'group_book' end,v_args);
    perform pg_temp.f11r_assert(v_replay=v_create,'exact replay changed result');

    v_recover:=pg_temp.f11r_call('recover',v_args);
    v_resolve:=pg_temp.f11r_call('resolve',v_args);
    perform pg_temp.f11r_assert(v_recover->>'ok'='true' and jsonb_array_length(v_recover->'data')=1,
      'actual recover did not return booking: '||v_recover::text);
    perform pg_temp.f11r_assert(v_resolve#>>'{data,0,resolution}'='committed','resolve lost committed booking');
    perform pg_temp.f11r_assert(v_recover#>>'{data,0,appointment_id}'=v_create#>>'{data,0,appointment_id}'
      and v_resolve#>>'{data,0,appointment_id}'=v_create#>>'{data,0,appointment_id}', 'recovery changed canonical anchor');
    if v_case<3 then
      perform pg_temp.f11r_assert(v_recover#>'{data,0,group_payload}'=v_create#>'{data,0,group_payload}'
        and v_resolve#>'{data,0,group_payload}'=v_create#>'{data,0,group_payload}', 'recovery lost frozen group lines/estimate');
      perform pg_temp.f11r_assert(v_recover#>'{data,0,price_minor}'='null'::jsonb
        and v_resolve#>'{data,0,price_minor}'='null'::jsonb,'RANGE gained a fabricated definitive amount');
      perform pg_temp.f11r_assert(jsonb_array_length(v_recover#>'{data,0,group_payload,lines}')=v_case,
        'single RANGE or multi-line recovery cardinality changed');
    else
      perform pg_temp.f11r_assert(not ((v_recover->'data'->0)?'group_payload')
        and not ((v_resolve->'data'->0)?'group_payload')
        and (v_recover#>>'{data,0,price_minor}')::integer=12000,'legacy fixed recovery JSON changed');
    end if;
  end loop;

  v_create:=pg_temp.f11r_call('group_book',pg_temp.f11r_args(5));
  perform pg_temp.f11r_assert(v_create->>'ok'='true','foreign tenant fixture create failed');
  v_recover:=pg_temp.f11r_call('recover',pg_temp.f11r_args(5));
  perform pg_temp.f11r_assert(v_recover#>>'{data,0,business_name}'='Foreign Recovery Salon',
    'foreign recovery fixture did not establish distinct tenant data');

  -- Possessing another recovery id or key never grants its group projection.
  foreach v_bad in array array[
    pg_temp.f11r_args(1)||jsonb_build_object('p_recovery_secret_hash',repeat('f',64)),
    pg_temp.f11r_args(1)||jsonb_build_object('p_idempotency_key',pg_temp.f11r_args(2)->>'p_idempotency_key'),
    pg_temp.f11r_args(1)||jsonb_build_object('p_recovery_id',pg_temp.f11r_args(2)->>'p_recovery_id'),
    pg_temp.f11r_args(1)||jsonb_build_object('p_recovery_id',pg_temp.f11r_args(5)->>'p_recovery_id'),
    pg_temp.f11r_args(1)||jsonb_build_object('p_idempotency_key',pg_temp.f11r_args(5)->>'p_idempotency_key')
  ] loop
    v_recover:=pg_temp.f11r_call('recover',v_bad);
    v_resolve:=pg_temp.f11r_call('resolve',v_bad);
    perform pg_temp.f11r_assert(v_recover->'data'='[]'::jsonb and v_resolve->'data'='[]'::jsonb,
      'mismatched secret/key/recovery id disclosed data or claimed absence');
  end loop;

  v_args:=pg_temp.f11r_args(4);
  v_resolve:=pg_temp.f11r_call('resolve',v_args);
  perform pg_temp.f11r_assert(v_resolve#>>'{data,0,resolution}'='closed_absent','missing terminal absence fence');
  v_create:=pg_temp.f11r_call('group_book',v_args);
  perform pg_temp.f11r_assert(v_create->>'ok'='false' and v_create#>>'{error,message}'='BOOKING_INTENT_CLOSED',
    'late group create bypassed the resolution fence');
end
$$;
reset role;

select pg_temp.f11r_assert(
  (select count(*)=3 from public.appointment_groups where business_id='fb110000-0000-4000-8000-000000000001')
  and (select count(*)=4 from public.appointments where business_id='fb110000-0000-4000-8000-000000000001')
  and (select count(*)=3 from public.booking_commands where business_id='fb110000-0000-4000-8000-000000000001')
  and (select count(*)=3 from public.appointment_notification_jobs where business_id='fb110000-0000-4000-8000-000000000001'),
  'replay/recover/resolve produced duplicate or half-group side effects');

-- Expired proof must not turn an existing group into terminal absence. This is
-- durable evidence even after the maintenance-owned secret/ciphertext cleanup.
update public.public_booking_recoveries set expires_at=now()-interval '1 second'
where recovery_id='fb170000-0000-4000-8000-000000000001';
update public.appointment_management_capabilities set revoked_at=now()
where appointment_id=(current_setting('f11r.create_2')::jsonb#>>'{data,0,appointment_id}')::uuid;

set local role anon;
do $$
declare v_case integer; v_recover jsonb; v_resolve jsonb;
begin
  for v_case in 1..2 loop
    v_recover:=pg_temp.f11r_call('recover',pg_temp.f11r_args(v_case));
    v_resolve:=pg_temp.f11r_call('resolve',pg_temp.f11r_args(v_case));
    perform pg_temp.f11r_assert(v_recover->'data'='[]'::jsonb,'expired/revoked group disclosed recovery data');
    perform pg_temp.f11r_assert(v_resolve#>>'{data,0,resolution}'='exists_nolink'
      and v_resolve#>'{data,0,appointment_id}'='null'::jsonb
      and v_resolve#>'{data,0,management_token_ciphertext}'='null'::jsonb
      and not ((v_resolve->'data'->0)?'group_payload'), 'exists_nolink leaked data or lost existing booking evidence');
  end loop;
end
$$;
reset role;

update public.public_booking_recoveries
set recovery_secret_hash=null, management_token_ciphertext=null,management_token_iv=null
where recovery_id='fb170000-0000-4000-8000-000000000001';

set local role anon;
select pg_temp.f11r_assert(pg_temp.f11r_call('resolve',pg_temp.f11r_args(1))#>>'{data,0,resolution}'='exists_nolink',
  'cleanup erased durable committed evidence');
reset role;

-- A mismatched command and an orphan command are inconsistent evidence, not
-- absence. No authority/constraint/trigger is disabled to create these probes.
update public.booking_commands set command='create_group'
where business_id='fb110000-0000-4000-8000-000000000001'
  and idempotency_key=pg_temp.f11r_args(2)->>'p_idempotency_key';
set local role anon;
select pg_temp.f11r_assert(pg_temp.f11r_call('resolve',pg_temp.f11r_args(2))->'data'='[]'::jsonb,
  'wrong command type became group recovery authority or absence');
reset role;
delete from public.public_booking_recoveries where recovery_id='fb170000-0000-4000-8000-000000000002';
set local role anon;
select pg_temp.f11r_assert(pg_temp.f11r_call('resolve',pg_temp.f11r_args(2))->'data'='[]'::jsonb,
  'orphan command became terminal absence');
reset role;

rollback;
