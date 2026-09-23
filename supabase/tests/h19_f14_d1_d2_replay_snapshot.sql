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

-- H19 blind D1 x D2 prospective probe: a later valid payment must not
-- rewrite the frozen result of the earlier idempotent command.
do $h19_f14_d1d2$
declare
  v_replay jsonb;
begin
  v_replay := public.record_ticket_payment_guarded(
    'f1610000-0000-4000-8000-000000000001',
    current_setting('f1403.main_ticket')::uuid,
    'cash',
    20000,
    'f1403-cash-0001',
    repeat('3',64)
  );

  if v_replay->>'paymentStatus' <> 'partial'
     or (v_replay->>'paidMinor')::int <> 20000
     or (v_replay->>'balanceMinor')::int <> 40000
     or jsonb_array_length(v_replay->'paymentEvents') <> 1 then
    raise exception 'H19 D1xD2 payment replay snapshot drifted after later payment: %', v_replay;
  end if;
end
$h19_f14_d1d2$;

-- Instrumentation-only receipt check. Raw ledger ACL is intentionally closed
-- to authenticated, so inspect durable count as the postgres session user.
reset role;

do $h19_f14_d1d2_count$
declare
  v_event_count integer;
begin
  select count(*)::integer
  into v_event_count
  from public.ticket_payment_events e
  where e.business_id='f1610000-0000-4000-8000-000000000001'
    and e.ticket_id=current_setting('f1403.main_ticket')::uuid;

  if v_event_count <> 2 then
    raise exception 'H19 D1xD2 payment replay changed durable event count: %', v_event_count;
  end if;
end
$h19_f14_d1d2_count$;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1600000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

reset role;
rollback;
