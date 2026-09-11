begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '17000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase7-owner@example.test','',now(),'{}','{}',now(),now()
)
on conflict(id) do nothing;

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '49000000-0000-4000-8000-000000000001','Manage Test','manage-test','Europe/Istanbul',
  '17000000-0000-4000-8000-000000000001'
)
on conflict(id) do nothing;

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '59000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000001','owner',true
)
on conflict(business_id,user_id) do update set active=true, role=excluded.role;

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,price_minor,currency
)
values (
  '69000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001',
  'Yönetilebilir Hizmet',30,5,5,175000,'TRY'
)
on conflict(id) do nothing;

insert into public.staff_profiles(id,business_id,name)
values (
  '79000000-0000-4000-8000-000000000001','49000000-0000-4000-8000-000000000001','Manage Ayşe'
)
on conflict(id) do nothing;

insert into public.staff_services(business_id,staff_id,service_id,active)
values (
  '49000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000001',true
)
on conflict(business_id,staff_id,service_id) do update set active=true;

-- Configure the tenant as an authenticated owner.
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
begin
  perform public.replace_business_hours(
    '49000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.replace_staff_hours(
    '49000000-0000-4000-8000-000000000001',
    '79000000-0000-4000-8000-000000000001',
    extract(dow from v_day)::smallint,
    '[{"start":"09:00","end":"17:00"}]'::jsonb
  );
  perform public.update_public_booking_settings(
    '49000000-0000-4000-8000-000000000001', true, 15, 0, 30
  );
end
$$;

-- Anonymous customer creates a real public booking and provisions a capability.
select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
declare
  v_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '10:00') at time zone 'Europe/Istanbul';
  v_id uuid;
  v_token text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
begin
  select appointment_id into v_id
  from public.create_public_appointment(
    'manage-test','phase7-create-0001','Manage Müşteri',
    '69000000-0000-4000-8000-000000000001','79000000-0000-4000-8000-000000000001',
    v_start,'+90 555 700 00 01','phase7@example.test',null
  );
  if v_id is null then raise exception 'phase7 public booking was not created'; end if;

  if not public.provision_public_management_token(v_id,'phase7-create-0001',v_token) then
    raise exception 'management capability was not provisioned';
  end if;

  if (select count(*) from public.get_public_managed_appointment(v_token)) <> 1 then
    raise exception 'valid management token did not resolve appointment';
  end if;
  if (select count(*) from public.get_public_managed_appointment('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')) <> 0 then
    raise exception 'wrong management token resolved an appointment';
  end if;

  begin
    perform count(*) from public.appointment_management_capabilities;
    raise exception 'anon can read management capability table directly';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- Privileged assertion: only the SHA-256 hash is stored, never the bearer token.
reset role;
do $$
declare
  v_token text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_stored_hash text;
begin
  select token_hash into v_stored_hash
  from public.appointment_management_capabilities
  limit 1;
  if v_stored_hash is null or char_length(v_stored_hash) <> 64 then
    raise exception 'management token hash missing';
  end if;
  if v_stored_hash = v_token or position(v_token in v_stored_hash) > 0 then
    raise exception 'plain management token leaked into capability row';
  end if;
end
$$;

-- Disable discovery/new public booking and mutate catalog. Issued capability must survive.
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select public.update_public_booking_settings(
  '49000000-0000-4000-8000-000000000001', false, 15, 0, 30
);
update public.services
set duration_minutes=120, buffer_before_minutes=20, buffer_after_minutes=20, active=false
where id='69000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_new_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '11:00') at time zone 'Europe/Istanbul';
  v_other_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '12:00') at time zone 'Europe/Istanbul';
  v_token text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_row record;
