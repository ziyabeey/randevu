begin;

-- F12-03 extends the accepted F10-04 catalog without replacing legacy fixed-price
-- columns or rewriting appointment snapshots. price_minor remains a compatibility
-- mirror of the canonical lower bound; range prices are never allowed to become a
-- legacy appointment's definitive snapshot.
alter table public.services
  add column if not exists category text,
  add column if not exists sort_order integer,
  add column if not exists price_type text,
  add column if not exists price_min_minor integer,
  add column if not exists price_max_minor integer,
  add column if not exists price_policy_version integer;

with ranked as (
  select id,
         ((row_number() over (partition by business_id order by created_at, id) - 1) * 10)::integer as ordinal
  from public.services
)
update public.services s
set category = coalesce(nullif(trim(s.category), ''), 'Genel'),
    sort_order = coalesce(s.sort_order, r.ordinal),
    price_type = coalesce(nullif(lower(trim(s.price_type)), ''), 'fixed'),
    price_min_minor = coalesce(s.price_min_minor, s.price_minor),
    price_max_minor = coalesce(s.price_max_minor, s.price_minor),
    price_policy_version = coalesce(s.price_policy_version, 1)
from ranked r
where r.id = s.id;

alter table public.services
  alter column category set default 'Genel',
  alter column category set not null,
  alter column sort_order set default 0,
  alter column sort_order set not null,
  alter column price_type set default 'fixed',
  alter column price_type set not null,
  alter column price_min_minor set not null,
  alter column price_max_minor set not null,
  alter column price_policy_version set default 1,
  alter column price_policy_version set not null;

alter table public.services drop constraint if exists services_category_valid;
alter table public.services add constraint services_category_valid
  check (char_length(trim(category)) between 1 and 80);
alter table public.services drop constraint if exists services_sort_order_valid;
alter table public.services add constraint services_sort_order_valid
  check (sort_order between 0 and 1000000);
alter table public.services drop constraint if exists services_price_type_valid;
alter table public.services add constraint services_price_type_valid
  check (price_type in ('fixed','range'));
alter table public.services drop constraint if exists services_price_bounds_valid;
alter table public.services add constraint services_price_bounds_valid
  check (
    price_min_minor between 0 and 100000000
    and price_max_minor between 0 and 100000000
    and price_min_minor <= price_max_minor
    and (price_type <> 'fixed' or price_min_minor = price_max_minor)
    and price_minor = price_min_minor
  );
alter table public.services drop constraint if exists services_price_policy_version_valid;
alter table public.services add constraint services_price_policy_version_valid
  check (price_policy_version >= 1);

create index if not exists services_catalog_order_idx
  on public.services(business_id, category, sort_order, name, id);

-- The trigger is the database invariant for both the new guarded paths and any
-- privileged/legacy fixture that still writes price_minor directly. It also owns
-- price-policy version bumps, so callers cannot silently forge a historical version.
create or replace function public.f12_sync_service_price_contract()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_price_changed boolean := false;
begin
  new.category := coalesce(nullif(trim(new.category), ''), 'Genel');
  new.price_type := lower(trim(coalesce(new.price_type, 'fixed')));
  new.currency := upper(trim(coalesce(new.currency, '')));

  if tg_op = 'INSERT' then
    if new.price_min_minor is null and new.price_max_minor is null then
      new.price_min_minor := new.price_minor;
      new.price_max_minor := new.price_minor;
    elsif new.price_min_minor is null or new.price_max_minor is null then
      raise exception 'INVALID_SERVICE_PRICE';
    end if;
    new.price_minor := new.price_min_minor;
    new.price_policy_version := 1;
  else
    -- Backward-compatible legacy mutation: a caller that only changes price_minor
    -- still means "fixed price" and atomically updates the canonical bounds.
    if new.price_minor is distinct from old.price_minor
       and new.price_type is not distinct from old.price_type
       and new.price_min_minor is not distinct from old.price_min_minor
       and new.price_max_minor is not distinct from old.price_max_minor then
      new.price_type := 'fixed';
      new.price_min_minor := new.price_minor;
      new.price_max_minor := new.price_minor;
    else
      new.price_minor := new.price_min_minor;
    end if;

    v_price_changed :=
      new.price_type is distinct from old.price_type
      or new.price_min_minor is distinct from old.price_min_minor
      or new.price_max_minor is distinct from old.price_max_minor
      or new.currency is distinct from old.currency;
    new.price_policy_version := old.price_policy_version + case when v_price_changed then 1 else 0 end;
  end if;

  if char_length(new.category) not between 1 and 80
     or new.sort_order is null or new.sort_order not between 0 and 1000000
     or new.price_type not in ('fixed','range')
     or new.price_min_minor is null or new.price_min_minor not between 0 and 100000000
     or new.price_max_minor is null or new.price_max_minor not between 0 and 100000000
     or new.price_min_minor > new.price_max_minor
     or (new.price_type = 'fixed' and new.price_min_minor <> new.price_max_minor)
     or new.currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_SERVICE_PRICE';
  end if;

  new.price_minor := new.price_min_minor;
  return new;
