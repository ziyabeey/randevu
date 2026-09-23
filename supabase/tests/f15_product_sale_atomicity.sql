begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f15a0000-0000-4000-8000-000000000001','f1502-owner@example.invalid','{}'::jsonb),
  ('f15a0000-0000-4000-8000-000000000002','f1502-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f15a1000-0000-4000-8000-000000000001','F15-02 Salon A','f1502-salon-a','Europe/Istanbul','f15a0000-0000-4000-8000-000000000001'),
  ('f15a1000-0000-4000-8000-000000000002','F15-02 Salon B','f1502-salon-b','Europe/Istanbul','f15a0000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f15a2000-0000-4000-8000-000000000001','f15a1000-0000-4000-8000-000000000001','f15a0000-0000-4000-8000-000000000001','owner',true),
  ('f15a2000-0000-4000-8000-000000000002','f15a1000-0000-4000-8000-000000000002','f15a0000-0000-4000-8000-000000000002','owner',true);

insert into public.customers(id,business_id,name,phone,email,created_by)
values
  ('f15a3000-0000-4000-8000-000000000001','f15a1000-0000-4000-8000-000000000001','F15 Müşteri A','05550000001','f15-a@example.invalid','f15a0000-0000-4000-8000-000000000001'),
  ('f15a3000-0000-4000-8000-000000000002','f15a1000-0000-4000-8000-000000000002','F15 Müşteri B','05550000002','f15-b@example.invalid','f15a0000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','f15a0000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $product$
declare
  v_product jsonb;
begin
  v_product := public.create_product_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    'Şampuan','SAMP-15','piece',25000,'TRY',8,
    'f1502-product-create',repeat('a',64)
  );
  perform set_config('f1502.product',v_product->>'productId',false);
end
$product$;

do $standalone$
declare
  v_sale jsonb;
  v_replay jsonb;
  v_ticket uuid;
  v_line jsonb;
  v_sale_movement uuid;
begin
  v_sale := public.open_product_sale_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    'f15a3000-0000-4000-8000-000000000001',
    current_setting('f1502.product')::uuid,
    2,1,
    'f1502-open-sale-0001',repeat('b',64)
  );
  v_ticket := (v_sale->>'ticketId')::uuid;
  perform set_config('f1502.ticket',v_ticket::text,false);

  if (v_sale->>'totalMinor')::bigint<>50000
     or (v_sale->>'balanceMinor')::bigint<>50000
     or jsonb_array_length(v_sale->'lines')<>1 then
    raise exception 'F15-02 standalone product sale projection wrong: %',v_sale;
  end if;

  v_line := (v_sale->'lines')->0;
  if v_line->>'sourceType'<>'product'
     or v_line->>'productName'<>'Şampuan'
     or (v_line->>'quantity')::int<>2
     or (v_line->>'netMinor')::bigint<>50000 then
    raise exception 'F15-02 product snapshot line wrong: %',v_line;
  end if;
  perform set_config('f1502.line',v_line->>'lineId',false);

  if (
    select stock_on_hand from public.products
    where business_id='f15a1000-0000-4000-8000-000000000001'
      and id=current_setting('f1502.product')::uuid
  )<>6 then raise exception 'F15-02 sale did not reduce stock atomically'; end if;

  select id into v_sale_movement
  from public.product_stock_movements
  where business_id='f15a1000-0000-4000-8000-000000000001'
    and product_id=current_setting('f1502.product')::uuid
    and ticket_line_id=current_setting('f1502.line')::uuid
    and kind='sale';
  if v_sale_movement is null then raise exception 'F15-02 sale movement missing'; end if;
  perform set_config('f1502.sale_movement',v_sale_movement::text,false);

  v_replay := public.open_product_sale_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    'f15a3000-0000-4000-8000-000000000001',
    current_setting('f1502.product')::uuid,
    2,1,
    'f1502-open-sale-0001',repeat('b',64)
  );
  if v_replay<>v_sale then raise exception 'F15-02 same-key sale replay changed result'; end if;

  if (
    select count(*) from public.product_stock_movements
    where business_id='f15a1000-0000-4000-8000-000000000001'
      and ticket_line_id=current_setting('f1502.line')::uuid
      and kind='sale'
  )<>1 then raise exception 'F15-02 same-key replay duplicated stock-out'; end if;
end
$standalone$;

do $payment_and_returns$
declare
  v_ticket uuid := current_setting('f1502.ticket')::uuid;
  v_paid jsonb;
  v_result jsonb;
  v_payment uuid;
  v_stock_before bigint;
