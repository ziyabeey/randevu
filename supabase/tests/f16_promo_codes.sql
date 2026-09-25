begin;

-- F16-06 promo codes: definitions, public preview, capability reservation at
-- booking, quota, release on cancel/no-show, ticket application, one code per
-- ticket, scope/package/manual-discount interplay, round-down percentages,
-- never-negative totals, consumption snapshot with per-line allocation, the
-- promo-aware payment guard, immutability and the day report.

delete from public.public_booking_rate_counters;
delete from public.public_booking_abuse_config where config_key = 'default';
insert into public.public_booking_abuse_config(config_key, gate_secret_hash)
values ('default', encode(extensions.digest('f1606-promo-gate-secret-0000000000000000000000', 'sha256'), 'hex'));

create temporary table f1606_ids(name text primary key, id uuid not null) on commit drop;
grant all on f1606_ids to authenticated;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1670000-0000-4000-8000-000000000001','f1606-owner@example.invalid','{}'::jsonb),
  ('f1670000-0000-4000-8000-000000000002','f1606-staff@example.invalid','{}'::jsonb),
  ('f1670000-0000-4000-8000-000000000003','f1606-report@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1671000-0000-4000-8000-000000000001','F16-06 Salon A','f1606-salon-a','Europe/Istanbul','f1670000-0000-4000-8000-000000000001'),
  ('f1671000-0000-4000-8000-000000000003','F16-06 Report Salon','f1606-report-salon','Europe/Istanbul','f1670000-0000-4000-8000-000000000003');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1672000-0000-4000-8000-000000000001','f1671000-0000-4000-8000-000000000001','f1670000-0000-4000-8000-000000000001','owner',true),
  ('f1672000-0000-4000-8000-000000000002','f1671000-0000-4000-8000-000000000001','f1670000-0000-4000-8000-000000000002','staff',true),
  ('f1672000-0000-4000-8000-000000000003','f1671000-0000-4000-8000-000000000003','f1670000-0000-4000-8000-000000000003','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('f1674000-0000-4000-8000-000000000001','f1671000-0000-4000-8000-000000000001','Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true),
  ('f1674000-0000-4000-8000-000000000002','f1671000-0000-4000-8000-000000000001','Boya',30,0,0,'Genel',20,20000,'range',20000,40000,'TRY',true),
  ('f1674000-0000-4000-8000-000000000003','f1671000-0000-4000-8000-000000000003','Rapor Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true);
insert into public.staff_profiles(id,business_id,name,active)
values ('f1675000-0000-4000-8000-000000000001','f1671000-0000-4000-8000-000000000001','Ayla',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('f1671000-0000-4000-8000-000000000001','f1675000-0000-4000-8000-000000000001','f1674000-0000-4000-8000-000000000001',true),
  ('f1671000-0000-4000-8000-000000000001','f1675000-0000-4000-8000-000000000001','f1674000-0000-4000-8000-000000000002',true);
insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'f1671000-0000-4000-8000-000000000001', d, time '09:00', time '18:00', true from generate_series(0,6) d;
insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'f1671000-0000-4000-8000-000000000001','f1675000-0000-4000-8000-000000000001', d, time '09:00', time '18:00', true
from generate_series(0,6) d;
insert into public.business_public_profiles(business_id, public_phone)
values ('f1671000-0000-4000-8000-000000000001','+905551606000')
on conflict (business_id) do update set public_phone = excluded.public_phone;
insert into public.public_booking_settings(business_id,enabled,step_minutes,min_notice_minutes,horizon_days)
values ('f1671000-0000-4000-8000-000000000001',true,15,0,30)
on conflict(business_id) do update set enabled=true;

-- ACL ------------------------------------------------------------------------------
do $acl$
declare v_sig text;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('promo_codes','promo_redemptions','promo_redemption_lines')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then raise exception 'F16-06 promo tables must force RLS'; end if;
  foreach v_sig in array array['public.promo_codes','public.promo_redemptions','public.promo_redemption_lines'] loop
    if has_table_privilege('anon', v_sig, 'SELECT') or has_table_privilege('authenticated', v_sig, 'SELECT')
       or has_table_privilege('authenticated', v_sig, 'INSERT') then
      raise exception 'F16-06 % reachable through the Data API', v_sig;
    end if;
  end loop;
  if not has_function_privilege('anon','public.execute_public_promo_operation(text,jsonb,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.execute_public_promo_operation(text,jsonb,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.attach_public_managed_promo(text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.attach_public_managed_promo(text,text)','EXECUTE')
     or has_function_privilege('anon','public.get_public_promo_preview(text,text,uuid[])','EXECUTE')
     or has_function_privilege('authenticated','public.f16_reserve_promo(uuid,text,uuid,text,uuid,uuid,uuid[],uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.f16_ticket_money(uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.apply_ticket_promo_guarded(uuid,uuid,text,integer,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.remove_ticket_promo_guarded(uuid,uuid,text,integer,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.create_promo_code_guarded(uuid,uuid,text,text,integer,integer,timestamptz,timestamptz,integer,uuid[])','EXECUTE')
     or has_function_privilege('anon','public.list_promo_codes(uuid)','EXECUTE') then
    raise exception 'F16-06 function grants are wrong';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname <> 'execute_public_promo_operation'
      and (p.proname like '%promo%' or p.proname in ('f16_ticket_money','f16_ticket_total_minor','f16_public_business_id'))
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  ) then raise exception 'F16-06 SECURITY DEFINER function without empty search_path'; end if;
  if public.f16_promo_amount('percent', 2000, null, 14999) <> 2999
     or public.f16_promo_amount('fixed', null, 100000, 15000) <> 15000
     or public.f16_promo_amount('percent', 10000, null, 0) <> 0 then
    raise exception 'F16-06 promo amount rounding/cap wrong';
  end if;
end
$acl$;

-- Definitions ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
do $defs$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000001';
  v jsonb;
  v_replay jsonb;
begin
  v := public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000001',' yaz20 ','percent',2000,null,
    now() - interval '1 day', now() + interval '30 days', 2, '{}'::uuid[]);
  if v->>'code' <> 'YAZ20' or (v->>'percentBps')::int <> 2000 or (v->>'usageLimit')::int <> 2 or v->>'currency' <> 'TRY' then
    raise exception 'F16-06 percent code wrong: %', v;
  end if;
  v_replay := public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000001','YAZ20','percent',2000,null,
    (v->>'startsAt')::timestamptz, (v->>'endsAt')::timestamptz, 2, '{}'::uuid[]);
  if v_replay <> v then raise exception 'F16-06 create replay changed result'; end if;

  perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000002','KESIM50','fixed',null,5000,
    now() - interval '1 day', null, null, array['f1674000-0000-4000-8000-000000000001']::uuid[]);
  perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000003','GELECEK','percent',1000,null,
    now() + interval '1 day', null, null, '{}'::uuid[]);
  perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000004','BITTI','percent',1000,null,
    now() - interval '10 days', now() - interval '1 day', null, '{}'::uuid[]);
  perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000005','BUYUK','fixed',null,100000,
    now() - interval '1 day', null, null, array['f1674000-0000-4000-8000-000000000001']::uuid[]);
  perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000006','YARI','percent',5000,null,
    now() - interval '1 day', null, null, '{}'::uuid[]);

  begin
    perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-0000000000ff','yaz20','fixed',null,100,
      now(), null, null, '{}'::uuid[]);
    raise exception 'F16-06 duplicate code accepted';
  exception when others then if sqlerrm <> 'PROMO_CODE_TAKEN' then raise; end if;
  end;
  begin
    perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-0000000000fe','SIFIR','percent',0,null,
      now(), null, null, '{}'::uuid[]);
    raise exception 'F16-06 zero percent accepted';
  exception when others then if sqlerrm <> 'INVALID_PROMO' then raise; end if;
  end;
  begin
    perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-0000000000fd','YABANCI','percent',1000,null,
      now(), null, null, array['f1674000-0000-4000-8000-000000000003']::uuid[]);
    raise exception 'F16-06 foreign service scope accepted';
  exception when others then if sqlerrm <> 'SERVICE_NOT_FOUND' then raise; end if;
  end;
  if jsonb_array_length(public.list_promo_codes(v_business)) <> 6 then raise exception 'F16-06 promo list wrong'; end if;
