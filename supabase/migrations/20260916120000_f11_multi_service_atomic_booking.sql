begin;

-- F11-02: canonical multi-service planner + atomic operator create.
--
-- The existing appointments table remains the physical service-line store. This
-- migration adds the minimum server-authoritative passive-processing policy,
-- freezes that policy on every new line, and introduces one group planner / one
-- group idempotency path. Legacy one-service RPC signatures remain unchanged.

alter table public.services
  add column if not exists processing_minutes integer,
  add column if not exists processing_staff_mode text,
  add column if not exists processing_policy_version integer;

update public.services
set processing_minutes = coalesce(processing_minutes, 0),
    processing_staff_mode = coalesce(nullif(lower(trim(processing_staff_mode)), ''), 'hold'),
    processing_policy_version = coalesce(processing_policy_version, 1)
where processing_minutes is null
   or processing_staff_mode is null
   or processing_policy_version is null;

alter table public.services
  alter column processing_minutes set default 0,
  alter column processing_minutes set not null,
  alter column processing_staff_mode set default 'hold',
  alter column processing_staff_mode set not null,
  alter column processing_policy_version set default 1,
  alter column processing_policy_version set not null,
  drop constraint if exists services_processing_minutes_check,
  add constraint services_processing_minutes_check
    check (processing_minutes between 0 and 720),
  drop constraint if exists services_processing_staff_mode_check,
  add constraint services_processing_staff_mode_check
    check (processing_staff_mode in ('hold','release')),
  drop constraint if exists services_processing_policy_version_check,
  add constraint services_processing_policy_version_check
    check (processing_policy_version > 0);

create or replace function public.f11_sync_service_processing_contract()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  new.processing_minutes := coalesce(new.processing_minutes, 0);
  new.processing_staff_mode := lower(trim(coalesce(new.processing_staff_mode, 'hold')));

  if new.processing_minutes not between 0 and 720
     or new.processing_staff_mode not in ('hold','release') then
    raise exception 'INVALID_SERVICE_PROCESSING_POLICY';
  end if;

  if tg_op = 'INSERT' then
    new.processing_policy_version := 1;
  else
    v_changed := new.processing_minutes is distinct from old.processing_minutes
      or new.processing_staff_mode is distinct from old.processing_staff_mode;
    new.processing_policy_version := old.processing_policy_version + case when v_changed then 1 else 0 end;
  end if;

  return new;
end
$$;

revoke all on function public.f11_sync_service_processing_contract()
  from public, anon, authenticated;

drop trigger if exists services_f11_processing_contract on public.services;
create trigger services_f11_processing_contract
before insert or update on public.services
for each row execute function public.f11_sync_service_processing_contract();

create or replace function public.update_service_processing_policy_guarded(
  p_business_id uuid,
  p_service_id uuid,
  p_expected_updated_at timestamptz,
  p_processing_minutes integer,
  p_processing_staff_mode text
)
returns public.services
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.services;
  v_mode text := lower(trim(coalesce(p_processing_staff_mode, '')));
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_expected_updated_at is null
     or p_processing_minutes is null
     or p_processing_minutes not between 0 and 720
     or v_mode not in ('hold','release') then
    raise exception 'INVALID_SERVICE_PROCESSING_POLICY';
  end if;

  select * into v_row
  from public.services s
  where s.business_id = p_business_id
    and s.id = p_service_id
  for update;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE_WRITE';
  end if;

  update public.services s
  set processing_minutes = p_processing_minutes,
      processing_staff_mode = v_mode
  where s.business_id = p_business_id
    and s.id = p_service_id
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.update_service_processing_policy_guarded(uuid,uuid,timestamptz,integer,text)
  from public, anon, authenticated;
grant execute on function public.update_service_processing_policy_guarded(uuid,uuid,timestamptz,integer,text)
  to authenticated;

alter table public.appointments
  add column if not exists processing_minutes_snapshot integer,
  add column if not exists processing_staff_mode_snapshot text,
  add column if not exists processing_policy_version_snapshot integer;

update public.appointments
set processing_minutes_snapshot = coalesce(processing_minutes_snapshot, 0),
    processing_staff_mode_snapshot = coalesce(processing_staff_mode_snapshot, 'hold'),
    processing_policy_version_snapshot = coalesce(processing_policy_version_snapshot, 1)
where processing_minutes_snapshot is null
   or processing_staff_mode_snapshot is null
   or processing_policy_version_snapshot is null;

alter table public.appointments
  alter column processing_minutes_snapshot set not null,
  alter column processing_staff_mode_snapshot set not null,
  alter column processing_policy_version_snapshot set not null,
  drop constraint if exists appointments_processing_minutes_snapshot_check,
  add constraint appointments_processing_minutes_snapshot_check
    check (processing_minutes_snapshot between 0 and 720),
  drop constraint if exists appointments_processing_staff_mode_snapshot_check,
  add constraint appointments_processing_staff_mode_snapshot_check
    check (processing_staff_mode_snapshot in ('hold','release')),
  drop constraint if exists appointments_processing_policy_version_snapshot_check,
  add constraint appointments_processing_policy_version_snapshot_check
    check (processing_policy_version_snapshot > 0);

