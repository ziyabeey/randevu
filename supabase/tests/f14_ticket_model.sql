begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('e1400000-0000-4000-8000-000000000001','f1402-owner@example.invalid','{}'::jsonb),
  ('e1400000-0000-4000-8000-000000000002','f1402-manager@example.invalid','{}'::jsonb),
  ('e1400000-0000-4000-8000-000000000003','f1402-staff@example.invalid','{}'::jsonb),
  ('e1400000-0000-4000-8000-000000000004','f1402-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('e1410000-0000-4000-8000-000000000001','F14-02 Salon A','f1402-salon-a','Europe/Istanbul','e1400000-0000-4000-8000-000000000001'),
  ('e1410000-0000-4000-8000-000000000002','F14-02 Salon B','f1402-salon-b','Europe/Istanbul','e1400000-0000-4000-8000-000000000004');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('e1420000-0000-4000-8000-000000000001','e1410000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000001','owner',true),
  ('e1420000-0000-4000-8000-000000000002','e1410000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000002','manager',true),
  ('e1420000-0000-4000-8000-000000000003','e1410000-0000-4000-8000-000000000001','e1400000-0000-4000-8000-000000000003','staff',true),
  ('e1420000-0000-4000-8000-000000000004','e1410000-0000-4000-8000-000000000002','e1400000-0000-4000-8000-000000000004','owner',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('e1430000-0000-4000-8000-000000000001','e1410000-0000-4000-8000-000000000001','F14 Müşteri A','05550000001','f14-a@example.invalid','e1400000-0000-4000-8000-000000000001'),
  ('e1430000-0000-4000-8000-000000000002','e1410000-0000-4000-8000-000000000002','F14 Müşteri B','05550000002','f14-b@example.invalid','e1400000-0000-4000-8000-000000000004');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('e1440000-0000-4000-8000-000000000001','e1410000-0000-4000-8000-000000000001','F14 Boya',60,0,0,'Renk',10,null,'range',20000,35000,'TRY',true),
  ('e1440000-0000-4000-8000-000000000002','e1410000-0000-4000-8000-000000000001','F14 Kesim',30,0,0,'Genel',20,15000,'fixed',15000,15000,'TRY',true),
  ('e1440000-0000-4000-8000-000000000003','e1410000-0000-4000-8000-000000000002','F14 B Hizmet',30,0,0,'Genel',10,12000,'fixed',12000,12000,'TRY',true);

insert into public.staff_profiles(id,business_id,name,active)
values
  ('e1450000-0000-4000-8000-000000000001','e1410000-0000-4000-8000-000000000001','F14 Ayla',true),
  ('e1450000-0000-4000-8000-000000000002','e1410000-0000-4000-8000-000000000002','F14 Bora',true);

insert into public.staff_services(business_id,staff_id,service_id,active)
values
  ('e1410000-0000-4000-8000-000000000001','e1450000-0000-4000-8000-000000000001','e1440000-0000-4000-8000-000000000001',true),
  ('e1410000-0000-4000-8000-000000000001','e1450000-0000-4000-8000-000000000001','e1440000-0000-4000-8000-000000000002',true),
  ('e1410000-0000-4000-8000-000000000002','e1450000-0000-4000-8000-000000000002','e1440000-0000-4000-8000-000000000003',true);

insert into public.business_hours(business_id,weekday,starts_local,ends_local,active)
select 'e1410000-0000-4000-8000-000000000001',
       extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
       time '09:00',time '18:00',true;

insert into public.staff_hours(business_id,staff_id,weekday,starts_local,ends_local,active)
select 'e1410000-0000-4000-8000-000000000001'::uuid,
       'e1450000-0000-4000-8000-000000000001'::uuid,
       extract(dow from (date_trunc('week',current_date)::date+7))::smallint,
       time '09:00',time '18:00',true;

-- S08/ACL boundary: raw financial tables stay inaccessible to API roles.
do $$
begin
  if has_table_privilege('authenticated','public.tickets','SELECT')
     or has_table_privilege('authenticated','public.ticket_lines','SELECT')
     or has_table_privilege('authenticated','public.ticket_commands','SELECT')
     or has_table_privilege('anon','public.tickets','SELECT') then
    raise exception 'F14 ticket tables unexpectedly exposed to API roles';
  end if;

  if not has_function_privilege(
      'authenticated','public.open_ticket_from_booking_group_guarded(uuid,uuid,text,text)','EXECUTE'
    )
    or not has_function_privilege(
      'authenticated','public.open_walk_in_ticket_guarded(uuid,uuid,text,text)','EXECUTE'
    )
    or has_function_privilege(
      'anon','public.open_walk_in_ticket_guarded(uuid,uuid,text,text)','EXECUTE'
    ) then
    raise exception 'F14 ticket RPC grants are wrong';
  end if;
end
$$;

-- Build one two-service reservation through the accepted F11 authority.
set local role authenticated;
select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_day date := date_trunc('week',current_date)::date+7;
  v_group jsonb;
begin
  v_group := public.create_appointment_group(
    'e1410000-0000-4000-8000-000000000001',
    'f1402-booking-group-0001',
    'F14 Müşteri A',
    '[
      {"serviceId":"e1440000-0000-4000-8000-000000000001","staffId":"e1450000-0000-4000-8000-000000000001"},
      {"serviceId":"e1440000-0000-4000-8000-000000000002","staffId":"e1450000-0000-4000-8000-000000000001"}
    ]'::jsonb,
    (v_day + time '10:00') at time zone 'Europe/Istanbul',
    '05550000001',
    'f14-a@example.invalid'
  );
  perform set_config('f1402.group_id',v_group->>'groupId',false);
end
$$;

-- Open from booking group. Range price stays unfinalized; fixed price is exact.
do $$
declare
  v_result jsonb;
  v_replay jsonb;
  v_second_key jsonb;
  v_ticket uuid;
  v_range_line uuid;
  v_fixed_line uuid;
  v_conflict boolean := false;
begin
  v_result := public.open_ticket_from_booking_group_guarded(
    'e1410000-0000-4000-8000-000000000001',
    current_setting('f1402.group_id')::uuid,
    'f1402-open-group-0001',
    repeat('a',64)
  );

  v_ticket := (v_result->>'ticketId')::uuid;
  perform set_config('f1402.ticket_id',v_ticket::text,false);

  if v_result->>'source' <> 'booking_group'
     or v_result->>'status' <> 'open'
     or (v_result->>'version')::int <> 1
     or (v_result->>'settlementReady')::boolean
     or v_result->>'paymentStatus' <> 'unpaid'
     or (v_result->>'paidMinor')::int <> 0
     or jsonb_array_length(v_result->'lines') <> 2 then
    raise exception 'F14 booking-group ticket initial projection is wrong: %',v_result;
  end if;

  select (line->>'lineId')::uuid into v_range_line
  from jsonb_array_elements(v_result->'lines') line
  where line->>'priceType' = 'range';
  select (line->>'lineId')::uuid into v_fixed_line
  from jsonb_array_elements(v_result->'lines') line
  where line->>'priceType' = 'fixed';

  if v_range_line is null or v_fixed_line is null then
    raise exception 'F14 ticket lost range/fixed service identity';
  end if;
  perform set_config('f1402.range_line',v_range_line::text,false);

  if (
    select (line->'finalUnitPriceMinor') is not null and (line->'finalUnitPriceMinor') <> 'null'::jsonb
    from jsonb_array_elements(v_result->'lines') line
    where (line->>'lineId')::uuid = v_range_line
  ) then
    raise exception 'F14 range line was silently finalized';
  end if;

  if (
    select (line->>'finalUnitPriceMinor')::int <> 15000
    from jsonb_array_elements(v_result->'lines') line
    where (line->>'lineId')::uuid = v_fixed_line
  ) then
    raise exception 'F14 fixed line did not preserve exact booking snapshot';
  end if;

  v_replay := public.open_ticket_from_booking_group_guarded(
    'e1410000-0000-4000-8000-000000000001',
    current_setting('f1402.group_id')::uuid,
    'f1402-open-group-0001',
    repeat('a',64)
  );
  if v_replay <> v_result then raise exception 'F14 same-key replay changed result'; end if;

  begin
    perform public.open_ticket_from_booking_group_guarded(
      'e1410000-0000-4000-8000-000000000001',
      current_setting('f1402.group_id')::uuid,
      'f1402-open-group-0001',
      repeat('b',64)
    );
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm) > 0 then v_conflict := true; else raise; end if;
  end;
  if not v_conflict then raise exception 'F14 same key accepted a different request hash'; end if;

  v_second_key := public.open_ticket_from_booking_group_guarded(
    'e1410000-0000-4000-8000-000000000001',
    current_setting('f1402.group_id')::uuid,
    'f1402-open-group-0002',
    repeat('c',64)
  );
  if v_second_key->>'ticketId' <> v_ticket::text then
    raise exception 'F14 second valid key created a duplicate booking ticket';
  end if;

  if (
    select count(*) from public.tickets
    where business_id='e1410000-0000-4000-8000-000000000001'
      and appointment_group_id=current_setting('f1402.group_id')::uuid
  ) <> 1 then
    raise exception 'F14 booking group has more than one ticket';
  end if;
