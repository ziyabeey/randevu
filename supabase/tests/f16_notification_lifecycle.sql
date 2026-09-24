begin;

-- F16-02 acceptance: group notification preference, lifecycle replacement,
-- cross-tenant isolation and operator jobs flowing through the shared v3 claim.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f2600000-0000-4000-8000-000000000001','f1602-owner@example.invalid','{}'::jsonb),
  ('f2600000-0000-4000-8000-000000000002','f1602-other@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f2610000-0000-4000-8000-000000000001','F16-02 Salon','f1602-salon','Europe/Istanbul','f2600000-0000-4000-8000-000000000001'),
  ('f2610000-0000-4000-8000-000000000002','F16-02 Other','f1602-other','Europe/Istanbul','f2600000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f2620000-0000-4000-8000-000000000001','f2610000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001','owner',true),
  ('f2620000-0000-4000-8000-000000000002','f2610000-0000-4000-8000-000000000002','f2600000-0000-4000-8000-000000000002','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f2630000-0000-4000-8000-000000000001',
  'f2610000-0000-4000-8000-000000000001',
  'Bildirim Kesim',30,0,0,'Genel',10,18000,'fixed',18000,18000,'TRY',true
);

insert into public.staff_profiles(id,business_id,name,active)
values (
  'f2640000-0000-4000-8000-000000000001',
  'f2610000-0000-4000-8000-000000000001',
  'Bildirim Staff',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'f2610000-0000-4000-8000-000000000001',
  'f2640000-0000-4000-8000-000000000001',
  'f2630000-0000-4000-8000-000000000001',true
);

-- Monday and Tuesday: initial create and canonical next-day reschedule.
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
values
  ('f2610000-0000-4000-8000-000000000001',1,time '08:00',time '18:00',true),
  ('f2610000-0000-4000-8000-000000000001',2,time '08:00',time '18:00',true);
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
values
  ('f2610000-0000-4000-8000-000000000001','f2640000-0000-4000-8000-000000000001',1,time '08:00',time '18:00',true),
  ('f2610000-0000-4000-8000-000000000001','f2640000-0000-4000-8000-000000000001',2,time '08:00',time '18:00',true);

insert into public.notification_dispatch_config(config_key,secret_hash)
values ('default',encode(extensions.digest(repeat('s',43),'sha256'),'hex'))
on conflict(config_key) do update set secret_hash=excluded.secret_hash;

set local role authenticated;
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $f1602_create$
declare
  v jsonb;
begin
  v:=public.create_appointment_group_with_notifications(
    'f2610000-0000-4000-8000-000000000001',
    'f1602-create-0001',
    'Bildirim Müşteri',
    '[{"serviceId":"f2630000-0000-4000-8000-000000000001","staffId":"f2640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2027-01-04 10:00 Europe/Istanbul'::timestamptz,
    '05551602001','f1602-customer@example.invalid','F16-02',
    true,true,1440
  );
  if v->>'groupId' is null or (v->>'version')::integer<>1 then
    raise exception 'F16-02 create payload invalid: %',v;
  end if;
  perform set_config('f1602.group_id',v->>'groupId',false);
end
$f1602_create$;

reset role;

do $f1602_shape$
declare
  v_group uuid:=current_setting('f1602.group_id')::uuid;
  v_bad integer;
begin
  if not exists (
    select 1 from public.appointment_notification_preferences p
    where p.business_id='f2610000-0000-4000-8000-000000000001'
      and p.group_id=v_group
      and p.email_enabled and p.sms_enabled
      and p.reminder_minutes_before=1440 and p.version=1
  ) then
    raise exception 'F16-02 notification preference not durably linked';
  end if;

  if (select count(*) from public.appointment_notification_jobs j
      where j.business_id='f2610000-0000-4000-8000-000000000001'
        and j.group_id=v_group and j.is_current)<>4 then
    raise exception 'F16-02 initial current job set is not lifecycle+reminder x email+sms';
  end if;

  select count(*)::integer into v_bad
  from public.appointment_notification_jobs j
  where j.business_id='f2610000-0000-4000-8000-000000000001'
    and j.group_id=v_group
    and (
      (j.channel='email' and j.provider<>'resend')
      or (j.channel='sms' and (j.provider<>'twilio' or j.provider_reference_id is null))
      or j.recovery_id is not null
    );
  if v_bad<>0 then raise exception 'F16-02 provider/operator job mapping invalid'; end if;

  if not exists (
    select 1 from public.appointment_notification_jobs j
    where j.group_id=v_group and j.kind='booking_reminder'
      and j.channel='sms'
      and j.available_at='2027-01-03 10:00 Europe/Istanbul'::timestamptz
      and j.retry_until='2027-01-04 10:00 Europe/Istanbul'::timestamptz
  ) then
    raise exception 'F16-02 reminder availability window is not business instant bound';
  end if;
