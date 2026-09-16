-- F11-01 upgrade fixture. This runs on yzt_s08_upgrade after the accepted
-- F10/F12 chain and deliberately leaves durable legacy evidence for the forward
-- migration to preserve. The assertion file drops the test-owned snapshot table.

create table public.f11_upgrade_expected (
  entity text not null,
  row_key text not null,
  payload jsonb not null,
  primary key(entity,row_key)
);
revoke all on table public.f11_upgrade_expected from public, anon, authenticated;

insert into auth.users(id,email,raw_user_meta_data)
values ('d1200000-0000-4000-8000-000000000001','f11-upgrade-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'd1210000-0000-4000-8000-000000000001','F11 Upgrade Salon','f11-upgrade-salon','Europe/Istanbul',
  'd1200000-0000-4000-8000-000000000001'
) on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'd1220000-0000-4000-8000-000000000001','d1210000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001','owner',true
) on conflict(business_id,user_id) do update set role='owner',active=true;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'd1230000-0000-4000-8000-000000000001','d1210000-0000-4000-8000-000000000001',
  'F11 Upgrade Legacy',30,5,5,'Genel',10,23000,'fixed',23000,23000,'TRY',true
) on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name,active)
values (
  'd1240000-0000-4000-8000-000000000001','d1210000-0000-4000-8000-000000000001','F11 Upgrade Staff',true
) on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  'd1210000-0000-4000-8000-000000000001','d1240000-0000-4000-8000-000000000001',
  'd1230000-0000-4000-8000-000000000001',true
) on conflict(business_id,staff_id,service_id) do update set active=true;

-- Public booking readiness is structural, not dependent on a specific empty slot.
-- These are fixture-owned schedule rows. The old replace_*_hours RPCs are
-- intentionally revoked from browser roles after F10-04/S08 and are not part of
-- the legacy evidence this upgrade test is preserving.
insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'd1250000-0000-4000-8000-000000000001','d1210000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '18:00',true
) on conflict(id) do update
set weekday=excluded.weekday,starts_local=excluded.starts_local,ends_local=excluded.ends_local,active=true;

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'd1260000-0000-4000-8000-000000000001','d1210000-0000-4000-8000-000000000001',
  'd1240000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '18:00',true
) on conflict(id) do update
set weekday=excluded.weekday,starts_local=excluded.starts_local,ends_local=excluded.ends_local,active=true;

insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('d1210000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

create or replace function public.f11_upgrade_v2_key(
  p_recovery_id uuid,
  p_deadline bigint,
  p_secret_hash text
)
returns text
language sql
immutable
set search_path=pg_catalog,extensions
as $$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_secret_hash,'UTF8'),'sha256'),'hex');
$$;
revoke all on function public.f11_upgrade_v2_key(uuid,bigint,text) from public,anon,authenticated;

-- Five genuine legacy public booking transactions produce capability, recovery,
-- command, audit and notification rows through the pre-F11 production path.
do $$
declare
  v_day date:=date_trunc('week',current_date)::date+7;
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
  v_index integer;
  v_recovery uuid;
  v_secret_hash text;
  v_management_hash text;
  v_key text;
  v_created uuid;
begin
  for v_index in 1..5 loop
    v_recovery:=format('d1280000-0000-4000-8000-%s',lpad(v_index::text,12,'0'))::uuid;
    v_secret_hash:=encode(extensions.digest('f11-upgrade-secret-'||v_index::text,'sha256'),'hex');
    v_management_hash:=encode(extensions.digest('f11-upgrade-management-'||v_index::text,'sha256'),'hex');
    v_key:=public.f11_upgrade_v2_key(v_recovery,v_deadline,v_secret_hash);

    select appointment_id into strict v_created
    from public.create_public_appointment_with_recovery(
      'f11-upgrade-salon',v_key,'F11 Upgrade Customer '||v_index::text,
      'd1230000-0000-4000-8000-000000000001','d1240000-0000-4000-8000-000000000001',
      ((v_day+time '09:20') at time zone 'Europe/Istanbul') + make_interval(hours=>v_index-1),
      v_management_hash,v_recovery,v_secret_hash,
      'f11-upgrade-ciphertext-'||v_index::text||'-abcdefghijklmnopqrstuvwxyz0123456789',
      'f11-upgrade-iv-'||lpad(v_index::text,2,'0'),1::smallint,
      '+90 555 110 00 '||lpad(v_index::text,2,'0'),
      'f11-upgrade-'||v_index::text||'@example.invalid',null
    );
    if v_created is null then raise exception 'F11 upgrade booking % missing',v_index; end if;
  end loop;
