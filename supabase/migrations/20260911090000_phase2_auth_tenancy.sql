begin;

do $$ begin
  create type public.membership_role as enum ('owner', 'manager', 'staff');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'Europe/Istanbul',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.membership_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id),
  unique (business_id, id)
);

create index if not exists memberships_user_active_idx on public.memberships(user_id, active, business_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values(new.id, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))), ''))
  on conflict(id) do update set display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles(id, display_name)
select id, nullif(trim(coalesce(raw_user_meta_data ->> 'full_name', split_part(coalesce(email, ''), '@', 1))), '')
from auth.users
on conflict(id) do nothing;

create or replace function public.is_active_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.memberships m
    where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function public.current_membership_role(p_business_id uuid)
returns public.membership_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
$$;

create or replace function public.can_manage_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_membership_role(p_business_id) in ('owner', 'manager'), false);
$$;

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles force row level security;
alter table public.businesses force row level security;
alter table public.memberships force row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists businesses_select_active_member on public.businesses;
create policy businesses_select_active_member on public.businesses for select to authenticated using (public.is_active_member(id));

drop policy if exists memberships_select_self on public.memberships;
create policy memberships_select_self on public.memberships for select to authenticated using (user_id = auth.uid() and active);

revoke all on public.profiles, public.businesses, public.memberships from anon;
grant select on public.profiles, public.businesses, public.memberships to authenticated;

revoke all on function public.is_active_member(uuid) from public;
revoke all on function public.current_membership_role(uuid) from public;
revoke all on function public.can_manage_business(uuid) from public;
grant execute on function public.is_active_member(uuid) to authenticated;
grant execute on function public.current_membership_role(uuid) to authenticated;
grant execute on function public.can_manage_business(uuid) to authenticated;

create or replace function public.create_business_with_owner(p_name text, p_slug text, p_timezone text default 'Europe/Istanbul')
returns table(id uuid, name text, slug text, timezone text, role public.membership_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_business public.businesses;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(trim(p_name)) < 2 then raise exception 'INVALID_BUSINESS_NAME'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_BUSINESS_SLUG'; end if;

  insert into public.businesses(name, slug, timezone, created_by)
  values(trim(p_name), lower(p_slug), coalesce(nullif(trim(p_timezone), ''), 'Europe/Istanbul'), v_user)
  returning * into v_business;

  insert into public.memberships(business_id, user_id, role, active)
  values(v_business.id, v_user, 'owner', true);

  return query select v_business.id, v_business.name, v_business.slug, v_business.timezone, 'owner'::public.membership_role;
end $$;

revoke all on function public.create_business_with_owner(text,text,text) from public;
grant execute on function public.create_business_with_owner(text,text,text) to authenticated;

commit;
