begin;

-- F16-07 staff commission: dated rate versions with per-service overrides, the
-- line snapshot written at ticket close (service net of discount and promo,
-- package unit value for covered sessions, product rate for the seller, nothing
-- for package sales), partial payment never earning early, post-close product
-- returns and goodwill refunds/corrections as same-staff movements, cumulative
-- rounding that never exceeds the rate of the remaining source amount, the
-- own-vs-business report scope and ledger immutability.

create temporary table f1607_ids(name text primary key, id uuid not null) on commit drop;
grant all on f1607_ids to authenticated;

create or replace function pg_temp.f1607_hash(p_key text)
returns text language sql immutable as $$ select md5(p_key) || md5(p_key || ':2') $$;
grant execute on function pg_temp.f1607_hash(text) to authenticated;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f16c0000-0000-4000-8000-000000000001','f1607-owner@example.invalid','{}'::jsonb),
  ('f16c0000-0000-4000-8000-000000000002','f1607-staff@example.invalid','{}'::jsonb),
  ('f16c0000-0000-4000-8000-000000000003','f1607-foreign@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f16c1000-0000-4000-8000-000000000001','F16-07 Salon','f1607-salon','Europe/Istanbul','f16c0000-0000-4000-8000-000000000001'),
  ('f16c1000-0000-4000-8000-000000000002','F16-07 Foreign','f1607-foreign','Europe/Istanbul','f16c0000-0000-4000-8000-000000000003');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f16c2000-0000-4000-8000-000000000001','f16c1000-0000-4000-8000-000000000001','f16c0000-0000-4000-8000-000000000001','owner',true),
  ('f16c2000-0000-4000-8000-000000000002','f16c1000-0000-4000-8000-000000000001','f16c0000-0000-4000-8000-000000000002','staff',true),
  ('f16c2000-0000-4000-8000-000000000003','f16c1000-0000-4000-8000-000000000002','f16c0000-0000-4000-8000-000000000003','owner',true);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('f16c4000-0000-4000-8000-000000000001','f16c1000-0000-4000-8000-000000000001','Bakım',60,0,0,'Genel',10,100000,'fixed',100000,100000,'TRY',true),
  ('f16c4000-0000-4000-8000-000000000002','f16c1000-0000-4000-8000-000000000001','Boya',60,0,0,'Genel',20,50000,'fixed',50000,50000,'TRY',true),
  ('f16c4000-0000-4000-8000-000000000003','f16c1000-0000-4000-8000-000000000001','Kesim',30,0,0,'Genel',30,15000,'fixed',15000,15000,'TRY',true),
  ('f16c4000-0000-4000-8000-000000000004','f16c1000-0000-4000-8000-000000000002','Yabancı Kesim',30,0,0,'Genel',10,15000,'fixed',15000,15000,'TRY',true);

