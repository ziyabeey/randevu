create extension if not exists dblink;

-- F16-07 committed path: the goodwill-refund trigger is deferred to commit, so
-- this file runs without an outer transaction. Two concurrent refunds on the
-- same closed ticket park on the ticket row lock; both commit, and the
-- commission adjustments equal the share of the combined refund exactly once.
-- A committed product return writes its return movement and nothing else.

insert into auth.users(id,email,raw_user_meta_data)
values ('f16d0000-0000-4000-8000-000000000001','f1607-commit@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values ('f16d1000-0000-4000-8000-000000000001','F16-07 Commit Salon','f1607-commit-salon','Europe/Istanbul',
        'f16d0000-0000-4000-8000-000000000001');

insert into public.memberships(id,business_id,user_id,role,active)
values ('f16d2000-0000-4000-8000-000000000001','f16d1000-0000-4000-8000-000000000001',
        'f16d0000-0000-4000-8000-000000000001','owner',true);

insert into public.customers(id,business_id,name,phone,created_by)
values ('f16d3000-0000-4000-8000-000000000001','f16d1000-0000-4000-8000-000000000001','F16-07 Commit Customer',
        '05551690000','f16d0000-0000-4000-8000-000000000001');

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values ('f16d4000-0000-4000-8000-000000000001','f16d1000-0000-4000-8000-000000000001','F16-07 Fön',
          30,0,0,'Genel',10,30000,'fixed',30000,30000,'TRY',true);

insert into public.staff_profiles(id,business_id,membership_id,name,active)
values ('f16d5000-0000-4000-8000-000000000001','f16d1000-0000-4000-8000-000000000001',
        'f16d2000-0000-4000-8000-000000000001','Commit Selin',true);
insert into public.staff_services(business_id,staff_id,service_id,active)
values ('f16d1000-0000-4000-8000-000000000001','f16d5000-0000-4000-8000-000000000001',
        'f16d4000-0000-4000-8000-000000000001',true);