-- Phase 5 assumed service time and staff occupancy always ended together. A
-- RELEASE policy intentionally allows customer processing time to continue after
-- the staff becomes free. Remove only that historical check and replace it with
-- exact snapshot-derived timing equations.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.appointments'::regclass
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%ends_at <= occupied_ends_at%'
  loop
    execute format('alter table public.appointments drop constraint %I', v_constraint);
  end loop;
end
$$;

alter table public.appointments
  drop constraint if exists appointments_f11_processing_timing_check,
  add constraint appointments_f11_processing_timing_check
    check (
      ends_at = starts_at
        + make_interval(mins => duration_minutes_snapshot + processing_minutes_snapshot)
      and occupied_starts_at = starts_at
        - make_interval(mins => buffer_before_minutes_snapshot)
      and occupied_ends_at = starts_at
        + make_interval(
            mins => duration_minutes_snapshot
              + case when processing_staff_mode_snapshot = 'hold'
                  then processing_minutes_snapshot else 0 end
              + buffer_after_minutes_snapshot
          )
    );

-- Extend the accepted F11 line trigger. Legacy inserts are allowed to auto-fill
-- only the old zero-minute/full-hold policy. Once a service opts into passive
-- processing, callers must use the group-aware contract so legacy slot RPCs can
-- never silently book against the wrong occupancy model.
create or replace function public.f11_prepare_appointment_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group public.appointment_groups;
  v_service public.services;
  v_explicit_price boolean;
  v_explicit_processing boolean;
begin
  if new.id is null then
    raise exception 'INVALID_APPOINTMENT_LINE';
  end if;

  if new.group_id is null then
    if tg_op = 'UPDATE' then
      raise exception 'BOOKING_GROUP_REQUIRED';
    end if;
    new.group_id := new.id;
    new.line_ordinal := 1;

    insert into public.appointment_groups(
      id, business_id, customer_id, status, source, version,
      legacy_appointment_id, created_by, created_at, updated_at
    ) values (
      new.group_id, new.business_id, new.customer_id, new.status, new.source, 1,
      new.id, new.created_by, coalesce(new.created_at, now()), coalesce(new.updated_at, now())
    )
    on conflict (id) do nothing;
  elsif new.line_ordinal is null then
    raise exception 'INVALID_APPOINTMENT_LINE_ORDINAL';
  end if;

  select * into v_group
  from public.appointment_groups g
  where g.id = new.group_id;

  if v_group.id is null
     or v_group.business_id <> new.business_id
     or v_group.customer_id <> new.customer_id
     or v_group.source <> new.source then
    raise exception 'BOOKING_GROUP_CONTRACT_MISMATCH';
  end if;

  if v_group.legacy_appointment_id is not null
     and (v_group.legacy_appointment_id <> new.id or new.line_ordinal <> 1) then
    raise exception 'BOOKING_GROUP_LEGACY_ANCHOR_CONFLICT';
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;

  select * into v_service
  from public.services s
  where s.business_id = new.business_id
    and s.id = new.service_id;
  if v_service.id is null then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  v_explicit_price := new.price_type_snapshot is not null
    or new.price_min_minor_snapshot is not null
    or new.price_max_minor_snapshot is not null
    or new.price_policy_version_snapshot is not null;

  if not v_explicit_price then
    if v_service.price_type <> 'fixed' then
      raise exception 'SERVICE_PRICE_NOT_FINAL';
    end if;
    if new.price_minor_snapshot is null
       or new.price_minor_snapshot <> v_service.price_minor
       or new.currency_snapshot is null
       or new.currency_snapshot <> v_service.currency
       or v_service.price_min_minor <> v_service.price_minor
       or v_service.price_max_minor <> v_service.price_minor then
      raise exception 'SERVICE_PRICE_SNAPSHOT_MISMATCH';
    end if;
    new.price_type_snapshot := 'fixed';
    new.price_min_minor_snapshot := v_service.price_min_minor;
    new.price_max_minor_snapshot := v_service.price_max_minor;
    new.price_policy_version_snapshot := v_service.price_policy_version;
  else
    if new.price_type_snapshot is null
       or new.price_min_minor_snapshot is null
       or new.price_max_minor_snapshot is null
       or new.price_policy_version_snapshot is null
       or new.price_type_snapshot <> v_service.price_type
       or new.price_min_minor_snapshot <> v_service.price_min_minor
       or new.price_max_minor_snapshot <> v_service.price_max_minor
       or new.currency_snapshot <> v_service.currency
       or new.price_policy_version_snapshot <> v_service.price_policy_version
       or (
         new.price_type_snapshot = 'fixed'
         and (
           new.price_min_minor_snapshot <> new.price_max_minor_snapshot
           or new.price_minor_snapshot is null
           or new.price_minor_snapshot <> new.price_min_minor_snapshot
         )
       )
       or (
         new.price_type_snapshot = 'range'
         and new.price_minor_snapshot is not null
       ) then
      raise exception 'SERVICE_PRICE_SNAPSHOT_MISMATCH';
    end if;
  end if;

  v_explicit_processing := new.processing_minutes_snapshot is not null
    or new.processing_staff_mode_snapshot is not null
    or new.processing_policy_version_snapshot is not null;

  if not v_explicit_processing then
    if v_service.processing_minutes <> 0
       or v_service.processing_staff_mode <> 'hold' then
      raise exception 'SERVICE_PROCESSING_POLICY_REQUIRES_GROUP_BOOKING';
    end if;
    new.processing_minutes_snapshot := 0;
    new.processing_staff_mode_snapshot := 'hold';
    new.processing_policy_version_snapshot := v_service.processing_policy_version;
  elsif new.processing_minutes_snapshot is null
     or new.processing_staff_mode_snapshot is null
     or new.processing_policy_version_snapshot is null
     or new.processing_minutes_snapshot <> v_service.processing_minutes
     or new.processing_staff_mode_snapshot <> v_service.processing_staff_mode
     or new.processing_policy_version_snapshot <> v_service.processing_policy_version then
    raise exception 'SERVICE_PROCESSING_POLICY_SNAPSHOT_MISMATCH';
  end if;

  return new;
