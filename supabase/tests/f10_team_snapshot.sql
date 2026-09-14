begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('a3000000-0000-4000-8000-000000000001', 'f10-snapshot-owner@example.invalid', '{"full_name":"F10 Snapshot Owner"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000002', 'f10-snapshot-manager@example.invalid', '{"full_name":"F10 Snapshot Manager"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000003', 'f10-snapshot-staff@example.invalid', '{"full_name":"F10 Snapshot Staff"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000004', 'f10-snapshot-other@example.invalid', '{"full_name":"F10 Snapshot Other"}'::jsonb),
  ('a3000000-0000-4000-8000-000000000005', 'f10-snapshot-limit-owner@example.invalid', '{"full_name":"F10 Snapshot Limit Owner"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('a3100000-0000-4000-8000-000000000001', 'F10 Snapshot A', 'f10-snapshot-a', 'Europe/Istanbul', 'a3000000-0000-4000-8000-000000000001'),
  ('a3100000-0000-4000-8000-000000000002', 'F10 Snapshot B', 'f10-snapshot-b', 'Europe/Istanbul', 'a3000000-0000-4000-8000-000000000004'),
  ('a3100000-0000-4000-8000-000000000003', 'F10 Snapshot Limit', 'f10-snapshot-limit', 'Europe/Istanbul', 'a3000000-0000-4000-8000-000000000005');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('a3200000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'owner', true),
  ('a3200000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'manager', true),
  ('a3200000-0000-4000-8000-000000000003', 'a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'staff', true),
  ('a3200000-0000-4000-8000-000000000004', 'a3100000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000004', 'owner', true),
  ('a3200000-0000-4000-8000-000000000005', 'a3100000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000005', 'owner', true);

insert into public.staff_profiles(id, business_id, membership_id, name, active)
values
  ('a3300000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000003', 'F10 Linked Operator', true),
  ('a3300000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', null, 'F10 Operational Only', true);

insert into public.business_invitations(
  id, business_id, email_normalized, role, token_hash,
  invited_by_membership_id, created_at, expires_at
)
values
  (
    'a3400000-0000-4000-8000-000000000001',
    'a3100000-0000-4000-8000-000000000001',
    'f10-snapshot-invite-staff@example.invalid', 'staff', repeat('1', 64),
    'a3200000-0000-4000-8000-000000000001', now(), now() + interval '24 hours'
  ),
  (
    'a3400000-0000-4000-8000-000000000002',
    'a3100000-0000-4000-8000-000000000001',
    'f10-snapshot-invite-owner@example.invalid', 'owner', repeat('2', 64),
    'a3200000-0000-4000-8000-000000000001', now(), now() + interval '24 hours'
  ),
  (
    'a3400000-0000-4000-8000-000000000003',
    'a3100000-0000-4000-8000-000000000001',
    'f10-snapshot-expired@example.invalid', 'staff', repeat('3', 64),
    'a3200000-0000-4000-8000-000000000001', now() - interval '2 hours', now() - interval '1 hour'
  );

insert into public.membership_financial_permissions(
  business_id, membership_id, permission, active,
  granted_by_membership_id, granted_at
)
values (
  'a3100000-0000-4000-8000-000000000001',
  'a3200000-0000-4000-8000-000000000003',
  'payments_write', true,
  'a3200000-0000-4000-8000-000000000001', now()
);

do $$
begin
  if not has_function_privilege('authenticated', 'public.get_team_snapshot(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute team snapshot';
  end if;
  if has_function_privilege('anon', 'public.get_team_snapshot(uuid)', 'EXECUTE') then
    raise exception 'anon unexpectedly gained team snapshot access';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000001', true);

do $$
declare
  v_snapshot jsonb := public.get_team_snapshot('a3100000-0000-4000-8000-000000000001');
begin
  if v_snapshot #>> '{actor,role}' <> 'owner' then
    raise exception 'owner snapshot actor role mismatch';
  end if;
  if jsonb_array_length(v_snapshot -> 'members') <> 3 then
    raise exception 'owner snapshot member count mismatch';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_snapshot -> 'members') item
    where item ? 'userId'
  ) then
    raise exception 'team snapshot leaked auth user id';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_snapshot -> 'members') item
    where item ->> 'email' is null
  ) then
    raise exception 'owner snapshot unexpectedly redacted member email';
  end if;
  if jsonb_array_length(v_snapshot -> 'staff') <> 2 then
    raise exception 'owner snapshot staff count mismatch';
  end if;
  if jsonb_array_length(v_snapshot -> 'invitations') <> 2 then
    raise exception 'owner snapshot should expose two live invitations';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_snapshot -> 'invitations') item
    where item ->> 'role' = 'owner'
  ) then
    raise exception 'owner snapshot lost owner-role invitation';
  end if;
  if jsonb_array_length(v_snapshot -> 'financialPermissions') <> 1 then
    raise exception 'owner snapshot explicit financial grant mismatch';
  end if;
  if jsonb_array_length(v_snapshot -> 'effectiveFinancialPermissions') <> 5 then
    raise exception 'owner snapshot effective permission set mismatch';
  end if;
