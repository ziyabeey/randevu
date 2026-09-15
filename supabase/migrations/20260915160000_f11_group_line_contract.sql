begin;

-- F11-01: additive reservation-group contract over the existing appointments
-- line store. Legacy appointment IDs remain stable and deterministically map to
-- one-line groups with group_id = appointment_id. No historical migration is
-- rewritten and old single-service RPCs keep working against this schema.

create table if not exists public.appointment_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','confirmed','completed','no_show','cancelled')),
  source text not null default 'operator'
    check (source in ('operator','public')),
  version integer not null default 1 check (version > 0),
  legacy_appointment_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_groups_business_id_key unique (business_id, id),
  constraint appointment_groups_contract_key
    unique (business_id, id, customer_id, status, source),
  constraint appointment_groups_legacy_appointment_key unique (legacy_appointment_id),
  constraint appointment_groups_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id)
);

alter table public.appointment_groups enable row level security;
alter table public.appointment_groups force row level security;
revoke all on table public.appointment_groups from public, anon, authenticated;

drop policy if exists appointment_groups_select_member on public.appointment_groups;
create policy appointment_groups_select_member on public.appointment_groups
for select to authenticated
using (public.is_active_member(business_id));

alter table public.appointments
  add column if not exists group_id uuid,
  add column if not exists line_ordinal smallint,
  add column if not exists price_type_snapshot text,
  add column if not exists price_min_minor_snapshot integer,
  add column if not exists price_max_minor_snapshot integer,
  add column if not exists price_policy_version_snapshot integer;

alter table public.appointment_events
  add column if not exists group_id uuid,
  add column if not exists group_version integer;

alter table public.booking_commands
  add column if not exists group_id uuid;

alter table public.appointment_management_capabilities
  add column if not exists group_id uuid;

alter table public.public_booking_recoveries
  add column if not exists group_id uuid;

alter table public.appointment_notification_jobs
  add column if not exists group_id uuid,
  add column if not exists group_version integer;

-- Create one deterministic group for every legacy appointment. Existing event
-- count is the best lossless optimistic-version baseline: one create event means
-- version 1, each historical lifecycle mutation advances it once.
insert into public.appointment_groups(
  id,
  business_id,
  customer_id,
  status,
  source,
  version,
  legacy_appointment_id,
  created_by,
  created_at,
  updated_at
)
select
  a.id,
  a.business_id,
  a.customer_id,
  a.status,
  a.source,
  greatest(1, coalesce(e.event_count, 0))::integer,
  a.id,
  a.created_by,
  a.created_at,
  a.updated_at
from public.appointments a
left join lateral (
  select count(*)::integer as event_count
  from public.appointment_events ev
  where ev.business_id = a.business_id
    and ev.appointment_id = a.id
) e on true
on conflict (id) do nothing;

-- Backfilling additive line metadata must not rewrite historical appointment
-- updated_at timestamps. The S03 lifecycle trigger watches other columns and is
-- intentionally left enabled so the migration cannot silently weaken it.
alter table public.appointments disable trigger appointments_touch_updated_at;
update public.appointments a
set group_id = coalesce(a.group_id, a.id),
    line_ordinal = coalesce(a.line_ordinal, 1),
    price_type_snapshot = coalesce(a.price_type_snapshot, 'fixed'),
    price_min_minor_snapshot = coalesce(a.price_min_minor_snapshot, a.price_minor_snapshot),
    price_max_minor_snapshot = coalesce(a.price_max_minor_snapshot, a.price_minor_snapshot),
    price_policy_version_snapshot = coalesce(a.price_policy_version_snapshot, 1)
where a.group_id is null
   or a.line_ordinal is null
   or a.price_type_snapshot is null
   or a.price_min_minor_snapshot is null
   or a.price_max_minor_snapshot is null
   or a.price_policy_version_snapshot is null;
alter table public.appointments enable trigger appointments_touch_updated_at;

