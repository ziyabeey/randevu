begin;

-- F16-02: notification preferences and lifecycle-aware multi-channel outbox.
-- Reuse the existing F09/S03 queue, lease, retry and receipt authority.
-- No second queue or scheduler is introduced.

alter table public.appointment_notification_jobs
  alter column recovery_id drop not null;

alter table public.appointment_notification_jobs
  drop constraint if exists appointment_notification_jobs_kind_check,
  add constraint appointment_notification_jobs_kind_check
    check (kind in ('public_booking_confirmation','booking_lifecycle','booking_reminder')),
  drop constraint if exists appointment_notification_jobs_channel_check,
  add constraint appointment_notification_jobs_channel_check
    check (channel in ('email','sms')),
  drop constraint if exists appointment_notification_jobs_provider_check,
  add constraint appointment_notification_jobs_provider_check
    check (provider in ('resend','netgsm','twilio')),
  drop constraint if exists appointment_notification_jobs_event_reason_check,
  add constraint appointment_notification_jobs_event_reason_check
    check (event_reason in ('created','rescheduled','cancelled','reminder'));

alter table public.appointment_notification_jobs
  add column if not exists provider_reference_id text,
  add column if not exists provider_delivery_status text,
  add column if not exists provider_delivery_checked_at timestamptz,
  add column if not exists delivered_at timestamptz;

alter table public.appointment_notification_jobs
  drop constraint if exists appointment_notification_jobs_provider_reference_check,
  add constraint appointment_notification_jobs_provider_reference_check
    check (provider_reference_id is null or char_length(provider_reference_id) between 8 and 200),
  drop constraint if exists appointment_notification_jobs_provider_delivery_status_check,
  add constraint appointment_notification_jobs_provider_delivery_status_check
    check (provider_delivery_status is null or char_length(provider_delivery_status) between 1 and 80);

drop index if exists public.appointment_notification_jobs_delivery_reconcile_idx;
create index appointment_notification_jobs_delivery_reconcile_idx
  on public.appointment_notification_jobs(provider,provider_delivery_checked_at,created_at,id)
  where provider_message_id is not null
    and delivered_at is null
    and (provider_delivery_status is null or provider_delivery_status='waiting')
    and state='sent';

create table if not exists public.appointment_notification_preferences (
  business_id uuid not null references public.businesses(id) on delete cascade,
  group_id uuid not null,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  reminder_minutes_before integer,
  version integer not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id,group_id),
  foreign key (business_id,group_id)
    references public.appointment_groups(business_id,id)
    on delete cascade,
  check (
    reminder_minutes_before is null
    or reminder_minutes_before between 15 and 10080
  )
);

alter table public.appointment_notification_preferences enable row level security;
alter table public.appointment_notification_preferences force row level security;
revoke all on table public.appointment_notification_preferences from public,anon,authenticated;

drop trigger if exists appointment_notification_preferences_touch_updated_at
  on public.appointment_notification_preferences;
create trigger appointment_notification_preferences_touch_updated_at
before update on public.appointment_notification_preferences
for each row execute function public.touch_updated_at();

