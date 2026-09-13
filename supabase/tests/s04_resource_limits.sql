begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000204','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s04-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4b000000-0000-4000-8000-000000000204','Abuse Test','s04-test','Europe/Istanbul',
  '19000000-0000-4000-8000-000000000204'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5b000000-0000-4000-8000-000000000204','4b000000-0000-4000-8000-000000000204',
  '19000000-0000-4000-8000-000000000204','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6b000000-0000-4000-8000-000000000204','4b000000-0000-4000-8000-000000000204',
  'Abuse Hizmeti',30,0,0,180000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7b000000-0000-4000-8000-000000000204','4b000000-0000-4000-8000-000000000204','Abuse Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4b000000-0000-4000-8000-000000000204','7b000000-0000-4000-8000-000000000204',
  '6b000000-0000-4000-8000-000000000204',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000204',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4b000000-0000-4000-8000-000000000204',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4b000000-0000-4000-8000-000000000204',
    '7b000000-0000-4000-8000-000000000204',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"18:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4b000000-0000-4000-8000-000000000204', true, 15, 0, 30
  );
end
$$;

reset role;
delete from public.public_booking_rate_counters;
delete from public.public_booking_abuse_config;
insert into public.public_booking_abuse_config(
  config_key,gate_secret_hash,
  read_window_seconds,read_actor_limit,read_network_limit,
  create_window_seconds,create_actor_limit,create_network_limit,create_business_limit,
  recover_window_seconds,recover_actor_limit,recover_network_limit
) values (
  'default',encode(digest('ggggggggggggggggggggggggggggggggggggggggggg','sha256'),'hex'),
  60,4,10,
  600,2,6,4,
  300,2,6
);


