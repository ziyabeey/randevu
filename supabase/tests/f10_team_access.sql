begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('a1000000-0000-4000-8000-000000000001', 'f10-owner-a@example.invalid', '{"full_name":"F10 Owner A"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000002', 'f10-manager-a@example.invalid', '{"full_name":"F10 Manager A"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000003', 'f10-staff-a@example.invalid', '{"full_name":"F10 Staff A"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000004', 'f10-invitee-a@example.invalid', '{"full_name":"F10 Invitee A"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000005', 'f10-wrong-a@example.invalid', '{"full_name":"F10 Wrong A"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000006', 'f10-owner-b@example.invalid', '{"full_name":"F10 Owner B"}'::jsonb),
  ('a1000000-0000-4000-8000-000000000007', 'f10-expired-a@example.invalid', '{"full_name":"F10 Expired A"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('a1100000-0000-4000-8000-000000000001', 'F10 Tenant A', 'f10-tenant-a', 'Europe/Istanbul', 'a1000000-0000-4000-8000-000000000001'),
  ('a1100000-0000-4000-8000-000000000002', 'F10 Tenant B', 'f10-tenant-b', 'Europe/Istanbul', 'a1000000-0000-4000-8000-000000000006');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('a1200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', true),
  ('a1200000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'manager', true),
  ('a1200000-0000-4000-8000-000000000003', 'a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'staff', true),
  ('a1200000-0000-4000-8000-000000000004', 'a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'staff', false),
  ('a1200000-0000-4000-8000-000000000006', 'a1100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000006', 'owner', true);

insert into public.staff_profiles(id, business_id, name, active)
values
  ('a1300000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'F10 Operasyon A', true),
  ('a1300000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000002', 'F10 Operasyon B', true);

insert into public.business_invitations(
  id, business_id, email_normalized, role, token_hash, invited_by_membership_id,
  created_at, expires_at
) values (
  'a1400000-0000-4000-8000-000000000003',
  'a1100000-0000-4000-8000-000000000001',
  'f10-expired-a@example.invalid', 'staff', repeat('c', 64),
  'a1200000-0000-4000-8000-000000000001',
  now() - interval '2 hours', now() - interval '1 hour'
);

-- New S08-gated objects must remain closed at the table/sequence layer. Only
-- explicitly granted authenticated RPCs are reachable by API roles.
do $$
begin
  if has_table_privilege('authenticated', 'public.business_invitations', 'SELECT')
     or has_table_privilege('authenticated', 'public.membership_financial_permissions', 'SELECT')
     or has_table_privilege('authenticated', 'public.membership_financial_permission_events', 'SELECT')
     or has_table_privilege('anon', 'public.business_invitations', 'SELECT') then
    raise exception 'F10 team tables unexpectedly exposed to API roles';
  end if;

  if has_sequence_privilege('authenticated', 'public.membership_financial_permission_events_id_seq', 'USAGE')
     or has_sequence_privilege('anon', 'public.membership_financial_permission_events_id_seq', 'USAGE') then
    raise exception 'F10 audit sequence unexpectedly exposed to API roles';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.create_business_invitation(uuid,text,public.membership_role,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.accept_business_invitation(text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.update_team_membership(uuid,uuid,public.membership_role,boolean)',
      'EXECUTE'
    ) then
    raise exception 'authenticated F10 RPC surface is incomplete';
  end if;

  if has_function_privilege(
      'anon',
      'public.create_business_invitation(uuid,text,public.membership_role,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.accept_business_invitation(text)',
      'EXECUTE'
    ) then
    raise exception 'anon unexpectedly gained F10 team RPC access';
  end if;
end
$$;

-- Owner creates a real pending invitation, plus one that will be revoked and
-- one owner-role invitation used to prove manager restrictions.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select * from public.create_business_invitation(
  'a1100000-0000-4000-8000-000000000001',
  'F10-Invitee-A@Example.Invalid', 'staff', repeat('a', 64)
);

do $$
declare
  v_revoked uuid;
begin
  select invitation_id into v_revoked
  from public.create_business_invitation(
    'a1100000-0000-4000-8000-000000000001',
    'f10-wrong-a@example.invalid', 'staff', repeat('b', 64)
  );
  perform public.revoke_business_invitation(
    'a1100000-0000-4000-8000-000000000001', v_revoked
  );
end
$$;

select set_config('f10.owner_invitation_id', invitation_id::text, true)
from public.create_business_invitation(
  'a1100000-0000-4000-8000-000000000001',
  'f10-owner-candidate@example.invalid', 'owner', repeat('d', 64)
);

reset role;

-- Manager may manage non-owner team entries, but cannot mint/revoke owner-role
-- invitations, touch an owner membership or manage financial grants.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);

select * from public.create_business_invitation(
  'a1100000-0000-4000-8000-000000000001',
  'f10-manager-created@example.invalid', 'staff', repeat('e', 64)
);

do $$
declare
  v_owner_invite uuid;
begin
  begin
    perform 1 from public.create_business_invitation(
      'a1100000-0000-4000-8000-000000000001',
      'f10-manager-owner@example.invalid', 'owner', repeat('f', 64)
    );
    raise exception 'manager unexpectedly created owner invitation';
  exception when insufficient_privilege then
    null;
  end;

  v_owner_invite := current_setting('f10.owner_invitation_id')::uuid;

  begin
    perform public.revoke_business_invitation(
      'a1100000-0000-4000-8000-000000000001', v_owner_invite
    );
    raise exception 'manager unexpectedly revoked owner invitation';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.update_team_membership(
      'a1100000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000001', 'manager', true
    );
    raise exception 'manager unexpectedly changed owner membership';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.set_membership_financial_permission(
      'a1100000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000003',
      'payments_write', true
    );
    raise exception 'manager unexpectedly granted financial permission';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

-- Staff cannot manage invitations, memberships or explicit financial grants.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', true);

do $$
begin
  begin
    perform 1 from public.create_business_invitation(
      'a1100000-0000-4000-8000-000000000001',
      'f10-staff-created@example.invalid', 'staff', repeat('1', 64)
    );
    raise exception 'staff unexpectedly created invitation';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.update_team_membership(
      'a1100000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000003', 'manager', true
    );
    raise exception 'staff unexpectedly escalated itself';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

-- Wrong authenticated account cannot consume another email's invitation.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000005', true);

do $$
begin
  begin
    perform 1 from public.accept_business_invitation(repeat('a', 64));
    raise exception 'wrong email unexpectedly accepted invitation';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

-- The matching invitee reactivates its existing inactive membership. Replay is
-- then terminally rejected.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);

select * from public.accept_business_invitation(repeat('a', 64));

do $$
begin
  begin
    perform 1 from public.accept_business_invitation(repeat('a', 64));
    raise exception 'accepted invitation unexpectedly replayed';
  exception when others then
    if sqlerrm = 'accepted invitation unexpectedly replayed' then raise; end if;
    if position('INVITATION_ALREADY_USED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;

-- Matching accounts still cannot consume revoked or expired tokens.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000005', true);

do $$
begin
  begin
    perform 1 from public.accept_business_invitation(repeat('b', 64));
    raise exception 'revoked invitation unexpectedly accepted';
  exception when others then
    if sqlerrm = 'revoked invitation unexpectedly accepted' then raise; end if;
    if position('INVITATION_REVOKED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000007', true);

do $$
begin
  begin
    perform 1 from public.accept_business_invitation(repeat('c', 64));
    raise exception 'expired invitation unexpectedly accepted';
  exception when others then
    if sqlerrm = 'expired invitation unexpectedly accepted' then raise; end if;
    if position('INVITATION_EXPIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;

-- Owner links operational staff to the login membership and proves the existing
-- composite tenant boundary still rejects cross-business membership IDs.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select public.set_staff_membership_link(
  'a1100000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000004'
);

do $$
begin
  begin
    perform public.set_staff_membership_link(
      'a1100000-0000-4000-8000-000000000001',
      'a1300000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000006'
    );
    raise exception 'cross-tenant staff membership link unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant staff membership link unexpectedly succeeded' then raise; end if;
    if position('ACTIVE_MEMBERSHIP_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Single owner cannot demote itself while no second active owner exists.
do $$
begin
  begin
    perform 1 from public.update_team_membership(
      'a1100000-0000-4000-8000-000000000001',
      'a1200000-0000-4000-8000-000000000001', 'manager', true
    );
    raise exception 'last owner unexpectedly demoted itself';
  exception when others then
    if sqlerrm = 'last owner unexpectedly demoted itself' then raise; end if;
    if position('LAST_ACTIVE_OWNER' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Explicit staff financial permission is owner-only and audited.
select public.set_membership_financial_permission(
  'a1100000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000004',
  'payments_write', true
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);

do $$
begin
  if not public.has_financial_permission(
    'a1100000-0000-4000-8000-000000000001', 'payments_write'
  ) then
    raise exception 'staff explicit financial permission was not effective';
  end if;
end
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select public.set_membership_financial_permission(
  'a1100000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000004',
  'payments_write', false
);
select public.set_membership_financial_permission(
  'a1100000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000004',
  'inventory_write', true
);

-- A role change revokes stale explicit staff grants before the new role takes
-- effect. Manager/owner access is role-derived, never from stale staff grants.
select * from public.update_team_membership(
  'a1100000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000004', 'manager', true
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);

do $$
begin
  if not public.has_financial_permission(
    'a1100000-0000-4000-8000-000000000001', 'inventory_write'
  ) then
    raise exception 'manager role did not carry financial permission';
  end if;
end
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);

select * from public.update_team_membership(
  'a1100000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000004', 'staff', true
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000004', true);

do $$
begin
  if public.has_financial_permission(
    'a1100000-0000-4000-8000-000000000001', 'inventory_write'
  ) then
    raise exception 'stale staff financial permission resurfaced after role downgrade';
  end if;
end
$$;

reset role;

-- Final structural assertions run as database owner, not as authorization proof.
do $$
declare
  v_count integer;
  v_link uuid;
begin
  select count(*) into v_count
  from public.business_invitations i
  where i.token_hash = repeat('a', 64)
    and i.accepted_at is not null
    and i.accepted_by_user_id = 'a1000000-0000-4000-8000-000000000004';
  if v_count <> 1 then
    raise exception 'accepted invitation did not become terminal exactly once';
  end if;

  select membership_id into v_link
  from public.staff_profiles
  where id = 'a1300000-0000-4000-8000-000000000001';
  if v_link is distinct from 'a1200000-0000-4000-8000-000000000004'::uuid then
    raise exception 'staff profile did not retain intended membership link';
  end if;

  select count(*) into v_count
  from public.membership_financial_permissions p
  where p.business_id = 'a1100000-0000-4000-8000-000000000001'
    and p.membership_id = 'a1200000-0000-4000-8000-000000000004'
    and p.active;
  if v_count <> 0 then
    raise exception 'role transition left active explicit financial permission';
  end if;

  select count(*) into v_count
  from public.membership_financial_permission_events e
  where e.business_id = 'a1100000-0000-4000-8000-000000000001'
    and e.membership_id = 'a1200000-0000-4000-8000-000000000004';
  if v_count < 4 then
    raise exception 'financial permission audit did not record grant/revoke lifecycle: %', v_count;
  end if;
end
$$;

rollback;