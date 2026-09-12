create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Supabase sessions resolve extension functions through this default path.
-- Apply it to the database and to the CI login role so fresh psql/dblink
-- sessions behave like hosted Supabase. SECURITY DEFINER functions that call
-- extension functions still declare `extensions` explicitly themselves.
do $$
begin
  execute format(
    'alter database %I set search_path = "$user", public, extensions',
    current_database()
  );
  execute format(
    'alter role %I set search_path = "$user", public, extensions',
    current_user
  );
end
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
