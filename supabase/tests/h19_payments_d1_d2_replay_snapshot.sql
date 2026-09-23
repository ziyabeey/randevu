-- Permanent H19 payments D1 x D2 regression.
-- Frozen evidence: variation-only CI #2386 PASS, variation+probe CI #2389 FAIL,
-- clean control CI #2390 PASS.

insert into auth.users(id,email,raw_user_meta_data)
values ('d1d20000-0000-4000-8000-000000000001','h19-pay-d1d2@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('d1d21000-0000-4000-8000-000000000001','H19 Payments D1D2','h19-payments-d1d2','Europe/Istanbul','d1d20000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('d1d22000-0000-4000-8000-000000000001','d1d21000-0000-4000-8000-000000000001','d1d20000-0000-4000-8000-000000000001','owner',true);

insert into public.customers(id,business_id,name,phone,created_by)
values ('d1d23000-0000-4000-8000-000000000001','d1d21000-0000-4000-8000-000000000001','H19 D1D2 Customer','05551212001','d1d20000-0000-4000-8000-000000000001');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'd1d24000-0000-4000-8000-000000000001','d1d21000-0000-4000-8000-000000000001',
  'H19 D1D2 600 TRY',30,0,0,'Genel',10,60000,'fixed',60000,60000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','d1d20000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $probe$
declare
  v_ticket jsonb;
  v_a jsonb;
  v_b jsonb;
  v_replay jsonb;
begin
  v_ticket:=public.open_walk_in_ticket_guarded(
    'd1d21000-0000-4000-8000-000000000001',
    'd1d23000-0000-4000-8000-000000000001',
    'h19-pay-d1d2-open',repeat('1',64)
  );
  v_ticket:=public.add_ticket_service_line_guarded(
    'd1d21000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'd1d24000-0000-4000-8000-000000000001',
    null,1,'h19-pay-d1d2-add',repeat('2',64)
  );

  v_a:=public.record_ticket_payment_guarded(
    'd1d21000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'cash',20000,'h19-pay-d1d2-a',repeat('3',64)
  );

  if v_a->>'paymentStatus'<>'partial'
     or (v_a->>'paidMinor')::int<>20000
     or (v_a->>'balanceMinor')::int<>40000
     or jsonb_array_length(v_a->'paymentEvents')<>1 then
    raise exception 'H19 payments D1xD2 initial payment snapshot mismatch: %',v_a;
  end if;

  v_b:=public.record_ticket_payment_guarded(
    'd1d21000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'card',40000,'h19-pay-d1d2-b',repeat('4',64)
  );

  if v_b->>'paymentStatus'<>'paid'
     or (v_b->>'paidMinor')::int<>60000
     or (v_b->>'balanceMinor')::int<>0
     or jsonb_array_length(v_b->'paymentEvents')<>2 then
    raise exception 'H19 payments D1xD2 later payment snapshot mismatch: %',v_b;
  end if;

  v_replay:=public.record_ticket_payment_guarded(
    'd1d21000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'cash',20000,'h19-pay-d1d2-a',repeat('3',64)
  );

  if v_replay<>v_a then
    raise exception 'H19 D1xD2 payment replay snapshot drifted after later payment: %',v_replay;
  end if;

  perform set_config('h19.pay_d1d2.ticket',v_ticket->>'ticketId',false);
end
$probe$;

reset role;

do $receipt$
declare
  v_event_count integer;
begin
  select count(*)::integer
  into v_event_count
  from public.ticket_payment_events e
  where e.business_id='d1d21000-0000-4000-8000-000000000001'
    and e.ticket_id=current_setting('h19.pay_d1d2.ticket')::uuid;

  if v_event_count<>2 then
    raise exception 'H19 D1xD2 payment replay changed durable event count: %',v_event_count;
  end if;

  raise notice 'H19 payments D1xD2 frozen replay snapshot passed';
end
$receipt$;