-- Preserve every historical audit row and attach deterministic group/version
-- metadata without creating synthetic events.
with ranked as (
  select
    ev.id,
    a.group_id,
    row_number() over (
      partition by a.group_id
      order by ev.created_at, ev.id
    )::integer as group_version
  from public.appointment_events ev
  join public.appointments a
    on a.business_id = ev.business_id
   and a.id = ev.appointment_id
)
update public.appointment_events ev
set group_id = coalesce(ev.group_id, r.group_id),
    group_version = coalesce(ev.group_version, r.group_version)
from ranked r
where r.id = ev.id
  and (ev.group_id is null or ev.group_version is null);

update public.booking_commands c
set group_id = a.group_id
from public.appointments a
where c.group_id is null
  and c.appointment_id is not null
  and a.business_id = c.business_id
  and a.id = c.appointment_id;

update public.appointment_management_capabilities cap
set group_id = a.group_id
from public.appointments a
where cap.group_id is null
  and a.business_id = cap.business_id
  and a.id = cap.appointment_id;

update public.public_booking_recoveries r
set group_id = a.group_id
from public.appointments a
where r.group_id is null
  and r.appointment_id is not null
  and a.business_id = r.business_id
  and a.id = r.appointment_id;

update public.appointment_notification_jobs j
set group_id = a.group_id
from public.appointments a
where j.group_id is null
  and a.business_id = j.business_id
  and a.id = j.appointment_id;

alter table public.appointments
  alter column group_id set not null,
  alter column line_ordinal set not null,
  alter column price_type_snapshot set not null,
  alter column price_min_minor_snapshot set not null,
  alter column price_max_minor_snapshot set not null,
  alter column price_policy_version_snapshot set not null;

alter table public.appointment_events
  alter column appointment_id drop not null,
  alter column group_id set not null,
  alter column group_version set not null;

-- The legacy schema uses appointment_id as this table's primary key. PostgreSQL
-- cannot relax that column while it still participates in the primary key, so
-- move the arbiter first; the historical constraint name is restored below on
-- group_id for old ON CONFLICT ... ON CONSTRAINT callers.
alter table public.appointment_management_capabilities
  drop constraint if exists appointment_management_capabilities_pkey;

alter table public.appointment_management_capabilities
  alter column appointment_id drop not null,
  alter column group_id set not null;

alter table public.appointment_notification_jobs
  alter column appointment_id drop not null,
  alter column group_id set not null;

alter table public.appointments
  drop constraint if exists appointments_line_ordinal_check,
  add constraint appointments_line_ordinal_check
    check (line_ordinal between 1 and 10),
  drop constraint if exists appointments_price_type_snapshot_check,
  add constraint appointments_price_type_snapshot_check
    check (price_type_snapshot in ('fixed','range')),
  drop constraint if exists appointments_price_range_snapshot_check,
  add constraint appointments_price_range_snapshot_check
    check (
      price_min_minor_snapshot between 0 and 100000000
      and price_max_minor_snapshot between 0 and 100000000
      and price_min_minor_snapshot <= price_max_minor_snapshot
      and (price_type_snapshot <> 'fixed' or price_min_minor_snapshot = price_max_minor_snapshot)
      and price_minor_snapshot = price_min_minor_snapshot
    ),
  drop constraint if exists appointments_price_policy_version_snapshot_check,
  add constraint appointments_price_policy_version_snapshot_check
    check (price_policy_version_snapshot > 0),
  drop constraint if exists appointments_group_contract_fk,
  add constraint appointments_group_contract_fk
    foreign key (business_id, group_id, customer_id, status, source)
    references public.appointment_groups(business_id, id, customer_id, status, source)
    deferrable initially deferred,
  drop constraint if exists appointments_group_line_ordinal_key,
  add constraint appointments_group_line_ordinal_key
    unique (business_id, group_id, line_ordinal)
    deferrable initially immediate;

-- Existing staff occupancy stays the final database guard, but making it
-- deferrable lets a future atomic group reschedule validate only the final state.
-- Legacy RPCs keep immediate statement-time behavior by default.
alter table public.appointments
  drop constraint if exists appointments_staff_no_overlap;
alter table public.appointments
  add constraint appointments_staff_no_overlap
  exclude using gist (
    business_id with =,
    staff_id with =,
    tstzrange(occupied_starts_at, occupied_ends_at, '[)') with &&
  ) where (status <> 'cancelled')
  deferrable initially immediate;

