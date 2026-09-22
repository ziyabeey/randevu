begin;

-- F11-02 final binding repair: a RELEASE policy shortens only the staff's
-- occupied interval. The complete customer-facing service interval must still
-- fit one local business-hours window and remain outside tenant-wide closures.
-- Staff-specific closures continue to be evaluated against staff occupancy by
-- f11_staff_slot_free, preserving the intentional released-tail behavior.
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
  v_requested_count integer;
  v_valid_count integer;
  v_currency_count integer;
  v_currency text;
  v_estimate_min integer;
  v_estimate_max integer;
  v_line record;
  v_cursor timestamptz := p_starts_at;
  v_prev_staff uuid := null;
  v_prev_index integer := 0;
  v_staff_id uuid;
  v_staff_name text;
  v_service_start timestamptz;
  v_service_end timestamptz;
  v_staff_active_end timestamptz;
  v_occ_start timestamptz;
  v_occ_end timestamptz;
  v_plan jsonb := '[]'::jsonb;
  v_candidate record;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'INVALID_GROUP_LINES';
  end if;
  v_requested_count := jsonb_array_length(p_lines);

  select
    count(*)::integer,
    count(distinct d.currency)::integer,
    min(d.currency),
    coalesce(sum(d.price_min_minor), 0)::integer,
    coalesce(sum(d.price_max_minor), 0)::integer
  into v_valid_count, v_currency_count, v_currency, v_estimate_min, v_estimate_max
  from public.f11_group_line_defs_v2(p_business_id, p_lines) d;

  if v_valid_count <> v_requested_count then
    raise exception 'SERVICE_NOT_FOUND';
  end if;
  if v_currency_count <> 1 then
    raise exception 'MIXED_CURRENCY';
  end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id = p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_date := (p_starts_at at time zone v_timezone)::date;

  for v_line in select * from public.f11_group_line_defs_v2(p_business_id, p_lines) loop
    v_service_start := v_cursor;
    v_service_end := v_service_start + make_interval(mins => v_line.duration_minutes);
    v_staff_active_end := case
      when v_line.processing_capacity_policy = 'RELEASE'
        then v_service_end - make_interval(mins => v_line.passive_wait_minutes)
      else v_service_end
    end;

    -- Business authority follows the customer's complete [start,end) service
    -- interval, regardless of how much of that interval occupies staff.
    if not exists (
      select 1
      from public.business_hours bh
      where bh.weekday = extract( -- H19 M4 mutant: tenant fence intentionally removed

          dow from (v_service_start at time zone v_timezone)::date
        )::smallint
        and bh.active
        and ((
          (v_service_start at time zone v_timezone)::date + bh.starts_local
        ) at time zone v_timezone) <= v_service_start
        and ((
          (v_service_start at time zone v_timezone)::date + bh.ends_local
        ) at time zone v_timezone) >= v_service_end
    ) or exists (
      select 1
      from public.availability_blocks ab
      where ab.business_id = p_business_id
        and ab.staff_id is null
        and ab.active
        and ab.starts_at < v_service_end
        and ab.ends_at > v_service_start
    ) then
      return null;
    end if;

    v_staff_id := null;
    v_staff_name := null;

    if v_prev_staff is not null then
      v_occ_start := v_service_start;
      v_occ_end := v_staff_active_end + make_interval(mins => v_line.buffer_after_minutes);
      if (v_line.pinned_staff_id is null or v_line.pinned_staff_id = v_prev_staff)
         and public.f11_staff_slot_free(
               p_business_id, v_prev_staff, v_line.service_id, v_date,
               v_occ_start, v_occ_end, p_ignore_group_id) then
        select sp.name into v_staff_name
        from public.staff_profiles sp
        where sp.business_id = p_business_id and sp.id = v_prev_staff;
        v_staff_id := v_prev_staff;
      end if;
    end if;

    if v_staff_id is null then
      v_occ_start := v_service_start - make_interval(mins => v_line.buffer_before_minutes);
      v_occ_end := v_staff_active_end + make_interval(mins => v_line.buffer_after_minutes);
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

    if v_staff_id is null then return null; end if;

    if v_prev_staff is not null and v_staff_id = v_prev_staff then
      v_plan := jsonb_set(
        v_plan,
        array[(v_prev_index - 1)::text, 'occupiedEndsAt'],
        v_plan -> (v_prev_index - 1) -> 'staffActiveEndsAt'
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
      'staffActiveEndsAt', v_staff_active_end,
      'occupiedStartsAt', v_occ_start,
      'occupiedEndsAt', v_occ_end,
      'durationMinutes', v_line.duration_minutes,
      'bufferBeforeMinutes', v_line.buffer_before_minutes,
      'bufferAfterMinutes', v_line.buffer_after_minutes,
      'processingCapacityPolicy', v_line.processing_capacity_policy,
      'passiveWaitMinutes', v_line.passive_wait_minutes,
      'processingPolicyVersion', v_line.processing_policy_version,
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

  if jsonb_array_length(v_plan) = 0 then return null; end if;

  return jsonb_build_object(
    'startsAt', p_starts_at,
    'endsAt', v_cursor,
    'timezone', v_timezone,
    'currency', v_currency,
    'estimateMinMinor', v_estimate_min,
    'estimateMaxMinor', v_estimate_max,
    'lines', v_plan
  );
end
$$;

revoke all on function public.f11_plan_group_at(uuid,jsonb,timestamptz,uuid)
  from public, anon, authenticated;

-- Replay identity is anchored in the original command, not current catalog
-- availability. Keep fresh binding validation ahead of new durable writes.
create or replace function public.f11_create_group_internal(
  p_business_id uuid,
  p_idempotency_key text,
  p_customer_name text,
  p_lines jsonb,
  p_starts_at timestamptz,
  p_source text,
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
  v_requested_count integer;
  v_valid_count integer;
  v_currency_count integer;
  v_hash text;
  v_claim record;
  v_plan jsonb;
  v_line jsonb;
  v_customer_id uuid;
  v_group_id uuid;
  v_anchor_id uuid;
  v_timezone text;
  v_existing_group uuid;
  v_actor uuid := case when p_source = 'operator' then auth.uid() else null end;
begin
  if p_source not in ('operator','public') then raise exception 'INVALID_GROUP_SOURCE'; end if;
  if char_length(v_customer_name) < 2 or char_length(v_customer_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_customer_phone is not null and char_length(v_customer_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_customer_email is not null and (char_length(v_customer_email) > 254 or position('@' in v_customer_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if p_source = 'public' and v_customer_phone is null and v_customer_email is null then
    raise exception 'PUBLIC_CONTACT_REQUIRED';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then raise exception 'NOTES_TOO_LONG'; end if;
  if p_starts_at is null then raise exception 'INVALID_START'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_GROUP_LINES'; end if;

  -- Bound untrusted input even for a replay, without consulting mutable
  -- service catalog state before resolving an existing command.
  v_requested_count := jsonb_array_length(p_lines);
  if v_requested_count < 1 then raise exception 'INVALID_GROUP_LINES'; end if;
  if v_requested_count > public.f11_group_line_limit() then
    raise exception 'GROUP_LINE_LIMIT_EXCEEDED';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) < 8
     or char_length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  v_hash := md5(jsonb_build_object(
    'source', p_source,
    'customerName', v_customer_name,
    'customerPhone', v_customer_phone,
    'customerEmail', v_customer_email,
    'lines', p_lines,
    'startsAt', p_starts_at,
    'notes', v_notes
  )::text);

  -- Serialize this group's key before the read-only replay probe. A locked
  -- existing command is validated by the canonical claim routine below and
  -- returns frozen line data even if today's catalog is archived or repriced.
  perform pg_advisory_xact_lock(hashtextextended(
    'f11:group-command:' || p_business_id::text || ':' || p_idempotency_key, 0
  ));
  perform 1
  from public.booking_commands bc
  where bc.business_id = p_business_id
    and bc.idempotency_key = p_idempotency_key
  for update;

  if not found then
    -- Fresh commands must resolve every requested line in the active tenant
    -- catalog and one currency before any durable command/customer/group write.
    select count(*)::integer, count(distinct d.currency)::integer
      into v_valid_count, v_currency_count
    from public.f11_group_line_defs_v2(p_business_id, p_lines) d;
    if v_valid_count <> v_requested_count then raise exception 'SERVICE_NOT_FOUND'; end if;
    if v_currency_count <> 1 then raise exception 'MIXED_CURRENCY'; end if;
  end if;

  select * into v_claim
  from public.claim_booking_command(
    p_business_id,
    p_idempotency_key,
    case when p_source = 'public' then 'public_create_group' else 'create_group' end,
    v_hash,
    null
  );

  if not v_claim.is_new then
    select a.group_id into v_existing_group
    from public.appointments a
    where a.business_id = p_business_id and a.id = v_claim.appointment_id;
    if v_existing_group is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    return public.f11_group_payload(p_business_id, v_existing_group);
  end if;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
  if v_plan is null then raise exception 'GROUP_SLOT_UNAVAILABLE'; end if;
  v_timezone := v_plan->>'timezone';

  v_customer_id := public.f10_resolve_or_create_customer(
    p_business_id, v_customer_name, v_customer_phone, v_customer_email,
    null, v_actor, true
  );

  perform 1
  from public.staff_profiles sp
  where sp.business_id = p_business_id
    and sp.id in (
      select distinct (l->>'staffId')::uuid
      from jsonb_array_elements(v_plan->'lines') l
    )
  order by sp.id
  for update;

  v_plan := public.f11_plan_group_at(p_business_id, p_lines, p_starts_at, null);
  if v_plan is null then raise exception 'GROUP_SLOT_UNAVAILABLE'; end if;

  v_group_id := gen_random_uuid();
  insert into public.appointment_groups(
    id,business_id,customer_id,status,source,version,legacy_appointment_id,created_by
  ) values (
    v_group_id,p_business_id,v_customer_id,'scheduled',p_source,1,null,v_actor
  );

  set constraints appointments_staff_no_overlap deferred;

  for v_line in select * from jsonb_array_elements(v_plan->'lines') loop
    insert into public.appointments(
      business_id,customer_id,service_id,staff_id,status,source,
      group_id,line_ordinal,
      starts_at,ends_at,occupied_starts_at,occupied_ends_at,timezone,
      customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
      service_name_snapshot,staff_name_snapshot,
      duration_minutes_snapshot,buffer_before_minutes_snapshot,buffer_after_minutes_snapshot,
      processing_capacity_policy_snapshot,passive_wait_minutes_snapshot,processing_policy_version_snapshot,
      price_minor_snapshot,currency_snapshot,
      price_type_snapshot,price_min_minor_snapshot,price_max_minor_snapshot,price_policy_version_snapshot,
      notes,created_by
    ) values (
      p_business_id,v_customer_id,
      (v_line->>'serviceId')::uuid,(v_line->>'staffId')::uuid,'scheduled',p_source,
      v_group_id,(v_line->>'lineOrdinal')::smallint,
      (v_line->>'startsAt')::timestamptz,(v_line->>'endsAt')::timestamptz,
      (v_line->>'occupiedStartsAt')::timestamptz,(v_line->>'occupiedEndsAt')::timestamptz,
      v_timezone,
      v_customer_name,v_customer_phone,v_customer_email,
      v_line->>'serviceName',v_line->>'staffName',
      (v_line->>'durationMinutes')::integer,
      (v_line->>'bufferBeforeMinutes')::integer,
      (v_line->>'bufferAfterMinutes')::integer,
      v_line->>'processingCapacityPolicy',
      (v_line->>'passiveWaitMinutes')::integer,
      (v_line->>'processingPolicyVersion')::bigint,
      nullif(v_line->>'priceMinor','')::integer,
      v_line->>'currency',
      v_line->>'priceType',
      (v_line->>'priceMinMinor')::integer,
      (v_line->>'priceMaxMinor')::integer,
      (v_line->>'pricePolicyVersion')::integer,
      v_notes,v_actor
    )
    returning id into v_anchor_id;

    if (v_line->>'lineOrdinal')::integer <> 1 then
      v_anchor_id := (
        select a.id from public.appointments a
        where a.business_id = p_business_id and a.group_id = v_group_id and a.line_ordinal = 1
      );
    end if;
  end loop;

  begin
    set constraints appointments_staff_no_overlap immediate;
  exception when exclusion_violation then
    raise exception 'APPOINTMENT_CONFLICT';
  end;

  select a.id into v_anchor_id
  from public.appointments a
  where a.business_id = p_business_id and a.group_id = v_group_id and a.line_ordinal = 1;

  insert into public.appointment_events(
    business_id,appointment_id,event_type,actor_user_id,actor_type,from_status,to_status,payload
  ) values (
    p_business_id,v_anchor_id,'created',v_actor,
    case when p_source='public' then 'public' else 'member' end,
    null,'scheduled',
    jsonb_build_object(
      'startsAt',p_starts_at,
      'lineCount',jsonb_array_length(v_plan->'lines'),
      'currency',v_plan->>'currency',
      'estimateMinMinor',(v_plan->>'estimateMinMinor')::integer,
      'estimateMaxMinor',(v_plan->>'estimateMaxMinor')::integer,
      'lines',v_plan->'lines'
    )
  );

  update public.booking_commands
  set appointment_id = v_anchor_id
  where business_id = p_business_id and idempotency_key = p_idempotency_key;

  return public.f11_group_payload(p_business_id, v_group_id);
end
$$;

revoke all on function public.f11_create_group_internal(
  uuid,text,text,jsonb,timestamptz,text,text,text,text
) from public, anon, authenticated;

commit;