begin
  v_paid := public.record_ticket_payment_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    v_ticket,'cash',50000,
    'f1502-pay-0001',repeat('c',64)
  );
  select (event->>'eventId')::uuid into v_payment
  from jsonb_array_elements(v_paid->'paymentEvents') event
  where event->>'eventType'='payment'
  limit 1;
  if v_payment is null then raise exception 'F15-02 payment event missing'; end if;
  perform set_config('f1502.payment',v_payment::text,false);

  select stock_on_hand into v_stock_before
  from public.products
  where business_id='f15a1000-0000-4000-8000-000000000001'
    and id=current_setting('f1502.product')::uuid;

  v_result := public.record_product_return_refund_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    v_ticket,current_setting('f1502.line')::uuid,v_payment,
    1,25000,false,'Hasarlı ürün',
    'f1502-damaged-return',repeat('d',64)
  );
  if (
    select stock_on_hand from public.products
    where business_id='f15a1000-0000-4000-8000-000000000001'
      and id=current_setting('f1502.product')::uuid
  )<>v_stock_before then
    raise exception 'F15-02 financial refund silently returned damaged product to stock';
  end if;
  if (v_result->>'paidMinor')::bigint<>25000 then raise exception 'F15-02 refund total wrong'; end if;
  -- The damaged unit came back, so the ticket owes one unit less.
  if (v_result->>'returnedMinor')::bigint<>25000
     or (v_result->>'totalMinor')::bigint<>25000
     or (v_result->>'balanceMinor')::bigint<>0
     or ((v_result->'lines')->0->>'returnedQuantity')::int<>1
     or ((v_result->'lines')->0->>'netMinor')::bigint<>50000 then
    raise exception 'F15-02 damaged return did not lower the owed total: %',v_result;
  end if;

  v_result := public.record_product_return_refund_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    v_ticket,current_setting('f1502.line')::uuid,v_payment,
    1,25000,true,'Satılabilir iade',
    'f1502-resellable-return',repeat('e',64)
  );
  if (
    select stock_on_hand from public.products
    where business_id='f15a1000-0000-4000-8000-000000000001'
      and id=current_setting('f1502.product')::uuid
  )<>v_stock_before+1 then
    raise exception 'F15-02 explicit resellable return did not restore stock';
  end if;
  if (v_result->>'paidMinor')::bigint<>0 then raise exception 'F15-02 second refund total wrong'; end if;
  if (v_result->>'returnedMinor')::bigint<>50000
     or (v_result->>'totalMinor')::bigint<>0
     or (v_result->>'balanceMinor')::bigint<>0 then
    raise exception 'F15-02 full return left a receivable balance: %',v_result;
  end if;

  if (
    select count(*) from public.ticket_product_returns
    where business_id='f15a1000-0000-4000-8000-000000000001'
      and ticket_line_id=current_setting('f1502.line')::uuid
  )<>2 then raise exception 'F15-02 product return audit count wrong'; end if;
end
$payment_and_returns$;

-- Refund bounds: never above the returned value, never leaving net paid above
-- the reduced total; a fully returned ticket closes, and a return on a closed
-- ticket keeps it settled.
do $return_value_bounds$
declare
  v_sale jsonb;
  v_ticket uuid;
  v_line uuid;
  v_payment uuid;
  v_result jsonb;
  v_error text;
begin
  v_sale := public.open_product_sale_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    'f15a3000-0000-4000-8000-000000000001',
    current_setting('f1502.product')::uuid,
    2,
    (select version from public.products where id=current_setting('f1502.product')::uuid),
    'f1502-bounds-sale',repeat('3',64)
  );
  v_ticket := (v_sale->>'ticketId')::uuid;
  v_line := ((v_sale->'lines')->0->>'lineId')::uuid;
  v_result := public.record_ticket_payment_guarded(
    'f15a1000-0000-4000-8000-000000000001',v_ticket,'card',50000,
    'f1502-bounds-pay',repeat('4',64)
  );
  select (event->>'eventId')::uuid into v_payment
  from jsonb_array_elements(v_result->'paymentEvents') event
  where event->>'eventType'='payment';

  v_error := null;
  begin
    perform public.record_product_return_refund_guarded(
      'f15a1000-0000-4000-8000-000000000001',v_ticket,v_line,v_payment,
      1,30000,false,'Fazla iade','f1502-bounds-over',repeat('5',64)
    );
  exception when others then v_error := sqlerrm;
  end;
  if position('REFUND_EXCEEDS_RETURN_VALUE' in coalesce(v_error,''))=0 then
    raise exception 'F15-02 refund above returned value was accepted: %',v_error;
  end if;

  v_error := null;
  begin
    perform public.record_product_return_refund_guarded(
      'f15a1000-0000-4000-8000-000000000001',v_ticket,v_line,v_payment,
      1,10000,false,'Eksik iade','f1502-bounds-under',repeat('6',64)
    );
  exception when others then v_error := sqlerrm;
  end;
  if position('RETURN_REFUND_BELOW_REQUIRED' in coalesce(v_error,''))=0 then
    raise exception 'F15-02 refund leaving the ticket overpaid was accepted: %',v_error;
  end if;
  if exists (
    select 1 from public.ticket_product_returns where ticket_line_id=v_line
  ) then raise exception 'F15-02 rejected return left a half-written return row'; end if;

  v_result := public.record_product_return_refund_guarded(
    'f15a1000-0000-4000-8000-000000000001',v_ticket,v_line,v_payment,
    1,25000,false,'Hasarlı ürün','f1502-bounds-exact',repeat('7',64)
  );
  if (v_result->>'balanceMinor')::bigint<>0 or (v_result->>'totalMinor')::bigint<>25000 then
    raise exception 'F15-02 exact-value return did not settle: %',v_result;
  end if;

  v_result := public.close_ticket_guarded(
    'f15a1000-0000-4000-8000-000000000001',v_ticket,(v_result->>'version')::integer,
    'f1502-bounds-close',repeat('8',64)
  );
  if v_result->>'status'<>'closed' then raise exception 'F15-02 returned product ticket could not close: %',v_result; end if;

  v_result := public.record_product_return_refund_guarded(
    'f15a1000-0000-4000-8000-000000000001',v_ticket,v_line,v_payment,
    1,25000,true,'Kapalı adisyonda iade','f1502-bounds-closed',repeat('9',64)
  );
  if v_result->>'status'<>'closed'
     or (v_result->>'balanceMinor')::bigint<>0
     or (v_result->>'totalMinor')::bigint<>0 then
    raise exception 'F15-02 return on a closed ticket reopened a receivable: %',v_result;
  end if;
