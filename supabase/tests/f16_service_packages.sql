begin;

-- F16-05 service packages: ACL, definitions, sale, same-visit and later usage,
-- tenant/customer/service/expiry rejection, reversal, cancellation, the
-- proportional refund example (5 sessions for 1.000 TL, 2 used -> 600 TL),
-- append-only ledger and the day report never counting a covered session as
-- a second income.

create temporary table f1605_ids(name text primary key, id uuid not null) on commit drop;
grant all on f1605_ids to authenticated;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1650000-0000-4000-8000-000000000001','f1605-owner@example.invalid','{}'::jsonb),
  ('f1650000-0000-4000-8000-000000000002','f1605-staff@example.invalid','{}'::jsonb),
  ('f1650000-0000-4000-8000-000000000003','f1605-other@example.invalid','{}'::jsonb),
  ('f1650000-0000-4000-8000-000000000004','f1605-report@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1651000-0000-4000-8000-000000000001','F16-05 Salon A','f1605-salon-a','Europe/Istanbul','f1650000-0000-4000-8000-000000000001'),
  ('f1651000-0000-4000-8000-000000000002','F16-05 Salon B','f1605-salon-b','Europe/Istanbul','f1650000-0000-4000-8000-000000000003'),
  ('f1651000-0000-4000-8000-000000000003','F16-05 Report Salon','f1605-report-salon','Europe/Istanbul','f1650000-0000-4000-8000-000000000004');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1652000-0000-4000-8000-000000000001','f1651000-0000-4000-8000-000000000001','f1650000-0000-4000-8000-000000000001','owner',true),
  ('f1652000-0000-4000-8000-000000000002','f1651000-0000-4000-8000-000000000001','f1650000-0000-4000-8000-000000000002','staff',true),
  ('f1652000-0000-4000-8000-000000000003','f1651000-0000-4000-8000-000000000002','f1650000-0000-4000-8000-000000000003','owner',true),
  ('f1652000-0000-4000-8000-000000000004','f1651000-0000-4000-8000-000000000003','f1650000-0000-4000-8000-000000000004','owner',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('f1653000-0000-4000-8000-000000000001','f1651000-0000-4000-8000-000000000001','Ayşe Paket','05551650001',null,'f1650000-0000-4000-8000-000000000001'),
  ('f1653000-0000-4000-8000-000000000002','f1651000-0000-4000-8000-000000000001','Mehmet Başka','05551650002',null,'f1650000-0000-4000-8000-000000000001'),
  ('f1653000-0000-4000-8000-000000000003','f1651000-0000-4000-8000-000000000002','B Müşteri','05551650003',null,'f1650000-0000-4000-8000-000000000003'),
  ('f1653000-0000-4000-8000-000000000004','f1651000-0000-4000-8000-000000000003','Rapor Müşteri','05551650004',null,'f1650000-0000-4000-8000-000000000004');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('f1654000-0000-4000-8000-000000000001','f1651000-0000-4000-8000-000000000001','Lazer Seansı',30,0,0,'Genel',10,30000,'fixed',30000,30000,'TRY',true),
  ('f1654000-0000-4000-8000-000000000002','f1651000-0000-4000-8000-000000000001','Cilt Bakımı',30,0,0,'Genel',20,20000,'range',20000,40000,'TRY',true),
  ('f1654000-0000-4000-8000-000000000003','f1651000-0000-4000-8000-000000000002','B Lazer',30,0,0,'Genel',10,30000,'fixed',30000,30000,'TRY',true),
  ('f1654000-0000-4000-8000-000000000004','f1651000-0000-4000-8000-000000000003','Rapor Lazer',30,0,0,'Genel',10,30000,'fixed',30000,30000,'TRY',true);

-- ACL -----------------------------------------------------------------------------
do $acl$
declare
  v_sig text;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('service_packages','customer_packages','customer_package_usages','customer_package_refund_events')
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then raise exception 'F16-05 package tables must force RLS'; end if;

  foreach v_sig in array array[
    'public.service_packages','public.customer_packages','public.customer_package_usages','public.customer_package_refund_events'
  ] loop
    if has_table_privilege('anon', v_sig, 'SELECT') or has_table_privilege('authenticated', v_sig, 'SELECT')
       or has_table_privilege('authenticated', v_sig, 'INSERT') or has_table_privilege('authenticated', v_sig, 'UPDATE') then
      raise exception 'F16-05 % is reachable through the Data API', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.create_service_package_guarded(uuid,uuid,uuid,text,integer,integer,integer)',
    'public.update_service_package_guarded(uuid,uuid,integer,text,integer,integer,integer,boolean)',
    'public.list_service_packages(uuid,boolean)',
    'public.add_ticket_package_line_guarded(uuid,uuid,uuid,integer,integer,text,text)',
    'public.open_package_sale_guarded(uuid,uuid,uuid,integer,text,text)',
    'public.apply_ticket_package_guarded(uuid,uuid,uuid,uuid,integer,text,text)',
    'public.reverse_ticket_package_usage_guarded(uuid,uuid,uuid,text,integer,text,text)',
    'public.refund_customer_package_guarded(uuid,uuid,integer,jsonb,text,text,text)',
    'public.list_customer_packages(uuid,uuid,boolean)'
  ] loop
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE')
       or has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'F16-05 grant shape wrong for %', v_sig;
    end if;
  end loop;

  foreach v_sig in array array[
    'public.f16_active_package_use(uuid,uuid)',
    'public.f16_insert_package_sale_line(public.tickets,public.service_packages,public.memberships)',
    'public.f16_lock_sellable_package(uuid,uuid,integer)',
    'public.f16_customer_package_json(public.customer_packages)',
    'public.f16_service_package_json(public.service_packages)',
    'public.f16_package_refund_value(public.customer_packages)'
  ] loop
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') or has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'F16-05 internal helper % is callable', v_sig;
    end if;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proname like 'f16\_%package%' or p.proname in (
        'create_service_package_guarded','update_service_package_guarded','list_service_packages',
        'add_ticket_package_line_guarded','open_package_sale_guarded','apply_ticket_package_guarded',
        'reverse_ticket_package_usage_guarded','refund_customer_package_guarded','list_customer_packages'))
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  ) then raise exception 'F16-05 SECURITY DEFINER function without empty search_path'; end if;

  -- Money helper: half-up rounding in minor units.
  if public.f16_round_half_up_div(200000, 3) <> 66667 or public.f16_round_half_up_div(100000, 3) <> 33333
     or public.f16_round_half_up_div(5, 2) <> 3 or public.f16_round_half_up_div(300000, 5) <> 60000 then
    raise exception 'F16-05 half-up rounding wrong';
  end if;