begin
  if not exists (
    select 1 from public.compute_public_management_slots(v_token,v_day,null)
    where starts_at=v_new_start
  ) then
    raise exception 'management link stopped working after public page disable/catalog edit';
  end if;

  select * into v_row
  from public.reschedule_public_managed_appointment(
    v_token,'phase7-reschedule-0001','79000000-0000-4000-8000-000000000001',v_new_start
  );
  if v_row.starts_at <> v_new_start then raise exception 'public management reschedule failed'; end if;
  if extract(epoch from (v_row.ends_at-v_row.starts_at))/60 <> 30 then
    raise exception 'reschedule did not preserve 30 minute snapshot duration';
  end if;

  select * into v_row
  from public.reschedule_public_managed_appointment(
    v_token,'phase7-reschedule-0001','79000000-0000-4000-8000-000000000001',v_new_start
  );
  if v_row.starts_at <> v_new_start then raise exception 'reschedule retry changed result'; end if;

  begin
    perform public.reschedule_public_managed_appointment(
      v_token,'phase7-reschedule-0001','79000000-0000-4000-8000-000000000001',v_other_start
    );
    raise exception 'reschedule idempotency conflict was accepted';
  exception when others then
    if sqlerrm = 'reschedule idempotency conflict was accepted' then raise; end if;
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Privileged audit assertion after anonymous reschedule.
reset role;
do $$
declare
  v_event_count integer;
begin
  select count(*) into v_event_count
  from public.appointment_events e
  join public.appointment_management_capabilities cap
    on cap.business_id=e.business_id and cap.appointment_id=e.appointment_id
  where e.event_type='rescheduled'
    and e.actor_type='public'
    and e.actor_user_id is null;
  if v_event_count <> 1 then raise exception 'public reschedule audit provenance missing'; end if;
end
$$;

-- Re-enable discovery only to verify that cancellation releases the occupied slot.
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-4000-8000-000000000001',true);
select public.update_public_booking_settings(
  '49000000-0000-4000-8000-000000000001', true, 15, 0, 30
);
update public.services
set active=true
where id='69000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','',true);
set local role anon;

do $$
declare
  v_day date := date_trunc('week', current_date)::date + 7;
  v_cancelled_start timestamptz := ((date_trunc('week', current_date)::date + 7) + time '11:00') at time zone 'Europe/Istanbul';
  v_token text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  v_row record;
begin
  select * into v_row
  from public.cancel_public_managed_appointment(v_token,'phase7-cancel-0001','Plan değişti');
  if v_row.status <> 'cancelled' then raise exception 'public management cancel failed'; end if;

  select * into v_row
  from public.cancel_public_managed_appointment(v_token,'phase7-cancel-0001','Plan değişti');
  if v_row.status <> 'cancelled' then raise exception 'cancel retry lost result'; end if;

  if exists (
    select 1 from public.get_public_managed_appointment(v_token)
    where can_cancel or can_reschedule
  ) then
    raise exception 'cancelled appointment remained mutable';
  end if;

  if not exists (
    select 1 from public.compute_public_booking_slots(
      'manage-test','69000000-0000-4000-8000-000000000001',v_day,
      '79000000-0000-4000-8000-000000000001'
    ) where starts_at=v_cancelled_start
  ) then
    raise exception 'cancelled public-managed appointment did not release slot';
  end if;

  begin
    perform public.compute_public_management_slots(v_token,v_day,null);
    raise exception 'cancelled appointment still emitted management slots';
  exception when others then
    if sqlerrm = 'cancelled appointment still emitted management slots' then raise; end if;
    if position('APPOINTMENT_NOT_MANAGEABLE' in sqlerrm)=0 then raise; end if;
  end;
end
$$;

-- Privileged audit assertion after anonymous cancellation.
reset role;
do $$
declare
  v_event_count integer;
begin
  select count(*) into v_event_count
  from public.appointment_events e
  join public.appointment_management_capabilities cap
    on cap.business_id=e.business_id and cap.appointment_id=e.appointment_id
  where e.event_type='cancelled'
    and e.actor_type='public'
    and e.actor_user_id is null;
  if v_event_count <> 1 then raise exception 'public cancel audit provenance missing'; end if;
end
$$;

rollback;
