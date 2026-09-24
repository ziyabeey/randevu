begin;

insert into auth.users(id,email,raw_user_meta_data)
values ('e5100000-0000-4000-8000-000000000001','h19-expense-d1d2-owner@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  'e5110000-0000-4000-8000-000000000001',
  'H19 Expense D1D2',
  'h19-expense-d1d2',
  'Europe/Istanbul',
  'e5100000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  'e5120000-0000-4000-8000-000000000001',
  'e5110000-0000-4000-8000-000000000001',
  'e5100000-0000-4000-8000-000000000001',
  'owner',
  true
)
on conflict(business_id,user_id) do update set role='owner',active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','e5100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',true);

do $probe$
declare
  v_source jsonb;
  v_first jsonb;
  v_second jsonb;
  v_replay jsonb;
  v_source_id uuid;
  v_first_replacement_id uuid;
  v_before integer;
  v_after integer;
  v_stored jsonb;
begin
  v_source := public.create_expense_guarded(
    'e5110000-0000-4000-8000-000000000001',
    'Kira','İlk kayıt',10000,'TRY','cash','2026-09-23 09:00:00',
    'h19-expense-source-0001',repeat('1',64)
  );
  v_source_id := (v_source->>'eventId')::uuid;

  v_first := public.correct_expense_guarded(
    'e5110000-0000-4000-8000-000000000001',
    v_source_id,
    'İlk düzeltme',
    'Malzeme','İkinci kayıt',12000,'TRY','card',
    '2026-09-23 09:00:00','2026-09-23 10:00:00',
    'h19-expense-correct-k1',repeat('2',64)
  );
  v_first_replacement_id := (v_first->'replacement'->>'eventId')::uuid;

  v_second := public.correct_expense_guarded(
    'e5110000-0000-4000-8000-000000000001',
    v_first_replacement_id,
    'İkinci düzeltme',
    'Pazarlama','Üçüncü kayıt',13000,'TRY','cash',
    '2026-09-23 09:00:00','2026-09-23 11:00:00',
    'h19-expense-correct-k2',repeat('3',64)
  );

  execute 'reset role';
  select count(*)::integer into v_before
  from public.expense_events
  where business_id='e5110000-0000-4000-8000-000000000001';
  execute 'set local role authenticated';

  v_replay := public.correct_expense_guarded(
    'e5110000-0000-4000-8000-000000000001',
    v_source_id,
    'İlk düzeltme',
    'Malzeme','İkinci kayıt',12000,'TRY','card',
    '2026-09-23 09:00:00','2026-09-23 10:00:00',
    'h19-expense-correct-k1',repeat('2',64)
  );

  if v_replay is distinct from v_first then
    raise exception 'H19 benchmark expenses D1xD2 replay drifted to later correction snapshot';
  end if;

  execute 'reset role';

  select count(*)::integer into v_after
  from public.expense_events
  where business_id='e5110000-0000-4000-8000-000000000001';

  if v_after <> v_before then
    raise exception 'H19 benchmark expenses D1xD2 replay created a new durable event';
  end if;

  select result_payload into v_stored
  from public.expense_commands
  where business_id='e5110000-0000-4000-8000-000000000001'
    and actor_membership_id='e5120000-0000-4000-8000-000000000001'
    and command='correct_expense'
    and idempotency_key='h19-expense-correct-k1';

  if v_stored is distinct from v_first then
    raise exception 'H19 benchmark expenses D1xD2 stored command receipt changed';
  end if;

  if (v_second->'replacement'->>'eventId')::uuid = v_first_replacement_id then
    raise exception 'H19 benchmark expenses D1xD2 later correction did not advance replacement identity';
  end if;

  raise notice 'H19 benchmark expenses D1xD2 PASS: exact replay retained original stored result snapshot';
end
$probe$;

rollback;