end
$acl$;

set local role authenticated;
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000001',true);

-- Definitions -------------------------------------------------------------------------
do $definitions$
declare
  v_pkg jsonb;
  v_replay jsonb;
begin
  v_pkg := public.create_service_package_guarded(
    'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000001',
    'f1654000-0000-4000-8000-000000000001','  5 Seans Lazer  ',5,90,100000
  );
  if v_pkg->>'name' <> '5 Seans Lazer' or (v_pkg->>'sessionCount')::int <> 5
     or (v_pkg->>'priceMinor')::int <> 100000 or (v_pkg->>'unitValueMinor')::int <> 20000
     or v_pkg->>'currency' <> 'TRY' or (v_pkg->>'version')::int <> 1 or v_pkg->>'serviceName' <> 'Lazer Seansı' then
    raise exception 'F16-05 package definition wrong: %', v_pkg;
  end if;
  v_replay := public.create_service_package_guarded(
    'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000001',
    'f1654000-0000-4000-8000-000000000001','5 Seans Lazer',5,90,100000
  );
  if v_replay <> v_pkg then raise exception 'F16-05 create replay changed result'; end if;

  begin
    perform public.create_service_package_guarded(
      'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000001',
      'f1654000-0000-4000-8000-000000000001','5 Seans Lazer',6,90,100000);
    raise exception 'F16-05 different payload reused a package id';
  exception when others then
    if sqlerrm <> 'PACKAGE_ID_CONFLICT' then raise; end if;
  end;

  -- Another tenant's service cannot back a package.
  begin
    perform public.create_service_package_guarded(
      'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-0000000000ff',
      'f1654000-0000-4000-8000-000000000003','Yabancı',5,90,100000);
    raise exception 'F16-05 foreign service accepted';
  exception when others then
    if sqlerrm <> 'SERVICE_NOT_FOUND' then raise; end if;
  end;

  begin
    perform public.create_service_package_guarded(
      'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-0000000000fe',
      'f1654000-0000-4000-8000-000000000001','X',0,90,100000);
    raise exception 'F16-05 invalid package accepted';
  exception when others then
    if sqlerrm <> 'INVALID_PACKAGE' then raise; end if;
  end;

  perform public.create_service_package_guarded(
    'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000002',
    'f1654000-0000-4000-8000-000000000001','3 Seans Lazer',3,30,100000);
  perform public.create_service_package_guarded(
    'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000003',
    'f1654000-0000-4000-8000-000000000001','2 Seans Lazer',2,30,50000);

  v_pkg := public.update_service_package_guarded(
    'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000003',
    1,'2 Seans Lazer',2,30,50000,false);
  if (v_pkg->>'active')::boolean or (v_pkg->>'version')::int <> 2 then raise exception 'F16-05 deactivate failed'; end if;
  v_replay := public.update_service_package_guarded(
    'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000003',
    1,'2 Seans Lazer',2,30,50000,false);
  if v_replay <> v_pkg then raise exception 'F16-05 update replay changed result'; end if;
  begin
    perform public.update_service_package_guarded(
      'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000003',
      1,'2 Seans Lazer',2,30,60000,true);
    raise exception 'F16-05 stale update accepted';
  exception when others then
    if sqlerrm <> 'STALE_PACKAGE_WRITE' then raise; end if;
  end;

  if jsonb_array_length(public.list_service_packages('f1651000-0000-4000-8000-000000000001', false)) <> 2
     or jsonb_array_length(public.list_service_packages('f1651000-0000-4000-8000-000000000001', true)) <> 3 then
    raise exception 'F16-05 package list filter wrong';
  end if;
end
$definitions$;

-- Staff without pricing permission can read but not define or sell packages.
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000002',true);
do $staff$
begin
  if jsonb_array_length(public.list_service_packages('f1651000-0000-4000-8000-000000000001', false)) <> 2 then
    raise exception 'F16-05 staff cannot read active packages';
  end if;
  begin
    perform public.create_service_package_guarded(
      'f1651000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-0000000000fd',
      'f1654000-0000-4000-8000-000000000001','Staff paketi',5,90,100000);
    raise exception 'F16-05 staff defined a package';
  exception when others then
    if sqlerrm <> 'FINANCIAL_PERMISSION_REQUIRED' then raise; end if;
  end;
  begin
    perform public.open_package_sale_guarded(
      'f1651000-0000-4000-8000-000000000001','f1653000-0000-4000-8000-000000000001',
      'f1655000-0000-4000-8000-000000000001',1,'f1605-staff-sale',repeat('0',64));
    raise exception 'F16-05 staff sold a package';
  exception when others then
    if sqlerrm <> 'FINANCIAL_PERMISSION_REQUIRED' then raise; end if;
  end;