end
$defs$;

select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000002',true);
do $staff$
begin
  perform public.create_promo_code_guarded('f1671000-0000-4000-8000-000000000001','f1676000-0000-4000-8000-0000000000fc','STAFF','percent',1000,null,
    now(), null, null, '{}'::uuid[]);
  raise exception 'F16-06 staff created a promo';
exception when others then if sqlerrm <> 'FINANCIAL_PERMISSION_REQUIRED' then raise; end if;
end
$staff$;

-- Appointment groups with management capabilities --------------------------------------
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
do $groups$
declare
  v_group jsonb;
  v_name text;
  v_service text;
  v_hour integer := 9;
begin
  foreach v_name in array array['g1','g2','g3','g4','g5','g6'] loop
    v_service := case when v_name = 'g4' then 'f1674000-0000-4000-8000-000000000002' else 'f1674000-0000-4000-8000-000000000001' end;
    v_group := public.create_appointment_group('f1671000-0000-4000-8000-000000000001','f1606-'||v_name,'Müşteri '||upper(v_name),
      jsonb_build_array(jsonb_build_object('serviceId',v_service,'staffId','f1675000-0000-4000-8000-000000000001')),
      ((current_date + 7) + make_time(v_hour, 0, 0)) at time zone 'Europe/Istanbul','0555160600'||right(v_name,1),null);
    insert into f1606_ids values (v_name, (v_group->>'groupId')::uuid);
    v_hour := v_hour + 1;
  end loop;
