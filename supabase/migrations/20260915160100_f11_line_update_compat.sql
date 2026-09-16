begin;

-- F11-01 compatibility correction: an existing appointment line must never be
-- re-priced against today's catalog during status/reschedule updates. INSERT owns
-- snapshot capture; UPDATE only validates the immutable group identity and then
-- lets the dedicated immutability trigger protect frozen snapshot columns.
--
-- F12-03 also requires a hard semantic split between a range estimate and the
-- legacy definitive single-price snapshot. Fixed lines keep price_minor_snapshot;
-- range lines carry only the canonical min/max estimate and leave the legacy
-- definitive amount null until a later financial authority establishes one.
alter table public.appointments
  alter column price_minor_snapshot drop not null;

alter table public.appointments
  drop constraint if exists appointments_price_range_snapshot_check,
  add constraint appointments_price_range_snapshot_check
    check (
      price_min_minor_snapshot between 0 and 100000000
      and price_max_minor_snapshot between 0 and 100000000
      and price_min_minor_snapshot <= price_max_minor_snapshot
      and (
        (
          price_type_snapshot = 'fixed'
          and price_min_minor_snapshot = price_max_minor_snapshot
          and price_minor_snapshot = price_min_minor_snapshot
        )
        or (
          price_type_snapshot = 'range'
          and price_minor_snapshot is null
        )
      )
    );

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
     or v_group.source <> new.source
     or (tg_op = 'INSERT' and v_group.status <> new.status) then
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
    if new.price_minor_snapshot is null then
      raise exception 'SERVICE_PRICE_SNAPSHOT_MISMATCH';
    end if;
    new.price_type_snapshot := 'fixed';
    new.price_min_minor_snapshot := new.price_minor_snapshot;
    new.price_max_minor_snapshot := new.price_minor_snapshot;
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

commit;