end
$staff$;

-- A foreign owner cannot read or use salon A packages.
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000003',true);
do $foreign$
begin
  begin
    perform public.list_service_packages('f1651000-0000-4000-8000-000000000001', true);
    raise exception 'F16-05 foreign owner listed packages';
  exception when others then
    if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
  begin
    perform public.list_customer_packages('f1651000-0000-4000-8000-000000000001','f1653000-0000-4000-8000-000000000001',true);
    raise exception 'F16-05 foreign owner listed customer packages';
  exception when others then
    if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
end
$foreign$;

select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000001',true);

-- Sale and same-visit usage -----------------------------------------------------------
do $sale$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_replay jsonb;
  v_sale_line jsonb;
  v_service_line jsonb;
  v_customer_package uuid;
  v_payment uuid;
begin
  v_ticket := public.open_package_sale_guarded(
    v_business,'f1653000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000001',1,
    'f1605-sale-0001',repeat('1',64));
  v_replay := public.open_package_sale_guarded(
    v_business,'f1653000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000001',1,
    'f1605-sale-0001',repeat('1',64));
  if v_replay <> v_ticket then raise exception 'F16-05 sale replay changed result'; end if;
  v_sale_line := v_ticket->'lines'->0;
  if (v_ticket->>'totalMinor')::bigint <> 100000 or v_sale_line->>'sourceType' <> 'package'
     or v_sale_line->>'packageName' <> '5 Seans Lazer' or (v_sale_line->>'netMinor')::bigint <> 100000
     or (v_sale_line->'soldPackage'->>'sessionsTotal')::int <> 5
     or (v_sale_line->'soldPackage'->>'sessionsUsed')::int <> 0 then
    raise exception 'F16-05 package sale projection wrong: %', v_ticket;
  end if;
  v_customer_package := (v_sale_line->'soldPackage'->>'customerPackageId')::uuid;
  insert into f1605_ids values ('pkg5', v_customer_package), ('sale5', (v_ticket->>'ticketId')::uuid);

  -- Deactivated definitions cannot be sold; stale versions are refused.
  begin
    perform public.open_package_sale_guarded(
      v_business,'f1653000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000003',2,
      'f1605-sale-inactive',repeat('2',64));
    raise exception 'F16-05 inactive package sold';
  exception when others then
    if sqlerrm <> 'PACKAGE_INACTIVE' then raise; end if;
  end;
  begin
    perform public.add_ticket_package_line_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,'f1655000-0000-4000-8000-000000000002',
      (v_ticket->>'version')::int,9,'f1605-add-stale',repeat('3',64));
    raise exception 'F16-05 stale package version sold';
  exception when others then
    if sqlerrm <> 'STALE_PACKAGE_WRITE' then raise; end if;
  end;

  -- Buy and use the first session on the same visit.
  v_ticket := public.add_ticket_service_line_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_ticket->>'version')::int,'f1605-sale-service',repeat('4',64));
  v_service_line := v_ticket->'lines'->1;
  v_ticket := public.apply_ticket_package_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,(v_service_line->>'lineId')::uuid,v_customer_package,
    (v_ticket->>'version')::int,'f1605-sale-apply',repeat('5',64));
  v_service_line := v_ticket->'lines'->1;
  if (v_ticket->>'totalMinor')::bigint <> 100000 or (v_ticket->>'packageCoveredMinor')::bigint <> 30000
     or (v_service_line->>'netMinor')::bigint <> 0
     or v_service_line->'packageCoverage'->>'packageName' <> '5 Seans Lazer'
     or (v_service_line->'packageCoverage'->>'valueMinor')::int <> 20000
     or v_service_line->>'discountReason' <> 'Paket hakkı: 5 Seans Lazer'
     or (v_ticket->'lines'->0->'soldPackage'->>'sessionsUsed')::int <> 1 then
    raise exception 'F16-05 same-visit coverage wrong: %', v_ticket;
  end if;

  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,(v_service_line->>'lineId')::uuid,v_customer_package,
      (v_ticket->>'version')::int,'f1605-sale-apply-2',repeat('6',64));
    raise exception 'F16-05 line covered twice';
  exception when others then
    if sqlerrm <> 'LINE_ALREADY_COVERED' then raise; end if;
  end;

  -- The coverage cannot be edited as an ordinary discount.
  begin
    perform public.set_ticket_service_discount_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,(v_service_line->>'lineId')::uuid,1000,'Elle iskonto',
      (v_ticket->>'version')::int,'f1605-sale-discount',repeat('7',64));
    raise exception 'F16-05 covered line discount edited';
  exception when others then
    if sqlerrm <> 'LINE_COVERED_BY_PACKAGE' then raise; end if;
  end;

  v_ticket := public.record_ticket_payment_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'cash',100000,'f1605-sale-pay',repeat('8',64));
  v_ticket := public.close_ticket_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->>'version')::int,'f1605-sale-close',repeat('9',64));
  if v_ticket->>'status' <> 'closed' or (v_ticket->>'paidMinor')::bigint <> 100000 then
    raise exception 'F16-05 package sale did not close: %', v_ticket;
  end if;
  select (e->>'eventId')::uuid into v_payment from jsonb_array_elements(v_ticket->'paymentEvents') e limit 1;
  insert into f1605_ids values ('sale5_payment', v_payment);
end
$sale$;

-- Later sessions, rejections and reversal ---------------------------------------------
do $usage$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_pkg uuid := (select id from f1605_ids where name = 'pkg5');
  v_ticket jsonb;
  v_other jsonb;
  v_line uuid;
  v_range_line uuid;
  v_list jsonb;