end
$$;

revoke all on function public.f11_prepare_appointment_line()
  from public, anon, authenticated;

create or replace function public.f11_enforce_appointment_line_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.business_id is distinct from new.business_id
     or old.group_id is distinct from new.group_id
     or old.line_ordinal is distinct from new.line_ordinal
     or old.customer_id is distinct from new.customer_id
     or old.service_id is distinct from new.service_id
     or old.source is distinct from new.source
     or old.customer_name_snapshot is distinct from new.customer_name_snapshot
     or old.customer_phone_snapshot is distinct from new.customer_phone_snapshot
     or old.customer_email_snapshot is distinct from new.customer_email_snapshot
     or old.service_name_snapshot is distinct from new.service_name_snapshot
     or old.duration_minutes_snapshot is distinct from new.duration_minutes_snapshot
     or old.buffer_before_minutes_snapshot is distinct from new.buffer_before_minutes_snapshot
     or old.buffer_after_minutes_snapshot is distinct from new.buffer_after_minutes_snapshot
     or old.processing_minutes_snapshot is distinct from new.processing_minutes_snapshot
     or old.processing_staff_mode_snapshot is distinct from new.processing_staff_mode_snapshot
     or old.processing_policy_version_snapshot is distinct from new.processing_policy_version_snapshot
     or old.price_minor_snapshot is distinct from new.price_minor_snapshot
     or old.price_type_snapshot is distinct from new.price_type_snapshot
     or old.price_min_minor_snapshot is distinct from new.price_min_minor_snapshot
     or old.price_max_minor_snapshot is distinct from new.price_max_minor_snapshot
     or old.price_policy_version_snapshot is distinct from new.price_policy_version_snapshot
     or old.currency_snapshot is distinct from new.currency_snapshot
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end
$$;

revoke all on function public.f11_enforce_appointment_line_immutability()
  from public, anon, authenticated;

-- Return a normalized ordered service intent and all server-authoritative frozen
-- catalog inputs. Candidate-product budgeting is deliberately performed before
-- any write, so an over-broad "any staff" request never looks like empty slots.
create or replace function public.f11_normalize_group_intent_internal(
  p_business_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business public.businesses;
  v_item jsonb;
  v_ordinal integer;
  v_service_id uuid;
  v_staff_id uuid;
  v_service public.services;
  v_staff_count integer;
  v_product numeric := 1;
  v_specs jsonb := '[]'::jsonb;
  v_currency text;
  v_lower bigint := 0;
  v_upper bigint := 0;
begin
  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 10 then
    raise exception 'INVALID_BOOKING_GROUP_LINES';
  end if;

  select * into v_business
  from public.businesses b
  where b.id = p_business_id;
  if v_business.id is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  for v_item, v_ordinal in
    select e.value, e.ordinality::integer
    from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'serviceId')
       or exists (
         select 1
         from jsonb_object_keys(v_item) k
         where k not in ('serviceId','staffId')
       ) then
      raise exception 'INVALID_BOOKING_GROUP_LINES';
    end if;

    begin
      v_service_id := (v_item->>'serviceId')::uuid;
      v_staff_id := case
        when not (v_item ? 'staffId') or v_item->'staffId' = 'null'::jsonb then null
        else (v_item->>'staffId')::uuid
      end;
    exception when invalid_text_representation then
      raise exception 'INVALID_BOOKING_GROUP_LINES';
    end;

    select * into v_service
    from public.services s
    where s.business_id = p_business_id
      and s.id = v_service_id
      and s.active;
    if v_service.id is null then raise exception 'SERVICE_NOT_FOUND'; end if;

    if v_currency is null then
      v_currency := v_service.currency;
    elsif v_currency <> v_service.currency then
      raise exception 'CURRENCY_MISMATCH';
    end if;

    select count(*)::integer into v_staff_count
    from public.staff_profiles sp
    join public.staff_services ss
      on ss.business_id = sp.business_id
     and ss.staff_id = sp.id
     and ss.service_id = v_service_id
     and ss.active
    where sp.business_id = p_business_id
      and sp.active
      and (v_staff_id is null or sp.id = v_staff_id);

    if v_staff_count = 0 then raise exception 'STAFF_NOT_ELIGIBLE'; end if;
    v_product := v_product * v_staff_count;
    if v_product > 2048 then
      raise exception 'BOOKING_CANDIDATE_BUDGET_EXCEEDED';
    end if;

    v_lower := v_lower + v_service.price_min_minor;
    v_upper := v_upper + v_service.price_max_minor;
    if v_lower > 1000000000 or v_upper > 1000000000 then
      raise exception 'BOOKING_ESTIMATE_LIMIT_EXCEEDED';
    end if;

    v_specs := v_specs || jsonb_build_array(jsonb_build_object(
      'ordinal', v_ordinal,
      'serviceId', v_service.id,
      'serviceName', v_service.name,
      'preferredStaffId', v_staff_id,
      'durationMinutes', v_service.duration_minutes,
      'bufferBeforeMinutes', v_service.buffer_before_minutes,
      'bufferAfterMinutes', v_service.buffer_after_minutes,
      'processingMinutes', v_service.processing_minutes,
      'processingStaffMode', v_service.processing_staff_mode,
      'processingPolicyVersion', v_service.processing_policy_version,
      'priceType', v_service.price_type,
      'priceMinMinor', v_service.price_min_minor,
      'priceMaxMinor', v_service.price_max_minor,
      'pricePolicyVersion', v_service.price_policy_version,
      'currency', v_service.currency
    ));
  end loop;

  return jsonb_build_object(
    'timezone', v_business.timezone,
    'currency', v_currency,
    'lowerMinor', v_lower,
    'upperMinor', v_upper,
    'candidateProduct', v_product,
    'specs', v_specs
  );
