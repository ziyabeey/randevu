begin;

-- F11-02: multi-service availability and atomic group creation.
--
-- One engine plans every selected service of a reservation in the requested
-- order. It is not the single-service engine called N times: staff continuity,
-- buffers between consecutive lines and the group's own occupancy are decided
-- inside one plan. Staff is only pinned when the caller pinned it; otherwise the
-- real assignment is chosen while the plan is committed.
--
-- Contracts: K01 identity/compatibility, K02 price meaning, K03 group/slot
-- budgets. F11-01 already made the staff exclusion constraint deferrable and
-- added the group header, so N lines are validated together before commit.

-- A multi-service reservation is one command in the existing ledger. The
-- historical command vocabulary is extended, never reinterpreted.
alter table public.booking_commands drop constraint if exists booking_commands_command_check;
alter table public.booking_commands
  add constraint booking_commands_command_check
  check (command in (
    'create','public_create','reschedule','status','public_reschedule','public_cancel','create_group'
  ));

-- ---------------------------------------------------------------------------
-- Budgets (K03). Exceeding one is an explicit error, never an empty slot list.
-- ---------------------------------------------------------------------------
create or replace function public.f11_group_line_limit() returns integer
language sql immutable set search_path = public as $$ select 10 $$;

-- Candidate starts x lines for one date. A 10-service group at a 5 minute step
-- over a long opening day is exactly the search this stops; the caller retries
-- with a coarser step instead of receiving a silently empty list.
create or replace function public.f11_group_probe_budget() returns integer
language sql immutable set search_path = public as $$ select 1500 $$;

