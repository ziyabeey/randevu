begin;

-- F16-04 feedback and reviews: capability-only authoring, one per appointment,
-- completed-only eligibility, idempotent replay, consent-bound publishing,
-- masked public output, tenant isolation and gateway error vocabulary.

delete from public.public_booking_rate_counters;
delete from public.public_booking_abuse_config where config_key = 'default';
insert into public.public_booking_abuse_config(config_key, gate_secret_hash)
values ('default', encode(extensions.digest('f1604-feedback-gate-secret-000000000000000000', 'sha256'), 'hex'));

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1640000-0000-4000-8000-000000000001','f1604-owner@example.invalid','{}'::jsonb),
  ('f1640000-0000-4000-8000-000000000002','f1604-staff@example.invalid','{}'::jsonb),
  ('f1640000-0000-4000-8000-000000000003','f1604-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1641000-0000-4000-8000-000000000001','F16-04 Salon A','f1604-salon-a','Europe/Istanbul','f1640000-0000-4000-8000-000000000001'),
  ('f1641000-0000-4000-8000-000000000002','F16-04 Salon B','f1604-salon-b','Europe/Istanbul','f1640000-0000-4000-8000-000000000003');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1642000-0000-4000-8000-000000000001','f1641000-0000-4000-8000-000000000001','f1640000-0000-4000-8000-000000000001','owner',true),
  ('f1642000-0000-4000-8000-000000000002','f1641000-0000-4000-8000-000000000001','f1640000-0000-4000-8000-000000000002','staff',true),
  ('f1642000-0000-4000-8000-000000000003','f1641000-0000-4000-8000-000000000002','f1640000-0000-4000-8000-000000000003','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('f1644000-0000-4000-8000-000000000001','f1641000-0000-4000-8000-000000000001','F16 Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true),
  ('f1644000-0000-4000-8000-000000000002','f1641000-0000-4000-8000-000000000002','F16 B Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true);
insert into public.staff_profiles(id,business_id,name,active)
values
  ('f1645000-0000-4000-8000-000000000001','f1641000-0000-4000-8000-000000000001','F16 Ayla',true),
  ('f1645000-0000-4000-8000-000000000002','f1641000-0000-4000-8000-000000000002','F16 Bora',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('f1641000-0000-4000-8000-000000000001','f1645000-0000-4000-8000-000000000001','f1644000-0000-4000-8000-000000000001',true),
  ('f1641000-0000-4000-8000-000000000002','f1645000-0000-4000-8000-000000000002','f1644000-0000-4000-8000-000000000002',true);
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select b, d, time '09:00', time '18:00', true
from unnest(array['f1641000-0000-4000-8000-000000000001','f1641000-0000-4000-8000-000000000002']::uuid[]) b
cross join generate_series(0,6) d;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select v.b, v.s, d, time '09:00', time '18:00', true
from (values
  ('f1641000-0000-4000-8000-000000000001'::uuid,'f1645000-0000-4000-8000-000000000001'::uuid),
  ('f1641000-0000-4000-8000-000000000002'::uuid,'f1645000-0000-4000-8000-000000000002'::uuid)
) v(b,s)
cross join generate_series(0,6) d;
insert into public.business_public_profiles(business_id, public_phone)
values ('f1641000-0000-4000-8000-000000000001','+905551604000')
on conflict (business_id) do update set public_phone = excluded.public_phone;
insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('f1641000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update set enabled=true;

-- ACL boundary.
do $acl$
begin
  if has_table_privilege('anon','public.appointment_feedback','SELECT')
     or has_table_privilege('authenticated','public.appointment_feedback','SELECT')
     or has_table_privilege('authenticated','public.appointment_feedback','INSERT') then
    raise exception 'F16-04 feedback table exposed to API roles';
  end if;
  if not has_function_privilege('anon','public.execute_public_feedback_operation(text,jsonb,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.submit_public_managed_feedback(text,integer,text,boolean)','EXECUTE')
     or has_function_privilege('authenticated','public.submit_public_managed_feedback(text,integer,text,boolean)','EXECUTE')
     or has_function_privilege('anon','public.get_public_business_reviews(text,integer)','EXECUTE')
     or has_function_privilege('anon','public.list_business_feedback(uuid,text,timestamptz,uuid,integer)','EXECUTE')
     or not has_function_privilege('authenticated','public.moderate_business_feedback(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'F16-04 function grants are wrong';
  end if;
  if exists(
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('f16_feedback_ref','get_public_managed_feedback','submit_public_managed_feedback',
        'get_public_business_reviews','list_business_feedback','moderate_business_feedback')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where split_part(cfg,'=',1) = 'search_path' and split_part(cfg,'=',2) in ('','""')
      )
  ) then
    raise exception 'F16-04 definer function without empty search_path';
  end if;
end
$acl$;

-- Two appointment groups for A (one to complete, one left scheduled), one for B.
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1640000-0000-4000-8000-000000000001',true);
do $$
declare v_group jsonb;
begin
  v_group := public.create_appointment_group('f1641000-0000-4000-8000-000000000001','f1604-group-done','Ayşe Nur Demir',
    '[{"serviceId":"f1644000-0000-4000-8000-000000000001","staffId":"f1645000-0000-4000-8000-000000000001"}]'::jsonb,
    ((current_date + 7) + time '10:00') at time zone 'Europe/Istanbul','05551604001','ayse@example.invalid');
  perform set_config('f1604.group_done', v_group->>'groupId', false);
  v_group := public.create_appointment_group('f1641000-0000-4000-8000-000000000001','f1604-group-open','Mehmet Kaya',
    '[{"serviceId":"f1644000-0000-4000-8000-000000000001","staffId":"f1645000-0000-4000-8000-000000000001"}]'::jsonb,
    ((current_date + 7) + time '12:00') at time zone 'Europe/Istanbul','05551604002',null);
  perform set_config('f1604.group_open', v_group->>'groupId', false);
end
$$;
select set_config('request.jwt.claim.sub','f1640000-0000-4000-8000-000000000003',true);
do $$
declare v_group jsonb;
begin
  v_group := public.create_appointment_group('f1641000-0000-4000-8000-000000000002','f1604-group-b','Zeynep B',
    '[{"serviceId":"f1644000-0000-4000-8000-000000000002","staffId":"f1645000-0000-4000-8000-000000000002"}]'::jsonb,
    ((current_date + 7) + time '10:00') at time zone 'Europe/Istanbul','05551604003',null);
  perform set_config('f1604.group_b', v_group->>'groupId', false);
end
$$;
reset role;

-- Management capabilities (the customer's only authority) and a completed group.
insert into public.appointment_management_capabilities(appointment_id, business_id, group_id, token_hash)
select a.id, a.business_id, a.group_id, public.management_token_hash(t.token)
from (values
  (current_setting('f1604.group_done')::uuid, repeat('D', 43)),
  (current_setting('f1604.group_open')::uuid, repeat('O', 43)),
  (current_setting('f1604.group_b')::uuid, repeat('B', 43))
) t(group_id, token)
join public.appointments a on a.group_id = t.group_id;
update public.appointment_groups set status = 'completed' where id = current_setting('f1604.group_done')::uuid;

-- Gateway helper: all public calls go through the gated sibling operation.
create or replace function pg_temp.fb(p_action text, p_args jsonb, p_actor text default 'a')
returns jsonb language sql as $$
  select public.execute_public_feedback_operation(
    p_action, p_args, 'f1604-feedback-gate-secret-000000000000000000',
    encode(extensions.digest('f1604-actor-' || p_actor, 'sha256'), 'hex'),
    encode(extensions.digest('f1604-network-' || p_actor, 'sha256'), 'hex'));
$$;

do $$
declare
  v jsonb;
begin
  -- Wrong gate secret and unknown actions stay closed.
  v := public.execute_public_feedback_operation('reviews', '{"p_slug":"f1604-salon-a"}', 'wrong-secret',
    repeat('a', 64), repeat('b', 64));
  if v->'error'->>'message' <> 'PUBLIC_BOOKING_GATE_UNAVAILABLE' then raise exception 'F16-04 wrong gate accepted: %', v; end if;
  v := pg_temp.fb('manage_view', '{"p_token":"x"}');
  if v->'error'->>'message' <> 'INVALID_PUBLIC_OPERATION' then raise exception 'F16-04 foreign action accepted: %', v; end if;

  -- Guessed / unknown capability cannot read or write feedback.
  v := pg_temp.fb('manage_feedback_view', jsonb_build_object('p_token', repeat('Z', 43)), 'guess');
  if v->'error'->>'message' <> 'MANAGEMENT_NOT_FOUND' then raise exception 'F16-04 guessed token view: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('Z', 43), 'p_rating', 5, 'p_comment', 'x', 'p_publish_consent', true), 'guess');
  if v->'error'->>'message' <> 'MANAGEMENT_NOT_FOUND' then raise exception 'F16-04 guessed token submit: %', v; end if;

  -- Not yet completed appointments are not eligible.
  v := pg_temp.fb('manage_feedback_view', jsonb_build_object('p_token', repeat('O', 43)), 'open');
  if (v->'data'->0->>'eligible')::boolean or v->'data'->0->>'reason' <> 'not_completed' then raise exception 'F16-04 open group eligibility: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('O', 43), 'p_rating', 4, 'p_comment', null, 'p_publish_consent', true), 'open');
  if v->'error'->>'message' <> 'FEEDBACK_NOT_ELIGIBLE' then raise exception 'F16-04 open group submit: %', v; end if;

  -- Input validation.
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', 6, 'p_comment', 'x', 'p_publish_consent', true), 'bad');
  if v->'error'->>'message' <> 'INVALID_FEEDBACK' then raise exception 'F16-04 rating 6: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', '5', 'p_comment', 'x', 'p_publish_consent', true), 'bad');
  if v->'error'->>'message' <> 'INVALID_FEEDBACK' then raise exception 'F16-04 string rating: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', 5, 'p_comment', repeat('x', 1001), 'p_publish_consent', true), 'bad');
  if v->'error'->>'message' <> 'INVALID_FEEDBACK' then raise exception 'F16-04 long comment: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', 5, 'p_comment', 'x'), 'bad');
  if v->'error'->>'message' <> 'INVALID_FEEDBACK' then raise exception 'F16-04 missing consent: %', v; end if;

  -- Completed appointment: eligible, submit, exact replay, divergent resubmission refused.
  v := pg_temp.fb('manage_feedback_view', jsonb_build_object('p_token', repeat('D', 43)), 'done');
  if not (v->'data'->0->>'eligible')::boolean then raise exception 'F16-04 completed group not eligible: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', 5, 'p_comment', '  Harika bir deneyim  ', 'p_publish_consent', true), 'done');
  if v->'data'->0->>'status' <> 'pending' or v->'data'->0->>'comment' <> 'Harika bir deneyim' then raise exception 'F16-04 submit result: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', 5, 'p_comment', 'Harika bir deneyim', 'p_publish_consent', true), 'done');
  if v->>'ok' <> 'true' then raise exception 'F16-04 exact replay refused: %', v; end if;
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('D', 43), 'p_rating', 1, 'p_comment', 'Değiştirdim', 'p_publish_consent', true), 'done');
  if v->'error'->>'message' <> 'FEEDBACK_ALREADY_SUBMITTED' then raise exception 'F16-04 duplicate review accepted: %', v; end if;
  if (select count(*) from public.appointment_feedback where appointment_group_id = current_setting('f1604.group_done')::uuid) <> 1 then
    raise exception 'F16-04 duplicate feedback rows';
  end if;
  if (select display_name from public.appointment_feedback where appointment_group_id = current_setting('f1604.group_done')::uuid) <> 'Ayşe D.' then
    raise exception 'F16-04 display name not masked';
  end if;

  -- Pending (unmoderated) feedback is never public.
  v := pg_temp.fb('reviews', '{"p_slug":"f1604-salon-a"}', 'reader');
  if jsonb_array_length(v->'data') <> 0 then raise exception 'F16-04 pending review leaked: %', v; end if;
  v := pg_temp.fb('reviews', '{"p_slug":"f1604-salon-b"}', 'reader');
  if v->'error'->>'message' <> 'PUBLIC_BOOKING_NOT_FOUND' then raise exception 'F16-04 unpublished salon reviews: %', v; end if;
