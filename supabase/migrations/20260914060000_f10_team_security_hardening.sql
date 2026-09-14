begin;

-- F10 team RPCs are reachable through the Supabase Data API as `authenticated`.
-- Worker-side recovery guards therefore cannot be the only authority boundary.
-- PostgREST supplies the verified JWT claims in request.jwt.claims. Direct
-- postgres maintenance/tests may omit that request GUC, but every external API
-- role session must carry a well-formed, non-recovery AMR classification.
create or replace function public.f10_require_standard_session()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text := current_setting('request.jwt.claims', true);
  v_claims jsonb;
  v_amr jsonb;
  v_invalid_method boolean;
  v_recovery boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if v_raw is null or btrim(v_raw) = '' then
    -- Trusted direct DB maintenance and disposable CI sessions run as postgres
    -- and are not reachable through the API role. Hosted PostgREST sessions use
    -- an authenticator session user and must never take this compatibility path.
    if session_user = 'postgres' then
      return;
    end if;
    raise exception 'AUTH_SESSION_CLASS_UNVERIFIED' using errcode = '42501';
  end if;

  begin
    v_claims := v_raw::jsonb;
  exception when others then
    raise exception 'AUTH_SESSION_CLASS_UNVERIFIED' using errcode = '42501';
  end;

  if jsonb_typeof(v_claims) <> 'object' then
    raise exception 'AUTH_SESSION_CLASS_UNVERIFIED' using errcode = '42501';
  end if;

  v_amr := v_claims -> 'amr';
  if jsonb_typeof(v_amr) <> 'array' or jsonb_array_length(v_amr) = 0 then
    raise exception 'AUTH_SESSION_CLASS_UNVERIFIED' using errcode = '42501';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_amr) as item(value)
    where nullif(btrim(
      case jsonb_typeof(item.value)
        when 'string' then item.value #>> '{}'
        when 'object' then item.value ->> 'method'
        else null
      end
    ), '') is null
  ) into v_invalid_method;
  if v_invalid_method then
    raise exception 'AUTH_SESSION_CLASS_UNVERIFIED' using errcode = '42501';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_amr) as item(value)
    where lower(btrim(
      case jsonb_typeof(item.value)
        when 'string' then item.value #>> '{}'
        else item.value ->> 'method'
      end
    )) = 'recovery'
  ) into v_recovery;
  if v_recovery then
    raise exception 'PASSWORD_UPDATE_REQUIRED' using errcode = '42501';
  end if;
end
$$;

revoke all on function public.f10_require_standard_session() from public, anon, authenticated;

-- Every business-scoped F10 entry point already resolves through this helper.
-- Put the standard-session boundary here so invitation revoke, membership
-- mutation, staff linking, financial grant/revoke and team snapshot all inherit
-- the DB-side recovery guard without duplicating authority logic.
create or replace function public.f10_team_actor(p_business_id uuid)
returns table(membership_id uuid, role public.membership_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  return query
  select m.id, m.role
  from public.memberships m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and m.active
  limit 1;
end
$$;
revoke all on function public.f10_team_actor(uuid) from public, anon, authenticated;

-- Invitation acceptance is intentionally not tied to an existing membership,
-- so it does not pass through f10_team_actor. Preserve the deployed body as an
-- internal function and restore the public signature as a guarded wrapper.
alter function public.accept_business_invitation(text)
  rename to f10_accept_business_invitation_impl;
revoke all on function public.f10_accept_business_invitation_impl(text)
  from public, anon, authenticated;

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
begin
  perform public.f10_require_standard_session();
  return query
  select * from public.f10_accept_business_invitation_impl(p_token_hash);
end
$$;
revoke all on function public.accept_business_invitation(text) from public, anon, authenticated;
grant execute on function public.accept_business_invitation(text) to authenticated;

-- Bound live pending invitations on the write path under the same per-business
-- transaction lock used by the original creator. This prevents an authorized or
-- compromised manager from turning the bounded team snapshot into a 48-hour DoS.
alter function public.create_business_invitation(uuid,text,public.membership_role,text)
  rename to f10_create_business_invitation_impl;
revoke all on function public.f10_create_business_invitation_impl(uuid,text,public.membership_role,text)
  from public, anon, authenticated;

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
  v_pending_count integer;
begin
  perform public.f10_require_standard_session();
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select count(*) into v_pending_count
  from public.business_invitations i
  where i.business_id = p_business_id
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now();

  if v_pending_count >= 100 then
    raise exception 'TEAM_INVITATIONS_LIMIT_EXCEEDED';
  end if;

  return query
  select *
  from public.f10_create_business_invitation_impl(
    p_business_id, p_email, p_role, p_token_hash
  );
end
$$;
revoke all on function public.create_business_invitation(uuid,text,public.membership_role,text)
  from public, anon, authenticated;
grant execute on function public.create_business_invitation(uuid,text,public.membership_role,text)
  to authenticated;

-- Financial permission reads are also a directly granted RPC and do not use
-- f10_team_actor in their historical body. Re-state the small function with the
-- same return contract and the common standard-session guard.
create or replace function public.has_financial_permission(
  p_business_id uuid,
  p_permission public.financial_permission_key
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  return coalesce((
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
  ), false);
end
$$;
revoke all on function public.has_financial_permission(uuid,public.financial_permission_key)
  from public, anon, authenticated;
grant execute on function public.has_financial_permission(uuid,public.financial_permission_key)
  to authenticated;

commit;
