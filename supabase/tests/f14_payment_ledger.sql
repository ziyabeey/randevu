begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1600000-0000-4000-8000-000000000001','f1403-owner@example.invalid','{}'::jsonb),
  ('f1600000-0000-4000-8000-000000000002','f1403-manager@example.invalid','{}'::jsonb),
  ('f1600000-0000-4000-8000-000000000003','f1403-staff@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'f1610000-0000-4000-8000-000000000001',
  'F14-03 Salon',
  'f1403-salon',
  'Europe/Istanbul',
  'f1600000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1620000-0000-4000-8000-000000000001','f1610000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000001','owner',true),
  ('f1620000-0000-4000-8000-000000000002','f1610000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000002','manager',true),
  ('f1620000-0000-4000-8000-000000000003','f1610000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000003','staff',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values (
  'f1630000-0000-4000-8000-000000000001',
  'f1610000-0000-4000-8000-000000000001',
  'F14-03 Müşteri',
  '05556660000',
  'f1403@example.invalid',
  'f1600000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values
  ('f1640000-0000-4000-8000-000000000001','f1610000-0000-4000-8000-000000000001',
   'F14-03 600 TL Hizmet',60,0,0,'Genel',10,60000,'fixed',60000,60000,'TRY',true),
  ('f1640000-0000-4000-8000-000000000002','f1610000-0000-4000-8000-000000000001',
   'F14-03 Ek Hizmet',30,0,0,'Genel',20,10000,'fixed',10000,10000,'TRY',true);

-- Raw financial ledger remains closed to API roles.
do $f1403acl$
begin
  if has_table_privilege('authenticated','public.ticket_payment_events','SELECT')
     or has_table_privilege('authenticated','public.ticket_payment_events','INSERT')
     or has_table_privilege('anon','public.ticket_payment_events','SELECT') then
    raise exception 'F14-03 payment ledger unexpectedly exposed to API roles';
  end if;

  if not has_function_privilege(
      'authenticated','public.record_ticket_payment_guarded(uuid,uuid,text,integer,text,text)','EXECUTE'
    )
    or has_function_privilege(
      'anon','public.record_ticket_payment_guarded(uuid,uuid,text,integer,text,text)','EXECUTE'
    ) then
    raise exception 'F14-03 payment RPC grants are wrong';
  end if;
end
$f1403acl$;

-- Retention/search-path hardening is a financial invariant, not an implementation detail.
do $f1403hardening$
declare
  v_bad_cascade integer;
  v_bad_search_path integer;
begin
  select count(*)::integer
  into v_bad_cascade
  from pg_constraint c
  where c.contype = 'f'
    and c.conrelid = 'public.ticket_payment_events'::regclass
    and c.confrelid = 'public.businesses'::regclass
    and c.confdeltype = 'c';

  if v_bad_cascade <> 0 then
    raise exception 'F14-03 payment ledger unexpectedly cascades with business deletion';
  end if;

  select count(*)::integer
  into v_bad_search_path
  from pg_proc p
  where p.oid in (
      'public.f14_guard_payment_event_change()'::regprocedure,
      'public.f14_guard_ticket_line_insert_after_payment()'::regprocedure
    )
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) cfg
      where split_part(cfg, '=', 1) = 'search_path'
        and split_part(cfg, '=', 2) in ('', '""')
    );

  if v_bad_search_path <> 0 then
    raise exception 'F14-03 trigger guard search_path is not empty for % functions', v_bad_search_path;
  end if;
end
$f1403hardening$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

-- Owner creates a 600 TL settlement-ready walk-in ticket.
do $f1403setup$
declare
  v_ticket jsonb;
begin
  v_ticket := public.open_walk_in_ticket_guarded(
    'f1610000-0000-4000-8000-000000000001',
    'f1630000-0000-4000-8000-000000000001',
    'f1403-open-main',
    repeat('1',64)
  );

  v_ticket := public.add_ticket_service_line_guarded(
    'f1610000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'f1640000-0000-4000-8000-000000000001',
    null,
    1,
    'f1403-add-main',
    repeat('2',64)
  );

  if not (v_ticket->>'settlementReady')::boolean
     or (v_ticket->>'totalMinor')::int <> 60000
     or (v_ticket->>'paidMinor')::int <> 0
     or (v_ticket->>'balanceMinor')::int <> 60000 then
    raise exception 'F14-03 initial ticket projection is wrong: %',v_ticket;
  end if;

  perform set_config('f1403.main_ticket',v_ticket->>'ticketId',false);