end
$groups$;
reset role;
insert into public.appointment_management_capabilities(appointment_id, business_id, group_id, token_hash)
select a.id, a.business_id, a.group_id, public.management_token_hash(repeat(upper(right(i.name,1)), 43))
from f1606_ids i join public.appointments a on a.group_id = i.id
where i.name like 'g_';
update public.appointment_groups set status = 'completed' where id = (select id from f1606_ids where name = 'g5');
insert into f1606_ids select 'c6', g.customer_id from public.appointment_groups g where g.id = (select id from f1606_ids where name = 'g6');

create or replace function pg_temp.pr(p_action text, p_args jsonb, p_actor text default 'a')
returns jsonb language sql as $$
  select public.execute_public_promo_operation(
    p_action, p_args, 'f1606-promo-gate-secret-0000000000000000000000',
    encode(extensions.digest('f1606-actor-' || p_actor, 'sha256'), 'hex'),
    encode(extensions.digest('f1606-network-' || p_actor, 'sha256'), 'hex'));
$$;

-- Public preview and capability reservation ----------------------------------------------
do $public$
declare
  v jsonb;
  v_kesim text := 'f1674000-0000-4000-8000-000000000001';
begin
  v := public.execute_public_promo_operation('promo_preview', '{"p_slug":"f1606-salon-a","p_code":"YAZ20"}', 'wrong',
    repeat('a',64), repeat('b',64));
  if v->'error'->>'message' <> 'PUBLIC_BOOKING_GATE_UNAVAILABLE' then raise exception 'F16-06 wrong gate accepted: %', v; end if;
  v := pg_temp.pr('group_book', '{}'::jsonb);
  if v->'error'->>'message' <> 'INVALID_PUBLIC_OPERATION' then raise exception 'F16-06 unknown action: %', v; end if;

  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-salon-a','p_code','yaz20','p_service_ids',jsonb_build_array(v_kesim)));
  if not (v->>'ok')::boolean or v->'data'->0->>'kind' <> 'percent' or (v->'data'->0->>'percent_bps')::int <> 2000
     or not (v->'data'->0->>'applicable')::boolean or v->'data'->0 ? 'usage_limit' then
    raise exception 'F16-06 preview wrong: %', v;
  end if;
  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-salon-a','p_code','KESIM50','p_service_ids',jsonb_build_array('f1674000-0000-4000-8000-000000000002')));
  if (v->'data'->0->>'applicable')::boolean or not (v->'data'->0->>'scoped')::boolean then raise exception 'F16-06 scoped preview wrong: %', v; end if;
  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-salon-a','p_code','GELECEK'));
  if v->'error'->>'message' <> 'PROMO_NOT_STARTED' then raise exception 'F16-06 future code: %', v; end if;
  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-salon-a','p_code','BITTI'));
  if v->'error'->>'message' <> 'PROMO_EXPIRED' then raise exception 'F16-06 expired code: %', v; end if;
  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-salon-a','p_code','YOKBOYLE'));
  if v->'error'->>'message' <> 'PROMO_NOT_FOUND' then raise exception 'F16-06 unknown code: %', v; end if;
  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-salon-a','p_code','YAZ20','p_service_ids',jsonb_build_array('not-a-uuid')));
  if v->'error'->>'message' <> 'INVALID_PUBLIC_OPERATION' then raise exception 'F16-06 bad service id: %', v; end if;
  v := pg_temp.pr('promo_preview', jsonb_build_object('p_slug','f1606-report-salon','p_code','YAZ20'));
  if v->'error'->>'message' <> 'PUBLIC_BOOKING_NOT_FOUND' then raise exception 'F16-06 unpublished salon: %', v; end if;

  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('Z', 43), 'p_code', 'YAZ20'), 'guess');
  if v->'error'->>'message' <> 'MANAGEMENT_NOT_FOUND' then raise exception 'F16-06 guessed token: %', v; end if;

  v := pg_temp.pr('manage_promo_view', jsonb_build_object('p_token', repeat('1', 43)));
  if v->'data'->0->>'code' is not null or not (v->'data'->0->>'attachable')::boolean then raise exception 'F16-06 empty view: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('1', 43), 'p_code', ' yaz20'));
  if v->'data'->0->>'code' <> 'YAZ20' or v->'data'->0->>'status' <> 'reserved' then raise exception 'F16-06 attach: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('1', 43), 'p_code', 'YAZ20'));
  if v->'data'->0->>'code' <> 'YAZ20' then raise exception 'F16-06 same-code re-attach not idempotent: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('1', 43), 'p_code', 'KESIM50'));
  if v->'error'->>'message' <> 'PROMO_ALREADY_APPLIED' then raise exception 'F16-06 second code on group: %', v; end if;

  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('2', 43), 'p_code', 'YAZ20'));
  if v->'data'->0->>'status' <> 'reserved' then raise exception 'F16-06 second slot: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('3', 43), 'p_code', 'YAZ20'));
  if v->'error'->>'message' <> 'PROMO_EXHAUSTED' then raise exception 'F16-06 usage limit not enforced: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('4', 43), 'p_code', 'KESIM50'));
  if v->'error'->>'message' <> 'PROMO_NOT_APPLICABLE' then raise exception 'F16-06 out-of-scope booking: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('5', 43), 'p_code', 'KESIM50'));
  if v->'error'->>'message' <> 'PROMO_NOT_ATTACHABLE' then raise exception 'F16-06 completed group attach: %', v; end if;
