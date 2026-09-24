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


-- ---------------------------------------------------------------------------
-- Future-scope helpers.
-- The F11 single-group lifecycle remains canonical. These helpers only define
-- the bounded target set and a planner that can ignore the other groups that
-- are moving in the same outer transaction.
-- ---------------------------------------------------------------------------
create or replace function public.f16_staff_slot_free_many(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_date date,
  p_occupied_start timestamptz,
  p_occupied_end timestamptz,
  p_ignore_group_ids uuid[] default '{}'::uuid[]
)
returns boolean
language sql
stable
security definer
set search_path=''
as $f16$
  select
    exists (
      select 1
      from public.staff_profiles sp
      join public.staff_services ss
        on ss.business_id=sp.business_id
       and ss.staff_id=sp.id
       and ss.service_id=p_service_id
       and ss.active
      join public.businesses b on b.id=sp.business_id
      join public.business_hours bh
        on bh.business_id=sp.business_id
       and bh.weekday=extract(dow from p_date)::smallint
       and bh.active
      join public.staff_hours sh
        on sh.business_id=sp.business_id
       and sh.staff_id=sp.id
       and sh.weekday=extract(dow from p_date)::smallint
       and sh.active
      where sp.business_id=p_business_id
        and sp.id=p_staff_id
        and sp.active
        and greatest(bh.starts_local,sh.starts_local) < least(bh.ends_local,sh.ends_local)
        and (p_date+greatest(bh.starts_local,sh.starts_local)) at time zone b.timezone <= p_occupied_start
        and (p_date+least(bh.ends_local,sh.ends_local)) at time zone b.timezone >= p_occupied_end
    )
    and not exists (
      select 1
      from public.availability_blocks ab
      where ab.business_id=p_business_id
        and ab.active
        and (ab.staff_id is null or ab.staff_id=p_staff_id)
        and ab.starts_at<p_occupied_end
        and ab.ends_at>p_occupied_start
    )
    and not exists (
      select 1
      from public.appointments a
      where a.business_id=p_business_id
        and a.staff_id=p_staff_id
        and a.status<>'cancelled'
        and not (a.group_id=any(coalesce(p_ignore_group_ids,'{}'::uuid[])))
        and a.occupied_starts_at<p_occupied_end
        and a.occupied_ends_at>p_occupied_start
    )
$f16$;

revoke all on function public.f16_staff_slot_free_many(
  uuid,uuid,uuid,date,timestamptz,timestamptz,uuid[]
) from public,anon,authenticated;