end
$$;

reset role;

-- Even postgres cannot silently rewrite an open line's source snapshot.
do $$
declare
  v_raised boolean := false;
begin
  begin
    update public.ticket_lines
    set service_name_snapshot='Sessiz Rewrite'
    where business_id='e1410000-0000-4000-8000-000000000001'
      and id=current_setting('f1402.range_line')::uuid;
  exception when others then
    if position('TICKET_LINE_SOURCE_IMMUTABLE' in sqlerrm) > 0 then v_raised := true; else raise; end if;
  end;
  if not v_raised then raise exception 'F14 open ticket source snapshot was mutable'; end if;
end
$$;

-- Exact range finalization + discount make the ticket settlement-ready, but payment stays separate.
set local role authenticated;
select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_result jsonb;
begin
  v_result := public.finalize_ticket_service_price_guarded(
    'e1410000-0000-4000-8000-000000000001',
    current_setting('f1402.ticket_id')::uuid,
    current_setting('f1402.range_line')::uuid,
    25000,
    'Gerçekleşen hizmet bedeli',
    1,
    'f1402-finalize-0001',
    repeat('d',64)
  );

  if not (v_result->>'settlementReady')::boolean
     or (v_result->>'version')::int <> 2
     or (v_result->>'subtotalMinor')::int <> 40000
     or (v_result->>'totalMinor')::int <> 40000
     or v_result->>'paymentStatus' <> 'unpaid'
     or (v_result->>'balanceMinor')::int <> 40000 then
    raise exception 'F14 finalized ticket totals are wrong: %',v_result;
  end if;

  v_result := public.set_ticket_service_discount_guarded(
    'e1410000-0000-4000-8000-000000000001',
    current_setting('f1402.ticket_id')::uuid,
    current_setting('f1402.range_line')::uuid,
    5000,
    'Sadakat indirimi',
    2,
    'f1402-discount-0001',
    repeat('e',64)
  );

  if (v_result->>'version')::int <> 3
     or (v_result->>'discountMinor')::int <> 5000
     or (v_result->>'totalMinor')::int <> 35000
     or (v_result->>'balanceMinor')::int <> 35000 then
    raise exception 'F14 discount projection is wrong: %',v_result;
  end if;

  v_result := public.close_ticket_guarded(
    'e1410000-0000-4000-8000-000000000001',
    current_setting('f1402.ticket_id')::uuid,
    3,
    'f1402-close-0001',
    repeat('f',64)
  );

  if v_result->>'status' <> 'closed' or (v_result->>'version')::int <> 4 then
    raise exception 'F14 ticket did not close immutably';
  end if;
