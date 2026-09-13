begin;

-- S08: keep future objects in the exposed public schema closed by default.
-- Supabase's legacy project defaults can grant API roles access to objects
-- created by postgres. RLS and object privileges are separate layers, so future
-- tables/views and sequences must require an explicit GRANT before they are
-- reachable by anon/authenticated.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;

-- Functions have PostgreSQL's built-in PUBLIC EXECUTE default in addition to
-- Supabase's schema-scoped API-role defaults. Preserve the F17-01 deny-by-default
-- function boundary at both layers.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

commit;