create or replace function public.f16_plan_existing_group_at_many(
  p_business_id uuid,
  p_group_id uuid,
  p_starts_at timestamptz,
  p_ignore_group_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $f16$
declare
  v_timezone text;
  v_date date;
  v_line public.appointments;
  v_cursor timestamptz:=p_starts_at;
  v_service_start timestamptz;
  v_service_end timestamptz;
  v_staff_active_end timestamptz;
  v_occ_start timestamptz;
  v_occ_end timestamptz;
  v_prev_staff uuid:=null;
  v_prev_index integer:=0;
  v_plan jsonb:='[]'::jsonb;
begin
  if p_starts_at is null then raise exception 'INVALID_START'; end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date:=(p_starts_at at time zone v_timezone)::date;

  for v_line in
    select a.*
    from public.appointments a
    where a.business_id=p_business_id and a.group_id=p_group_id
    order by a.line_ordinal,a.id
  loop
    if v_line.status not in ('scheduled','confirmed') then
      raise exception 'BOOKING_GROUP_NOT_RESCHEDULABLE';
    end if;

    v_service_start:=v_cursor;
    v_service_end:=v_service_start+make_interval(mins=>v_line.duration_minutes_snapshot);
    v_staff_active_end:=case
      when v_line.processing_capacity_policy_snapshot='RELEASE'
        then v_service_end-make_interval(mins=>v_line.passive_wait_minutes_snapshot)
      else v_service_end
    end;
    v_occ_start:=case
      when v_prev_staff is not null and v_prev_staff=v_line.staff_id
        then v_service_start
      else v_service_start-make_interval(mins=>v_line.buffer_before_minutes_snapshot)
    end;
    v_occ_end:=v_staff_active_end+make_interval(mins=>v_line.buffer_after_minutes_snapshot);

    if not public.f16_staff_slot_free_many(
      p_business_id,v_line.staff_id,v_line.service_id,v_date,
      v_occ_start,v_occ_end,p_ignore_group_ids
    ) then
      return null;
    end if;

    if v_prev_staff is not null and v_prev_staff=v_line.staff_id then
      v_plan:=jsonb_set(
        v_plan,
        array[(v_prev_index-1)::text,'occupiedEndsAt'],
        v_plan->(v_prev_index-1)->'staffActiveEndsAt'
      );
    end if;

    v_plan:=v_plan||jsonb_build_array(jsonb_build_object(
      'appointmentId',v_line.id,
      'lineOrdinal',v_line.line_ordinal,
      'serviceId',v_line.service_id,
      'serviceName',v_line.service_name_snapshot,
      'staffId',v_line.staff_id,
      'staffName',v_line.staff_name_snapshot,
      'startsAt',v_service_start,
      'endsAt',v_service_end,
      'staffActiveEndsAt',v_staff_active_end,
      'occupiedStartsAt',v_occ_start,
      'occupiedEndsAt',v_occ_end,
      'status',v_line.status,
      'durationMinutes',v_line.duration_minutes_snapshot,
      'bufferBeforeMinutes',v_line.buffer_before_minutes_snapshot,
      'bufferAfterMinutes',v_line.buffer_after_minutes_snapshot,
      'processingCapacityPolicy',v_line.processing_capacity_policy_snapshot,
      'passiveWaitMinutes',v_line.passive_wait_minutes_snapshot,
      'processingPolicyVersion',v_line.processing_policy_version_snapshot,
      'priceType',v_line.price_type_snapshot,
      'priceMinMinor',v_line.price_min_minor_snapshot,
      'priceMaxMinor',v_line.price_max_minor_snapshot,
      'priceMinor',v_line.price_minor_snapshot,
      'pricePolicyVersion',v_line.price_policy_version_snapshot,
      'currency',v_line.currency_snapshot
    ));

    v_prev_staff:=v_line.staff_id;
    v_prev_index:=v_prev_index+1;
    v_cursor:=v_service_end;
  end loop;

  if jsonb_array_length(v_plan)=0 then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  return jsonb_build_object(
    'startsAt',p_starts_at,
    'endsAt',v_cursor,
    'timezone',v_timezone,
    'totalDurationMinutes',
      round(extract(epoch from (v_cursor-p_starts_at))/60)::integer,
    'lines',v_plan
  );
end
$f16$;

revoke all on function public.f16_plan_existing_group_at_many(uuid,uuid,timestamptz,uuid[])
  from public,anon,authenticated;

create or replace function public.preview_appointment_series_future(
  p_business_id uuid,
  p_series_id uuid,
  p_from_ordinal integer,
  p_action text,
  p_new_starts_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
set statement_timeout='5s'
as $f16$
declare
  v_series public.appointment_series;
  v_group record;
  v_management jsonb;
  v_target_ids uuid[]:='{}'::uuid[];
  v_targets jsonb:='[]'::jsonb;
  v_skipped jsonb:='[]'::jsonb;
  v_conflicts jsonb:='[]'::jsonb;
  v_target_start timestamptz;
  v_plan jsonb;
  v_step interval;
  v_upper timestamptz;
  v_remaining integer;
  v_anchor_time time without time zone;
  v_candidate_ordinal integer;
  v_local_date date;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_action not in ('reschedule_future','cancel_future') then
    raise exception 'INVALID_SERIES_ACTION';
  end if;

  select * into v_series
  from public.appointment_series s
  where s.business_id=p_business_id and s.id=p_series_id;
  if v_series.id is null then raise exception 'APPOINTMENT_SERIES_NOT_FOUND'; end if;
  if p_from_ordinal is null
     or p_from_ordinal<1
     or p_from_ordinal>v_series.occurrence_count then
    raise exception 'INVALID_SERIES_ORDINAL';
  end if;
  if p_action='reschedule_future' and p_new_starts_at is null then
    raise exception 'INVALID_SERIES_START';
  end if;

  -- First pass: freeze the actual mutable target set. Past/completed/no-show/
  -- already-cancelled occurrences stay historical and are shown as skipped.
  for v_group in
    select g.id,g.series_ordinal,min(a.starts_at) as starts_at
    from public.appointment_groups g
    join public.appointments a
      on a.business_id=g.business_id and a.group_id=g.id
    where g.business_id=p_business_id
      and g.series_id=p_series_id
      and g.series_ordinal>=p_from_ordinal
    group by g.id,g.series_ordinal
    order by g.series_ordinal
  loop
    v_management:=public.f11_group_management_payload(p_business_id,v_group.id);
    if v_group.starts_at<=statement_timestamp() then
      v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object(
        'groupId',v_group.id,'ordinal',v_group.series_ordinal,
        'startsAt',v_group.starts_at,'reason','past'
      ));
    elsif p_action='reschedule_future'
          and coalesce((v_management->>'canRescheduleGroup')::boolean,false) then
      v_target_ids:=array_append(v_target_ids,v_group.id);
    elsif p_action='cancel_future'
          and coalesce((v_management->>'canCancelGroup')::boolean,false) then
      v_target_ids:=array_append(v_target_ids,v_group.id);
    else
      v_skipped:=v_skipped||jsonb_build_array(jsonb_build_object(
        'groupId',v_group.id,'ordinal',v_group.series_ordinal,
        'startsAt',v_group.starts_at,'reason','not_mutable'
      ));
    end if;
  end loop;

  if coalesce(array_length(v_target_ids,1),0)=0 then
    return jsonb_build_object(
      'seriesId',p_series_id,
      'seriesVersion',v_series.version,
      'action',p_action,
      'fromOrdinal',p_from_ordinal,
      'allAvailable',true,
      'targets','[]'::jsonb,
      'conflicts','[]'::jsonb,
      'skipped',v_skipped
    );
  end if;

  if p_action='reschedule_future' then
    v_step:=case when v_series.frequency='daily' then interval '1 day' else interval '1 week' end;
    v_remaining:=v_series.occurrence_count-p_from_ordinal+1;
    v_upper:=p_new_starts_at+make_interval(days=>case
      when v_series.frequency='daily' then v_remaining+1 else (v_remaining+1)*7 end);
    v_anchor_time:=(p_new_starts_at at time zone v_series.timezone)::time;
  end if;

  for v_group in
    select g.id,g.series_ordinal,min(a.starts_at) as starts_at,g.version
    from public.appointment_groups g
    join public.appointments a
      on a.business_id=g.business_id and a.group_id=g.id
    where g.business_id=p_business_id
      and g.series_id=p_series_id
      and g.id=any(v_target_ids)
    group by g.id,g.series_ordinal,g.version
    order by g.series_ordinal
  loop
    if p_action='reschedule_future' then
      v_candidate_ordinal:=v_group.series_ordinal-p_from_ordinal+1;
      select gs into v_target_start
      from pg_catalog.generate_series(
        p_new_starts_at,v_upper,v_step,v_series.timezone
      ) with ordinality as s(gs,ord)
      where ord=v_candidate_ordinal;

      if v_target_start is null then raise exception 'SERIES_CANDIDATE_COUNT_MISMATCH'; end if;
      if (v_target_start at time zone v_series.timezone)::time<>v_anchor_time then
        raise exception 'SERIES_LOCAL_TIME_UNAVAILABLE:%',
          (v_target_start at time zone v_series.timezone)::date;
      end if;
      v_local_date:=(v_target_start at time zone v_series.timezone)::date;
      v_plan:=public.f16_plan_existing_group_at_many(
        p_business_id,v_group.id,v_target_start,v_target_ids
      );
      if v_plan is null then
        v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
          'groupId',v_group.id,'ordinal',v_group.series_ordinal,
          'localDate',v_local_date,'reason','unavailable'
        ));
      end if;
    else
      v_target_start:=null;
      v_local_date:=(v_group.starts_at at time zone v_series.timezone)::date;
      v_plan:='{}'::jsonb;
    end if;

    v_targets:=v_targets||jsonb_build_array(jsonb_build_object(
      'groupId',v_group.id,
      'ordinal',v_group.series_ordinal,
      'groupVersion',v_group.version,
      'startsAt',v_group.starts_at,
      'targetStartsAt',v_target_start,
      'localDate',v_local_date,
      'available',v_plan is not null
    ));
  end loop;

  return jsonb_build_object(
    'seriesId',p_series_id,
    'seriesVersion',v_series.version,
    'action',p_action,
    'fromOrdinal',p_from_ordinal,
    'timezone',v_series.timezone,
    'allAvailable',jsonb_array_length(v_conflicts)=0,
    'targets',v_targets,
    'conflicts',v_conflicts,
    'skipped',v_skipped
  );
