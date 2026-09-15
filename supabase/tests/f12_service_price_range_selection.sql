begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('c1400000-0000-4000-8000-000000000001','f12-selection-owner@example.invalid','{}'::jsonb)
on conflict (id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'c1410000-0000-4000-8000-000000000001','F12 Selection','f12-selection','Europe/Istanbul',
  'c1400000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'c1420000-0000-4000-8000-000000000001',
  'c1410000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001','owner',true
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,
  price_policy_version,currency,active
) values
  ('c1430000-0000-4000-8000-000000000001','c1410000-0000-4000-8000-000000000001','Zulu',30,0,0,'Bakım',20,20000,'fixed',20000,20000,1,'TRY',true),
  ('c1430000-0000-4000-8000-000000000002','c1410000-0000-4000-8000-000000000001','Alpha',30,0,0,'Bakım',10,10000,'fixed',10000,10000,1,'TRY',true),
  ('c1430000-0000-4000-8000-000000000003','c1410000-0000-4000-8000-000000000001','Pasif',30,0,0,'Renk',5,15000,'range',15000,18000,1,'TRY',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','c1400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);
do $$
declare
  v record;
  v_ids text[];
begin
  select * into strict v
  from public.get_catalog_snapshot('c1410000-0000-4000-8000-000000000001');

  select array_agg(item->>'id' order by ordinality)
    into v_ids
  from jsonb_array_elements(v.services) with ordinality as j(item, ordinality);

  if v_ids <> array[
    'c1430000-0000-4000-8000-000000000002',
    'c1430000-0000-4000-8000-000000000001',
    'c1430000-0000-4000-8000-000000000003'
  ] then
    raise exception 'service catalog order is not deterministic by category/sort/name/id: %', v_ids;
  end if;
end
$$;
reset role;

do $$
begin
  begin
    perform * from public.f12_price_estimate_internal(
      'c1410000-0000-4000-8000-000000000001',
      array['c1430000-0000-4000-8000-000000000003'::uuid]
    );
    raise exception 'inactive service unexpectedly entered estimate';
  exception when others then
    if sqlerrm = 'inactive service unexpectedly entered estimate' then raise; end if;
    if position('SERVICE_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

rollback;
