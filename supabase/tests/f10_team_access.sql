-- Temporary F10-02 ACL diagnostic wrapper. Keep production migration clean: this
-- file prints only role/object ACL metadata, then executes the real functional
-- acceptance body from f10_team_access_core.sql.
select
  c.relname,
  coalesce(c.relacl::text, '<null>') as relacl,
  has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'business_invitations',
    'membership_financial_permissions',
    'membership_financial_permission_events'
  )
order by c.relname;

select
  r.rolname,
  r.rolsuper,
  r.rolinherit,
  coalesce(array_agg(parent.rolname order by parent.rolname)
           filter (where parent.rolname is not null), '{}'::text[]) as member_of
from pg_roles r
left join pg_auth_members m on m.member = r.oid
left join pg_roles parent on parent.oid = m.roleid
where r.rolname in ('anon', 'authenticated')
group by r.rolname, r.rolsuper, r.rolinherit
order by r.rolname;

\ir f10_team_access_core.sql