end
$public$;

-- Cancelling a booking gives its slot back; no-show does too.
update public.appointment_groups set status = 'cancelled' where id = (select id from f1606_ids where name = 'g2');
do $release$
declare v jsonb;
begin
  if (select status from public.promo_redemptions where appointment_group_id = (select id from f1606_ids where name = 'g2')) <> 'released' then
    raise exception 'F16-06 cancelled booking kept its reservation';
  end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('3', 43), 'p_code', 'YAZ20'));
  if v->'data'->0->>'status' <> 'reserved' then raise exception 'F16-06 released slot not reusable: %', v; end if;
end
$release$;
update public.appointment_groups set status = 'no_show' where id = (select id from f1606_ids where name = 'g3');
do $noshow$
begin
  if (select status from public.promo_redemptions where appointment_group_id = (select id from f1606_ids where name = 'g3')) <> 'released'
     or (select release_reason from public.promo_redemptions where appointment_group_id = (select id from f1606_ids where name = 'g3')) <> 'Randevuya gelinmedi' then
    raise exception 'F16-06 no-show kept its reservation';
  end if;
end
$noshow$;

-- Terms are snapshotted: editing the code does not change a reserved discount.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
do $snapshot$
declare v jsonb := (select public.list_promo_codes('f1671000-0000-4000-8000-000000000001') -> 0);
begin
  select x into v from jsonb_array_elements(public.list_promo_codes('f1671000-0000-4000-8000-000000000001')) x where x->>'code' = 'YAZ20';
  if (v->>'reservedCount')::int <> 1 then raise exception 'F16-06 reserved count wrong: %', v; end if;
  perform public.update_promo_code_guarded('f1671000-0000-4000-8000-000000000001', (v->>'promoId')::uuid, (v->>'version')::int,
    5000, null, (v->>'startsAt')::timestamptz, (v->>'endsAt')::timestamptz, 2, '{}'::uuid[], true);
end
$snapshot$;

-- Booking reservation carried to the ticket and consumed at close ---------------------------
do $booking_ticket$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_line uuid;
  v_pkg jsonb;