end
$f1602_shape$;

-- Exact booking replay + exact preference is a read of the same logical result,
-- not another event emission.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f1602_replay$
declare v jsonb;
begin
  v:=public.create_appointment_group_with_notifications(
    'f2610000-0000-4000-8000-000000000001',
    'f1602-create-0001','Bildirim Müşteri',
    '[{"serviceId":"f2630000-0000-4000-8000-000000000001","staffId":"f2640000-0000-4000-8000-000000000001"}]'::jsonb,
    '2027-01-04 10:00 Europe/Istanbul'::timestamptz,
    '05551602001','f1602-customer@example.invalid','F16-02',
    true,true,1440
  );
  if v->>'groupId'<>current_setting('f1602.group_id') then
    raise exception 'F16-02 exact replay returned another group';
  end if;
end
$f1602_replay$;
reset role;

do $f1602_replay_count$
begin
  if (select count(*) from public.appointment_notification_jobs
      where group_id=current_setting('f1602.group_id')::uuid)<>4 then
    raise exception 'F16-02 exact replay duplicated jobs';
  end if;
end
$f1602_replay_count$;

-- Same booking key with a changed notification intent is not silently accepted.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f1602_pref_conflict$
declare v_error text;
begin
  begin
    perform public.create_appointment_group_with_notifications(
      'f2610000-0000-4000-8000-000000000001',
      'f1602-create-0001','Bildirim Müşteri',
      '[{"serviceId":"f2630000-0000-4000-8000-000000000001","staffId":"f2640000-0000-4000-8000-000000000001"}]'::jsonb,
      '2027-01-04 10:00 Europe/Istanbul'::timestamptz,
      '05551602001','f1602-customer@example.invalid','F16-02',
      true,false,1440
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('IDEMPOTENCY_CONFLICT' in coalesce(v_error,''))=0 then
    raise exception 'F16-02 replay accepted changed notification intent: %',v_error;
  end if;
end
$f1602_pref_conflict$;

-- Canonical F11 reschedule must terminalize the old reminder/event set and
-- create a fresh rescheduled lifecycle + fresh reminder set.
do $f1602_move$
declare
  v jsonb;
begin
  v:=public.reschedule_appointment_group(
    'f2610000-0000-4000-8000-000000000001',
    current_setting('f1602.group_id')::uuid,
    'f1602-move-0001',1,
    '2027-01-05 11:00 Europe/Istanbul'::timestamptz
  );
  if (v->>'version')::integer<>2 then
    raise exception 'F16-02 canonical group reschedule failed: %',v;
  end if;
end
$f1602_move$;
reset role;

do $f1602_move_shape$
declare
  v_group uuid:=current_setting('f1602.group_id')::uuid;
begin
  if (select count(*) from public.appointment_notification_jobs
      where group_id=v_group and is_current)<>4 then
    raise exception 'F16-02 reschedule did not leave exactly four current jobs';
  end if;
  if (select count(*) from public.appointment_notification_jobs
      where group_id=v_group and not is_current and state='failed_terminal')<>4 then
    raise exception 'F16-02 old create/reminder set was not terminalized';
  end if;
  if (select count(*) from public.appointment_notification_jobs
      where group_id=v_group and is_current and event_reason='rescheduled')<>2 then
    raise exception 'F16-02 reschedule lifecycle channels missing';
  end if;
  if (select count(*) from public.appointment_notification_jobs
      where group_id=v_group and is_current and event_reason='reminder'
        and starts_at_snapshot='2027-01-05 11:00 Europe/Istanbul'::timestamptz)<>2 then
    raise exception 'F16-02 reminder was not rebound to new start';
  end if;
end
$f1602_move_shape$;

-- Canonical cancel kills the new reminder and leaves only immediate
-- cancellation jobs; no reminder may remain current after cancellation.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f1602_cancel$
declare v jsonb;
begin
  v:=public.cancel_appointment_group(
    'f2610000-0000-4000-8000-000000000001',
    current_setting('f1602.group_id')::uuid,
    'f1602-cancel-0001',2,'Müşteri iptali'
  );
  if v->>'status'<>'cancelled' then
    raise exception 'F16-02 canonical cancel failed: %',v;
  end if;
end
$f1602_cancel$;
reset role;

do $f1602_cancel_shape$
declare v_group uuid:=current_setting('f1602.group_id')::uuid;
begin
  if (select count(*) from public.appointment_notification_jobs
      where group_id=v_group and is_current)<>2 then
    raise exception 'F16-02 cancellation should leave exactly email+sms lifecycle jobs';
  end if;
  if exists (
    select 1 from public.appointment_notification_jobs
    where group_id=v_group and is_current and kind='booking_reminder'
  ) then
    raise exception 'F16-02 cancelled appointment retained a current reminder';
  end if;
  if (select count(*) from public.appointment_notification_jobs
      where group_id=v_group and is_current and event_reason='cancelled')<>2 then
    raise exception 'F16-02 cancellation lifecycle channels missing';
  end if;
end
$f1602_cancel_shape$;

-- Operator jobs have no public recovery record but must still be claimable by
-- the same server-secret-gated dispatcher. claim_notification_jobs_v3() is
-- VOLATILE and mutates lease state, so execute it exactly once and assert over
-- the materialized result instead of embedding it directly in multiple
-- aggregate expressions.
create temporary table f1602_claim_rows on commit drop as
select *
from public.claim_notification_jobs_v3(repeat('s',43),50,45);

do $f1602_claim$
declare
  v_group uuid:=current_setting('f1602.group_id')::uuid;
  v_count integer;
  v_null_recovery integer;
  v_distinct_jobs integer;
begin
  select
    count(*)::integer,
    count(*) filter (where recovery_id is null)::integer,
    count(distinct job_id)::integer
  into v_count,v_null_recovery,v_distinct_jobs
  from pg_temp.f1602_claim_rows
  where group_id=v_group
    and event_reason='cancelled'
    and kind='booking_lifecycle';

  if v_count<>2 or v_null_recovery<>2 or v_distinct_jobs<>2 then
    raise exception 'F16-02 v3 claim did not expose exactly two unique operator cancellation jobs: count=% nullRecovery=% distinctJobs=%',
      v_count,v_null_recovery,v_distinct_jobs;
  end if;
  if (select count(distinct channel)
      from pg_temp.f1602_claim_rows
      where group_id=v_group
        and event_reason='cancelled'
        and kind='booking_lifecycle')<>2 then
    raise exception 'F16-02 v3 claim did not expose both cancellation channels';
  end if;
  if exists (
    select 1
    from pg_temp.f1602_claim_rows
    group by job_id
    having count(*)>1
  ) then
    raise exception 'F16-02 v3 claim returned a duplicate job row';
  end if;
end
$f1602_claim$;

-- Raw preference state is not tenant-readable. The RPC re-checks membership.
set local role authenticated;
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $f1602_cross_tenant$
declare v_error text;
begin
  begin
    perform public.get_appointment_notification_preferences(
      'f2610000-0000-4000-8000-000000000001',
      current_setting('f1602.group_id')::uuid
    );
  exception when others then v_error:=sqlerrm;
  end;
  if position('NOT_ALLOWED' in coalesce(v_error,''))=0 then
    raise exception 'F16-02 foreign tenant reached notification preferences: %',v_error;
  end if;
end
$f1602_cross_tenant$;

reset role;

-- Surface grants: only authenticated preference RPCs and anonymous
-- dispatch-secret transport are exposed. Raw table remains private.
do $f1602_acl$
begin
  if has_table_privilege('authenticated','public.appointment_notification_preferences','SELECT')
     or has_table_privilege('anon','public.appointment_notification_preferences','SELECT') then
    raise exception 'F16-02 raw preference table leaked';
  end if;
  if not has_function_privilege(
      'authenticated',
      'public.create_appointment_group_with_notifications(uuid,text,text,jsonb,timestamptz,text,text,text,boolean,boolean,integer)',
      'EXECUTE'
    ) then
    raise exception 'F16-02 authenticated create wrapper grant missing';
  end if;
  if not has_function_privilege(
      'anon','public.claim_notification_jobs_v3(text,integer,integer)','EXECUTE'
    ) then
    raise exception 'F16-02 dispatcher v3 grant missing';
  end if;
end
$f1602_acl$;

rollback;
