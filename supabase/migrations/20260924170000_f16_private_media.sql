begin;

-- F16-03: private appointment photos and the business service-photo archive.
-- Customer photos live in a separate non-public bucket. Every read goes through
-- an authenticated Worker request that is re-authorized against the active
-- membership, so there is no durable public URL and membership revocation takes
-- effect on the next request. Publishing into the F12 public salon gallery is an
-- explicit owner/manager action that requires recorded customer consent and
-- creates a new, independent public media row.

create table if not exists public.appointment_private_media (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_group_id uuid not null,
  customer_id uuid not null,
  service_id uuid,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending','ready','deleting','cleanup')),
  caption text check (caption is null or char_length(caption) between 1 and 240),
  mime_type text not null check (mime_type = 'image/webp'),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  width integer not null check (width between 1 and 2000),
  height integer not null check (height between 1 and 2000),
  uploaded_by_membership_id uuid not null,
  published_media_id uuid,
  published_by_membership_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_private_media_business_id_key unique (business_id, id),
  constraint appointment_private_media_group_fk
    foreign key (business_id, appointment_group_id)
    references public.appointment_groups(business_id, id) on delete cascade,
  constraint appointment_private_media_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  constraint appointment_private_media_service_fk
    foreign key (business_id, service_id)
    references public.services(business_id, id),
  constraint appointment_private_media_uploader_fk
    foreign key (business_id, uploaded_by_membership_id)
    references public.memberships(business_id, id),
  constraint appointment_private_media_publisher_fk
    foreign key (business_id, published_by_membership_id)
    references public.memberships(business_id, id),
  constraint appointment_private_media_path_shape
    check (storage_path = business_id::text || '/' || appointment_group_id::text || '/' || id::text || '.webp'),
  constraint appointment_private_media_publish_shape
    check (
      (published_media_id is null and published_by_membership_id is null and published_at is null)
      or (published_media_id is not null and published_by_membership_id is not null and published_at is not null)
    )
);

create index if not exists appointment_private_media_group_idx
  on public.appointment_private_media(business_id, appointment_group_id, created_at, id);
create index if not exists appointment_private_media_archive_idx
  on public.appointment_private_media(business_id, status, created_at desc, id desc);
create index if not exists appointment_private_media_service_archive_idx
  on public.appointment_private_media(business_id, service_id, status, created_at desc, id desc);

alter table public.appointment_private_media enable row level security;
alter table public.appointment_private_media force row level security;
revoke all on public.appointment_private_media from public, anon, authenticated;

drop trigger if exists appointment_private_media_touch_updated_at on public.appointment_private_media;
create trigger appointment_private_media_touch_updated_at
before update on public.appointment_private_media
for each row execute function public.touch_updated_at();

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('appointment-private-media', 'appointment-private-media', false, 5242880, array['image/webp']::text[])
    on conflict (id) do update
      set name = excluded.name,
          public = false,
          file_size_limit = 5242880,
          allowed_mime_types = array['image/webp']::text[];
  end if;
end
$$;

-- Internal helpers ---------------------------------------------------------

create or replace function public.f16_private_media_actor(p_business_id uuid)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
begin
  perform public.f10_require_standard_session();
  select * into v_actor
  from public.memberships m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
  if v_actor.id is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return v_actor;
end
$$;