end
$$;

-- A second completed review without consent can never be published.
update public.appointment_groups set status = 'completed' where id = current_setting('f1604.group_open')::uuid;
do $$
declare v jsonb;
begin
  v := pg_temp.fb('manage_feedback_submit', jsonb_build_object('p_token', repeat('O', 43), 'p_rating', 3, 'p_comment', 'Özel not: telefonum 05551604002', 'p_publish_consent', false), 'open2');
  if v->'data'->0->>'status' <> 'pending' then raise exception 'F16-04 private feedback submit: %', v; end if;
end
$$;

-- Business side: members list, only owner/manager moderates, CAS on status.
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1640000-0000-4000-8000-000000000002',true);
do $$
declare
  v_count integer;
  v_row record;
begin
  select count(*) into v_count from public.list_business_feedback('f1641000-0000-4000-8000-000000000001');
  if v_count <> 2 then raise exception 'F16-04 staff list count %', v_count; end if;
  select * into v_row from public.list_business_feedback('f1641000-0000-4000-8000-000000000001') where rating = 5;
  if v_row.customer_name <> 'Ayşe Nur Demir' or v_row.service_names <> 'F16 Kesim' or v_row.can_moderate then
    raise exception 'F16-04 staff projection wrong: %', row_to_json(v_row);
  end if;
  perform set_config('f1604.feedback_public', v_row.id::text, false);
  select id into v_row from public.list_business_feedback('f1641000-0000-4000-8000-000000000001') where rating = 3;
  perform set_config('f1604.feedback_private', v_row.id::text, false);
  begin
    perform public.moderate_business_feedback('f1641000-0000-4000-8000-000000000001', current_setting('f1604.feedback_public')::uuid, 'publish', 'pending');
    raise exception 'staff moderated feedback';
  exception when others then
    if sqlerrm <> 'NOT_ALLOWED' then raise exception 'F16-04 staff moderate used %', sqlerrm; end if;
  end;
