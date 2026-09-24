begin;

-- F16-03 private appointment photos: ACL, tenant isolation, K03 budget, delete
-- and publish authority, membership revocation and storage object policies.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1630000-0000-4000-8000-000000000001','f1603-owner@example.invalid','{}'::jsonb),
  ('f1630000-0000-4000-8000-000000000002','f1603-manager@example.invalid','{}'::jsonb),
  ('f1630000-0000-4000-8000-000000000003','f1603-staff@example.invalid','{}'::jsonb),
  ('f1630000-0000-4000-8000-000000000004','f1603-staff2@example.invalid','{}'::jsonb),
  ('f1630000-0000-4000-8000-000000000005','f1603-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1631000-0000-4000-8000-000000000001','F16-03 Salon A','f1603-salon-a','Europe/Istanbul','f1630000-0000-4000-8000-000000000001'),
  ('f1631000-0000-4000-8000-000000000002','F16-03 Salon B','f1603-salon-b','Europe/Istanbul','f1630000-0000-4000-8000-000000000005');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1632000-0000-4000-8000-000000000001','f1631000-0000-4000-8000-000000000001','f1630000-0000-4000-8000-000000000001','owner',true),
  ('f1632000-0000-4000-8000-000000000002','f1631000-0000-4000-8000-000000000001','f1630000-0000-4000-8000-000000000002','manager',true),
  ('f1632000-0000-4000-8000-000000000003','f1631000-0000-4000-8000-000000000001','f1630000-0000-4000-8000-000000000003','staff',true),
  ('f1632000-0000-4000-8000-000000000004','f1631000-0000-4000-8000-000000000001','f1630000-0000-4000-8000-000000000004','staff',true),
  ('f1632000-0000-4000-8000-000000000005','f1631000-0000-4000-8000-000000000002','f1630000-0000-4000-8000-000000000005','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('f1634000-0000-4000-8000-000000000001','f1631000-0000-4000-8000-000000000001','F16 Boya',60,0,0,'Renk',10,20000,'fixed',20000,20000,'TRY',true),
  ('f1634000-0000-4000-8000-000000000002','f1631000-0000-4000-8000-000000000001','F16 Kesim',30,0,0,'Genel',20,15000,'fixed',15000,15000,'TRY',true),
  ('f1634000-0000-4000-8000-000000000003','f1631000-0000-4000-8000-000000000002','F16 B Hizmet',30,0,0,'Genel',10,12000,'fixed',12000,12000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('f1635000-0000-4000-8000-000000000001','f1631000-0000-4000-8000-000000000001','F16 Ayla',true),
  ('f1635000-0000-4000-8000-000000000002','f1631000-0000-4000-8000-000000000002','F16 Bora',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('f1631000-0000-4000-8000-000000000001','f1635000-0000-4000-8000-000000000001','f1634000-0000-4000-8000-000000000001',true),
  ('f1631000-0000-4000-8000-000000000001','f1635000-0000-4000-8000-000000000001','f1634000-0000-4000-8000-000000000002',true),
  ('f1631000-0000-4000-8000-000000000002','f1635000-0000-4000-8000-000000000002','f1634000-0000-4000-8000-000000000003',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select b, d, time '09:00', time '18:00', true
from unnest(array['f1631000-0000-4000-8000-000000000001','f1631000-0000-4000-8000-000000000002']::uuid[]) b
cross join generate_series(0,6) d;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select v.b, v.s, d, time '09:00', time '18:00', true
from (values
  ('f1631000-0000-4000-8000-000000000001'::uuid,'f1635000-0000-4000-8000-000000000001'::uuid),
  ('f1631000-0000-4000-8000-000000000002'::uuid,'f1635000-0000-4000-8000-000000000002'::uuid)
) v(b,s)
cross join generate_series(0,6) d;

-- S08 ACL boundary.
do $acl$
declare b record;
begin
  if has_table_privilege('anon','public.appointment_private_media','SELECT')
     or has_table_privilege('authenticated','public.appointment_private_media','SELECT')
     or has_table_privilege('authenticated','public.appointment_private_media','INSERT')
     or has_table_privilege('authenticated','public.appointment_private_media','UPDATE')
     or has_table_privilege('authenticated','public.appointment_private_media','DELETE') then
    raise exception 'F16-03 private media table exposed directly to API roles';
  end if;
  if not has_function_privilege('authenticated','public.list_appointment_private_media(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.list_appointment_private_media(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.begin_appointment_private_media_upload(uuid,uuid,uuid,text,uuid,text,text,integer,integer,integer)','EXECUTE')
     or has_function_privilege('anon','public.get_appointment_private_media_object(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.appointment_private_media_read_allowed(text)','EXECUTE')
     or has_function_privilege('authenticated','public.f16_private_media_actor(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.f16_private_media_is_published(uuid,uuid)','EXECUTE') then
    raise exception 'F16-03 function grants are wrong';
  end if;
  if exists(
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like '%appointment_private_media%' or p.proname like 'f16_private_media%')
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where split_part(cfg,'=',1) = 'search_path' and split_part(cfg,'=',2) in ('','""')
      )
  ) then
    raise exception 'F16-03 SECURITY DEFINER function without empty search_path';
  end if;
  select * into b from storage.buckets where id = 'appointment-private-media';
  if b.id is null or b.public or b.file_size_limit <> 5242880
     or b.allowed_mime_types <> array['image/webp']::text[] then
    raise exception 'F16-03 private bucket restrictions incorrect';
  end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
            and policyname like 'f16_private_media%' and 'anon' = any(roles)) then
    raise exception 'F16-03 private storage policy reaches anon';
  end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
      and policyname in ('f16_private_media_member_read','f16_private_media_upload','f16_private_media_delete')) <> 3 then
    raise exception 'F16-03 storage policies missing';
  end if;
