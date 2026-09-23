\ir h19_test_support.sql

insert into auth.users(id,email,raw_user_meta_data)
values ('f19c0000-0000-4000-8000-000000000001','h19-pay-d2d5@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('f19d0000-0000-4000-8000-000000000001','H19 Payments D2D5','h19-payments-d2d5','Europe/Istanbul','f19c0000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('f19e0000-0000-4000-8000-000000000001','f19d0000-0000-4000-8000-000000000001','f19c0000-0000-4000-8000-000000000001','owner',true);

insert into public.customers(id,business_id,name,phone,created_by)
values ('f19f0000-0000-4000-8000-000000000001','f19d0000-0000-4000-8000-000000000001','H19 D2D5 Customer','05551919001','f19c0000-0000-4000-8000-000000000001');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  'f19a0000-0000-4000-8000-000000000001','f19d0000-0000-4000-8000-000000000001',
  'H19 D2D5 10 TRY',30,0,0,'Genel',10,1000,'fixed',1000,1000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','f19c0000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $setup$
declare
  v_ticket jsonb;
begin
  v_ticket:=public.open_walk_in_ticket_guarded(
    'f19d0000-0000-4000-8000-000000000001',
    'f19f0000-0000-4000-8000-000000000001',
    'h19-pay-d2d5-open',repeat('1',64)
  );
  v_ticket:=public.add_ticket_service_line_guarded(
    'f19d0000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'f19a0000-0000-4000-8000-000000000001',
    null,1,'h19-pay-d2d5-add',repeat('2',64)
  );
  perform set_config('h19.pay_d2d5.ticket',v_ticket->>'ticketId',false);
  perform set_config('h19.pay_d2d5.version',v_ticket->>'version',false);
end
$setup$;

reset role;

do $probe$
declare
  v_business uuid:='f19d0000-0000-4000-8000-000000000001';
  v_owner uuid:='f19c0000-0000-4000-8000-000000000001';
  v_ticket uuid:=current_setting('h19.pay_d2d5.ticket')::uuid;
  v_version integer:=current_setting('h19.pay_d2d5.version')::integer;
  v_line uuid;
  v_result jsonb;
  v_projection jsonb;
  v_error text;
  v_rows integer:=0;
  v_drain integer:=0;
begin
  select id into v_line
  from public.ticket_lines
  where business_id=v_business and ticket_id=v_ticket
  order by line_ordinal
  limit 1;

  perform pg_temp.h19_connect('h19_pay_d2d5_blocker');
  perform pg_temp.h19_connect('h19_pay_d2d5_payment');
  perform pg_temp.h19_connect('h19_pay_d2d5_discount');
  perform pg_temp.h19_set_authenticated('h19_pay_d2d5_payment',v_owner);
  perform pg_temp.h19_set_authenticated('h19_pay_d2d5_discount',v_owner);

  perform dblink_exec(
    'h19_pay_d2d5_blocker',
    format(
      'do $block$ begin perform 1 from public.tickets where business_id=%L::uuid and id=%L::uuid for update; end $block$;',
      v_business,
      v_ticket
    )
  );

  if dblink_send_query(
    'h19_pay_d2d5_payment',
    format(
      'select public.record_ticket_payment_guarded(%L::uuid,%L::uuid,''cash'',800,%L,%L)',
      v_business,v_ticket,'h19-pay-d2d5-payment',repeat('a',64)
    )
  )<>1 then
    raise exception 'H19 payments D2xD5 payment writer did not start';
  end if;

  if not pg_temp.h19_wait_for_activity('h19_pay_d2d5_payment','Lock') then
    raise exception 'H19 payments D2xD5 payment writer did not park';
  end if;

  if dblink_send_query(
    'h19_pay_d2d5_discount',
    format(
      'select public.set_ticket_service_discount_guarded(%L::uuid,%L::uuid,%L::uuid,500,%L,%s,%L,%L)',
      v_business,v_ticket,v_line,'H19 D2D5 discount',v_version,
      'h19-pay-d2d5-discount',repeat('b',64)
    )
  )<>1 then
    raise exception 'H19 payments D2xD5 discount writer did not start';
  end if;

  if not pg_temp.h19_wait_for_activity('h19_pay_d2d5_discount','Lock') then
    raise exception 'H19 payments D2xD5 discount writer did not park';
  end if;

  perform dblink_exec('h19_pay_d2d5_blocker','commit');
  perform dblink_disconnect('h19_pay_d2d5_blocker');

  if not pg_temp.h19_wait_until_idle('h19_pay_d2d5_payment') then
    raise exception 'H19 payments D2xD5 payment writer timed out';
  end if;

  select t.result into v_result
  from dblink_get_result('h19_pay_d2d5_payment',false) as t(result jsonb);
  get diagnostics v_rows=row_count;
  if v_rows<>1 or (v_result->>'paidMinor')::int<>800 then
    raise exception 'H19 payments D2xD5 payment result mismatch: %',v_result;
  end if;
  perform * from dblink_get_result('h19_pay_d2d5_payment',false) as t(result jsonb);
  perform dblink_exec('h19_pay_d2d5_payment','commit');
  perform dblink_disconnect('h19_pay_d2d5_payment');

  if not pg_temp.h19_wait_until_idle('h19_pay_d2d5_discount') then
    raise exception 'H19 payments D2xD5 discount writer timed out';
  end if;

  begin
    select t.result into v_result
    from dblink_get_result('h19_pay_d2d5_discount',false) as t(result jsonb);
    get diagnostics v_rows=row_count;
  exception when others then
    v_rows:=0;
  end;

  if v_rows<>1 then
    v_error:=dblink_error_message('h19_pay_d2d5_discount');
  end if;
  perform * from dblink_get_result('h19_pay_d2d5_discount',false) as t(result jsonb);
  get diagnostics v_drain=row_count;

  if v_rows=1 then
    raise exception 'H19 payments D2xD5 stale discount unexpectedly committed: %',v_result;
  end if;
  if position('TICKET_TOTAL_BELOW_PAID' in coalesce(v_error,''))=0 then
    raise exception 'H19 payments D2xD5 classification mismatch: %',coalesce(v_error,'<none>');
  end if;

  perform pg_temp.h19_safe_cleanup('h19_pay_d2d5_discount');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
  v_projection:=public.get_ticket_contract(v_business,v_ticket);

  if (v_projection->>'totalMinor')::int<>1000
     or (v_projection->>'discountMinor')::int<>0
     or (v_projection->>'paidMinor')::int<>800
     or (v_projection->>'balanceMinor')::int<>200 then
    raise exception 'H19 payments D2xD5 durable state mismatch: %',v_projection;
  end if;

  reset role;
  raise notice 'H19 payments D2xD5 coherent snapshot classification passed';
exception when others then
  perform pg_temp.h19_safe_cleanup('h19_pay_d2d5_blocker');
  perform pg_temp.h19_safe_cleanup('h19_pay_d2d5_payment');
  perform pg_temp.h19_safe_cleanup('h19_pay_d2d5_discount');
  raise;
end
$probe$;