end
$$;
select set_config('request.jwt.claim.sub','f1640000-0000-4000-8000-000000000003',true);
do $$
begin
  begin
    perform public.list_business_feedback('f1641000-0000-4000-8000-000000000001');
    raise exception 'foreign owner listed feedback';
  exception when others then
    if sqlerrm <> 'NOT_ALLOWED' then raise exception 'F16-04 foreign list used %', sqlerrm; end if;
  end;
  begin
    perform public.moderate_business_feedback('f1641000-0000-4000-8000-000000000002', current_setting('f1604.feedback_public')::uuid, 'publish', 'pending');
    raise exception 'foreign owner moderated another tenant feedback';
  exception when others then
    if sqlerrm <> 'FEEDBACK_NOT_FOUND' then raise exception 'F16-04 foreign moderate used %', sqlerrm; end if;
  end;
end
$$;
select set_config('request.jwt.claim.sub','f1640000-0000-4000-8000-000000000001',true);
do $$
declare v_row record;
begin
  begin
    perform public.moderate_business_feedback('f1641000-0000-4000-8000-000000000001', current_setting('f1604.feedback_private')::uuid, 'publish', 'pending');
    raise exception 'feedback without consent published';
  exception when others then
    if sqlerrm <> 'FEEDBACK_CONSENT_MISSING' then raise exception 'F16-04 consentless publish used %', sqlerrm; end if;
  end;
  begin
    perform public.moderate_business_feedback('f1641000-0000-4000-8000-000000000001', current_setting('f1604.feedback_public')::uuid, 'publish', 'hidden');
    raise exception 'stale moderation accepted';
  exception when others then
    if sqlerrm <> 'FEEDBACK_STATE_CONFLICT' then raise exception 'F16-04 stale CAS used %', sqlerrm; end if;
  end;
  select * into v_row from public.moderate_business_feedback('f1641000-0000-4000-8000-000000000001', current_setting('f1604.feedback_public')::uuid, 'publish', 'pending');
  if v_row.status <> 'published' or v_row.published_at is null then raise exception 'F16-04 publish failed'; end if;
  perform public.moderate_business_feedback('f1641000-0000-4000-8000-000000000001', current_setting('f1604.feedback_private')::uuid, 'hide', 'pending');