end
$return_value_bounds$;

-- Partially paid ticket: the unpaid remainder absorbs part of the return value.
do $partial_paid_return$
declare
  v_sale jsonb;
  v_ticket uuid;
  v_line uuid;
  v_payment uuid;
  v_result jsonb;
begin
  v_sale := public.open_product_sale_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    'f15a3000-0000-4000-8000-000000000001',
    current_setting('f1502.product')::uuid,
    2,
    (select version from public.products where id=current_setting('f1502.product')::uuid),
    'f1502-partial-sale',repeat('a',63)||'1'
  );
  v_ticket := (v_sale->>'ticketId')::uuid;
  v_line := ((v_sale->'lines')->0->>'lineId')::uuid;
  v_result := public.record_ticket_payment_guarded(
    'f15a1000-0000-4000-8000-000000000001',v_ticket,'cash',30000,
    'f1502-partial-pay',repeat('a',63)||'2'
  );
  select (event->>'eventId')::uuid into v_payment
  from jsonb_array_elements(v_result->'paymentEvents') event
  where event->>'eventType'='payment';

  -- 500 owed, 300 paid; returning one 250 unit needs at least 50 back.
  v_result := public.record_product_return_refund_guarded(
    'f15a1000-0000-4000-8000-000000000001',v_ticket,v_line,v_payment,
    1,5000,false,'Kısmi ödeme iadesi','f1502-partial-return',repeat('a',63)||'3'
  );
  if (v_result->>'totalMinor')::bigint<>25000
     or (v_result->>'paidMinor')::bigint<>25000
     or (v_result->>'balanceMinor')::bigint<>0 then
    raise exception 'F15-02 partial-paid return math wrong: %',v_result;
  end if;
end
$partial_paid_return$;

-- A paid ticket cannot be cancelled as a shortcut around refund semantics.
do $paid_cancel$
declare
  v_blocked boolean:=false;
  v_version integer;
begin
  select version into v_version from public.tickets where id=current_setting('f1502.ticket')::uuid;
  begin
    perform public.cancel_ticket_guarded(
      'f15a1000-0000-4000-8000-000000000001',
      current_setting('f1502.ticket')::uuid,'Paid cancel',v_version,
      'f1502-paid-cancel',repeat('f',64)
    );
  exception when others then
    if position('TICKET_HAS_FINANCIAL_EVENTS' in sqlerrm)>0 then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'F15-02 paid ticket cancellation bypassed refund ledger'; end if;
end
$paid_cancel$;

-- Fresh unpaid product sale cancellation restores stock atomically.
do $cancel_unpaid$
declare
  v_before bigint;
  v_sale jsonb;
  v_ticket uuid;
  v_after_sale bigint;
  v_cancel jsonb;
begin
  select stock_on_hand into v_before from public.products
  where id=current_setting('f1502.product')::uuid;

  v_sale := public.open_product_sale_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    'f15a3000-0000-4000-8000-000000000001',
    current_setting('f1502.product')::uuid,
    1,
    (select version from public.products where id=current_setting('f1502.product')::uuid),
    'f1502-cancel-sale',repeat('1',64)
  );
  v_ticket := (v_sale->>'ticketId')::uuid;
  select stock_on_hand into v_after_sale from public.products where id=current_setting('f1502.product')::uuid;
  if v_after_sale<>v_before-1 then raise exception 'F15-02 pre-cancel sale did not reduce stock'; end if;

  v_cancel := public.cancel_ticket_guarded(
    'f15a1000-0000-4000-8000-000000000001',
    v_ticket,'Müşteri vazgeçti',(v_sale->>'version')::integer,
    'f1502-cancel-ticket',repeat('2',64)
  );
  if v_cancel->>'status'<>'cancelled' then raise exception 'F15-02 ticket cancel failed'; end if;
  if (
    select stock_on_hand from public.products where id=current_setting('f1502.product')::uuid
  )<>v_before then raise exception 'F15-02 ticket cancel did not atomically restore stock'; end if;
end
$cancel_unpaid$;

rollback;
