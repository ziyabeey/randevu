begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('c7000000-0000-4000-8000-000000000001', 'f12-repair-owner@example.invalid', '{"full_name":"F12 Repair Owner"}'::jsonb),
  ('c7000000-0000-4000-8000-000000000002', 'f12-repair-other@example.invalid', '{"full_name":"F12 Repair Other"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('c7100000-0000-4000-8000-000000000001', 'F12 Repair A', 'f12-repair-a', 'Europe/Istanbul', 'c7000000-0000-4000-8000-000000000001'),
  ('c7100000-0000-4000-8000-000000000002', 'F12 Repair B', 'f12-repair-b', 'Europe/Istanbul', 'c7000000-0000-4000-8000-000000000002');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('c7200000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'owner', true),
  ('c7200000-0000-4000-8000-000000000002', 'c7100000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000002', 'owner', true);

insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('c7300000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 'Repair Service', 30, 10000, true);
insert into public.staff_profiles(id, business_id, name, active)
values ('c7400000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 'Repair Staff', true);
insert into public.staff_services(business_id, staff_id, service_id, active)
values ('c7100000-0000-4000-8000-000000000001', 'c7400000-0000-4000-8000-000000000001', 'c7300000-0000-4000-8000-000000000001', true);
insert into public.business_hours(id, business_id, weekday, starts_local, ends_local, active)
values ('c7500000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 1, '09:00', '18:00', true);
insert into public.staff_hours(id, business_id, staff_id, weekday, starts_local, ends_local, active)
values ('c7600000-0000-4000-8000-000000000001', 'c7100000-0000-4000-8000-000000000001', 'c7400000-0000-4000-8000-000000000001', 1, '09:00', '18:00', true);

do $$
begin
  if not has_function_privilege('authenticated', 'public.list_business_public_media_cleanup(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_business_public_media_cleanup(uuid)', 'EXECUTE') then
    raise exception 'F12 cleanup claim grants incorrect';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

select * from public.update_public_booking_settings(
  'c7100000-0000-4000-8000-000000000001', true, 15, 60, 60
);

do $$
begin
  begin
    perform * from public.list_business_public_media_cleanup('c7100000-0000-4000-8000-000000000002');
    raise exception 'cross-tenant cleanup claim succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant cleanup claim succeeded' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

select * from public.begin_business_public_media_upload(
  'c7100000-0000-4000-8000-000000000001',
  'c7700000-0000-4000-8000-000000000001',
  'c7100000-0000-4000-8000-000000000001/c7700000-0000-4000-8000-000000000001.webp',
  'Interrupted upload', 'image/webp', 1000, 800, 600
);

do $$
declare v_count integer; p record;
begin
  select count(*) into v_count
  from public.list_business_public_media_cleanup('c7100000-0000-4000-8000-000000000001');
  if v_count <> 0 then raise exception 'fresh pending media reclaimed before grace'; end if;
  select * into p from public.get_business_public_profile('c7100000-0000-4000-8000-000000000001');
  if jsonb_array_length(p.media) <> 0 then raise exception 'pending media leaked into member profile'; end if;
end
$$;
reset role;

do $$
begin
  if exists(select 1 from public.get_public_media_object('c7700000-0000-4000-8000-000000000001')) then
    raise exception 'pending media leaked into public object lookup';
  end if;
end
$$;

alter table public.business_public_media disable trigger business_public_media_touch_updated_at;
update public.business_public_media
set updated_at = clock_timestamp() - interval '16 minutes'
where business_id = 'c7100000-0000-4000-8000-000000000001'
  and id = 'c7700000-0000-4000-8000-000000000001';
alter table public.business_public_media enable trigger business_public_media_touch_updated_at;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare r record;
begin
  select * into r
  from public.list_business_public_media_cleanup('c7100000-0000-4000-8000-000000000001')
  where id = 'c7700000-0000-4000-8000-000000000001';
  if r.id is null then raise exception 'stale pending media was not reclaimed into cleanup state'; end if;
  if not public.finish_business_public_media_delete(
    'c7100000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001'
  ) then raise exception 'cleanup finish failed'; end if;
  if not public.finish_business_public_media_delete(
    'c7100000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001'
  ) then raise exception 'cleanup finish is not idempotent'; end if;
end
$$;

select * from public.begin_business_public_media_upload(
  'c7100000-0000-4000-8000-000000000001',
  'c7700000-0000-4000-8000-000000000002',
  'c7100000-0000-4000-8000-000000000001/c7700000-0000-4000-8000-000000000002.webp',
  'Completed upload', 'image/webp', 1000, 800, 600
);
select public.finalize_business_public_media_upload(
  'c7100000-0000-4000-8000-000000000001',
  'c7700000-0000-4000-8000-000000000002'
);
select * from public.update_business_public_profile(
  'c7100000-0000-4000-8000-000000000001', 'F12 Repair A', null, null,
  null, null, null, null, null, true,
  'c7700000-0000-4000-8000-000000000002'
);
reset role;

do $$
begin
  if not exists(select 1 from public.get_public_media_object('c7700000-0000-4000-8000-000000000002')) then
    raise exception 'ready replacement media not publicly resolvable';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare d record; p record;
begin
  select * into d from public.begin_business_public_media_delete(
    'c7100000-0000-4000-8000-000000000001',
    'c7700000-0000-4000-8000-000000000002'
  );
  if not d.was_cover then raise exception 'delete did not retain cover history'; end if;
  select * into p from public.get_business_public_profile('c7100000-0000-4000-8000-000000000001');
  if p.cover_media_id is not null or jsonb_array_length(p.media) <> 0 then
    raise exception 'deleting media remained visible in profile';
  end if;
end
$$;
reset role;

do $$
begin
  if exists(select 1 from public.get_public_media_object('c7700000-0000-4000-8000-000000000002')) then
    raise exception 'deleting media leaked into public object lookup';
  end if;
end
$$;

alter table public.business_public_media disable trigger business_public_media_touch_updated_at;
update public.business_public_media
set updated_at = clock_timestamp() - interval '16 minutes'
where business_id = 'c7100000-0000-4000-8000-000000000001'
  and id = 'c7700000-0000-4000-8000-000000000002';
alter table public.business_public_media enable trigger business_public_media_touch_updated_at;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare r record;
begin
  select * into r
  from public.list_business_public_media_cleanup('c7100000-0000-4000-8000-000000000001')
  where id = 'c7700000-0000-4000-8000-000000000002';
  if r.id is null then raise exception 'stale deleting media was not reclaimed'; end if;
  if not public.finish_business_public_media_delete(
    'c7100000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000002'
  ) then raise exception 'stale deleting finish failed'; end if;
  if not public.finish_business_public_media_delete(
    'c7100000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000002'
  ) then raise exception 'stale deleting finish not idempotent'; end if;
end
$$;

do $$
declare i integer; v_id uuid; v_path text;
begin
  for i in 1..20 loop
    v_id := gen_random_uuid();
    v_path := 'c7100000-0000-4000-8000-000000000001/' || v_id::text || '.webp';
    perform public.begin_business_public_media_upload(
      'c7100000-0000-4000-8000-000000000001', v_id, v_path,
      null, 'image/webp', 1000, 800, 600
    );
  end loop;
end
$$;
reset role;

alter table public.business_public_media disable trigger business_public_media_touch_updated_at;
update public.business_public_media
set updated_at = clock_timestamp() - interval '16 minutes'
where business_id = 'c7100000-0000-4000-8000-000000000001'
  and status = 'pending';
alter table public.business_public_media enable trigger business_public_media_touch_updated_at;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare r record; v_count integer := 0; v_id uuid := gen_random_uuid();
begin
  for r in select * from public.list_business_public_media_cleanup('c7100000-0000-4000-8000-000000000001') loop
    v_count := v_count + 1;
    if not public.finish_business_public_media_delete('c7100000-0000-4000-8000-000000000001', r.id) then
      raise exception 'quota cleanup failed for %', r.id;
    end if;
  end loop;
  if v_count <> 20 then raise exception 'bounded cleanup expected 20 rows, got %', v_count; end if;
  perform public.begin_business_public_media_upload(
    'c7100000-0000-4000-8000-000000000001', v_id,
    'c7100000-0000-4000-8000-000000000001/' || v_id::text || '.webp',
    null, 'image/webp', 1000, 800, 600
  );
end
$$;

rollback;