revoke all on function public.f11_group_line_limit() from public, anon, authenticated;
revoke all on function public.f11_group_probe_budget() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Requested lines -> validated, ordered line definitions.
-- ---------------------------------------------------------------------------
create or replace function public.f11_group_line_defs(
  p_business_id uuid,
  p_lines jsonb
)
returns table(
  line_ordinal smallint,
  service_id uuid,
  service_name text,
  duration_minutes integer,
  buffer_before_minutes integer,
  buffer_after_minutes integer,
  pinned_staff_id uuid,
  price_type text,
  price_min_minor integer,
  price_max_minor integer,
  price_minor integer,
  price_policy_version integer,
  currency text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_GROUP_LINES';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 then
    raise exception 'INVALID_GROUP_LINES';
  end if;
  if v_count > public.f11_group_line_limit() then
    raise exception 'GROUP_LINE_LIMIT_EXCEEDED';
  end if;

  return query
  with requested as (
    select
      (ord)::smallint as line_ordinal,
      nullif(item->>'serviceId', '')::uuid as service_id,
      nullif(item->>'staffId', '')::uuid as pinned_staff_id
    from jsonb_array_elements(p_lines) with ordinality as t(item, ord)
  )
  select
    r.line_ordinal,
    s.id,
    s.name,
    s.duration_minutes,
    s.buffer_before_minutes,
    s.buffer_after_minutes,
    r.pinned_staff_id,
    s.price_type,
    s.price_min_minor,
    s.price_max_minor,
    s.price_minor,
    s.price_policy_version,
    s.currency
  from requested r
  join public.services s
    on s.business_id = p_business_id
   and s.id = r.service_id
   and s.active
  order by r.line_ordinal;
end
$$;

revoke all on function public.f11_group_line_defs(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Is this staff free for [p_occupied_start, p_occupied_end) on this date?
-- Working hours, blocks and existing appointments in one predicate. The group's
-- own lines are excluded by group id so a replan never fights itself.
-- ---------------------------------------------------------------------------
create or replace function public.f11_staff_slot_free(
  p_business_id uuid,
  p_staff_id uuid,
  p_service_id uuid,
  p_date date,
  p_occupied_start timestamptz,
  p_occupied_end timestamptz,
  p_ignore_group_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.staff_profiles sp
      join public.staff_services ss
        on ss.business_id = sp.business_id
       and ss.staff_id = sp.id
       and ss.service_id = p_service_id
       and ss.active
      join public.businesses b on b.id = sp.business_id
      join public.business_hours bh
        on bh.business_id = sp.business_id
       and bh.weekday = extract(dow from p_date)::smallint
       and bh.active
      join public.staff_hours sh
        on sh.business_id = sp.business_id
       and sh.staff_id = sp.id
       and sh.weekday = extract(dow from p_date)::smallint
       and sh.active
      where sp.business_id = p_business_id
        and sp.id = p_staff_id
        and sp.active
        and greatest(bh.starts_local, sh.starts_local) < least(bh.ends_local, sh.ends_local)
        and (p_date + greatest(bh.starts_local, sh.starts_local)) at time zone b.timezone <= p_occupied_start
        and (p_date + least(bh.ends_local, sh.ends_local)) at time zone b.timezone >= p_occupied_end
    )
    and not exists (
      select 1
      from public.availability_blocks ab
      where ab.active
        and (ab.staff_id is null or ab.staff_id = p_staff_id)
        and ab.starts_at < p_occupied_end
        and ab.ends_at > p_occupied_start
    ) -- holdout D0xD3 variation: tenant-wide capacity blocks are no longer tenant-scoped
    and not exists (
      select 1
      from public.appointments a
      where a.business_id = p_business_id
        and a.staff_id = p_staff_id
        and a.status <> 'cancelled'
        and (p_ignore_group_id is null or a.group_id <> p_ignore_group_id)
        and a.occupied_starts_at < p_occupied_end
        and a.occupied_ends_at > p_occupied_start
    )
$$;

revoke all on function public.f11_staff_slot_free(uuid, uuid, uuid, date, timestamptz, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Plan one group at one exact start. Returns null when the group cannot be
-- placed. Assignment rule, deterministic and documented:
--   1. a pinned staff must serve its line,
--   2. otherwise the staff who served the previous line is preferred, which
--      keeps one continuous block and removes the buffer between the two,
--   3. otherwise the eligible free staff ordered by (name, id).
-- A maximal run of consecutive lines served by the same staff is one occupancy
-- block: only its first line carries the before-buffer and only its last line
-- carries the after-buffer. A single-line group is byte-identical to the legacy
-- single-service placement.
-- ---------------------------------------------------------------------------
create or replace function public.f11_plan_group_at(
  p_business_id uuid,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_ignore_group_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_date date;
  v_line record;
  v_cursor timestamptz := p_starts_at;
  v_prev_staff uuid := null;
  v_prev_index integer := 0;
  v_staff_id uuid;
  v_staff_name text;
  v_service_start timestamptz;
  v_service_end timestamptz;
  v_occ_start timestamptz;
  v_occ_end timestamptz;
  v_plan jsonb := '[]'::jsonb;
  v_candidate record;
begin
  select b.timezone into v_timezone from public.businesses b where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date := (p_starts_at at time zone v_timezone)::date;

  for v_line in select * from public.f11_group_line_defs(p_business_id, p_lines) loop
    v_service_start := v_cursor;
    v_service_end := v_service_start + make_interval(mins => v_line.duration_minutes);
    v_staff_id := null;
    v_staff_name := null;

    -- Continuation of the previous staff needs no inner buffer.
    if v_prev_staff is not null then
      v_occ_start := v_service_start;
      v_occ_end := v_service_end + make_interval(mins => v_line.buffer_after_minutes);
      if (v_line.pinned_staff_id is null or v_line.pinned_staff_id = v_prev_staff)
         and public.f11_staff_slot_free(
               p_business_id, v_prev_staff, v_line.service_id, v_date,
               v_occ_start, v_occ_end, p_ignore_group_id) then
        select sp.name into v_staff_name from public.staff_profiles sp where sp.id = v_prev_staff;
        v_staff_id := v_prev_staff;
      end if;
    end if;

    if v_staff_id is null then
      v_occ_start := v_service_start - make_interval(mins => v_line.buffer_before_minutes);
      v_occ_end := v_service_end + make_interval(mins => v_line.buffer_after_minutes);
      for v_candidate in
        select sp.id, sp.name
        from public.staff_profiles sp
        join public.staff_services ss
          on ss.business_id = sp.business_id
         and ss.staff_id = sp.id
         and ss.service_id = v_line.service_id
         and ss.active
        where sp.business_id = p_business_id
          and sp.active
          and (v_line.pinned_staff_id is null or sp.id = v_line.pinned_staff_id)
        order by sp.name, sp.id
      loop
        if public.f11_staff_slot_free(
             p_business_id, v_candidate.id, v_line.service_id, v_date,
             v_occ_start, v_occ_end, p_ignore_group_id) then
          v_staff_id := v_candidate.id;
          v_staff_name := v_candidate.name;
          exit;
        end if;
      end loop;
    end if;

    if v_staff_id is null then
      return null;
    end if;

    -- Close the previous run when the staff changes: its last line keeps the
    -- after-buffer it was planned with, so nothing has to be rewritten.
    if v_prev_staff is not null and v_staff_id = v_prev_staff then
      v_plan := jsonb_set(
        v_plan,
        array[(v_prev_index - 1)::text, 'occupiedEndsAt'],
        to_jsonb((v_plan -> (v_prev_index - 1) ->> 'endsAt')::timestamptz)
      );
    end if;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'lineOrdinal', v_line.line_ordinal,
      'serviceId', v_line.service_id,
      'serviceName', v_line.service_name,
      'staffId', v_staff_id,
      'staffName', v_staff_name,
      'startsAt', v_service_start,
      'endsAt', v_service_end,
      'occupiedStartsAt', v_occ_start,
      'occupiedEndsAt', v_occ_end,
      'durationMinutes', v_line.duration_minutes,
      'bufferBeforeMinutes', v_line.buffer_before_minutes,
      'bufferAfterMinutes', v_line.buffer_after_minutes,
      'priceType', v_line.price_type,
      'priceMinMinor', v_line.price_min_minor,
      'priceMaxMinor', v_line.price_max_minor,
      'priceMinor', case when v_line.price_type = 'fixed' then v_line.price_minor else null end,
      'pricePolicyVersion', v_line.price_policy_version,
      'currency', v_line.currency
    ));

    v_prev_index := v_prev_index + 1;
    v_prev_staff := v_staff_id;
    v_cursor := v_service_end;
  end loop;

  if jsonb_array_length(v_plan) = 0 then
    return null;
  end if;

  return jsonb_build_object(
    'startsAt', p_starts_at,
    'endsAt', v_cursor,
    'timezone', v_timezone,
    'lines', v_plan
  );
end
$$;

revoke all on function public.f11_plan_group_at(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Group slot search over one date. The duration and total presented with a slot
-- describe the same plan the create path will commit.
-- ---------------------------------------------------------------------------
create or replace function public.compute_group_availability_slots(
  p_business_id uuid,
  p_date date,
  p_lines jsonb,
  p_step_minutes integer default 15
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  total_duration_minutes integer,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_line_count integer;
  v_total_minutes integer;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_candidates integer;
  v_probe integer;
  v_start timestamptz;
  v_plan jsonb;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_step_minutes < 5 or p_step_minutes > 120 then
    raise exception 'INVALID_STEP';
  end if;
  if p_date < current_date - 1 or p_date > current_date + 366 then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  select count(*)::integer, coalesce(sum(d.duration_minutes), 0)::integer
    into v_line_count, v_total_minutes
  from public.f11_group_line_defs(p_business_id, p_lines) d;

  if v_line_count <> jsonb_array_length(p_lines) then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  select b.timezone into v_timezone from public.businesses b where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  select
    min((p_date + bh.starts_local) at time zone v_timezone),
    max((p_date + bh.ends_local) at time zone v_timezone)
    into v_window_start, v_window_end
  from public.business_hours bh
  where bh.business_id = p_business_id
    and bh.weekday = extract(dow from p_date)::smallint
    and bh.active;

  if v_window_start is null then
    return;
  end if;

  v_candidates := greatest(
    0,
    (extract(epoch from (v_window_end - make_interval(mins => v_total_minutes) - v_window_start)) / (p_step_minutes * 60))::integer + 1
  );
  v_probe := v_candidates * v_line_count;
  if v_probe > public.f11_group_probe_budget() then
    raise exception 'GROUP_SLOT_BUDGET_EXCEEDED';
  end if;

  v_start := v_window_start;
  while v_start + make_interval(mins => v_total_minutes) <= v_window_end loop
    v_plan := public.f11_plan_group_at(p_business_id, p_lines, v_start, null);
    if v_plan is not null then
      starts_at := v_start;
      ends_at := (v_plan->>'endsAt')::timestamptz;
      timezone := v_timezone;
      total_duration_minutes := v_total_minutes;
      lines := v_plan->'lines';
      return next;
    end if;
    v_start := v_start + make_interval(mins => p_step_minutes);
  end loop;

  return;
end
$$;

revoke all on function public.compute_group_availability_slots(uuid, date, jsonb, integer) from public, anon, authenticated;
grant execute on function public.compute_group_availability_slots(uuid, date, jsonb, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- Canonical group read. One shape for the create result and every idempotent
-- replay of the same command.
-- ---------------------------------------------------------------------------
create or replace function public.f11_group_payload(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'groupId', g.id,
    'status', g.status,
    'source', g.source,
    'version', g.version,
    'customerId', g.customer_id,
    'startsAt', min(a.starts_at),
    'endsAt', max(a.ends_at),
    'timezone', min(a.timezone),
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'appointmentId', a.id,
      'lineOrdinal', a.line_ordinal,
      'serviceId', a.service_id,
      'serviceName', a.service_name_snapshot,
      'staffId', a.staff_id,
      'staffName', a.staff_name_snapshot,
      'status', a.status,
      'startsAt', a.starts_at,
      'endsAt', a.ends_at,
      'priceType', a.price_type_snapshot,
      'priceMinMinor', a.price_min_minor_snapshot,
      'priceMaxMinor', a.price_max_minor_snapshot,
      'priceMinor', a.price_minor_snapshot,
      'currency', a.currency_snapshot
    ) order by a.line_ordinal), '[]'::jsonb)
  )
  from public.appointment_groups g
  join public.appointments a
    on a.business_id = g.business_id
   and a.group_id = g.id
  where g.business_id = p_business_id
    and g.id = p_group_id
  group by g.id, g.status, g.source, g.version, g.customer_id
$$;

revoke all on function public.f11_group_payload(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic multi-service create. One command, one request hash, one create event.
-- Either every line of the group exists or none does.
-- ---------------------------------------------------------------------------
create or replace function public.create_appointment_group(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_name text := trim(p_customer_name);
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_customer_email text := public.f10_normalize_customer_email(coalesce(p_customer_email, ''));
  v_notes text := nullif(trim(p_notes), '');
  v_hash text;
  v_claim record;
  v_plan jsonb;
  v_line jsonb;
  v_customer_id uuid;
  v_group_id uuid;
  v_anchor_id uuid;
  v_timezone text;
  v_existing_group uuid;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_customer_email is not null and (char_length(v_customer_email) > 254 or position('@' in v_customer_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  -- One group create is one command with one request hash; it is never split
  -- into N per-line commands.
  v_hash := md5(jsonb_build_object(
    'customerName', v_customer_name,
    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,
    'lines', p_lines,
    'startsAt', p_starts_at,
    'notes', v_notes
  )::text);

  select * into v_claim
  from public.claim_booking_command(p_business_id, p_idempotency_key, 'create_group', v_hash, null);

  if not v_claim.is_new then
    select a.group_id into v_existing_group
    from public.appointments a
    where a.business_id = p_business_id and a.id = v_claim.appointment_id;
    if v_existing_group is null then
      raise exception 'IDEMPOTENCY_RESULT_MISSING';
    end if;
    return public.f11_group_payload(p_business_id, v_existing_group);
  end if;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
  if v_plan is null then
    raise exception 'GROUP_SLOT_UNAVAILABLE';
  end if;
  v_timezone := v_plan->>'timezone';

  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id, v_customer_name, v_customer_phone, v_customer_email, null, auth.uid(), true
  );

  -- Multi-staff locks are taken in a stable ascending staff order so two
  -- concurrent groups over the same staff set serialize instead of deadlocking.
  perform 1
  from public.staff_profiles sp
  where sp.business_id = p_business_id
    and sp.id in (
      select distinct (l->>'staffId')::uuid
      from jsonb_array_elements(v_plan->'lines') l
    )
  order by sp.id
  for update;

  -- Replan under the locks: a slot that filled between search and commit must
  -- surface as a conflict rather than a half group.
  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
  if v_plan is null then
    raise exception 'GROUP_SLOT_UNAVAILABLE';
  end if;

  v_group_id := gen_random_uuid();
  insert into public.appointment_groups(
    id, business_id, customer_id, status, source, version, legacy_appointment_id, created_by
  ) values (
    v_group_id, p_business_id, v_customer_id, 'scheduled', 'operator', 1, null, auth.uid()
  );

  -- Every line of the group is checked against staff occupancy together.
  set constraints appointments_staff_no_overlap deferred;

  for v_line in select * from jsonb_array_elements(v_plan->'lines') loop
    insert into public.appointments(
      business_id, customer_id, service_id, staff_id, status, source,
      group_id, line_ordinal,
      starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      service_name_snapshot, staff_name_snapshot,
      duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      price_minor_snapshot, currency_snapshot,
      price_type_snapshot, price_min_minor_snapshot, price_max_minor_snapshot, price_policy_version_snapshot,
      notes, created_by
    ) values (
      p_business_id, v_customer_id,
      (v_line->>'serviceId')::uuid, (v_line->>'staffId')::uuid, 'scheduled', 'operator',
      v_group_id, (v_line->>'lineOrdinal')::smallint,
      (v_line->>'startsAt')::timestamptz, (v_line->>'endsAt')::timestamptz,
      (v_line->>'occupiedStartsAt')::timestamptz, (v_line->>'occupiedEndsAt')::timestamptz,
      v_timezone,
      v_customer_name, v_customer_phone, v_customer_email,
      v_line->>'serviceName', v_line->>'staffName',
      (v_line->>'durationMinutes')::integer,
      (v_line->>'bufferBeforeMinutes')::integer,
      (v_line->>'bufferAfterMinutes')::integer,
      nullif(v_line->>'priceMinor', '')::integer,
      v_line->>'currency',
      v_line->>'priceType',
      (v_line->>'priceMinMinor')::integer,
      (v_line->>'priceMaxMinor')::integer,
      (v_line->>'pricePolicyVersion')::integer,
      v_notes, auth.uid()
    );
    if v_anchor_id is null then
      select a.id into v_anchor_id
      from public.appointments a
      where a.business_id = p_business_id
        and a.group_id = v_group_id
        and a.line_ordinal = (v_line->>'lineOrdinal')::smallint;
    end if;
  end loop;

  begin
    set constraints appointments_staff_no_overlap immediate;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  -- One create event for the whole reservation; the F11-01 bridge stamps the
  -- group id and version.
  insert into public.appointment_events(
    business_id, appointment_id, event_type, actor_user_id, from_status, to_status, payload
  ) values (
    p_business_id, v_anchor_id, 'created', auth.uid(), null, 'scheduled',
    jsonb_build_object(
      'startsAt', p_starts_at,
      'lineCount', jsonb_array_length(v_plan->'lines'),
      'lines', v_plan->'lines'
    )
  );

  update public.booking_commands
  set appointment_id = v_anchor_id
  where business_id = p_business_id and idempotency_key = p_idempotency_key;

  return public.f11_group_payload(p_business_id, v_group_id);
end
$$;

revoke all on function public.create_appointment_group(uuid, text, text, jsonb, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.create_appointment_group(uuid, text, text, jsonb, timestamptz, text, text, text) to authenticated;

commit;
