begin;

-- F12-02 forward repair: requests can die between DB state transitions and
-- Storage I/O. Keep the original 110500 schema contract intact and make stale
-- in-flight rows reclaimable after a conservative grace period.

create index if not exists business_public_media_cleanup_scan_idx
  on public.business_public_media(business_id, status, updated_at, id);

-- Cover selection participates in the same per-business lifecycle lock as
-- media delete/reclaim. Without this, a profile save could validate a ready
-- cover, race with delete, then write the deleted media id back afterward.
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
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

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
  on conflict on constraint business_public_profiles_pkey do update
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

create or replace function public.finalize_business_public_media_upload(
  p_business_id uuid, p_media_id uuid
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
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  update public.business_public_media m
  set status = 'ready'
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'PUBLIC_MEDIA_STATE_CONFLICT'; end if;
  return v_row;
end
$$;

create or replace function public.mark_business_public_media_cleanup(
  p_business_id uuid, p_media_id uuid
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
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  update public.business_public_media m
  set status = 'cleanup'
  where m.business_id = p_business_id and m.id = p_media_id and m.status in ('pending','deleting')
  returning * into v_row;
  if v_row.id is null then
    select * into v_row
    from public.business_public_media m
    where m.business_id = p_business_id and m.id = p_media_id and m.status = 'cleanup';
  end if;
  return v_row;
end
$$;

create or replace function public.begin_business_public_media_delete(
  p_business_id uuid, p_media_id uuid
)
returns table(storage_path text, was_cover boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_path text; v_cover boolean;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  select m.storage_path into v_path
  from public.business_public_media m
  where m.business_id = p_business_id and m.id = p_media_id and m.status = 'ready'
  for update;
  if v_path is null then raise exception 'PUBLIC_MEDIA_NOT_FOUND'; end if;

  select exists(
    select 1 from public.business_public_profiles p
    where p.business_id = p_business_id and p.cover_media_id = p_media_id
  ) into v_cover;

  update public.business_public_media
  set status = 'deleting'
  where business_id = p_business_id and id = p_media_id;
  update public.business_public_profiles
  set cover_media_id = null
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
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  update public.business_public_media m
  set status = 'ready'
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

create or replace function public.finish_business_public_media_delete(
  p_business_id uuid, p_media_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_count integer;
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  delete from public.business_public_media m
  where m.business_id = p_business_id
    and m.id = p_media_id
    and m.status in ('deleting','cleanup');
  get diagnostics v_count = row_count;
  if v_count = 1 then return true; end if;

  -- Repeated completion after another cleanup worker already deleted the row is
  -- terminal success. A row still present in a non-terminal state is a conflict.
  return not exists(
    select 1 from public.business_public_media m
    where m.business_id = p_business_id and m.id = p_media_id
  );
end
$$;

create or replace function public.list_business_public_media_cleanup(p_business_id uuid)
returns table(id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- The business row is the lifecycle serialization lock used by begin/finalize,
  -- delete/restore/finish, cover updates and stale reclaim. Fresh requests get a
  -- 15 minute grace and can never be reclaimed inside their normal window.
  perform 1 from public.businesses b where b.id = p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;

  update public.business_public_media m
  set status = 'cleanup'
  where m.business_id = p_business_id
    and m.status in ('pending','deleting')
    and m.updated_at <= clock_timestamp() - interval '15 minutes';

  return query
  select m.id, m.storage_path
  from public.business_public_media m
  where m.business_id = p_business_id and m.status = 'cleanup'
  order by m.updated_at, m.id
  limit 20;
end
$$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'public.update_business_public_profile(uuid,text,text,text,text,text,text,text,text,boolean,uuid)',
    'public.finalize_business_public_media_upload(uuid,uuid)',
    'public.mark_business_public_media_cleanup(uuid,uuid)',
    'public.begin_business_public_media_delete(uuid,uuid)',
    'public.restore_business_public_media_delete(uuid,uuid,boolean)',
    'public.finish_business_public_media_delete(uuid,uuid)',
    'public.list_business_public_media_cleanup(uuid)'
  ] loop
    execute 'revoke all on function ' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function ' || sig || ' to authenticated';
  end loop;
end
$$;

commit;
