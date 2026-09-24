begin;

-- F16-01: bounded recurring appointment series.
-- The series owns cadence/version/audit identity. Physical occurrences remain the
-- canonical F11 appointment_groups and keep all existing availability, snapshot
-- and lifecycle semantics.

create table if not exists public.appointment_series (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  frequency text not null check (frequency in ('daily','weekly')),
  occurrence_count smallint not null check (occurrence_count between 2 and 12),
  timezone text not null,
  anchor_starts_at timestamptz not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('active','cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_series_business_id_key unique (business_id,id),
  constraint appointment_series_customer_fk
    foreign key (business_id,customer_id)
    references public.customers(business_id,id)
);

alter table public.appointment_series enable row level security;
alter table public.appointment_series force row level security;
revoke all on table public.appointment_series from public,anon,authenticated;

drop trigger if exists appointment_series_touch_updated_at on public.appointment_series;
create trigger appointment_series_touch_updated_at
before update on public.appointment_series
for each row execute function public.touch_updated_at();

alter table public.appointment_groups
  add column if not exists series_id uuid,
  add column if not exists series_ordinal smallint;

alter table public.appointment_groups
  drop constraint if exists appointment_groups_series_pair_check,
  add constraint appointment_groups_series_pair_check check (
    (series_id is null and series_ordinal is null)
    or (series_id is not null and series_ordinal between 1 and 12)
  ),
  drop constraint if exists appointment_groups_series_fk,
  add constraint appointment_groups_series_fk
    foreign key (business_id,series_id)
    references public.appointment_series(business_id,id)
    deferrable initially deferred;

create unique index if not exists appointment_groups_business_series_ordinal_key
  on public.appointment_groups(business_id,series_id,series_ordinal)
  where series_id is not null;

create index if not exists appointment_groups_business_series_idx
  on public.appointment_groups(business_id,series_id,series_ordinal)
  where series_id is not null;

create table if not exists public.appointment_series_commands (
  business_id uuid not null references public.businesses(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  command text not null check (command in ('create_series','reschedule_future','cancel_future')),
  request_hash text not null,
  series_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (business_id,idempotency_key),
  constraint appointment_series_commands_series_fk
    foreign key (business_id,series_id)
    references public.appointment_series(business_id,id)
    deferrable initially deferred
);

alter table public.appointment_series_commands enable row level security;
alter table public.appointment_series_commands force row level security;
revoke all on table public.appointment_series_commands from public,anon,authenticated;

create table if not exists public.appointment_series_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  series_id uuid not null,
  series_version integer not null check (series_version > 0),
  event_type text not null check (event_type in ('created','future_rescheduled','future_cancelled')),
  actor_user_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint appointment_series_events_series_fk
    foreign key (business_id,series_id)
    references public.appointment_series(business_id,id)
    deferrable initially deferred
);

create index if not exists appointment_series_events_business_series_idx
  on public.appointment_series_events(business_id,series_id,series_version,created_at,id);

alter table public.appointment_series_events enable row level security;
alter table public.appointment_series_events force row level security;
revoke all on table public.appointment_series_events from public,anon,authenticated;

create or replace function public.f16_series_limit()
returns integer
language sql
immutable
set search_path=''
as $f16$ select 12 $f16$;

revoke all on function public.f16_series_limit() from public,anon,authenticated;

create or replace function public.f16_series_candidates(
  p_business_id uuid,
  p_starts_at timestamptz,
  p_frequency text,
  p_count integer
)
returns table(
  occurrence_ordinal integer,
  starts_at timestamptz,
  local_date date,
  local_time time without time zone
)
language plpgsql
stable
security definer
set search_path=''
as $f16$
declare
  v_timezone text;
  v_step interval;
  v_upper timestamptz;
  v_anchor_time time without time zone;
  v_today date;
  v_seen integer := 0;
  v_row record;
begin
  if p_starts_at is null then raise exception 'INVALID_SERIES_START'; end if;
  if p_frequency not in ('daily','weekly') then raise exception 'INVALID_SERIES_FREQUENCY'; end if;
  if p_count is null or p_count < 2 or p_count > public.f16_series_limit() then
    raise exception 'SERIES_LIMIT_EXCEEDED';
  end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_step := case when p_frequency='daily' then interval '1 day' else interval '1 week' end;
  v_upper := p_starts_at + make_interval(days => case
    when p_frequency='daily' then p_count+1 else (p_count+1)*7 end);
  v_anchor_time := (p_starts_at at time zone v_timezone)::time;
  v_today := (statement_timestamp() at time zone v_timezone)::date;

  for v_row in
    select gs,ord::integer as ord
    from pg_catalog.generate_series(
      p_starts_at,v_upper,v_step,v_timezone
    ) with ordinality as s(gs,ord)
    where ord <= p_count
    order by ord
  loop
    v_seen := v_seen+1;
    if (v_row.gs at time zone v_timezone)::time <> v_anchor_time then
      raise exception 'SERIES_LOCAL_TIME_UNAVAILABLE:%',
        (v_row.gs at time zone v_timezone)::date;
    end if;
    if (v_row.gs at time zone v_timezone)::date < v_today
       or (v_row.gs at time zone v_timezone)::date > v_today+366 then
      raise exception 'DATE_OUT_OF_RANGE';
    end if;
    occurrence_ordinal := v_row.ord;
    starts_at := v_row.gs;
    local_date := (v_row.gs at time zone v_timezone)::date;
    local_time := (v_row.gs at time zone v_timezone)::time;
    return next;
  end loop;

  if v_seen <> p_count then raise exception 'SERIES_CANDIDATE_COUNT_MISMATCH'; end if;
end
$f16$;

revoke all on function public.f16_series_candidates(uuid,timestamptz,text,integer)
  from public,anon,authenticated;

create or replace function public.f16_claim_series_command(
  p_business_id uuid,
  p_idempotency_key text,
  p_command text,
  p_request_hash text
)
returns table(is_new boolean,series_id uuid)
language plpgsql
security definer
set search_path=''
as $f16$
declare
  v_inserted integer;
  v_existing public.appointment_series_commands;
begin
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<8
     or char_length(p_idempotency_key)>128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_command not in ('create_series','reschedule_future','cancel_future') then
    raise exception 'INVALID_SERIES_COMMAND';
  end if;

  insert into public.appointment_series_commands(
    business_id,idempotency_key,command,request_hash,series_id,created_by
  ) values (
    p_business_id,p_idempotency_key,p_command,p_request_hash,null,auth.uid()
  )
  on conflict (business_id,idempotency_key) do nothing;

  get diagnostics v_inserted=row_count;
  if v_inserted=1 then
    return query select true,null::uuid;
    return;
  end if;

  select * into v_existing
  from public.appointment_series_commands c
  where c.business_id=p_business_id
    and c.idempotency_key=p_idempotency_key
  for update;

  if v_existing.command<>p_command or v_existing.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.series_id is null then raise exception 'IDEMPOTENCY_IN_PROGRESS'; end if;

  return query select false,v_existing.series_id;
end
$f16$;

revoke all on function public.f16_claim_series_command(uuid,text,text,text)
  from public,anon,authenticated;

-- Extend the canonical F11 management projection without changing its existing
-- fields. Consumers that do not know F16 simply ignore the additive keys.
create or replace function public.f11_group_management_payload(
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
  v_payload jsonb;
  v_line_count integer;
  v_active_count integer;
  v_bad_reschedule_count integer;
  v_bad_cancel_count integer;
begin
  select * into v_group
  from public.appointment_groups g
  where g.business_id=p_business_id and g.id=p_group_id;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  select
    count(*)::integer,
    count(*) filter (where a.status in ('scheduled','confirmed'))::integer,
    count(*) filter (where a.status not in ('scheduled','confirmed'))::integer,
    count(*) filter (where a.status not in ('scheduled','confirmed','cancelled'))::integer
  into v_line_count,v_active_count,v_bad_reschedule_count,v_bad_cancel_count
  from public.appointments a
  where a.business_id=p_business_id and a.group_id=p_group_id;

  if v_line_count<1 then raise exception 'BOOKING_GROUP_EMPTY'; end if;

  v_payload:=public.f11_group_payload(p_business_id,p_group_id);
  if v_payload is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  return v_payload || jsonb_build_object(
    'legacyAppointmentId',v_group.legacy_appointment_id,
    'managementMode',case when v_group.legacy_appointment_id is not null then 'legacy_single' else 'group' end,
    'lineCount',v_line_count,
    'canRescheduleGroup',
      v_group.legacy_appointment_id is null
      and v_bad_reschedule_count=0
      and v_active_count=v_line_count,
    'canCancelGroup',
      v_group.legacy_appointment_id is null
      and v_bad_cancel_count=0
      and v_active_count>0,
    'seriesId',v_group.series_id,
    'seriesOrdinal',v_group.series_ordinal
  );
end
$f16$;

revoke all on function public.f11_group_management_payload(uuid,uuid)
  from public,anon,authenticated;

create or replace function public.f16_series_payload(
  p_business_id uuid,
  p_series_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $f16$
declare
  v_series public.appointment_series;
  v_occurrences jsonb;
  v_events jsonb;
begin
  select * into v_series
  from public.appointment_series s
  where s.business_id=p_business_id and s.id=p_series_id;
  if v_series.id is null then raise exception 'APPOINTMENT_SERIES_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(
    public.f11_group_management_payload(g.business_id,g.id)
    order by g.series_ordinal
  ),'[]'::jsonb)
  into v_occurrences
  from public.appointment_groups g
  where g.business_id=p_business_id and g.series_id=p_series_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId',e.id,
    'seriesVersion',e.series_version,
    'eventType',e.event_type,
    'payload',e.payload,
    'createdAt',e.created_at
  ) order by e.created_at,e.id),'[]'::jsonb)
  into v_events
  from public.appointment_series_events e
  where e.business_id=p_business_id and e.series_id=p_series_id;

  return jsonb_build_object(
    'seriesId',v_series.id,
    'businessId',v_series.business_id,
    'customerId',v_series.customer_id,
    'frequency',v_series.frequency,
    'occurrenceCount',v_series.occurrence_count,
    'timezone',v_series.timezone,
    'anchorStartsAt',v_series.anchor_starts_at,
    'version',v_series.version,
    'status',v_series.status,
    'occurrences',v_occurrences,
    'events',v_events
  );