insert into public.staff_profiles(id,business_id,membership_id,name,active)
values
  ('f16c5000-0000-4000-8000-000000000001','f16c1000-0000-4000-8000-000000000001','f16c2000-0000-4000-8000-000000000002','Ayla',true),
  ('f16c5000-0000-4000-8000-000000000002','f16c1000-0000-4000-8000-000000000001',null,'Deniz',true),
  ('f16c5000-0000-4000-8000-000000000003','f16c1000-0000-4000-8000-000000000001','f16c2000-0000-4000-8000-000000000001','Selin Sahip',true),
  ('f16c5000-0000-4000-8000-000000000004','f16c1000-0000-4000-8000-000000000002',null,'Beta',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
select 'f16c1000-0000-4000-8000-000000000001', s.staff_id, v.service_id, true
from (values ('f16c5000-0000-4000-8000-000000000001'::uuid),('f16c5000-0000-4000-8000-000000000002'::uuid)) s(staff_id)
cross join (values ('f16c4000-0000-4000-8000-000000000001'::uuid),('f16c4000-0000-4000-8000-000000000002'::uuid),
                   ('f16c4000-0000-4000-8000-000000000003'::uuid)) v(service_id);

insert into public.customers(id,business_id,name,phone,created_by)
values
  ('f16c3000-0000-4000-8000-000000000001','f16c1000-0000-4000-8000-000000000001','Ziya Örnek','05551607001','f16c0000-0000-4000-8000-000000000001'),
  ('f16c3000-0000-4000-8000-000000000002','f16c1000-0000-4000-8000-000000000001','Prim Müşteri','05551607002','f16c0000-0000-4000-8000-000000000001');

-- ACL -----------------------------------------------------------------------------
do $acl$
declare v_sig text;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('staff_commission_rates','staff_service_commission_rates','staff_commission_lines','staff_commission_entries')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then raise exception 'F16-07 commission tables must force RLS'; end if;
  foreach v_sig in array array['public.staff_commission_rates','public.staff_service_commission_rates',
                               'public.staff_commission_lines','public.staff_commission_entries'] loop
    if has_table_privilege('anon', v_sig, 'SELECT') or has_table_privilege('authenticated', v_sig, 'SELECT')
       or has_table_privilege('authenticated', v_sig, 'INSERT') or has_table_privilege('authenticated', v_sig, 'UPDATE') then
      raise exception 'F16-07 % reachable through the Data API', v_sig;
    end if;
  end loop;
  foreach v_sig in array array[
    'public.get_staff_commission_report(uuid,date,date)',
    'public.list_staff_commission_rates(uuid)',
    'public.set_staff_commission_rates_guarded(uuid,uuid,integer,integer,integer)',
    'public.set_staff_service_commission_override_guarded(uuid,uuid,uuid,integer,integer)'
  ] loop
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') or has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'F16-07 % grant wrong', v_sig;
    end if;
  end loop;
  foreach v_sig in array array[
    'public.f16_commission_rebalance(uuid,uuid,uuid,uuid)',
    'public.f16_service_commission_rate(uuid,uuid,uuid)',
    'public.f16_commission_manager(uuid)',
    'public.f16_staff_commission_state(uuid,uuid)',
    'public.f16_commission_amount(bigint,integer)'
  ] loop
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') or has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'F16-07 internal % is callable by API roles', v_sig;
    end if;
  end loop;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proname like '%commission%')
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  ) then raise exception 'F16-07 SECURITY DEFINER function without empty search_path'; end if;
  if public.f16_commission_amount(90000, 1000) <> 9000
     or public.f16_commission_amount(1005, 1000) <> 101
     or public.f16_commission_amount(1004, 1000) <> 100
     or public.f16_commission_amount(0, 1000) <> 0
     or public.f16_commission_amount(5000, 0) <> 0 then
    raise exception 'F16-07 commission rounding wrong';
  end if;
end
$acl$;

-- Rates -------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $rates$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_list jsonb;
begin
  v := public.set_staff_commission_rates_guarded(v_business,'f16c5000-0000-4000-8000-000000000001',1000,500,0);
  if (v->>'version')::int <> 1 or (v->>'serviceRateBps')::int <> 1000 or (v->>'productRateBps')::int <> 500 then
    raise exception 'F16-07 first rate version wrong: %', v;
  end if;
  begin
    perform public.set_staff_commission_rates_guarded(v_business,'f16c5000-0000-4000-8000-000000000001',1500,500,0);
    raise exception 'F16-07 stale rate write accepted';
  exception when others then if sqlerrm <> 'STALE_WRITE' then raise; end if;
  end;
  begin
    perform public.set_staff_commission_rates_guarded(v_business,'f16c5000-0000-4000-8000-000000000001',10001,0,1);
    raise exception 'F16-07 rate above 100%% accepted';
  exception when others then if sqlerrm <> 'INVALID_COMMISSION_RATE' then raise; end if;
  end;
  begin
    perform public.set_staff_commission_rates_guarded(v_business,'f16c5000-0000-4000-8000-000000000004',100,100,0);
    raise exception 'F16-07 another business staff accepted';
  exception when others then if sqlerrm <> 'STAFF_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.set_staff_service_commission_override_guarded(v_business,'f16c5000-0000-4000-8000-000000000001',
      'f16c4000-0000-4000-8000-000000000004',1000,0);
    raise exception 'F16-07 another business service accepted';
  exception when others then if sqlerrm <> 'SERVICE_NOT_FOUND' then raise; end if;
  end;

  perform public.set_staff_commission_rates_guarded(v_business,'f16c5000-0000-4000-8000-000000000003',0,500,0);
  v := public.set_staff_service_commission_override_guarded(v_business,'f16c5000-0000-4000-8000-000000000001',
    'f16c4000-0000-4000-8000-000000000002',3000,0);
  if jsonb_array_length(v->'overrides') <> 1 or (v->'overrides'->0->>'rateBps')::int <> 3000
     or v->'overrides'->0->>'serviceName' <> 'Boya' then
    raise exception 'F16-07 override wrong: %', v;
  end if;

  v_list := public.list_staff_commission_rates(v_business);
  if jsonb_array_length(v_list) <> 3
     or exists (select 1 from jsonb_array_elements(v_list) x where x->>'staffName' = 'Beta')
     or (select (x->>'version')::int from jsonb_array_elements(v_list) x where x->>'staffName' = 'Deniz') <> 0
     or (select x->>'serviceRateBps' from jsonb_array_elements(v_list) x where x->>'staffName' = 'Deniz') is not null then
    raise exception 'F16-07 rate list wrong: %', v_list;
  end if;