end
$acl$;

-- Booking groups through the canonical F11 authority.
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000001',true);
do $$
declare v_group jsonb;
begin
  v_group := public.create_appointment_group(
    'f1631000-0000-4000-8000-000000000001','f1603-group-a-0001','F16 Müşteri A',
    '[{"serviceId":"f1634000-0000-4000-8000-000000000001","staffId":"f1635000-0000-4000-8000-000000000001"}]'::jsonb,
    ((current_date + 7) + time '10:00') at time zone 'Europe/Istanbul','05551603001',null
  );
  perform set_config('f1603.group_a', v_group->>'groupId', false);
end
$$;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000005',true);
do $$
declare v_group jsonb;
begin
  v_group := public.create_appointment_group(
    'f1631000-0000-4000-8000-000000000002','f1603-group-b-0001','F16 Müşteri B',
    '[{"serviceId":"f1634000-0000-4000-8000-000000000003","staffId":"f1635000-0000-4000-8000-000000000002"}]'::jsonb,
    ((current_date + 7) + time '10:00') at time zone 'Europe/Istanbul','05551603002',null
  );
  perform set_config('f1603.group_b', v_group->>'groupId', false);
end
$$;

-- Staff upload lifecycle, validation and tenant isolation.
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000003',true);
do $$
declare
  v_a uuid := 'f1631000-0000-4000-8000-000000000001';
  v_b uuid := 'f1631000-0000-4000-8000-000000000002';
  v_group uuid := current_setting('f1603.group_a')::uuid;
  v_group_b uuid := current_setting('f1603.group_b')::uuid;
  v_media uuid := 'f1636000-0000-4000-8000-000000000001';
  v_row record;
  v_failed boolean;
  v_message text;
