begin;

-- F11-02 notification repair. A one-line range-priced reservation cannot use
-- the scalar-price legacy template, and every frozen group render input follows
-- the same terminal retention boundary as the original notification snapshot.

create or replace function public.create_public_booking_confirmation_event(
  p_business_id uuid,
  p_appointment_id uuid,
  p_recovery_id uuid,
  p_event_reason text default 'created'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_business public.businesses;
  v_recovery public.public_booking_recoveries;
  v_email text;
  v_event_id uuid := gen_random_uuid();
  v_event_version integer;
  v_line_count integer;
  v_has_range_price boolean;
  v_summary jsonb;
  v_estimate_min integer;
  v_estimate_max integer;
  v_currency text;
  v_service_label text;
  v_staff_label text;
  v_template integer;
begin
  if p_event_reason not in ('created','rescheduled') then
    raise exception 'INVALID_NOTIFICATION_EVENT_REASON';
  end if;

  select * into v_appointment
  from public.appointments a
  where a.business_id=p_business_id and a.id=p_appointment_id and a.source='public'
  for share;
  if v_appointment.id is null then raise exception 'NOTIFICATION_APPOINTMENT_NOT_FOUND'; end if;
  if v_appointment.status not in ('scheduled','confirmed') then
    raise exception 'NOTIFICATION_APPOINTMENT_NOT_ACTIVE';
  end if;

  select * into v_business from public.businesses b where b.id=p_business_id;
  select * into v_recovery
  from public.public_booking_recoveries r
  where r.recovery_id=p_recovery_id and r.business_id=p_business_id
    and r.group_id=v_appointment.group_id
  for share;

  v_email := nullif(btrim(v_appointment.customer_email_snapshot),'');
  if v_business.id is null or v_recovery.recovery_id is null or v_email is null then
    return null;
  end if;

  select count(*)::integer,
         coalesce(bool_or(a.price_type_snapshot='range'),false),
         sum(a.price_min_minor_snapshot)::integer,
         sum(a.price_max_minor_snapshot)::integer,
         min(a.currency_snapshot)
  into v_line_count,v_has_range_price,v_estimate_min,v_estimate_max,v_currency
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=v_appointment.group_id
    and a.status <> 'cancelled';

  -- Template 1 has one definitive scalar amount. Any group with multiple lines
  -- or a range-priced line uses the typed summary, including a one-line group.
  if v_line_count > 1 or v_has_range_price then
    if (select count(distinct a.currency_snapshot)
        from public.appointments a
        where a.business_id=p_business_id and a.group_id=v_appointment.group_id
          and a.status <> 'cancelled') <> 1 then
      raise exception 'MIXED_CURRENCY';
    end if;

    select jsonb_build_object(
      'groupId',v_appointment.group_id,
      'lineCount',v_line_count,
      'currency',v_currency,
      'estimateMinMinor',v_estimate_min,
      'estimateMaxMinor',v_estimate_max,
      'lines',jsonb_agg(jsonb_build_object(
        'lineOrdinal',a.line_ordinal,
        'serviceName',a.service_name_snapshot,
        'staffName',a.staff_name_snapshot,
        'startsAt',a.starts_at,
        'endsAt',a.ends_at,
        'priceType',a.price_type_snapshot,
        'priceMinMinor',a.price_min_minor_snapshot,
        'priceMaxMinor',a.price_max_minor_snapshot
      ) order by a.line_ordinal)
    )
    into v_summary
    from public.appointments a
    where a.business_id=p_business_id and a.group_id=v_appointment.group_id
      and a.status <> 'cancelled';

    v_service_label := v_line_count::text || ' hizmet';
    v_staff_label := case
      when v_line_count=1 then v_appointment.staff_name_snapshot
      else 'Birden fazla personel'
    end;
    v_template := 2;
  else
    v_summary := null;
    v_estimate_min := null;
    v_estimate_max := null;
    v_service_label := v_appointment.service_name_snapshot;
    v_staff_label := v_appointment.staff_name_snapshot;
    v_template := 1;
  end if;

  select coalesce(max(j.event_version),0)+1
  into v_event_version
  from public.appointment_notification_jobs j
  where j.group_id=v_appointment.group_id
    and j.kind='public_booking_confirmation'
    and j.channel='email';

  insert into public.appointment_notification_jobs(
    business_id,appointment_id,recovery_id,kind,channel,recipient,provider,state,
    available_at,retry_until,provider_idempotency_key,
    event_id,event_version,event_reason,template_version,is_current,
    business_name_snapshot,customer_name_snapshot,starts_at_snapshot,timezone_snapshot,
    service_name_snapshot,staff_name_snapshot,price_minor_snapshot,currency_snapshot,
    delivery_certainty,group_summary_snapshot,estimate_min_minor_snapshot,estimate_max_minor_snapshot
  ) values (
    p_business_id,p_appointment_id,p_recovery_id,
    'public_booking_confirmation','email',v_email,'resend','pending',
    now(),least(v_recovery.expires_at,now()+interval '72 hours'),
    'public-booking-confirmation/'||v_event_id::text,
    v_event_id,v_event_version,p_event_reason,v_template,true,
    v_business.name,v_appointment.customer_name_snapshot,
    (select min(a.starts_at) from public.appointments a
      where a.business_id=p_business_id and a.group_id=v_appointment.group_id and a.status<>'cancelled'),
    v_appointment.timezone,
    v_service_label,v_staff_label,
    case when v_template=1 then v_appointment.price_minor_snapshot else 0 end,
    coalesce(v_currency,v_appointment.currency_snapshot),
    'unattempted',v_summary,v_estimate_min,v_estimate_max
  );

  return v_event_id;
end
$$;

revoke all on function public.create_public_booking_confirmation_event(uuid,uuid,uuid,text)
  from public, anon, authenticated;

-- A previous deployment could have marked a row purged before these later
-- columns existed. Finish that scrub before installing the expanded invariant;
-- durable event, provider and idempotency evidence remains untouched.
update public.appointment_notification_jobs
set group_summary_snapshot=null,
    estimate_min_minor_snapshot=null,
    estimate_max_minor_snapshot=null
where pii_purged_at is not null
  and (group_summary_snapshot is not null
    or estimate_min_minor_snapshot is not null
    or estimate_max_minor_snapshot is not null);

alter table public.appointment_notification_jobs
  drop constraint if exists appointment_notification_jobs_pii_retention_check;

alter table public.appointment_notification_jobs
  add constraint appointment_notification_jobs_pii_retention_check
  check (
    (
      pii_purged_at is null
      and recipient is not null
      and business_name_snapshot is not null
      and customer_name_snapshot is not null
      and starts_at_snapshot is not null
      and timezone_snapshot is not null
      and service_name_snapshot is not null
      and staff_name_snapshot is not null
      and price_minor_snapshot is not null
      and currency_snapshot is not null
    )
    or
    (
      pii_purged_at is not null
      and state in ('sent','failed_terminal')
      and recipient is null
      and business_name_snapshot is null
      and customer_name_snapshot is null
      and starts_at_snapshot is null
      and timezone_snapshot is null
      and service_name_snapshot is null
      and staff_name_snapshot is null
      and price_minor_snapshot is null
      and currency_snapshot is null
      and group_summary_snapshot is null
      and estimate_min_minor_snapshot is null
      and estimate_max_minor_snapshot is null
    )
  );

create or replace function public.maintain_notification_jobs(p_dispatch_secret text)
returns table(terminalized integer, recovery_material_cleaned integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_terminalized integer := 0;
  v_cleaned integer := 0;
  v_pii_cutoff timestamptz := clock_timestamp() - interval '30 days';
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;

  update public.appointment_notification_jobs j
  set state = 'failed_terminal',
      terminal_at = coalesce(j.terminal_at, now()),
      last_error_class = case
        when not j.is_current then 'stale_notification_event'
        when j.delivery_certainty = 'ambiguous'
          and j.provider_idempotency_expires_at <= now()
          then 'idempotency_window_expired_ambiguous'
        else coalesce(j.last_error_class, 'retry_budget_exhausted')
      end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where j.state not in ('sent','failed_terminal')
    and (
      not j.is_current
      or (j.delivery_certainty = 'ambiguous' and j.provider_idempotency_expires_at <= now())
      or j.retry_until <= now()
      or (j.attempt_count >= j.max_attempts and (j.state <> 'leased' or j.lease_expires_at <= now()))
    );
  get diagnostics v_count = row_count;
  v_terminalized := v_terminalized + v_count;

  with stale as (
    select j.id
    from public.appointment_notification_jobs j
    where j.pii_purged_at is null
      and (
        (j.state = 'sent' and j.sent_at is not null and j.sent_at <= v_pii_cutoff)
        or
        (j.state = 'failed_terminal' and j.terminal_at is not null and j.terminal_at <= v_pii_cutoff)
      )
    order by
      case when j.state = 'sent' then j.sent_at else j.terminal_at end,
      j.id
    limit 500
    for update skip locked
  )
  update public.appointment_notification_jobs j
  set recipient = null,
      business_name_snapshot = null,
      customer_name_snapshot = null,
      starts_at_snapshot = null,
      timezone_snapshot = null,
      service_name_snapshot = null,
      staff_name_snapshot = null,
      price_minor_snapshot = null,
      currency_snapshot = null,
      group_summary_snapshot = null,
      estimate_min_minor_snapshot = null,
      estimate_max_minor_snapshot = null,
      pii_purged_at = clock_timestamp(),
      updated_at = clock_timestamp()
  from stale
  where j.id = stale.id;

  update public.public_booking_recoveries r
  set recovery_secret_hash = null,
      management_token_ciphertext = null,
      management_token_iv = null
  where r.expires_at <= now()
    and (
      r.recovery_secret_hash is not null
      or r.management_token_ciphertext is not null
      or r.management_token_iv is not null
    )
    and not exists (
      select 1
      from public.appointment_notification_jobs j
      where j.recovery_id = r.recovery_id
        and j.state not in ('sent','failed_terminal')
    );
  get diagnostics v_cleaned = row_count;

  begin
    perform public.prune_public_booking_resolution_closures();
  exception when others then null;
  end;

  return query select v_terminalized, v_cleaned;
end
$$;

revoke all on function public.maintain_notification_jobs(text)
  from public, anon, authenticated;
grant execute on function public.maintain_notification_jobs(text) to anon;

create or replace function public.get_notification_group_snapshot(
  p_dispatch_secret text,
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job public.appointment_notification_jobs;
begin
  if not public.notification_dispatch_authorized(p_dispatch_secret) then
    raise exception 'NOTIFICATION_DISPATCH_UNAUTHORIZED';
  end if;
  select * into v_job
  from public.appointment_notification_jobs j
  where j.id=p_job_id;
  if v_job.id is null
     or v_job.pii_purged_at is not null
     or v_job.template_version <> 2
     or v_job.group_summary_snapshot is null then
    raise exception 'NOTIFICATION_GROUP_SNAPSHOT_NOT_FOUND';
  end if;
  return v_job.group_summary_snapshot;
end
$$;

revoke all on function public.get_notification_group_snapshot(text,uuid)
  from public, anon, authenticated;
grant execute on function public.get_notification_group_snapshot(text,uuid) to anon;

commit;