end
$rates$;

-- Staff and a foreign owner cannot manage or list rates.
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000002',true);
do $staffrates$
begin
  begin
    perform public.set_staff_commission_rates_guarded('f16c1000-0000-4000-8000-000000000001','f16c5000-0000-4000-8000-000000000001',5000,5000,1);
    raise exception 'F16-07 staff set their own commission rate';
  exception when others then if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
  begin
    perform public.list_staff_commission_rates('f16c1000-0000-4000-8000-000000000001');
    raise exception 'F16-07 staff listed commission rates';
  exception when others then if sqlerrm <> 'FINANCIAL_REPORTS_PERMISSION_REQUIRED' then raise; end if;
  end;
end
$staffrates$;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000003',true);
do $foreignrates$
begin
  begin
    perform public.set_staff_commission_rates_guarded('f16c1000-0000-4000-8000-000000000001','f16c5000-0000-4000-8000-000000000001',5000,5000,1);
    raise exception 'F16-07 foreign owner set a rate';
  exception when others then if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
  begin
    perform public.list_staff_commission_rates('f16c1000-0000-4000-8000-000000000001');
    raise exception 'F16-07 foreign owner listed rates';
  exception when others then if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
end
$foreignrates$;

-- Ziya's example: 1.000 TL service, 100 TL discount, 450 TL paid so far, 10%.
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $ziya$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_ticket uuid;
begin
  v := public.open_walk_in_ticket_guarded(v_business,'f16c3000-0000-4000-8000-000000000001','f1607-t1-open',pg_temp.f1607_hash('t1-open'));
  v_ticket := (v->>'ticketId')::uuid;
  insert into f1607_ids values ('t1', v_ticket);
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16c4000-0000-4000-8000-000000000001',
    'f16c5000-0000-4000-8000-000000000001',(v->>'version')::int,'f1607-t1-add',pg_temp.f1607_hash('t1-add'));
  v := public.set_ticket_service_discount_guarded(v_business,v_ticket,(v->'lines'->0->>'lineId')::uuid,10000,'Sadakat indirimi',
    (v->>'version')::int,'f1607-t1-discount',pg_temp.f1607_hash('t1-discount'));
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'cash',45000,'f1607-t1-pay1',pg_temp.f1607_hash('t1-pay1'));
  insert into f1607_ids values ('t1_payment', (v->'paymentEvents'->0->>'eventId')::uuid);
end
$ziya$;

reset role;
do $partial$
begin
  if exists (select 1 from public.staff_commission_lines where ticket_id = (select id from f1607_ids where name = 't1')) then
    raise exception 'F16-07 a partially paid open ticket earned commission';
  end if;
end
$partial$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $ziyaclose$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v_ticket uuid := (select id from f1607_ids where name = 't1');
  v jsonb;
begin
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'card',45000,'f1607-t1-pay2',pg_temp.f1607_hash('t1-pay2'));
  v := public.close_ticket_guarded(v_business,v_ticket,(v->>'version')::int,'f1607-t1-close',pg_temp.f1607_hash('t1-close'));
  if v->>'status' <> 'closed' then raise exception 'F16-07 T1 did not close: %', v; end if;

  -- A later rate change applies only to later closes.
  perform public.set_staff_commission_rates_guarded(v_business,'f16c5000-0000-4000-8000-000000000001',2000,500,1);
end
$ziyaclose$;

reset role;
do $ziyacheck$
declare
  v_line public.staff_commission_lines;
  v_entry public.staff_commission_entries;
begin
  select * into v_line from public.staff_commission_lines where ticket_id = (select id from f1607_ids where name = 't1');
  if v_line.id is null or v_line.line_kind <> 'service' or v_line.base_at_close_minor <> 90000
     or v_line.rate_bps <> 1000 or v_line.rate_source <> 'service_default' or v_line.staff_name_snapshot <> 'Ayla'
     or v_line.item_name_snapshot <> 'Bakım' or v_line.currency <> 'TRY' then
    raise exception 'F16-07 Ziya example line wrong: %', row_to_json(v_line);
  end if;
  select * into v_entry from public.staff_commission_entries where commission_line_id = v_line.id;
  if v_entry.kind <> 'line' or v_entry.base_minor <> 90000 or v_entry.amount_minor <> 9000
     or v_entry.cumulative_amount_minor <> 9000 then
    raise exception 'F16-07 Ziya example must earn 90 TL: %', row_to_json(v_entry);
  end if;
end
$ziyacheck$;

