begin;

-- H19 prospective coverage test: D0 x D1 (tenant isolation x idempotency).
--
-- The booking command identity is (business_id, idempotency_key). Three tenants
-- intentionally reuse the same idempotency key with different request hashes.
-- Each retry must resolve only its own tenant-scoped ledger row.
--
-- This test was designed only after the frozen S0 suite allowed the M3 mutant
-- (tenant predicate removed from claim_booking_command's existing-row lookup)
-- to survive. It is therefore prospective coverage evidence, not a retrofit
-- used to select the mutant.

insert into auth.users(id,email,raw_user_meta_data)
values
  ('a1900000-0000-4000-8000-000000000001','h19-d0d1-a@example.invalid','{}'::jsonb),
  ('a1900000-0000-4000-8000-000000000002','h19-d0d1-b@example.invalid','{}'::jsonb),
  ('a1900000-0000-4000-8000-000000000003','h19-d0d1-c@example.invalid','{}'::jsonb)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values
  ('a1910000-0000-4000-8000-000000000001','H19 D0D1 Tenant A','h19-d0d1-a','Europe/Istanbul','a1900000-0000-4000-8000-000000000001'),
  ('a1910000-0000-4000-8000-000000000002','H19 D0D1 Tenant B','h19-d0d1-b','Europe/Istanbul','a1900000-0000-4000-8000-000000000002'),
  ('a1910000-0000-4000-8000-000000000003','H19 D0D1 Tenant C','h19-d0d1-c','Europe/Istanbul','a1900000-0000-4000-8000-000000000003');

do $$
declare
  v_key constant text := 'h19-shared-idempotency-0001';
  v_new boolean;
  v_progress integer := 0;
begin
  select c.is_new into v_new
  from public.claim_booking_command(
    'a1910000-0000-4000-8000-000000000001',
    v_key,'create',md5('h19-tenant-a'),null
  ) c;
  if v_new is distinct from true then
    raise exception 'H19 D0xD1 tenant A initial claim was not new';
  end if;

  select c.is_new into v_new
  from public.claim_booking_command(
    'a1910000-0000-4000-8000-000000000002',
    v_key,'create',md5('h19-tenant-b'),null
  ) c;
  if v_new is distinct from true then
    raise exception 'H19 D0xD1 tenant B initial claim was not new';
  end if;

  select c.is_new into v_new
  from public.claim_booking_command(
    'a1910000-0000-4000-8000-000000000003',
    v_key,'create',md5('h19-tenant-c'),null
  ) c;
  if v_new is distinct from true then
    raise exception 'H19 D0xD1 tenant C initial claim was not new';
  end if;

  if (
    select count(*)
    from public.booking_commands
    where idempotency_key = v_key
  ) <> 3 then
    raise exception 'H19 D0xD1 fixture did not create three tenant-scoped ledger rows';
  end if;

  -- Correct behavior for an unfinished same-request retry is
  -- IDEMPOTENCY_IN_PROGRESS. IDEMPOTENCY_CONFLICT here means the retry read
  -- another tenant's row despite the composite ledger identity.
  begin
    perform * from public.claim_booking_command(
      'a1910000-0000-4000-8000-000000000001',
      v_key,'create',md5('h19-tenant-a'),null
    );
    raise exception 'H19 D0xD1 tenant A retry unexpectedly returned';
  exception when others then
    if position('IDEMPOTENCY_IN_PROGRESS' in sqlerrm) > 0 then
      v_progress := v_progress + 1;
    elsif position('IDEMPOTENCY_CONFLICT' in sqlerrm) > 0 then
      raise exception 'H19 D0xD1 cross-tenant ledger bleed on tenant A';
    else
      raise;
    end if;
  end;

  begin
    perform * from public.claim_booking_command(
      'a1910000-0000-4000-8000-000000000002',
      v_key,'create',md5('h19-tenant-b'),null
    );
    raise exception 'H19 D0xD1 tenant B retry unexpectedly returned';
  exception when others then
    if position('IDEMPOTENCY_IN_PROGRESS' in sqlerrm) > 0 then
      v_progress := v_progress + 1;
    elsif position('IDEMPOTENCY_CONFLICT' in sqlerrm) > 0 then
      raise exception 'H19 D0xD1 cross-tenant ledger bleed on tenant B';
    else
      raise;
    end if;
  end;

  begin
    perform * from public.claim_booking_command(
      'a1910000-0000-4000-8000-000000000003',
      v_key,'create',md5('h19-tenant-c'),null
    );
    raise exception 'H19 D0xD1 tenant C retry unexpectedly returned';
  exception when others then
    if position('IDEMPOTENCY_IN_PROGRESS' in sqlerrm) > 0 then
      v_progress := v_progress + 1;
    elsif position('IDEMPOTENCY_CONFLICT' in sqlerrm) > 0 then
      raise exception 'H19 D0xD1 cross-tenant ledger bleed on tenant C';
    else
      raise;
    end if;
  end;

  if v_progress <> 3 then
    raise exception 'H19 D0xD1 expected three tenant-scoped in-progress retries, got %', v_progress;
  end if;

  raise notice 'H19 D0xD1 prospective invariant accepted: shared key remains tenant-scoped';
end
$$;

rollback;