end
$$;

revoke all on function public.f12_sync_service_price_contract() from public, anon, authenticated;

drop trigger if exists services_f12_price_contract on public.services;
create trigger services_f12_price_contract
before insert or update on public.services
for each row execute function public.f12_sync_service_price_contract();

-- Preserve the F10-04 legacy direct-RPC contract. Old callers still create fixed
-- TRY services, now with canonical fixed bounds and deterministic append ordering.
create or replace function public.create_service_guarded(
  p_business_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_buffer_before_minutes integer,
  p_buffer_after_minutes integer,
  p_price_minor integer
)
returns public.services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.services;
  v_count integer;
  v_sort integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 120
     or p_duration_minutes not between 5 and 720
     or p_buffer_before_minutes not between 0 and 240
     or p_buffer_after_minutes not between 0 and 240
     or p_price_minor not between 0 and 100000000 then
    raise exception 'INVALID_SERVICE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));
  select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
    into v_count, v_sort
  from public.services s
  where s.business_id = p_business_id;
  if v_count >= 100 then raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED'; end if;

  insert into public.services(
    business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
    category, sort_order, price_minor, price_type, price_min_minor, price_max_minor,
    price_policy_version, currency
  ) values (
    p_business_id, trim(p_name), p_duration_minutes, p_buffer_before_minutes, p_buffer_after_minutes,
    'Genel', v_sort, p_price_minor, 'fixed', p_price_minor, p_price_minor, 1, 'TRY'
  ) returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.create_service_guarded(uuid,text,integer,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.create_service_guarded(uuid,text,integer,integer,integer,integer)
  to authenticated;

-- Canonical F12-03 create path. No currency conversion exists: the supplied
-- three-letter currency is a label/identity, and mixed-currency totals fail closed.
create or replace function public.create_service_priced_guarded(
  p_business_id uuid,
  p_name text,
  p_duration_minutes integer,
  p_buffer_before_minutes integer,
  p_buffer_after_minutes integer,
  p_category text,
  p_sort_order integer,
  p_price_type text,
  p_price_min_minor integer,
  p_price_max_minor integer,
  p_currency text
)
returns public.services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.services;
  v_count integer;
  v_sort integer;
  v_category text := coalesce(nullif(trim(p_category), ''), 'Genel');
  v_type text := lower(trim(coalesce(p_price_type, '')));
  v_currency text := upper(trim(coalesce(p_currency, '')));
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 2 and 120
     or p_duration_minutes not between 5 and 720
     or p_buffer_before_minutes not between 0 and 240
     or p_buffer_after_minutes not between 0 and 240
     or char_length(v_category) not between 1 and 80
     or (p_sort_order is not null and p_sort_order not between 0 and 1000000)
     or v_type not in ('fixed','range')
     or p_price_min_minor not between 0 and 100000000
     or p_price_max_minor not between 0 and 100000000
     or p_price_min_minor > p_price_max_minor
     or (v_type = 'fixed' and p_price_min_minor <> p_price_max_minor)
     or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_SERVICE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('f10-04:services:' || p_business_id::text, 0));
  select count(*), least(coalesce(max(s.sort_order), -10) + 10, 1000000)
    into v_count, v_sort
  from public.services s
  where s.business_id = p_business_id;
  if v_count >= 100 then raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED'; end if;
  if p_sort_order is not null then v_sort := p_sort_order; end if;

  insert into public.services(
    business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
    category, sort_order, price_minor, price_type, price_min_minor, price_max_minor,
    price_policy_version, currency
  ) values (
    p_business_id, trim(p_name), p_duration_minutes, p_buffer_before_minutes, p_buffer_after_minutes,
    v_category, v_sort, p_price_min_minor, v_type, p_price_min_minor, p_price_max_minor,
    1, v_currency
  ) returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.create_service_priced_guarded(uuid,text,integer,integer,integer,text,integer,text,integer,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_service_priced_guarded(uuid,text,integer,integer,integer,text,integer,text,integer,integer,text)
  to authenticated;

-- Existing update signature is retained to avoid a parallel mutation API. The
-- JSON patch gains category/order and canonical price fields while old priceMinor
-- remains a fixed-price compatibility input.
create or replace function public.update_service_guarded(
  p_business_id uuid,
  p_service_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb
)
returns public.services
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.services;
  v_name text;
  v_duration integer;
  v_before integer;
  v_after integer;
  v_category text;
  v_sort integer;
  v_type text;
  v_min integer;
  v_max integer;
  v_currency text;
  v_active boolean;
  v_legacy_price boolean := false;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) k
       where k not in (
         'name','durationMinutes','bufferBeforeMinutes','bufferAfterMinutes',
         'category','sortOrder','priceMinor','priceType','priceMinMinor','priceMaxMinor','currency','active'
       )
     )
     or ((p_patch ? 'priceMinor') and (
       p_patch ? 'priceType' or p_patch ? 'priceMinMinor' or p_patch ? 'priceMaxMinor' or p_patch ? 'currency'
     )) then
    raise exception 'INVALID_SERVICE';
  end if;

  select * into v_row
  from public.services s
  where s.business_id = p_business_id and s.id = p_service_id
  for update;
  if not found then raise exception 'SERVICE_NOT_FOUND'; end if;
  if p_expected_updated_at is null
     or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'STALE_WRITE';
  end if;

  begin
    v_name := case when p_patch ? 'name' then trim(p_patch->>'name') else v_row.name end;
    v_duration := case when p_patch ? 'durationMinutes' then (p_patch->>'durationMinutes')::integer else v_row.duration_minutes end;
    v_before := case when p_patch ? 'bufferBeforeMinutes' then (p_patch->>'bufferBeforeMinutes')::integer else v_row.buffer_before_minutes end;
    v_after := case when p_patch ? 'bufferAfterMinutes' then (p_patch->>'bufferAfterMinutes')::integer else v_row.buffer_after_minutes end;
    v_category := case when p_patch ? 'category' then trim(p_patch->>'category') else v_row.category end;
    v_sort := case when p_patch ? 'sortOrder' then (p_patch->>'sortOrder')::integer else v_row.sort_order end;
    v_active := case when p_patch ? 'active' then (p_patch->>'active')::boolean else v_row.active end;
    v_legacy_price := p_patch ? 'priceMinor';
    if v_legacy_price then
      v_type := 'fixed';
      v_min := (p_patch->>'priceMinor')::integer;
      v_max := v_min;
      v_currency := v_row.currency;
    else
      v_type := case when p_patch ? 'priceType' then lower(trim(p_patch->>'priceType')) else v_row.price_type end;
      v_min := case when p_patch ? 'priceMinMinor' then (p_patch->>'priceMinMinor')::integer else v_row.price_min_minor end;
      v_max := case when p_patch ? 'priceMaxMinor' then (p_patch->>'priceMaxMinor')::integer else v_row.price_max_minor end;
      v_currency := case when p_patch ? 'currency' then upper(trim(p_patch->>'currency')) else v_row.currency end;
    end if;
  exception when others then
    raise exception 'INVALID_SERVICE';
  end;

  if v_name is null or char_length(v_name) not between 2 and 120
     or v_duration not between 5 and 720
     or v_before not between 0 and 240
     or v_after not between 0 and 240
     or v_category is null or char_length(v_category) not between 1 and 80
     or v_sort is null or v_sort not between 0 and 1000000
     or v_type not in ('fixed','range')
     or v_min not between 0 and 100000000
     or v_max not between 0 and 100000000
     or v_min > v_max
     or (v_type = 'fixed' and v_min <> v_max)
     or v_currency !~ '^[A-Z]{3}$'
     or v_active is null then
    raise exception 'INVALID_SERVICE';
  end if;

  update public.services s
  set name = v_name,
      duration_minutes = v_duration,
      buffer_before_minutes = v_before,
      buffer_after_minutes = v_after,
      category = v_category,
      sort_order = v_sort,
      price_type = v_type,
      price_min_minor = v_min,
      price_max_minor = v_max,
      price_minor = v_min,
      currency = v_currency,
      active = v_active
  where s.business_id = p_business_id and s.id = p_service_id
  returning * into v_row;
  return v_row;
