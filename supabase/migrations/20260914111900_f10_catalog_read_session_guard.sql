begin;

-- F10-04 R1 follow-up: raw Data API reads of catalog/hours tables must
-- enforce the same standard-session boundary as guarded RPC/Worker reads.
-- Keep the existing active-Membership tenant model; only recovery-class
-- authenticated sessions are filtered out at the RLS boundary.
create or replace function public.f10_has_standard_session()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  return true;
exception when others then
  return false;
end
$$;

revoke all on function public.f10_has_standard_session() from public, anon, authenticated;
grant execute on function public.f10_has_standard_session() to authenticated;

drop policy if exists services_select_member on public.services;
create policy services_select_member on public.services
for select to authenticated
using (
  public.is_active_member(business_id)
  and public.f10_has_standard_session()
);

drop policy if exists staff_select_member on public.staff_profiles;
create policy staff_select_member on public.staff_profiles
for select to authenticated
using (
  public.is_active_member(business_id)
  and public.f10_has_standard_session()
);

drop policy if exists staff_services_select_member on public.staff_services;
create policy staff_services_select_member on public.staff_services
for select to authenticated
using (
  public.is_active_member(business_id)
  and public.f10_has_standard_session()
);

drop policy if exists business_hours_select_member on public.business_hours;
create policy business_hours_select_member on public.business_hours
for select to authenticated
using (
  public.is_active_member(business_id)
  and public.f10_has_standard_session()
);

drop policy if exists staff_hours_select_member on public.staff_hours;
create policy staff_hours_select_member on public.staff_hours
for select to authenticated
using (
  public.is_active_member(business_id)
  and public.f10_has_standard_session()
);

drop policy if exists availability_blocks_select_member on public.availability_blocks;
create policy availability_blocks_select_member on public.availability_blocks
for select to authenticated
using (
  public.is_active_member(business_id)
  and public.f10_has_standard_session()
);

commit;