begin
  v_ticket := public.open_ticket_from_booking_group_guarded(v_business,(select id from f1606_ids where name = 'g1'),'f1606-open-g1',repeat('1',64));
  v_line := (v_ticket->'lines'->0->>'lineId')::uuid;
  insert into f1606_ids values ('t1', (v_ticket->>'ticketId')::uuid), ('t1_line', v_line);
  if v_ticket->'promo'->>'code' <> 'YAZ20' or (v_ticket->'promo'->>'percentBps')::int <> 2000
     or (v_ticket->>'promoDiscountMinor')::bigint <> 3000 or (v_ticket->>'totalMinor')::bigint <> 12000 then
    raise exception 'F16-06 booking promo not on ticket (snapshot 20%%): %', v_ticket;
  end if;

  -- A package sale and a package-covered session are never discounted.
  perform public.create_service_package_guarded(v_business,'f1676000-0000-4000-8000-000000000101',
    'f1674000-0000-4000-8000-000000000001','3 Kesim',3,30,30000);
  v_ticket := public.add_ticket_package_line_guarded(v_business,(v_ticket->>'ticketId')::uuid,
    'f1676000-0000-4000-8000-000000000101',(v_ticket->>'version')::int,1,'f1606-t1-pkg',repeat('2',64));
  v_pkg := v_ticket->'lines'->1->'soldPackage';
  v_ticket := public.add_ticket_service_line_guarded(v_business,(v_ticket->>'ticketId')::uuid,
    'f1674000-0000-4000-8000-000000000001',null,(v_ticket->>'version')::int,'f1606-t1-add',repeat('3',64));
  v_ticket := public.apply_ticket_package_guarded(v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->'lines'->2->>'lineId')::uuid,
    (v_pkg->>'customerPackageId')::uuid,(v_ticket->>'version')::int,'f1606-t1-cover',repeat('4',64));
  if (v_ticket->>'promoDiscountMinor')::bigint <> 3000 or (v_ticket->>'totalMinor')::bigint <> 42000 then
    raise exception 'F16-06 promo touched package sale or covered line: %', v_ticket;
  end if;

  -- Manual discount first, then the percentage rounds down to the minor unit.
  v_ticket := public.set_ticket_service_discount_guarded(v_business,(v_ticket->>'ticketId')::uuid,v_line,1,'Kuruş',
    (v_ticket->>'version')::int,'f1606-t1-disc',repeat('5',64));
  if (v_ticket->>'promoDiscountMinor')::bigint <> 2999 or (v_ticket->>'totalMinor')::bigint <> 42000 then
    raise exception 'F16-06 round-down promo wrong: %', v_ticket;
  end if;

  -- The business cannot stack a second code.
  begin
    perform public.apply_ticket_promo_guarded(v_business,(v_ticket->>'ticketId')::uuid,'KESIM50',(v_ticket->>'version')::int,'f1606-t1-second',repeat('6',64));
    raise exception 'F16-06 second code on ticket accepted';
  exception when others then if sqlerrm <> 'PROMO_ALREADY_APPLIED' then raise; end if;
  end;

  v_ticket := public.record_ticket_payment_guarded(v_business,(v_ticket->>'ticketId')::uuid,'cash',42000,'f1606-t1-pay',repeat('7',64));
  -- A discount that would push the promo-aware total below the paid amount is refused.
  begin
    perform public.set_ticket_service_discount_guarded(v_business,(v_ticket->>'ticketId')::uuid,v_line,5000,'Fazla',
      (v_ticket->>'version')::int,'f1606-t1-disc-over',repeat('8',64));
    raise exception 'F16-06 discount below paid accepted';
  exception when others then if sqlerrm <> 'TICKET_TOTAL_BELOW_PAID' then raise; end if;
  end;
  v_ticket := public.close_ticket_guarded(v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->>'version')::int,'f1606-t1-close',repeat('9',64));
  if v_ticket->'promo'->>'status' <> 'consumed' or (v_ticket->>'promoDiscountMinor')::bigint <> 2999
     or (v_ticket->'lines'->0->>'promoDiscountMinor')::int <> 2999 then
    raise exception 'F16-06 consumption snapshot wrong: %', v_ticket;
  end if;
end
$booking_ticket$;

-- A ticket opened before the customer attaches a code closes the booking-side
-- attach: the customer link can no longer change ticket money (R1-B1), and a
-- staff code on that ticket cannot meet a second booking code (R1-B2).
do $late_attach_open$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000001';
  v_ticket jsonb;
begin
  v_ticket := public.open_ticket_from_booking_group_guarded(v_business,(select id from f1606_ids where name = 'g6'),'f1606-open-g6',repeat('c',63)||'1');
  v_ticket := public.record_ticket_payment_guarded(v_business,(v_ticket->>'ticketId')::uuid,'cash',15000,'f1606-g6-pay',repeat('c',63)||'3');
  insert into f1606_ids values ('t6', (v_ticket->>'ticketId')::uuid);
  perform set_config('f1606.t6_version', v_ticket->>'version', true);