end
$$;

-- Keep one job in each durable lifecycle state and attach provider evidence where
-- the state requires it. These values are snapshotted verbatim below.
update public.appointment_notification_jobs
set state='leased',attempt_count=1,last_attempt_at=now()-interval '10 minutes',
    first_provider_attempt_at=now()-interval '10 minutes',
    provider_idempotency_expires_at=now()+interval '23 hours',
    delivery_certainty='ambiguous',has_ambiguous_history=true,
    lease_token='d1290000-0000-4000-8000-000000000002',lease_expires_at=now()+interval '5 minutes',
    last_error_class='f11_upgrade_ambiguous_lease',updated_at=now()-interval '9 minutes'
where recipient='f11-upgrade-2@example.invalid';

update public.appointment_notification_jobs
set state='retry_wait',attempt_count=1,last_attempt_at=now()-interval '20 minutes',
    first_provider_attempt_at=now()-interval '20 minutes',
    provider_idempotency_expires_at=now()+interval '22 hours',
    delivery_certainty='ambiguous',has_ambiguous_history=true,
    lease_token=null,lease_expires_at=null,available_at=now()+interval '2 minutes',
    last_error_class='f11_upgrade_retry',updated_at=now()-interval '19 minutes'
where recipient='f11-upgrade-3@example.invalid';

update public.appointment_notification_jobs
set state='sent',attempt_count=1,last_attempt_at=now()-interval '30 minutes',
    first_provider_attempt_at=now()-interval '30 minutes',
    provider_idempotency_expires_at=now()+interval '21 hours',
    delivery_certainty='accepted',provider_message_id='f11-provider-sent-4',
    sent_at=now()-interval '29 minutes',terminal_at=now()-interval '29 minutes',
    lease_token=null,lease_expires_at=null,updated_at=now()-interval '29 minutes'
where recipient='f11-upgrade-4@example.invalid';

update public.appointment_notification_jobs
set state='failed_terminal',attempt_count=1,last_attempt_at=now()-interval '40 minutes',
    first_provider_attempt_at=now()-interval '40 minutes',
    provider_idempotency_expires_at=now()+interval '20 hours',
    delivery_certainty='rejected',last_error_class='f11_upgrade_rejected',
    terminal_at=now()-interval '39 minutes',lease_token=null,lease_expires_at=null,
    updated_at=now()-interval '39 minutes'
where recipient='f11-upgrade-5@example.invalid';

-- Snapshot exact pre-F11 durable evidence. The assertion compares each original
-- row after subtracting only the new F11 bridge/snapshot columns.
insert into public.f11_upgrade_expected(entity,row_key,payload)
select 'appointment',a.id::text,to_jsonb(a)
from public.appointments a
where a.business_id='d1210000-0000-4000-8000-000000000001';

insert into public.f11_upgrade_expected(entity,row_key,payload)
select 'event',e.id::text,to_jsonb(e)
from public.appointment_events e
where e.business_id='d1210000-0000-4000-8000-000000000001';

insert into public.f11_upgrade_expected(entity,row_key,payload)
select 'command',c.business_id::text||'/'||c.idempotency_key,to_jsonb(c)
from public.booking_commands c
where c.business_id='d1210000-0000-4000-8000-000000000001';

insert into public.f11_upgrade_expected(entity,row_key,payload)
select 'capability',c.appointment_id::text,to_jsonb(c)
from public.appointment_management_capabilities c
join public.appointments a on a.id=c.appointment_id
where a.business_id='d1210000-0000-4000-8000-000000000001';

insert into public.f11_upgrade_expected(entity,row_key,payload)
select 'recovery',r.id::text,to_jsonb(r)
from public.public_booking_recoveries r
where r.business_id='d1210000-0000-4000-8000-000000000001';

insert into public.f11_upgrade_expected(entity,row_key,payload)
select 'notification',n.id::text,to_jsonb(n)
from public.appointment_notification_jobs n
join public.appointments a on a.id=n.appointment_id
where a.business_id='d1210000-0000-4000-8000-000000000001';