-- Override, promo share, a staff member without rates and a line without staff.
set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $mixed$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_ticket uuid;
begin
  perform public.create_promo_code_guarded(v_business,'f16c6000-0000-4000-8000-000000000001','PRIM10','percent',1000,null,
    now() - interval '1 day', null, null, '{}'::uuid[]);
  v := public.open_walk_in_ticket_guarded(v_business,'f16c3000-0000-4000-8000-000000000002','f1607-t2-open',pg_temp.f1607_hash('t2-open'));
  v_ticket := (v->>'ticketId')::uuid;
  insert into f1607_ids values ('t2', v_ticket);
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16c4000-0000-4000-8000-000000000002',
    'f16c5000-0000-4000-8000-000000000001',(v->>'version')::int,'f1607-t2-add1',pg_temp.f1607_hash('t2-add1'));
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16c4000-0000-4000-8000-000000000003',
    'f16c5000-0000-4000-8000-000000000002',(v->>'version')::int,'f1607-t2-add2',pg_temp.f1607_hash('t2-add2'));
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16c4000-0000-4000-8000-000000000003',
    null,(v->>'version')::int,'f1607-t2-add3',pg_temp.f1607_hash('t2-add3'));
  v := public.apply_ticket_promo_guarded(v_business,v_ticket,'PRIM10',(v->>'version')::int,'f1607-t2-promo',pg_temp.f1607_hash('t2-promo'));
  if (v->>'promoDiscountMinor')::bigint <> 8000 or (v->>'totalMinor')::bigint <> 72000 then
    raise exception 'F16-07 T2 promo setup wrong: %', v;
  end if;
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'card',72000,'f1607-t2-pay',pg_temp.f1607_hash('t2-pay'));
  insert into f1607_ids values ('t2_payment', (v->'paymentEvents'->0->>'eventId')::uuid);
  v := public.close_ticket_guarded(v_business,v_ticket,(v->>'version')::int,'f1607-t2-close',pg_temp.f1607_hash('t2-close'));

  -- A goodwill refund of 10% after close: 72.00 TL over 450/135/135 shares.
  v := public.record_ticket_refund_guarded(v_business,v_ticket,(select id from f1607_ids where name = 't2_payment'),7200,
    'Memnuniyet iadesi','f1607-t2-refund',pg_temp.f1607_hash('t2-refund'));
end
$mixed$;
-- Deferred commission triggers run at commit; flush them here.
set constraints all immediate;
set constraints all deferred;

reset role;
do $mixedcheck$
declare
  v_t2 uuid := (select id from f1607_ids where name = 't2');
  v_boya public.staff_commission_lines;
  v_kesim public.staff_commission_lines;
  v_adj record;
begin
  if (select count(*) from public.staff_commission_lines where ticket_id = v_t2) <> 2 then
    raise exception 'F16-07 a line without staff earned commission';
  end if;
  select * into v_boya from public.staff_commission_lines where ticket_id = v_t2 and line_ordinal = 1;
  select * into v_kesim from public.staff_commission_lines where ticket_id = v_t2 and line_ordinal = 2;
  if v_boya.base_at_close_minor <> 45000 or v_boya.rate_bps <> 3000 or v_boya.rate_source <> 'service_override'
     or v_boya.override_version_id is null then
    raise exception 'F16-07 override line wrong: %', row_to_json(v_boya);
  end if;
  if v_kesim.base_at_close_minor <> 13500 or v_kesim.rate_bps <> 0 or v_kesim.rate_source <> 'none'
     or v_kesim.staff_name_snapshot <> 'Deniz' then
    raise exception 'F16-07 no-rate staff line wrong: %', row_to_json(v_kesim);
  end if;
  select sum(base_minor) as base, sum(amount_minor) as amount, count(*) as n into v_adj
  from public.staff_commission_entries where commission_line_id = v_boya.id and kind = 'payment_adjustment';
  if v_adj.n <> 1 or v_adj.base <> -4500 or v_adj.amount <> -1350 then
    raise exception 'F16-07 goodwill refund share for the override line wrong: %', row_to_json(v_adj);
  end if;
  select sum(base_minor) as base, sum(amount_minor) as amount, count(*) as n into v_adj
  from public.staff_commission_entries where commission_line_id = v_kesim.id and kind = 'payment_adjustment';
  if v_adj.n <> 1 or v_adj.base <> -1350 or v_adj.amount <> 0 then
    raise exception 'F16-07 goodwill refund share for the no-rate line wrong: %', row_to_json(v_adj);
  end if;
  if (select source_payment_event_id from public.staff_commission_entries
      where commission_line_id = v_boya.id and kind = 'payment_adjustment') is null then
    raise exception 'F16-07 adjustment lost its payment event';
  end if;
end
$mixedcheck$;

