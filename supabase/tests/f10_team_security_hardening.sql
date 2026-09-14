begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('a4000000-0000-4000-8000-000000000001', 'f10-hardening-owner@example.invalid', '{"full_name":"F10 Hardening Owner"}'::jsonb),
  ('a4000000-0000-4000-8000-000000000002', 'f10-hardening-staff@example.invalid', '{"full_name":"F10 Hardening Staff"}'::jsonb),
  ('a4000000-0000-4000-8000-000000000003', 'f10-hardening-invitee@example.invalid', '{"full_name":"F10 Hardening Invitee"}'::jsonb),
  ('a4000000-0000-4000-8000-000000000004', 'f10-cap-owner@example.invalid', '{"full_name":"F10 Cap Owner"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('a4100000-0000-4000-8000-000000000001', 'F10 Hardening', 'f10-hardening', 'Europe/Istanbul', 'a4000000-0000-4000-8000-000000000001'),
  ('a4100000-0000-4000-8000-000000000002', 'F10 Invite Cap', 'f10-invite-cap', 'Europe/Istanbul', 'a4000000-0000-4000-8000-000000000004');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('a4200000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'owner', true),
  ('a4200000-0000-4000-8000-000000000002', 'a4100000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002', 'staff', true),
  ('a4200000-0000-4000-8000-000000000004', 'a4100000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000004', 'owner', true);

insert into public.staff_profiles(id, business_id, membership_id, name, active)
values (
  'a4300000-0000-4000-8000-000000000001',
  'a4100000-0000-4000-8000-000000000001',
  null,
  'F10 Hardening Operator',
  true
);

insert into public.business_invitations(
  id, business_id, email_normalized, role, token_hash,
  invited_by_membership_id, created_at, expires_at
)
values (
  'a4400000-0000-4000-8000-000000000001',
  'a4100000-0000-4000-8000-000000000001',
  'f10-hardening-invitee@example.invalid',
  'staff', repeat('a', 64),
  'a4200000-0000-4000-8000-000000000001',
  now(), now() + interval '24 hours'
);

-- A recovery bearer must not gain any F10 feature authority by bypassing the
-- Worker and calling the Supabase RPC surface directly.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"recovery"}]}', true);

do $$
begin
  begin
    perform public.get_team_snapshot('a4100000-0000-4000-8000-000000000001');
    raise exception 'recovery unexpectedly read team snapshot';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read team snapshot' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform 1 from public.create_business_invitation(
      'a4100000-0000-4000-8000-000000000001',
      'f10-recovery-create@example.invalid', 'staff', repeat('b', 64)
    );
    raise exception 'recovery unexpectedly created invitation';
  exception when others then
    if sqlerrm = 'recovery unexpectedly created invitation' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.revoke_business_invitation(
      'a4100000-0000-4000-8000-000000000001',
      'a4400000-0000-4000-8000-000000000001'
    );
    raise exception 'recovery unexpectedly revoked invitation';
  exception when others then
    if sqlerrm = 'recovery unexpectedly revoked invitation' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform 1 from public.update_team_membership(
      'a4100000-0000-4000-8000-000000000001',
      'a4200000-0000-4000-8000-000000000002', 'manager', true
    );
    raise exception 'recovery unexpectedly changed membership';
  exception when others then
    if sqlerrm = 'recovery unexpectedly changed membership' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.set_staff_membership_link(
      'a4100000-0000-4000-8000-000000000001',
      'a4300000-0000-4000-8000-000000000001',
      'a4200000-0000-4000-8000-000000000002'
    );
    raise exception 'recovery unexpectedly linked staff membership';
  exception when others then
    if sqlerrm = 'recovery unexpectedly linked staff membership' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.set_membership_financial_permission(
      'a4100000-0000-4000-8000-000000000001',
      'a4200000-0000-4000-8000-000000000002', 'payments_write', true
    );
    raise exception 'recovery unexpectedly granted financial permission';
  exception when others then
    if sqlerrm = 'recovery unexpectedly granted financial permission' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.has_financial_permission(
      'a4100000-0000-4000-8000-000000000001', 'payments_write'
    );
    raise exception 'recovery unexpectedly read financial authority';
  exception when others then
    if sqlerrm = 'recovery unexpectedly read financial authority' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- Acceptance is special because the invitee has no business membership yet; it
-- still must reject the recovery bearer at the DB boundary.
select set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000003', true);

do $$
begin
  begin
    perform 1 from public.accept_business_invitation(repeat('a', 64));
    raise exception 'recovery unexpectedly accepted invitation';
  exception when others then
    if sqlerrm = 'recovery unexpectedly accepted invitation' then raise; end if;
    if position('PASSWORD_UPDATE_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

-- The same correct invitee with a normal verified AMR still follows the intended
-- positive path, proving the new guard narrows recovery rather than disabling RPCs.
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
select * from public.accept_business_invitation(repeat('a', 64));

reset role;

do $$
declare
  v_membership_count integer;
begin
  select count(*) into v_membership_count
  from public.memberships m
  where m.business_id = 'a4100000-0000-4000-8000-000000000001'
    and m.user_id = 'a4000000-0000-4000-8000-000000000003'
    and m.role = 'staff'
    and m.active;
  if v_membership_count <> 1 then
    raise exception 'password AMR did not preserve invitation acceptance';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.f10_accept_business_invitation_impl(text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.f10_create_business_invitation_impl(uuid,text,public.membership_role,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.f10_require_standard_session()',
      'EXECUTE'
    ) then
    raise exception 'internal F10 hardening helper unexpectedly exposed to authenticated';
  end if;
end
$$;

-- Seed exactly 100 live pending invitations into a separate business, then prove
-- the public create path refuses the 101st while holding the same business lock.
insert into public.business_invitations(
  business_id, email_normalized, role, token_hash,
  invited_by_membership_id, created_at, expires_at
)
select
  'a4100000-0000-4000-8000-000000000002'::uuid,
  format('f10-cap-%s@example.invalid', g),
  'staff'::public.membership_role,
  encode(extensions.digest(convert_to(format('f10-cap-%s', g), 'utf8'), 'sha256'), 'hex'),
  'a4200000-0000-4000-8000-000000000004'::uuid,
  now(), now() + interval '24 hours'
from generate_series(1, 100) as g;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
begin
  begin
    perform 1 from public.create_business_invitation(
      'a4100000-0000-4000-8000-000000000002',
      'f10-cap-101@example.invalid', 'staff', repeat('f', 64)
    );
    raise exception '101st live invitation unexpectedly created';
  exception when others then
    if sqlerrm = '101st live invitation unexpectedly created' then raise; end if;
    if position('TEAM_INVITATIONS_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;

do $$
declare
  v_pending integer;
begin
  select count(*) into v_pending
  from public.business_invitations i
  where i.business_id = 'a4100000-0000-4000-8000-000000000002'
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now();
  if v_pending <> 100 then
    raise exception 'pending invitation cap changed the set: %', v_pending;
  end if;
end
$$;

rollback;