end
$f16$;

revoke all on function public.f16_series_payload(uuid,uuid)
  from public,anon,authenticated;

create or replace function public.preview_appointment_series(
  p_business_id uuid,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_frequency text,
  p_count integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='5s'
as $f16$
declare
  v_timezone text;
  v_candidate record;
  v_plan jsonb;
  v_items jsonb:='[]'::jsonb;
  v_all_available boolean:=true;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Validate lines once up front with the canonical F11 contract.
  perform count(*) from public.f11_group_line_defs(p_business_id,p_lines);

  select b.timezone into v_timezone
  from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  for v_candidate in
    select * from public.f16_series_candidates(
      p_business_id,p_starts_at,p_frequency,p_count
    )
  loop
    v_plan:=public.f11_plan_group_at(p_business_id,p_lines,v_candidate.starts_at,null);
    if v_plan is null then v_all_available:=false; end if;
    v_items:=v_items || jsonb_build_array(jsonb_build_object(
      'ordinal',v_candidate.occurrence_ordinal,
      'startsAt',v_candidate.starts_at,
      'localDate',v_candidate.local_date,
      'localTime',v_candidate.local_time,
      'available',v_plan is not null,
      'plan',v_plan
    ));
  end loop;

  return jsonb_build_object(
    'frequency',p_frequency,
    'occurrenceCount',p_count,
    'timezone',v_timezone,
    'allAvailable',v_all_available,
    'occurrences',v_items
  );
end
$f16$;

revoke all on function public.preview_appointment_series(uuid,jsonb,timestamptz,text,integer)
  from public,anon,authenticated;
grant execute on function public.preview_appointment_series(uuid,jsonb,timestamptz,text,integer)
  to authenticated;

create or replace function public.create_appointment_series(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_frequency text,
  p_count integer,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='10s'
as $f16$
declare
  v_customer_name text:=btrim(p_customer_name);
  v_customer_phone text:=nullif(btrim(p_customer_phone),'');
  v_customer_email text:=public.f10_normalize_customer_email(coalesce(p_customer_email,''));
  v_notes text:=nullif(btrim(p_notes),'');
  v_hash text;
  v_claim record;
  v_customer_id uuid;
  v_timezone text;
  v_series_id uuid;
  v_candidate record;
  v_group jsonb;
  v_group_id uuid;
  v_group_ids jsonb:='[]'::jsonb;
  v_inner_key text;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;

  if char_length(v_customer_name)<2 or char_length(v_customer_name)>120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone)>40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_customer_email is not null
     and (char_length(v_customer_email)>254 or position('@' in v_customer_email)<2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_notes is not null and char_length(v_notes)>1000 then raise exception 'NOTES_TOO_LONG'; end if;

  -- Candidate generation validates frequency/count/date range and local-time
  -- stability before any durable series evidence is inserted.
  perform count(*) from public.f16_series_candidates(
    p_business_id,p_starts_at,p_frequency,p_count
  );

  v_hash:=md5(jsonb_build_object(
    'customerName',v_customer_name,
    'customerPhone',v_customer_phone,
    'customerEmail',v_customer_email,
    'lines',p_lines,
    'startsAt',p_starts_at,
    'frequency',p_frequency,
    'count',p_count,
    'notes',v_notes
  )::text);

  select * into v_claim
  from public.f16_claim_series_command(
    p_business_id,p_idempotency_key,'create_series',v_hash
  );

  if not v_claim.is_new then
    return public.f16_series_payload(p_business_id,v_claim.series_id);
  end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_customer_id:=public.f10_resolve_or_create_customer(
    p_business_id,v_customer_name,v_customer_phone,v_customer_email,
    null,auth.uid(),true
  );

  v_series_id:=gen_random_uuid();
  insert into public.appointment_series(
    id,business_id,customer_id,frequency,occurrence_count,timezone,
    anchor_starts_at,version,status,created_by
  ) values (
    v_series_id,p_business_id,v_customer_id,p_frequency,p_count,v_timezone,
    p_starts_at,1,'active',auth.uid()
  );

  -- One function call is one database transaction. Existing F11 group creation
  -- remains the physical booking authority for each occurrence. If any one
  -- occurrence conflicts, its exception rolls back the header, prior groups,
  -- commands, events and customer writes from the whole series.
  for v_candidate in
    select * from public.f16_series_candidates(
      p_business_id,p_starts_at,p_frequency,p_count
    )
  loop
    v_inner_key:='f16c:'||md5(p_idempotency_key)||':'||lpad(v_candidate.occurrence_ordinal::text,2,'0');
    begin
      v_group:=public.create_appointment_group(
        p_business_id,v_inner_key,v_customer_name,p_lines,v_candidate.starts_at,
        v_customer_phone,v_customer_email,v_notes
      );
    exception when others then
      if sqlerrm like '%GROUP_SLOT_UNAVAILABLE%'
         or sqlerrm like '%APPOINTMENT_CONFLICT%' then
        raise exception 'SERIES_OCCURRENCE_UNAVAILABLE:%:%',
          v_candidate.occurrence_ordinal,v_candidate.local_date;
      end if;
      raise;
    end;

    v_group_id:=(v_group->>'groupId')::uuid;
    update public.appointment_groups g
    set series_id=v_series_id,
        series_ordinal=v_candidate.occurrence_ordinal
    where g.business_id=p_business_id and g.id=v_group_id;

    v_group_ids:=v_group_ids || jsonb_build_array(jsonb_build_object(
      'ordinal',v_candidate.occurrence_ordinal,
      'groupId',v_group_id,
      'startsAt',v_candidate.starts_at
    ));
  end loop;

  insert into public.appointment_series_events(
    business_id,series_id,series_version,event_type,actor_user_id,payload
  ) values (
    p_business_id,v_series_id,1,'created',auth.uid(),
    jsonb_build_object(
      'frequency',p_frequency,
      'occurrenceCount',p_count,
      'anchorStartsAt',p_starts_at,
      'occurrences',v_group_ids
    )
  );

  update public.appointment_series_commands c
  set series_id=v_series_id
  where c.business_id=p_business_id and c.idempotency_key=p_idempotency_key;

  return public.f16_series_payload(p_business_id,v_series_id);
end
$f16$;

revoke all on function public.create_appointment_series(
  uuid,text,text,jsonb,timestamptz,text,integer,text,text,text
) from public,anon,authenticated;
grant execute on function public.create_appointment_series(
  uuid,text,text,jsonb,timestamptz,text,integer,text,text,text
) to authenticated;

create or replace function public.get_appointment_series(
  p_business_id uuid,
  p_series_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='5s'
as $f16$
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  return public.f16_series_payload(p_business_id,p_series_id);
end
$f16$;

revoke all on function public.get_appointment_series(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_appointment_series(uuid,uuid)
  to authenticated;

commit;