-- A correction that gives part of the refund back restores the same share.
set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $correction$
begin
  perform public.record_ticket_correction_guarded('f16c1000-0000-4000-8000-000000000001',(select id from f1607_ids where name = 't2'),
    (select id from f1607_ids where name = 't2_payment'),'increase',3600,'Fazla iade düzeltmesi',
    'f1607-t2-correct',pg_temp.f1607_hash('t2-correct'));
end
$correction$;
set constraints all immediate;
set constraints all deferred;

reset role;
do $correctioncheck$
declare
  v_t2 uuid := (select id from f1607_ids where name = 't2');
  v_sum record;
begin
  select sum(e.base_minor) as base, sum(e.amount_minor) as amount into v_sum
  from public.staff_commission_entries e
  join public.staff_commission_lines l on l.id = e.commission_line_id
  where l.ticket_id = v_t2 and l.line_ordinal = 1;
  if v_sum.base <> 42750 or v_sum.amount <> 12825 then
    raise exception 'F16-07 correction did not restore the override share: %', row_to_json(v_sum);
  end if;
  if (select sum(e.base_minor) from public.staff_commission_entries e
      join public.staff_commission_lines l on l.id = e.commission_line_id
      where l.ticket_id = v_t2 and l.line_ordinal = 2) <> 12825 then
    raise exception 'F16-07 correction share for the second staff wrong';
  end if;
end
$correctioncheck$;

-- A package-covered session earns on the package unit value; the sale does not.
set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $package$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_ticket uuid;
  v_pkg jsonb;
begin
  perform public.create_service_package_guarded(v_business,'f16c7000-0000-4000-8000-000000000001',
    'f16c4000-0000-4000-8000-000000000001','5 Bakım',5,90,400000);
  v := public.open_walk_in_ticket_guarded(v_business,'f16c3000-0000-4000-8000-000000000001','f1607-t3-open',pg_temp.f1607_hash('t3-open'));
  v_ticket := (v->>'ticketId')::uuid;
  insert into f1607_ids values ('t3', v_ticket);
  v := public.add_ticket_package_line_guarded(v_business,v_ticket,'f16c7000-0000-4000-8000-000000000001',
    (v->>'version')::int,1,'f1607-t3-pkg',pg_temp.f1607_hash('t3-pkg'));
  v_pkg := v->'lines'->0->'soldPackage';
  insert into f1607_ids values ('t3_pkg', (v_pkg->>'customerPackageId')::uuid);
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16c4000-0000-4000-8000-000000000001',
    'f16c5000-0000-4000-8000-000000000001',(v->>'version')::int,'f1607-t3-add',pg_temp.f1607_hash('t3-add'));
  v := public.apply_ticket_package_guarded(v_business,v_ticket,(v->'lines'->1->>'lineId')::uuid,
    (v_pkg->>'customerPackageId')::uuid,(v->>'version')::int,'f1607-t3-cover',pg_temp.f1607_hash('t3-cover'));
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'cash',400000,'f1607-t3-pay',pg_temp.f1607_hash('t3-pay'));
  insert into f1607_ids values ('t3_payment', (v->'paymentEvents'->0->>'eventId')::uuid);
  v := public.close_ticket_guarded(v_business,v_ticket,(v->>'version')::int,'f1607-t3-close',pg_temp.f1607_hash('t3-close'));

  -- Refunding the remaining 4 sessions (320.000) leaves the used session's commission alone.
  perform public.refund_customer_package_guarded(v_business,(select id from f1607_ids where name = 't3_pkg'),320000,
    jsonb_build_array(jsonb_build_object('paymentEventId',(select id from f1607_ids where name = 't3_payment'),'amountMinor',320000)),
    'Taşındı','f1607-t3-refund',pg_temp.f1607_hash('t3-refund'));
end
$package$;
set constraints all immediate;
set constraints all deferred;

reset role;
do $packagecheck$
declare
  v_t3 uuid := (select id from f1607_ids where name = 't3');
  v_line public.staff_commission_lines;
begin
  if (select count(*) from public.staff_commission_lines where ticket_id = v_t3) <> 1 then
    raise exception 'F16-07 a package sale line earned commission';
  end if;
  select * into v_line from public.staff_commission_lines where ticket_id = v_t3;
  if v_line.line_kind <> 'package_covered' or v_line.base_at_close_minor <> 80000 or v_line.rate_bps <> 2000
     or v_line.rate_source <> 'service_default' then
    raise exception 'F16-07 covered session line wrong: %', row_to_json(v_line);
  end if;
  if (select count(*) from public.staff_commission_entries where commission_line_id = v_line.id) <> 1
     or (select amount_minor from public.staff_commission_entries where commission_line_id = v_line.id) <> 16000 then
    raise exception 'F16-07 package refund changed a used session commission';
  end if;
