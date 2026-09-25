begin;

-- F16-08 account summary and plan access: real plan data from core.subscriptions
-- with a pilot default, role and financial permissions for the menu, tenant
-- isolation, a cancelled plan closing every public booking path through the
-- shared readiness check (including the public appointment insert guard) while
-- existing appointments stay manageable, and the member write gate.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f16e0000-0000-4000-8000-000000000001','f1608-owner@example.invalid','{}'::jsonb),
  ('f16e0000-0000-4000-8000-000000000002','f1608-staff@example.invalid','{}'::jsonb),
  ('f16e0000-0000-4000-8000-000000000003','f1608-foreign@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f16e1000-0000-4000-8000-000000000001','F16-08 Salon','f1608-salon','Europe/Istanbul','f16e0000-0000-4000-8000-000000000001'),
  ('f16e1000-0000-4000-8000-000000000002','F16-08 Foreign','f1608-foreign','Europe/Istanbul','f16e0000-0000-4000-8000-000000000003');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f16e2000-0000-4000-8000-000000000001','f16e1000-0000-4000-8000-000000000001','f16e0000-0000-4000-8000-000000000001','owner',true),
  ('f16e2000-0000-4000-8000-000000000002','f16e1000-0000-4000-8000-000000000001','f16e0000-0000-4000-8000-000000000002','staff',true),
  ('f16e2000-0000-4000-8000-000000000003','f16e1000-0000-4000-8000-000000000002','f16e0000-0000-4000-8000-000000000003','owner',true);

