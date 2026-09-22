begin;

-- F14-04: bounded readonly ticket-list projection for operator/mobile UI.
-- Raw financial tables remain closed to API roles.

create or replace function public.list_ticket_contracts_page(
  p_business_id uuid,
  p_status text,
  p_customer_id uuid,
  p_limit integer,
  p_after_updated_at timestamptz,
  p_after_id uuid
)
returns table (
  ticket jsonb,
  sort_updated_at timestamptz,
  sort_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $f1404list$
begin
  perform public.f10_require_standard_session();

  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('open','closed','cancelled') then
    raise exception 'INVALID_TICKET_STATUS';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE';
  end if;

  if (p_after_updated_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE';
  end if;

  return query
  select
    public.f14_ticket_projection(t.business_id, t.id) as ticket,
    t.updated_at as sort_updated_at,
    t.id as sort_id
  from public.tickets t
  where t.business_id = p_business_id
    and (p_status is null or t.status = p_status)
    and (p_customer_id is null or t.customer_id = p_customer_id)
    and (
      p_after_updated_at is null
      or (t.updated_at, t.id) < (p_after_updated_at, p_after_id)
    )
  order by t.updated_at desc, t.id desc
  limit p_limit;
end
$f1404list$;

revoke all on function public.list_ticket_contracts_page(uuid,text,uuid,integer,timestamptz,uuid)
from public, anon, authenticated;

grant execute on function public.list_ticket_contracts_page(uuid,text,uuid,integer,timestamptz,uuid)
to authenticated;

commit;
