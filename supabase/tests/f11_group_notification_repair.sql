begin;

create function pg_temp.f11n_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'F11 notification repair: %',p_message;
  end if;
end
$$;

create function pg_temp.f11n_key(
  p_recovery_id uuid,
  p_deadline bigint,
  p_secret_hash text
)
returns text language sql immutable set search_path=pg_catalog,extensions as $$
  select 'pub2_'||p_deadline::text||'_'||encode(extensions.digest(convert_to(
    'yzt:public-booking:intent:v2'||chr(10)||p_recovery_id::text||chr(10)
      ||p_deadline::text||chr(10)||p_secret_hash,'UTF8'),'sha256'),'hex');
$$;

grant execute on function pg_temp.f11n_assert(boolean,text) to anon;
grant execute on function pg_temp.f11n_key(uuid,bigint,text) to anon;

insert into auth.users(id,email,raw_user_meta_data)
values ('fa100000-0000-4000-8000-000000000001','f11-notification-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'fa110000-0000-4000-8000-000000000001','F11 Notification Salon',
  'f11-notification-salon','Europe/Istanbul','fa100000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'fa120000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  (
    'fa130000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001',
    'Renk Aralığı',60,0,0,'Renk',10,20000,'range',20000,35000,'TRY',true
  ),
  (
    'fa130000-0000-4000-8000-000000000002','fa110000-0000-4000-8000-000000000001',
    'Sabit Kesim',30,0,0,'Genel',20,12000,'fixed',12000,12000,'TRY',true
  );

insert into public.staff_profiles(id,business_id,name,active)
values (
  'fa140000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001',
  'F11 Bildirim Uzmanı',true
);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('fa110000-0000-4000-8000-000000000001','fa140000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001',true),
  ('fa110000-0000-4000-8000-000000000001','fa140000-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000002',true);

insert into public.business_hours(id,business_id,weekday,starts_local,ends_local,active)
values (
  'fa150000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '19:00',true
);

insert into public.staff_hours(id,business_id,staff_id,weekday,starts_local,ends_local,active)
values (
  'fa160000-0000-4000-8000-000000000001','fa110000-0000-4000-8000-000000000001',
  'fa140000-0000-4000-8000-000000000001',
  extract(dow from date_trunc('week',current_date)::date+7)::smallint,time '09:00',time '19:00',true
);

insert into public.public_booking_settings(
  business_id,enabled,step_minutes,min_notice_minutes,horizon_days
) values ('fa110000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update
set enabled=true,step_minutes=15,min_notice_minutes=0,horizon_days=30;

insert into public.public_booking_abuse_config(config_key,gate_secret_hash)
values ('default',encode(extensions.digest(repeat('g',43),'sha256'),'hex'))
on conflict(config_key) do update
set gate_secret_hash=excluded.gate_secret_hash,updated_at=now();

insert into public.notification_dispatch_config(config_key,secret_hash)
values ('default',encode(extensions.digest(repeat('n',43),'sha256'),'hex'))
on conflict(config_key) do update
set secret_hash=excluded.secret_hash,updated_at=now();

delete from public.public_booking_rate_counters;

do $$
declare
  v_deadline bigint:=floor(extract(epoch from clock_timestamp()))::bigint+300;
begin
  perform set_config('f11n.range_management_hash',encode(extensions.digest(
    'f11-notification/range-management','sha256'
  ),'hex'),false);
  perform set_config('f11n.multi_management_hash',encode(extensions.digest(
    'f11-notification/multi-management','sha256'
  ),'hex'),false);
  perform set_config('f11n.fixed_management_hash',encode(extensions.digest(
    'f11-notification/fixed-management','sha256'
  ),'hex'),false);
  perform set_config('f11n.range_key',pg_temp.f11n_key(
    'fa170000-0000-4000-8000-000000000101',v_deadline,repeat('1',64)
  ),false);
  perform set_config('f11n.multi_key',pg_temp.f11n_key(
    'fa170000-0000-4000-8000-000000000102',v_deadline,repeat('2',64)
  ),false);
  perform set_config('f11n.fixed_key',pg_temp.f11n_key(
    'fa170000-0000-4000-8000-000000000103',v_deadline,repeat('3',64)
  ),false);
end
$$;

select pg_temp.f11n_assert(
  not exists (
    select 1
    from public.appointment_management_capabilities cap
    where cap.token_hash=any(array[
      current_setting('f11n.range_management_hash'),
      current_setting('f11n.multi_management_hash'),
      current_setting('f11n.fixed_management_hash')
    ])
  ),
  'fixture-specific management hash already belongs to another capability'
);

-- One RANGE line goes through the real anon gate. Its recovery bind fires the
-- production enqueue trigger inside the booking transaction.
set local role anon;
do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul';
  v_result jsonb;
begin
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-notification-salon',
    'p_idempotency_key',current_setting('f11n.range_key'),
    'p_customer_name','Tek Aralık Müşterisi',
    'p_lines',jsonb_build_array(jsonb_build_object('serviceId','fa130000-0000-4000-8000-000000000001')),
    'p_starts_at',v_start,
    'p_management_token_hash',current_setting('f11n.range_management_hash'),
    'p_recovery_id','fa170000-0000-4000-8000-000000000101',
    'p_recovery_secret_hash',repeat('1',64),
    'p_management_token_ciphertext',repeat('c',64),
    'p_management_token_iv',repeat('i',16),
    'p_key_version',1,
    'p_customer_phone',null,
    'p_customer_email','single-range@example.invalid',
    'p_notes',null
  ),repeat('g',43),repeat('a',64),repeat('1',64));

  perform pg_temp.f11n_assert(v_result->>'ok'='true','gated one-range create failed: '||v_result::text);
  perform pg_temp.f11n_assert(jsonb_typeof(v_result->'data')='array' and jsonb_array_length(v_result->'data')=1,'gated one-range result shape changed');
  perform pg_temp.f11n_assert(nullif(v_result#>>'{data,0,appointment_id}','') is not null,'gated one-range create returned no appointment');
  perform pg_temp.f11n_assert(jsonb_array_length(v_result#>'{data,0,group_payload,lines}')=1,'gated one-range payload lost its line');
  perform set_config('f11n.range_appointment',v_result#>>'{data,0,appointment_id}',false);
  perform set_config('f11n.range_group',v_result#>>'{data,0,group_payload,groupId}',false);
end
$$;
reset role;

do $$
declare
  v_job public.appointment_notification_jobs;
begin
  perform pg_temp.f11n_assert(exists(
    select 1
    from public.public_booking_recoveries r
    join public.appointments a on a.business_id=r.business_id and a.id=r.appointment_id
    join public.booking_commands bc on bc.business_id=r.business_id
      and bc.idempotency_key=r.idempotency_key and bc.appointment_id=r.appointment_id
    where r.recovery_id='fa170000-0000-4000-8000-000000000101'
      and r.idempotency_key=current_setting('f11n.range_key')
      and r.management_token_hash=current_setting('f11n.range_management_hash')
      and r.recovery_secret_hash=repeat('1',64)
      and r.appointment_id=current_setting('f11n.range_appointment')::uuid
      and r.group_id=current_setting('f11n.range_group')::uuid
      and a.group_id=r.group_id
      and bc.command='public_create_group' and bc.source='public'
  ),'gated create did not atomically bind recovery, command, anchor and group');

  select * into strict v_job
  from public.appointment_notification_jobs
  where recovery_id='fa170000-0000-4000-8000-000000000101';

  perform pg_temp.f11n_assert(
    v_job.channel='email'
      and v_job.recipient='single-range@example.invalid'
      and v_job.template_version=2
      and v_job.price_minor_snapshot=0
      and v_job.estimate_min_minor_snapshot=20000
      and v_job.estimate_max_minor_snapshot=35000
      and v_job.group_summary_snapshot->>'groupId'=current_setting('f11n.range_group')
      and (v_job.group_summary_snapshot->>'lineCount')::integer=1
      and v_job.group_summary_snapshot->>'currency'='TRY'
      and (v_job.group_summary_snapshot->>'estimateMinMinor')::integer=20000
      and (v_job.group_summary_snapshot->>'estimateMaxMinor')::integer=35000
      and jsonb_array_length(v_job.group_summary_snapshot->'lines')=1
      and v_job.group_summary_snapshot#>>'{lines,0,priceType}'='range'
      and (v_job.group_summary_snapshot#>>'{lines,0,priceMinMinor}')::integer=20000
      and (v_job.group_summary_snapshot#>>'{lines,0,priceMaxMinor}')::integer=35000,
    'one-range job is not a complete frozen template-2 snapshot'
  );
  perform pg_temp.f11n_assert(
    v_job.provider_idempotency_key='public-booking-confirmation/'||v_job.event_id::text,
    'one-range provider idempotency identity changed'
  );
  perform set_config('f11n.range_job',v_job.id::text,false);
  perform set_config('f11n.range_provider_key',v_job.provider_idempotency_key,false);
end
$$;

-- Exact gated replay returns the same group and cannot enqueue a second event or
-- replace the provider idempotency identity.
set local role anon;
do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul';
  v_result jsonb;
begin
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-notification-salon',
    'p_idempotency_key',current_setting('f11n.range_key'),
    'p_customer_name','Tek Aralık Müşterisi',
    'p_lines',jsonb_build_array(jsonb_build_object('serviceId','fa130000-0000-4000-8000-000000000001')),
    'p_starts_at',v_start,
    'p_management_token_hash',current_setting('f11n.range_management_hash'),
    'p_recovery_id','fa170000-0000-4000-8000-000000000101',
    'p_recovery_secret_hash',repeat('1',64),
    'p_management_token_ciphertext',repeat('c',64),
    'p_management_token_iv',repeat('i',16),
    'p_key_version',1,
    'p_customer_phone',null,
    'p_customer_email','single-range@example.invalid',
    'p_notes',null
  ),repeat('g',43),repeat('b',64),repeat('2',64));
  perform pg_temp.f11n_assert(
    v_result->>'ok'='true'
      and v_result#>>'{data,0,appointment_id}'=current_setting('f11n.range_appointment')
      and v_result#>>'{data,0,group_payload,groupId}'=current_setting('f11n.range_group'),
    'exact gated replay changed the reservation'
  );
end
$$;
reset role;

select pg_temp.f11n_assert(
  (select count(*)=1
   from public.appointment_notification_jobs
   where recovery_id='fa170000-0000-4000-8000-000000000101')
  and (select provider_idempotency_key=current_setting('f11n.range_provider_key')
       from public.appointment_notification_jobs
       where id=current_setting('f11n.range_job')::uuid),
  'gated replay duplicated or replaced the notification event'
);

-- A genuine two-line public group continues to produce one template-2 job.
set local role anon;
do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '12:00') at time zone 'Europe/Istanbul';
  v_result jsonb;
begin
  v_result:=public.execute_public_operation('group_book',jsonb_build_object(
    'p_slug','f11-notification-salon',
    'p_idempotency_key',current_setting('f11n.multi_key'),
    'p_customer_name','Çoklu Hizmet Müşterisi',
    'p_lines',jsonb_build_array(
      jsonb_build_object('serviceId','fa130000-0000-4000-8000-000000000001'),
      jsonb_build_object('serviceId','fa130000-0000-4000-8000-000000000002')
    ),
    'p_starts_at',v_start,
    'p_management_token_hash',current_setting('f11n.multi_management_hash'),
    'p_recovery_id','fa170000-0000-4000-8000-000000000102',
    'p_recovery_secret_hash',repeat('2',64),
    'p_management_token_ciphertext',repeat('d',64),
    'p_management_token_iv',repeat('j',16),
    'p_key_version',1,
    'p_customer_phone',null,
    'p_customer_email','multi@example.invalid',
    'p_notes',null
  ),repeat('g',43),repeat('c',64),repeat('3',64));
  perform pg_temp.f11n_assert(v_result->>'ok'='true','gated multi-line create failed: '||v_result::text);
  perform pg_temp.f11n_assert(jsonb_array_length(v_result#>'{data,0,group_payload,lines}')=2,'multi-line gate payload changed');
  perform set_config('f11n.multi_appointment',v_result#>>'{data,0,appointment_id}',false);
end
$$;
reset role;

do $$
declare v_job public.appointment_notification_jobs;
begin
  select * into strict v_job
  from public.appointment_notification_jobs
  where recovery_id='fa170000-0000-4000-8000-000000000102';
  perform pg_temp.f11n_assert(
    v_job.template_version=2
      and (v_job.group_summary_snapshot->>'lineCount')::integer=2
      and jsonb_array_length(v_job.group_summary_snapshot->'lines')=2
      and v_job.estimate_min_minor_snapshot=32000
      and v_job.estimate_max_minor_snapshot=47000,
    'multi-line booking did not retain its single template-2 job'
  );
  perform pg_temp.f11n_assert(
    (select count(*)=1 from public.appointment_notification_jobs
     where recovery_id='fa170000-0000-4000-8000-000000000102'),
    'multi-line booking enqueued more than one job'
  );
  perform set_config('f11n.multi_job',v_job.id::text,false);
end
$$;

-- The established singular fixed-price public contract remains template 1.
set local role anon;
do $$
declare
  v_start timestamptz:=((date_trunc('week',current_date)::date+7)+time '16:00') at time zone 'Europe/Istanbul';
  v_result jsonb;
begin
  v_result:=public.execute_public_operation('book',jsonb_build_object(
    'p_slug','f11-notification-salon',
    'p_idempotency_key',current_setting('f11n.fixed_key'),
    'p_customer_name','Sabit Fiyat Müşterisi',
    'p_service_id','fa130000-0000-4000-8000-000000000002',
    'p_staff_id','fa140000-0000-4000-8000-000000000001',
    'p_starts_at',v_start,
    'p_management_token_hash',current_setting('f11n.fixed_management_hash'),
    'p_recovery_id','fa170000-0000-4000-8000-000000000103',
    'p_recovery_secret_hash',repeat('3',64),
    'p_management_token_ciphertext',repeat('e',64),
    'p_management_token_iv',repeat('k',16),
    'p_key_version',1,
    'p_customer_phone',null,
    'p_customer_email','fixed@example.invalid',
    'p_notes',null
  ),repeat('g',43),repeat('d',64),repeat('4',64));
  perform pg_temp.f11n_assert(v_result->>'ok'='true','legacy fixed create failed: '||v_result::text);
end
$$;
reset role;

do $$
declare v_job public.appointment_notification_jobs;
begin
  select * into strict v_job
  from public.appointment_notification_jobs
  where recovery_id='fa170000-0000-4000-8000-000000000103';
  perform pg_temp.f11n_assert(
    v_job.template_version=1
      and v_job.price_minor_snapshot=12000
      and v_job.group_summary_snapshot is null
      and v_job.estimate_min_minor_snapshot is null
      and v_job.estimate_max_minor_snapshot is null
      and v_job.provider_idempotency_key='public-booking-confirmation/'||v_job.event_id::text,
    'legacy fixed template or provider identity changed'
  );
end
$$;

-- Build both terminal ages from a real frozen group snapshot. The original
-- multi-line event remains active, while version 2 is old sent evidence and
-- version 3 is a fresh failed-terminal event.
update public.appointment_notification_jobs
set state='failed_terminal',terminal_at=now()-interval '31 days',
    last_error_class='f11_old_failed',delivery_certainty='rejected'
where id=current_setting('f11n.range_job')::uuid;

do $$
declare
  v_source public.appointment_notification_jobs;
  v_old_sent uuid;
  v_fresh_terminal uuid;
begin
  select * into strict v_source
  from public.appointment_notification_jobs
  where id=current_setting('f11n.multi_job')::uuid;

  insert into public.appointment_notification_jobs(
    business_id,appointment_id,recovery_id,kind,channel,recipient,provider,state,
    available_at,retry_until,provider_idempotency_key,provider_message_id,sent_at,
    event_id,event_version,event_reason,template_version,is_current,
    superseded_at,superseded_reason,
    business_name_snapshot,customer_name_snapshot,starts_at_snapshot,timezone_snapshot,
    service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot,
    delivery_certainty,group_summary_snapshot,estimate_min_minor_snapshot,estimate_max_minor_snapshot
  ) values (
    v_source.business_id,v_source.appointment_id,v_source.recovery_id,
    v_source.kind,v_source.channel,v_source.recipient,v_source.provider,'sent',
    now()-interval '32 days',v_source.retry_until,'f11-notification/old-sent',
    'f11-old-provider-message',now()-interval '31 days',
    gen_random_uuid(),2,'rescheduled',2,false,
    now()-interval '31 days','f11_retention_fixture',
    v_source.business_name_snapshot,v_source.customer_name_snapshot,
    v_source.starts_at_snapshot,v_source.timezone_snapshot,
    v_source.service_name_snapshot,v_source.staff_name_snapshot,
    v_source.price_minor_snapshot,v_source.currency_snapshot,
    'accepted',v_source.group_summary_snapshot,
    v_source.estimate_min_minor_snapshot,v_source.estimate_max_minor_snapshot
  ) returning id into v_old_sent;

  insert into public.appointment_notification_jobs(
    business_id,appointment_id,recovery_id,kind,channel,recipient,provider,state,
    available_at,retry_until,provider_idempotency_key,last_error_class,terminal_at,
    event_id,event_version,event_reason,template_version,is_current,
    superseded_at,superseded_reason,
    business_name_snapshot,customer_name_snapshot,starts_at_snapshot,timezone_snapshot,
    service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot,
    delivery_certainty,group_summary_snapshot,estimate_min_minor_snapshot,estimate_max_minor_snapshot
  ) values (
    v_source.business_id,v_source.appointment_id,v_source.recovery_id,
    v_source.kind,v_source.channel,v_source.recipient,v_source.provider,'failed_terminal',
    now()-interval '30 days',v_source.retry_until,'f11-notification/fresh-terminal',
    'f11_fresh_terminal',now()-interval '29 days',
    gen_random_uuid(),3,'rescheduled',2,false,
    now()-interval '29 days','f11_retention_fixture',
    v_source.business_name_snapshot,v_source.customer_name_snapshot,
    v_source.starts_at_snapshot,v_source.timezone_snapshot,
    v_source.service_name_snapshot,v_source.staff_name_snapshot,
    v_source.price_minor_snapshot,v_source.currency_snapshot,
    'rejected',v_source.group_summary_snapshot,
    v_source.estimate_min_minor_snapshot,v_source.estimate_max_minor_snapshot
  ) returning id into v_fresh_terminal;

  perform set_config('f11n.old_sent_job',v_old_sent::text,false);
  perform set_config('f11n.fresh_terminal_job',v_fresh_terminal::text,false);
end
$$;

set local role anon;
do $$
declare v_snapshot jsonb;
begin
  v_snapshot:=public.get_notification_group_snapshot(
    repeat('n',43),current_setting('f11n.multi_job')::uuid
  );
  perform pg_temp.f11n_assert(
    (v_snapshot->>'lineCount')::integer=2 and jsonb_array_length(v_snapshot->'lines')=2,
    'active group snapshot was unavailable before maintenance'
  );
  perform public.maintain_notification_jobs(repeat('n',43));
end
$$;
reset role;

do $$
declare
  v_row public.appointment_notification_jobs;
  v_raised boolean;
begin
  select * into strict v_row
  from public.appointment_notification_jobs
  where id=current_setting('f11n.range_job')::uuid;
  perform pg_temp.f11n_assert(
    v_row.state='failed_terminal' and v_row.pii_purged_at is not null
      and v_row.recipient is null and v_row.business_name_snapshot is null
      and v_row.customer_name_snapshot is null and v_row.starts_at_snapshot is null
      and v_row.timezone_snapshot is null and v_row.service_name_snapshot is null
      and v_row.staff_name_snapshot is null and v_row.price_minor_snapshot is null
      and v_row.currency_snapshot is null and v_row.group_summary_snapshot is null
      and v_row.estimate_min_minor_snapshot is null and v_row.estimate_max_minor_snapshot is null
      and v_row.event_id is not null
      and v_row.provider_idempotency_key=current_setting('f11n.range_provider_key'),
    'old failed-terminal group job was not atomically scrubbed or lost durable evidence'
  );

  select * into strict v_row
  from public.appointment_notification_jobs
  where id=current_setting('f11n.old_sent_job')::uuid;
  perform pg_temp.f11n_assert(
    v_row.state='sent' and v_row.pii_purged_at is not null
      and v_row.group_summary_snapshot is null
      and v_row.estimate_min_minor_snapshot is null and v_row.estimate_max_minor_snapshot is null
      and v_row.provider_message_id='f11-old-provider-message'
      and v_row.provider_idempotency_key='f11-notification/old-sent'
      and v_row.event_id is not null,
    'old sent group job was not scrubbed while preserving provider evidence'
  );

  select * into strict v_row
  from public.appointment_notification_jobs
  where id=current_setting('f11n.fresh_terminal_job')::uuid;
  perform pg_temp.f11n_assert(
    v_row.state='failed_terminal' and v_row.pii_purged_at is null
      and (v_row.group_summary_snapshot->>'lineCount')::integer=2
      and v_row.estimate_min_minor_snapshot=32000
      and v_row.estimate_max_minor_snapshot=47000
      and v_row.recipient='multi@example.invalid',
    'fresh terminal group snapshot was scrubbed before 30 days'
  );

  select * into strict v_row
  from public.appointment_notification_jobs
  where id=current_setting('f11n.multi_job')::uuid;
  perform pg_temp.f11n_assert(
    v_row.state='pending' and v_row.pii_purged_at is null
      and (v_row.group_summary_snapshot->>'lineCount')::integer=2
      and v_row.estimate_min_minor_snapshot=32000
      and v_row.estimate_max_minor_snapshot=47000
      and v_row.recipient='multi@example.invalid',
    'active group snapshot was terminalized or scrubbed'
  );

  -- The expanded table invariant forbids restoring a valid-looking group
  -- payload onto a purged audit row.
  v_raised:=false;
  begin
    update public.appointment_notification_jobs
    set group_summary_snapshot='{}'::jsonb,
        estimate_min_minor_snapshot=0,
        estimate_max_minor_snapshot=0
    where id=current_setting('f11n.range_job')::uuid;
  exception when check_violation then
    v_raised:=true;
  end;
  perform pg_temp.f11n_assert(v_raised,'purged row accepted restored group render inputs');
end
$$;

set local role anon;
do $$
declare
  v_id uuid;
  v_snapshot jsonb;
  v_raised boolean;
begin
  foreach v_id in array array[
    current_setting('f11n.range_job')::uuid,
    current_setting('f11n.old_sent_job')::uuid
  ] loop
    v_raised:=false;
    begin
      perform public.get_notification_group_snapshot(repeat('n',43),v_id);
    exception when others then
      if sqlerrm<>'NOTIFICATION_GROUP_SNAPSHOT_NOT_FOUND' then raise; end if;
      v_raised:=true;
    end;
    perform pg_temp.f11n_assert(v_raised,'getter exposed a purged group snapshot');
  end loop;

  v_snapshot:=public.get_notification_group_snapshot(
    repeat('n',43),current_setting('f11n.multi_job')::uuid
  );
  perform pg_temp.f11n_assert(
    (v_snapshot->>'lineCount')::integer=2 and jsonb_array_length(v_snapshot->'lines')=2,
    'getter stopped serving the active frozen group snapshot'
  );
end
$$;
reset role;

select pg_temp.f11n_assert(
  has_function_privilege('anon','public.maintain_notification_jobs(text)','execute')
    and has_function_privilege('anon','public.get_notification_group_snapshot(text,uuid)','execute')
    and not has_function_privilege('authenticated','public.maintain_notification_jobs(text)','execute')
    and not has_function_privilege('authenticated','public.get_notification_group_snapshot(text,uuid)','execute'),
  'notification maintenance/getter ACL changed'
);

rollback;