-- Services in one reservation are sequential for the initial F11 scope. Buffers
-- protect staff occupancy separately; customer service intervals themselves may
-- touch at [start,end) boundaries but may not overlap.
alter table public.appointments
  drop constraint if exists appointments_group_service_no_overlap;
alter table public.appointments
  add constraint appointments_group_service_no_overlap
  exclude using gist (
    business_id with =,
    group_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
  deferrable initially immediate;

create index if not exists appointments_business_group_ordinal_idx
  on public.appointments(business_id, group_id, line_ordinal);
create index if not exists appointment_events_business_group_idx
  on public.appointment_events(business_id, group_id, group_version, created_at, id);
create index if not exists booking_commands_business_group_idx
  on public.booking_commands(business_id, group_id, created_at);
create index if not exists public_booking_recoveries_business_group_idx
  on public.public_booking_recoveries(business_id, group_id);
create index if not exists appointment_notification_jobs_business_group_idx
  on public.appointment_notification_jobs(business_id, group_id, event_version);

alter table public.appointment_events
  drop constraint if exists appointment_events_group_version_check,
  add constraint appointment_events_group_version_check check (group_version > 0),
  drop constraint if exists appointment_events_group_fk,
  add constraint appointment_events_group_fk
    foreign key (business_id, group_id)
    references public.appointment_groups(business_id, id)
    deferrable initially deferred;

alter table public.booking_commands
  drop constraint if exists booking_commands_group_fk,
  add constraint booking_commands_group_fk
    foreign key (business_id, group_id)
    references public.appointment_groups(business_id, id)
    deferrable initially deferred;

alter table public.public_booking_recoveries
  drop constraint if exists public_booking_recoveries_group_fk,
  add constraint public_booking_recoveries_group_fk
    foreign key (business_id, group_id)
    references public.appointment_groups(business_id, id)
    deferrable initially deferred,
  drop constraint if exists public_booking_recoveries_business_group_key,
  add constraint public_booking_recoveries_business_group_key
    unique (business_id, group_id);

alter table public.appointment_notification_jobs
  drop constraint if exists appointment_notification_jobs_group_version_check,
  add constraint appointment_notification_jobs_group_version_check
    check (group_version is null or group_version > 0),
  drop constraint if exists appointment_notification_jobs_group_fk,
  add constraint appointment_notification_jobs_group_fk
    foreign key (business_id, group_id)
    references public.appointment_groups(business_id, id)
    deferrable initially deferred;

-- Legacy appointment inserts still omit group/line/F12 range snapshot columns.
-- The trigger creates a one-line group and fills fixed snapshot metadata. Future
-- group-aware inserts may supply the canonical F12 snapshot explicitly, including
-- range estimates, without weakening the old range->legacy fail-closed rule.
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
     or v_group.status <> new.status
     or v_group.source <> new.source then
    raise exception 'BOOKING_GROUP_CONTRACT_MISMATCH';
  end if;

  if v_group.legacy_appointment_id is not null
     and (v_group.legacy_appointment_id <> new.id or new.line_ordinal <> 1) then
    raise exception 'BOOKING_GROUP_LEGACY_ANCHOR_CONFLICT';
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
       or new.price_minor_snapshot <> new.price_min_minor_snapshot then
      raise exception 'SERVICE_PRICE_SNAPSHOT_MISMATCH';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.f11_prepare_appointment_line() from public, anon, authenticated;

drop trigger if exists appointments_f12_fixed_price_guard on public.appointments;
drop trigger if exists appointments_f11_line_contract on public.appointments;
create trigger appointments_f11_line_contract
before insert or update on public.appointments
for each row execute function public.f11_prepare_appointment_line();

-- Snapshot identity is immutable after creation. Existing reschedule/status RPCs
-- only move staff/time/lifecycle fields and therefore remain compatible.
create or replace function public.f11_enforce_appointment_line_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.business_id is distinct from new.business_id
     or old.group_id is distinct from new.group_id
     or old.line_ordinal is distinct from new.line_ordinal
     or old.customer_id is distinct from new.customer_id
     or old.service_id is distinct from new.service_id
     or old.source is distinct from new.source
     or old.customer_name_snapshot is distinct from new.customer_name_snapshot
     or old.customer_phone_snapshot is distinct from new.customer_phone_snapshot
     or old.customer_email_snapshot is distinct from new.customer_email_snapshot
     or old.service_name_snapshot is distinct from new.service_name_snapshot
     or old.duration_minutes_snapshot is distinct from new.duration_minutes_snapshot
     or old.buffer_before_minutes_snapshot is distinct from new.buffer_before_minutes_snapshot
     or old.buffer_after_minutes_snapshot is distinct from new.buffer_after_minutes_snapshot
     or old.price_minor_snapshot is distinct from new.price_minor_snapshot
     or old.price_type_snapshot is distinct from new.price_type_snapshot
     or old.price_min_minor_snapshot is distinct from new.price_min_minor_snapshot
     or old.price_max_minor_snapshot is distinct from new.price_max_minor_snapshot
     or old.price_policy_version_snapshot is distinct from new.price_policy_version_snapshot
     or old.currency_snapshot is distinct from new.currency_snapshot
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'APPOINTMENT_LINE_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end
$$;

revoke all on function public.f11_enforce_appointment_line_immutability() from public, anon, authenticated;

drop trigger if exists appointments_f11_line_immutability on public.appointments;
create trigger appointments_f11_line_immutability
before update on public.appointments
for each row execute function public.f11_enforce_appointment_line_immutability();

-- Old single-line RPCs mutate the appointment row directly. Keep their group
-- header synchronized and advance the optimistic group version exactly once per
-- material lifecycle/reschedule mutation.
create or replace function public.f11_sync_legacy_group_from_line()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.appointment_groups g
  set status = new.status,
      version = g.version + 1,
      updated_at = new.updated_at
  where g.business_id = new.business_id
    and g.id = new.group_id
    and g.legacy_appointment_id = new.id;
  return new;
end
$$;

revoke all on function public.f11_sync_legacy_group_from_line() from public, anon, authenticated;

drop trigger if exists appointments_f11_group_sync on public.appointments;
create trigger appointments_f11_group_sync
after update of
  status, staff_id, staff_name_snapshot,
  starts_at, ends_at, occupied_starts_at, occupied_ends_at, timezone,
  cancelled_at, cancelled_by, cancellation_reason
on public.appointments
for each row
when (
  old.status is distinct from new.status
  or old.staff_id is distinct from new.staff_id
  or old.staff_name_snapshot is distinct from new.staff_name_snapshot
  or old.starts_at is distinct from new.starts_at
  or old.ends_at is distinct from new.ends_at
  or old.occupied_starts_at is distinct from new.occupied_starts_at
  or old.occupied_ends_at is distinct from new.occupied_ends_at
  or old.timezone is distinct from new.timezone
  or old.cancelled_at is distinct from new.cancelled_at
  or old.cancelled_by is distinct from new.cancelled_by
  or old.cancellation_reason is distinct from new.cancellation_reason
)
execute function public.f11_sync_legacy_group_from_line();

-- Old appointment-bound events remain queryable by appointment_id. New group
-- events may leave appointment_id null; group_id + group_version are authoritative.
create or replace function public.f11_prepare_appointment_event()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_version integer;
begin
  if new.appointment_id is not null then
    select a.group_id into v_group_id
    from public.appointments a
    where a.business_id = new.business_id
      and a.id = new.appointment_id;
    if v_group_id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
    if new.group_id is not null and new.group_id <> v_group_id then
      raise exception 'BOOKING_GROUP_CONTRACT_MISMATCH';
    end if;
    new.group_id := v_group_id;
  end if;

  if new.group_id is null then raise exception 'BOOKING_GROUP_REQUIRED'; end if;

  select g.version into v_group_version
  from public.appointment_groups g
  where g.business_id = new.business_id
    and g.id = new.group_id;
  if v_group_version is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  if new.group_version is not null and new.group_version <> v_group_version then
    raise exception 'BOOKING_GROUP_VERSION_MISMATCH';
  end if;
  new.group_version := v_group_version;
  return new;
end
$$;

revoke all on function public.f11_prepare_appointment_event() from public, anon, authenticated;

drop trigger if exists appointment_events_f11_group_bridge on public.appointment_events;
create trigger appointment_events_f11_group_bridge
before insert or update of appointment_id, group_id, group_version, business_id
on public.appointment_events
for each row execute function public.f11_prepare_appointment_event();

create or replace function public.f11_booking_command_group_bridge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if new.appointment_id is not null then
    select a.group_id into v_group_id
    from public.appointments a
    where a.business_id = new.business_id
      and a.id = new.appointment_id;
    if v_group_id is null then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
    if new.group_id is not null and new.group_id <> v_group_id then
      raise exception 'BOOKING_GROUP_CONTRACT_MISMATCH';
    end if;
    new.group_id := v_group_id;
  elsif new.group_id is not null and not exists (
    select 1 from public.appointment_groups g
    where g.business_id = new.business_id and g.id = new.group_id
  ) then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;
  return new;
end
$$;

revoke all on function public.f11_booking_command_group_bridge() from public, anon, authenticated;

drop trigger if exists booking_commands_f11_group_bridge on public.booking_commands;
create trigger booking_commands_f11_group_bridge
before insert or update of appointment_id, group_id, business_id
on public.booking_commands
for each row execute function public.f11_booking_command_group_bridge();

-- Keep the historical constraint name because current recovery SQL names it in
-- ON CONFLICT. The arbiter is now group_id; a BEFORE INSERT bridge translates
-- old appointment-bound inserts before conflict detection.
create or replace function public.f11_capability_group_bridge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if new.appointment_id is not null then
    select a.group_id into v_group_id
    from public.appointments a
    where a.business_id = new.business_id
      and a.id = new.appointment_id;
    if v_group_id is null then raise exception 'INVALID_MANAGEMENT_BOOTSTRAP'; end if;
    if new.group_id is not null and new.group_id <> v_group_id then
      raise exception 'MANAGEMENT_GROUP_MISMATCH';
    end if;
    new.group_id := v_group_id;
  end if;

  if new.group_id is null or not exists (
    select 1 from public.appointment_groups g
    where g.business_id = new.business_id and g.id = new.group_id
  ) then
    raise exception 'INVALID_MANAGEMENT_BOOTSTRAP';
  end if;
  return new;
end
$$;

revoke all on function public.f11_capability_group_bridge() from public, anon, authenticated;

drop trigger if exists appointment_management_capabilities_f11_group_bridge
  on public.appointment_management_capabilities;
create trigger appointment_management_capabilities_f11_group_bridge
before insert or update of appointment_id, group_id, business_id
on public.appointment_management_capabilities
for each row execute function public.f11_capability_group_bridge();

alter table public.appointment_management_capabilities
  drop constraint if exists appointment_management_capabilities_group_fk,
  add constraint appointment_management_capabilities_group_fk
    foreign key (business_id, group_id)
    references public.appointment_groups(business_id, id)
    on delete cascade,
  drop constraint if exists appointment_management_capabilities_legacy_appointment_key;

alter table public.appointment_management_capabilities
  drop constraint if exists appointment_management_capabilities_pkey;
alter table public.appointment_management_capabilities
  add constraint appointment_management_capabilities_pkey primary key (group_id);
alter table public.appointment_management_capabilities
  add constraint appointment_management_capabilities_legacy_appointment_key
    unique (appointment_id);

create or replace function public.f11_recovery_group_bridge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if new.appointment_id is not null then
    select a.group_id into v_group_id
    from public.appointments a
    where a.business_id = new.business_id
      and a.id = new.appointment_id;
    if v_group_id is null then raise exception 'IDEMPOTENCY_RESULT_MISSING'; end if;
    if new.group_id is not null and new.group_id <> v_group_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    new.group_id := v_group_id;
  elsif new.group_id is not null and not exists (
    select 1 from public.appointment_groups g
    where g.business_id = new.business_id and g.id = new.group_id
  ) then
    raise exception 'BOOKING_GROUP_NOT_FOUND';
  end if;
  return new;
end
$$;

revoke all on function public.f11_recovery_group_bridge() from public, anon, authenticated;

drop trigger if exists public_booking_recoveries_f11_group_bridge
  on public.public_booking_recoveries;
create trigger public_booking_recoveries_f11_group_bridge
before insert or update of appointment_id, group_id, business_id
on public.public_booking_recoveries
for each row execute function public.f11_recovery_group_bridge();

create or replace function public.f11_notification_group_bridge()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_version integer;
begin
  if new.appointment_id is not null then
    select a.group_id into v_group_id
    from public.appointments a
    where a.business_id = new.business_id
      and a.id = new.appointment_id;
    if v_group_id is null then raise exception 'NOTIFICATION_APPOINTMENT_NOT_FOUND'; end if;
    if new.group_id is not null and new.group_id <> v_group_id then
      raise exception 'BOOKING_GROUP_CONTRACT_MISMATCH';
    end if;
    new.group_id := v_group_id;
  end if;

  if new.group_id is null then raise exception 'BOOKING_GROUP_REQUIRED'; end if;

  select g.version into v_group_version
  from public.appointment_groups g
  where g.business_id = new.business_id
    and g.id = new.group_id;
  if v_group_version is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  if new.group_version is null then new.group_version := v_group_version; end if;
  return new;
end
$$;

revoke all on function public.f11_notification_group_bridge() from public, anon, authenticated;

drop trigger if exists appointment_notification_jobs_f11_group_bridge
  on public.appointment_notification_jobs;
create trigger appointment_notification_jobs_f11_group_bridge
before insert or update of appointment_id, group_id, group_version, business_id
on public.appointment_notification_jobs
for each row execute function public.f11_notification_group_bridge();

-- Bounded authenticated projection for the new response contract. Public and
-- capability-bearing group management remain F11-02/F11-03 work; this RPC only
-- proves the operator membership/tenant boundary and ordered line shape.
create or replace function public.get_booking_group_contract(
  p_business_id uuid,
  p_group_id uuid
)
returns table(
  group_id uuid,
  business_id uuid,
  customer_id uuid,
  status text,
  source text,
  version integer,
  legacy_appointment_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_group public.appointment_groups;
  v_lines jsonb;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into v_group
  from public.appointment_groups g
  where g.business_id = p_business_id
    and g.id = p_group_id;
  if v_group.id is null then raise exception 'BOOKING_GROUP_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lineId', a.id,
    'ordinal', a.line_ordinal,
    'serviceId', a.service_id,
    'staffId', a.staff_id,
    'status', a.status,
    'startsAt', a.starts_at,
    'endsAt', a.ends_at,
    'occupiedStartsAt', a.occupied_starts_at,
    'occupiedEndsAt', a.occupied_ends_at,
    'timezone', a.timezone,
    'customerName', a.customer_name_snapshot,
    'customerPhone', a.customer_phone_snapshot,
    'customerEmail', a.customer_email_snapshot,
    'serviceName', a.service_name_snapshot,
    'staffName', a.staff_name_snapshot,
    'durationMinutes', a.duration_minutes_snapshot,
    'bufferBeforeMinutes', a.buffer_before_minutes_snapshot,
    'bufferAfterMinutes', a.buffer_after_minutes_snapshot,
    'priceType', a.price_type_snapshot,
    'priceMinMinor', a.price_min_minor_snapshot,
    'priceMaxMinor', a.price_max_minor_snapshot,
    'currency', a.currency_snapshot,
    'pricePolicyVersion', a.price_policy_version_snapshot,
    'legacyPriceMinor', a.price_minor_snapshot,
    'notes', a.notes,
    'cancellationReason', a.cancellation_reason
  ) order by a.line_ordinal), '[]'::jsonb)
  into v_lines
  from public.appointments a
  where a.business_id = p_business_id
    and a.group_id = p_group_id;

  return query select
    v_group.id,
    v_group.business_id,
    v_group.customer_id,
    v_group.status,
    v_group.source,
    v_group.version,
    v_group.legacy_appointment_id,
    v_group.created_at,
    v_group.updated_at,
    v_lines;
end
$$;

revoke all on function public.get_booking_group_contract(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_booking_group_contract(uuid,uuid)
  to authenticated;

commit;
