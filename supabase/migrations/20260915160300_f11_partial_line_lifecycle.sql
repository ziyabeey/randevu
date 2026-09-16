begin;

-- F11-01 field repair from Phase-11 salon receipt #5693460041.
-- A reservation group may contain independently changing service lines, so line
-- lifecycle status cannot be part of the line->group identity key. Tenant,
-- customer and source remain fail-closed at both trigger and FK boundaries.
alter table public.appointments
  drop constraint if exists appointments_group_contract_fk;

alter table public.appointment_groups
  drop constraint if exists appointment_groups_contract_key,
  drop constraint if exists appointment_groups_status_check;

alter table public.appointment_groups
  add constraint appointment_groups_status_check
    check (status in ('scheduled','confirmed','completed','no_show','cancelled','partial')),
  add constraint appointment_groups_contract_key
    unique (business_id, id, customer_id, source);

alter table public.appointments
  add constraint appointments_group_contract_fk
    foreign key (business_id, group_id, customer_id, source)
    references public.appointment_groups(business_id, id, customer_id, source)
    deferrable initially deferred;

-- Legacy appointment inserts still omit group/line/F12 range snapshot columns.
-- Preserve the fixed-price coherence fence from the prior R1 repair while
-- removing only the now-invalid line-status == group-status admission rule.
create or replace function public.f11_prepare_appointment_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group public.appointment_groups;
  v_service public.services;
  v_explicit_price boolean;
begin
  if new.id is null then
    raise exception 'INVALID_APPOINTMENT_LINE';
  end if;

  if new.group_id is null then
    if tg_op = 'UPDATE' then
      raise exception 'BOOKING_GROUP_REQUIRED';
    end if;
    new.group_id := new.id;
    new.line_ordinal := 1;

    insert into public.appointment_groups(
      id, business_id, customer_id, status, source, version,
      legacy_appointment_id, created_by, created_at, updated_at
    ) values (
      new.group_id, new.business_id, new.customer_id, new.status, new.source, 1,
      new.id, new.created_by, coalesce(new.created_at, now()), coalesce(new.updated_at, now())
    )
    on conflict (id) do nothing;
  elsif new.line_ordinal is null then
    raise exception 'INVALID_APPOINTMENT_LINE_ORDINAL';
  end if;

  select * into v_group
  from public.appointment_groups g
  where g.id = new.group_id;

  if v_group.id is null
     or v_group.business_id <> new.business_id
     or v_group.customer_id <> new.customer_id
     or v_group.source <> new.source then
    raise exception 'BOOKING_GROUP_CONTRACT_MISMATCH';
  end if;

  if v_group.legacy_appointment_id is not null
     and (v_group.legacy_appointment_id <> new.id or new.line_ordinal <> 1) then
    raise exception 'BOOKING_GROUP_LEGACY_ANCHOR_CONFLICT';
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;

  select * into v_service
  from public.services s
  where s.business_id = new.business_id
    and s.id = new.service_id;
  if v_service.id is null then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  v_explicit_price := new.price_type_snapshot is not null
    or new.price_min_minor_snapshot is not null
    or new.price_max_minor_snapshot is not null
    or new.price_policy_version_snapshot is not null;

  if not v_explicit_price then
    if v_service.price_type <> 'fixed' then
      raise exception 'SERVICE_PRICE_NOT_FINAL';
    end if;
    if new.price_minor_snapshot is null
       or new.price_minor_snapshot <> v_service.price_minor
       or new.currency_snapshot is null
       or new.currency_snapshot <> v_service.currency
       or v_service.price_min_minor <> v_service.price_minor
       or v_service.price_max_minor <> v_service.price_minor then
      raise exception 'SERVICE_PRICE_SNAPSHOT_MISMATCH';
    end if;
    new.price_type_snapshot := 'fixed';
    new.price_min_minor_snapshot := v_service.price_min_minor;
    new.price_max_minor_snapshot := v_service.price_max_minor;
    new.price_policy_version_snapshot := v_service.price_policy_version;
  else
    if new.price_type_snapshot is null
       or new.price_min_minor_snapshot is null
       or new.price_max_minor_snapshot is null
       or new.price_policy_version_snapshot is null
       or new.price_type_snapshot <> v_service.price_type
       or new.price_min_minor_snapshot <> v_service.price_min_minor
       or new.price_max_minor_snapshot <> v_service.price_max_minor
       or new.currency_snapshot <> v_service.currency
       or new.price_policy_version_snapshot <> v_service.price_policy_version
       or (
         new.price_type_snapshot = 'fixed'
         and (
           new.price_min_minor_snapshot <> new.price_max_minor_snapshot
           or new.price_minor_snapshot is null
           or new.price_minor_snapshot <> new.price_min_minor_snapshot
         )
       )
       or (
         new.price_type_snapshot = 'range'
         and new.price_minor_snapshot is not null
       ) then
      raise exception 'SERVICE_PRICE_SNAPSHOT_MISMATCH';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.f11_prepare_appointment_line() from public, anon, authenticated;

-- Group status is an aggregate, not a copied line field:
--   * one distinct line status -> that exact status
--   * multiple line statuses   -> partial
-- Legacy one-line groups are excluded here because the historical sync trigger
-- remains their sole lifecycle/version authority.
create or replace function public.f11_aggregate_group_status_from_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_legacy_appointment_id uuid;
  v_line_count integer;
  v_distinct_status_count integer;
  v_aggregate_status text;
begin
  select g.legacy_appointment_id
  into v_legacy_appointment_id
  from public.appointment_groups g
  where g.business_id = new.business_id
    and g.id = new.group_id
  for update;

  if not found then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;

  if v_legacy_appointment_id is not null then
    return new;
  end if;

  select
    count(*)::integer,
    count(distinct a.status)::integer,
    min(a.status)
  into v_line_count, v_distinct_status_count, v_aggregate_status
  from public.appointments a
  where a.business_id = new.business_id
    and a.group_id = new.group_id;

  if v_line_count = 0 then
    return new;
  end if;

  if v_distinct_status_count > 1 then
    v_aggregate_status := 'partial';
  end if;

  update public.appointment_groups g
  set status = v_aggregate_status,
      version = case when tg_op = 'UPDATE' then g.version + 1 else g.version end,
      updated_at = case
        when tg_op = 'UPDATE' or g.status is distinct from v_aggregate_status then now()
        else g.updated_at
      end
  where g.business_id = new.business_id
    and g.id = new.group_id;

  return new;
end
$$;

revoke all on function public.f11_aggregate_group_status_from_line() from public, anon, authenticated;

drop trigger if exists appointments_f11_group_status_insert on public.appointments;
create trigger appointments_f11_group_status_insert
after insert on public.appointments
for each row execute function public.f11_aggregate_group_status_from_line();

drop trigger if exists appointments_f11_group_status_update on public.appointments;
create trigger appointments_f11_group_status_update
after update of status on public.appointments
for each row
when (old.status is distinct from new.status)
execute function public.f11_aggregate_group_status_from_line();

-- Existing non-legacy groups, if any, are normalized without manufacturing a
-- version bump. Legacy one-line headers retain their historical exact status.
with aggregate_status as (
  select
    a.business_id,
    a.group_id,
    case
      when count(distinct a.status) = 1 then min(a.status)
      else 'partial'
    end as status
  from public.appointments a
  group by a.business_id, a.group_id
)
update public.appointment_groups g
set status = a.status
from aggregate_status a
where g.business_id = a.business_id
  and g.id = a.group_id
  and g.legacy_appointment_id is null
  and g.status is distinct from a.status;

commit;
