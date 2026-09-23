begin;

do $$ begin
  create type public.financial_permission_key as enum (
    'payments_write',
    'pricing_adjustments_write',
    'financial_reports_read',
    'inventory_write',
    'expenses_write'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.financial_permission_action as enum ('grant', 'revoke');
exception when duplicate_object then null;
end $$;

create table public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email_normalized text not null,
  role public.membership_role not null,
  token_hash text not null unique,
  invited_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by_user_id uuid references public.profiles(id) on delete set null,
  constraint business_invitations_inviter_fk
    foreign key (business_id, invited_by_membership_id)
    references public.memberships(business_id, id),
  constraint business_invitations_email_normalized
    check (
      email_normalized = lower(btrim(email_normalized))
      and char_length(email_normalized) between 3 and 320
      and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  constraint business_invitations_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint business_invitations_expiry_after_create
    check (expires_at > created_at),
  constraint business_invitations_single_terminal_state
    check (not (revoked_at is not null and accepted_at is not null))
);

create unique index business_invitations_one_pending_email_idx
  on public.business_invitations(business_id, email_normalized)
  where revoked_at is null and accepted_at is null;
create index business_invitations_business_created_idx
  on public.business_invitations(business_id, created_at desc, id desc);
create index business_invitations_business_pending_idx
  on public.business_invitations(business_id, expires_at)
  where revoked_at is null and accepted_at is null;

create table public.membership_financial_permissions (
  business_id uuid not null references public.businesses(id) on delete cascade,
  membership_id uuid not null,
  permission public.financial_permission_key not null,
  active boolean not null default true,
  granted_by_membership_id uuid not null,
  granted_at timestamptz not null default now(),
  revoked_by_membership_id uuid,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, membership_id, permission),
  constraint membership_financial_permissions_member_fk
    foreign key (business_id, membership_id)
    references public.memberships(business_id, id) on delete cascade,
  constraint membership_financial_permissions_granter_fk
    foreign key (business_id, granted_by_membership_id)
    references public.memberships(business_id, id),
  constraint membership_financial_permissions_revoker_fk
    foreign key (business_id, revoked_by_membership_id)
    references public.memberships(business_id, id),
  constraint membership_financial_permissions_state
    check (
      (active and revoked_by_membership_id is null and revoked_at is null)
      or
      (not active and revoked_by_membership_id is not null and revoked_at is not null)
    )
);

create index membership_financial_permissions_active_idx
  on public.membership_financial_permissions(business_id, membership_id, permission)
  where active;

create table public.membership_financial_permission_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  membership_id uuid not null,
  permission public.financial_permission_key not null,
  action public.financial_permission_action not null,
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  constraint membership_financial_permission_events_member_fk
    foreign key (business_id, membership_id)
    references public.memberships(business_id, id) on delete cascade,
  constraint membership_financial_permission_events_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id)
);

create index membership_financial_permission_events_business_idx
  on public.membership_financial_permission_events(business_id, created_at desc, id desc);

drop trigger if exists business_invitations_touch_updated_at on public.business_invitations;
create trigger business_invitations_touch_updated_at
before update on public.business_invitations
for each row execute function public.touch_updated_at();

drop trigger if exists membership_financial_permissions_touch_updated_at on public.membership_financial_permissions;
create trigger membership_financial_permissions_touch_updated_at
before update on public.membership_financial_permissions
for each row execute function public.touch_updated_at();

alter table public.business_invitations enable row level security;
alter table public.membership_financial_permissions enable row level security;
alter table public.membership_financial_permission_events enable row level security;
alter table public.business_invitations force row level security;
alter table public.membership_financial_permissions force row level security;
alter table public.membership_financial_permission_events force row level security;

-- These tables intentionally expose no direct API-role policies. Every access
-- path below is a narrow SECURITY DEFINER RPC that re-checks current membership.
revoke all on public.business_invitations from anon, authenticated;
revoke all on public.membership_financial_permissions from anon, authenticated;
revoke all on public.membership_financial_permission_events from anon, authenticated;
revoke all on sequence public.membership_financial_permission_events_id_seq from anon, authenticated;