set track_functions = 'all';
create function pg_temp.s04_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'S04: %', p_message; end if; end $$;
grant execute on function pg_temp.s04_assert(boolean,text) to anon, authenticated;
create function pg_temp.s04_payload() returns jsonb language sql as $$
 select jsonb_build_object(
   'p_slug','s04-test','p_idempotency_key','s04-book-0001','p_customer_name','S04 Customer',
   'p_service_id','6b000000-0000-4000-8000-000000000204',
   'p_staff_id','7b000000-0000-4000-8000-000000000204',
   'p_starts_at',((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul',
   'p_management_token_hash',encode(digest(repeat('m',43),'sha256'),'hex'),
   'p_recovery_id','8b000000-0000-4000-8000-000000000204',
   'p_recovery_secret_hash',repeat('b',64),'p_management_token_ciphertext',repeat('c',60),
   'p_management_token_iv',repeat('i',16),'p_key_version',1,'p_customer_phone','+90 555 000 02 04','p_customer_email','s04-customer@example.test');
$$;
grant execute on function pg_temp.s04_payload() to anon;
create function pg_temp.s04_call(p_action text,p_args jsonb,p_actor text default 'a',p_network text default 'f')
returns jsonb language sql as $$
 select public.execute_public_operation(p_action,p_args,repeat('g',43),repeat(p_actor,64),repeat(p_network,64));
$$;
grant execute on function pg_temp.s04_call(text,jsonb,text,text) to anon;

-- Explicit ACL inventory, plus real invocation denial. An HTTP caller has no
-- custom SQL/SET ROLE powers; these roles match PostgREST, not table owner.
do $$ declare f record; begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace
   and (proname in ('get_public_booking_business','get_public_booking_services','get_public_booking_staff',
     'compute_public_booking_slots','create_public_appointment','create_public_appointment_with_recovery',
     'recover_public_appointment','get_public_managed_appointment','compute_public_management_slots',
     'reschedule_public_managed_appointment','cancel_public_managed_appointment','create_business_with_owner',
     'provision_public_management_token','consume_public_booking_rate','enforce_public_booking_rate',
     'public_operation_error','prune_public_booking_rate_counters') or proname in (
     'get_public_booking_business_guarded','get_public_booking_services_guarded','get_public_booking_staff_guarded',
     'compute_public_booking_slots_guarded','create_public_appointment_with_recovery_guarded','recover_public_appointment_guarded'))
 loop
   perform pg_temp.s04_assert(not has_function_privilege('anon',f.oid,'execute')
     and not has_function_privilege('authenticated',f.oid,'execute'), 'unbounded RPC executable: '||f.proname);
 end loop;
 perform pg_temp.s04_assert(has_function_privilege('anon','public.execute_public_operation(text,jsonb,text,text,text)','execute'), 'gateway missing anon grant');
 perform pg_temp.s04_assert(not has_function_privilege('anon','public.create_business_with_owner_guarded(text,text,text)','execute'), 'anon business creation');
end $$;
set local role anon;
do $$ begin
 begin perform public.get_public_managed_appointment(repeat('m',43)); raise exception 'raw manage allowed';
 exception when insufficient_privilege then null; end;
 begin perform public.create_business_with_owner('Forbidden','forbidden','UTC'); raise exception 'raw business allowed';
 exception when insufficient_privilege then null; end;
end $$;
select pg_temp.s04_assert(public.execute_public_operation('manage_view','{}','bad',repeat('a',64),repeat('f',64))#>>'{error,message}'='PUBLIC_BOOKING_GATE_UNAVAILABLE','wrong gate');
select pg_temp.s04_assert(public.execute_public_operation('manage_view','{}',repeat('g',43),'bad',repeat('f',64))#>>'{error,message}'='PUBLIC_BOOKING_GATE_INVALID_PROOF','wrong actor proof');
select pg_temp.s04_assert(pg_temp.s04_call('arbitrary_sql','{}')#>>'{error,message}'='INVALID_PUBLIC_OPERATION','arbitrary action');
reset role;
select pg_temp.s04_assert((select count(*)=0 from public.public_booking_rate_counters),'wrong proof allocated counters');

-- A legitimate first booking + replay, then a changed payload conflict. Both
-- request attempts count, but neither replay nor payload conflict spend create.
set local role anon;
select pg_temp.s04_assert((pg_temp.s04_call('book',pg_temp.s04_payload())->>'ok')::boolean,'first booking');
select pg_temp.s04_assert((pg_temp.s04_call('book',pg_temp.s04_payload())->>'ok')::boolean,'safe retry');
select pg_temp.s04_assert(pg_temp.s04_call('book',pg_temp.s04_payload()||'{"p_customer_name":"Changed"}')#>>'{error,message}'='IDEMPOTENCY_CONFLICT','changed payload bypassed conflict');
reset role;
select pg_temp.s04_assert((select count=1 from public.public_booking_rate_counters where action='create' and dimension='actor' and key_hash=repeat('a',64)),'safe retry consumed new create');
select pg_temp.s04_assert((select count=3 from public.public_booking_rate_counters where action='request' and dimension='actor' and key_hash=repeat('a',64)),'domain conflict rolled back request');
select pg_temp.s04_assert((select count(*)=1 from public.appointments where business_id='4b000000-0000-4000-8000-000000000204'),'duplicate appointment');
select pg_temp.s04_assert((select count(*)=1 from public.appointment_notification_jobs where business_id='4b000000-0000-4000-8000-000000000204'),'duplicate S03 outbox event');

-- Genuine wrong recovery proof still consumes its separate quota; zero data is
-- not a booking success and does not expose the existing appointment.
set local role anon;
select pg_temp.s04_assert(pg_temp.s04_call('recover',jsonb_build_object('p_recovery_id','8b000000-0000-4000-8000-000000000204','p_idempotency_key','s04-book-0001','p_recovery_secret_hash',repeat('d',64)))->'data'='[]'::jsonb,'wrong recovery proof leaked result');
select pg_temp.s04_assert(pg_temp.s04_call('recover',jsonb_build_object('p_recovery_id','8b000000-0000-4000-8000-000000000204','p_idempotency_key','s04-book-0001','p_recovery_secret_hash',repeat('b',64)))->>'ok'='true','recovery failed');
select pg_temp.s04_assert(pg_temp.s04_call('recover','{}')#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%','recovery quota missing');
reset role;

-- 1,000 proof-bearing repeats: exactly remaining 57 fit the 60/min request
-- window; rejected ones never invoke the booking implementation. No DB sleeps.
do $$ declare v_result jsonb; v_allowed int:=0; v_blocked int:=0; v_before bigint; v_after bigint; v_start timestamptz:=clock_timestamp(); begin
 select coalesce(sum(calls),0) into v_before from pg_stat_xact_user_functions where funcid='public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text)'::regprocedure;
 for i in 1..1000 loop
   v_result:=pg_temp.s04_call('book',pg_temp.s04_payload());
   if v_result->>'ok'='true' then v_allowed:=v_allowed+1;
   elsif v_result#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%' then v_blocked:=v_blocked+1;
   else raise exception 'unexpected repeat result: %',v_result; end if;
 end loop;
 select coalesce(sum(calls),0) into v_after from pg_stat_xact_user_functions where funcid='public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text)'::regprocedure;
 perform pg_temp.s04_assert(v_allowed=57 and v_blocked=943,'1000 repeat budget incorrect');
 perform pg_temp.s04_assert(v_after-v_before=57,'rejected repeats invoked raw booking');
 raise notice 'S04 measured 1000 repeats: admitted %, rejected %, raw booking calls %, total ms %',v_allowed,v_blocked,v_after-v_before,extract(epoch from clock_timestamp()-v_start)*1000;
end $$;

-- Two independent users on one NAT: actor A exhausted, B can still read/create.
set local role anon;
select pg_temp.s04_assert(pg_temp.s04_call('book',pg_temp.s04_payload()||jsonb_build_object('p_idempotency_key','s04-book-0002','p_recovery_id','8b000000-0000-4000-8000-000000000205','p_management_token_hash',repeat('e',64),'p_starts_at',((date_trunc('week',current_date)::date+7)+time '11:00') at time zone 'Europe/Istanbul'),'b')->>'ok'='true','second NAT user blocked by first actor');
-- Request quota is exhausted, but view, slots, reschedule and cancel are independent.
select pg_temp.s04_assert(pg_temp.s04_call('manage_view',jsonb_build_object('p_token',repeat('m',43)))->>'ok'='true','create quota blocked view');
select pg_temp.s04_assert(pg_temp.s04_call('manage_slots',jsonb_build_object('p_token',repeat('m',43),'p_date',date_trunc('week',current_date)::date+7))->>'ok'='true','create quota blocked management slots');
select pg_temp.s04_assert(pg_temp.s04_call('manage_reschedule',jsonb_build_object('p_token',repeat('m',43),'p_idempotency_key','s04-move-0001','p_staff_id','7b000000-0000-4000-8000-000000000204','p_starts_at',((date_trunc('week',current_date)::date+7)+time '12:00') at time zone 'Europe/Istanbul'))->>'ok'='true','create quota blocked reschedule');
select pg_temp.s04_assert(pg_temp.s04_call('manage_cancel',jsonb_build_object('p_token',repeat('m',43),'p_idempotency_key','s04-cancel-0001'))->>'ok'='true','create quota blocked cancel');
reset role;
select pg_temp.s04_assert((select count(*)=1 from public.appointment_notification_jobs where business_id='4b000000-0000-4000-8000-000000000204' and is_current),'S03 cancelled event still current or second booking lost');

-- Expected failures in expensive management/date operations persist admission.
set local role anon;
do $$ declare v_result jsonb; begin
 for i in 1..10 loop
   v_result:=pg_temp.s04_call('manage_reschedule',jsonb_build_object('p_token',repeat('x',43),'p_idempotency_key','s04-invalid-'||i),'c');
   perform pg_temp.s04_assert(v_result#>>'{error,message}'='MANAGEMENT_NOT_FOUND','invalid token not domain-rejected');
 end loop;
 perform pg_temp.s04_assert(pg_temp.s04_call('manage_reschedule','{}','c')#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%','manage error rolled back counter');
 perform pg_temp.s04_assert(pg_temp.s04_call('manage_cancel',jsonb_build_object('p_token',repeat('x',43),'p_idempotency_key','s04-invalid-cancel'),'c')#>>'{error,message}'='MANAGEMENT_NOT_FOUND','reschedule exhaustion blocked cancel');
 for i in 1..30 loop
   v_result:=pg_temp.s04_call('slots','{"p_slug":"s04-test","p_date":"invalid"}','d');
   perform pg_temp.s04_assert(v_result->>'ok'='false','invalid date accepted');
 end loop;
 perform pg_temp.s04_assert(pg_temp.s04_call('slots','{}','d')#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%','invalid date did not count');
end $$;
reset role;
-- Advance only fixture windows; no wall-clock sleep / flaky minute-boundary test.
update public.public_booking_rate_counters set window_started_at=window_started_at-interval '2 minutes' where action='request';
set local role anon;
select pg_temp.s04_assert(pg_temp.s04_call('book',pg_temp.s04_payload())->>'ok'='true','window did not renew safe retry');
reset role;
select pg_temp.s04_assert((select count=1 from public.public_booking_rate_counters where action='request' and dimension='actor' and key_hash=repeat('a',64)),'renewed counter not reset');

-- Business quota is authenticated-user, counts domain failures, and cannot be
-- reset by changing browser proof/network/business selection.
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000204',true);
select pg_temp.s04_assert(public.create_business_with_owner_guarded('S04 Owner','s04-created','UTC')->>'ok'='true','guarded business creation failed');
do $$ begin
 for i in 1..4 loop
   perform pg_temp.s04_assert(public.create_business_with_owner_guarded('S04 Owner','s04-created','UTC')#>>'{error,message}'='BUSINESS_SLUG_TAKEN','duplicate slug not handled');
 end loop;
 perform pg_temp.s04_assert(public.create_business_with_owner_guarded('Another','s04-another','UTC')#>>'{error,message}' like 'PUBLIC_BOOKING_RATE_LIMITED:%','business quota missing');
end $$;
reset role;
select pg_temp.s04_assert((select count(*)=1 from public.memberships m join public.businesses b on b.id=m.business_id where b.slug='s04-created' and m.role='owner'),'atomic owner membership missing');
select pg_temp.s04_assert((select count=5 from public.public_booking_rate_counters where action='business_create'),'business errors rolled back quota');
-- A second pre-existing test user receives its own budget.
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000105',true);
select pg_temp.s04_assert(public.create_business_with_owner_guarded('Other Owner','s04-other-user','UTC')->>'ok'='true','second authenticated user quota blocked');
reset role;
-- Restore incidental JWT forms on both success/error; public source remains public.
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000204',true);
select set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000204"}',true);
select pg_temp.s04_call('book',pg_temp.s04_payload());
select pg_temp.s04_assert(current_setting('request.jwt.claim.sub')='19000000-0000-4000-8000-000000000204','sub not restored');
select pg_temp.s04_call('manage_reschedule',jsonb_build_object('p_token',repeat('x',43),'p_idempotency_key','s04-failure'), 'e');
select pg_temp.s04_assert(current_setting('request.jwt.claims')::jsonb->>'sub'='19000000-0000-4000-8000-000000000204','claims not restored on error');

-- Existing retention cap survives the forward migration.
insert into public.public_booking_rate_counters(action,dimension,key_hash,window_started_at,count,updated_at)
select 'manage_read','actor',encode(digest('stale'||i,'sha256'),'hex'),now()-interval '3 days',1,now()-interval '3 days' from generate_series(1,600)i;
select pg_temp.s04_assert(public.prune_public_booking_rate_counters()=500,'retention batch changed');
select pg_temp.s04_assert((select count(*)=100 from public.public_booking_rate_counters where updated_at<now()-interval '48 hours'),'retention pruned too far');
select pg_temp.s04_assert(public.public_operation_error('duplicate row email=private@example.test token=PRIVATE')#>>'{error,message}'='PUBLIC_OPERATION_UNAVAILABLE','unknown DB error leaked PII');
rollback;