end
$$;
reset role;

do $$
declare v jsonb;
begin
  v := pg_temp.fb('reviews', '{"p_slug":"f1604-salon-a"}', 'reader2');
  if jsonb_array_length(v->'data') <> 1
     or v->'data'->0->>'display_name' <> 'Ayşe D.'
     or (v->'data'->0->>'rating')::integer <> 5
     or (v->'data'->0->>'total_count')::integer <> 1
     or (v->'data'->0->>'average_rating')::numeric <> 5.0 then
    raise exception 'F16-04 public reviews wrong: %', v;
  end if;
  if v::text ~ '(05551604|example\.invalid|Demir|Mehmet|telefonum)' then
    raise exception 'F16-04 public reviews leaked personal data: %', v;
  end if;
  -- The customer sees the moderation outcome through their own link only.
  v := pg_temp.fb('manage_feedback_view', jsonb_build_object('p_token', repeat('D', 43)), 'done');
  if v->'data'->0->>'status' <> 'published' or v->'data'->0->>'reason' <> 'submitted' then raise exception 'F16-04 customer view after publish: %', v; end if;
end
$$;

-- Hide takes a published review back out of the public list.
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1640000-0000-4000-8000-000000000001',true);
select 1 from public.moderate_business_feedback('f1641000-0000-4000-8000-000000000001', current_setting('f1604.feedback_public')::uuid, 'hide', 'published');
reset role;
do $$
declare v jsonb;
begin
  v := pg_temp.fb('reviews', '{"p_slug":"f1604-salon-a"}', 'reader3');
  if jsonb_array_length(v->'data') <> 0 then raise exception 'F16-04 hidden review still public: %', v; end if;
  if exists(select 1 from public.appointment_feedback where status = 'published' and not publish_consent) then
    raise exception 'F16-04 consent invariant broken';
  end if;
end
$$;

select 'F16-04 feedback and reviews acceptance passed' as result;
commit;