end
$f16$;

revoke all on function public.preview_appointment_series_future(
  uuid,uuid,integer,text,timestamptz
) from public,anon,authenticated;
grant execute on function public.preview_appointment_series_future(
  uuid,uuid,integer,text,timestamptz
) to authenticated;

create or replace function public.reschedule_appointment_series_future(
  p_business_id uuid,
  p_series_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_from_ordinal integer,
  p_new_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='10s'
as $f16$
declare
  v_series public.appointment_series;
  v_hash text;
  v_claim record;
  v_preview jsonb;
  v_target jsonb;
  v_first jsonb;
  v_forward boolean;
  v_new_version integer;
  v_target_count integer;
  v_conflict jsonb;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_SERIES_VERSION';
  end if;
  if p_new_starts_at is null then raise exception 'INVALID_SERIES_START'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'f16:series:'||p_business_id::text||':'||p_series_id::text,0
  ));

  select * into v_series
  from public.appointment_series s
  where s.business_id=p_business_id and s.id=p_series_id
  for update;
  if v_series.id is null then raise exception 'APPOINTMENT_SERIES_NOT_FOUND'; end if;

  v_hash:=md5(jsonb_build_object(
    'seriesId',p_series_id,
    'expectedVersion',p_expected_version,
    'fromOrdinal',p_from_ordinal,
    'newStartsAt',p_new_starts_at
  )::text);

  select * into v_claim
  from public.f16_claim_series_command(
    p_business_id,p_idempotency_key,'reschedule_future',v_hash
  );
  if not v_claim.is_new then
    return public.f16_series_payload(p_business_id,v_claim.series_id);
  end if;

  if v_series.version<>p_expected_version then
    raise exception 'APPOINTMENT_SERIES_VERSION_CONFLICT';
  end if;

  v_preview:=public.preview_appointment_series_future(
    p_business_id,p_series_id,p_from_ordinal,'reschedule_future',p_new_starts_at
  );
  v_target_count:=jsonb_array_length(v_preview->'targets');
  if v_target_count=0 then raise exception 'SERIES_NO_FUTURE_OCCURRENCES'; end if;
  if not (v_preview->>'allAvailable')::boolean then
    v_conflict:=v_preview->'conflicts'->0;
    raise exception 'SERIES_FUTURE_OCCURRENCE_UNAVAILABLE:%:%',
      v_conflict->>'ordinal',v_conflict->>'localDate';
  end if;

  -- Own every target group before the first mutation. Single-occurrence F11
  -- changes use the same advisory family, so no target can change underneath
  -- the series CAS after this point.
  for v_target in
    select value
    from jsonb_array_elements(v_preview->'targets')
    order by value->>'groupId'
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f11:group-management:'||p_business_id::text||':'||(v_target->>'groupId'),0
    ));
  end loop;

  v_first:=v_preview->'targets'->0;
  v_forward:=(v_first->>'targetStartsAt')::timestamptz >= (v_first->>'startsAt')::timestamptz;

  for v_target in
    select value
    from jsonb_array_elements(v_preview->'targets')
    order by
      case when v_forward then -(value->>'ordinal')::integer else (value->>'ordinal')::integer end
  loop
    begin
      perform public.f11_reschedule_group_core(
        p_business_id,
        (v_target->>'groupId')::uuid,
        'f16r:'||md5(p_idempotency_key||':'||(v_target->>'groupId')),
        (v_target->>'groupVersion')::integer,
        (v_target->>'targetStartsAt')::timestamptz,
        'group_reschedule','member',auth.uid()
      );
    exception when others then
      if sqlerrm like '%SLOT_UNAVAILABLE%' or sqlerrm like '%APPOINTMENT_CONFLICT%' then
        raise exception 'SERIES_FUTURE_OCCURRENCE_UNAVAILABLE:%:%',
          v_target->>'ordinal',v_target->>'localDate';
      end if;
      raise;
    end;
  end loop;

  update public.appointment_series s
  set version=s.version+1,
      anchor_starts_at=case when p_from_ordinal=1 then p_new_starts_at else s.anchor_starts_at end,
      updated_at=now()
  where s.business_id=p_business_id and s.id=p_series_id
    and s.version=p_expected_version
  returning s.version into v_new_version;
  if v_new_version is null then raise exception 'APPOINTMENT_SERIES_VERSION_CONFLICT'; end if;

  insert into public.appointment_series_events(
    business_id,series_id,series_version,event_type,actor_user_id,payload
  ) values (
    p_business_id,p_series_id,v_new_version,'future_rescheduled',auth.uid(),
    jsonb_build_object(
      'fromOrdinal',p_from_ordinal,
      'newStartsAt',p_new_starts_at,
      'targets',v_preview->'targets',
      'skipped',v_preview->'skipped'
    )
  );

  update public.appointment_series_commands c
  set series_id=p_series_id
  where c.business_id=p_business_id and c.idempotency_key=p_idempotency_key;

  return public.f16_series_payload(p_business_id,p_series_id);
