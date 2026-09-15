begin;

create table if not exists public.business_public_profiles (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  public_name text,
  short_description text,
  long_description text,
  public_phone text,
  public_email text,
  public_website text,
  public_whatsapp text,
  address_text text,
  show_work_hours boolean not null default true,
  cover_media_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public_name is null or char_length(public_name) between 2 and 120),
  check (short_description is null or char_length(short_description) <= 240),
  check (long_description is null or char_length(long_description) <= 2000),
  check (public_phone is null or char_length(public_phone) <= 40),
  check (public_email is null or char_length(public_email) <= 254),
  check (public_website is null or char_length(public_website) <= 500),
  check (public_whatsapp is null or char_length(public_whatsapp) <= 40),
  check (address_text is null or char_length(address_text) <= 500)
);

create table if not exists public.business_public_media (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','ready','deleting','cleanup')),
  alt_text text,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  mime_type text not null check (mime_type = 'image/webp'),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  width integer not null check (width between 1 and 2000),
  height integer not null check (height between 1 and 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (alt_text is null or char_length(alt_text) <= 160)
);

create index if not exists business_public_media_business_status_order_idx
  on public.business_public_media(business_id, status, sort_order, id);

alter table public.business_public_profiles enable row level security;
alter table public.business_public_profiles force row level security;
alter table public.business_public_media enable row level security;
alter table public.business_public_media force row level security;

revoke all on public.business_public_profiles from anon, authenticated;
revoke all on public.business_public_media from anon, authenticated;

drop trigger if exists business_public_profiles_touch_updated_at on public.business_public_profiles;
create trigger business_public_profiles_touch_updated_at
before update on public.business_public_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists business_public_media_touch_updated_at on public.business_public_media;
create trigger business_public_media_touch_updated_at
before update on public.business_public_media
for each row execute function public.touch_updated_at();

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('salon-public-media', 'salon-public-media', false, 5242880, array['image/webp']::text[])
    on conflict (id) do update
      set name = excluded.name,
          public = false,
          file_size_limit = 5242880,
          allowed_mime_types = array['image/webp']::text[];
  end if;
end
$$;

create or replace function public.business_public_profile_snapshot_internal(p_business_id uuid)
returns table(
  business_id uuid,
  public_name text,
  short_description text,
  long_description text,
  public_phone text,
  public_email text,
  public_website text,
  public_whatsapp text,
  address_text text,
  show_work_hours boolean,
  cover_media_id uuid,
  work_hours jsonb,
  media jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    coalesce(p.public_name, b.name),
    p.short_description,
    p.long_description,
    p.public_phone,
    p.public_email,
    p.public_website,
    p.public_whatsapp,
    p.address_text,
    coalesce(p.show_work_hours, true),
    case when cover.status = 'ready' then p.cover_media_id else null end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'weekday', bh.weekday,
        'starts_local', bh.starts_local,
        'ends_local', bh.ends_local
      ) order by bh.weekday, bh.starts_local, bh.id)
      from public.business_hours bh
      where bh.business_id = b.id and bh.active
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'alt_text', m.alt_text,
        'sort_order', m.sort_order,
        'width', m.width,
        'height', m.height
      ) order by m.sort_order, m.id)
      from public.business_public_media m
      where m.business_id = b.id and m.status = 'ready'
    ), '[]'::jsonb)
  from public.businesses b
  left join public.business_public_profiles p on p.business_id = b.id
  left join public.business_public_media cover
    on cover.business_id = b.id and cover.id = p.cover_media_id
  where b.id = p_business_id
  limit 1;
$$;

revoke all on function public.business_public_profile_snapshot_internal(uuid)
  from public, anon, authenticated;