end
$$;

revoke all on function public.update_service_guarded(uuid,uuid,timestamp with time zone,jsonb)
  from public, anon, authenticated;
grant execute on function public.update_service_guarded(uuid,uuid,timestamp with time zone,jsonb)
  to authenticated;

-- Authenticated bounded catalog snapshot now carries the canonical F12 price
-- contract. It remains one snapshot and keeps the 100/100/5000 max+1 limits.
create or replace function public.get_catalog_snapshot(p_business_id uuid)
returns table(
  services jsonb,
  staff jsonb,
  assignments jsonb
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_user uuid := auth.uid();
  v_services jsonb := '[]'::jsonb;
  v_staff jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_service_count integer := 0;
  v_staff_count integer := 0;
  v_assignment_count integer := 0;
begin
  perform public.f10_require_standard_session();
  if v_user is null or not exists (
    select 1 from public.memberships m
    where m.business_id = p_business_id and m.user_id = v_user and m.active
  ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'name', q.name,
    'duration_minutes', q.duration_minutes,
    'buffer_before_minutes', q.buffer_before_minutes,
    'buffer_after_minutes', q.buffer_after_minutes,
    'category', q.category,
    'sort_order', q.sort_order,
    'price_minor', q.price_minor,
    'price_type', q.price_type,
    'price_min_minor', q.price_min_minor,
    'price_max_minor', q.price_max_minor,
    'price_policy_version', q.price_policy_version,
    'currency', q.currency,
    'active', q.active,
    'updated_at', q.updated_at
  ) order by lower(q.category), q.sort_order, lower(q.name), q.id), '[]'::jsonb)
  into v_service_count, v_services
  from (
    select sv.id, sv.name, sv.duration_minutes, sv.buffer_before_minutes,
      sv.buffer_after_minutes, sv.category, sv.sort_order, sv.price_minor,
      sv.price_type, sv.price_min_minor, sv.price_max_minor,
      sv.price_policy_version, sv.currency, sv.active, sv.updated_at
    from public.services sv
    where sv.business_id = p_business_id
    order by lower(sv.category), sv.sort_order, lower(sv.name), sv.id
    limit 101
  ) q;
  if v_service_count > 100 then raise exception 'CATALOG_SERVICES_LIMIT_EXCEEDED'; end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'membership_id', q.membership_id,
    'name', q.name,
    'phone', q.phone,
    'active', q.active,
    'updated_at', q.updated_at
  ) order by q.created_at, q.id), '[]'::jsonb)
  into v_staff_count, v_staff
  from (
    select sp.id, sp.membership_id, sp.name, sp.phone, sp.active, sp.created_at, sp.updated_at
    from public.staff_profiles sp
    where sp.business_id = p_business_id
    order by sp.created_at, sp.id
    limit 101
  ) q;
  if v_staff_count > 100 then raise exception 'CATALOG_STAFF_LIMIT_EXCEEDED'; end if;

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', q.staff_id,
    'service_id', q.service_id,
    'active', q.active,
    'updated_at', q.updated_at
  ) order by q.staff_id, q.service_id), '[]'::jsonb)
  into v_assignment_count, v_assignments
  from (
    select ss.staff_id, ss.service_id, ss.active, ss.updated_at
    from public.staff_services ss
    where ss.business_id = p_business_id
    order by ss.staff_id, ss.service_id
    limit 5001
  ) q;
  if v_assignment_count > 5000 then raise exception 'CATALOG_ASSIGNMENTS_LIMIT_EXCEEDED'; end if;

  return query select v_services, v_staff, v_assignments;