set role authenticated;
select set_config('request.jwt.claim.sub','f16d0000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $setup$
declare
  v_business uuid := 'f16d1000-0000-4000-8000-000000000001';
  v jsonb;
  v_ticket uuid;
  v_product jsonb;
begin
  perform public.set_staff_commission_rates_guarded(v_business,'f16d5000-0000-4000-8000-000000000001',1000,1000,0);
  v := public.open_walk_in_ticket_guarded(v_business,'f16d3000-0000-4000-8000-000000000001','f1607-commit-open',repeat('1',64));
  v_ticket := (v->>'ticketId')::uuid;
  v := public.add_ticket_service_line_guarded(v_business,v_ticket,'f16d4000-0000-4000-8000-000000000001',
    'f16d5000-0000-4000-8000-000000000001',(v->>'version')::int,'f1607-commit-add',repeat('2',64));
  v := public.record_ticket_payment_guarded(v_business,v_ticket,'cash',30000,'f1607-commit-pay',repeat('3',64));
  perform set_config('f1607.ticket',v_ticket::text,false);
  perform set_config('f1607.payment',v->'paymentEvents'->0->>'eventId',false);
  perform public.close_ticket_guarded(v_business,v_ticket,(v->>'version')::int,'f1607-commit-close',repeat('4',64));

  v_product := public.create_product_guarded(v_business,'Commit Krem','F1607-CRM','piece',20000,'TRY',5,
    'f1607-commit-product',repeat('5',64));
  v := public.open_product_sale_guarded(v_business,'f16d3000-0000-4000-8000-000000000001',(v_product->>'productId')::uuid,
    1,1,'f1607-commit-sale',repeat('6',64));
  perform set_config('f1607.product_ticket',v->>'ticketId',false);
  perform set_config('f1607.product_line',v->'lines'->0->>'lineId',false);
  v := public.record_ticket_payment_guarded(v_business,(v->>'ticketId')::uuid,'card',20000,'f1607-commit-sale-pay',repeat('7',64));
  perform set_config('f1607.product_payment',v->'paymentEvents'->0->>'eventId',false);
  perform public.close_ticket_guarded(v_business,(v->>'ticketId')::uuid,(v->>'version')::int,'f1607-commit-sale-close',repeat('8',64));
end
$setup$;

-- Committed product return: one return movement, no adjustment at commit.
do $return$
begin
  perform public.record_product_return_refund_guarded('f16d1000-0000-4000-8000-000000000001',
    current_setting('f1607.product_ticket')::uuid,current_setting('f1607.product_line')::uuid,
    current_setting('f1607.product_payment')::uuid,1,20000,false,'Kutu hasarlı','f1607-commit-return',repeat('9',64));
end
$return$;

reset role;

do $returncheck$
declare v_kinds text;
begin
  select string_agg(e.kind || ':' || e.base_minor || '/' || e.amount_minor, ',' order by e.kind)
  into v_kinds
  from public.staff_commission_entries e
  join public.staff_commission_lines l on l.business_id = e.business_id and l.id = e.commission_line_id
  where l.business_id = 'f16d1000-0000-4000-8000-000000000001'
    and l.ticket_id = current_setting('f1607.product_ticket')::uuid;
  if v_kinds is distinct from 'line:20000/2000,product_return:-20000/-2000' then
    raise exception 'F16-07 committed product return wrote %', v_kinds;
  end if;
end
$returncheck$;

do $race$
declare
  v_business uuid := 'f16d1000-0000-4000-8000-000000000001';
  v_owner uuid := 'f16d0000-0000-4000-8000-000000000001';
  v_ticket uuid := current_setting('f1607.ticket')::uuid;
  v_payment uuid := current_setting('f1607.payment')::uuid;
  v_conn text;
  v_blocked integer := 0;
  v_rows integer;
  v_drain integer;
  v_result jsonb;
  v_finished integer := 0;
  v_done_a boolean := false;
  v_done_b boolean := false;
  v_error text;
  v_sum record;
  v_adjustments integer;
begin
  perform dblink_connect('f1607_blocker',
    'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name=f1607_blocker');
  perform dblink_exec('f1607_blocker','begin');
  perform dblink_exec('f1607_blocker', format(
    'do $block$ begin perform 1 from public.tickets where business_id=%L::uuid and id=%L::uuid for update; end $block$;',
    v_business, v_ticket));

  for v_conn in select unnest(array['f1607_refund_a','f1607_refund_b']) loop
    perform dblink_connect(v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres application_name='||v_conn);
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role authenticated');
    perform dblink_exec(v_conn,'set local "request.jwt.claim.sub" = '''||v_owner::text||'''');
    perform dblink_exec(v_conn,$q$set local "request.jwt.claims" = '{"amr":[{"method":"password"}]}'$q$);
  end loop;

  if dblink_send_query('f1607_refund_a', format(
       $q$select public.record_ticket_refund_guarded(%L::uuid,%L::uuid,%L::uuid,1000,'Gecikme','f1607-race-a',%L)$q$,
       v_business, v_ticket, v_payment, repeat('a',64))) <> 1
     or dblink_send_query('f1607_refund_b', format(
       $q$select public.record_ticket_refund_guarded(%L::uuid,%L::uuid,%L::uuid,2001,'Memnuniyet','f1607-race-b',%L)$q$,
       v_business, v_ticket, v_payment, repeat('b',64))) <> 1 then
    raise exception 'F16-07 could not start concurrent refunds';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('f1607_refund_a','f1607_refund_b') and wait_event_type = 'Lock';
    exit when v_blocked = 2;
    perform pg_sleep(0.01);
  end loop;
  if v_blocked <> 2 then raise exception 'F16-07 refunds did not both park on the ticket lock: %', v_blocked; end if;

  perform dblink_exec('f1607_blocker','commit');
  perform dblink_disconnect('f1607_blocker');

  -- Each writer commits as soon as its refund returns; its deferred commission
  -- trigger runs inside that commit while it still holds the ticket lock.
  while v_finished < 2 loop
    v_conn := null;
    for i in 1..6000 loop
      if not v_done_a and dblink_is_busy('f1607_refund_a') = 0 then v_conn := 'f1607_refund_a'; exit;
      elsif not v_done_b and dblink_is_busy('f1607_refund_b') = 0 then v_conn := 'f1607_refund_b'; exit;
      end if;
      perform pg_sleep(0.01);
    end loop;
    if v_conn is null then raise exception 'F16-07 timed out waiting for a refund writer'; end if;

    v_rows := 0;
    begin
      select t.result into v_result from dblink_get_result(v_conn,false) as t(result jsonb);
      get diagnostics v_rows = row_count;
    exception when others then v_rows := 0;
    end;
    if v_rows <> 1 then
      v_error := dblink_error_message(v_conn);
      raise exception 'F16-07 refund writer % failed: %', v_conn, v_error;
    end if;
    perform * from dblink_get_result(v_conn,false) as t(result jsonb);
    get diagnostics v_drain = row_count;
    if v_drain <> 0 or dblink_is_busy(v_conn) <> 0 then
      raise exception 'F16-07 refund writer had trailing results on %', v_conn;
    end if;
    perform dblink_exec(v_conn,'commit');
    perform dblink_disconnect(v_conn);
    if v_conn = 'f1607_refund_a' then v_done_a := true; else v_done_b := true; end if;
    v_finished := v_finished + 1;
  end loop;

  -- 300.00 TL service, 30.01 TL refunded in total: base 269.99 TL, 10% = 27.00 TL.
  select sum(e.base_minor)::bigint as base, sum(e.amount_minor)::bigint as amount into v_sum
  from public.staff_commission_entries e
  join public.staff_commission_lines l on l.business_id = e.business_id and l.id = e.commission_line_id
  where l.business_id = v_business and l.ticket_id = v_ticket;
  select count(*)::integer into v_adjustments
  from public.staff_commission_entries e
  where e.business_id = v_business and e.ticket_id = v_ticket and e.kind = 'payment_adjustment';
  if v_sum.base <> 26999 or v_sum.amount <> 2700 or v_adjustments <> 2 then
    raise exception 'F16-07 concurrent refunds left commission base/amount %/% with % adjustments',
      v_sum.base, v_sum.amount, v_adjustments;
  end if;

  raise notice 'F16-07 committed refunds and return adjusted commission exactly once';
exception when others then
  begin perform dblink_exec('f1607_blocker','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('f1607_blocker'); exception when others then null; end;
  for v_conn in select unnest(array['f1607_refund_a','f1607_refund_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$race$;

-- The CI database is disposable; financial history is deliberately not deleted.
