begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '18000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase9-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '4a000000-0000-4000-8000-000000000001','Recovery Test','recovery-test','Europe/Istanbul',
  '18000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '5a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001',
  '18000000-0000-4000-8000-000000000001','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '6a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001',
  'Recovery Hizmeti',30,5,5,190000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '7a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','Recovery Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '4a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',
  '6a000000-0000-4000-8000-000000000001',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

set local role authenticated;
select set_config('request.jwt.claim.sub','18000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '4a000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '4a000000-0000-4000-8000-000000000001',
    '7a000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '4a000000-0000-4000-8000-000000000001', true, 15, 0, 30
  );
end
$$;

select set_config('request.jwt.claim.sub','',true);
set local role anon;

-- New flow: appointment + capability + recovery bootstrap commit atomically.
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:05') at time zone 'Europe/Istanbul';
  v_token text := 'ccccccccccccccccccccccccccccccccccccccccccc';
  v_secret text := 'ddddddddddddddddddddddddddddddddddddddddddd';
  v_token_hash text := encode(digest(v_token,'sha256'),'hex');
  v_secret_hash text := encode(digest(v_secret,'sha256'),'hex');
  v_id uuid;
  v_retry uuid;
  v_recovered record;
begin
  select appointment_id into v_id
  from public.create_public_appointment_with_recovery(
    'recovery-test','phase9-create-0001','Recovery Müşteri',
    '6a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',
    v_start,
    v_token_hash,'8a000000-0000-4000-8000-000000000001',v_secret_hash,
    'ciphertext-original-abcdefghijklmnopqrstuvwxyz012345','iv-original-1234',1::smallint,
    '+90 555 900 00 01','phase9@example.test',null
  );
  if v_id is null then raise exception 'atomic recovery booking was not created'; end if;

  if (select count(*) from public.get_public_managed_appointment(v_token)) <> 1 then
    raise exception 'atomic create did not provision management capability';
  end if;

  select appointment_id into v_retry
  from public.create_public_appointment_with_recovery(
    'recovery-test','phase9-create-0001','Recovery Müşteri',
    '6a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',
    v_start,
    v_token_hash,'8a000000-0000-4000-8000-000000000001',v_secret_hash,
    'ciphertext-retry-different-abcdefghijklmnopqrstuvwxyz','iv-retry-567890',1::smallint,
    '+90 555 900 00 01','phase9@example.test',null
  );
  if v_retry <> v_id then raise exception 'same booking retry created a different appointment'; end if;

  select * into v_recovered
  from public.recover_public_appointment(
    '8a000000-0000-4000-8000-000000000001','phase9-create-0001',v_secret_hash
  );
  if v_recovered.appointment_id <> v_id then raise exception 'valid recovery proof did not return booking'; end if;
  if v_recovered.management_token_ciphertext <> 'ciphertext-original-abcdefghijklmnopqrstuvwxyz012345' then
    raise exception 'same-intent retry replaced stable encrypted recovery material';
  end if;

  if (select count(*) from public.recover_public_appointment(
    '8a000000-0000-4000-8000-000000000001','phase9-create-0001',
    encode(digest('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','sha256'),'hex')
  )) <> 0 then
    raise exception 'wrong recovery secret disclosed booking';
  end if;

  if (select count(*) from public.recover_public_appointment(
    '8a000000-0000-4000-8000-000000000001','phase9-wrong-key',v_secret_hash
  )) <> 0 then
    raise exception 'wrong idempotency key disclosed booking';
  end if;

  begin
    perform public.create_public_appointment_with_recovery(
      'recovery-test','phase9-create-0001','Recovery Müşteri',
      '6a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',
      v_start,
      v_token_hash,'8a000000-0000-4000-8000-000000000001',
      encode(digest('fffffffffffffffffffffffffffffffffffffffffff','sha256'),'hex'),
      'ciphertext-original-abcdefghijklmnopqrstuvwxyz012345','iv-original-1234',1::smallint,
      '+90 555 900 00 01','phase9@example.test',null
    );
    raise exception 'changed recovery secret was accepted for same key';
  exception when others then
    if sqlerrm = 'changed recovery secret was accepted for same key' then raise; end if;
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.create_public_appointment_with_recovery(
      'recovery-test','phase9-create-0001','Recovery Müşteri',
      '6a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',
      v_start,
      v_token_hash,'8a000000-0000-4000-8000-000000000099',v_secret_hash,
      'ciphertext-original-abcdefghijklmnopqrstuvwxyz012345','iv-original-1234',1::smallint,
      '+90 555 900 00 01','phase9@example.test',null
    );
    raise exception 'changed recovery id was accepted for same key';
  exception when others then
    if sqlerrm = 'changed recovery id was accepted for same key' then raise; end if;
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform count(*) from public.public_booking_recoveries;
    raise exception 'anon can read public booking recovery table directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- Privileged checks: secrets are never stored in plaintext.