begin
  select * into v_row from public.begin_appointment_private_media_upload(
    v_a, v_group, v_media, v_a::text || '/' || v_group::text || '/' || v_media::text || '.webp',
    'f1634000-0000-4000-8000-000000000001', '  Önce / sonra  ', 'image/webp', 1024, 800, 600
  );
  if v_row.status <> 'pending' or v_row.caption <> 'Önce / sonra' then
    raise exception 'F16-03 begin upload returned %', row_to_json(v_row);
  end if;
  if not public.appointment_private_media_upload_allowed(v_a::text || '/' || v_group::text || '/' || v_media::text || '.webp') then
    raise exception 'F16-03 uploader could not write the pending object';
  end if;
  if public.appointment_private_media_read_allowed(v_a::text || '/' || v_group::text || '/' || v_media::text || '.webp') then
    raise exception 'F16-03 pending object became readable before finalize';
  end if;
  perform 1 from public.finalize_appointment_private_media_upload(v_a, v_media);
  if public.appointment_private_media_upload_allowed(v_a::text || '/' || v_group::text || '/' || v_media::text || '.webp') then
    raise exception 'F16-03 ready object still accepts uploads';
  end if;
  if not public.appointment_private_media_read_allowed(v_a::text || '/' || v_group::text || '/' || v_media::text || '.webp') then
    raise exception 'F16-03 active member cannot read ready object';
  end if;

  foreach v_message in array array[
    'path', 'mime', 'size', 'edge', 'caption', 'service', 'foreign-group', 'foreign-business'
  ] loop
    v_failed := false;
    begin
      if v_message = 'path' then
        perform public.begin_appointment_private_media_upload(v_a, v_group, gen_random_uuid(), v_b::text || '/x.webp', null, null, 'image/webp', 10, 10, 10);
      elsif v_message = 'mime' then
        perform public.begin_appointment_private_media_upload(v_a, v_group, 'f1636000-0000-4000-8000-0000000000a1', v_a::text || '/' || v_group::text || '/f1636000-0000-4000-8000-0000000000a1.webp', null, null, 'image/png', 10, 10, 10);
      elsif v_message = 'size' then
        perform public.begin_appointment_private_media_upload(v_a, v_group, 'f1636000-0000-4000-8000-0000000000a2', v_a::text || '/' || v_group::text || '/f1636000-0000-4000-8000-0000000000a2.webp', null, null, 'image/webp', 5242881, 10, 10);
      elsif v_message = 'edge' then
        perform public.begin_appointment_private_media_upload(v_a, v_group, 'f1636000-0000-4000-8000-0000000000a3', v_a::text || '/' || v_group::text || '/f1636000-0000-4000-8000-0000000000a3.webp', null, null, 'image/webp', 10, 2001, 10);
      elsif v_message = 'caption' then
        perform public.begin_appointment_private_media_upload(v_a, v_group, 'f1636000-0000-4000-8000-0000000000a4', v_a::text || '/' || v_group::text || '/f1636000-0000-4000-8000-0000000000a4.webp', null, repeat('x', 241), 'image/webp', 10, 10, 10);
      elsif v_message = 'service' then
        -- Kesim belongs to the business but not to this appointment group.
        perform public.begin_appointment_private_media_upload(v_a, v_group, 'f1636000-0000-4000-8000-0000000000a5', v_a::text || '/' || v_group::text || '/f1636000-0000-4000-8000-0000000000a5.webp', 'f1634000-0000-4000-8000-000000000002', null, 'image/webp', 10, 10, 10);
      elsif v_message = 'foreign-group' then
        perform public.begin_appointment_private_media_upload(v_a, v_group_b, 'f1636000-0000-4000-8000-0000000000a6', v_a::text || '/' || v_group_b::text || '/f1636000-0000-4000-8000-0000000000a6.webp', null, null, 'image/webp', 10, 10, 10);
      else
        perform public.begin_appointment_private_media_upload(v_b, v_group_b, 'f1636000-0000-4000-8000-0000000000a7', v_b::text || '/' || v_group_b::text || '/f1636000-0000-4000-8000-0000000000a7.webp', null, null, 'image/webp', 10, 10, 10);
      end if;
    exception when others then
      v_failed := sqlerrm in ('INVALID_PRIVATE_MEDIA','PRIVATE_MEDIA_GROUP_NOT_FOUND','NOT_ALLOWED');
      if not v_failed then raise exception 'F16-03 % rejection used %', v_message, sqlerrm; end if;
    end;
    if not v_failed then raise exception 'F16-03 % was accepted', v_message; end if;
  end loop;
end
$$;

-- Another member cannot finalize someone else's pending upload.
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000003',true);
select 1 from public.begin_appointment_private_media_upload(
  'f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid,
  'f1636000-0000-4000-8000-000000000002',
  'f1631000-0000-4000-8000-000000000001/' || current_setting('f1603.group_a') || '/f1636000-0000-4000-8000-000000000002.webp',
  null, null, 'image/webp', 2048, 640, 480
);
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000002',true);
do $$
begin
  begin
    perform public.finalize_appointment_private_media_upload('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000002');
    raise exception 'manager finalized another member upload';
  exception when others then
    if sqlerrm <> 'PRIVATE_MEDIA_STATE_CONFLICT' then raise exception 'F16-03 foreign finalize used %', sqlerrm; end if;
  end;
  if public.appointment_private_media_upload_allowed(
       'f1631000-0000-4000-8000-000000000001/' || current_setting('f1603.group_a') || '/f1636000-0000-4000-8000-000000000002.webp') then
    raise exception 'F16-03 non-uploader may write another member pending object';
  end if;
end
$$;