end
$late_attach_open$;
reset role;
do $late_attach$
declare
  v jsonb;
  v_t6 uuid := (select id from f1606_ids where name = 't6');
begin
  v := pg_temp.pr('manage_promo_view', jsonb_build_object('p_token', repeat('6', 43)));
  if (v->'data'->0->>'attachable')::boolean then raise exception 'F16-06 attach offered after the ticket opened: %', v; end if;
  v := pg_temp.pr('manage_promo_attach', jsonb_build_object('p_token', repeat('6', 43), 'p_code', 'KESIM50'));
  if v->'error'->>'message' <> 'PROMO_NOT_ATTACHABLE' then raise exception 'F16-06 attach after ticket open: %', v; end if;
  if exists (select 1 from public.promo_redemptions r where r.appointment_group_id = (select id from f1606_ids where name = 'g6') or r.ticket_id = v_t6) then
    raise exception 'F16-06 late attach reserved a code';
  end if;
  if (select version from public.tickets where id = v_t6) <> current_setting('f1606.t6_version')::int
     or public.f16_ticket_total_minor('f1671000-0000-4000-8000-000000000001', v_t6) <> 15000 then
    raise exception 'F16-06 late attach changed the paid ticket';
  end if;
end
$late_attach$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);

-- Ticket-applied codes: scope, fixed cap, removal, allocation remainder, payment guard ------
do $ticket_codes$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_t2 uuid;
begin
  v_ticket := public.open_walk_in_ticket_guarded(v_business,(select id from f1606_ids where name = 'c6'),
    'f1606-t2-open',repeat('a',64));
  v_t2 := (v_ticket->>'ticketId')::uuid;
  insert into f1606_ids values ('t2', v_t2);
  v_ticket := public.add_ticket_service_line_guarded(v_business,v_t2,'f1674000-0000-4000-8000-000000000001',null,(v_ticket->>'version')::int,'f1606-t2-add1',repeat('b',64));
  v_ticket := public.add_ticket_service_line_guarded(v_business,v_t2,'f1674000-0000-4000-8000-000000000002',null,(v_ticket->>'version')::int,'f1606-t2-add2',repeat('c',64));
  v_ticket := public.finalize_ticket_service_price_guarded(v_business,v_t2,(v_ticket->'lines'->1->>'lineId')::uuid,20000,'Kısa boya',
    (v_ticket->>'version')::int,'f1606-t2-final',repeat('d',64));

  v_ticket := public.apply_ticket_promo_guarded(v_business,v_t2,'kesim50',(v_ticket->>'version')::int,'f1606-t2-apply',repeat('e',64));
  if (v_ticket->>'promoDiscountMinor')::bigint <> 5000 or (v_ticket->>'totalMinor')::bigint <> 30000 or v_ticket->'promo'->>'source' <> 'ticket' then
    raise exception 'F16-06 scoped fixed promo wrong: %', v_ticket;
  end if;
  v_ticket := public.remove_ticket_promo_guarded(v_business,v_t2,'Yanlış kod',(v_ticket->>'version')::int,'f1606-t2-remove',repeat('f',64));
  if v_ticket->'promo' <> 'null'::jsonb or (v_ticket->>'totalMinor')::bigint <> 35000 then raise exception 'F16-06 removal wrong: %', v_ticket; end if;

  -- A fixed amount larger than the eligible lines never makes the total negative.
  v_ticket := public.apply_ticket_promo_guarded(v_business,v_t2,'BUYUK',(v_ticket->>'version')::int,'f1606-t2-big',repeat('0',63)||'1');
  if (v_ticket->>'promoDiscountMinor')::bigint <> 15000 or (v_ticket->>'totalMinor')::bigint <> 20000 then
    raise exception 'F16-06 fixed cap wrong: %', v_ticket;
  end if;
  v_ticket := public.remove_ticket_promo_guarded(v_business,v_t2,'Başka kod',(v_ticket->>'version')::int,'f1606-t2-remove2',repeat('0',63)||'2');

  -- 50% of 15.000 + 20.000 = 17.500, allocated 7.500 / 10.000.
  v_ticket := public.apply_ticket_promo_guarded(v_business,v_t2,'YARI',(v_ticket->>'version')::int,'f1606-t2-half',repeat('0',63)||'3');
  if (v_ticket->>'promoDiscountMinor')::bigint <> 17500 then raise exception 'F16-06 half promo wrong: %', v_ticket; end if;
  v_ticket := public.record_ticket_payment_guarded(v_business,v_t2,'card',17500,'f1606-t2-pay',repeat('0',63)||'4');
  -- Removing the promo raises the total: allowed; applying one below paid is not.
  v_ticket := public.remove_ticket_promo_guarded(v_business,v_t2,'Kampanya iptal',(v_ticket->>'version')::int,'f1606-t2-remove3',repeat('0',63)||'5');
  v_ticket := public.record_ticket_payment_guarded(v_business,v_t2,'card',17500,'f1606-t2-pay2',repeat('0',63)||'6');
  begin
    perform public.apply_ticket_promo_guarded(v_business,v_t2,'YARI',(v_ticket->>'version')::int,'f1606-t2-late',repeat('0',63)||'7');
    raise exception 'F16-06 promo below paid accepted';
  exception when others then if sqlerrm <> 'TICKET_TOTAL_BELOW_PAID' then raise; end if;
  end;

  -- Staff without pricing permission cannot apply codes.
  perform set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000002',true);
  begin
    perform public.apply_ticket_promo_guarded(v_business,v_t2,'YARI',(v_ticket->>'version')::int,'f1606-t2-staff',repeat('0',63)||'8');
    raise exception 'F16-06 staff applied a promo';
  exception when others then if sqlerrm <> 'FINANCIAL_PERMISSION_REQUIRED' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