create or replace function public.f16_group_notification_snapshot(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $f16$
declare
  v_group public.appointment_groups;
  v_summary jsonb;
  v_count integer;
  v_currency text;
  v_min integer;
  v_max integer;
begin
  select * into v_group
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=p_group_id;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  if (
    select count(distinct a.currency_snapshot)
    from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
  ) <> 1 then
    raise exception 'MIXED_CURRENCY';
  end if;

  select
    count(*)::integer,
    min(a.currency_snapshot),
    sum(a.price_min_minor_snapshot)::integer,
    sum(a.price_max_minor_snapshot)::integer,
    jsonb_build_object(
      'groupId',p_group_id,
      'lineCount',count(*)::integer,
      'currency',min(a.currency_snapshot),
      'estimateMinMinor',sum(a.price_min_minor_snapshot)::integer,
      'estimateMaxMinor',sum(a.price_max_minor_snapshot)::integer,
      'lines',jsonb_agg(jsonb_build_object(
        'lineOrdinal',a.line_ordinal,
        'serviceName',a.service_name_snapshot,
        'staffName',a.staff_name_snapshot,
        'startsAt',a.starts_at,
        'endsAt',a.ends_at,
        'priceType',a.price_type_snapshot,
        'priceMinMinor',a.price_min_minor_snapshot,
        'priceMaxMinor',a.price_max_minor_snapshot
      ) order by a.line_ordinal,a.id)
    )
  into v_count,v_currency,v_min,v_max,v_summary
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id;

  if v_count is null or v_count<1 or v_count>10 then
    raise exception 'BOOKING_GROUP_EMPTY';
  end if;
  if v_min<0 or v_max<v_min or v_max>1000000000 then
    raise exception 'NOTIFICATION_GROUP_SNAPSHOT_INVALID';
  end if;
  return v_summary;
end
$f16$;

revoke all on function public.f16_group_notification_snapshot(uuid,uuid)
  from public,anon,authenticated;

create or replace function public.f16_enqueue_group_notification(
  p_business_id uuid,
  p_group_id uuid,
  p_kind text,
  p_event_reason text,
  p_channel text,
  p_available_at timestamptz default null,
  p_group_version integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_group public.appointment_groups;
  v_anchor public.appointments;
  v_business public.businesses;
  v_recovery_id uuid;
  v_recipient text;
  v_event_id uuid:=gen_random_uuid();
  v_event_version integer;
  v_start timestamptz;
  v_retry_until timestamptz;
  v_summary jsonb;
  v_line_count integer;
  v_currency text;
  v_service text;
  v_staff text;
  v_provider text;
  v_reference text;
begin
  if p_kind not in ('booking_lifecycle','booking_reminder') then
    raise exception 'INVALID_NOTIFICATION_KIND';
  end if;
  if p_channel not in ('email','sms') then
    raise exception 'INVALID_NOTIFICATION_CHANNEL';
  end if;
  if (p_kind='booking_reminder' and p_event_reason<>'reminder')
     or (p_kind='booking_lifecycle' and p_event_reason not in ('created','rescheduled','cancelled')) then
    raise exception 'INVALID_NOTIFICATION_EVENT_REASON';
  end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=p_group_id
  for share;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  select * into v_anchor
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id
  order by a.line_ordinal,a.id
  limit 1;
  if v_anchor.id is null then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  select * into v_business
  from public.businesses b
  where b.id=p_business_id;
  if v_business.id is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_recipient:=case
    when p_channel='email' then nullif(btrim(v_anchor.customer_email_snapshot),'')
    else nullif(regexp_replace(coalesce(v_anchor.customer_phone_snapshot,''),'[^0-9+]','','g'),'')
  end;
  if v_recipient is null then return null; end if;
  if p_channel='email' and (char_length(v_recipient)>254 or position('@' in v_recipient)=0) then
    return null;
  end if;
  if p_channel='sms' and char_length(v_recipient) not between 10 and 18 then
    return null;
  end if;

  v_summary:=public.f16_group_notification_snapshot(p_business_id,p_group_id);
  v_line_count:=(v_summary->>'lineCount')::integer;
  v_currency:=v_summary->>'currency';
  select min(a.starts_at)
  into v_start
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id;

  select case when v_line_count=1
      then min(a.service_name_snapshot)
      else v_line_count::text||' hizmet' end,
    case when v_line_count=1
      then min(a.staff_name_snapshot)
      else 'Birden fazla personel' end
  into v_service,v_staff
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id;

  select r.recovery_id into v_recovery_id
  from public.public_booking_recoveries r
  where r.business_id=p_business_id and r.group_id=p_group_id
  order by r.created_at desc
  limit 1;

  select coalesce(max(j.event_version),0)+1
  into v_event_version
  from public.appointment_notification_jobs j
  where j.business_id=p_business_id
    and j.group_id=p_group_id
    and j.kind=p_kind
    and j.channel=p_channel;

  v_provider:=case when p_channel='email' then 'resend' else 'twilio' end;
  v_reference:=case when p_channel='sms'
    then 'kepenk-'||replace(v_event_id::text,'-','')
    else null end;

  if p_kind='booking_reminder' then
    if p_available_at is null or p_available_at>=v_start or v_start<=clock_timestamp() then
      return null;
    end if;
    if p_available_at<=clock_timestamp() then
      return null;
    end if;
    v_retry_until:=v_start;
  else
    v_retry_until:=clock_timestamp()+interval '72 hours';
  end if;

  insert into public.appointment_notification_jobs(
    business_id,appointment_id,recovery_id,group_id,group_version,
    kind,channel,recipient,provider,state,available_at,retry_until,
    provider_idempotency_key,provider_reference_id,
    event_id,event_version,event_reason,template_version,is_current,
    business_name_snapshot,customer_name_snapshot,starts_at_snapshot,timezone_snapshot,
    service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot,
    delivery_certainty,group_summary_snapshot,estimate_min_minor_snapshot,estimate_max_minor_snapshot
  ) values (
    p_business_id,v_anchor.id,v_recovery_id,p_group_id,coalesce(p_group_version,v_group.version),
    p_kind,p_channel,v_recipient,v_provider,'pending',
    coalesce(p_available_at,clock_timestamp()),v_retry_until,
    'f16/'||p_kind||'/'||v_event_id::text,v_reference,
    v_event_id,v_event_version,p_event_reason,3,true,
    v_business.name,v_anchor.customer_name_snapshot,v_start,v_anchor.timezone,
    v_service,v_staff,0,v_currency,
    'unattempted',v_summary,
    (v_summary->>'estimateMinMinor')::integer,
    (v_summary->>'estimateMaxMinor')::integer
  );
  return v_event_id;
end
$f16$;

revoke all on function public.f16_enqueue_group_notification(
  uuid,uuid,text,text,text,timestamptz,integer
) from public,anon,authenticated;

create or replace function public.f16_supersede_current_group_notifications(
  p_business_id uuid,
  p_group_id uuid,
  p_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_count integer;
begin
  update public.appointment_notification_jobs j
  set is_current=false,
      superseded_at=clock_timestamp(),
      superseded_reason=left(coalesce(nullif(btrim(p_reason),''),'superseded'),120),
      state=case when j.state='sent' then j.state else 'failed_terminal' end,
      terminal_at=case when j.state='sent' then j.terminal_at else coalesce(j.terminal_at,clock_timestamp()) end,
      last_error_class=case when j.state='sent' then j.last_error_class else 'stale_notification_event' end,
      lease_token=null,
      lease_expires_at=null,
      updated_at=clock_timestamp()
  where j.business_id=p_business_id
    and j.group_id=p_group_id
    and j.kind in ('booking_lifecycle','booking_reminder')
    and j.is_current;
  get diagnostics v_count=row_count;
  return v_count;
end
$f16$;

revoke all on function public.f16_supersede_current_group_notifications(uuid,uuid,text)
  from public,anon,authenticated;

create or replace function public.f16_emit_group_preference_jobs(
  p_business_id uuid,
  p_group_id uuid,
  p_event_reason text,
  p_refresh_reminder boolean default true,
  p_group_version integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_pref public.appointment_notification_preferences;
  v_start timestamptz;
  v_available timestamptz;
begin
  select * into v_pref
  from public.appointment_notification_preferences p
  where p.business_id=p_business_id and p.group_id=p_group_id;
  if v_pref.group_id is null then return; end if;

  if p_event_reason in ('created','rescheduled','cancelled') then
    if v_pref.email_enabled then
      perform public.f16_enqueue_group_notification(
        p_business_id,p_group_id,'booking_lifecycle',p_event_reason,'email',null,p_group_version
      );
    end if;
    if v_pref.sms_enabled then
      perform public.f16_enqueue_group_notification(
        p_business_id,p_group_id,'booking_lifecycle',p_event_reason,'sms',null,p_group_version
      );
    end if;
  end if;

  if p_refresh_reminder
     and p_event_reason<>'cancelled'
     and v_pref.reminder_minutes_before is not null then
    select min(a.starts_at) into v_start
    from public.appointments a
    where a.business_id=p_business_id
      and a.group_id=p_group_id
      and a.status in ('scheduled','confirmed');
    if v_start is not null then
      v_available:=v_start-make_interval(mins=>v_pref.reminder_minutes_before);
      if v_pref.email_enabled then
        perform public.f16_enqueue_group_notification(
          p_business_id,p_group_id,'booking_reminder','reminder','email',v_available,p_group_version
        );
      end if;
      if v_pref.sms_enabled then
        perform public.f16_enqueue_group_notification(
          p_business_id,p_group_id,'booking_reminder','reminder','sms',v_available,p_group_version
        );
      end if;
    end if;
  end if;
end
$f16$;

revoke all on function public.f16_emit_group_preference_jobs(
  uuid,uuid,text,boolean,integer
) from public,anon,authenticated;

create or replace function public.create_appointment_group_with_notifications(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null,
  p_email_enabled boolean default true,
  p_sms_enabled boolean default false,
  p_reminder_minutes_before integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_payload jsonb;
  v_group_id uuid;
  v_group public.appointment_groups;
  v_pref public.appointment_notification_preferences;
  v_inserted integer;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_email_enabled is null or p_sms_enabled is null then
    raise exception 'INVALID_NOTIFICATION_PREFERENCE';
  end if;
  if p_reminder_minutes_before is not null
     and p_reminder_minutes_before not between 15 and 10080 then
    raise exception 'INVALID_REMINDER_OFFSET';
  end if;

  v_payload:=public.create_appointment_group(
    p_business_id,p_idempotency_key,p_customer_name,p_lines,p_starts_at,
    p_customer_phone,p_customer_email,p_notes
  );
  v_group_id:=(v_payload->>'groupId')::uuid;
  if v_group_id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=v_group_id
  for update;
  if v_group.id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;

  insert into public.appointment_notification_preferences(
    business_id,group_id,email_enabled,sms_enabled,reminder_minutes_before,created_by
  ) values (
    p_business_id,v_group_id,p_email_enabled,p_sms_enabled,p_reminder_minutes_before,auth.uid()
  )
  on conflict (business_id,group_id) do nothing;
  get diagnostics v_inserted=row_count;

  select * into v_pref
  from public.appointment_notification_preferences p
  where p.business_id=p_business_id and p.group_id=v_group_id
  for update;
  if v_pref.group_id is null
     or v_pref.email_enabled is distinct from p_email_enabled
     or v_pref.sms_enabled is distinct from p_sms_enabled
     or v_pref.reminder_minutes_before is distinct from p_reminder_minutes_before then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  if v_inserted=1 then
    perform public.f16_emit_group_preference_jobs(
      p_business_id,v_group_id,'created',true,v_group.version
    );
  end if;
  return v_payload;
end
$f16$;

revoke all on function public.create_appointment_group_with_notifications(
  uuid,text,text,jsonb,timestamptz,text,text,text,boolean,boolean,integer
) from public,anon,authenticated;
grant execute on function public.create_appointment_group_with_notifications(
  uuid,text,text,jsonb,timestamptz,text,text,text,boolean,boolean,integer
) to authenticated;

create or replace function public.get_appointment_notification_preferences(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $f16$
declare
  v_pref public.appointment_notification_preferences;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_pref
  from public.appointment_notification_preferences p
  where p.business_id=p_business_id and p.group_id=p_group_id;
  if v_pref.group_id is null then
    return jsonb_build_object(
      'businessId',p_business_id,'groupId',p_group_id,
      'emailEnabled',false,'smsEnabled',false,'reminderMinutesBefore',null,'version',0
    );
  end if;
  return jsonb_build_object(
    'businessId',v_pref.business_id,'groupId',v_pref.group_id,
    'emailEnabled',v_pref.email_enabled,'smsEnabled',v_pref.sms_enabled,
    'reminderMinutesBefore',v_pref.reminder_minutes_before,'version',v_pref.version
  );
end
$f16$;

revoke all on function public.get_appointment_notification_preferences(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_appointment_notification_preferences(uuid,uuid)
  to authenticated;

create or replace function public.update_appointment_notification_preferences(
  p_business_id uuid,
  p_group_id uuid,
  p_expected_version integer,
  p_email_enabled boolean,
  p_sms_enabled boolean,
  p_reminder_minutes_before integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_pref public.appointment_notification_preferences;
  v_new_version integer;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version<1
     or p_email_enabled is null or p_sms_enabled is null then
    raise exception 'INVALID_NOTIFICATION_PREFERENCE';
  end if;
  if p_reminder_minutes_before is not null
     and p_reminder_minutes_before not between 15 and 10080 then
    raise exception 'INVALID_REMINDER_OFFSET';
  end if;

  select * into v_pref
  from public.appointment_notification_preferences p
  where p.business_id=p_business_id and p.group_id=p_group_id
  for update;
  if v_pref.group_id is null then raise exception 'NOTIFICATION_PREFERENCE_NOT_FOUND'; end if;
  if v_pref.version<>p_expected_version then
    raise exception 'NOTIFICATION_PREFERENCE_VERSION_CONFLICT';
  end if;

  update public.appointment_notification_preferences p
  set email_enabled=p_email_enabled,
      sms_enabled=p_sms_enabled,
      reminder_minutes_before=p_reminder_minutes_before,
      version=p.version+1
  where p.business_id=p_business_id and p.group_id=p_group_id
    and p.version=p_expected_version
  returning p.version into v_new_version;
  if v_new_version is null then raise exception 'NOTIFICATION_PREFERENCE_VERSION_CONFLICT'; end if;

  perform public.f16_supersede_current_group_notifications(
    p_business_id,p_group_id,'notification_preferences_changed'
  );
  perform public.f16_emit_group_preference_jobs(
    p_business_id,p_group_id,'reminder',true,null
  );

  return public.get_appointment_notification_preferences(p_business_id,p_group_id);
end
$f16$;

revoke all on function public.update_appointment_notification_preferences(
  uuid,uuid,integer,boolean,boolean,integer
) from public,anon,authenticated;
grant execute on function public.update_appointment_notification_preferences(
  uuid,uuid,integer,boolean,boolean,integer
) to authenticated;

create or replace function public.f16_reconcile_notification_lifecycle_statement()
returns trigger
language plpgsql
security definer
set search_path=''
as $f16$
declare
  v_row record;
  v_old_active integer;
  v_new_active integer;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_old_timezone text;
  v_new_timezone text;
  v_reason text;
  v_group public.appointment_groups;
begin
  for v_row in
    select distinct coalesce(n.business_id,o.business_id) business_id,
           coalesce(n.group_id,o.group_id) group_id
    from old_rows o
    full join new_rows n on n.id=o.id
    where coalesce(n.group_id,o.group_id) is not null
      and (
        n.starts_at is distinct from o.starts_at
        or n.timezone is distinct from o.timezone
        or n.status is distinct from o.status
      )
  loop
    if not exists (
      select 1 from public.appointment_notification_preferences p
      where p.business_id=v_row.business_id and p.group_id=v_row.group_id
    ) then
      continue;
    end if;

    -- Reconstruct the whole pre-update group. Transition tables contain only
    -- rows touched by this statement; unchanged physical lines are read from
    -- the current table and updated rows are replaced with their OLD image.
    select
      count(*) filter (where x.status in ('scheduled','confirmed'))::integer,
      min(x.starts_at) filter (where x.status in ('scheduled','confirmed')),
      min(x.timezone) filter (where x.status in ('scheduled','confirmed'))
    into v_old_active,v_old_start,v_old_timezone
    from (
      select o.id,o.status,o.starts_at,o.timezone
      from old_rows o
      where o.business_id=v_row.business_id and o.group_id=v_row.group_id
      union all
      select a.id,a.status,a.starts_at,a.timezone
      from public.appointments a
      where a.business_id=v_row.business_id and a.group_id=v_row.group_id
        and not exists (select 1 from new_rows n where n.id=a.id)
    ) x;

    select
      count(*) filter (where a.status in ('scheduled','confirmed'))::integer,
      min(a.starts_at) filter (where a.status in ('scheduled','confirmed')),
      min(a.timezone) filter (where a.status in ('scheduled','confirmed'))
    into v_new_active,v_new_start,v_new_timezone
    from public.appointments a
    where a.business_id=v_row.business_id and a.group_id=v_row.group_id;

    v_reason:=null;
    if coalesce(v_old_active,0)>0 and coalesce(v_new_active,0)=0 then
      v_reason:='cancelled';
    elsif coalesce(v_new_active,0)>0 and (
      v_new_start is distinct from v_old_start
      or v_new_timezone is distinct from v_old_timezone
    ) then
      v_reason:='rescheduled';
    end if;

    if v_reason is not null then
      select * into v_group
      from public.appointment_groups g
      where g.business_id=v_row.business_id and g.id=v_row.group_id;
      perform public.f16_supersede_current_group_notifications(
        v_row.business_id,v_row.group_id,'appointment_'||v_reason
      );
      perform public.f16_emit_group_preference_jobs(
        v_row.business_id,v_row.group_id,v_reason,v_reason<>'cancelled',
        case when v_group.id is null then null else v_group.version+1 end
      );
    end if;
  end loop;
  return null;
end
$f16$;

revoke all on function public.f16_reconcile_notification_lifecycle_statement()
  from public,anon,authenticated;

drop trigger if exists f16_notification_lifecycle_statement on public.appointments;
create trigger f16_notification_lifecycle_statement
after update on public.appointments
referencing old table as old_rows new table as new_rows
for each statement execute function public.f16_reconcile_notification_lifecycle_statement();

create or replace function public.claim_notification_jobs_v3(
  p_dispatch_secret text,
  p_limit integer default 10,
  p_lease_seconds integer default 45
)
returns table(
  job_id uuid,
  lease_token uuid,
  event_id uuid,
  event_version integer,
  event_reason text,
  template_version integer,
  business_id uuid,
  group_id uuid,
  appointment_id uuid,
  recovery_id uuid,
  kind text,
  channel text,
  recipient text,
  provider text,
  provider_idempotency_key text,
  provider_reference_id text,
  attempt_count integer,
  retry_until timestamptz,
  business_name_snapshot text,
  customer_name_snapshot text,
  starts_at_snapshot timestamptz,
  timezone_snapshot text,
  service_name_snapshot text,
  staff_name_snapshot text,
  price_minor_snapshot integer,
  currency_snapshot text,
  sender_snapshot text,
  origin_snapshot text,
  request_fingerprint text,
  first_provider_attempt_at timestamptz,
  provider_idempotency_expires_at timestamptz,
  delivery_certainty text,
  management_token_ciphertext text,
  management_token_iv text,
  key_version smallint
)
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_limit integer;
  v_lease_seconds integer;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  v_limit:=greatest(1,least(coalesce(p_limit,10),50));
  v_lease_seconds:=greatest(15,least(coalesce(p_lease_seconds,45),300));

  update public.appointment_notification_jobs j
  set state='failed_terminal',
      terminal_at=coalesce(j.terminal_at,clock_timestamp()),
      last_error_class='stale_notification_event',
      lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  where not j.is_current and j.state not in ('sent','failed_terminal');

  -- NetGSM has no documented replay/idempotency guarantee for referansID.
  -- If the process dies after the request crosses the send boundary, the lease
  -- may expire while delivery remains ambiguous. Never reclaim that SMS.
  update public.appointment_notification_jobs j
  set state='failed_terminal',
      terminal_at=coalesce(j.terminal_at,clock_timestamp()),
      last_error_class='sms_provider_ambiguous_lease_expired',
      lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  where j.provider in ('netgsm','twilio')
    and j.state='leased'
    and j.lease_expires_at<=clock_timestamp()
    and j.first_provider_attempt_at is not null
    and j.delivery_certainty='ambiguous';

  update public.appointment_notification_jobs j
  set state='failed_terminal',
      terminal_at=coalesce(j.terminal_at,clock_timestamp()),
      last_error_class=coalesce(j.last_error_class,'retry_budget_exhausted'),
      lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  where j.state not in ('sent','failed_terminal')
    and (
      j.retry_until<=clock_timestamp()
      or (j.attempt_count>=j.max_attempts and (j.state<>'leased' or j.lease_expires_at<=clock_timestamp()))
    );

  return query
  with candidates as (
    select j.id
    from public.appointment_notification_jobs j
    where j.is_current
      and j.pii_purged_at is null
      and j.retry_until>clock_timestamp()
      and j.attempt_count<j.max_attempts
      and not (
        j.provider in ('netgsm','twilio')
        and j.first_provider_attempt_at is not null
        and j.delivery_certainty='ambiguous'
      )
      and (
        (j.state in ('pending','retry_wait') and j.available_at<=clock_timestamp())
        or (j.state='leased' and j.lease_expires_at<=clock_timestamp())
      )
    order by j.available_at,j.created_at,j.id
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.appointment_notification_jobs j
    set state='leased',
        attempt_count=j.attempt_count+1,
        lease_token=gen_random_uuid(),
        lease_expires_at=clock_timestamp()+make_interval(secs=>v_lease_seconds),
        last_attempt_at=clock_timestamp(),
        updated_at=clock_timestamp()
    from candidates c
    where j.id=c.id
    returning j.*
  )
  select
    j.id,j.lease_token,j.event_id,j.event_version,j.event_reason,j.template_version,
    j.business_id,j.group_id,j.appointment_id,j.recovery_id,j.kind,j.channel,
    j.recipient,j.provider,j.provider_idempotency_key,j.provider_reference_id,
    j.attempt_count,j.retry_until,
    j.business_name_snapshot,j.customer_name_snapshot,j.starts_at_snapshot,
    j.timezone_snapshot,j.service_name_snapshot,j.staff_name_snapshot,
    j.price_minor_snapshot,j.currency_snapshot,j.sender_snapshot,j.origin_snapshot,
    j.request_fingerprint,j.first_provider_attempt_at,j.provider_idempotency_expires_at,
    j.delivery_certainty,
    r.management_token_ciphertext,r.management_token_iv,r.key_version
  from claimed j
  left join public.public_booking_recoveries r
    on r.recovery_id=j.recovery_id and r.business_id=j.business_id;
end
$f16$;

revoke all on function public.claim_notification_jobs_v3(text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.claim_notification_jobs_v3(text,integer,integer) to anon;

create or replace function public.lock_notification_request_v3(
  p_dispatch_secret text,
  p_job_id uuid,
  p_lease_token uuid,
  p_sender text,
  p_origin text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_job public.appointment_notification_jobs;
  v_group public.appointment_groups;
  v_current_start timestamptz;
  v_current_timezone text;
  v_active integer;
  v_now timestamptz;
  v_send_before timestamptz;
  v_receipt_token uuid;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_sender is null or char_length(btrim(p_sender)) not between 3 and 320 then
    raise exception 'INVALID_NOTIFICATION_SENDER';
  end if;
  if p_origin is null
     or p_origin !~ '^https://[^/@?#[:space:]]+$|^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]+)?$' then
    raise exception 'INVALID_NOTIFICATION_ORIGIN';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_NOTIFICATION_FINGERPRINT';
  end if;

  select * into v_job
  from public.appointment_notification_jobs j
  where j.id=p_job_id and j.state='leased' and j.lease_token=p_lease_token;
  if v_job.id is null then raise exception 'NOTIFICATION_LEASE_LOST'; end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id=v_job.business_id and g.id=v_job.group_id
  for share;
  if v_group.id is null then raise exception 'NOTIFICATION_EVENT_STALE'; end if;

  select
    count(*) filter (where a.status in ('scheduled','confirmed'))::integer,
    min(a.starts_at) filter (where a.status in ('scheduled','confirmed')),
    min(a.timezone) filter (where a.status in ('scheduled','confirmed'))
  into v_active,v_current_start,v_current_timezone
  from public.appointments a
  where a.business_id=v_job.business_id and a.group_id=v_job.group_id;

  select * into v_job
  from public.appointment_notification_jobs j
  where j.id=p_job_id and j.state='leased' and j.lease_token=p_lease_token
  for update;
  if v_job.id is null or not v_job.is_current then
    raise exception 'NOTIFICATION_EVENT_STALE';
  end if;

  if v_job.event_reason='cancelled' then
    if coalesce(v_active,0)<>0 then raise exception 'NOTIFICATION_EVENT_STALE'; end if;
  else
    if coalesce(v_active,0)=0
       or v_current_start is distinct from v_job.starts_at_snapshot
       or v_current_timezone is distinct from v_job.timezone_snapshot then
      raise exception 'NOTIFICATION_EVENT_STALE';
    end if;
    if v_job.event_reason='reminder' and v_job.starts_at_snapshot<=clock_timestamp() then
      raise exception 'NOTIFICATION_EVENT_STALE';
    end if;
  end if;

  v_now:=clock_timestamp();
  if v_job.lease_expires_at is null or v_job.lease_expires_at<=v_now then
    raise exception 'NOTIFICATION_LEASE_EXPIRED';
  end if;
  if v_job.retry_until<=v_now then raise exception 'NOTIFICATION_RETRY_EXPIRED'; end if;

  v_send_before:=least(v_job.lease_expires_at,v_job.retry_until)-interval '11 seconds';
  if v_send_before<=v_now then raise exception 'NOTIFICATION_SEND_BUDGET_EXHAUSTED'; end if;

  if v_job.request_fingerprint is null then
    if v_job.first_provider_attempt_at is not null or v_job.delivery_certainty<>'unattempted' then
      raise exception 'NOTIFICATION_REQUEST_UNVERIFIABLE';
    end if;
  elsif v_job.request_fingerprint<>p_request_fingerprint
     or v_job.sender_snapshot<>btrim(p_sender)
     or v_job.origin_snapshot<>p_origin then
    raise exception 'NOTIFICATION_REQUEST_MISMATCH';
  end if;

  v_receipt_token:=coalesce(v_job.receipt_token,gen_random_uuid());
  update public.appointment_notification_jobs
  set sender_snapshot=btrim(p_sender),
      origin_snapshot=p_origin,
      request_fingerprint=p_request_fingerprint,
      request_locked_at=coalesce(request_locked_at,v_now),
      first_provider_attempt_at=coalesce(first_provider_attempt_at,v_now),
      provider_idempotency_expires_at=case
        when provider='resend' then coalesce(provider_idempotency_expires_at,v_now+interval '24 hours')
        else provider_idempotency_expires_at end,
      has_ambiguous_history=has_ambiguous_history or (
        first_provider_attempt_at is not null and delivery_certainty='ambiguous'
      ),
      delivery_certainty='ambiguous',
      receipt_token=v_receipt_token,
      updated_at=v_now
  where id=p_job_id;

  return jsonb_build_object(
    'server_time',v_now,'send_before',v_send_before,'receipt_token',v_receipt_token
  );
end
$f16$;

revoke all on function public.lock_notification_request_v3(text,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.lock_notification_request_v3(text,uuid,uuid,text,text,text)
  to anon;

create or replace function public.claim_notification_delivery_checks(
  p_dispatch_secret text,
  p_limit integer default 50
)
returns table(
  provider text,
  provider_message_id text,
  provider_reference_id text
)
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_limit integer;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  v_limit:=greatest(1,least(coalesce(p_limit,50),50));

  return query
  with candidates as (
    select j.id
    from public.appointment_notification_jobs j
    where j.provider in ('netgsm','twilio')
      and j.state='sent'
      and j.provider_message_id is not null
      and j.delivered_at is null
      and (j.provider_delivery_status is null or j.provider_delivery_status='waiting')
      and (j.provider_delivery_checked_at is null
           or j.provider_delivery_checked_at<=clock_timestamp()-interval '60 seconds')
      and j.created_at>=clock_timestamp()-interval '3 months'
    order by j.provider_delivery_checked_at nulls first,j.created_at,j.id
    for update skip locked
    limit v_limit
  ), marked as (
    update public.appointment_notification_jobs j
    set provider_delivery_checked_at=clock_timestamp(),
        updated_at=clock_timestamp()
    from candidates c
    where j.id=c.id
    returning j.provider,j.provider_message_id,j.provider_reference_id
  )
  select m.provider,m.provider_message_id,m.provider_reference_id
  from marked m;
end
$f16$;

revoke all on function public.claim_notification_delivery_checks(text,integer)
  from public,anon,authenticated;
grant execute on function public.claim_notification_delivery_checks(text,integer)
  to anon;

create or replace function public.record_notification_delivery_status(
  p_dispatch_secret text,
  p_provider text,
  p_provider_message_id text,
  p_status text,
  p_delivered boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $f16$
declare
  v_updated integer;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  if p_provider not in ('resend','netgsm','twilio')
     or p_provider_message_id is null
     or char_length(p_provider_message_id) not between 1 and 200
     or p_status is null or char_length(p_status) not between 1 and 80 then
    raise exception 'INVALID_NOTIFICATION_DELIVERY_RECEIPT';
  end if;

  update public.appointment_notification_jobs j
  set provider_delivery_status=p_status,
      provider_delivery_checked_at=clock_timestamp(),
      delivered_at=case when p_delivered then coalesce(j.delivered_at,clock_timestamp()) else j.delivered_at end,
      updated_at=clock_timestamp()
  where j.provider=p_provider
    and j.provider_message_id=p_provider_message_id
    and j.state='sent';
  get diagnostics v_updated=row_count;
  return v_updated=1;
end
$f16$;

revoke all on function public.record_notification_delivery_status(text,text,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.record_notification_delivery_status(text,text,text,text,boolean)
  to anon;

commit;