-- Failed upload goes to cleanup and never counts or becomes visible.
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000003',true);
do $$
declare v_count integer;
begin
  if not public.mark_appointment_private_media_cleanup('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000002') then
    raise exception 'F16-03 uploader could not mark failed upload for cleanup';
  end if;
  select count(*) into v_count from public.list_appointment_private_media_cleanup('f1631000-0000-4000-8000-000000000001');
  if v_count <> 1 then raise exception 'F16-03 cleanup list count %', v_count; end if;
  select count(*) into v_count from public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid);
  if v_count <> 1 then raise exception 'F16-03 cleanup row leaked into the photo tab (%)', v_count; end if;
  if not public.appointment_private_media_delete_allowed(
       'f1631000-0000-4000-8000-000000000001/' || current_setting('f1603.group_a') || '/f1636000-0000-4000-8000-000000000002.webp') then
    raise exception 'F16-03 uploader cannot delete its cleanup object';
  end if;
  if not public.finish_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000002') then
    raise exception 'F16-03 cleanup finish failed';
  end if;
end
$$;

-- K03: 10 private photos per appointment group; the 11th is refused.
do $$
declare
  v_a uuid := 'f1631000-0000-4000-8000-000000000001';
  v_group uuid := current_setting('f1603.group_a')::uuid;
  v_id uuid;
  v_refused boolean := false;
begin
  for i in 2..10 loop
    v_id := ('f1636000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid;
    perform 1 from public.begin_appointment_private_media_upload(
      v_a, v_group, v_id, v_a::text || '/' || v_group::text || '/' || v_id::text || '.webp',
      null, 'Foto ' || i, 'image/webp', 1000 + i, 100, 100
    );
    perform 1 from public.finalize_appointment_private_media_upload(v_a, v_id);
  end loop;
  begin
    v_id := 'f1636000-0000-4000-8000-000000000199';
    perform public.begin_appointment_private_media_upload(
      v_a, v_group, v_id, v_a::text || '/' || v_group::text || '/' || v_id::text || '.webp',
      null, null, 'image/webp', 10, 10, 10
    );
  exception when others then
    v_refused := sqlerrm = 'PRIVATE_MEDIA_LIMIT_EXCEEDED';
    if not v_refused then raise exception 'F16-03 limit rejection used %', sqlerrm; end if;
  end;
  if not v_refused then raise exception 'F16-03 accepted an 11th private photo'; end if;
end
$$;

-- Reads: staff sees tab + archive, only owner/manager may publish, B is isolated.
do $$
declare
  v_count integer;
  v_row record;
  v_last record;
  v_seen integer := 0;
  v_created timestamptz;
  v_id uuid;
begin
  select count(*) into v_count from public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid);
  if v_count <> 10 then raise exception 'F16-03 tab count %', v_count; end if;
  select * into v_row from public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid) limit 1;
  if v_row.id <> 'f1636000-0000-4000-8000-000000000001' or v_row.service_name <> 'F16 Boya'
     or not v_row.can_delete or v_row.can_publish or v_row.published then
    raise exception 'F16-03 staff tab projection wrong: %', row_to_json(v_row);
  end if;
  loop
    v_count := 0;
    for v_last in select * from public.list_business_private_media_archive(
      'f1631000-0000-4000-8000-000000000001', null, v_created, v_id, 4
    ) loop
      v_count := v_count + 1;
      v_seen := v_seen + 1;
      if v_last.customer_name <> 'F16 Müşteri A' then raise exception 'F16-03 archive customer wrong'; end if;
      v_created := v_last.created_at;
      v_id := v_last.id;
    end loop;
    exit when v_count < 4;
  end loop;
  if v_seen <> 10 then raise exception 'F16-03 archive keyset pagination saw % photos', v_seen; end if;
  select count(*) into v_count from public.list_business_private_media_archive('f1631000-0000-4000-8000-000000000001', 'f1634000-0000-4000-8000-000000000001', null, null, 25);
  if v_count <> 1 then raise exception 'F16-03 archive service filter count %', v_count; end if;
  begin
    perform public.list_business_private_media_archive('f1631000-0000-4000-8000-000000000001', null, null, null, 101);
    raise exception 'archive accepted an unbounded page';
  exception when others then
    if sqlerrm <> 'INVALID_PRIVATE_MEDIA' then raise exception 'F16-03 archive limit used %', sqlerrm; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000005',true);
