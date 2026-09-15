-- This assertion is intentionally rerunnable. CI executes it once after the F11
-- migration and again after re-applying the migration to prove upgrade idempotence.

do $$
declare
  v_expected jsonb;
  v_appointments bigint;
  v_events bigint;
  v_commands bigint;
  v_capabilities bigint;
  v_recoveries bigint;
  v_jobs bigint;
begin
  select payload into strict v_expected
  from public.f11_upgrade_expected where entity='counts' and row_key='all';

  select count(*) into v_appointments from public.appointments
    where business_id='d1210000-0000-4000-8000-000000000001';
  select count(*) into v_events from public.appointment_events
    where business_id='d1210000-0000-4000-8000-000000000001';
  select count(*) into v_commands from public.booking_commands
    where business_id='d1210000-0000-4000-8000-000000000001';
  select count(*) into v_capabilities from public.appointment_management_capabilities
    where business_id='d1210000-0000-4000-8000-000000000001';
  select count(*) into v_recoveries from public.public_booking_recoveries
    where business_id='d1210000-0000-4000-8000-000000000001';
  select count(*) into v_jobs from public.appointment_notification_jobs
    where business_id='d1210000-0000-4000-8000-000000000001';

  if v_appointments <> (v_expected->>'appointments')::bigint
     or v_events <> (v_expected->>'events')::bigint
     or v_commands <> (v_expected->>'commands')::bigint
     or v_capabilities <> (v_expected->>'capabilities')::bigint
     or v_recoveries <> (v_expected->>'recoveries')::bigint
     or v_jobs <> (v_expected->>'jobs')::bigint then
    raise exception 'F11 upgrade changed legacy evidence counts: %/%/%/%/%/% expected %',
      v_appointments,v_events,v_commands,v_capabilities,v_recoveries,v_jobs,v_expected;
  end if;

  if (select count(*) from public.appointment_groups
      where business_id='d1210000-0000-4000-8000-000000000001') <> v_appointments then
    raise exception 'F11 upgrade did not create exactly one legacy group per appointment';
  end if;
end
$$;

-- Every original row must remain byte-for-byte equivalent after subtracting only
-- the additive F11 columns.
do $$
begin
  if exists (
    select 1
    from public.f11_upgrade_expected x
    left join public.appointments a on a.id=x.row_key::uuid
    where x.entity='appointment'
      and (a.id is null or x.payload <> (
        to_jsonb(a) - ARRAY[
          'group_id','line_ordinal','price_type_snapshot','price_min_minor_snapshot',
          'price_max_minor_snapshot','price_policy_version_snapshot'
        ]::text[]
      ))
  ) then raise exception 'F11 upgrade rewrote legacy appointment identity/snapshot/timestamps'; end if;

  if exists (
    select 1
    from public.f11_upgrade_expected x
    left join public.appointment_events e on e.id=x.row_key::uuid
    where x.entity='event'
      and (e.id is null or x.payload <> (to_jsonb(e) - ARRAY['group_id','group_version']::text[]))
  ) then raise exception 'F11 upgrade rewrote legacy audit event evidence'; end if;

  if exists (
    select 1
    from public.f11_upgrade_expected x
    left join public.booking_commands c
      on x.row_key=c.business_id::text||'/'||c.idempotency_key
    where x.entity='command'
      and (c.business_id is null or x.payload <> (to_jsonb(c) - 'group_id'))
  ) then raise exception 'F11 upgrade rewrote booking command key/hash/result evidence'; end if;

  if exists (
    select 1
    from public.f11_upgrade_expected x
    left join public.appointment_management_capabilities c on c.appointment_id=x.row_key::uuid
    where x.entity='capability'
      and (c.group_id is null or x.payload <> (to_jsonb(c) - 'group_id'))
  ) then raise exception 'F11 upgrade rewrote management capability hash/legacy anchor'; end if;

  if exists (
    select 1
    from public.f11_upgrade_expected x
    left join public.public_booking_recoveries r on r.recovery_id=x.row_key::uuid
    where x.entity='recovery'
      and (r.recovery_id is null or x.payload <> (to_jsonb(r) - 'group_id'))
  ) then raise exception 'F11 upgrade rewrote recovery proof/ciphertext/TTL evidence'; end if;

  if exists (
    select 1
    from public.f11_upgrade_expected x
    left join public.appointment_notification_jobs j on j.id=x.row_key::uuid
    where x.entity='job'
      and (j.id is null or x.payload <> (to_jsonb(j) - ARRAY['group_id','group_version']::text[]))
  ) then raise exception 'F11 upgrade rewrote notification lifecycle/provider evidence'; end if;
end
$$;