begin
  v_ticket := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000001','f1605-t2-open',repeat('a',64));
  v_ticket := public.add_ticket_service_line_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_ticket->>'version')::int,'f1605-t2-add',repeat('b',64));
  v_line := (v_ticket->'lines'->0->>'lineId')::uuid;
  insert into f1605_ids values ('t2', (v_ticket->>'ticketId')::uuid), ('t2_line', v_line);

  -- Another customer's ticket cannot spend Ayşe's package.
  v_other := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000002','f1605-other-open',repeat('c',64));
  v_other := public.add_ticket_service_line_guarded(
    v_business,(v_other->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_other->>'version')::int,'f1605-other-add',repeat('d',64));
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_other->>'ticketId')::uuid,(v_other->'lines'->0->>'lineId')::uuid,v_pkg,
      (v_other->>'version')::int,'f1605-other-apply',repeat('e',64));
    raise exception 'F16-05 another customer used the package';
  exception when others then
    if sqlerrm <> 'PACKAGE_CUSTOMER_MISMATCH' then raise; end if;
  end;

  -- A different service is not covered.
  v_ticket := public.add_ticket_service_line_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000002',null,
    (v_ticket->>'version')::int,'f1605-t2-range',repeat('f',64));
  v_range_line := (v_ticket->'lines'->1->>'lineId')::uuid;
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_range_line,v_pkg,
      (v_ticket->>'version')::int,'f1605-t2-range-apply',repeat('0',63)||'1');
    raise exception 'F16-05 unfinalized/different service covered';
  exception when others then
    if sqlerrm <> 'SERVICE_PRICE_NOT_FINAL' then raise; end if;
  end;
  v_ticket := public.finalize_ticket_service_price_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,v_range_line,30000,'Orta bakım',
    (v_ticket->>'version')::int,'f1605-t2-final',repeat('0',63)||'2');
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_range_line,v_pkg,
      (v_ticket->>'version')::int,'f1605-t2-range-apply-2',repeat('0',63)||'3');
    raise exception 'F16-05 different service covered';
  exception when others then
    if sqlerrm <> 'PACKAGE_SERVICE_MISMATCH' then raise; end if;
  end;

  -- Stale ticket version is refused before any right is consumed.
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_line,v_pkg,1,'f1605-t2-stale',repeat('0',63)||'4');
    raise exception 'F16-05 stale apply accepted';
  exception when others then
    if sqlerrm <> 'STALE_WRITE' then raise; end if;
  end;

  v_ticket := public.apply_ticket_package_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,v_line,v_pkg,
    (v_ticket->>'version')::int,'f1605-t2-apply',repeat('0',63)||'5');
  if (v_ticket->>'totalMinor')::bigint <> 30000 then raise exception 'F16-05 second session total wrong: %', v_ticket; end if;

  v_ticket := public.reverse_ticket_package_usage_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,v_line,'Yanlış satır',
    (v_ticket->>'version')::int,'f1605-t2-reverse',repeat('0',63)||'6');
  if (v_ticket->>'totalMinor')::bigint <> 60000 or v_ticket->'lines'->0->'packageCoverage' <> 'null'::jsonb
     or (v_ticket->'lines'->0->>'discountMinor')::int <> 0 then
    raise exception 'F16-05 reversal did not restore the line: %', v_ticket;
  end if;
  begin
    perform public.reverse_ticket_package_usage_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_line,'Tekrar',
      (v_ticket->>'version')::int,'f1605-t2-reverse-2',repeat('0',63)||'7');
    raise exception 'F16-05 reversed twice';
  exception when others then
    if sqlerrm <> 'LINE_NOT_COVERED' then raise; end if;
  end;

  -- A manual discount must be removed before a package can cover the line.
  v_ticket := public.set_ticket_service_discount_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,v_line,5000,'Sadakat',
    (v_ticket->>'version')::int,'f1605-t2-discount',repeat('0',63)||'8');
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_line,v_pkg,
      (v_ticket->>'version')::int,'f1605-t2-apply-discounted',repeat('0',63)||'9');
    raise exception 'F16-05 discounted line covered';
  exception when others then
    if sqlerrm <> 'LINE_HAS_DISCOUNT' then raise; end if;
  end;
  v_ticket := public.set_ticket_service_discount_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,v_line,0,'Kaldır',
    (v_ticket->>'version')::int,'f1605-t2-discount-0',repeat('0',62)||'10');
  v_ticket := public.apply_ticket_package_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,v_line,v_pkg,
    (v_ticket->>'version')::int,'f1605-t2-apply-again',repeat('0',62)||'11');

  v_list := public.list_customer_packages(v_business,'f1653000-0000-4000-8000-000000000001',false);
  if jsonb_array_length(v_list) <> 1 or (v_list->0->>'sessionsUsed')::int <> 2
     or (v_list->0->>'sessionsRemaining')::int <> 3 or (v_list->0->>'refundPreviewMinor')::int <> 60000
     or (v_list->0->>'expired')::boolean or v_list->0->>'saleTicketStatus' <> 'closed'
     or jsonb_array_length(v_list->0->'usages') <> 4 then
    raise exception 'F16-05 customer package list wrong: %', v_list;
  end if;
end
$usage$;

-- Cross-tenant and unsettled package use ----------------------------------------------
do $boundaries$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_open_sale jsonb;
  v_line uuid;