end
$packagecheck$;

-- Product lines earn at the seller's product rate; a post-close return is a
-- negative movement for the same staff line.
set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $product$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_ticket uuid;
  v_product jsonb;
  v_payment uuid;
begin
  v_product := public.create_product_guarded(v_business,'Şampuan','F1607-SAMP','piece',25000,'TRY',10,
    'f1607-product',pg_temp.f1607_hash('product'));
  insert into f1607_ids values ('shampoo', (v_product->>'productId')::uuid);
  v := public.open_product_sale_guarded(v_business,'f16c3000-0000-4000-8000-000000000002',(v_product->>'productId')::uuid,
    2,1,'f1607-t4-sale',pg_temp.f1607_hash('t4-sale'));
  v_ticket := (v->>'ticketId')::uuid;
  insert into f1607_ids values ('t4', v_ticket), ('t4_line', (v->'lines'->0->>'lineId')::uuid);
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'cash',50000,'f1607-t4-pay',pg_temp.f1607_hash('t4-pay'));
  v_payment := (v->'paymentEvents'->0->>'eventId')::uuid;
  v := public.close_ticket_guarded(v_business,v_ticket,(v->>'version')::int,'f1607-t4-close',pg_temp.f1607_hash('t4-close'));
  v := public.record_product_return_refund_guarded(v_business,v_ticket,(select id from f1607_ids where name = 't4_line'),v_payment,
    1,25000,true,'Açılmamış iade','f1607-t4-return',pg_temp.f1607_hash('t4-return'));
end
$product$;
set constraints all immediate;
set constraints all deferred;

reset role;
do $productcheck$
declare
  v_line public.staff_commission_lines;
  v_entry public.staff_commission_entries;
begin
  select * into v_line from public.staff_commission_lines where ticket_id = (select id from f1607_ids where name = 't4');
  if v_line.line_kind <> 'product' or v_line.staff_name_snapshot <> 'Selin Sahip' or v_line.rate_bps <> 500
     or v_line.rate_source <> 'product_default' or v_line.base_at_close_minor <> 50000 or v_line.quantity_at_close <> 2
     or v_line.item_name_snapshot <> 'Şampuan' then
    raise exception 'F16-07 product line wrong: %', row_to_json(v_line);
  end if;
  if (select count(*) from public.staff_commission_entries where commission_line_id = v_line.id) <> 2 then
    raise exception 'F16-07 product return wrote extra movements';
  end if;
  select * into v_entry from public.staff_commission_entries where commission_line_id = v_line.id and kind = 'product_return';
  if v_entry.base_minor <> -25000 or v_entry.amount_minor <> -1250 or v_entry.returned_quantity <> 1
     or v_entry.source_return_id is null or v_entry.cumulative_amount_minor <> 1250 then
    raise exception 'F16-07 product return movement wrong: %', row_to_json(v_entry);
  end if;
end
$productcheck$;

-- A return after a goodwill refund already took part of the product's share:
-- the running base never goes negative and ends on the ticket's money.
set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $overlap$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_ticket uuid;
  v_product jsonb;
begin
  v_product := public.create_product_guarded(v_business,'Maske','F1607-MASK','piece',10000,'TRY',5,
    'f1607-product2',pg_temp.f1607_hash('product2'));
  v := public.open_product_sale_guarded(v_business,'f16c3000-0000-4000-8000-000000000001',(v_product->>'productId')::uuid,
    1,1,'f1607-t5-sale',pg_temp.f1607_hash('t5-sale'));
  v_ticket := (v->>'ticketId')::uuid;
  insert into f1607_ids values ('t5', v_ticket), ('t5_line', (v->'lines'->0->>'lineId')::uuid);
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16c4000-0000-4000-8000-000000000003',
    'f16c5000-0000-4000-8000-000000000001',(v->>'version')::int,'f1607-t5-add',pg_temp.f1607_hash('t5-add'));
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'cash',25000,'f1607-t5-pay',pg_temp.f1607_hash('t5-pay'));
  insert into f1607_ids values ('t5_payment', (v->'paymentEvents'->0->>'eventId')::uuid);
  v := public.close_ticket_guarded(v_business,v_ticket,(v->>'version')::int,'f1607-t5-close',pg_temp.f1607_hash('t5-close'));
  v := public.record_ticket_refund_guarded(v_business,v_ticket,(select id from f1607_ids where name = 't5_payment'),10000,
    'Memnuniyet iadesi','f1607-t5-refund',pg_temp.f1607_hash('t5-refund'));
