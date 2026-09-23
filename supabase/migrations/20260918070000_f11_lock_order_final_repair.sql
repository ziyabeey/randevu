begin;

-- F11-04 final lock-order repair.
-- 1) Fresh group create acquires all F10-04 mutable schedule-authority advisory
--    families before its participating-staff FOR UPDATE locks.
-- 2) The deferred final authority fence uses NO KEY UPDATE for service/staff
--    parent rows so concurrent booking FK KEY SHARE cannot form a conversion
--    deadlock, while guarded non-key authority edits still serialize.

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
  v_authority_weekday smallint;
  v_authority_staff_day record;
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
    'f11:group-command:' || p_idempotency_key /* H19 M4 mutant: tenant dimension removed from lock scope */, 0
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

  -- Acquire every mutable F10-04 schedule-authority advisory family before
  -- taking the stronger participating-staff row locks below. The deferred
  -- authority guard reacquires the same namespaces at commit, but taking them
  -- here removes row-before-advisory inversions with guarded hours/block writes.
  for v_authority_weekday in
    select distinct
      extract(dow from (((l->>'startsAt')::timestamptz at time zone v_timezone)::date))::smallint
    from jsonb_array_elements(v_plan->'lines') l
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f10-04:business-hours:'||p_business_id::text||':'||v_authority_weekday::text,0
    ));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:availability-blocks:'||p_business_id::text,0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:assignments:'||p_business_id::text,0
  ));

  for v_authority_staff_day in
    select distinct
      (l->>'staffId')::uuid as staff_id,
      extract(dow from (((l->>'startsAt')::timestamptz at time zone v_timezone)::date))::smallint as weekday
    from jsonb_array_elements(v_plan->'lines') l
    order by staff_id,weekday
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f10-04:staff-hours:'||p_business_id::text||':'||
      v_authority_staff_day.staff_id::text||':'||v_authority_staff_day.weekday::text,0
    ));
  end loop;

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

create or replace function public.f11_validate_native_group_schedule_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_legacy uuid;
  v_timezone text;
  v_weekday smallint;
  v_staff_day record;
  v_require_active_service boolean;
