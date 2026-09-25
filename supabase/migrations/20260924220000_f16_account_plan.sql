begin;

-- F16-08: account summary and plan access.
--
-- The plan comes from real data: core.subscriptions (KC-01), which a manual
-- pilot activation or the platform billing command path writes. This app never
-- charges a subscription. A business without a subscription row is on the
-- manually activated pilot plan with full access.
--
--   pilot | trial | active | past_due  -> full access (past_due is shown as a warning)
--   cancelled                          -> read-only
--
-- Read-only means:
--   * the salon is not publishable: no new public booking, slot or promo
--     preview (enforced in the database through the shared readiness function
--     every public path already uses, including the public appointment insert
--     guard);
--   * existing customers keep their management link: viewing and cancelling an
--     existing appointment are updates, not public inserts, and stay available;
--   * member writes are refused by the Worker API before any RPC runs, while
--     reads (calendar, customers, reports) stay available. The Worker reads the
--     access from businesses.plan_access, embedded in the membership lookup it
--     already makes; a trigger keeps that column equal to the subscription
--     state, and only that trigger may change it.

create or replace function public.f16_business_plan_state(p_business_id uuid)
returns table(plan_key text, status text, period_end timestamptz, access text)
language sql
stable
security definer
set search_path = ''
as $f1608plan$
  select
    coalesce(s.plan_key, 'pilot'),
    coalesce(s.status, 'pilot'),
    s.current_period_end,
    case when s.status = 'cancelled' then 'read_only' else 'full' end
  from (select p_business_id as business_id) b
  left join core.subscriptions s on s.business_id = b.business_id
$f1608plan$;