end
$ticket_codes$;

-- Rounding remainder allocation: 50% of 10.000 + 5.001 = 7.500 -> 5.000 + 2.500.
do $allocation$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_id uuid;
begin
  v_ticket := public.open_walk_in_ticket_guarded(v_business,(select id from f1606_ids where name = 'c6'),
    'f1606-t3-open',repeat('1',63)||'a');
  v_id := (v_ticket->>'ticketId')::uuid;
  v_ticket := public.add_ticket_service_line_guarded(v_business,v_id,'f1674000-0000-4000-8000-000000000002',null,(v_ticket->>'version')::int,'f1606-t3-add1',repeat('1',63)||'b');
  v_ticket := public.add_ticket_service_line_guarded(v_business,v_id,'f1674000-0000-4000-8000-000000000002',null,(v_ticket->>'version')::int,'f1606-t3-add2',repeat('1',63)||'c');
  v_ticket := public.finalize_ticket_service_price_guarded(v_business,v_id,(v_ticket->'lines'->0->>'lineId')::uuid,10000,'Kısa',
    (v_ticket->>'version')::int,'f1606-t3-final1',repeat('1',63)||'d');
  v_ticket := public.finalize_ticket_service_price_guarded(v_business,v_id,(v_ticket->'lines'->1->>'lineId')::uuid,5001,'Rötuş',
    (v_ticket->>'version')::int,'f1606-t3-final2',repeat('1',63)||'e');
  v_ticket := public.apply_ticket_promo_guarded(v_business,v_id,'YARI',(v_ticket->>'version')::int,'f1606-t3-apply',repeat('1',63)||'f');
  v_ticket := public.record_ticket_payment_guarded(v_business,v_id,'cash',7501,'f1606-t3-pay',repeat('2',63)||'a');
  v_ticket := public.close_ticket_guarded(v_business,v_id,(v_ticket->>'version')::int,'f1606-t3-close',repeat('2',63)||'b');
  if (v_ticket->'lines'->0->>'promoDiscountMinor')::int <> 5000 or (v_ticket->'lines'->1->>'promoDiscountMinor')::int <> 2500
     or (v_ticket->>'promoDiscountMinor')::int <> 7500 then
    raise exception 'F16-06 allocation remainder wrong: %', v_ticket;
  end if;

end
$allocation$;