end
$$;

revoke all on function public.get_catalog_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_catalog_snapshot(uuid) to authenticated;

-- Future F11 group creation can consume this internal, ordered line estimate. It
-- is deliberately not granted to browser roles in F12-03, so public/customer UI
-- cannot claim multi-service range support before the booking capability exists.
create or replace function public.f12_price_estimate_internal(
  p_business_id uuid,
  p_service_ids uuid[]
)
returns table(
  currency text,
  lower_minor bigint,
  upper_minor bigint,
  lines jsonb
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_requested integer := coalesce(array_length(p_service_ids, 1), 0);
  v_found integer;
  v_currency_count integer;
  v_currency text;
  v_lower bigint;
  v_upper bigint;
  v_lines jsonb;
begin
  if p_business_id is null or v_requested < 1 or v_requested > 10 then
    raise exception 'INVALID_SERVICE_SELECTION';
  end if;

  with requested as (
    select u.service_id, u.ordinality::integer as ordinal
    from unnest(p_service_ids) with ordinality as u(service_id, ordinality)
  ), matched as (
    select r.ordinal, s.id, s.price_type, s.price_min_minor, s.price_max_minor,
           s.currency, s.price_policy_version
    from requested r
    join public.services s
      on s.business_id = p_business_id
     and s.id = r.service_id
     and s.active
  )
  select count(*), count(distinct m.currency), min(m.currency),
         coalesce(sum(m.price_min_minor)::bigint, 0),
         coalesce(sum(m.price_max_minor)::bigint, 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'ordinal', m.ordinal,
           'serviceId', m.id,
           'priceType', m.price_type,
           'lowerMinor', m.price_min_minor,
           'upperMinor', m.price_max_minor,
           'currency', m.currency,
           'pricePolicyVersion', m.price_policy_version
         ) order by m.ordinal), '[]'::jsonb)
  into v_found, v_currency_count, v_currency, v_lower, v_upper, v_lines
  from matched m;

  if v_found <> v_requested then raise exception 'SERVICE_NOT_FOUND'; end if;
  if v_currency_count <> 1 then raise exception 'CURRENCY_MISMATCH'; end if;

  return query select v_currency, v_lower, v_upper, v_lines;