end
$f1403setup$;

-- 200 cash + 400 card settles 600 exactly. Same key replays, different hash conflicts.
do $f1403pay$
declare
  v_cash jsonb;
  v_cash_replay jsonb;
  v_card jsonb;
  v_conflict boolean := false;
  v_cash_id uuid;
  v_card_id uuid;
begin
  v_cash := public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    'cash',
    20000,
    'f1403-cash-0001',
    repeat('3',64)
  );

  if v_cash->>'paymentStatus' <> 'partial'
     or (v_cash->>'paidMinor')::int <> 20000
     or (v_cash->>'balanceMinor')::int <> 40000 then
    raise exception 'F14-03 cash payment projection is wrong: %',v_cash;
  end if;

  v_cash_replay := public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    'cash',
    20000,
    'f1403-cash-0001',
    repeat('3',64)
  );
  if v_cash_replay <> v_cash then
    raise exception 'F14-03 same payment key changed result';
  end if;

  begin
    perform public.record_ticket_payment_guarded(
      'f1610000-0000-4000-8000-000000000001',
      current_setting('f1403.main_ticket')::uuid,
      'cash',
      20000,
      'f1403-cash-0001',
      repeat('4',64)
    );
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm) > 0 then
      v_conflict := true;
    else
      raise;
    end if;
  end;
  if not v_conflict then
    raise exception 'F14-03 payment key accepted different payload hash';
  end if;

  v_card := public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    'card',
    40000,
    'f1403-card-0001',
    repeat('5',64)
  );

  if v_card->>'paymentStatus' <> 'paid'
     or (v_card->>'paidMinor')::int <> 60000
     or (v_card->>'balanceMinor')::int <> 0
     or jsonb_array_length(v_card->'paymentEvents') <> 2 then
    raise exception 'F14-03 split payment projection is wrong: %',v_card;
  end if;

  select (e->>'eventId')::uuid into v_cash_id
  from jsonb_array_elements(v_card->'paymentEvents') e
  where e->>'eventType'='payment' and e->>'method'='cash';

  select (e->>'eventId')::uuid into v_card_id
  from jsonb_array_elements(v_card->'paymentEvents') e
  where e->>'eventType'='payment' and e->>'method'='card';

  perform set_config('f1403.cash_payment',v_cash_id::text,false);
  perform set_config('f1403.card_payment',v_card_id::text,false);
end
$f1403pay$;

-- Fully paid ticket closes. Refund/payment can continue append-only after close, without reopen.
do $f1403closed$
declare
  v_result jsonb;
begin
  v_result := public.close_ticket_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    2,
    'f1403-close-main',
    repeat('6',64)
  );
  if v_result->>'status' <> 'closed'
     or v_result->>'paymentStatus' <> 'paid'
     or (v_result->>'balanceMinor')::int <> 0 then
    raise exception 'F14-03 fully paid ticket did not close correctly: %',v_result;
  end if;

  v_result := public.record_ticket_refund_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    current_setting('f1403.card_payment')::uuid,
    10000,
    'Müşteri iadesi',
    'f1403-refund-0001',
    repeat('7',64)
  );
  if v_result->>'status' <> 'closed'
     or v_result->>'paymentStatus' <> 'partial'
     or (v_result->>'paidMinor')::int <> 50000
     or (v_result->>'balanceMinor')::int <> 10000 then
    raise exception 'F14-03 closed-ticket refund projection is wrong: %',v_result;
  end if;

  v_result := public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    'card',
    10000,
    'f1403-resettle-0001',
    repeat('8',64)
  );
  if v_result->>'status' <> 'closed'
     or v_result->>'paymentStatus' <> 'paid'
     or (v_result->>'balanceMinor')::int <> 0 then
    raise exception 'F14-03 closed ticket did not re-settle without reopen: %',v_result;
  end if;
end
$f1403closed$;