do $$
declare v_count integer;
begin
  foreach v_count in array array[1,2,3,4] loop
    begin
      if v_count = 1 then perform public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid);
      elsif v_count = 2 then perform public.list_business_private_media_archive('f1631000-0000-4000-8000-000000000001');
      elsif v_count = 3 then perform public.get_appointment_private_media_object('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000001');
      else perform public.begin_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000001');
      end if;
      raise exception 'foreign owner reached tenant A private media (%)', v_count;
    exception when others then
      if sqlerrm <> 'NOT_ALLOWED' then raise exception 'F16-03 foreign access % used %', v_count, sqlerrm; end if;
    end;
  end loop;
  select count(*) into v_count from public.list_appointment_private_media('f1631000-0000-4000-8000-000000000002', current_setting('f1603.group_b')::uuid);
  if v_count <> 0 then raise exception 'F16-03 tenant B saw photos'; end if;
  begin
    perform public.list_appointment_private_media('f1631000-0000-4000-8000-000000000002', current_setting('f1603.group_a')::uuid);
    raise exception 'tenant B resolved tenant A group';
  exception when others then
    if sqlerrm <> 'PRIVATE_MEDIA_GROUP_NOT_FOUND' then raise exception 'F16-03 cross-tenant group used %', sqlerrm; end if;
  end;
  if public.appointment_private_media_read_allowed(
       'f1631000-0000-4000-8000-000000000001/' || current_setting('f1603.group_a') || '/f1636000-0000-4000-8000-000000000001.webp') then
    raise exception 'F16-03 foreign owner can read tenant A object by guessed path';
  end if;
end
$$;

-- Delete authority: another staff member cannot remove a colleague's photo;
-- the uploader and managers can. Storage delete is allowed only while deleting.
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000004',true);
do $$
begin
  perform public.begin_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000001');
  raise exception 'staff removed a colleague photo';
exception when others then
  if sqlerrm <> 'NOT_ALLOWED' then raise exception 'F16-03 colleague delete used %', sqlerrm; end if;
end
$$;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000003',true);
do $$
declare v_path text;
begin
  select storage_path into v_path from public.begin_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000102');
  if v_path is null then raise exception 'F16-03 uploader delete did not return path'; end if;
  if public.appointment_private_media_read_allowed(v_path) then raise exception 'F16-03 deleting object still readable'; end if;
  if not public.appointment_private_media_delete_allowed(v_path) then raise exception 'F16-03 uploader cannot delete object'; end if;
  perform public.restore_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000102');
  if public.appointment_private_media_delete_allowed(v_path) then raise exception 'F16-03 restored object still deletable'; end if;
end
$$;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000002',true);
do $$
begin
  perform 1 from public.begin_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000102');
  if not public.finish_appointment_private_media_delete('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000102') then
    raise exception 'F16-03 manager could not finish delete';
  end if;
  if exists(select 1 from public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid) where id = 'f1636000-0000-4000-8000-000000000102') then
    raise exception 'F16-03 deleted photo still listed';
  end if;
end
$$;

-- Publish is explicit, manager-only, consent-bound and single-live.
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000003',true);
do $$
begin
  perform public.begin_appointment_private_media_publish('f1631000-0000-4000-8000-000000000001','f1636000-0000-4000-8000-000000000001', true);
  raise exception 'staff published a private photo';
exception when others then
  if sqlerrm <> 'NOT_ALLOWED' then raise exception 'F16-03 staff publish used %', sqlerrm; end if;
end
$$;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000002',true);
do $$
declare
  v_a uuid := 'f1631000-0000-4000-8000-000000000001';
  v_private uuid := 'f1636000-0000-4000-8000-000000000001';
  v_public uuid := 'f1637000-0000-4000-8000-000000000001';
  v_row record;