end
$$;

revoke all on function public.f12_price_estimate_internal(uuid,uuid[]) from public, anon, authenticated;

-- Legacy public booking response still exposes one price_minor field. Until the
-- F11/F12-04 range-aware booking payload exists, range services are intentionally
-- absent here so a lower bound is never rendered as a definitive public price.
create or replace function public.get_public_booking_services(p_slug text)
returns table(
  service_id uuid,
  name text,
  duration_minutes integer,
  price_minor integer,
  currency text
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_rows integer;
begin
  return query
  select sv.id, sv.name, sv.duration_minutes, sv.price_minor, sv.currency
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  join public.services sv
    on sv.business_id = b.id and sv.active and sv.price_type = 'fixed'
  where lower(b.slug) = lower(trim(p_slug))
    and r.publishable
    and exists (
      select 1
      from public.staff_services ss
      join public.staff_profiles sp
        on sp.business_id = ss.business_id
       and sp.id = ss.staff_id
       and sp.active
      where ss.business_id = b.id
        and ss.service_id = sv.id
        and ss.active
    )
  order by lower(sv.category), sv.sort_order, lower(sv.name), sv.id
  limit 101;

  get diagnostics v_rows = row_count;
  if v_rows > 100 then raise exception 'PUBLIC_SERVICES_LIMIT_EXCEEDED'; end if;
end
$$;

revoke all on function public.get_public_booking_services(text) from public, anon, authenticated;

-- F11 will replace this guard when it can snapshot type/min/max/currency/policy.
-- For now every legacy appointment row still has one definitive price snapshot,
-- therefore inserting a range-priced service must fail before history is written.
create or replace function public.f12_require_fixed_price_legacy_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.services s
    where s.business_id = new.business_id
      and s.id = new.service_id
      and s.price_type <> 'fixed'
  ) then
    raise exception 'SERVICE_PRICE_NOT_FINAL';
  end if;
  return new;
end
$$;

revoke all on function public.f12_require_fixed_price_legacy_appointment() from public, anon, authenticated;

drop trigger if exists appointments_f12_fixed_price_guard on public.appointments;
create trigger appointments_f12_fixed_price_guard
before insert on public.appointments
for each row execute function public.f12_require_fixed_price_legacy_appointment();

commit;