-- Correction uses separate event type and source payment reference.
do $f1403correction$
declare
  v_result jsonb;
begin
  v_result := public.record_ticket_correction_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    current_setting('f1403.cash_payment')::uuid,
    'decrease',
    5000,
    'Fazla nakit kaydı',
    'f1403-correct-down',
    repeat('9',64)
  );
  if (v_result->>'paidMinor')::int <> 55000
     or (v_result->>'balanceMinor')::int <> 5000 then
    raise exception 'F14-03 correction decrease projection is wrong: %',v_result;
  end if;

  v_result := public.record_ticket_correction_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    current_setting('f1403.cash_payment')::uuid,
    'increase',
    5000,
    'Eksik nakit düzeltmesi',
    'f1403-correct-up',
    repeat('a',64)
  );
  if (v_result->>'paidMinor')::int <> 60000
     or (v_result->>'balanceMinor')::int <> 0 then
    raise exception 'F14-03 correction increase projection is wrong: %',v_result;
  end if;
end
$f1403correction$;

-- Source-bound refund cannot exceed remaining source contribution.
do $f1403overrefund$
declare
  v_raised boolean := false;
begin
  begin
    perform public.record_ticket_refund_guarded(
      'f1610000-0000-4000-8000-000000000001',
      current_setting('f1403.main_ticket')::uuid,
      current_setting('f1403.card_payment')::uuid,
      50000,
      'Aşırı iade denemesi',
      'f1403-over-refund',
      repeat('b',64)
    );
  exception when others then
    if position('REFUND_EXCEEDS_SOURCE' in sqlerrm) > 0 then
      v_raised := true;
    else
      raise;
    end if;
  end;
  if not v_raised then
    raise exception 'F14-03 over-refund was accepted';
  end if;
end
$f1403overrefund$;

-- A partial payment prevents discount from pushing total below already-paid amount.
do $f1403discountguard$
declare
  v_ticket jsonb;
  v_line uuid;
  v_raised boolean := false;
  v_close_raised boolean := false;
  v_add_raised boolean := false;
begin
  v_ticket := public.open_walk_in_ticket_guarded(
    'f1610000-0000-4000-8000-000000000001',
    'f1630000-0000-4000-8000-000000000001',
    'f1403-open-guard',
    repeat('c',64)
  );
  v_ticket := public.add_ticket_service_line_guarded(
    'f1610000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'f1640000-0000-4000-8000-000000000001',
    null,1,
    'f1403-add-guard',
    repeat('d',64)
  );
  select (e->>'lineId')::uuid into v_line
  from jsonb_array_elements(v_ticket->'lines') e limit 1;

  perform public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'cash',50000,
    'f1403-pay-guard',
    repeat('e',64)
  );

  begin
    perform public.set_ticket_service_discount_guarded(
      'f1610000-0000-4000-8000-000000000001',
      (v_ticket->>'ticketId')::uuid,
      v_line,
      20000,
      'Aşırı iskonto',
      2,
      'f1403-discount-guard',
      repeat('f',64)
    );
  exception when others then
    if position('TICKET_TOTAL_BELOW_PAID' in sqlerrm) > 0 then v_raised := true; else raise; end if;
  end;

  begin
    perform public.add_ticket_service_line_guarded(
      'f1610000-0000-4000-8000-000000000001',
      (v_ticket->>'ticketId')::uuid,
      'f1640000-0000-4000-8000-000000000002',
      null,2,
      'f1403-add-after-pay',
      repeat('0',64)
    );
  exception when others then
    if position('TICKET_HAS_FINANCIAL_EVENTS' in sqlerrm) > 0 then v_add_raised := true; else raise; end if;
  end;

  begin
    perform public.close_ticket_guarded(
      'f1610000-0000-4000-8000-000000000001',
      (v_ticket->>'ticketId')::uuid,
      2,
      'f1403-close-balance',
      repeat('1',64)
    );
  exception when others then
    if position('TICKET_BALANCE_REMAINS' in sqlerrm) > 0 then v_close_raised := true; else raise; end if;
  end;

  if not v_raised or not v_add_raised or not v_close_raised then
    raise exception 'F14-03 payment/discount/close structural guards did not all fire';
  end if;

  perform set_config('f1403.staff_ticket',v_ticket->>'ticketId',false);