reset role;
do $$
declare
  v_token text := 'ccccccccccccccccccccccccccccccccccccccccccc';
  v_secret text := 'ddddddddddddddddddddddddddddddddddddddddddd';
  v_row public.public_booking_recoveries;
begin
  select * into v_row
  from public.public_booking_recoveries
  where recovery_id='8a000000-0000-4000-8000-000000000001';

  if v_row.appointment_id is null then raise exception 'recovery row was not linked to appointment'; end if;
  if v_row.management_token_hash = v_token or position(v_token in v_row.management_token_ciphertext) > 0 then
    raise exception 'plain management token leaked into recovery storage';
  end if;
  if v_row.recovery_secret_hash = v_secret then
    raise exception 'plain recovery secret leaked into recovery storage';
  end if;
  if v_row.management_token_hash <> encode(digest(v_token,'sha256'),'hex') then
    raise exception 'management token hash binding is incorrect';
  end if;
  if v_row.recovery_secret_hash <> encode(digest(v_secret,'sha256'),'hex') then
    raise exception 'recovery secret hash binding is incorrect';
  end if;
end
$$;

-- Reusing the same management bearer for another appointment must fail and the
-- new appointment/recovery bootstrap must roll back with it.
set local role anon;
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '11:05') at time zone 'Europe/Istanbul';
  v_token_hash text := encode(digest('ccccccccccccccccccccccccccccccccccccccccccc','sha256'),'hex');
  v_secret_hash text := encode(digest('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','sha256'),'hex');
begin
  begin
    perform public.create_public_appointment_with_recovery(
      'recovery-test','phase9-create-0002','Atomic Rollback',
      '6a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000001',
      v_start,
      v_token_hash,'8a000000-0000-4000-8000-000000000002',v_secret_hash,
      'ciphertext-second-abcdefghijklmnopqrstuvwxyz0123456','iv-second-12345',1::smallint,
      '+90 555 900 00 02','phase9-2@example.test',null
    );
    raise exception 'duplicate management bearer was accepted';
  exception when others then
    if sqlerrm = 'duplicate management bearer was accepted' then raise; end if;
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

reset role;
do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '11:05') at time zone 'Europe/Istanbul';
begin
  if exists (
    select 1 from public.appointments
    where business_id='4a000000-0000-4000-8000-000000000001'
      and starts_at=v_start
  ) then raise exception 'capability failure left an orphan appointment'; end if;

  if exists (
    select 1 from public.public_booking_recoveries
    where business_id='4a000000-0000-4000-8000-000000000001'
      and idempotency_key='phase9-create-0002'
  ) then raise exception 'capability failure left an orphan recovery bootstrap'; end if;
end
$$;

-- Expired recovery proof returns no booking and lazily clears the proof hash.
update public.public_booking_recoveries
set expires_at=now()-interval '1 minute'
where recovery_id='8a000000-0000-4000-8000-000000000001';

set local role anon;
do $$
declare
  v_secret_hash text := encode(digest('ddddddddddddddddddddddddddddddddddddddddddd','sha256'),'hex');
begin
  if (select count(*) from public.recover_public_appointment(
    '8a000000-0000-4000-8000-000000000001','phase9-create-0001',v_secret_hash
  )) <> 0 then raise exception 'expired recovery proof still returned booking'; end if;
end
$$;

reset role;
do $$
begin
  if exists (
    select 1 from public.public_booking_recoveries
    where recovery_id='8a000000-0000-4000-8000-000000000001'
      and recovery_secret_hash is not null
  ) then raise exception 'expired recovery proof hash was not cleaned'; end if;
end
$$;

rollback;