create or replace function public.f10_team_actor(p_business_id uuid)
returns table(membership_id uuid, role public.membership_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.role
  from public.memberships m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and m.active
  limit 1
$$;

create or replace function public.f10_revoke_financial_permissions(
  p_business_id uuid,
  p_membership_id uuid,
  p_actor_membership_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with changed as (
    update public.membership_financial_permissions p
    set active = false,
        revoked_by_membership_id = p_actor_membership_id,
        revoked_at = now()
    where p.business_id = p_business_id
      and p.membership_id = p_membership_id
      and p.active
    returning p.permission
  )
  insert into public.membership_financial_permission_events(
    business_id, membership_id, permission, action, actor_membership_id
  )
  select p_business_id, p_membership_id, c.permission, 'revoke'::public.financial_permission_action,
         p_actor_membership_id
  from changed c;
end
$$;

create or replace function public.create_business_invitation(
  p_business_id uuid,
  p_email text,
  p_role public.membership_role,
  p_token_hash text
)
returns table(
  invitation_id uuid,
  business_id uuid,
  email text,
  role public.membership_role,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_invitation public.business_invitations;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'INVALID_INVITATION_ROLE';
  end if;
  if v_actor.role = 'manager' and p_role = 'owner' then
    raise exception 'OWNER_ROLE_REQUIRES_OWNER' using errcode = '42501';
  end if;
  if char_length(v_email) < 3 or char_length(v_email) > 320
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INVITATION_EMAIL';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITATION_TOKEN_HASH';
  end if;

  if exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.business_id = p_business_id
      and m.active
      and lower(btrim(coalesce(u.email, ''))) = v_email
  ) then
    raise exception 'ALREADY_ACTIVE_MEMBER';
  end if;

  update public.business_invitations i
  set revoked_at = now()
  where i.business_id = p_business_id
    and i.email_normalized = v_email
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at <= now();

  begin
    insert into public.business_invitations(
      business_id, email_normalized, role, token_hash, invited_by_membership_id, expires_at
    ) values (
      p_business_id, v_email, p_role, v_hash, v_actor.membership_id, now() + interval '48 hours'
    )
    returning * into v_invitation;
  exception when unique_violation then
    raise exception 'INVITATION_ALREADY_PENDING';
  end;

  return query
  select v_invitation.id, v_invitation.business_id, v_invitation.email_normalized,
         v_invitation.role, v_invitation.expires_at;
end
$$;

create or replace function public.revoke_business_invitation(
  p_business_id uuid,
  p_invitation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_invitation public.business_invitations;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.business_invitations i
  where i.business_id = p_business_id and i.id = p_invitation_id
  for update;

  if v_invitation.id is null then
    raise exception 'INVITATION_NOT_FOUND';
  end if;
  if v_actor.role = 'manager' and v_invitation.role = 'owner' then
    raise exception 'OWNER_ROLE_REQUIRES_OWNER' using errcode = '42501';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception 'INVITATION_ALREADY_USED';
  end if;
  if v_invitation.revoked_at is not null then
    return;
  end if;

  update public.business_invitations
  set revoked_at = now()
  where id = v_invitation.id;
end
$$;

create or replace function public.accept_business_invitation(p_token_hash text)
returns table(
  business_id uuid,
  membership_id uuid,
  role public.membership_role
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_hash text := lower(btrim(coalesce(p_token_hash, '')));
  v_invitation public.business_invitations;
  v_membership_id uuid;
  v_existing_active boolean;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_INVITATION_TOKEN_HASH';
  end if;

  select lower(btrim(coalesce(u.email, ''))) into v_email
  from auth.users u
  where u.id = v_user_id;
  if v_email is null or v_email = '' then
    raise exception 'AUTH_EMAIL_REQUIRED' using errcode = '42501';
  end if;

  select * into v_invitation
  from public.business_invitations i
  where i.token_hash = v_hash;
  if v_invitation.id is null then
    raise exception 'INVITATION_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_invitation.business_id::text, 0));

  select * into v_invitation
  from public.business_invitations i
  where i.id = v_invitation.id
  for update;

  if v_invitation.revoked_at is not null then
    raise exception 'INVITATION_REVOKED';
  end if;
  if v_invitation.accepted_at is not null then
    raise exception 'INVITATION_ALREADY_USED';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception 'INVITATION_EXPIRED';
  end if;
  if v_invitation.email_normalized <> v_email then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = '42501';
  end if;

  select m.id, m.active into v_membership_id, v_existing_active
  from public.memberships m
  where m.business_id = v_invitation.business_id
    and m.user_id = v_user_id
  for update;

  if v_membership_id is not null and v_existing_active then
    raise exception 'ALREADY_ACTIVE_MEMBER';
  end if;

  if v_membership_id is null then
    insert into public.memberships(business_id, user_id, role, active)
    values (v_invitation.business_id, v_user_id, v_invitation.role, true)
    returning id into v_membership_id;
  else
    update public.memberships
    set role = v_invitation.role,
        active = true
    where id = v_membership_id;
  end if;

  update public.business_invitations
  set accepted_at = now(),
      accepted_by_user_id = v_user_id
  where id = v_invitation.id;

  return query
  select v_invitation.business_id, v_membership_id, v_invitation.role;
end
$$;

create or replace function public.update_team_membership(
  p_business_id uuid,
  p_membership_id uuid,
  p_role public.membership_role,
  p_active boolean
)
returns table(
  membership_id uuid,
  role public.membership_role,
  active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_target public.memberships;
  v_other_owner_count integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_role is null or p_active is null then
    raise exception 'INVALID_MEMBERSHIP_UPDATE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_target
  from public.memberships m
  where m.business_id = p_business_id and m.id = p_membership_id
  for update;
  if v_target.id is null then
    raise exception 'MEMBERSHIP_NOT_FOUND';
  end if;

  if v_actor.role = 'manager' and (v_target.role = 'owner' or p_role = 'owner') then
    raise exception 'OWNER_ROLE_REQUIRES_OWNER' using errcode = '42501';
  end if;

  if v_target.active and v_target.role = 'owner'
     and (not p_active or p_role <> 'owner') then
    select count(*) into v_other_owner_count
    from public.memberships m
    where m.active
      and m.role = 'owner'
      and m.id <> v_target.id;
    if v_other_owner_count = 0 then
      raise exception 'LAST_ACTIVE_OWNER';
    end if;
  end if;

  update public.memberships m
  set role = p_role,
      active = p_active
  where m.id = v_target.id;

  if v_target.role is distinct from p_role or v_target.active is distinct from p_active then
    perform public.f10_revoke_financial_permissions(
      p_business_id, v_target.id, v_actor.membership_id
    );
  end if;

  return query select v_target.id, p_role, p_active;
end
$$;

create or replace function public.set_staff_membership_link(
  p_business_id uuid,
  p_staff_id uuid,
  p_membership_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_staff public.staff_profiles;
  v_member public.memberships;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role not in ('owner', 'manager') then
    raise exception 'TEAM_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_staff
  from public.staff_profiles s
  where s.business_id = p_business_id and s.id = p_staff_id
  for update;
  if v_staff.id is null then
    raise exception 'STAFF_NOT_FOUND';
  end if;

  if p_membership_id is not null then
    select * into v_member
    from public.memberships m
    where m.business_id = p_business_id
      and m.id = p_membership_id
      and m.active
    for update;
    if v_member.id is null then
      raise exception 'ACTIVE_MEMBERSHIP_NOT_FOUND';
    end if;
  end if;

  update public.staff_profiles
  set membership_id = p_membership_id
  where id = v_staff.id;

  return p_membership_id;
end
$$;

create or replace function public.set_membership_financial_permission(
  p_business_id uuid,
  p_membership_id uuid,
  p_permission public.financial_permission_key,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_target public.memberships;
  v_current_active boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_permission is null or p_enabled is null then
    raise exception 'INVALID_FINANCIAL_PERMISSION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  select * into v_actor from public.f10_team_actor(p_business_id);
  if v_actor.membership_id is null or v_actor.role <> 'owner' then
    raise exception 'FINANCIAL_PERMISSION_OWNER_REQUIRED' using errcode = '42501';
  end if;

  select * into v_target
  from public.memberships m
  where m.business_id = p_business_id and m.id = p_membership_id
  for update;
  if v_target.id is null or not v_target.active then
    raise exception 'ACTIVE_MEMBERSHIP_NOT_FOUND';
  end if;
  if v_target.role <> 'staff' then
    raise exception 'FINANCIAL_PERMISSION_STAFF_ONLY';
  end if;

  select p.active into v_current_active
  from public.membership_financial_permissions p
  where p.business_id = p_business_id
    and p.membership_id = p_membership_id
    and p.permission = p_permission
  for update;

  if p_enabled then
    if coalesce(v_current_active, false) then
      return true;
    end if;

    insert into public.membership_financial_permissions(
      business_id, membership_id, permission, active,
      granted_by_membership_id, granted_at, revoked_by_membership_id, revoked_at
    ) values (
      p_business_id, p_membership_id, p_permission, true,
      v_actor.membership_id, now(), null, null
    )
    on conflict (business_id, membership_id, permission)
    do update set
      active = true,
      granted_by_membership_id = excluded.granted_by_membership_id,
      granted_at = excluded.granted_at,
      revoked_by_membership_id = null,
      revoked_at = null;

    insert into public.membership_financial_permission_events(
      business_id, membership_id, permission, action, actor_membership_id
    ) values (
      p_business_id, p_membership_id, p_permission,
      'grant'::public.financial_permission_action, v_actor.membership_id
    );
    return true;
  end if;

  if not coalesce(v_current_active, false) then
    return false;
  end if;

  update public.membership_financial_permissions
  set active = false,
      revoked_by_membership_id = v_actor.membership_id,
      revoked_at = now()
  where business_id = p_business_id
    and membership_id = p_membership_id
    and permission = p_permission;

  insert into public.membership_financial_permission_events(
    business_id, membership_id, permission, action, actor_membership_id
  ) values (
    p_business_id, p_membership_id, p_permission,
    'revoke'::public.financial_permission_action, v_actor.membership_id
  );

  return false;
end
$$;

create or replace function public.has_financial_permission(
  p_business_id uuid,
  p_permission public.financial_permission_key
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when m.role in ('owner', 'manager') then true
      when m.role = 'staff' then exists (
        select 1
        from public.membership_financial_permissions p
        where p.business_id = m.business_id
          and p.membership_id = m.id
          and p.permission = p_permission
          and p.active
      )
      else false
    end
    from public.memberships m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.active
    limit 1
  ), false)
$$;

-- Helpers remain inaccessible to API roles.
revoke all on function public.f10_team_actor(uuid) from public, anon, authenticated;
revoke all on function public.f10_revoke_financial_permissions(uuid,uuid,uuid) from public, anon, authenticated;

-- Public team operations require a Supabase-authenticated user. The functions
-- themselves enforce current active membership and role on every call.
revoke all on function public.create_business_invitation(uuid,text,public.membership_role,text) from public, anon, authenticated;
revoke all on function public.revoke_business_invitation(uuid,uuid) from public, anon, authenticated;
revoke all on function public.accept_business_invitation(text) from public, anon, authenticated;
revoke all on function public.update_team_membership(uuid,uuid,public.membership_role,boolean) from public, anon, authenticated;
revoke all on function public.set_staff_membership_link(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.set_membership_financial_permission(uuid,uuid,public.financial_permission_key,boolean) from public, anon, authenticated;
revoke all on function public.has_financial_permission(uuid,public.financial_permission_key) from public, anon, authenticated;

grant execute on function public.create_business_invitation(uuid,text,public.membership_role,text) to authenticated;
grant execute on function public.revoke_business_invitation(uuid,uuid) to authenticated;
grant execute on function public.accept_business_invitation(text) to authenticated;
grant execute on function public.update_team_membership(uuid,uuid,public.membership_role,boolean) to authenticated;
grant execute on function public.set_staff_membership_link(uuid,uuid,uuid) to authenticated;
grant execute on function public.set_membership_financial_permission(uuid,uuid,public.financial_permission_key,boolean) to authenticated;
grant execute on function public.has_financial_permission(uuid,public.financial_permission_key) to authenticated;

commit;
