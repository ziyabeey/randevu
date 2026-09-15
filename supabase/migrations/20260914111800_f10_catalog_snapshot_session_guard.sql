begin;

-- get_catalog_snapshot is intentionally executable by authenticated users because
-- it backs the bounded catalog read. As an exposed SECURITY DEFINER RPC it must
-- still enforce the F10 standard-session boundary itself; Worker recovery checks
-- are not authority for direct Data API calls.
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
  perform public.f10_require_standard_session();
  if v_user is null or not exists (
    select 1
    from public.memberships m
    where m.business_id = p_business_id
      and m.user_id = v_user
      and m.active
  ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'name', q.name,
      'duration_minutes', q.duration_minutes,
      'buffer_before_minutes', q.buffer_before_minutes,
      'buffer_after_minutes', q.buffer_after_minutes,
      'price_minor', q.price_minor,
      'currency', q.currency,
      'active', q.active,
      'updated_at', q.updated_at
    ) order by q.created_at, q.id), '[]'::jsonb)
  into v_service_count, v_services
  from (
    select sv.id, sv.name, sv.duration_minutes, sv.buffer_before_minutes,
      sv.buffer_after_minutes, sv.price_minor, sv.currency, sv.active,
      sv.created_at, sv.updated_at
    from public.services sv
    where sv.business_id = p_business_id
    order by sv.created_at, sv.id
    limit 101
  ) q;
  if v_service_count > 100 then raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED'; end if;

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'membership_id', q.membership_id,
      'name', q.name,
      'phone', q.phone,
      'active', q.active,
      'updated_at', q.updated_at
    ) order by q.created_at, q.id), '[]'::jsonb)
  into v_staff_count, v_staff
  from (
    select sp.id, sp.membership_id, sp.name, sp.phone, sp.active,
      sp.created_at, sp.updated_at
    from public.staff_profiles sp
    where sp.business_id = p_business_id
    order by sp.created_at, sp.id
    limit 101
  ) q;
  if v_staff_count > 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;

  select
    count(*),
    coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', q.staff_id,
      'service_id', q.service_id,
      'active', q.active,
      'updated_at', q.updated_at
    ) order by q.staff_id, q.service_id), '[]'::jsonb)
  into v_assignment_count, v_assignments
  from (
    select ss.staff_id, ss.service_id, ss.active, ss.updated_at
    from public.staff_services ss
    where ss.business_id = p_business_id
    order by ss.staff_id, ss.service_id
    limit 5001
  ) q;
  if v_assignment_count > 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;

  return query select v_services, v_staff, v_assignments;
end
$$;

revoke all on function public.get_catalog_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.get_catalog_snapshot(uuid)
  to authenticated;

commit;