begin
  v_open_sale := public.open_package_sale_guarded(
    v_business,'f1653000-0000-4000-8000-000000000001','f1655000-0000-4000-8000-000000000002',1,
    'f1605-open-sale',repeat('e',63)||'1');
  insert into f1605_ids values ('pkg3', (v_open_sale->'lines'->0->'soldPackage'->>'customerPackageId')::uuid),
    ('sale3', (v_open_sale->>'ticketId')::uuid);

  v_ticket := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000001','f1605-t3-open',repeat('e',63)||'2');
  v_ticket := public.add_ticket_service_line_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_ticket->>'version')::int,'f1605-t3-add',repeat('e',63)||'3');
  v_line := (v_ticket->'lines'->0->>'lineId')::uuid;
  insert into f1605_ids values ('t3', (v_ticket->>'ticketId')::uuid), ('t3_line', v_line);
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,v_line,(select id from f1605_ids where name = 'pkg3'),
      (v_ticket->>'version')::int,'f1605-t3-unsettled',repeat('e',63)||'4');
    raise exception 'F16-05 unpaid package used on another ticket';
  exception when others then
    if sqlerrm <> 'PACKAGE_SALE_NOT_SETTLED' then raise; end if;
  end;
end
$boundaries$;

select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000003',true);
do $foreign_use$
declare
  v_ticket jsonb;
begin
  -- Salon B owner cannot touch salon A tickets, and a salon A package id is
  -- not found from salon B's own ticket.
  begin
    perform public.apply_ticket_package_guarded(
      'f1651000-0000-4000-8000-000000000001',(select id from f1605_ids where name = 't3'),
      (select id from f1605_ids where name = 't3_line'),(select id from f1605_ids where name = 'pkg5'),
      1,'f1605-foreign-apply',repeat('f',63)||'1');
    raise exception 'F16-05 foreign owner applied a package';
  exception when others then
    if sqlerrm <> 'NOT_ALLOWED' then raise; end if;
  end;
  v_ticket := public.open_walk_in_ticket_guarded('f1651000-0000-4000-8000-000000000002','f1653000-0000-4000-8000-000000000003','f1605-b-open',repeat('f',63)||'2');
  v_ticket := public.add_ticket_service_line_guarded(
    'f1651000-0000-4000-8000-000000000002',(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000003',null,
    (v_ticket->>'version')::int,'f1605-b-add',repeat('f',63)||'3');
  begin
    perform public.apply_ticket_package_guarded(
      'f1651000-0000-4000-8000-000000000002',(v_ticket->>'ticketId')::uuid,(v_ticket->'lines'->0->>'lineId')::uuid,
      (select id from f1605_ids where name = 'pkg5'),(v_ticket->>'version')::int,'f1605-b-apply',repeat('f',63)||'4');
    raise exception 'F16-05 other business package accepted';
  exception when others then
    if sqlerrm <> 'PACKAGE_NOT_FOUND' then raise; end if;
  end;
end
$foreign_use$;
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000001',true);

-- Expired packages are refused (expiry is moved in the past by the test owner).
reset role;
alter table public.customer_packages disable trigger customer_packages_f16_guard;
update public.customer_packages
set created_at = now() - interval '40 days', expires_at = now() - interval '1 second'
where id = (select id from f1605_ids where name = 'pkg3');
alter table public.customer_packages enable trigger customer_packages_f16_guard;
set local role authenticated;
do $expired$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_ticket jsonb := public.get_ticket_contract(v_business, (select id from f1605_ids where name = 'sale3'));
begin
  v_ticket := public.add_ticket_service_line_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_ticket->>'version')::int,'f1605-expired-add',repeat('9',63)||'1');
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->'lines'->1->>'lineId')::uuid,
      (select id from f1605_ids where name = 'pkg3'),(v_ticket->>'version')::int,'f1605-expired-apply',repeat('9',63)||'2');
    raise exception 'F16-05 expired package used';
  exception when others then
    if sqlerrm <> 'PACKAGE_EXPIRED' then raise; end if;
  end;
end
$expired$;

-- Cancellation: an unused package sale is cancelled with its ticket; a covered
-- session on a cancelled ticket gives the right back.
do $cancel$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_list jsonb;
begin
  v_ticket := public.get_ticket_contract(v_business, (select id from f1605_ids where name = 'sale3'));
  v_ticket := public.cancel_ticket_guarded(v_business,(v_ticket->>'ticketId')::uuid,'Vazgeçti',
    (v_ticket->>'version')::int,'f1605-cancel-sale3',repeat('8',63)||'1');
  if v_ticket->'lines'->0->'soldPackage'->>'status' <> 'cancelled' then
    raise exception 'F16-05 unused package sale not cancelled: %', v_ticket;
  end if;

  v_ticket := public.get_ticket_contract(v_business, (select id from f1605_ids where name = 't2'));
  v_ticket := public.cancel_ticket_guarded(v_business,(v_ticket->>'ticketId')::uuid,'Müşteri gelmedi',
    (v_ticket->>'version')::int,'f1605-cancel-t2',repeat('8',63)||'2');
  v_list := public.list_customer_packages(v_business,'f1653000-0000-4000-8000-000000000001',true);
  if (select (x->>'sessionsUsed')::int from jsonb_array_elements(v_list) x where x->>'customerPackageId' = (select id::text from f1605_ids where name = 'pkg5')) <> 1 then
    raise exception 'F16-05 cancelled ticket did not give the session back: %', v_list;
  end if;
  if (select x->>'status' from jsonb_array_elements(v_list) x where x->>'customerPackageId' = (select id::text from f1605_ids where name = 'pkg3')) <> 'cancelled' then
    raise exception 'F16-05 closed packages missing from include-closed list';
  end if;
end
$cancel$;