end
$overlap$;
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $overlapreturn$
begin
  perform public.record_product_return_refund_guarded('f16c1000-0000-4000-8000-000000000001',
    (select id from f1607_ids where name = 't5'),(select id from f1607_ids where name = 't5_line'),
    (select id from f1607_ids where name = 't5_payment'),1,1,false,'Hasarlı','f1607-t5-return',pg_temp.f1607_hash('t5-return'));
end
$overlapreturn$;
set constraints all immediate;
set constraints all deferred;

reset role;
do $overlapcheck$
declare
  v_product public.staff_commission_lines;
  v_service public.staff_commission_lines;
  v_kinds text;
begin
  select * into v_product from public.staff_commission_lines
  where ticket_id = (select id from f1607_ids where name = 't5') and line_kind = 'product';
  select * into v_service from public.staff_commission_lines
  where ticket_id = (select id from f1607_ids where name = 't5') and line_kind = 'service';
  select string_agg(kind || ':' || base_minor || '/' || amount_minor, ',' order by cumulative_base_minor desc, occurred_at)
  into v_kinds from public.staff_commission_entries where commission_line_id = v_product.id;
  if (select sum(base_minor) from public.staff_commission_entries where commission_line_id = v_product.id) <> 0
     or (select sum(amount_minor) from public.staff_commission_entries where commission_line_id = v_product.id) <> 0
     or (select count(*) from public.staff_commission_entries where commission_line_id = v_product.id and kind = 'product_return') <> 1 then
    raise exception 'F16-07 returned product commission wrong: %', v_kinds;
  end if;
  -- 250 TL ticket, 100 TL goodwill refund, product (100 TL) returned for 0.01 TL:
  -- the service keeps 149.99 TL of base, 20% = 30.00 TL.
  if (select sum(base_minor) from public.staff_commission_entries where commission_line_id = v_service.id) <> 14999
     or (select sum(amount_minor) from public.staff_commission_entries where commission_line_id = v_service.id) <> 3000 then
    raise exception 'F16-07 service share after overlapping return wrong';
  end if;
end
$overlapcheck$;

-- Ledger invariants over everything written above.
do $invariants$
declare v_bad integer;
begin
  select count(*) into v_bad
  from public.staff_commission_entries e
  join public.staff_commission_lines l on l.id = e.commission_line_id
  where e.business_id = 'f16c1000-0000-4000-8000-000000000001'
    and (e.cumulative_amount_minor <> public.f16_commission_amount(e.cumulative_base_minor, l.rate_bps)
      or e.cumulative_base_minor < 0);
  if v_bad <> 0 then raise exception 'F16-07 % movements break cumulative rounding', v_bad; end if;

  select count(*) into v_bad
  from public.staff_commission_lines l
  join lateral (
    select sum(e.base_minor)::bigint as base, sum(e.amount_minor)::bigint as amount,
      max(e.cumulative_base_minor) filter (where e.kind = 'line') as line_base
    from public.staff_commission_entries e where e.commission_line_id = l.id
  ) x on true
  where l.business_id = 'f16c1000-0000-4000-8000-000000000001'
    and (x.base < 0 or x.amount <> public.f16_commission_amount(x.base, l.rate_bps)
      or x.line_base <> l.base_at_close_minor);
  if v_bad <> 0 then raise exception 'F16-07 % lines do not add up', v_bad; end if;

  -- Distributed commission base never exceeds the money the ticket kept.
  select count(*) into v_bad
  from public.tickets t
  where t.business_id = 'f16c1000-0000-4000-8000-000000000001' and t.status = 'closed'
    and coalesce((
      select sum(e.base_minor) from public.staff_commission_entries e
      join public.staff_commission_lines l on l.id = e.commission_line_id
      where l.ticket_id = t.id and l.line_kind <> 'package_covered'
    ), 0) > public.f14_ticket_paid_minor(t.business_id, t.id);
  if v_bad <> 0 then raise exception 'F16-07 % tickets distribute more than they kept', v_bad; end if;
end
$invariants$;

-- Report ----------------------------------------------------------------------------
create temporary table f1607_expected on commit drop as
select e.staff_id, sum(e.amount_minor)::bigint as amount, sum(e.base_minor)::bigint as base, count(*)::integer as n
from public.staff_commission_entries e
where e.business_id = 'f16c1000-0000-4000-8000-000000000001'
group by e.staff_id;
grant select on f1607_expected to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
do $report$
declare
  v_business uuid := 'f16c1000-0000-4000-8000-000000000001';
  v jsonb;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_row jsonb;
