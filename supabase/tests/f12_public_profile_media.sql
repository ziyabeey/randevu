begin;

insert into auth.users(id, email, raw_user_meta_data)
values
  ('b7000000-0000-4000-8000-000000000001', 'f12-owner@example.invalid', '{"full_name":"F12 Owner"}'::jsonb),
  ('b7000000-0000-4000-8000-000000000002', 'f12-staff@example.invalid', '{"full_name":"F12 Staff"}'::jsonb),
  ('b7000000-0000-4000-8000-000000000003', 'f12-other@example.invalid', '{"full_name":"F12 Other"}'::jsonb);

insert into public.businesses(id, name, slug, timezone, created_by)
values
  ('b7100000-0000-4000-8000-000000000001', 'F12 Salon A', 'f12-salon-a', 'Europe/Istanbul', 'b7000000-0000-4000-8000-000000000001'),
  ('b7100000-0000-4000-8000-000000000002', 'F12 Salon B', 'f12-salon-b', 'Europe/Istanbul', 'b7000000-0000-4000-8000-000000000003');

insert into public.memberships(id, business_id, user_id, role, active)
values
  ('b7200000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'owner', true),
  ('b7200000-0000-4000-8000-000000000002', 'b7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'staff', true),
  ('b7200000-0000-4000-8000-000000000003', 'b7100000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000003', 'owner', true);

insert into public.services(id, business_id, name, duration_minutes, price_minor, active)
values ('b7300000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'Saç', 30, 10000, true);
insert into public.staff_profiles(id, business_id, name, active)
values ('b7400000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'Usta', true);
insert into public.staff_services(business_id, staff_id, service_id, active)
values ('b7100000-0000-4000-8000-000000000001', 'b7400000-0000-4000-8000-000000000001', 'b7300000-0000-4000-8000-000000000001', true);
insert into public.business_hours(id, business_id, weekday, starts_local, ends_local, active)
values ('b7500000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 1, '09:00', '18:00', true);
insert into public.staff_hours(id, business_id, staff_id, weekday, starts_local, ends_local, active)
values ('b7600000-0000-4000-8000-000000000001', 'b7100000-0000-4000-8000-000000000001', 'b7400000-0000-4000-8000-000000000001', 1, '10:00', '17:00', true);

do $$
begin
  if has_table_privilege('anon', 'public.business_public_profiles', 'SELECT')
     or has_table_privilege('authenticated', 'public.business_public_profiles', 'INSERT')
     or has_table_privilege('anon', 'public.business_public_media', 'SELECT')
     or has_table_privilege('authenticated', 'public.business_public_media', 'INSERT') then
    raise exception 'F12 tables unexpectedly exposed directly';
  end if;
  if not has_function_privilege('authenticated', 'public.get_business_public_profile(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_business_public_profile(uuid,text,text,text,text,text,text,text,text,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_business_public_profile(uuid,text,text,text,text,text,text,text,text,boolean,uuid)', 'EXECUTE') then
    raise exception 'F12 authenticated profile function grants incorrect';
  end if;
  if has_function_privilege('anon', 'public.get_public_business_profile(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_public_business_profile(text)', 'EXECUTE') then
    raise exception 'raw public profile function unexpectedly exposed';
  end if;
  if not has_function_privilege('anon', 'public.execute_public_operation(text,jsonb,text,text,text)', 'EXECUTE') then
    raise exception 'server-gated public operation grant missing';
  end if;
end
$$;

do $$
declare b record;
begin
  select * into b from storage.buckets where id = 'salon-public-media';
  if b.id is null or b.public or b.file_size_limit <> 5242880
     or b.allowed_mime_types <> array['image/webp']::text[] then
    raise exception 'F12 storage bucket restrictions incorrect';
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='f12_public_media_public_read')
     or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='f12_public_media_upload')
     or not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='f12_public_media_delete') then
    raise exception 'F12 storage policies missing';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b7000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);
do $$
begin
  begin
    perform public.update_business_public_profile(
      'b7100000-0000-4000-8000-000000000001', 'Staff adı', null, null, null, null, null, null, null, true, null
    );
    raise exception 'staff unexpectedly mutated public profile';
  exception when others then
    if sqlerrm = 'staff unexpectedly mutated public profile' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
begin
  begin
    perform public.update_business_public_profile(
      'b7100000-0000-4000-8000-000000000002', 'Kaçak', null, null, null, null, null, null, null, true, null
    );
    raise exception 'cross-tenant profile mutation succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant profile mutation succeeded' then raise; end if;
    if position('NOT_ALLOWED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

select * from public.update_business_public_profile(
  'b7100000-0000-4000-8000-000000000001',
  'F12 Public Salon',
  'Sakin ve gerçek salon açıklaması',
  'Uzun açıklama',
  '+905551112233',
  'salon@example.invalid',
  'https://example.invalid',
  '+905551112233',
  'Bahçeşehir, İstanbul',
  true,
  null
);

do $$
begin
  begin
    perform public.begin_business_public_media_upload(
      'b7100000-0000-4000-8000-000000000001',
      'b7700000-0000-4000-8000-000000000099',
      'b7100000-0000-4000-8000-000000000001/b7700000-0000-4000-8000-000000000099.webp',
      'Yanlış tür', 'image/jpeg', 1000, 800, 600
    );
    raise exception 'invalid media type accepted';
  exception when others then
    if sqlerrm = 'invalid media type accepted' then raise; end if;
    if position('INVALID_PUBLIC_MEDIA' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

select * from public.begin_business_public_media_upload(
  'b7100000-0000-4000-8000-000000000001',
  'b7700000-0000-4000-8000-000000000001',
  'b7100000-0000-4000-8000-000000000001/b7700000-0000-4000-8000-000000000001.webp',
  'Salon girişi', 'image/webp', 1000, 1600, 1000
);
select public.finalize_business_public_media_upload(
  'b7100000-0000-4000-8000-000000000001',
  'b7700000-0000-4000-8000-000000000001'
);
select * from public.update_business_public_profile(
  'b7100000-0000-4000-8000-000000000001',
  'F12 Public Salon', 'Sakin ve gerçek salon açıklaması', 'Uzun açıklama',
  '+905551112233', 'salon@example.invalid', 'https://example.invalid',
  '+905551112233', 'Bahçeşehir, İstanbul', true,
  'b7700000-0000-4000-8000-000000000001'
);

do $$
declare r record;
begin
  select * into r from public.get_business_public_profile('b7100000-0000-4000-8000-000000000001');
  if r.public_name <> 'F12 Public Salon' or r.cover_media_id <> 'b7700000-0000-4000-8000-000000000001'::uuid
     or jsonb_array_length(r.media) <> 1 or jsonb_array_length(r.work_hours) <> 1 then
    raise exception 'authenticated profile snapshot incomplete';
  end if;
end
$$;

select * from public.update_public_booking_settings(
  'b7100000-0000-4000-8000-000000000001', true, 15, 60, 60
);
reset role;

do $$
declare r record;
begin
  select * into r from public.get_public_business_profile('f12-salon-a');
  if r.public_name <> 'F12 Public Salon' or jsonb_array_length(r.media) <> 1 then
    raise exception 'published profile missing expected public content';
  end if;
  if not public.public_media_object_visible(
    'b7100000-0000-4000-8000-000000000001/b7700000-0000-4000-8000-000000000001.webp'
  ) then
    raise exception 'published ready media not visible';
  end if;
end
$$;

update public.staff_hours set active = false
where business_id = 'b7100000-0000-4000-8000-000000000001';

do $$
begin
  if exists(select 1 from public.get_public_business_profile('f12-salon-a')) then
    raise exception 'stale-readiness profile remained public';
  end if;
  if public.public_media_object_visible(
    'b7100000-0000-4000-8000-000000000001/b7700000-0000-4000-8000-000000000001.webp'
  ) then
    raise exception 'stale-readiness media remained public';
  end if;
end
$$;

update public.staff_hours set active = true
where business_id = 'b7100000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"amr":[{"method":"password"}]}', true);

do $$
declare i integer; v_id uuid; v_path text;
begin
  for i in 2..20 loop
    v_id := ('b77' || lpad(i::text, 5, '0') || '-0000-4000-8000-000000000001')::uuid;
    v_path := 'b7100000-0000-4000-8000-000000000001/' || v_id::text || '.webp';
    perform public.begin_business_public_media_upload(
      'b7100000-0000-4000-8000-000000000001', v_id, v_path, null, 'image/webp', 1000, 800, 600
    );
    perform public.finalize_business_public_media_upload('b7100000-0000-4000-8000-000000000001', v_id);
  end loop;
  begin
    perform public.begin_business_public_media_upload(
      'b7100000-0000-4000-8000-000000000001',
      'b7799999-0000-4000-8000-000000000001',
      'b7100000-0000-4000-8000-000000000001/b7799999-0000-4000-8000-000000000001.webp',
      null, 'image/webp', 1000, 800, 600
    );
    raise exception '21st public image accepted';
  exception when others then
    if sqlerrm = '21st public image accepted' then raise; end if;
    if position('PUBLIC_MEDIA_LIMIT_EXCEEDED' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

do $$
declare d record;
begin
  select * into d from public.begin_business_public_media_delete(
    'b7100000-0000-4000-8000-000000000001',
    'b7700000-0000-4000-8000-000000000001'
  );
  if not d.was_cover then raise exception 'cover delete did not record cover state'; end if;
  perform public.restore_business_public_media_delete(
    'b7100000-0000-4000-8000-000000000001',
    'b7700000-0000-4000-8000-000000000001',
    true
  );
end
$$;

reset role;

rollback;