create or replace function public.f16_private_media_can_remove(
  p_actor public.memberships,
  p_row public.appointment_private_media
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor.role in ('owner','manager') or p_row.uploaded_by_membership_id = p_actor.id;
$$;

create or replace function public.f16_private_media_is_published(p_business_id uuid, p_public_media_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_public_media_id is not null and exists(
    select 1 from public.business_public_media pm
    where pm.business_id = p_business_id and pm.id = p_public_media_id and pm.status = 'ready'
  );
$$;

revoke all on function public.f16_private_media_actor(uuid) from public, anon, authenticated;
revoke all on function public.f16_private_media_can_remove(public.memberships, public.appointment_private_media) from public, anon, authenticated;
revoke all on function public.f16_private_media_is_published(uuid, uuid) from public, anon, authenticated;

-- Upload lifecycle ----------------------------------------------------------

create or replace function public.begin_appointment_private_media_upload(
  p_business_id uuid,
  p_group_id uuid,
  p_media_id uuid,
  p_storage_path text,
  p_service_id uuid,
  p_caption text,
  p_mime_type text,
  p_size_bytes integer,
  p_width integer,
  p_height integer
)
returns table(
  id uuid,
  appointment_group_id uuid,
  service_id uuid,
  status text,
  caption text,
  size_bytes integer,
  width integer,
  height integer,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_customer_id uuid;
  v_count integer;
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  v_actor := public.f16_private_media_actor(p_business_id);

  if p_group_id is null or p_media_id is null
     or p_storage_path is distinct from p_business_id::text || '/' || p_group_id::text || '/' || p_media_id::text || '.webp'
     or p_mime_type is distinct from 'image/webp'
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880
     or p_width is null or p_width < 1 or p_width > 2000
     or p_height is null or p_height < 1 or p_height > 2000
     or (v_caption is not null and char_length(v_caption) > 240) then
    raise exception 'INVALID_PRIVATE_MEDIA';
  end if;

  -- One writer per appointment group keeps the K03 10-photo budget exact
  -- without taking the booking-group row lock used by scheduling commands.
  perform pg_advisory_xact_lock(hashtextextended('f16:private-media:' || p_group_id::text, 0));

  select g.customer_id into v_customer_id
  from public.appointment_groups g
  where g.business_id = p_business_id and g.id = p_group_id;
  if v_customer_id is null then
    raise exception 'PRIVATE_MEDIA_GROUP_NOT_FOUND';
  end if;

  if p_service_id is not null and not exists(
    select 1 from public.appointments a
    where a.business_id = p_business_id and a.group_id = p_group_id and a.service_id = p_service_id
  ) then
    raise exception 'INVALID_PRIVATE_MEDIA';
  end if;

  select count(*) into v_count
  from public.appointment_private_media m
  where m.business_id = p_business_id
    and m.appointment_group_id = p_group_id
    and m.status in ('pending','ready','deleting');
  if v_count >= 10 then
    raise exception 'PRIVATE_MEDIA_LIMIT_EXCEEDED';
  end if;

  insert into public.appointment_private_media(
    id, business_id, appointment_group_id, customer_id, service_id, storage_path, status,
    caption, mime_type, size_bytes, width, height, uploaded_by_membership_id
  ) values (
    p_media_id, p_business_id, p_group_id, v_customer_id, p_service_id, p_storage_path, 'pending',
    v_caption, p_mime_type, p_size_bytes, p_width, p_height, v_actor.id
  );

  return query
  select m.id, m.appointment_group_id, m.service_id, m.status, m.caption,
         m.size_bytes, m.width, m.height, m.created_at
  from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id;
end
$$;

create or replace function public.finalize_appointment_private_media_upload(p_business_id uuid, p_media_id uuid)
returns table(
  id uuid,
  appointment_group_id uuid,
  service_id uuid,
  status text,
  caption text,
  size_bytes integer,
  width integer,
  height integer,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_id uuid;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  update public.appointment_private_media m
  set status = 'ready'
  where m.business_id = p_business_id and m.id = p_media_id
    and m.status = 'pending' and m.uploaded_by_membership_id = v_actor.id
  returning m.id into v_id;
  if v_id is null then
    raise exception 'PRIVATE_MEDIA_STATE_CONFLICT';
  end if;
  return query
  select m.id, m.appointment_group_id, m.service_id, m.status, m.caption,
         m.size_bytes, m.width, m.height, m.created_at
  from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = v_id;
end
$$;

create or replace function public.mark_appointment_private_media_cleanup(p_business_id uuid, p_media_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_private_media;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  select * into v_row from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id
  for update;
  if v_row.id is null or not public.f16_private_media_can_remove(v_actor, v_row) then
    return false;
  end if;
  if v_row.status in ('pending','deleting') then
    update public.appointment_private_media set status = 'cleanup'
    where business_id = p_business_id and id = p_media_id;
    return true;
  end if;
  return v_row.status = 'cleanup';
end
$$;

create or replace function public.list_appointment_private_media_cleanup(p_business_id uuid)
returns table(id uuid, storage_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  return query
  select m.id, m.storage_path
  from public.appointment_private_media m
  where m.business_id = p_business_id
    and m.status = 'cleanup'
    and (v_actor.role in ('owner','manager') or m.uploaded_by_membership_id = v_actor.id)
  order by m.updated_at, m.id
  limit 20;
end
$$;

-- Reads ---------------------------------------------------------------------

create or replace function public.list_appointment_private_media(p_business_id uuid, p_group_id uuid)
returns table(
  id uuid,
  appointment_group_id uuid,
  service_id uuid,
  service_name text,
  caption text,
  width integer,
  height integer,
  size_bytes integer,
  created_at timestamptz,
  published boolean,
  can_delete boolean,
  can_publish boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  if not exists(select 1 from public.appointment_groups g where g.business_id = p_business_id and g.id = p_group_id) then
    raise exception 'PRIVATE_MEDIA_GROUP_NOT_FOUND';
  end if;
  return query
  select m.id, m.appointment_group_id, m.service_id, s.name, m.caption, m.width, m.height,
         m.size_bytes, m.created_at,
         public.f16_private_media_is_published(m.business_id, m.published_media_id),
         public.f16_private_media_can_remove(v_actor, m),
         v_actor.role in ('owner','manager')
  from public.appointment_private_media m
  left join public.services s on s.business_id = m.business_id and s.id = m.service_id
  where m.business_id = p_business_id and m.appointment_group_id = p_group_id and m.status = 'ready'
  order by m.created_at, m.id;
end
$$;

create or replace function public.list_business_private_media_archive(
  p_business_id uuid,
  p_service_id uuid default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 25
)
returns table(
  id uuid,
  appointment_group_id uuid,
  service_id uuid,
  service_name text,
  customer_name text,
  caption text,
  width integer,
  height integer,
  created_at timestamptz,
  published boolean,
  can_delete boolean,
  can_publish boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_limit integer := coalesce(p_limit, 25);
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  if v_limit < 1 or v_limit > 100
     or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_PRIVATE_MEDIA';
  end if;
  return query
  select m.id, m.appointment_group_id, m.service_id, s.name, c.name, m.caption, m.width, m.height,
         m.created_at,
         public.f16_private_media_is_published(m.business_id, m.published_media_id),
         public.f16_private_media_can_remove(v_actor, m),
         v_actor.role in ('owner','manager')
  from public.appointment_private_media m
  join public.customers c on c.business_id = m.business_id and c.id = m.customer_id
  left join public.services s on s.business_id = m.business_id and s.id = m.service_id
  where m.business_id = p_business_id
    and m.status = 'ready'
    and (p_service_id is null or m.service_id = p_service_id)
    and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit v_limit;
end
$$;

create or replace function public.get_appointment_private_media_object(p_business_id uuid, p_media_id uuid)
returns table(storage_path text, mime_type text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f16_private_media_actor(p_business_id);
  return query
  select m.storage_path, m.mime_type
  from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  limit 1;
end
$$;

-- Delete lifecycle ----------------------------------------------------------

create or replace function public.begin_appointment_private_media_delete(p_business_id uuid, p_media_id uuid)
returns table(storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_private_media;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  select * into v_row from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  for update;
  if v_row.id is null then
    raise exception 'PRIVATE_MEDIA_NOT_FOUND';
  end if;
  if not public.f16_private_media_can_remove(v_actor, v_row) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.appointment_private_media set status = 'deleting'
  where business_id = p_business_id and id = p_media_id;
  return query select v_row.storage_path;
end
$$;

create or replace function public.restore_appointment_private_media_delete(p_business_id uuid, p_media_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_private_media;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  select * into v_row from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'deleting'
  for update;
  if v_row.id is null or not public.f16_private_media_can_remove(v_actor, v_row) then
    raise exception 'PRIVATE_MEDIA_STATE_CONFLICT';
  end if;
  update public.appointment_private_media set status = 'ready'
  where business_id = p_business_id and id = p_media_id;
  return true;
end
$$;

create or replace function public.finish_appointment_private_media_delete(p_business_id uuid, p_media_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_private_media;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  select * into v_row from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('deleting','cleanup')
  for update;
  if v_row.id is null or not public.f16_private_media_can_remove(v_actor, v_row) then
    return false;
  end if;
  delete from public.appointment_private_media
  where business_id = p_business_id and id = p_media_id;
  return true;
end
$$;

-- Explicit publish into the F12 public gallery --------------------------------

create or replace function public.begin_appointment_private_media_publish(
  p_business_id uuid,
  p_media_id uuid,
  p_consent_confirmed boolean
)
returns table(storage_path text, caption text, size_bytes integer, width integer, height integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_private_media;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  if v_actor.role not in ('owner','manager') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_consent_confirmed is distinct from true then
    raise exception 'PRIVATE_MEDIA_CONSENT_REQUIRED';
  end if;
  select * into v_row from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  for update;
  if v_row.id is null then
    raise exception 'PRIVATE_MEDIA_NOT_FOUND';
  end if;
  if public.f16_private_media_is_published(p_business_id, v_row.published_media_id) then
    raise exception 'PRIVATE_MEDIA_ALREADY_PUBLISHED';
  end if;
  return query select v_row.storage_path, v_row.caption, v_row.size_bytes, v_row.width, v_row.height;
end
$$;

create or replace function public.finish_appointment_private_media_publish(
  p_business_id uuid,
  p_media_id uuid,
  p_public_media_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_private_media;
begin
  v_actor := public.f16_private_media_actor(p_business_id);
  if v_actor.role not in ('owner','manager') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select * into v_row from public.appointment_private_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  for update;
  if v_row.id is null then
    raise exception 'PRIVATE_MEDIA_NOT_FOUND';
  end if;
  if public.f16_private_media_is_published(p_business_id, v_row.published_media_id) then
    raise exception 'PRIVATE_MEDIA_ALREADY_PUBLISHED';
  end if;
  if not public.f16_private_media_is_published(p_business_id, p_public_media_id) then
    raise exception 'PRIVATE_MEDIA_STATE_CONFLICT';
  end if;
  update public.appointment_private_media
  set published_media_id = p_public_media_id,
      published_by_membership_id = v_actor.id,
      published_at = clock_timestamp()
  where business_id = p_business_id and id = p_media_id;
  return true;
end
$$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.begin_appointment_private_media_upload(uuid,uuid,uuid,text,uuid,text,text,integer,integer,integer)',
    'public.finalize_appointment_private_media_upload(uuid,uuid)',
    'public.mark_appointment_private_media_cleanup(uuid,uuid)',
    'public.list_appointment_private_media_cleanup(uuid)',
    'public.list_appointment_private_media(uuid,uuid)',
    'public.list_business_private_media_archive(uuid,uuid,timestamptz,uuid,integer)',
    'public.get_appointment_private_media_object(uuid,uuid)',
    'public.begin_appointment_private_media_delete(uuid,uuid)',
    'public.restore_appointment_private_media_delete(uuid,uuid)',
    'public.finish_appointment_private_media_delete(uuid,uuid)',
    'public.begin_appointment_private_media_publish(uuid,uuid,boolean)',
    'public.finish_appointment_private_media_publish(uuid,uuid,uuid)'
  ] loop
    execute 'revoke all on function ' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function ' || sig || ' to authenticated';
  end loop;
end
$$;

-- Storage object policies ----------------------------------------------------

create or replace function public.appointment_private_media_read_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_business_id uuid;
begin
  perform public.f10_require_standard_session();
  select m.business_id into v_business_id
  from public.appointment_private_media m
  where m.storage_path = p_name and m.status = 'ready';
  return v_business_id is not null and public.is_active_member(v_business_id);
exception when others then return false;
end
$$;

create or replace function public.appointment_private_media_upload_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_allowed boolean;
begin
  perform public.f10_require_standard_session();
  select exists(
    select 1
    from public.appointment_private_media m
    join public.memberships ms on ms.business_id = m.business_id and ms.id = m.uploaded_by_membership_id
    where m.storage_path = p_name and m.status = 'pending'
      and ms.user_id = auth.uid() and ms.active
  ) into v_allowed;
  return coalesce(v_allowed, false);
exception when others then return false;
end
$$;

create or replace function public.appointment_private_media_delete_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.appointment_private_media;
  v_actor public.memberships;
begin
  perform public.f10_require_standard_session();
  select * into v_row from public.appointment_private_media m
  where m.storage_path = p_name and m.status in ('deleting','cleanup');
  if v_row.id is null then return false; end if;
  select * into v_actor from public.memberships ms
  where ms.business_id = v_row.business_id and ms.user_id = auth.uid() and ms.active
  limit 1;
  return v_actor.id is not null and public.f16_private_media_can_remove(v_actor, v_row);
exception when others then return false;
end
$$;

revoke all on function public.appointment_private_media_read_allowed(text) from public, anon, authenticated;
revoke all on function public.appointment_private_media_upload_allowed(text) from public, anon, authenticated;
revoke all on function public.appointment_private_media_delete_allowed(text) from public, anon, authenticated;
grant execute on function public.appointment_private_media_read_allowed(text) to authenticated;
grant execute on function public.appointment_private_media_upload_allowed(text) to authenticated;
grant execute on function public.appointment_private_media_delete_allowed(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists f16_private_media_member_read on storage.objects';
    execute 'drop policy if exists f16_private_media_upload on storage.objects';
    execute 'drop policy if exists f16_private_media_delete on storage.objects';
    execute $policy$
      create policy f16_private_media_member_read on storage.objects
      for select to authenticated
      using (bucket_id = 'appointment-private-media' and public.appointment_private_media_read_allowed(name))
    $policy$;
    execute $policy$
      create policy f16_private_media_upload on storage.objects
      for insert to authenticated
      with check (bucket_id = 'appointment-private-media' and public.appointment_private_media_upload_allowed(name))
    $policy$;
    execute $policy$
      create policy f16_private_media_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'appointment-private-media' and public.appointment_private_media_delete_allowed(name))
    $policy$;
  end if;
end
$$;

commit;