begin
  if new.group_id is null or new.business_id is null then return null; end if;

  if tg_op='UPDATE'
     and new.service_id is not distinct from old.service_id
     and new.staff_id is not distinct from old.staff_id
     and new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at
     and new.occupied_starts_at is not distinct from old.occupied_starts_at
     and new.occupied_ends_at is not distinct from old.occupied_ends_at then
    return null;
  end if;

  select g.legacy_appointment_id into v_legacy
  from public.appointment_groups g
  where g.business_id=new.business_id and g.id=new.group_id;
  if not found or v_legacy is not null then return null; end if;

  select b.timezone into v_timezone
  from public.businesses b where b.id=new.business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;

  -- Match accepted F10-04 authority namespaces. The group-management/command
  -- locks are already held by the calling F11 RPCs; these locks bind mutable
  -- schedule/catalog authority to the final durable state. Acquire every F10-04
  -- advisory family before row locks so guarded writes that later take FK key
  -- shares cannot form a row-lock/advisory-lock inversion with this trigger.
  for v_weekday in
    select distinct extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
    from public.appointments a
    where a.business_id=new.business_id and a.group_id=new.group_id
      and a.status in ('scheduled','confirmed')
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f10-04:business-hours:'||new.business_id::text||':'||v_weekday::text,0
    ));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:availability-blocks:'||new.business_id::text,0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'f10-04:assignments:'||new.business_id::text,0
  ));

  for v_staff_day in
    select distinct
      a.staff_id,
      extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint as weekday
    from public.appointments a
    where a.business_id=new.business_id and a.group_id=new.group_id
      and a.status in ('scheduled','confirmed')
    order by a.staff_id,weekday
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'f10-04:staff-hours:'||new.business_id::text||':'||v_staff_day.staff_id::text||':'||v_staff_day.weekday::text,0
    ));
  end loop;

  -- Stable row order prevents service/staff/assignment lock inversions between
  -- two multi-line groups. Parent authority rows use NO KEY UPDATE: it fences
  -- guarded non-key catalog/staff edits while remaining compatible with FK
  -- KEY SHARE already held by another booking transaction.
  perform 1
  from public.services s
  where s.business_id=new.business_id
    and s.id in (
      select a.service_id from public.appointments a
      where a.business_id=new.business_id and a.group_id=new.group_id
        and a.status in ('scheduled','confirmed')
    )
  order by s.id
  for no key update;

  perform 1
  from public.staff_profiles sp
  where sp.business_id=new.business_id
    and sp.id in (
      select a.staff_id from public.appointments a
      where a.business_id=new.business_id and a.group_id=new.group_id
        and a.status in ('scheduled','confirmed')
    )
  order by sp.id
  for no key update;

  perform 1
  from public.staff_services ss
  where ss.business_id=new.business_id
    and (ss.staff_id,ss.service_id) in (
      select a.staff_id,a.service_id
      from public.appointments a
      where a.business_id=new.business_id and a.group_id=new.group_id
        and a.status in ('scheduled','confirmed')
    )
  order by ss.staff_id,ss.service_id
  for update;

  v_require_active_service := tg_op='INSERT'
    or (tg_op='UPDATE' and new.service_id is distinct from old.service_id);
  if v_require_active_service and not exists (
    select 1 from public.services s
    where s.business_id=new.business_id and s.id=new.service_id and s.active
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Current staff eligibility, assignment, hours and blocks remain authoritative
  -- for every active line. Service active state is required for fresh create or
  -- an explicit service replacement; schedule-only moves preserve frozen
  -- historical service snapshots even if today's catalog is archived.
  if exists (
    select 1
    from public.appointments a
    where a.business_id=new.business_id and a.group_id=new.group_id
      and a.status in ('scheduled','confirmed')
      and (
        not exists (
          select 1 from public.staff_profiles sp
          where sp.business_id=a.business_id and sp.id=a.staff_id and sp.active
        )
        or not exists (
          select 1 from public.staff_services ss
          where ss.business_id=a.business_id and ss.staff_id=a.staff_id
            and ss.service_id=a.service_id and ss.active
        )
        or not exists (
          select 1
          from public.business_hours bh
          where bh.business_id=a.business_id
            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+bh.starts_local) at time zone v_timezone) <= a.starts_at
            and ((((a.starts_at at time zone v_timezone)::date)+bh.ends_local) at time zone v_timezone) >= a.ends_at
        )
        or exists (
          select 1 from public.availability_blocks ab
          where ab.business_id=a.business_id and ab.staff_id is null and ab.active
            and ab.starts_at<a.ends_at and ab.ends_at>a.starts_at
        )
        or not exists (
          select 1
          from public.business_hours bh
          join public.staff_hours sh
            on sh.business_id=bh.business_id
           and sh.staff_id=a.staff_id
           and sh.weekday=bh.weekday
           and sh.active
          where bh.business_id=a.business_id
            and bh.weekday=extract(dow from (a.starts_at at time zone v_timezone)::date)::smallint
            and bh.active
            and ((((a.starts_at at time zone v_timezone)::date)+greatest(bh.starts_local,sh.starts_local)) at time zone v_timezone) <= a.occupied_starts_at
            and ((((a.starts_at at time zone v_timezone)::date)+least(bh.ends_local,sh.ends_local)) at time zone v_timezone) >= a.occupied_ends_at
        )
        or exists (
          select 1 from public.availability_blocks ab
          where ab.business_id=a.business_id and ab.active
            and (ab.staff_id is null or ab.staff_id=a.staff_id)
            and ab.starts_at<a.occupied_ends_at and ab.ends_at>a.occupied_starts_at
        )
      )
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  return null;
end
$$;

revoke all on function public.f11_validate_native_group_schedule_authority()
  from public,anon,authenticated;

commit;
