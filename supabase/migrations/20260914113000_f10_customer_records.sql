begin;

-- F10-05 exposes a narrow authenticated CRM surface over the existing Phase 5
-- customers/appointments model. Appointment customer snapshots remain immutable
-- history; editing a master customer never rewrites an appointment snapshot.

create or replace function public.f10_normalize_customer_phone(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select nullif(regexp_replace(trim(p_value), '[^0-9]+', '', 'g'), '');
$$;

create or replace function public.f10_normalize_customer_email(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select nullif(lower(trim(p_value)), '');
$$;

revoke all on function public.f10_normalize_customer_phone(text)
  from public, anon, authenticated;
revoke all on function public.f10_normalize_customer_email(text)
  from public, anon, authenticated;

-- Stable keyset order uses immutable creation time + UUID. Contact lookup indexes
-- keep duplicate checks tenant-scoped without creating a destructive uniqueness
-- migration over historical data that may already contain legacy duplicates.
create index if not exists customers_business_created_page_idx
  on public.customers (business_id, created_at desc, id desc);
create index if not exists customers_business_email_normalized_idx
  on public.customers (business_id, public.f10_normalize_customer_email(email))
  where email is not null;
create index if not exists customers_business_phone_normalized_idx
  on public.customers (business_id, public.f10_normalize_customer_phone(phone))
  where phone is not null;
create index if not exists appointments_business_customer_start_page_idx
  on public.appointments (business_id, customer_id, starts_at desc, id desc);

create or replace function public.list_business_customers_page(
  p_business_id uuid,
  p_search text default null,
  p_limit integer default 26,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  customer_id uuid,
  name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
declare
  v_search text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_phone_search text := public.f10_normalize_customer_phone(coalesce(p_search, ''));
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE';
  end if;
  if v_search is not null and char_length(v_search) > 120 then
    raise exception 'INVALID_CUSTOMER_SEARCH';
  end if;

  return query
  select
    c.id,
    c.name,
    c.phone,
    c.email,
    c.notes,
    c.created_at,
    c.updated_at
  from public.customers c
  where c.business_id = p_business_id
    and (
      p_after_created_at is null
      or (c.created_at, c.id) < (p_after_created_at, p_after_id)
    )
    and (
      v_search is null
      or lower(c.name) like '%' || v_search || '%'
      or lower(coalesce(c.email, '')) like '%' || v_search || '%'
      or (
        v_phone_search is not null
        and public.f10_normalize_customer_phone(c.phone) like '%' || v_phone_search || '%'
      )
    )
  order by c.created_at desc, c.id desc
  limit p_limit;
end
$$;

create or replace function public.list_business_customer_appointments_page(
  p_business_id uuid,
  p_customer_id uuid,
  p_limit integer default 26,
  p_after_starts_at timestamptz default null,
  p_after_id uuid default null
)
returns table(
  appointment_id uuid,
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
  cancellation_reason text
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '5s'
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'INVALID_PAGE';
  end if;
  if (p_after_starts_at is null) <> (p_after_id is null) then
    raise exception 'INVALID_PAGE';
  end if;
  if not exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.id = p_customer_id
  ) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  return query
  select
    a.id,
    a.status::text,
    a.starts_at,
    a.ends_at,
    a.timezone,
    a.customer_name_snapshot,
    a.customer_phone_snapshot,
    a.customer_email_snapshot,
    a.service_name_snapshot,
    a.staff_name_snapshot,
    a.price_minor_snapshot,
    a.currency_snapshot,
    a.notes,
    a.cancellation_reason
  from public.appointments a
  where a.business_id = p_business_id
    and a.customer_id = p_customer_id
    and (
      p_after_starts_at is null
      or (a.starts_at, a.id) < (p_after_starts_at, p_after_id)
    )
  order by a.starts_at desc, a.id desc
  limit p_limit;
end
$$;

create or replace function public.create_business_customer(
  p_business_id uuid,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_notes text default null
)
returns table(
  customer_id uuid,
  name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := public.f10_normalize_customer_email(coalesce(p_email, ''));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_phone_normalized text := public.f10_normalize_customer_phone(coalesce(p_phone, ''));
  v_row public.customers;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  -- Customer management writes are low-frequency and business-scoped. A single
  -- tenant advisory lock makes same-contact concurrent creates deterministic.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  if exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and (
        (v_phone_normalized is not null
          and public.f10_normalize_customer_phone(c.phone) = v_phone_normalized)
        or
        (v_email is not null
          and public.f10_normalize_customer_email(c.email) = v_email)
      )
  ) then
    raise exception 'CUSTOMER_CONTACT_EXISTS';
  end if;

  insert into public.customers(business_id, name, phone, email, notes, created_by)
  values(p_business_id, v_name, v_phone, v_email, v_notes, auth.uid())
  returning * into v_row;

  return query select
    v_row.id, v_row.name, v_row.phone, v_row.email, v_row.notes,
    v_row.created_at, v_row.updated_at;
end
$$;

create or replace function public.update_business_customer(
  p_business_id uuid,
  p_customer_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_notes text default null
)
returns table(
  customer_id uuid,
  name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := public.f10_normalize_customer_email(coalesce(p_email, ''));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_phone_normalized text := public.f10_normalize_customer_phone(coalesce(p_phone, ''));
  v_current public.customers;
  v_row public.customers;
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_expected_updated_at is null then
    raise exception 'CUSTOMER_VERSION_REQUIRED';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_CUSTOMER_NAME';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'INVALID_CUSTOMER_PHONE';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'INVALID_CUSTOMER_EMAIL';
  end if;
  if v_notes is not null and char_length(v_notes) > 1000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select * into v_current
  from public.customers c
  where c.business_id = p_business_id
    and c.id = p_customer_id
  for update;

  if v_current.id is null then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;
  if v_current.updated_at <> p_expected_updated_at then
    raise exception 'CUSTOMER_VERSION_CONFLICT';
  end if;

  if exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.id <> p_customer_id
      and (
        (v_phone_normalized is not null
          and public.f10_normalize_customer_phone(c.phone) = v_phone_normalized)
        or
        (v_email is not null
          and public.f10_normalize_customer_email(c.email) = v_email)
      )
  ) then
    raise exception 'CUSTOMER_CONTACT_EXISTS';
  end if;

  update public.customers c
  set name = v_name,
      phone = v_phone,
      email = v_email,
      notes = v_notes
  where c.business_id = p_business_id
    and c.id = p_customer_id
  returning * into v_row;

  return query select
    v_row.id, v_row.name, v_row.phone, v_row.email, v_row.notes,
    v_row.created_at, v_row.updated_at;
end
$$;

-- S08 discipline: exposed-schema functions are closed first, then only the four
-- authenticated CRM RPCs are explicitly opened. Tables retain their existing RLS.
revoke all on function public.list_business_customers_page(uuid,text,integer,timestamptz,uuid)
  from public, anon, authenticated;
revoke all on function public.list_business_customer_appointments_page(uuid,uuid,integer,timestamptz,uuid)
  from public, anon, authenticated;
revoke all on function public.create_business_customer(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.update_business_customer(uuid,uuid,timestamptz,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.list_business_customers_page(uuid,text,integer,timestamptz,uuid)
  to authenticated;
grant execute on function public.list_business_customer_appointments_page(uuid,uuid,integer,timestamptz,uuid)
  to authenticated;
grant execute on function public.create_business_customer(uuid,text,text,text,text)
  to authenticated;
grant execute on function public.update_business_customer(uuid,uuid,timestamptz,text,text,text,text)
  to authenticated;

commit;