begin
  begin
    perform public.begin_appointment_private_media_publish(v_a, v_private, false);
    raise exception 'publish without consent accepted';
  exception when others then
    if sqlerrm <> 'PRIVATE_MEDIA_CONSENT_REQUIRED' then raise exception 'F16-03 consent rejection used %', sqlerrm; end if;
  end;
  select * into v_row from public.begin_appointment_private_media_publish(v_a, v_private, true);
  if v_row.width <> 800 or v_row.caption <> 'Önce / sonra' then raise exception 'F16-03 publish source wrong'; end if;
  begin
    perform public.finish_appointment_private_media_publish(v_a, v_private, v_public);
    raise exception 'publish finished without a ready public media row';
  exception when others then
    if sqlerrm <> 'PRIVATE_MEDIA_STATE_CONFLICT' then raise exception 'F16-03 unpublished finish used %', sqlerrm; end if;
  end;
  perform 1 from public.begin_business_public_media_upload(v_a, v_public, v_a::text || '/' || v_public::text || '.webp', 'Önce / sonra', 'image/webp', 1024, 800, 600);
  perform public.finalize_business_public_media_upload(v_a, v_public);
  if not public.finish_appointment_private_media_publish(v_a, v_private, v_public) then raise exception 'F16-03 publish finish failed'; end if;
  select * into v_row from public.list_appointment_private_media(v_a, current_setting('f1603.group_a')::uuid) where id = v_private;
  if not v_row.published or not v_row.can_publish then raise exception 'F16-03 published state missing'; end if;
  begin
    perform public.begin_appointment_private_media_publish(v_a, v_private, true);
    raise exception 'double publish accepted';
  exception when others then
    if sqlerrm <> 'PRIVATE_MEDIA_ALREADY_PUBLISHED' then raise exception 'F16-03 double publish used %', sqlerrm; end if;
  end;
  -- Removing the public copy through F12 keeps the private original and allows republish.
  perform 1 from public.begin_business_public_media_delete(v_a, v_public);
  perform public.finish_business_public_media_delete(v_a, v_public);
  select * into v_row from public.list_appointment_private_media(v_a, current_setting('f1603.group_a')::uuid) where id = v_private;
  if v_row.id is null or v_row.published then raise exception 'F16-03 removed public copy still marked published'; end if;
  perform 1 from public.begin_appointment_private_media_publish(v_a, v_private, true);
end
$$;

-- Storage object RLS through the real policies (not only predicate functions).
reset role;
insert into storage.objects(bucket_id, name)
select 'appointment-private-media', storage_path
from public.appointment_private_media
where business_id = 'f1631000-0000-4000-8000-000000000001' and status = 'ready';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000004',true);
do $$
declare v_count integer;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'appointment-private-media'
    and name like 'f1631000-0000-4000-8000-000000000001/%';
  if v_count <> 9 then raise exception 'F16-03 member read policy returned % objects', v_count; end if;
  begin
    insert into storage.objects(bucket_id, name)
    values ('appointment-private-media', 'f1631000-0000-4000-8000-000000000001/' || current_setting('f1603.group_a') || '/f1636000-0000-4000-8000-0000000009ff.webp');
    raise exception 'unregistered private object insert accepted';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where bucket_id = 'appointment-private-media' and name like 'f1631000-0000-4000-8000-000000000001/%';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'F16-03 member deleted ready objects via storage (%)', v_count; end if;
end
$$;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000005',true);
do $$
declare v_count integer;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'appointment-private-media';
  if v_count <> 0 then raise exception 'F16-03 foreign owner sees % private objects', v_count; end if;
end
$$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare v_count integer;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'appointment-private-media';
  if v_count <> 0 then raise exception 'F16-03 anon sees % private objects', v_count; end if;
end
$$;

-- Membership revocation and recovery sessions lose access immediately.
reset role;
update public.memberships set active = false where id = 'f1632000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000004',true);
do $$
declare v_count integer;
begin
  begin
    perform public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid);
    raise exception 'revoked member listed private photos';
  exception when others then
    if sqlerrm <> 'NOT_ALLOWED' then raise exception 'F16-03 revoked list used %', sqlerrm; end if;
  end;
  if public.appointment_private_media_read_allowed(
       'f1631000-0000-4000-8000-000000000001/' || current_setting('f1603.group_a') || '/f1636000-0000-4000-8000-000000000001.webp') then
    raise exception 'F16-03 revoked member still reads object';
  end if;
  select count(*) into v_count from storage.objects where bucket_id = 'appointment-private-media';
  if v_count <> 0 then raise exception 'F16-03 revoked member sees % storage objects', v_count; end if;
end
$$;
select set_config('request.jwt.claim.sub','f1630000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $$
begin
  perform public.list_appointment_private_media('f1631000-0000-4000-8000-000000000001', current_setting('f1603.group_a')::uuid);
  raise exception 'recovery session listed private photos';
exception when others then
  if sqlerrm not like 'AUTH_%' and sqlerrm not like 'PASSWORD_%' then raise exception 'F16-03 recovery session used %', sqlerrm; end if;
end
$$;

reset role;
do $$
begin
  if (select count(*) from public.appointment_private_media where business_id = 'f1631000-0000-4000-8000-000000000001' and status = 'ready') <> 9 then
    raise exception 'F16-03 final ready count drifted';
  end if;
end
$$;

select 'F16-03 private media acceptance passed' as result;
commit;