end
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000002', true);

do $$
declare
  v_snapshot jsonb := public.get_team_snapshot('a3100000-0000-4000-8000-000000000001');
begin
  if v_snapshot #>> '{actor,role}' <> 'manager' then
    raise exception 'manager snapshot actor role mismatch';
  end if;
  if jsonb_array_length(v_snapshot -> 'invitations') <> 1 then
    raise exception 'manager snapshot should expose only non-owner live invitation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_snapshot -> 'invitations') item
    where item ->> 'role' = 'owner'
  ) then
    raise exception 'manager snapshot leaked owner-role invitation';
  end if;
  if jsonb_array_length(v_snapshot -> 'financialPermissions') <> 0 then
    raise exception 'manager snapshot leaked owner-only financial grant inventory';
  end if;
  if jsonb_array_length(v_snapshot -> 'effectiveFinancialPermissions') <> 5 then
    raise exception 'manager snapshot effective permission set mismatch';
  end if;
end
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000003', true);

do $$
declare
  v_snapshot jsonb := public.get_team_snapshot('a3100000-0000-4000-8000-000000000001');
begin
  if v_snapshot #>> '{actor,role}' <> 'staff' then
    raise exception 'staff snapshot actor role mismatch';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_snapshot -> 'members') item
    where item ->> 'email' is not null
  ) then
    raise exception 'staff snapshot leaked account email';
  end if;
  if jsonb_array_length(v_snapshot -> 'invitations') <> 0 then
    raise exception 'staff snapshot leaked pending invitations';
  end if;
  if jsonb_array_length(v_snapshot -> 'financialPermissions') <> 0 then
    raise exception 'staff snapshot leaked owner-only grant inventory';
  end if;
  if v_snapshot -> 'effectiveFinancialPermissions' <> '["payments_write"]'::jsonb then
    raise exception 'staff snapshot effective permission mismatch: %', v_snapshot -> 'effectiveFinancialPermissions';
  end if;

  begin
    perform public.get_team_snapshot('a3100000-0000-4000-8000-000000000002');
    raise exception 'cross-tenant team snapshot unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

-- Bound a separately seeded owner view. The function must fail instead of
-- returning a silently truncated pending-invitation list.
insert into public.business_invitations(
  business_id, email_normalized, role, token_hash,
  invited_by_membership_id, expires_at
)
select
  'a3100000-0000-4000-8000-000000000003',
  'f10-snapshot-limit-' || g::text || '@example.invalid',
  'staff'::public.membership_role,
  md5('f10-a-' || g::text) || md5('f10-b-' || g::text),
  'a3200000-0000-4000-8000-000000000005',
  now() + interval '24 hours'
from generate_series(1, 101) g;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-4000-8000-000000000005', true);

do $$
begin
  begin
    perform public.get_team_snapshot('a3100000-0000-4000-8000-000000000003');
    raise exception 'oversized team snapshot unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'oversized team snapshot unexpectedly succeeded' then raise; end if;
    if position('TEAM_INVITATIONS_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;
rollback;