end
$$;

-- Closed financial source cannot be changed or deleted.
reset role;
do $$
declare
  v_update_raised boolean := false;
  v_delete_raised boolean := false;
begin
  begin
    update public.ticket_lines
    set discount_minor=0,discount_by_membership_id=null,discount_at=null,discount_reason=null
    where business_id='e1410000-0000-4000-8000-000000000001'
      and id=current_setting('f1402.range_line')::uuid;
  exception when others then
    if position('TICKET_IMMUTABLE' in sqlerrm) > 0 then v_update_raised := true; else raise; end if;
  end;

  begin
    delete from public.tickets
    where business_id='e1410000-0000-4000-8000-000000000001'
      and id=current_setting('f1402.ticket_id')::uuid;
  exception when others then
    if position('TICKET_DELETE_FORBIDDEN' in sqlerrm) > 0 then v_delete_raised := true; else raise; end if;
  end;

  if not v_update_raised or not v_delete_raised then
    raise exception 'F14 closed ticket immutability/delete guard failed';
  end if;
end
$$;

-- Walk-in path: fixed service finalizes immediately; range stays unresolved until explicit price.
set local role authenticated;
select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_result jsonb;
  v_ticket uuid;
  v_range_line uuid;
  v_invalid boolean := false;
begin
  v_result := public.open_walk_in_ticket_guarded(
    'e1410000-0000-4000-8000-000000000001',
    'e1430000-0000-4000-8000-000000000001',
    'f1402-walkin-open-0001',
    repeat('1',64)
  );
  v_ticket := (v_result->>'ticketId')::uuid;
  perform set_config('f1402.walkin_ticket',v_ticket::text,false);

  if (v_result->>'settlementReady')::boolean or jsonb_array_length(v_result->'lines') <> 0 then
    raise exception 'F14 empty walk-in ticket should not be settlement-ready';
  end if;

  v_result := public.add_ticket_service_line_guarded(
    'e1410000-0000-4000-8000-000000000001',
    v_ticket,
    'e1440000-0000-4000-8000-000000000002',
    'e1450000-0000-4000-8000-000000000001',
    1,
    'f1402-walkin-fixed-0001',
    repeat('2',64)
  );
  if not (v_result->>'settlementReady')::boolean
     or (v_result->>'totalMinor')::int <> 15000
     or v_result->>'currency' <> 'TRY'
     or (v_result->>'version')::int <> 2 then
    raise exception 'F14 fixed walk-in line projection is wrong: %',v_result;
  end if;

  v_result := public.add_ticket_service_line_guarded(
    'e1410000-0000-4000-8000-000000000001',
    v_ticket,
    'e1440000-0000-4000-8000-000000000001',
    'e1450000-0000-4000-8000-000000000001',
    2,
    'f1402-walkin-range-0001',
    repeat('3',64)
  );
  if (v_result->>'settlementReady')::boolean or (v_result->>'version')::int <> 3 then
    raise exception 'F14 range walk-in line was silently finalized';
  end if;

  select (line->>'lineId')::uuid into v_range_line
  from jsonb_array_elements(v_result->'lines') line
  where line->>'priceType'='range';
  perform set_config('f1402.walkin_range_line',v_range_line::text,false);

  begin
    perform public.finalize_ticket_service_price_guarded(
      'e1410000-0000-4000-8000-000000000001',
      v_ticket,v_range_line,40000,null,3,
      'f1402-range-no-reason',
      repeat('4',64)
    );
  exception when others then
    if position('INVALID_FINAL_PRICE' in sqlerrm) > 0 then v_invalid := true; else raise; end if;
  end;
  if not v_invalid then raise exception 'F14 range finalization accepted no reason'; end if;

  v_result := public.finalize_ticket_service_price_guarded(
    'e1410000-0000-4000-8000-000000000001',
    v_ticket,v_range_line,40000,'Aralık dışı özel işlem',3,
    'f1402-range-outside-0001',
    repeat('5',64)
  );
  if not (v_result->>'settlementReady')::boolean
     or (v_result->>'totalMinor')::int <> 55000
     or (v_result->>'version')::int <> 4 then
    raise exception 'F14 outside-range finalization did not preserve explicit audited result';
  end if;