-- Deterministic one-line mapping, canonical fixed snapshots and group version are
-- derived without manufacturing history.
do $$
begin
  if exists (
    select 1
    from public.appointments a
    join public.appointment_groups g
      on g.business_id=a.business_id and g.id=a.group_id
    where a.business_id='d1210000-0000-4000-8000-000000000001'
      and (
        a.group_id <> a.id
        or a.line_ordinal <> 1
        or a.price_type_snapshot <> 'fixed'
        or a.price_min_minor_snapshot <> a.price_minor_snapshot
        or a.price_max_minor_snapshot <> a.price_minor_snapshot
        or a.price_policy_version_snapshot <> 1
        or g.legacy_appointment_id <> a.id
        or g.customer_id <> a.customer_id
        or g.status <> a.status
        or g.source <> a.source
        or g.created_at <> a.created_at
        or g.updated_at <> a.updated_at
        or g.version <> greatest(1,(
          select count(*)::integer from public.appointment_events e
          where e.business_id=a.business_id and e.appointment_id=a.id
        ))
      )
  ) then raise exception 'F11 legacy appointment->group/line backfill mismatch'; end if;

  if exists (
    select 1 from public.appointment_events e
    join public.appointments a
      on a.business_id=e.business_id and a.id=e.appointment_id
    where e.business_id='d1210000-0000-4000-8000-000000000001'
      and (e.group_id<>a.group_id or e.group_version<1)
  ) then raise exception 'F11 legacy audit group bridge mismatch'; end if;

  if exists (
    select 1 from public.booking_commands c
    join public.appointments a
      on a.business_id=c.business_id and a.id=c.appointment_id
    where c.business_id='d1210000-0000-4000-8000-000000000001'
      and c.group_id<>a.group_id
  ) then raise exception 'F11 command group bridge mismatch'; end if;

  if exists (
    select 1 from public.appointment_management_capabilities c
    join public.appointments a
      on a.business_id=c.business_id and a.id=c.appointment_id
    where c.business_id='d1210000-0000-4000-8000-000000000001'
      and c.group_id<>a.group_id
  ) then raise exception 'F11 capability group bridge mismatch'; end if;

  if exists (
    select 1 from public.public_booking_recoveries r
    join public.appointments a
      on a.business_id=r.business_id and a.id=r.appointment_id
    where r.business_id='d1210000-0000-4000-8000-000000000001'
      and r.group_id<>a.group_id
  ) then raise exception 'F11 recovery group bridge mismatch'; end if;

  if exists (
    select 1 from public.appointment_notification_jobs j
    join public.appointments a
      on a.business_id=j.business_id and a.id=j.appointment_id
    join public.appointment_groups g
      on g.business_id=a.business_id and g.id=a.group_id
    where j.business_id='d1210000-0000-4000-8000-000000000001'
      and (j.group_id<>a.group_id or j.group_version<>g.version)
  ) then raise exception 'F11 notification group/version bridge mismatch'; end if;
end
$$;

-- All five historical outbox states and their provider evidence survive. No F11
-- backfill may enqueue a fresh job or reinterpret provider certainty.
do $$
begin
  if (select count(distinct state) from public.appointment_notification_jobs
      where business_id='d1210000-0000-4000-8000-000000000001'
        and state in ('pending','leased','retry_wait','sent','failed_terminal')) <> 5 then
    raise exception 'F11 upgrade lost an outbox lifecycle state';
  end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where business_id='d1210000-0000-4000-8000-000000000001'
      and state='sent' and provider_message_id='f11-provider-sent-4'
      and delivery_certainty='accepted'
  ) then raise exception 'F11 upgrade lost sent provider receipt'; end if;
  if not exists (
    select 1 from public.appointment_notification_jobs
    where business_id='d1210000-0000-4000-8000-000000000001'
      and state='leased' and lease_token='d1290000-0000-4000-8000-000000000002'
      and delivery_certainty='ambiguous'
  ) then raise exception 'F11 upgrade lost active lease evidence'; end if;
end
$$;

-- Constraint/root metadata is also part of the migration contract.
do $$
declare v_def boolean; v_deferred boolean;
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.appointment_management_capabilities'::regclass
      and c.conname='appointment_management_capabilities_pkey'
      and pg_get_constraintdef(c.oid) like 'PRIMARY KEY (group_id)%'
  ) then raise exception 'F11 capability authority is not group-rooted'; end if;

  select condeferrable,condeferred into v_def,v_deferred
  from pg_constraint
  where conrelid='public.appointments'::regclass and conname='appointments_staff_no_overlap';
  if not v_def or v_deferred then raise exception 'F11 staff exclusion deferrability mismatch'; end if;

  select condeferrable,condeferred into v_def,v_deferred
  from pg_constraint
  where conrelid='public.appointments'::regclass and conname='appointments_group_service_no_overlap';
  if not v_def or v_deferred then raise exception 'F11 group overlap deferrability mismatch'; end if;
end
$$;

raise notice 'F11-01 upgrade preservation assertion accepted';