begin
  v := public.get_staff_commission_report(v_business, v_today, v_today);
  if v->>'scope' <> 'business' or v->>'currency' <> 'TRY' or jsonb_array_length(v->'definition') <> 8
     or jsonb_array_length(v->'staff') <> 3
     or (v->'totals'->>'commissionMinor')::bigint <> (select sum(amount) from f1607_expected)
     or (v->>'movementCount')::int <> (select sum(n) from f1607_expected) then
    raise exception 'F16-07 business report wrong: %', v;
  end if;
  for v_row in select * from jsonb_array_elements(v->'staff') loop
    if (v_row->>'commissionMinor')::bigint <> (select amount from f1607_expected where staff_id = (v_row->>'staffId')::uuid)
       or (v_row->>'baseMinor')::bigint <> (select base from f1607_expected where staff_id = (v_row->>'staffId')::uuid) then
      raise exception 'F16-07 staff row does not match the ledger: %', v_row;
    end if;
  end loop;
  v_row := (select x from jsonb_array_elements(v->'staff') x where x->>'staffName' = 'Ayla');
  -- Ayla: 90 + 135 + 160 + 30 TL of lines, minus the refund shares, plus the correction.
  if (v_row->>'serviceBaseMinor')::bigint <> 90000 + 45000 + 15000
     or (v_row->>'packageUnitBaseMinor')::bigint <> 80000
     or (v_row->>'lineCount')::int <> 4 then
    raise exception 'F16-07 Ayla breakdown wrong: %', v_row;
  end if;
  if not (v->'definition'->>0 like 'Prim, adisyon kapanınca%') then
    raise exception 'F16-07 report must carry its definition';
  end if;

  begin
    perform public.get_staff_commission_report(v_business, v_today - 100, v_today);
    raise exception 'F16-07 unbounded report range accepted';
  exception when others then if sqlerrm <> 'INVALID_REPORT_RANGE' then raise; end if;
  end;
end
$report$;

-- A staff member without report permission sees only their own movements.
select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000002',true);
do $ownreport$
declare
  v jsonb;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  v := public.get_staff_commission_report('f16c1000-0000-4000-8000-000000000001', v_today, v_today);
  if v->>'scope' <> 'own' or v->>'ownStaffId' <> 'f16c5000-0000-4000-8000-000000000001'
     or jsonb_array_length(v->'staff') <> 1 or v->'staff'->0->>'staffName' <> 'Ayla'
     or exists (select 1 from jsonb_array_elements(v->'movements') m where m->>'staffName' <> 'Ayla')
     or (v->'totals'->>'commissionMinor')::bigint <> (select amount from f1607_expected where staff_id = 'f16c5000-0000-4000-8000-000000000001') then
    raise exception 'F16-07 staff saw more than their own commission: %', v;
  end if;
end
$ownreport$;

select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000003',true);
do $foreignreport$
begin
  perform public.get_staff_commission_report('f16c1000-0000-4000-8000-000000000001', current_date, current_date);
  raise exception 'F16-07 foreign owner read the report';
exception when others then if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
end
$foreignreport$;

select set_config('request.jwt.claim.sub','f16c0000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"recovery"}]}',true);
do $recovery$
declare v_failed boolean := false;
begin
  begin
    perform public.get_staff_commission_report('f16c1000-0000-4000-8000-000000000001', current_date, current_date);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'F16-07 recovery session read the report'; end if;
  begin
    perform public.set_staff_commission_rates_guarded('f16c1000-0000-4000-8000-000000000001','f16c5000-0000-4000-8000-000000000002',100,100,0);
    raise exception 'F16-07 recovery session set a rate';
  exception when others then if sqlerrm like 'F16-07%' then raise; end if;
  end;
end
$recovery$;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

-- Immutability ---------------------------------------------------------------------------
reset role;
do $immutable$
begin
  begin
    update public.staff_commission_entries set amount_minor = amount_minor + 1
    where business_id = 'f16c1000-0000-4000-8000-000000000001';
    raise exception 'F16-07 commission movement was edited';
  exception when others then if sqlerrm <> 'COMMISSION_LEDGER_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.staff_commission_lines where business_id = 'f16c1000-0000-4000-8000-000000000001';
    raise exception 'F16-07 commission line was deleted';
  exception when others then if sqlerrm <> 'COMMISSION_LEDGER_IMMUTABLE' then raise; end if;
  end;
  begin
    update public.staff_commission_rates set service_rate_bps = 0
    where business_id = 'f16c1000-0000-4000-8000-000000000001';
    raise exception 'F16-07 rate version was edited';
  exception when others then if sqlerrm <> 'COMMISSION_LEDGER_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.staff_service_commission_rates where business_id = 'f16c1000-0000-4000-8000-000000000001';
    raise exception 'F16-07 override version was deleted';
  exception when others then if sqlerrm <> 'COMMISSION_LEDGER_IMMUTABLE' then raise; end if;
  end;
end
$immutable$;

select 'F16-07 staff commission acceptance passed' as result;
rollback;