reset role;
do $ledger$
begin
  if (select count(*) from public.promo_redemption_lines where business_id = 'f1671000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'F16-06 allocation rows wrong';
  end if;
  if exists (
    select 1 from public.promo_redemptions r
    where r.status = 'consumed' and r.discount_minor <> (
      select coalesce(sum(l.discount_minor), 0) from public.promo_redemption_lines l
      where l.business_id = r.business_id and l.redemption_id = r.id)
  ) then raise exception 'F16-06 allocation does not add up to the consumed discount'; end if;
  begin
    update public.promo_redemption_lines set discount_minor = 0 where business_id = 'f1671000-0000-4000-8000-000000000001';
    raise exception 'F16-06 allocation updated';
  exception when others then if sqlerrm <> 'PROMO_LEDGER_IMMUTABLE' then raise; end if;
  end;
  begin
    update public.promo_redemptions set release_reason = 'x' where business_id = 'f1671000-0000-4000-8000-000000000001' and status = 'consumed';
    raise exception 'F16-06 consumed redemption updated';
  exception when others then if sqlerrm <> 'PROMO_REDEMPTION_CLOSED' then raise; end if;
  end;
  begin
    delete from public.promo_redemptions where business_id = 'f1671000-0000-4000-8000-000000000001';
    raise exception 'F16-06 redemption deleted';
  exception when others then if sqlerrm <> 'PROMO_REDEMPTION_DELETE_FORBIDDEN' then raise; end if;
  end;
end
$ledger$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
do $ticket_cancel$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000001';
  v_ticket jsonb;
begin
  -- t2 has payments, so open a fresh ticket to show cancellation releasing its code.
  v_ticket := public.open_walk_in_ticket_guarded(v_business,(select id from f1606_ids where name = 'c6'),
    'f1606-t4-open',repeat('3',63)||'a');
  v_ticket := public.add_ticket_service_line_guarded(v_business,(v_ticket->>'ticketId')::uuid,'f1674000-0000-4000-8000-000000000001',null,
    (v_ticket->>'version')::int,'f1606-t4-add',repeat('3',63)||'b');
  v_ticket := public.apply_ticket_promo_guarded(v_business,(v_ticket->>'ticketId')::uuid,'KESIM50',(v_ticket->>'version')::int,'f1606-t4-apply',repeat('3',63)||'c');
  v_ticket := public.cancel_ticket_guarded(v_business,(v_ticket->>'ticketId')::uuid,'Vazgeçildi',(v_ticket->>'version')::int,'f1606-t4-cancel',repeat('3',63)||'d');
  if v_ticket->'promo' <> 'null'::jsonb then raise exception 'F16-06 cancelled ticket kept its promo: %', v_ticket; end if;
end
$ticket_cancel$;

-- Day report: service sales are net of the promo; the discount is shown separately.
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
do $report$
declare
  v_business uuid := 'f1671000-0000-4000-8000-000000000003';
  v_ticket jsonb;
  v_report jsonb;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_customer uuid;
begin
  perform public.create_promo_code_guarded(v_business,'f1676000-0000-4000-8000-000000000031','RAPOR20','percent',2000,null,
    now() - interval '1 day', null, null, '{}'::uuid[]);
  execute 'reset role';
  insert into public.customers(id,business_id,name,phone,created_by)
  values ('f1673000-0000-4000-8000-000000000031',v_business,'Rapor Müşteri','05551606031','f1670000-0000-4000-8000-000000000003')
  returning id into v_customer;
  execute 'set local role authenticated';
  v_ticket := public.open_walk_in_ticket_guarded(v_business,v_customer,'f1606-r-open',repeat('4',63)||'a');
  v_ticket := public.add_ticket_service_line_guarded(v_business,(v_ticket->>'ticketId')::uuid,'f1674000-0000-4000-8000-000000000003',null,
    (v_ticket->>'version')::int,'f1606-r-add',repeat('4',63)||'b');
  v_ticket := public.apply_ticket_promo_guarded(v_business,(v_ticket->>'ticketId')::uuid,'RAPOR20',(v_ticket->>'version')::int,'f1606-r-apply',repeat('4',63)||'c');
  v_ticket := public.record_ticket_payment_guarded(v_business,(v_ticket->>'ticketId')::uuid,'cash',12000,'f1606-r-pay',repeat('4',63)||'d');
  v_ticket := public.close_ticket_guarded(v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->>'version')::int,'f1606-r-close',repeat('4',63)||'e');
  v_report := public.get_financial_day_report(v_business, v_today, v_today);
  if (v_report->>'serviceSaleMinor')::bigint <> 12000 or (v_report->>'promoDiscountMinor')::bigint <> 3000
     or (v_report->>'collectedMinor')::bigint <> 12000 or (v_report->>'outstandingMinor')::bigint <> 0
     or (v_report->>'saleValueMinor')::bigint <> 12000 then
    raise exception 'F16-06 day report wrong: %', v_report;
  end if;
end
$report$;

reset role;
select 'F16-06 promo codes acceptance passed' as result;
rollback;