end
$$;

-- Cross-tenant customer IDs fail before any ticket is created.
do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.open_walk_in_ticket_guarded(
      'e1410000-0000-4000-8000-000000000001',
      'e1430000-0000-4000-8000-000000000002',
      'f1402-cross-tenant',
      repeat('6',64)
    );
  exception when others then
    if position('CUSTOMER_NOT_FOUND' in sqlerrm) > 0 then v_raised := true; else raise; end if;
  end;
  if not v_raised then raise exception 'F14 accepted cross-tenant customer'; end if;
end
$$;

-- Staff is denied until owner grants pricing_adjustments_write.
select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.open_walk_in_ticket_guarded(
      'e1410000-0000-4000-8000-000000000001',
      'e1430000-0000-4000-8000-000000000001',
      'f1402-staff-denied',
      repeat('7',64)
    );
  exception when insufficient_privilege then
    if position('FINANCIAL_PERMISSION_REQUIRED' in sqlerrm) > 0 then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'F14 staff wrote financial ticket without grant'; end if;
end
$$;

select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',true);
select public.set_membership_financial_permission(
  'e1410000-0000-4000-8000-000000000001',
  'e1420000-0000-4000-8000-000000000003',
  'pricing_adjustments_write',
  true
);

select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000003',true);
do $$
declare
  v_result jsonb;
begin
  v_result := public.open_walk_in_ticket_guarded(
    'e1410000-0000-4000-8000-000000000001',
    'e1430000-0000-4000-8000-000000000001',
    'f1402-staff-granted',
    repeat('8',64)
  );
  perform set_config('f1402.staff_ticket',v_result->>'ticketId',false);
end
$$;

select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000001',true);
select public.set_membership_financial_permission(
  'e1410000-0000-4000-8000-000000000001',
  'e1420000-0000-4000-8000-000000000003',
  'pricing_adjustments_write',
  false
);

select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000003',true);
do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.add_ticket_service_line_guarded(
      'e1410000-0000-4000-8000-000000000001',
      current_setting('f1402.staff_ticket')::uuid,
      'e1440000-0000-4000-8000-000000000002',
      null,1,
      'f1402-staff-revoked',
      repeat('9',64)
    );
  exception when insufficient_privilege then
    if position('FINANCIAL_PERMISSION_REQUIRED' in sqlerrm) > 0 then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'F14 revoked staff financial permission remained writable'; end if;
end
$$;

-- Manager has the existing F10-02 effective permission without an explicit staff grant.
select set_config('request.jwt.claim.sub','e1400000-0000-4000-8000-000000000002',true);
do $$
declare
  v_result jsonb;
begin
  v_result := public.open_walk_in_ticket_guarded(
    'e1410000-0000-4000-8000-000000000001',
    'e1430000-0000-4000-8000-000000000001',
    'f1402-manager-open',
    repeat('0',64)
  );
  if v_result->>'ticketId' is null then
    raise exception 'F14 manager effective financial permission was not honored';
  end if;
end
$$;

reset role;

raise notice 'F14-02 ticket model, permission, idempotency, pricing and immutability acceptance passed';

rollback;
