begin;

-- F13-01-DB-RACE-1: bind mutable (starts_at,id) keyset traversal to a
-- business-scoped opaque revision. The store is intentionally outside the
-- browser-exposed public schema; only the SECURITY DEFINER RPC/trigger touch it.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.appointment_page_revisions (
  business_id uuid primary key,
  revision uuid not null default gen_random_uuid()
);

revoke all on table private.appointment_page_revisions
  from public, anon, authenticated;

insert into private.appointment_page_revisions(business_id)
select b.id
from public.businesses b
on conflict (business_id) do nothing;

create or replace function public.f13_bump_appointment_page_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  -- EXP-H19 blind D0 x D5 variation: weaken tenant/revision conjunction.
  -- Any appointment mutation now invalidates every tenant revision row while
  -- preserving the existing per-tenant bump logic below.
  update private.appointment_page_revisions
  set revision = gen_random_uuid();

  if tg_op = 'INSERT' then
    insert into private.appointment_page_revisions(business_id, revision)
    values (new.business_id, gen_random_uuid())
    on conflict (business_id) do update
      set revision = excluded.revision;
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into private.appointment_page_revisions(business_id, revision)
    values (old.business_id, gen_random_uuid())
    on conflict (business_id) do update
      set revision = excluded.revision;
    return old;
  end if;

  if old.starts_at is not distinct from new.starts_at
     and old.business_id is not distinct from new.business_id then
    return new;
  end if;

  insert into private.appointment_page_revisions(business_id, revision)
  values (old.business_id, gen_random_uuid())
  on conflict (business_id) do update
    set revision = excluded.revision;

  if new.business_id is distinct from old.business_id then
    insert into private.appointment_page_revisions(business_id, revision)
    values (new.business_id, gen_random_uuid())
    on conflict (business_id) do update
      set revision = excluded.revision;
  end if;

  return new;
end
$$;

revoke all on function public.f13_bump_appointment_page_revision()
  from public, anon, authenticated;

drop trigger if exists f13_appointment_page_revision_bump on public.appointments;
create trigger f13_appointment_page_revision_bump
after insert or delete or update of starts_at, business_id
on public.appointments
for each row
execute function public.f13_bump_appointment_page_revision();

create or replace function public.list_appointments_page_v2(
  p_business_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null,
  p_expected_revision uuid default null
)
returns table(
  id uuid,
  business_id uuid,
  customer_id uuid,
  service_id uuid,
  staff_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  customer_name_snapshot text,
  customer_phone_snapshot text,
  customer_email_snapshot text,
  service_name_snapshot text,
  staff_name_snapshot text,
  price_minor_snapshot integer,
  currency_snapshot text,
  notes text,
  cancellation_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  page_revision uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
set statement_timeout = '5s'
as $$
declare
  v_revision uuid;
begin
  perform public.f10_require_standard_session();
  if auth.uid() is null or not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE_LIMIT';
  end if;
  if (p_after_starts_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;
  if (p_after_starts_at is null) <> (p_expected_revision is null) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;

  -- Existing businesses were seeded above and the appointment trigger creates
  -- the row for post-migration businesses. Keep an empty-business first read
  -- well-defined without granting browser access to the store.
  insert into private.appointment_page_revisions(business_id)
  values (p_business_id)
  on conflict on constraint appointment_page_revisions_pkey do nothing;

  -- SHARE conflicts with the trigger's revision UPDATE. A reader therefore
  -- binds one revision/data state while a writer waits, or waits for the writer
  -- and observes its new revision before any appointment rows can be returned.
  select r.revision
    into v_revision
  from private.appointment_page_revisions r
  where r.business_id = p_business_id
  for share;

  if p_expected_revision is not null
     and p_expected_revision is distinct from v_revision then
    raise exception 'STALE_APPOINTMENT_PAGE';
  end if;

  return query
  select
    a.id,a.business_id,a.customer_id,a.service_id,a.staff_id,a.status,
    a.starts_at,a.ends_at,a.timezone,
    a.customer_name_snapshot,a.customer_phone_snapshot,a.customer_email_snapshot,
    a.service_name_snapshot,a.staff_name_snapshot,a.price_minor_snapshot,
    a.currency_snapshot,a.notes,a.cancellation_reason,a.created_at,a.updated_at,
    v_revision
  from public.appointments a
  where a.business_id = p_business_id
    and (
      p_after_starts_at is null
      or (a.starts_at, a.id) > (p_after_starts_at, p_after_id)
    )
  order by a.starts_at, a.id
  limit p_limit;
end
$$;

-- The old mutable-key surface remains for historical migrations/internal owner
-- compatibility only. Browser/Worker authority moves to the exact v2 signature.
revoke all on function public.list_appointments_page(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;

revoke all on function public.list_appointments_page_v2(uuid,integer,timestamptz,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.list_appointments_page_v2(uuid,integer,timestamptz,uuid,uuid)
  to authenticated;

commit;