end
$$;

revoke all on function public.f11_normalize_group_intent_internal(uuid,jsonb)
  from public, anon, authenticated;

-- PostgreSQL forbids referencing the recursive CTE row from a subquery inside
-- the recursive term. Keep the exact intra-plan same-staff overlap predicate in
-- a private immutable helper so the recursive term has one direct walk reference.
create or replace function public.f11_plan_lines_staff_overlap_internal(
  p_lines jsonb,
  p_staff_id uuid,
  p_occupied_start timestamptz,
  p_occupied_end timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) prior
    where (prior->>'staffId')::uuid = p_staff_id
      and (prior->>'occupiedStartsAt')::timestamptz < p_occupied_end
      and (prior->>'occupiedEndsAt')::timestamptz > p_occupied_start
  );
$$;

revoke all on function public.f11_plan_lines_staff_overlap_internal(jsonb,uuid,timestamptz,timestamptz)
  from public, anon, authenticated;

-- Build one deterministic concrete assignment for an exact absolute start.
-- Customer time is sequential. Staff time may end before customer processing time
-- only when the frozen service policy is RELEASE. A bounded recursive search, not
-- a greedy first-match loop, avoids false "unavailable" results when another
-- eligible staff assignment can satisfy later lines.
create or replace function public.f11_build_group_plan_internal(
  p_business_id uuid,
  p_starts_at timestamptz,
  p_lines jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_specs jsonb;
  v_timezone text;
  v_count integer;
  v_lines jsonb;
  v_plan jsonb;
  v_fingerprint text;
begin
  if p_starts_at is null then raise exception 'INVALID_START'; end if;

  v_meta := public.f11_normalize_group_intent_internal(p_business_id, p_lines);
  v_specs := v_meta->'specs';
  v_timezone := v_meta->>'timezone';
  v_count := jsonb_array_length(v_specs);

  with recursive
  specs as (
    select e.ordinality::integer as ordinal, e.value as spec
    from jsonb_array_elements(v_specs) with ordinality as e(value, ordinality)
  ),
  timeline as (
    select
      s.ordinal,
      s.spec,
      p_starts_at as line_start,
      p_starts_at
        + make_interval(
            mins => (s.spec->>'durationMinutes')::integer
              + (s.spec->>'processingMinutes')::integer
          ) as line_end,
      p_starts_at
        - make_interval(mins => (s.spec->>'bufferBeforeMinutes')::integer)
        as staff_occupied_start,
      p_starts_at
        + make_interval(
            mins => (s.spec->>'durationMinutes')::integer
              + case when s.spec->>'processingStaffMode' = 'hold'
                  then (s.spec->>'processingMinutes')::integer else 0 end
              + (s.spec->>'bufferAfterMinutes')::integer
          ) as staff_occupied_end
    from specs s
    where s.ordinal = 1

    union all

    select
      s.ordinal,
      s.spec,
      t.line_end,
      t.line_end
        + make_interval(
            mins => (s.spec->>'durationMinutes')::integer
              + (s.spec->>'processingMinutes')::integer
          ),
      t.line_end
        - make_interval(mins => (s.spec->>'bufferBeforeMinutes')::integer),
      t.line_end
        + make_interval(
            mins => (s.spec->>'durationMinutes')::integer
              + case when s.spec->>'processingStaffMode' = 'hold'
                  then (s.spec->>'processingMinutes')::integer else 0 end
              + (s.spec->>'bufferAfterMinutes')::integer
          )
    from timeline t
    join specs s on s.ordinal = t.ordinal + 1
  ),
  walk as (
    select
      0::integer as ordinal,
      '[]'::jsonb as lines,
      ''::text as assignment_key

    union all

    select
      w.ordinal + 1,
      w.lines || jsonb_build_array(
        t.spec || jsonb_build_object(
          'staffId', sp.id,
          'staffName', sp.name,
          'startsAt', t.line_start,
          'endsAt', t.line_end,
          'occupiedStartsAt', t.staff_occupied_start,
          'occupiedEndsAt', t.staff_occupied_end
        )
      ),
      w.assignment_key || '/' || sp.id::text
    from walk w
    join timeline t on t.ordinal = w.ordinal + 1
    join public.staff_profiles sp
      on sp.business_id = p_business_id
     and sp.active
     and (
       t.spec->'preferredStaffId' = 'null'::jsonb
       or sp.id = (t.spec->>'preferredStaffId')::uuid
     )
    join public.staff_services ss
      on ss.business_id = p_business_id
     and ss.staff_id = sp.id
     and ss.service_id = (t.spec->>'serviceId')::uuid
     and ss.active
    where
      -- The full customer/service span, including buffers when they extend it,
      -- must fit in one business-hours window on one local date.
      (t.staff_occupied_start at time zone v_timezone)::date
        = (greatest(t.line_end, t.staff_occupied_end) at time zone v_timezone)::date
      and exists (
        select 1
        from public.business_hours bh
        where bh.business_id = p_business_id
          and bh.active
          and bh.weekday = extract(
            dow from (t.staff_occupied_start at time zone v_timezone)::date
          )::smallint
          and bh.starts_local <= (t.staff_occupied_start at time zone v_timezone)::time
          and bh.ends_local >= (greatest(t.line_end, t.staff_occupied_end) at time zone v_timezone)::time
      )
      -- Staff availability covers only the staff occupancy interval. RELEASE may
      -- therefore free the person before the customer processing interval ends.
      and (t.staff_occupied_start at time zone v_timezone)::date
        = (t.staff_occupied_end at time zone v_timezone)::date
      and exists (
        select 1
        from public.staff_hours sh
        where sh.business_id = p_business_id
          and sh.staff_id = sp.id
          and sh.active
          and sh.weekday = extract(
            dow from (t.staff_occupied_start at time zone v_timezone)::date
          )::smallint
          and sh.starts_local <= (t.staff_occupied_start at time zone v_timezone)::time
          and sh.ends_local >= (t.staff_occupied_end at time zone v_timezone)::time
      )
      and not exists (
        select 1
        from public.availability_blocks ab
        where ab.business_id = p_business_id
          and ab.active
          and ab.staff_id is null
          and ab.starts_at < greatest(t.line_end, t.staff_occupied_end)
          and ab.ends_at > t.staff_occupied_start
      )
      and not exists (
        select 1
        from public.availability_blocks ab
        where ab.business_id = p_business_id
          and ab.active
          and ab.staff_id = sp.id
          and ab.starts_at < t.staff_occupied_end
          and ab.ends_at > t.staff_occupied_start
      )
      and not exists (
        select 1
        from public.appointments a
        where a.business_id = p_business_id
          and a.staff_id = sp.id
          and a.status <> 'cancelled'
          and a.occupied_starts_at < t.staff_occupied_end
          and a.occupied_ends_at > t.staff_occupied_start
      )
      and not public.f11_plan_lines_staff_overlap_internal(
        w.lines,
        sp.id,
        t.staff_occupied_start,
        t.staff_occupied_end
      )
  )
  select w.lines
  into v_lines
  from walk w
  where w.ordinal = v_count
  order by w.assignment_key
  limit 1;

  if v_lines is null then return null; end if;

  v_plan := jsonb_build_object(
    'startsAt', p_starts_at,
    'endsAt', (v_lines->(jsonb_array_length(v_lines) - 1))->>'endsAt',
    'timezone', v_timezone,
    'currency', v_meta->>'currency',
    'lowerMinor', (v_meta->>'lowerMinor')::bigint,
    'upperMinor', (v_meta->>'upperMinor')::bigint,
    'lines', v_lines
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(v_plan::text, 'sha256'),
    'hex'
  );

  return v_plan || jsonb_build_object('fingerprint', v_fingerprint);
end
$$;

revoke all on function public.f11_build_group_plan_internal(uuid,timestamptz,jsonb)
  from public, anon, authenticated;

create or replace function public.compute_booking_group_plans(
  p_business_id uuid,
  p_lines jsonb,
  p_date date,
  p_step_minutes integer default 15,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_timezone text;
  v_local timestamp without time zone;
  v_absolute timestamptz;
  v_plan jsonb;
  v_plans jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_truncated boolean := false;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_date is null
     or p_step_minutes is null or p_step_minutes not between 5 and 120
     or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'INVALID_GROUP_PLAN_QUERY';
  end if;

  select b.timezone into v_timezone
  from public.businesses b
  where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  if p_date < (now() at time zone v_timezone)::date - 1
     or p_date > (now() at time zone v_timezone)::date + 366 then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;

  -- Validate services/currency/candidate budget once even if the day has no slot.
  perform public.f11_normalize_group_intent_internal(p_business_id, p_lines);

  v_local := p_date::timestamp;
  while v_local < (p_date + 1)::timestamp loop
    v_absolute := v_local at time zone v_timezone;

    -- Spring-forward local times that PostgreSQL normalizes to another wall time
    -- are invalid candidates. Fall-back ambiguity stays server-resolved and is
    -- covered by the later F11-04 full timezone acceptance matrix.
    if (v_absolute at time zone v_timezone) = v_local then
      v_plan := public.f11_build_group_plan_internal(
        p_business_id, v_absolute, p_lines
      );
      if v_plan is not null then
        v_count := v_count + 1;
        if v_count <= p_limit then
          v_plans := v_plans || jsonb_build_array(v_plan);
        else
          v_truncated := true;
          exit;
        end if;
      end if;
    end if;

    v_local := v_local + make_interval(mins => p_step_minutes);
  end loop;

  return jsonb_build_object(
    'plans', v_plans,
    'truncated', v_truncated,
    'stepMinutes', p_step_minutes,
    'date', p_date,
    'timezone', v_timezone
  );
end
$$;

revoke all on function public.compute_booking_group_plans(uuid,jsonb,date,integer,integer)
  from public, anon, authenticated;
grant execute on function public.compute_booking_group_plans(uuid,jsonb,date,integer,integer)
  to authenticated;

-- The existing booking_commands table remains the single idempotency ledger.
-- This helper stores a group result without changing the legacy appointment-id
-- return contract of claim_booking_command().
alter table public.booking_commands
  drop constraint if exists booking_commands_command_check,
  add constraint booking_commands_command_check
    check (command in (
      'create','public_create','reschedule','status','public_reschedule','public_cancel',
      'group_create','public_group_create'
    ));

create or replace function public.f11_claim_group_booking_command(
  p_business_id uuid,
  p_idempotency_key text,
  p_command text,
  p_request_hash text
)
returns table(is_new boolean, group_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_existing public.booking_commands;
  v_source text := case when auth.uid() is null then 'public' else 'operator' end;
begin
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 8 and 128
     or p_request_hash is null
     or char_length(p_request_hash) not between 32 and 128
     or p_command not in ('group_create','public_group_create')
     or (p_command = 'group_create' and v_source <> 'operator')
     or (p_command = 'public_group_create' and v_source <> 'public') then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  insert into public.booking_commands(
    business_id, idempotency_key, command, request_hash,
    appointment_id, group_id, created_by, source
  ) values (
    p_business_id, p_idempotency_key, p_command, p_request_hash,
    null, null, auth.uid(), v_source
  )
  on conflict (business_id, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return query select true, null::uuid;
    return;
  end if;

  select * into v_existing
  from public.booking_commands bc
  where bc.business_id = p_business_id
    and bc.idempotency_key = p_idempotency_key;

  if v_existing.command is distinct from p_command
     or v_existing.request_hash is distinct from p_request_hash
     or v_existing.source is distinct from v_source then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.group_id is null then
    raise exception 'IDEMPOTENCY_IN_PROGRESS';
  end if;

  return query select false, v_existing.group_id;
end
$$;

revoke all on function public.f11_claim_group_booking_command(uuid,text,text,text)
  from public, anon, authenticated;

create or replace function public.f11_booking_group_result_internal(
  p_business_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.appointment_groups;
  v_lines jsonb;
  v_currency text;
  v_lower bigint;
  v_upper bigint;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text;
begin
  select * into v_group
  from public.appointment_groups g
  where g.business_id = p_business_id
    and g.id = p_group_id;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'lineId', a.id,
      'ordinal', a.line_ordinal,
      'serviceId', a.service_id,
      'staffId', a.staff_id,
      'status', a.status,
      'startsAt', a.starts_at,
      'endsAt', a.ends_at,
      'occupiedStartsAt', a.occupied_starts_at,
      'occupiedEndsAt', a.occupied_ends_at,
      'timezone', a.timezone,
      'customerName', a.customer_name_snapshot,
      'customerPhone', a.customer_phone_snapshot,
      'customerEmail', a.customer_email_snapshot,
      'serviceName', a.service_name_snapshot,
      'staffName', a.staff_name_snapshot,
      'durationMinutes', a.duration_minutes_snapshot,
      'bufferBeforeMinutes', a.buffer_before_minutes_snapshot,
      'bufferAfterMinutes', a.buffer_after_minutes_snapshot,
      'processingMinutes', a.processing_minutes_snapshot,
      'processingStaffMode', a.processing_staff_mode_snapshot,
      'processingPolicyVersion', a.processing_policy_version_snapshot,
      'priceType', a.price_type_snapshot,
      'priceMinMinor', a.price_min_minor_snapshot,
      'priceMaxMinor', a.price_max_minor_snapshot,
      'pricePolicyVersion', a.price_policy_version_snapshot,
      'currency', a.currency_snapshot,
      'legacyPriceMinor', a.price_minor_snapshot,
      'notes', a.notes
    ) order by a.line_ordinal), '[]'::jsonb),
    min(a.currency_snapshot),
    sum(a.price_min_minor_snapshot)::bigint,
    sum(a.price_max_minor_snapshot)::bigint,
    min(a.starts_at),
    max(a.ends_at),
    min(a.timezone)
  into v_lines, v_currency, v_lower, v_upper, v_starts_at, v_ends_at, v_timezone
  from public.appointments a
  where a.business_id = p_business_id
    and a.group_id = p_group_id;

  return jsonb_build_object(
    'groupId', v_group.id,
    'businessId', v_group.business_id,
    'customerId', v_group.customer_id,
    'status', v_group.status,
    'source', v_group.source,
    'version', v_group.version,
    'startsAt', v_starts_at,
    'endsAt', v_ends_at,
    'timezone', v_timezone,
    'currency', v_currency,
    'lowerMinor', v_lower,
    'upperMinor', v_upper,
    'lines', v_lines
  );
end
$$;

revoke all on function public.f11_booking_group_result_internal(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.create_booking_group(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_plan_fingerprint text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := trim(coalesce(p_customer_name, ''));
  v_customer_phone text := nullif(trim(p_customer_phone), '');
  v_customer_email text := public.f10_normalize_customer_email(coalesce(p_customer_email, ''));
  v_notes text := nullif(trim(p_notes), '');
  v_meta jsonb;
  v_canonical_lines jsonb;
  v_hash text;
  v_claim record;
  v_plan jsonb;
  v_locked_plan jsonb;
  v_fixed_lines jsonb;
  v_customer_id uuid;
  v_service_id uuid;
  v_staff_id uuid;
  v_group_id uuid;
  v_line jsonb;
  v_line_id uuid;
  v_price_minor integer;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if char_length(v_customer_name) not between 2 and 120
     or (v_customer_phone is not null and char_length(v_customer_phone) > 40)
     or (v_customer_email is not null and (char_length(v_customer_email) > 254 or position('@' in v_customer_email) < 2))
     or (v_notes is not null and char_length(v_notes) > 1000)
     or p_starts_at is null
     or p_plan_fingerprint is null
     or p_plan_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_BOOKING_GROUP';
  end if;

  v_meta := public.f11_normalize_group_intent_internal(p_business_id, p_lines);
  select jsonb_agg(jsonb_build_object(
    'serviceId', spec->>'serviceId',
    'staffId', spec->'preferredStaffId'
  ) order by (spec->>'ordinal')::integer)
  into v_canonical_lines
  from jsonb_array_elements(v_meta->'specs') spec;

  v_hash := pg_catalog.encode(
    extensions.digest(jsonb_build_object(
      'source', 'operator',
      'customerName', v_customer_name,
      'customerPhone', v_customer_phone,
      'customerEmail', v_customer_email,
      'startsAt', p_starts_at,
      'lines', v_canonical_lines,
      'planFingerprint', p_plan_fingerprint,
      'notes', v_notes
    )::text, 'sha256'),
    'hex'
  );

  select * into v_claim
  from public.f11_claim_group_booking_command(
    p_business_id, p_idempotency_key, 'group_create', v_hash
  );

  if not v_claim.is_new then
    return public.f11_booking_group_result_internal(p_business_id, v_claim.group_id);
  end if;

  v_plan := public.f11_build_group_plan_internal(p_business_id, p_starts_at, p_lines);
  if v_plan is null then raise exception 'SLOT_UNAVAILABLE'; end if;
  if v_plan->>'fingerprint' <> p_plan_fingerprint then
    raise exception 'BOOKING_PLAN_STALE';
  end if;

  -- Customer resolution uses the accepted F10-05 transaction-serialized authority.
  -- It occurs before service/staff locks so every F11-02 group create follows the
  -- same customer -> service -> staff lock order. Any later failure rolls it back.
  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id,
    v_customer_name,
    v_customer_phone,
    v_customer_email,
    null,
    auth.uid(),
    true
  );

  -- Freeze all selected service rows in stable UUID order against concurrent
  -- duration/price/processing edits. F10/F12 updates take row locks on the same rows.
  for v_service_id in
    select distinct (line->>'serviceId')::uuid
    from jsonb_array_elements(v_plan->'lines') line
    order by 1
  loop
    perform 1
    from public.services s
    where s.business_id = p_business_id
      and s.id = v_service_id
      and s.active
    for share;
    if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
  end loop;

  select jsonb_agg(jsonb_build_object(
    'serviceId', line->>'serviceId',
    'staffId', line->>'staffId'
  ) order by (line->>'ordinal')::integer)
  into v_fixed_lines
  from jsonb_array_elements(v_plan->'lines') line;

  -- Advisory staff locks serialize competing multi-staff creates in a globally
  -- stable order. The GIST exclusion remains the final physical integrity guard.
  for v_staff_id in
    select distinct (line->>'staffId')::uuid
    from jsonb_array_elements(v_plan->'lines') line
    order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'f11-02:staff:' || p_business_id::text || ':' || v_staff_id::text,
        0
      )
    );
  end loop;

  v_locked_plan := public.f11_build_group_plan_internal(
    p_business_id, p_starts_at, v_fixed_lines
  );
  if v_locked_plan is null then raise exception 'SLOT_UNAVAILABLE'; end if;
  if v_locked_plan->>'fingerprint' <> p_plan_fingerprint then
    raise exception 'BOOKING_PLAN_STALE';
  end if;

  v_group_id := gen_random_uuid();
  insert into public.appointment_groups(
    id, business_id, customer_id, status, source, version,
    legacy_appointment_id, created_by
  ) values (
    v_group_id, p_business_id, v_customer_id, 'scheduled', 'operator', 1,
    null, auth.uid()
  );

  for v_line in
    select value
    from jsonb_array_elements(v_locked_plan->'lines')
    order by (value->>'ordinal')::integer
  loop
    v_price_minor := case when v_line->>'priceType' = 'fixed'
      then (v_line->>'priceMinMinor')::integer else null end;

    insert into public.appointments(
      business_id, group_id, line_ordinal, customer_id, service_id, staff_id, status,
      starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      service_name_snapshot, staff_name_snapshot,
      duration_minutes_snapshot, buffer_before_minutes_snapshot, buffer_after_minutes_snapshot,
      processing_minutes_snapshot, processing_staff_mode_snapshot, processing_policy_version_snapshot,
      price_minor_snapshot, price_type_snapshot, price_min_minor_snapshot,
      price_max_minor_snapshot, price_policy_version_snapshot, currency_snapshot,
      notes, created_by, source
    ) values (
      p_business_id,
      v_group_id,
      (v_line->>'ordinal')::smallint,
      v_customer_id,
      (v_line->>'serviceId')::uuid,
      (v_line->>'staffId')::uuid,
      'scheduled',
      (v_line->>'startsAt')::timestamptz,
      (v_line->>'endsAt')::timestamptz,
      (v_line->>'occupiedStartsAt')::timestamptz,
      (v_line->>'occupiedEndsAt')::timestamptz,
      v_locked_plan->>'timezone',
      v_customer_name,
      v_customer_phone,
      v_customer_email,
      v_line->>'serviceName',
      v_line->>'staffName',
      (v_line->>'durationMinutes')::integer,
      (v_line->>'bufferBeforeMinutes')::integer,
      (v_line->>'bufferAfterMinutes')::integer,
      (v_line->>'processingMinutes')::integer,
      v_line->>'processingStaffMode',
      (v_line->>'processingPolicyVersion')::integer,
      v_price_minor,
      v_line->>'priceType',
      (v_line->>'priceMinMinor')::integer,
      (v_line->>'priceMaxMinor')::integer,
      (v_line->>'pricePolicyVersion')::integer,
      v_line->>'currency',
      v_notes,
      auth.uid(),
      'operator'
    ) returning id into v_line_id;
  end loop;

  insert into public.appointment_events(
    business_id, appointment_id, group_id, group_version,
    event_type, actor_user_id, actor_type,
    from_status, to_status, payload
  ) values (
    p_business_id, null, v_group_id, 1,
    'created', auth.uid(), 'member',
    null, 'scheduled',
    jsonb_build_object(
      'source', 'operator',
      'startsAt', p_starts_at,
      'lineCount', jsonb_array_length(v_locked_plan->'lines'),
      'planFingerprint', p_plan_fingerprint
    )
  );

  update public.booking_commands bc
  set group_id = v_group_id
  where bc.business_id = p_business_id
    and bc.idempotency_key = p_idempotency_key
    and bc.command = 'group_create'
    and bc.request_hash = v_hash
    and bc.group_id is null;
  if not found then raise exception 'IDEMPOTENCY_CONFLICT'; end if;

  return public.f11_booking_group_result_internal(p_business_id, v_group_id);
exception when exclusion_violation then
  raise exception 'APPOINTMENT_CONFLICT';
end
$$;

revoke all on function public.create_booking_group(uuid,text,text,jsonb,timestamptz,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.create_booking_group(uuid,text,text,jsonb,timestamptz,text,text,text,text)
  to authenticated;

-- Existing operator projection grows additively with the frozen processing policy.
create or replace function public.get_booking_group_contract(
  p_business_id uuid,
  p_group_id uuid
)
returns table(
  group_id uuid,
  business_id uuid,
  customer_id uuid,
  status text,
  source text,
  version integer,
  legacy_appointment_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_group public.appointment_groups;
  v_lines jsonb;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id = p_business_id
    and g.id = p_group_id;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lineId', a.id,
    'ordinal', a.line_ordinal,
    'serviceId', a.service_id,
    'staffId', a.staff_id,
    'status', a.status,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'occupiedStartsAt', a.occupied_starts_at,
    'occupiedEndsAt', a.occupied_ends_at,
    'timezone', a.timezone,
    'customerName', a.customer_name_snapshot,
    'customerPhone', a.customer_phone_snapshot,
    'customerEmail', a.customer_email_snapshot,
    'serviceName', a.service_name_snapshot,
    'staffName', a.staff_name_snapshot,
    'durationMinutes', a.duration_minutes_snapshot,
    'bufferBeforeMinutes', a.buffer_before_minutes_snapshot,
    'bufferAfterMinutes', a.buffer_after_minutes_snapshot,
    'processingMinutes', a.processing_minutes_snapshot,
    'processingStaffMode', a.processing_staff_mode_snapshot,
    'processingPolicyVersion', a.processing_policy_version_snapshot,
    'priceType', a.price_type_snapshot,
    'priceMinMinor', a.price_min_minor_snapshot,
    'priceMaxMinor', a.price_max_minor_snapshot,
    'currency', a.currency_snapshot,
    'pricePolicyVersion', a.price_policy_version_snapshot,
    'legacyPriceMinor', a.price_minor_snapshot,
    'notes', a.notes,
    'cancellationReason', a.cancellation_reason
  ) order by a.line_ordinal), '[]'::jsonb)
  into v_lines
  from public.appointments a
  where a.business_id = p_business_id
    and a.group_id = p_group_id;

  return query select
    v_group.id,
    v_group.business_id,
    v_group.customer_id,
    v_group.status,
    v_group.source,
    v_group.version,
    v_group.legacy_appointment_id,
    v_group.created_at,
    v_group.updated_at,
    v_lines;
end
$$;

revoke all on function public.get_booking_group_contract(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_booking_group_contract(uuid,uuid)
  to authenticated;

commit;
