begin;

-- Authenticated business catalog is one database snapshot and one PostgREST row.
-- Every collection is probed at max+1 inside PostgreSQL so hosted API row caps
-- cannot turn an oversized catalog into a partial successful response.
create or replace function public.get_catalog_snapshot(p_business_id uuid)
returns table(
  services jsonb,
  staff jsonb,
  assignments jsonb
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_user uuid := auth.uid();
  v_services jsonb := '[]'::jsonb;
  v_staff jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_service_count integer := 0;
  v_staff_count integer := 0;
  v_assignment_count integer := 0;
begin
  if v_user is null or not exists (
    select 1
    from public.memberships m
    where m.business_id = p_business_id
      and m.user_id = v_user
      and m.active
  ) then
    raise exception 'NOT_ALLOWED';
  end if;

  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'name', q.name,
          'duration_minutes', q.duration_minutes,
          'buffer_before_minutes', q.buffer_before_minutes,
          'buffer_after_minutes', q.buffer_after_minutes,
          'price_minor', q.price_minor,
          'currency', q.currency,
          'active', q.active
        ) order by q.created_at, q.id
      ),
      '[]'::jsonb
    )
  into v_service_count, v_services
  from (
    select
      sv.id,
      sv.name,
      sv.duration_minutes,
      sv.buffer_before_minutes,
      sv.buffer_after_minutes,
      sv.price_minor,
      sv.currency,
      sv.active,
      sv.created_at
    from public.services sv
    where sv.business_id = p_business_id
    order by sv.created_at, sv.id
    limit 101
  ) q;

  if v_service_count > 100 then
    raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED';
  end if;

  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'membership_id', q.membership_id,
          'name', q.name,
          'phone', q.phone,
          'active', q.active
        ) order by q.created_at, q.id
      ),
      '[]'::jsonb
    )
  into v_staff_count, v_staff
  from (
    select sp.id, sp.membership_id, sp.name, sp.phone, sp.active, sp.created_at
    from public.staff_profiles sp
    where sp.business_id = p_business_id
    order by sp.created_at, sp.id
    limit 101
  ) q;

  if v_staff_count > 100 then
    raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED';
  end if;

  select
    count(*),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'staff_id', q.staff_id,
          'service_id', q.service_id,
          'active', q.active
        ) order by q.staff_id, q.service_id
      ),
      '[]'::jsonb
    )
  into v_assignment_count, v_assignments
  from (
    select ss.staff_id, ss.service_id, ss.active
    from public.staff_services ss
    where ss.business_id = p_business_id
    order by ss.staff_id, ss.service_id
    limit 5001
  ) q;

  if v_assignment_count > 5000 then
    raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED';
  end if;

  return query select v_services, v_staff, v_assignments;
end
$$;

-- C2b keeps the public catalog atomic: read at most max+1, then fail the whole
-- snapshot if the 101st row exists. No partial first-100 response is exposed.
create or replace function public.get_public_booking_services(p_slug text)
returns table(
  service_id uuid,
  name text,
  duration_minutes integer,
  price_minor integer,
  currency text
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_rows integer;
begin
  return query
  select sv.id, sv.name, sv.duration_minutes, sv.price_minor, sv.currency
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  join public.services sv on sv.business_id = b.id and sv.active
  where lower(b.slug) = lower(trim(p_slug))
    and exists (
      select 1
      from public.staff_services ss
      join public.staff_profiles sp
        on sp.business_id = ss.business_id
       and sp.id = ss.staff_id
       and sp.active
      where ss.business_id = b.id
        and ss.service_id = sv.id
        and ss.active
    )
  order by sv.name, sv.id
  limit 101;

  get diagnostics v_rows = row_count;
  if v_rows > 100 then
    raise exception 'PUBLIC_SERVICES_LIMIT_EXCEEDED';
  end if;
end
$$;

create or replace function public.get_public_booking_staff(
  p_slug text,
  p_service_id uuid
)
returns table(staff_id uuid, staff_name text)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_rows integer;
begin
  return query
  select sp.id, sp.name
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  join public.services sv
    on sv.business_id = b.id and sv.id = p_service_id and sv.active
  join public.staff_services ss
    on ss.business_id = b.id and ss.service_id = sv.id and ss.active
  join public.staff_profiles sp
    on sp.business_id = b.id and sp.id = ss.staff_id and sp.active
  where lower(b.slug) = lower(trim(p_slug))
  order by sp.name, sp.id
  limit 101;

  get diagnostics v_rows = row_count;
  if v_rows > 100 then
    raise exception 'PUBLIC_STAFF_LIMIT_EXCEEDED';
  end if;
end
$$;

-- Preserve the S07 sanitized error envelope while allowing the two explicit C2b
-- capacity results to cross the server-gated public RPC boundary.
create or replace function public.public_operation_error(p_message text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','PUBLIC_BOOKING_DISABLED','IDEMPOTENCY_CONFLICT',
      'IDEMPOTENCY_IN_PROGRESS','APPOINTMENT_CONFLICT','SLOT_UNAVAILABLE','DATE_OUT_OF_RANGE',
      'PUBLIC_CONTACT_REQUIRED','INVALID_CUSTOMER_NAME','INVALID_CUSTOMER_PHONE',
      'INVALID_CUSTOMER_EMAIL','NOTES_TOO_LONG','INVALID_START','INVALID_DATE',
      'INVALID_BOOKING_RECOVERY_BOOTSTRAP','INVALID_IDEMPOTENCY_KEY',
      'BOOKING_INTENT_CLOSED','BOOKING_INTENT_DEADLINE_EXPIRED',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION','PUBLIC_SERVICES_LIMIT_EXCEEDED','PUBLIC_STAFF_LIMIT_EXCEEDED'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

-- ACLs are explicit because this migration runs after hosted ACL hardening.
revoke all on function public.get_catalog_snapshot(uuid) from public, anon;
grant execute on function public.get_catalog_snapshot(uuid) to authenticated;

-- Raw public catalog functions stay inaccessible to browser roles; only the
-- already-gated execute_public_operation wrapper may invoke them.
revoke all on function public.get_public_booking_services(text) from public, anon, authenticated;
revoke all on function public.get_public_booking_staff(text,uuid) from public, anon, authenticated;
revoke all on function public.public_operation_error(text) from public, anon, authenticated;

commit;
