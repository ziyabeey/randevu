begin;

-- Supabase commonly installs pgcrypto in the `extensions` schema, while a plain
-- PostgreSQL CI database may expose it from `public`. Search both explicitly.
create or replace function public.management_token_hash(p_token text)
returns text
language plpgsql
immutable
security definer
set search_path = public, extensions
as $$
begin
  if p_token is null
     or char_length(p_token) < 43
     or char_length(p_token) > 128
     or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'INVALID_MANAGEMENT_TOKEN';
  end if;
  return encode(digest(p_token, 'sha256'), 'hex');
end
$$;

revoke all on function public.management_token_hash(text) from public;

commit;