end
$f1403discountguard$;

-- Staff is denied until explicit payments_write grant; revocation blocks next write; manager remains effective.
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000003',true);

do $f1403staffdenied$
declare
  v_denied boolean := false;
begin
  begin
    perform public.record_ticket_payment_guarded(
      'f1610000-0000-4000-8000-000000000001',
      current_setting('f1403.staff_ticket')::uuid,
      'cash',10000,
      'f1403-staff-denied',
      repeat('2',64)
    );
  exception when insufficient_privilege then
    if position('PAYMENTS_PERMISSION_REQUIRED' in sqlerrm) > 0 then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'F14-03 staff paid without grant'; end if;
end
$f1403staffdenied$;

select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select public.set_membership_financial_permission(
  'f1610000-0000-4000-8000-000000000001',
  'f1620000-0000-4000-8000-000000000003',
  'payments_write',
  true
);

select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000003',true);
do $f1403staffgrant$
declare
  v_result jsonb;
begin
  v_result := public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.staff_ticket')::uuid,
    'cash',10000,
    'f1403-staff-granted',
    repeat('3',64)
  );
  if (v_result->>'paidMinor')::int <> 60000 then
    raise exception 'F14-03 granted staff payment failed: %',v_result;
  end if;
end
$f1403staffgrant$;

select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select public.set_membership_financial_permission(
  'f1610000-0000-4000-8000-000000000001',
  'f1620000-0000-4000-8000-000000000003',
  'payments_write',
  false
);

select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000003',true);
do $f1403staffrevoked$
declare
  v_denied boolean := false;
begin
  begin
    perform public.record_ticket_refund_guarded(
      'f1610000-0000-4000-8000-000000000001',
      current_setting('f1403.main_ticket')::uuid,
      current_setting('f1403.cash_payment')::uuid,
      1000,
      'İzin iptali kontrolü',
      'f1403-staff-revoked',
      repeat('4',64)
    );
  exception when insufficient_privilege then
    if position('PAYMENTS_PERMISSION_REQUIRED' in sqlerrm) > 0 then v_denied := true; else raise; end if;
  end;
  if not v_denied then raise exception 'F14-03 revoked staff permission remained writable'; end if;
end
$f1403staffrevoked$;

-- Manager has the existing effective payments_write and can write without a staff grant.
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000002',true);
do $f1403manager$
declare
  v_result jsonb;
begin
  v_result := public.record_ticket_refund_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    current_setting('f1403.cash_payment')::uuid,
    1000,
    'Manager yetki kontrolü',
    'f1403-manager-refund',
    repeat('5',64)
  );
  if (v_result->>'paymentStatus') <> 'partial'
     or (v_result->>'paidMinor')::int <> 59000
     or (v_result->>'balanceMinor')::int <> 1000 then
    raise exception 'F14-03 manager effective payments_write failed: %',v_result;
  end if;
end
$f1403manager$;

reset role;

-- Payment events are append-only even to postgres.
do $f1403immutable$
declare
  v_event uuid;
  v_update_raised boolean := false;
  v_delete_raised boolean := false;
begin
  select id into v_event
  from public.ticket_payment_events
  where business_id='f1610000-0000-4000-8000-000000000001'
  order by created_at,id
  limit 1;

  begin
    update public.ticket_payment_events
    set amount_minor=1
    where id=v_event;
  exception when others then
    if position('PAYMENT_EVENT_IMMUTABLE' in sqlerrm) > 0 then v_update_raised := true; else raise; end if;
  end;

  begin
    delete from public.ticket_payment_events where id=v_event;
  exception when others then
    if position('PAYMENT_EVENT_DELETE_FORBIDDEN' in sqlerrm) > 0 then v_delete_raised := true; else raise; end if;
  end;

  if not v_update_raised or not v_delete_raised then
    raise exception 'F14-03 append-only payment event guard failed';
  end if;
end
$f1403immutable$;

do $f1403done$
begin
  raise notice 'F14-03 manual payment/refund/correction ledger acceptance passed';
end
$f1403done$;

rollback;