-- Proportional refund: 5 sessions for 1.000 TL, 2 used -> 600 TL back ---------------------
do $refund$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_pkg uuid := (select id from f1605_ids where name = 'pkg5');
  v_payment uuid := (select id from f1605_ids where name = 'sale5_payment');
  v_ticket jsonb;
  v_t4 jsonb;
  v_t5 jsonb;
  v_result jsonb;
  v_replay jsonb;
begin
  -- Second session on a separate visit, settled and closed at total 0.
  v_t4 := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000001','f1605-t4-open',repeat('7',63)||'1');
  v_t4 := public.add_ticket_service_line_guarded(
    v_business,(v_t4->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_t4->>'version')::int,'f1605-t4-add',repeat('7',63)||'2');
  v_t4 := public.apply_ticket_package_guarded(
    v_business,(v_t4->>'ticketId')::uuid,(v_t4->'lines'->0->>'lineId')::uuid,v_pkg,
    (v_t4->>'version')::int,'f1605-t4-apply',repeat('7',63)||'3');
  v_t4 := public.close_ticket_guarded(v_business,(v_t4->>'ticketId')::uuid,(v_t4->>'version')::int,'f1605-t4-close',repeat('7',63)||'4');
  if (v_t4->>'totalMinor')::bigint <> 0 or v_t4->>'status' <> 'closed' then raise exception 'F16-05 covered visit did not close at 0: %', v_t4; end if;

  -- A session still on an open ticket blocks the refund.
  v_t5 := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000001','f1605-t5-open',repeat('7',63)||'5');
  v_t5 := public.add_ticket_service_line_guarded(
    v_business,(v_t5->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_t5->>'version')::int,'f1605-t5-add',repeat('7',63)||'6');
  v_t5 := public.apply_ticket_package_guarded(
    v_business,(v_t5->>'ticketId')::uuid,(v_t5->'lines'->0->>'lineId')::uuid,v_pkg,
    (v_t5->>'version')::int,'f1605-t5-apply',repeat('7',63)||'7');
  begin
    perform public.refund_customer_package_guarded(
      v_business,v_pkg,40000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',40000)),
      'Taşındı','f1605-refund-open',repeat('6',63)||'1');
    raise exception 'F16-05 refund ignored an open-ticket session';
  exception when others then
    if sqlerrm <> 'PACKAGE_USAGE_OPEN' then raise; end if;
  end;
  v_t5 := public.reverse_ticket_package_usage_guarded(
    v_business,(v_t5->>'ticketId')::uuid,(v_t5->'lines'->0->>'lineId')::uuid,'İade öncesi geri alındı',
    (v_t5->>'version')::int,'f1605-t5-reverse',repeat('7',63)||'8');

  begin
    perform public.refund_customer_package_guarded(
      v_business,v_pkg,50000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',50000)),
      'Taşındı','f1605-refund-wrong',repeat('6',63)||'2');
    raise exception 'F16-05 client refund amount accepted';
  exception when others then
    if sqlerrm <> 'PACKAGE_REFUND_CHANGED' then raise; end if;
  end;
  begin
    perform public.refund_customer_package_guarded(
      v_business,v_pkg,60000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',50000)),
      'Taşındı','f1605-refund-sum',repeat('6',63)||'3');
    raise exception 'F16-05 refund sources mismatch accepted';
  exception when others then
    if sqlerrm <> 'PACKAGE_REFUND_SOURCES_MISMATCH' then raise; end if;
  end;
  begin
    perform public.refund_customer_package_guarded(
      v_business,v_pkg,60000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',60000.5)),
      'Taşındı','f1605-refund-frac',repeat('6',63)||'4');
    raise exception 'F16-05 fractional refund accepted';
  exception when others then
    if sqlerrm <> 'INVALID_PACKAGE_REFUND' then raise; end if;
  end;

  v_result := public.refund_customer_package_guarded(
    v_business,v_pkg,60000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',60000)),
    'Taşındı','f1605-refund-ok',repeat('6',63)||'5');
  v_replay := public.refund_customer_package_guarded(
    v_business,v_pkg,60000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',60000)),
    'Taşındı','f1605-refund-ok',repeat('6',63)||'5');
  if v_replay <> v_result then raise exception 'F16-05 refund replay changed result'; end if;
  if (v_result->>'packageRefundedMinor')::bigint <> 60000 or (v_result->>'totalMinor')::bigint <> 40000
     or (v_result->>'paidMinor')::bigint <> 40000 or (v_result->>'balanceMinor')::bigint <> 0
     or v_result->'lines'->0->'soldPackage'->>'status' <> 'refunded'
     or (v_result->'lines'->0->'soldPackage'->>'refundedSessions')::int <> 3
     or (v_result->'lines'->0->'soldPackage'->>'refundValueMinor')::int <> 60000 then
    raise exception 'F16-05 proportional refund wrong: %', v_result;
  end if;

  begin
    perform public.refund_customer_package_guarded(
      v_business,v_pkg,0,'[]'::jsonb,'Tekrar','f1605-refund-again',repeat('6',63)||'6');
    raise exception 'F16-05 package refunded twice';
  exception when others then
    if sqlerrm <> 'PACKAGE_NOT_ACTIVE' then raise; end if;
  end;
  begin
    perform public.apply_ticket_package_guarded(
      v_business,(v_t5->>'ticketId')::uuid,(v_t5->'lines'->0->>'lineId')::uuid,v_pkg,
      (v_t5->>'version')::int,'f1605-t5-apply-refunded',repeat('7',63)||'9');
    raise exception 'F16-05 refunded package used';
  exception when others then
    if sqlerrm <> 'PACKAGE_NOT_ACTIVE' then raise; end if;
  end;
end
$refund$;