insert into public.membership_financial_permissions(business_id,membership_id,permission,active,granted_by_membership_id)
values ('f16e1000-0000-4000-8000-000000000001','f16e2000-0000-4000-8000-000000000002','payments_write',true,'f16e2000-0000-4000-8000-000000000001');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values ('f16e4000-0000-4000-8000-000000000001','f16e1000-0000-4000-8000-000000000001','Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true);
insert into public.staff_profiles(id,business_id,name,active)
values ('f16e5000-0000-4000-8000-000000000001','f16e1000-0000-4000-8000-000000000001','Ayla',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values ('f16e1000-0000-4000-8000-000000000001','f16e5000-0000-4000-8000-000000000001','f16e4000-0000-4000-8000-000000000001',true);
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'f16e1000-0000-4000-8000-000000000001', d, time '09:00', time '18:00', true from generate_series(0,6) d;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'f16e1000-0000-4000-8000-000000000001','f16e5000-0000-4000-8000-000000000001', d, time '09:00', time '18:00', true
from generate_series(0,6) d;
insert into public.business_public_profiles(business_id, public_phone)
values ('f16e1000-0000-4000-8000-000000000001','+905551608000')
on conflict (business_id) do update set public_phone = excluded.public_phone;
insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('f16e1000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update set enabled=true;

-- ACL ------------------------------------------------------------------------------
do $acl$
begin
  if not has_function_privilege('authenticated','public.get_account_summary(uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_account_summary(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.f16_sync_business_plan_access()','EXECUTE')
     or has_table_privilege('authenticated','public.businesses','UPDATE')
     or has_function_privilege('authenticated','public.f16_business_plan_state(uuid)','EXECUTE')
     or has_function_privilege('anon','public.f16_business_plan_state(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.business_onboarding_readiness_internal(uuid)','EXECUTE')
     or has_function_privilege('anon','public.business_onboarding_readiness_internal(uuid)','EXECUTE') then
    raise exception 'F16-08 function grants are wrong';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('get_account_summary','f16_sync_business_plan_access','f16_business_plan_state')
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  ) then raise exception 'F16-08 SECURITY DEFINER function without empty search_path'; end if;
end
$acl$;

-- Pilot default: no subscription row means full access and a publishable salon.
do $pilot$
declare v record;
begin
  select * into v from public.f16_business_plan_state('f16e1000-0000-4000-8000-000000000001');
  if v.plan_key <> 'pilot' or v.status <> 'pilot' or v.access <> 'full' then
    raise exception 'F16-08 pilot default wrong: %', row_to_json(v);
  end if;
  select * into v from public.business_onboarding_readiness_internal('f16e1000-0000-4000-8000-000000000001');
  if not v.publishable or cardinality(v.missing_reasons) <> 0 then
    raise exception 'F16-08 pilot salon not publishable: %', row_to_json(v);
  end if;
  if public.f16_public_business_id('f1608-salon') is null
     or not exists (select 1 from public.get_public_business_profile_v2('f1608-salon')) then
    raise exception 'F16-08 pilot salon hidden from public paths';
  end if;
end
$pilot$;

set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f16e0000-0000-4000-8000-000000000001',true);
do $owner$
declare v jsonb;
begin
  v := public.get_account_summary('f16e1000-0000-4000-8000-000000000001');
  if v->>'role' <> 'owner' or v->>'businessName' <> 'F16-08 Salon'
     or v->'plan'->>'planKey' <> 'pilot' or v->'plan'->>'access' <> 'full'
     or jsonb_array_length(v->'financialPermissions') <> 5 then
    raise exception 'F16-08 owner summary wrong: %', v;
  end if;
  begin
    perform public.get_account_summary('f16e1000-0000-4000-8000-000000000002');
    raise exception 'F16-08 owner read another business summary';
  exception when others then if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
end
$owner$;

select set_config('request.jwt.claim.sub','f16e0000-0000-4000-8000-000000000002',true);
do $staff$
declare v jsonb;
begin
  v := public.get_account_summary('f16e1000-0000-4000-8000-000000000001');
  if v->>'role' <> 'staff' or v->'financialPermissions' <> '["payments_write"]'::jsonb then
    raise exception 'F16-08 staff summary wrong: %', v;
  end if;
end
$staff$;

select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $recovery$
declare v_failed boolean := false;
begin
  begin
    perform public.get_account_summary('f16e1000-0000-4000-8000-000000000001');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'F16-08 recovery session read the account summary'; end if;
end
$recovery$;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
reset role;

-- A past-due plan is a warning, not a lock.
insert into core.subscriptions(business_id, plan_key, status, current_period_start, current_period_end)
values ('f16e1000-0000-4000-8000-000000000001','salon_standard','past_due', now() - interval '40 days', now() - interval '10 days');
do $pastdue$
declare v record;
begin
  select * into v from public.f16_business_plan_state('f16e1000-0000-4000-8000-000000000001');
  if v.status <> 'past_due' or v.access <> 'full' or v.plan_key <> 'salon_standard' then
    raise exception 'F16-08 past-due state wrong: %', row_to_json(v);
  end if;
  if not (select r.publishable from public.business_onboarding_readiness_internal('f16e1000-0000-4000-8000-000000000001') r)
     or (select plan_access from public.businesses where id = 'f16e1000-0000-4000-8000-000000000001') <> 'full' then
    raise exception 'F16-08 past-due salon closed for booking or writes';
  end if;
end
$pastdue$;

-- An existing customer appointment with its own management link.
set local role authenticated;
select set_config('request.jwt.claim.sub','f16e0000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $existing$
declare v_row public.appointments;
begin
  select * into v_row from public.create_appointment(
    'f16e1000-0000-4000-8000-000000000001','f1608-manage-0001','Plan Müşteri',
    'f16e4000-0000-4000-8000-000000000001','f16e5000-0000-4000-8000-000000000001',
    ((date_trunc('week',current_date)::date+7)+time '10:00') at time zone 'Europe/Istanbul','05550001608',null,null
  );
  perform set_config('f1608.appointment_id', v_row.id::text, true);
end
$existing$;
reset role;
insert into public.appointment_management_capabilities(appointment_id,business_id,token_hash)
values (
  current_setting('f1608.appointment_id')::uuid,
  'f16e1000-0000-4000-8000-000000000001',
  public.management_token_hash('F1608PlanManageToken________________________')
);

-- A cancelled plan: read-only for members, closed for new public bookings.
update core.subscriptions set status = 'cancelled', version = version + 1
where business_id = 'f16e1000-0000-4000-8000-000000000001';
do $cancelled$
declare v record;
begin
  select * into v from public.business_onboarding_readiness_internal('f16e1000-0000-4000-8000-000000000001');
  if v.publishable or not ('PLAN_INACTIVE' = any(v.missing_reasons)) or cardinality(v.missing_reasons) <> 1 then
    raise exception 'F16-08 cancelled plan still publishable: %', row_to_json(v);
  end if;
  if (select plan_access from public.businesses where id = 'f16e1000-0000-4000-8000-000000000001') <> 'read_only' then
    raise exception 'F16-08 cancelled plan did not reach the business write gate';
  end if;
  if public.f16_public_business_id('f1608-salon') is not null
     or exists (select 1 from public.get_public_business_profile_v2('f1608-salon')) then
    raise exception 'F16-08 cancelled salon still on public paths';
  end if;
  begin
    perform * from public.compute_public_booking_slots('f1608-salon','f16e4000-0000-4000-8000-000000000001',
      (now() at time zone 'Europe/Istanbul')::date + 1, null);
    raise exception 'F16-08 cancelled salon still offers public slots';
  exception when others then if sqlerrm <> 'PUBLIC_BOOKING_NOT_FOUND' then raise; end if;
  end;
end
$cancelled$;

-- The customer's management link is not left in doubt: an existing appointment
-- can still be viewed, moved and cancelled while the plan is cancelled.
do $managed$
declare
  v_token constant text := 'F1608PlanManageToken________________________';
  v record;
  v_slots integer;
begin
  select * into strict v from public.get_public_managed_appointment(v_token);
  if v.status <> 'scheduled' or not v.can_reschedule or not v.can_cancel then
    raise exception 'F16-08 cancelled plan hid existing appointment management: %', row_to_json(v);
  end if;
  select count(*) into v_slots
  from public.compute_public_management_slots(v_token, date_trunc('week',current_date)::date+8, null);
  if v_slots = 0 then raise exception 'F16-08 cancelled plan removed reschedule slots for an existing appointment'; end if;
  select * into strict v from public.cancel_public_managed_appointment(v_token,'f1608-manage-cancel-0001','Plan kapalı');
  if v.status <> 'cancelled' then raise exception 'F16-08 cancelled plan blocked customer cancellation: %', row_to_json(v); end if;
end
$managed$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f16e0000-0000-4000-8000-000000000001',true);
do $readonly$
declare v jsonb;
begin
  v := public.get_account_summary('f16e1000-0000-4000-8000-000000000001');
  if v->'plan'->>'status' <> 'cancelled' or v->'plan'->>'access' <> 'read_only' then
    raise exception 'F16-08 cancelled summary wrong: %', v;
  end if;
end
$readonly$;
reset role;

-- The public appointment insert guard shares the readiness check, so a new
-- public booking row is refused; updates of existing rows are not guarded.
do $insertguard$
begin
  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'public.appointments'::regclass
      and tg.tgname = 'f10_public_appointment_readiness_guard'
      and tg.tgtype & 4 = 4      -- INSERT
      and tg.tgtype & 16 = 0     -- not UPDATE
  ) then
    raise exception 'F16-08 public appointment guard is not an insert-only trigger';
  end if;
  if position('business_onboarding_readiness_internal' in pg_get_functiondef('public.f10_guard_public_appointment_readiness()'::regprocedure)) = 0 then
    raise exception 'F16-08 public appointment guard no longer uses the shared readiness check';
  end if;
end
$insertguard$;

-- Only the subscription may move the cached access.
do $guard$
begin
  begin
    update public.businesses set plan_access = 'full' where id = 'f16e1000-0000-4000-8000-000000000001';
    raise exception 'F16-08 plan access was changed directly';
  exception when others then if sqlerrm <> 'PLAN_ACCESS_MANAGED_BY_SUBSCRIPTION' then raise; end if;
  end;
end
$guard$;

-- Reactivation restores the public paths and writes; removing the row is pilot.
update core.subscriptions set status = 'active', version = version + 1
where business_id = 'f16e1000-0000-4000-8000-000000000001';
do $reactivated$
begin
  if public.f16_public_business_id('f1608-salon') is null
     or (select plan_access from public.businesses where id = 'f16e1000-0000-4000-8000-000000000001') <> 'full' then
    raise exception 'F16-08 reactivated salon still closed';
  end if;
end
$reactivated$;
update core.subscriptions set status = 'cancelled', version = version + 1
where business_id = 'f16e1000-0000-4000-8000-000000000001';
delete from core.subscriptions where business_id = 'f16e1000-0000-4000-8000-000000000001';
do $deleted$
begin
  if (select plan_access from public.businesses where id = 'f16e1000-0000-4000-8000-000000000001') <> 'full' then
    raise exception 'F16-08 removed subscription did not return to pilot access';
  end if;
end
$deleted$;

select 'F16-08 account and plan acceptance passed' as result;
rollback;