end
$f16$;

revoke all on function public.reschedule_appointment_series_future(
  uuid,uuid,text,integer,integer,timestamptz
) from public,anon,authenticated;
grant execute on function public.reschedule_appointment_series_future(
  uuid,uuid,text,integer,integer,timestamptz
) to authenticated;

create or replace function public.cancel_appointment_series_future(
  p_business_id uuid,
  p_series_id uuid,
  p_idempotency_key text,
  p_expected_version integer,
  p_from_ordinal integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
set statement_timeout='10s'
as $f16$
declare
  v_series public.appointment_series;
  v_reason text:=nullif(btrim(p_reason),'');
  v_hash text;
  v_claim record;
  v_preview jsonb;
  v_target jsonb;
  v_new_version integer;
  v_target_count integer;
  v_has_future boolean;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_expected_version is null or p_expected_version<1 then
    raise exception 'INVALID_SERIES_VERSION';
  end if;
  if v_reason is not null and char_length(v_reason)>500 then
    raise exception 'CANCELLATION_REASON_TOO_LONG';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'f16:series:'||p_business_id::text||':'||p_series_id::text,0
  ));

  select * into v_series
  from public.appointment_series s
  where s.business_id=p_business_id and s.id=p_series_id
  for update;
  if v_series.id is null then raise exception 'APPOINTMENT_SERIES_NOT_FOUND'; end if;

  v_hash:=md5(jsonb_build_object(
    'seriesId',p_series_id,
    'expectedVersion',p_expected_version,
    'fromOrdinal',p_from_ordinal,
    'reason',v_reason
  )::text);

  select * into v_claim
  from public.f16_claim_series_command(
    p_business_id,p_idempotency_key,'cancel_future',v_hash
  );
  if not v_claim.is_new then
    return public.f16_series_payload(p_business_id,v_claim.series_id);
  end if;

  if v_series.version<>p_expected_version then
    raise exception 'APPOINTMENT_SERIES_VERSION_CONFLICT';
  end if;

  v_preview:=public.preview_appointment_series_future(
    p_business_id,p_series_id,p_from_ordinal,'cancel_future',null
  );
  v_target_count:=jsonb_array_length(v_preview->'targets');
  if v_target_count=0 then raise exception 'SERIES_NO_FUTURE_OCCURRENCES'; end if;

  for v_target in
    select value
    from jsonb_array_elements(v_preview->'targets')
    order by value->>'groupId'
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f11:group-management:'||p_business_id::text||':'||(v_target->>'groupId'),0
    ));
  end loop;

  for v_target in
    select value
    from jsonb_array_elements(v_preview->'targets')
    order by (value->>'ordinal')::integer
  loop
    perform public.f11_cancel_group_core(
      p_business_id,
      (v_target->>'groupId')::uuid,
      'f16c:'||md5(p_idempotency_key||':'||(v_target->>'groupId')),
      (v_target->>'groupVersion')::integer,
      v_reason,
      'group_cancel','member',auth.uid()
    );
  end loop;

  select exists (
    select 1
    from public.appointment_groups g
    join public.appointments a
      on a.business_id=g.business_id and a.group_id=g.id
    where g.business_id=p_business_id
      and g.series_id=p_series_id
      and a.starts_at>statement_timestamp()
      and a.status in ('scheduled','confirmed')
  ) into v_has_future;

  update public.appointment_series s
  set version=s.version+1,
      status=case when v_has_future then s.status else 'cancelled' end,
      updated_at=now()
  where s.business_id=p_business_id and s.id=p_series_id
    and s.version=p_expected_version
  returning s.version into v_new_version;
  if v_new_version is null then raise exception 'APPOINTMENT_SERIES_VERSION_CONFLICT'; end if;

  insert into public.appointment_series_events(
    business_id,series_id,series_version,event_type,actor_user_id,payload
  ) values (
    p_business_id,p_series_id,v_new_version,'future_cancelled',auth.uid(),
    jsonb_build_object(
      'fromOrdinal',p_from_ordinal,
      'reason',v_reason,
      'targets',v_preview->'targets',
      'skipped',v_preview->'skipped'
    )
  );

  update public.appointment_series_commands c
  set series_id=p_series_id
  where c.business_id=p_business_id and c.idempotency_key=p_idempotency_key;

  return public.f16_series_payload(p_business_id,p_series_id);
end
$f16$;

revoke all on function public.cancel_appointment_series_future(
  uuid,uuid,text,integer,integer,text
) from public,anon,authenticated;
grant execute on function public.cancel_appointment_series_future(
  uuid,uuid,text,integer,integer,text
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