-- Split refund and rounding: 3 sessions for 1.000 TL, 1 used -> 666,67 TL back,
-- paid by cash + card, refunded across both sources.
do $split$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000001';
  v_ticket jsonb;
  v_pkg uuid;
  v_cash uuid;
  v_card uuid;
begin
  v_ticket := public.open_package_sale_guarded(
    v_business,'f1653000-0000-4000-8000-000000000002','f1655000-0000-4000-8000-000000000002',1,
    'f1605-split-sale',repeat('5',63)||'1');
  v_pkg := (v_ticket->'lines'->0->'soldPackage'->>'customerPackageId')::uuid;
  v_ticket := public.add_ticket_service_line_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000001',null,
    (v_ticket->>'version')::int,'f1605-split-add',repeat('5',63)||'2');
  v_ticket := public.apply_ticket_package_guarded(
    v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->'lines'->1->>'lineId')::uuid,v_pkg,
    (v_ticket->>'version')::int,'f1605-split-apply',repeat('5',63)||'3');
  if (v_ticket->'lines'->1->'packageCoverage'->>'valueMinor')::int <> 33333 then
    raise exception 'F16-05 unit value rounding wrong: %', v_ticket;
  end if;
  v_ticket := public.record_ticket_payment_guarded(v_business,(v_ticket->>'ticketId')::uuid,'cash',50000,'f1605-split-cash',repeat('5',63)||'4');
  v_ticket := public.record_ticket_payment_guarded(v_business,(v_ticket->>'ticketId')::uuid,'card',50000,'f1605-split-card',repeat('5',63)||'5');
  v_ticket := public.close_ticket_guarded(v_business,(v_ticket->>'ticketId')::uuid,(v_ticket->>'version')::int,'f1605-split-close',repeat('5',63)||'6');
  select (e->>'eventId')::uuid into v_cash from jsonb_array_elements(v_ticket->'paymentEvents') e where e->>'method' = 'cash';
  select (e->>'eventId')::uuid into v_card from jsonb_array_elements(v_ticket->'paymentEvents') e where e->>'method' = 'card';
  if (v_ticket->'lines'->0->'soldPackage'->>'refundPreviewMinor')::int <> 66667 then
    raise exception 'F16-05 refund preview rounding wrong: %', v_ticket;
  end if;
  begin
    perform public.refund_customer_package_guarded(
      v_business,v_pkg,66667,jsonb_build_array(jsonb_build_object('paymentEventId',v_cash,'amountMinor',66667)),
      'Kısmi','f1605-split-over',repeat('5',63)||'7');
    raise exception 'F16-05 refund above source accepted';
  exception when others then
    if sqlerrm <> 'REFUND_EXCEEDS_SOURCE' then raise; end if;
  end;
  v_ticket := public.refund_customer_package_guarded(
    v_business,v_pkg,66667,jsonb_build_array(
      jsonb_build_object('paymentEventId',v_cash,'amountMinor',50000),
      jsonb_build_object('paymentEventId',v_card,'amountMinor',16667)),
    'Kısmi','f1605-split-ok',repeat('5',63)||'8');
  if (v_ticket->>'totalMinor')::bigint <> 33333 or (v_ticket->>'paidMinor')::bigint <> 33333
     or jsonb_array_length(v_ticket->'paymentEvents') <> 4 then
    raise exception 'F16-05 split refund wrong: %', v_ticket;
  end if;
end
$split$;

-- Staff without payments permission cannot refund.
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000002',true);
do $staff_refund$
begin
  perform public.refund_customer_package_guarded(
    'f1651000-0000-4000-8000-000000000001',(select id from f1605_ids where name = 'pkg5'),0,'[]'::jsonb,
    'Yetkisiz','f1605-staff-refund',repeat('4',63)||'1');
  raise exception 'F16-05 staff refunded a package';
exception when others then
  if sqlerrm <> 'PAYMENTS_PERMISSION_REQUIRED' then raise; end if;
end
$staff_refund$;
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000001',true);

-- Ledger integrity and immutability ------------------------------------------------------
reset role;
do $ledger$
declare
  v_mismatch integer;
begin
  select count(*) into v_mismatch
  from public.customer_packages cp
  where cp.business_id = 'f1651000-0000-4000-8000-000000000001'
    and cp.sessions_used <> (
      select count(*) filter (where u.kind = 'use') - count(*) filter (where u.kind = 'reverse')
      from public.customer_package_usages u
      where u.business_id = cp.business_id and u.customer_package_id = cp.id
    );
  if v_mismatch <> 0 then raise exception 'F16-05 usage counter diverged from the ledger'; end if;

  if exists (
    select 1
    from public.customer_package_usages u
    join public.ticket_lines l on l.business_id = u.business_id and l.id = u.ticket_line_id
    where u.kind = 'use' and l.discount_minor <> l.final_unit_price_minor
      and not exists (
        select 1 from public.customer_package_usages r
        where r.business_id = u.business_id and r.reverses_usage_id = u.id and r.kind = 'reverse'
      )
  ) then raise exception 'F16-05 an active use row points at an uncovered line'; end if;

  begin
    update public.customer_package_usages set value_minor = 1 where business_id = 'f1651000-0000-4000-8000-000000000001';
    raise exception 'F16-05 usage ledger updated';
  exception when others then
    if sqlerrm <> 'PACKAGE_LEDGER_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.customer_package_usages where business_id = 'f1651000-0000-4000-8000-000000000001';
    raise exception 'F16-05 usage ledger deleted';
  exception when others then
    if sqlerrm <> 'PACKAGE_LEDGER_DELETE_FORBIDDEN' then raise; end if;
  end;
  begin
    update public.customer_packages set sessions_used = 0 where id = (select id from f1605_ids where name = 'pkg5');
    raise exception 'F16-05 refunded package changed';
  exception when others then
    if sqlerrm <> 'CUSTOMER_PACKAGE_CLOSED' then raise; end if;
  end;
  begin
    delete from public.customer_packages where id = (select id from f1605_ids where name = 'pkg5');
    raise exception 'F16-05 package deleted';
  exception when others then
    if sqlerrm <> 'CUSTOMER_PACKAGE_DELETE_FORBIDDEN' then raise; end if;
  end;
  begin
    insert into public.customer_package_usages(
      business_id, customer_package_id, kind, ticket_id, ticket_line_id, value_minor, actor_membership_id
    ) values (
      'f1651000-0000-4000-8000-000000000001',(select id from f1605_ids where name = 'pkg5'),'use',
      (select id from f1605_ids where name = 't3'),(select id from f1605_ids where name = 't3_line'),
      20000,'f1652000-0000-4000-8000-000000000001'
    );
    raise exception 'F16-05 use row inserted for an uncovered line';
  exception when others then
    if sqlerrm <> 'PACKAGE_USAGE_LINE_NOT_COVERED' then raise; end if;
  end;