create or replace function public.get_business_public_profile(p_business_id uuid)
returns table(
  business_id uuid,
  public_name text,
  short_description text,
  long_description text,
  public_phone text,
  public_email text,
  public_website text,
  public_whatsapp text,
  address_text text,
  show_work_hours boolean,
  cover_media_id uuid,
  work_hours jsonb,
  media jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query select * from public.business_public_profile_snapshot_internal(p_business_id);
end
$$;

revoke all on function public.get_business_public_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.get_business_public_profile(uuid) to authenticated;

create or replace function public.update_business_public_profile(
  p_business_id uuid,
  p_public_name text,
  p_short_description text,
  p_long_description text,
  p_public_phone text,
  p_public_email text,
  p_public_website text,
  p_public_whatsapp text,
  p_address_text text,
  p_show_work_hours boolean,
  p_cover_media_id uuid
)
returns table(
  business_id uuid,
  public_name text,
  short_description text,
  long_description text,
  public_phone text,
  public_email text,
  public_website text,
  public_whatsapp text,
  address_text text,
  show_work_hours boolean,
  cover_media_id uuid,
  work_hours jsonb,
  media jsonb
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_public_name text := nullif(trim(coalesce(p_public_name, '')), '');
  v_short text := nullif(trim(coalesce(p_short_description, '')), '');
  v_long text := nullif(trim(coalesce(p_long_description, '')), '');
  v_phone text := nullif(trim(coalesce(p_public_phone, '')), '');
  v_email text := nullif(trim(coalesce(p_public_email, '')), '');
  v_website text := nullif(trim(coalesce(p_public_website, '')), '');
  v_whatsapp text := nullif(trim(coalesce(p_public_whatsapp, '')), '');
  v_address text := nullif(trim(coalesce(p_address_text, '')), '');
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_public_name is not null and char_length(v_public_name) not between 2 and 120 then
    raise exception 'INVALID_PUBLIC_PROFILE';
  end if;
  if v_short is not null and char_length(v_short) > 240
     or v_long is not null and char_length(v_long) > 2000
     or v_phone is not null and char_length(v_phone) > 40
     or v_email is not null and (char_length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
     or v_website is not null and (char_length(v_website) > 500 or v_website !~* '^https://')
     or v_whatsapp is not null and char_length(v_whatsapp) > 40
     or v_address is not null and char_length(v_address) > 500 then
    raise exception 'INVALID_PUBLIC_PROFILE';
  end if;
  if p_cover_media_id is not null and not exists (
    select 1 from public.business_public_media m
    where m.business_id = p_business_id and m.id = p_cover_media_id and m.status = 'ready'
  ) then
    raise exception 'INVALID_PUBLIC_MEDIA';
  end if;

  insert into public.business_public_profiles(
    business_id, public_name, short_description, long_description,
    public_phone, public_email, public_website, public_whatsapp, address_text,
    show_work_hours, cover_media_id
  ) values (
    p_business_id, v_public_name, v_short, v_long,
    v_phone, v_email, v_website, v_whatsapp, v_address,
    coalesce(p_show_work_hours, true), p_cover_media_id
  )
  on conflict (business_id) do update
  set public_name = excluded.public_name,
      short_description = excluded.short_description,
      long_description = excluded.long_description,
      public_phone = excluded.public_phone,
      public_email = excluded.public_email,
      public_website = excluded.public_website,
      public_whatsapp = excluded.public_whatsapp,
      address_text = excluded.address_text,
      show_work_hours = excluded.show_work_hours,
      cover_media_id = excluded.cover_media_id;

  return query select * from public.business_public_profile_snapshot_internal(p_business_id);
end
$$;

revoke all on function public.update_business_public_profile(uuid,text,text,text,text,text,text,text,text,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.update_business_public_profile(uuid,text,text,text,text,text,text,text,text,boolean,uuid)
  to authenticated;

create or replace function public.begin_business_public_media_upload(
  p_business_id uuid,
  p_media_id uuid,
  p_storage_path text,
  p_alt_text text,
  p_mime_type text,
  p_size_bytes integer,
  p_width integer,
  p_height integer
)
returns table(
  id uuid,
  storage_path text,
  status text,
  alt_text text,
  sort_order integer,
  mime_type text,
  size_bytes integer,
  width integer,
  height integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_order integer;
  v_alt text := nullif(trim(coalesce(p_alt_text, '')), '');
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  if p_media_id is null
     or p_storage_path <> p_business_id::text || '/' || p_media_id::text || '.webp'
     or p_mime_type <> 'image/webp'
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000
     or v_alt is not null and char_length(v_alt) > 160 then
    raise exception 'INVALID_PUBLIC_MEDIA';
  end if;

  select count(*), coalesce(max(m.sort_order), -1) + 1
    into v_count, v_order
  from public.business_public_media m
  where m.business_id = p_business_id;

  if v_count >= 20 then raise exception 'PUBLIC_MEDIA_LIMIT_EXCEEDED'; end if;

  insert into public.business_public_media(
    id, business_id, storage_path, status, alt_text, sort_order,
    mime_type, size_bytes, width, height, created_by
  ) values (
    p_media_id, p_business_id, p_storage_path, 'pending', v_alt, v_order,
    p_mime_type, p_size_bytes, p_width, p_height, auth.uid()
  );

  return query
  select m.id, m.storage_path, m.status, m.alt_text, m.sort_order,
         m.mime_type, m.size_bytes, m.width, m.height
  from public.business_public_media m
  where m.id = p_media_id and m.business_id = p_business_id;
end
$$;

revoke all on function public.begin_business_public_media_upload(uuid,uuid,text,text,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.begin_business_public_media_upload(uuid,uuid,text,text,text,integer,integer,integer)
  to authenticated;

create or replace function public.finalize_business_public_media_upload(p_business_id uuid, p_media_id uuid)
returns public.business_public_media
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_row public.business_public_media;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.business_public_media m
  set status = 'ready'
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'PUBLIC_MEDIA_STATE_CONFLICT'; end if;
  return v_row;
end
$$;

create or replace function public.mark_business_public_media_cleanup(p_business_id uuid, p_media_id uuid)
returns public.business_public_media
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_row public.business_public_media;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.business_public_media m
  set status = 'cleanup'
  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('pending','deleting')
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.business_public_media m
    where m.business_id = p_business_id and m.id = p_media_id and m.status = 'cleanup';
  end if;
  return v_row;
end
$$;

create or replace function public.begin_business_public_media_delete(p_business_id uuid, p_media_id uuid)
returns table(storage_path text, was_cover boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_path text; v_cover boolean;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  select m.storage_path into v_path from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  for update;
  if v_path is null then raise exception 'PUBLIC_MEDIA_NOT_FOUND'; end if;
  select exists(select 1 from public.business_public_profiles p
    where p.business_id = p_business_id and p.cover_media_id = p_media_id) into v_cover;
  update public.business_public_media set status = 'deleting'
  where business_id = p_business_id and id = p_media_id;
  update public.business_public_profiles set cover_media_id = null
  where business_id = p_business_id and cover_media_id = p_media_id;
  return query select v_path, v_cover;
end
$$;

create or replace function public.restore_business_public_media_delete(
  p_business_id uuid, p_media_id uuid, p_restore_cover boolean
)
returns public.business_public_media
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_row public.business_public_media;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  update public.business_public_media m set status = 'ready'
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'deleting'
  returning * into v_row;
  if v_row.id is null then raise exception 'PUBLIC_MEDIA_STATE_CONFLICT'; end if;
  if coalesce(p_restore_cover, false) then
    insert into public.business_public_profiles(business_id, cover_media_id)
    values (p_business_id, p_media_id)
    on conflict (business_id) do update set cover_media_id = excluded.cover_media_id;
  end if;
  return v_row;
end
$$;

create or replace function public.finish_business_public_media_delete(p_business_id uuid, p_media_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_count integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  delete from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup');
  get diagnostics v_count = row_count;
  return v_count = 1;
end
$$;

create or replace function public.list_business_public_media_cleanup(p_business_id uuid)
returns table(id uuid, storage_path text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return query
  select m.id, m.storage_path
  from public.business_public_media m
  where m.business_id = p_business_id
    and m.status = 'cleanup'
  order by m.updated_at, m.id
  limit 20;
end
$$;

create or replace function public.get_business_public_media_object(p_business_id uuid, p_media_id uuid)
returns table(storage_path text, mime_type text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return query
  select m.storage_path, m.mime_type
  from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  limit 1;
end
$$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.finalize_business_public_media_upload(uuid,uuid)',
    'public.mark_business_public_media_cleanup(uuid,uuid)',
    'public.begin_business_public_media_delete(uuid,uuid)',
    'public.restore_business_public_media_delete(uuid,uuid,boolean)',
    'public.finish_business_public_media_delete(uuid,uuid)',
    'public.list_business_public_media_cleanup(uuid)',
    'public.get_business_public_media_object(uuid,uuid)'
  ] loop
    execute 'revoke all on function ' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function ' || sig || ' to authenticated';
  end loop;
end
$$;

create or replace function public.get_public_business_profile(p_slug text)
returns table(
  public_name text,
  short_description text,
  long_description text,
  public_phone text,
  public_email text,
  public_website text,
  public_whatsapp text,
  address_text text,
  show_work_hours boolean,
  cover_media_id uuid,
  work_hours jsonb,
  media jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.public_name, s.short_description, s.long_description, s.public_phone,
    s.public_email, s.public_website, s.public_whatsapp, s.address_text,
    s.show_work_hours, s.cover_media_id, s.work_hours, s.media
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_public_profile_snapshot_internal(b.id) s
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug) = lower(trim(p_slug))
    and r.publishable
  limit 1;
$$;

create or replace function public.get_public_media_object(p_media_id uuid)
returns table(storage_path text, mime_type text)
language sql
stable
security definer
set search_path = public
as $$
  select m.storage_path, m.mime_type
  from public.business_public_media m
  join public.public_booking_settings pbs on pbs.business_id = m.business_id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(m.business_id) r
  where m.id = p_media_id and m.status = 'ready' and r.publishable
  limit 1;
$$;

create or replace function public.public_media_object_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.business_public_media m
    join public.public_booking_settings pbs on pbs.business_id = m.business_id and pbs.enabled
    cross join lateral public.business_onboarding_readiness_internal(m.business_id) r
    where m.storage_path = p_name and m.status = 'ready' and r.publishable
  );
$$;

create or replace function public.business_public_media_member_read_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_business_id uuid;
begin
  perform public.f10_require_standard_session();
  select m.business_id into v_business_id
  from public.business_public_media m
  where m.storage_path = p_name and m.status = 'ready';
  return v_business_id is not null and public.is_active_member(v_business_id);
exception when others then return false;
end
$$;

create or replace function public.business_public_media_upload_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_business_id uuid;
begin
  perform public.f10_require_standard_session();
  select m.business_id into v_business_id
  from public.business_public_media m
  where m.storage_path = p_name and m.status = 'pending';
  return v_business_id is not null and public.can_manage_business(v_business_id);
exception when others then return false;
end
$$;

create or replace function public.business_public_media_delete_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_business_id uuid;
begin
  perform public.f10_require_standard_session();
  select m.business_id into v_business_id
  from public.business_public_media m
  where m.storage_path = p_name and m.status in ('deleting','cleanup');
  return v_business_id is not null and public.can_manage_business(v_business_id);
exception when others then return false;
end
$$;

revoke all on function public.get_public_business_profile(text) from public, anon, authenticated;
revoke all on function public.get_public_media_object(uuid) from public, anon, authenticated;
revoke all on function public.public_media_object_visible(text) from public, anon, authenticated;
revoke all on function public.business_public_media_member_read_allowed(text) from public, anon, authenticated;
revoke all on function public.business_public_media_upload_allowed(text) from public, anon, authenticated;
revoke all on function public.business_public_media_delete_allowed(text) from public, anon, authenticated;
grant execute on function public.public_media_object_visible(text) to anon, authenticated;
grant execute on function public.business_public_media_member_read_allowed(text) to authenticated;
grant execute on function public.business_public_media_upload_allowed(text) to authenticated;
grant execute on function public.business_public_media_delete_allowed(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists f12_public_media_public_read on storage.objects';
    execute 'drop policy if exists f12_public_media_member_read on storage.objects';
    execute 'drop policy if exists f12_public_media_upload on storage.objects';
    execute 'drop policy if exists f12_public_media_delete on storage.objects';
    execute $policy$
      create policy f12_public_media_public_read on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'salon-public-media' and public.public_media_object_visible(name))
    $policy$;
    execute $policy$
      create policy f12_public_media_member_read on storage.objects
      for select to authenticated
      using (bucket_id = 'salon-public-media' and public.business_public_media_member_read_allowed(name))
    $policy$;
    execute $policy$
      create policy f12_public_media_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'salon-public-media' and public.business_public_media_upload_allowed(name))
    $policy$;
    execute $policy$
      create policy f12_public_media_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'salon-public-media' and public.business_public_media_delete_allowed(name))
    $policy$;
  end if;
end
$$;

create or replace function public.execute_public_operation(
  p_action text, p_args jsonb, p_gate_secret text, p_actor_hash text, p_network_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_class text;
  v_data jsonb;
  v_business_id uuid;
  v_recovery_id uuid;
  v_safe_retry boolean := false;
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_prior_claims text := current_setting('request.jwt.claims', true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    return public.public_operation_error('PUBLIC_BOOKING_GATE_UNAVAILABLE');
  end if;
  v_class := case p_action
    when 'business' then 'read' when 'services' then 'read' when 'staff' then 'read'
    when 'profile' then 'read' when 'media' then 'read'
    when 'slots' then 'slot' when 'book' then 'request'
    when 'recover' then 'recover' when 'resolve' then 'recover'
    when 'manage_view' then 'manage_read' when 'manage_slots' then 'manage_slot'
    when 'manage_reschedule' then 'manage_change' when 'manage_cancel' then 'manage_cancel'
    else null end;
  if v_class is null then return public.public_operation_error('INVALID_PUBLIC_OPERATION'); end if;
  begin
    perform public.enforce_public_booking_rate(v_class, p_actor_hash, p_network_hash);
  exception when others then return public.public_operation_error(sqlerrm);
  end;
  begin
    perform public.prune_public_booking_rate_counters();
  exception when others then null;
  end;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text) > 16384 then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  if p_action = 'book' then
    begin
      v_recovery_id := (p_args->>'p_recovery_id')::uuid;
      if v_recovery_id is null then raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_recovery_id::text, 0));
      select b.id into v_business_id from public.businesses b
        where b.slug = lower(trim(p_args->>'p_slug')) limit 1;
      if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
      select exists(select 1 from public.public_booking_recoveries r
        where r.business_id = v_business_id and r.recovery_id = v_recovery_id
          and r.idempotency_key = p_args->>'p_idempotency_key'
          and r.management_token_hash = p_args->>'p_management_token_hash'
          and r.recovery_secret_hash = p_args->>'p_recovery_secret_hash'
          and r.appointment_id is not null) into v_safe_retry;
    exception when invalid_text_representation then
      return public.public_operation_error('INVALID_BOOKING_RECOVERY_BOOTSTRAP');
    when others then return public.public_operation_error(sqlerrm);
    end;
    if not v_safe_retry then
      begin
        perform public.enforce_public_booking_rate('create', p_actor_hash, p_network_hash, v_business_id);
      exception when others then return public.public_operation_error(sqlerrm);
      end;
    end if;
  end if;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    case p_action
    when 'business' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_booking_business((p_args->>'p_slug')::text) r;
    when 'services' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_booking_services((p_args->>'p_slug')::text) r;
    when 'staff' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_booking_staff((p_args->>'p_slug')::text, (p_args->>'p_service_id')::uuid) r;
    when 'profile' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_business_profile((p_args->>'p_slug')::text) r;
    when 'media' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_media_object((p_args->>'p_media_id')::uuid) r;
    when 'slots' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.compute_public_booking_slots((p_args->>'p_slug')::text, (p_args->>'p_service_id')::uuid, (p_args->>'p_date')::date, (p_args->>'p_staff_id')::uuid) r;
    when 'book' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.create_public_appointment_with_recovery(
        (p_args->>'p_slug')::text,
        (p_args->>'p_idempotency_key')::text,
        (p_args->>'p_customer_name')::text,
        (p_args->>'p_service_id')::uuid,
        (p_args->>'p_staff_id')::uuid,
        (p_args->>'p_starts_at')::timestamptz,
        (p_args->>'p_management_token_hash')::text,
        (p_args->>'p_recovery_id')::uuid,
        (p_args->>'p_recovery_secret_hash')::text,
        (p_args->>'p_management_token_ciphertext')::text,
        (p_args->>'p_management_token_iv')::text,
        (p_args->>'p_key_version')::smallint,
        (p_args->>'p_customer_phone')::text,
        (p_args->>'p_customer_email')::text,
        (p_args->>'p_notes')::text
      ) r;
    when 'recover' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.recover_public_appointment(
        (p_args->>'p_recovery_id')::uuid,
        (p_args->>'p_idempotency_key')::text,
        (p_args->>'p_recovery_secret_hash')::text
      ) r;
    when 'resolve' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.resolve_public_booking_intent_v2(
        (p_args->>'p_recovery_id')::text,
        (p_args->>'p_idempotency_key')::text,
        (p_args->>'p_recovery_secret_hash')::text
      ) r;
    when 'manage_view' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.get_public_managed_appointment((p_args->>'p_token')::text) r;
    when 'manage_slots' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.compute_public_management_slots((p_args->>'p_token')::text, (p_args->>'p_date')::date, (p_args->>'p_staff_id')::uuid) r;
    when 'manage_reschedule' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.reschedule_public_managed_appointment((p_args->>'p_token')::text, (p_args->>'p_idempotency_key')::text, (p_args->>'p_staff_id')::uuid, (p_args->>'p_starts_at')::timestamptz) r;
    when 'manage_cancel' then
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
      from public.cancel_public_managed_appointment((p_args->>'p_token')::text, (p_args->>'p_idempotency_key')::text, (p_args->>'p_reason')::text) r;
    end case;
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  exception when invalid_text_representation or datetime_field_overflow then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  when others then
    return public.public_operation_error(sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'data', v_data);
end
$$;

revoke all on function public.get_public_business_profile(text) from public, anon, authenticated;
revoke all on function public.get_public_media_object(uuid) from public, anon, authenticated;
revoke all on function public.execute_public_operation(text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;

commit;
