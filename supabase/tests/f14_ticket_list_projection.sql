begin;

insert into auth.users(id,email,raw_user_meta_data)
values
  ('f1800000-0000-4000-8000-000000000001','f1404-owner-a@example.invalid','{}'::jsonb),
  ('f1800000-0000-4000-8000-000000000002','f1404-owner-b@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('f1810000-0000-4000-8000-000000000001','F14-04 Salon A','f1404-salon-a','Europe/Istanbul','f1800000-0000-4000-8000-000000000001'),
  ('f1810000-0000-4000-8000-000000000002','F14-04 Salon B','f1404-salon-b','Europe/Istanbul','f1800000-0000-4000-8000-000000000002');

insert into public.memberships(id,business_id,user_id,role,active)
values
  ('f1820000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001','owner',true),
  ('f1820000-0000-4000-8000-000000000002','f1810000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000002','owner',true);

insert into public.customers(id,business_id,name,phone,created_by)
values
  ('f1830000-0000-4000-8000-000000000001','f1810000-0000-4000-8000-000000000001','A Müşteri 1','05550000101','f1800000-0000-4000-8000-000000000001'),
  ('f1830000-0000-4000-8000-000000000002','f1810000-0000-4000-8000-000000000001','A Müşteri 2','05550000102','f1800000-0000-4000-8000-000000000001'),
  ('f1830000-0000-4000-8000-000000000003','f1810000-0000-4000-8000-000000000002','B Müşteri','05550000103','f1800000-0000-4000-8000-000000000002');

insert into public.tickets(
  id,business_id,customer_id,source,status,currency,version,
  customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,
  created_by_membership_id,created_at,updated_at,
  closed_by_membership_id,closed_at
) values
  (
    'f1840000-0000-4000-8000-000000000001',
    'f1810000-0000-4000-8000-000000000001',
    'f1830000-0000-4000-8000-000000000001',
    'walk_in','open','TRY',1,
    'A Müşteri 1','05550000101',null,
    'f1820000-0000-4000-8000-000000000001',
    '2026-09-22T09:00:00Z','2026-09-22T12:00:00Z',
    null,null
  ),
  (
    'f1840000-0000-4000-8000-000000000002',
    'f1810000-0000-4000-8000-000000000001',
    'f1830000-0000-4000-8000-000000000001',
    'walk_in','closed','TRY',2,
    'A Müşteri 1','05550000101',null,
    'f1820000-0000-4000-8000-000000000001',
    '2026-09-22T08:00:00Z','2026-09-22T11:00:00Z',
    'f1820000-0000-4000-8000-000000000001','2026-09-22T11:00:00Z'
  ),
  (
    'f1840000-0000-4000-8000-000000000003',
    'f1810000-0000-4000-8000-000000000001',
    'f1830000-0000-4000-8000-000000000002',
    'walk_in','open','TRY',1,
    'A Müşteri 2','05550000102',null,
    'f1820000-0000-4000-8000-000000000001',
    '2026-09-22T07:00:00Z','2026-09-22T11:00:00Z',
    null,null
  ),
  (
    'f1840000-0000-4000-8000-000000000004',
    'f1810000-0000-4000-8000-000000000002',
    'f1830000-0000-4000-8000-000000000003',
    'walk_in','open','TRY',1,
    'B Müşteri','05550000103',null,
    'f1820000-0000-4000-8000-000000000002',
    '2026-09-22T10:00:00Z','2026-09-22T13:00:00Z',
    null,null
  );

set local role authenticated;
select set_config('request.jwt.claim.sub','f1800000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $f1404list$
declare
  v_ids uuid[];
  v_count integer;
  v_first_at timestamptz;
  v_first_id uuid;
begin
  select array_agg((row.ticket->>'ticketId')::uuid order by row.sort_updated_at desc,row.sort_id desc)
  into v_ids
  from public.list_ticket_contracts_page(
    'f1810000-0000-4000-8000-000000000001',
    null,null,10,null,null
  ) row;

  if v_ids <> array[
    'f1840000-0000-4000-8000-000000000001'::uuid,
    'f1840000-0000-4000-8000-000000000003'::uuid,
    'f1840000-0000-4000-8000-000000000002'::uuid
  ] then
    raise exception 'F14-04 tenant/order projection mismatch: %',v_ids;
  end if;

  if 'f1840000-0000-4000-8000-000000000004'::uuid = any(v_ids) then
    raise exception 'F14-04 leaked cross-tenant ticket';
  end if;

  select count(*)::integer
  into v_count
  from public.list_ticket_contracts_page(
    'f1810000-0000-4000-8000-000000000001',
    'closed',null,10,null,null
  ) row
  where row.ticket->>'status'='closed';

  if v_count<>1 then
    raise exception 'F14-04 closed status filter mismatch: %',v_count;
  end if;

  select count(*)::integer
  into v_count
  from public.list_ticket_contracts_page(
    'f1810000-0000-4000-8000-000000000001',
    null,'f1830000-0000-4000-8000-000000000001',10,null,null
  ) row;

  if v_count<>2 then
    raise exception 'F14-04 customer ticket filter mismatch: %',v_count;
  end if;

  select row.sort_updated_at,row.sort_id
  into v_first_at,v_first_id
  from public.list_ticket_contracts_page(
    'f1810000-0000-4000-8000-000000000001',
    null,null,1,null,null
  ) row;

  select array_agg((row.ticket->>'ticketId')::uuid order by row.sort_updated_at desc,row.sort_id desc)
  into v_ids
  from public.list_ticket_contracts_page(
    'f1810000-0000-4000-8000-000000000001',
    null,null,10,v_first_at,v_first_id
  ) row;

  if v_ids <> array[
    'f1840000-0000-4000-8000-000000000003'::uuid,
    'f1840000-0000-4000-8000-000000000002'::uuid
  ] then
    raise exception 'F14-04 cursor continuation mismatch: %',v_ids;
  end if;
end
$f1404list$;

do $f1404deny$
declare
  v_denied boolean:=false;
begin
  begin
    perform *
    from public.list_ticket_contracts_page(
      'f1810000-0000-4000-8000-000000000002',
      null,null,10,null,null
    );
  exception when insufficient_privilege then
    if position('NOT_ALLOWED' in sqlerrm)>0 then
      v_denied:=true;
    else
      raise;
    end if;
  end;

  if not v_denied then
    raise exception 'F14-04 cross-tenant list RPC was not denied';
  end if;
end
$f1404deny$;

reset role;

raise notice 'F14-04 tenant-safe ticket list projection acceptance passed';

rollback;