-- Same shape and checks as the F12 definition, plus plan access: a cancelled
-- plan makes the salon unpublishable with reason PLAN_INACTIVE.
create or replace function public.business_onboarding_readiness_internal(p_business_id uuid)
returns table(
  business_id uuid,
  has_active_service boolean,
  has_active_staff boolean,
  has_active_assignment boolean,
  has_business_hours boolean,
  has_staff_hours boolean,
  has_overlapping_hours boolean,
  publishable boolean,
  missing_reasons text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with flags as (
    select
      exists (select 1 from public.services s where s.business_id=p_business_id and s.active) as has_active_service,
      exists (select 1 from public.staff_profiles sp where sp.business_id=p_business_id and sp.active) as has_active_staff,
      exists (
        select 1 from public.staff_services ss
        join public.staff_profiles sp on sp.business_id=ss.business_id and sp.id=ss.staff_id and sp.active
        join public.services s on s.business_id=ss.business_id and s.id=ss.service_id and s.active
        where ss.business_id=p_business_id and ss.active
      ) as has_active_assignment,
      exists (select 1 from public.business_hours bh where bh.business_id=p_business_id and bh.active) as has_business_hours,
      exists (
        select 1 from public.staff_hours sh
        join public.staff_profiles sp on sp.business_id=sh.business_id and sp.id=sh.staff_id and sp.active
        join public.staff_services ss on ss.business_id=sh.business_id and ss.staff_id=sh.staff_id and ss.active
        join public.services s on s.business_id=ss.business_id and s.id=ss.service_id and s.active
        where sh.business_id=p_business_id and sh.active
      ) as has_staff_hours,
      exists (
        select 1 from public.business_hours bh
        join public.staff_hours sh
          on sh.business_id=bh.business_id and sh.weekday=bh.weekday and sh.active
         and bh.starts_local<sh.ends_local and sh.starts_local<bh.ends_local
        join public.staff_profiles sp on sp.business_id=sh.business_id and sp.id=sh.staff_id and sp.active
        join public.staff_services ss on ss.business_id=sh.business_id and ss.staff_id=sh.staff_id and ss.active
        join public.services s on s.business_id=ss.business_id and s.id=ss.service_id and s.active
        where bh.business_id=p_business_id and bh.active
      ) as has_overlapping_hours,
      exists (
        select 1 from public.business_public_profiles p
        where p.business_id=p_business_id
          and (
            nullif(trim(coalesce(p.public_phone,'')),'') is not null
            or nullif(trim(coalesce(p.public_email,'')),'') is not null
            or nullif(trim(coalesce(p.public_whatsapp,'')),'') is not null
          )
      ) as has_public_contact,
      (select ps.access = 'full' from public.f16_business_plan_state(p_business_id) ps) as has_plan_access
  )
  select
    p_business_id,
    f.has_active_service,
    f.has_active_staff,
    f.has_active_assignment,
    f.has_business_hours,
    f.has_staff_hours,
    f.has_overlapping_hours,
    f.has_active_service and f.has_active_staff and f.has_active_assignment
      and f.has_business_hours and f.has_staff_hours and f.has_overlapping_hours
      and f.has_public_contact and f.has_plan_access as publishable,
    array_remove(array[
      case when not f.has_active_service then 'SERVICE_REQUIRED' end,
      case when not f.has_active_staff then 'STAFF_REQUIRED' end,
      case when not f.has_active_assignment then 'ASSIGNMENT_REQUIRED' end,
      case when not f.has_business_hours then 'BUSINESS_HOURS_REQUIRED' end,
      case when not f.has_staff_hours then 'STAFF_HOURS_REQUIRED' end,
      case when not f.has_overlapping_hours then 'OVERLAPPING_HOURS_REQUIRED' end,
      case when not f.has_public_contact then 'PUBLIC_CONTACT_REQUIRED' end,
      case when not f.has_plan_access then 'PLAN_INACTIVE' end
    ]::text[],null)
  from flags f;
$$;

-- Plan access cached on the business row for the Worker's membership lookup.
alter table public.businesses
  add column if not exists plan_access text not null default 'full';
alter table public.businesses
  drop constraint if exists businesses_plan_access_check;
alter table public.businesses
  add constraint businesses_plan_access_check check (plan_access in ('full','read_only'));

update public.businesses b
set plan_access = ps.access
from public.businesses x
cross join lateral public.f16_business_plan_state(x.id) ps
where x.id = b.id and b.plan_access is distinct from ps.access;

create or replace function public.f16_sync_business_plan_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f1608sync$
declare
  v_business uuid := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
begin
  update public.businesses b
  set plan_access = (select ps.access from public.f16_business_plan_state(v_business) ps)
  where b.id = v_business;
  return null;
end
$f1608sync$;

drop trigger if exists subscriptions_f16_plan_access on core.subscriptions;
create trigger subscriptions_f16_plan_access
after insert or update or delete on core.subscriptions
for each row
execute function public.f16_sync_business_plan_access();

-- Only the subscription trigger (a nested statement) may change the column.
create or replace function public.f16_guard_business_plan_access()
returns trigger
language plpgsql
set search_path = ''
as $f1608guard$
begin
  if new.plan_access is distinct from old.plan_access and pg_trigger_depth() <= 1 then
    raise exception 'PLAN_ACCESS_MANAGED_BY_SUBSCRIPTION' using errcode = '55000';
  end if;
  return new;
end
$f1608guard$;

drop trigger if exists businesses_f16_plan_access_guard on public.businesses;
create trigger businesses_f16_plan_access_guard
before update of plan_access on public.businesses
for each row
execute function public.f16_guard_business_plan_access();

create or replace function public.get_account_summary(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f1608account$
declare
  v_member public.memberships;
  v_business public.businesses;
  v_plan record;
  v_permissions text[];
begin
  perform public.f10_require_standard_session();
  select * into v_member
  from public.memberships m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
  if v_member.id is null then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  select * into v_business from public.businesses b where b.id = p_business_id;
  select * into v_plan from public.f16_business_plan_state(p_business_id);

  if v_member.role in ('owner','manager') then
    select array_agg(k::text order by k::text) into v_permissions
    from unnest(enum_range(null::public.financial_permission_key)) k;
  else
    select coalesce(array_agg(p.permission::text order by p.permission::text), array[]::text[]) into v_permissions
    from public.membership_financial_permissions p
    where p.business_id = p_business_id and p.membership_id = v_member.id and p.active;
  end if;

  return jsonb_build_object(
    'businessId', v_business.id,
    'businessName', v_business.name,
    'membershipId', v_member.id,
    'role', v_member.role,
    'financialPermissions', to_jsonb(coalesce(v_permissions, array[]::text[])),
    'plan', jsonb_build_object(
      'planKey', v_plan.plan_key,
      'status', v_plan.status,
      'periodEnd', v_plan.period_end,
      'access', v_plan.access
    )
  );
end
$f1608account$;

revoke all on function public.f16_business_plan_state(uuid) from public, anon, authenticated;
revoke all on function public.business_onboarding_readiness_internal(uuid) from public, anon, authenticated;
revoke all on function public.f16_sync_business_plan_access() from public, anon, authenticated;
revoke all on function public.f16_guard_business_plan_access() from public, anon, authenticated;
revoke all on function public.get_account_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_account_summary(uuid) to authenticated;

commit;
