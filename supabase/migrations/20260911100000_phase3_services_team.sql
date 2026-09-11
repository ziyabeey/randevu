begin;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  duration_minutes integer not null check (duration_minutes between 5 and 720),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  price_minor integer not null default 0 check (price_minor between 0 and 100000000),
  currency text not null default 'TRY' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);

create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  membership_id uuid,
  name text not null check (char_length(trim(name)) between 2 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, membership_id),
  constraint staff_membership_same_business
    foreign key (business_id, membership_id)
    references public.memberships(business_id, id)
    deferrable initially immediate
);

create table if not exists public.staff_services (
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, staff_id, service_id),
  foreign key (business_id, staff_id) references public.staff_profiles(business_id, id) on delete cascade,
  foreign key (business_id, service_id) references public.services(business_id, id) on delete cascade
);

create index if not exists services_business_active_idx on public.services(business_id, active);
create index if not exists staff_business_active_idx on public.staff_profiles(business_id, active);
create index if not exists staff_services_business_idx on public.staff_services(business_id, staff_id, active);

drop trigger if exists services_touch_updated_at on public.services;
create trigger services_touch_updated_at before update on public.services for each row execute function public.touch_updated_at();
drop trigger if exists staff_profiles_touch_updated_at on public.staff_profiles;
create trigger staff_profiles_touch_updated_at before update on public.staff_profiles for each row execute function public.touch_updated_at();
drop trigger if exists staff_services_touch_updated_at on public.staff_services;
create trigger staff_services_touch_updated_at before update on public.staff_services for each row execute function public.touch_updated_at();

alter table public.services enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_services enable row level security;
alter table public.services force row level security;
alter table public.staff_profiles force row level security;
alter table public.staff_services force row level security;

drop policy if exists services_select_member on public.services;
create policy services_select_member on public.services for select to authenticated using (public.is_active_member(business_id));
drop policy if exists services_insert_manager on public.services;
create policy services_insert_manager on public.services for insert to authenticated with check (public.can_manage_business(business_id));
drop policy if exists services_update_manager on public.services;
create policy services_update_manager on public.services for update to authenticated using (public.can_manage_business(business_id)) with check (public.can_manage_business(business_id));

drop policy if exists staff_select_member on public.staff_profiles;
create policy staff_select_member on public.staff_profiles for select to authenticated using (public.is_active_member(business_id));
drop policy if exists staff_insert_manager on public.staff_profiles;
create policy staff_insert_manager on public.staff_profiles for insert to authenticated with check (public.can_manage_business(business_id));
drop policy if exists staff_update_manager on public.staff_profiles;
create policy staff_update_manager on public.staff_profiles for update to authenticated using (public.can_manage_business(business_id)) with check (public.can_manage_business(business_id));

drop policy if exists staff_services_select_member on public.staff_services;
create policy staff_services_select_member on public.staff_services for select to authenticated using (public.is_active_member(business_id));
drop policy if exists staff_services_insert_manager on public.staff_services;
create policy staff_services_insert_manager on public.staff_services for insert to authenticated with check (public.can_manage_business(business_id));
drop policy if exists staff_services_update_manager on public.staff_services;
create policy staff_services_update_manager on public.staff_services for update to authenticated using (public.can_manage_business(business_id)) with check (public.can_manage_business(business_id));

grant select, insert, update on public.services, public.staff_profiles, public.staff_services to authenticated;
revoke all on public.services, public.staff_profiles, public.staff_services from anon;

commit;
