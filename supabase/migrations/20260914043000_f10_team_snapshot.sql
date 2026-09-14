begin;

create or replace function public.get_team_snapshot(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_member_count integer;
  v_staff_count integer;
  v_invitation_count integer := 0;
  v_members jsonb := '[]'::jsonb;
  v_staff jsonb := '[]'::jsonb;
  v_invitations jsonb := '[]'::jsonb;
  v_permissions jsonb := '[]'::jsonb;
  v_effective jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_actor
  from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;

  select count(*) into v_member_count
  from public.memberships m
  where m.business_id = p_business_id;
  if v_member_count > 100 then
    raise exception 'TEAM_MEMBERS_LIMIT_EXCEEDED';
  end if;

  select count(*) into v_staff_count
  from public.staff_profiles s
  where s.business_id = p_business_id;
  if v_staff_count > 100 then
    raise exception 'TEAM_STAFF_LIMIT_EXCEEDED';
  end if;

  if v_actor.role in ('owner', 'manager') then
    select count(*) into v_invitation_count
    from public.business_invitations i
    where i.business_id = p_business_id
      and i.revoked_at is null
      and i.accepted_at is null
      and i.expires_at > now()
      and (v_actor.role = 'owner' or i.role <> 'owner');
    if v_invitation_count > 100 then
      raise exception 'TEAM_INVITATIONS_LIMIT_EXCEEDED';
    end if;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'userId', m.user_id,
      'displayName', p.display_name,
      'email', case
        when v_actor.role in ('owner', 'manager') then lower(btrim(u.email))
        else null
      end,
      'role', m.role,
      'active', m.active
    ) order by m.created_at, m.id
  ), '[]'::jsonb)
  into v_members
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.business_id = p_business_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'membershipId', s.membership_id,
      'name', s.name,
      'active', s.active
    ) order by s.created_at, s.id
  ), '[]'::jsonb)
  into v_staff
  from public.staff_profiles s
  where s.business_id = p_business_id;

  if v_actor.role in ('owner', 'manager') then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'email', i.email_normalized,
        'role', i.role,
        'createdAt', i.created_at,
        'expiresAt', i.expires_at
      ) order by i.created_at, i.id
    ), '[]'::jsonb)
    into v_invitations
    from public.business_invitations i
    where i.business_id = p_business_id
      and i.revoked_at is null
      and i.accepted_at is null
      and i.expires_at > now()
      and (v_actor.role = 'owner' or i.role <> 'owner');
  end if;

  if v_actor.role = 'owner' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'membershipId', fp.membership_id,
        'permission', fp.permission
      ) order by fp.membership_id, fp.permission
    ), '[]'::jsonb)
    into v_permissions
    from public.membership_financial_permissions fp
    where fp.business_id = p_business_id
      and fp.active;
  end if;

  if v_actor.role in ('owner', 'manager') then
    select coalesce(jsonb_agg(permission::text order by permission::text), '[]'::jsonb)
    into v_effective
    from unnest(enum_range(null::public.financial_permission_key)) permission;
  else
    select coalesce(jsonb_agg(fp.permission::text order by fp.permission::text), '[]'::jsonb)
    into v_effective
    from public.membership_financial_permissions fp
    where fp.business_id = p_business_id
      and fp.membership_id = v_actor.membership_id
      and fp.active;
  end if;

  return jsonb_build_object(
    'actor', jsonb_build_object(
      'membershipId', v_actor.membership_id,
      'role', v_actor.role
    ),
    'members', v_members,
    'staff', v_staff,
    'invitations', v_invitations,
    'financialPermissions', v_permissions,
    'effectiveFinancialPermissions', v_effective
  );
end
$$;

revoke all on function public.get_team_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_team_snapshot(uuid) to authenticated;

commit;