end
$ledger$;

-- Day report: a package sale is income once; the covered session is not -----------
set local role authenticated;
select set_config('request.jwt.claim.sub','f1650000-0000-4000-8000-000000000004',true);
do $report$
declare
  v_business uuid := 'f1651000-0000-4000-8000-000000000003';
  v_sale jsonb;
  v_visit jsonb;
  v_paid_visit jsonb;
  v_pkg uuid;
  v_payment uuid;
  v_report jsonb;
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  perform public.create_service_package_guarded(
    v_business,'f1655000-0000-4000-8000-000000000031','f1654000-0000-4000-8000-000000000004','Rapor 5 Seans',5,90,100000);
  v_sale := public.open_package_sale_guarded(
    v_business,'f1653000-0000-4000-8000-000000000004','f1655000-0000-4000-8000-000000000031',1,
    'f1605-report-sale',repeat('3',63)||'1');
  v_pkg := (v_sale->'lines'->0->'soldPackage'->>'customerPackageId')::uuid;
  v_sale := public.record_ticket_payment_guarded(v_business,(v_sale->>'ticketId')::uuid,'cash',100000,'f1605-report-pay',repeat('3',63)||'2');
  v_sale := public.close_ticket_guarded(v_business,(v_sale->>'ticketId')::uuid,(v_sale->>'version')::int,'f1605-report-close',repeat('3',63)||'3');
  select (e->>'eventId')::uuid into v_payment from jsonb_array_elements(v_sale->'paymentEvents') e limit 1;

  v_visit := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000004','f1605-report-visit',repeat('3',63)||'4');
  v_visit := public.add_ticket_service_line_guarded(
    v_business,(v_visit->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000004',null,
    (v_visit->>'version')::int,'f1605-report-visit-add',repeat('3',63)||'5');
  v_visit := public.apply_ticket_package_guarded(
    v_business,(v_visit->>'ticketId')::uuid,(v_visit->'lines'->0->>'lineId')::uuid,v_pkg,
    (v_visit->>'version')::int,'f1605-report-visit-apply',repeat('3',63)||'6');
  v_visit := public.close_ticket_guarded(v_business,(v_visit->>'ticketId')::uuid,(v_visit->>'version')::int,'f1605-report-visit-close',repeat('3',63)||'7');

  v_paid_visit := public.open_walk_in_ticket_guarded(v_business,'f1653000-0000-4000-8000-000000000004','f1605-report-paid',repeat('3',63)||'8');
  v_paid_visit := public.add_ticket_service_line_guarded(
    v_business,(v_paid_visit->>'ticketId')::uuid,'f1654000-0000-4000-8000-000000000004',null,
    (v_paid_visit->>'version')::int,'f1605-report-paid-add',repeat('3',63)||'9');
  v_paid_visit := public.record_ticket_payment_guarded(v_business,(v_paid_visit->>'ticketId')::uuid,'card',30000,'f1605-report-paid-pay',repeat('2',63)||'1');

  v_report := public.get_financial_day_report(v_business, v_today, v_today);
  if (v_report->>'packageSaleMinor')::bigint <> 100000
     or (v_report->>'serviceSaleMinor')::bigint <> 30000
     or (v_report->>'saleValueMinor')::bigint <> 130000
     or (v_report->>'collectedMinor')::bigint <> 130000
     or (v_report->>'outstandingMinor')::bigint <> 0
     or (v_report->>'packageCoveredSessionCount')::int <> 1
     or (v_report->>'packageCoveredValueMinor')::bigint <> 20000 then
    raise exception 'F16-05 day report counted package usage as income: %', v_report;
  end if;

  -- Refund the 4 unused sessions: 80.000 back, package income becomes 20.000.
  perform public.refund_customer_package_guarded(
    v_business,v_pkg,80000,jsonb_build_array(jsonb_build_object('paymentEventId',v_payment,'amountMinor',80000)),
    'Rapor iadesi','f1605-report-refund',repeat('2',63)||'2');
  v_report := public.get_financial_day_report(v_business, v_today, v_today);
  if (v_report->>'packageSaleMinor')::bigint <> 20000
     or (v_report->>'refundMinor')::bigint <> 80000
     or (v_report->>'paymentNetMinor')::bigint <> 50000
     or (v_report->>'saleValueMinor')::bigint <> 50000
     or (v_report->>'outstandingMinor')::bigint <> 0 then
    raise exception 'F16-05 day report after package refund wrong: %', v_report;
  end if;
end
$report$;

reset role;
select 'F16-05 service packages acceptance passed' as result;
rollback;
