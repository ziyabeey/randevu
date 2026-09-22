begin;

-- H19 M3 prospective coverage probe: D0 x D1
-- Frozen mutant baseline: 330e907b6103ec758709e5dfe9e072ab657a3da9
-- Tenant isolation and idempotency must compose. The same idempotency key is
-- valid in two tenants because the ledger identity is (business_id, key).
-- A retry in tenant B must therefore resolve only tenant B's ledger row.

insert into auth.users(id,email,raw_user_meta_data)
values ('19000000-0000-4000-8000-000000000001','h19-m3@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('19000000-0000-4000-8000-000000000010','H19 Tenant A','h19-m3-a','Europe/Istanbul','19000000-0000-4000-8000-000000000001'),
  ('19000000-0000-4000-8000-000000000020','H19 Tenant B','h19-m3-b','Europe/Istanbul','19000000-0000-4000-8000-000000000001');

do $$
declare
  v_new boolean;
  v_appointment uuid;
  v_error text;
begin
  select c.is_new,c.appointment_id
  into v_new,v_appointment
  from public.claim_booking_command(
    '19000000-0000-4000-8000-000000000010',
    'h19-shared-key-0001',
    'create',
    'h19-request-hash-a',
    null
  ) c;
  if not v_new or v_appointment is not null then
    raise exception 'H19 M3 tenant A initial claim was not new';
  end if;

  select c.is_new,c.appointment_id
  into v_new,v_appointment
  from public.claim_booking_command(
    '19000000-0000-4000-8000-000000000020',
    'h19-shared-key-0001',
    'create',
    'h19-request-hash-b',
    null
  ) c;
  if not v_new or v_appointment is not null then
    raise exception 'H19 M3 tenant B initial claim was not new';
  end if;

  -- Make the no-tenant-predicate mutant deterministic: a sequential scan sees
  -- tenant A first. The correct query still filters by business_id and reaches B.
  cluster public.booking_commands using booking_commands_pkey;
  analyze public.booking_commands;
  set local enable_indexscan = off;
  set local enable_bitmapscan = off;

  begin
    perform *
    from public.claim_booking_command(
      '19000000-0000-4000-8000-000000000020',
      'h19-shared-key-0001',
      'create',
      'h19-request-hash-b',
      null
    );
    raise exception 'H19_EXPECTED_IDEMPOTENCY_IN_PROGRESS_NOT_RAISED';
  exception when others then
    v_error := sqlerrm;
    if v_error = 'H19_EXPECTED_IDEMPOTENCY_IN_PROGRESS_NOT_RAISED' then
      raise;
    end if;
    if position('IDEMPOTENCY_IN_PROGRESS' in v_error) = 0 then
      raise exception 'H19 M3 D0xD1 tenant-scoped retry selected the wrong ledger row: %', v_error;
    end if;
  end;
end
$$;

rollback;
