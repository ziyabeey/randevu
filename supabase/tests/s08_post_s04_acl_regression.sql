-- S08 regression for the current ACL surface after S03/S04.
-- The historical F17 acceptance runs earlier, immediately after F17 hardening.
-- Later migrations intentionally narrow several RPCs, so this test asserts the
-- final contract S08 must preserve instead of replaying stale F17 expectations.

do $$
declare
  r record;
  v_oid oid;
  v_actual boolean;
begin
  for r in
    select * from (values
      -- Authenticated business creation goes only through the S04 bounded wrapper.
      ('authenticated','public.create_business_with_owner(text,text,text)',false),
      ('anon','public.create_business_with_owner(text,text,text)',false),
      ('authenticated','public.create_business_with_owner_guarded(text,text,text)',true),
      ('anon','public.create_business_with_owner_guarded(text,text,text)',false),

      -- Public booking/management has one server-gated anonymous transport.
      ('anon','public.execute_public_operation(text,jsonb,text,text,text)',true),
      ('authenticated','public.execute_public_operation(text,jsonb,text,text,text)',false),

      -- S04 retires the pre-wrapper anonymous management surface.
      ('anon','public.get_public_managed_appointment(text)',false),
      ('authenticated','public.get_public_managed_appointment(text)',false),
      ('anon','public.compute_public_management_slots(text,date,uuid)',false),
      ('authenticated','public.compute_public_management_slots(text,date,uuid)',false),
      ('anon','public.reschedule_public_managed_appointment(text,text,uuid,timestamp with time zone)',false),
      ('authenticated','public.reschedule_public_managed_appointment(text,text,uuid,timestamp with time zone)',false),
      ('anon','public.cancel_public_managed_appointment(text,text,text)',false),
      ('authenticated','public.cancel_public_managed_appointment(text,text,text)',false),

      -- The older per-operation guarded public RPCs are also implementation-only.
      ('anon','public.get_public_booking_business_guarded(text,text,text,text)',false),
      ('authenticated','public.get_public_booking_business_guarded(text,text,text,text)',false),
      ('anon','public.get_public_booking_services_guarded(text,text,text,text)',false),
      ('authenticated','public.get_public_booking_services_guarded(text,text,text,text)',false),
      ('anon','public.get_public_booking_staff_guarded(text,uuid,text,text,text)',false),
      ('authenticated','public.get_public_booking_staff_guarded(text,uuid,text,text,text)',false),
      ('anon','public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text)',false),
      ('authenticated','public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text)',false),
      ('anon','public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text,text,text,text)',false),
      ('authenticated','public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text,text,text,text)',false),
      ('anon','public.recover_public_appointment_guarded(uuid,text,text,text,text,text)',false),
      ('authenticated','public.recover_public_appointment_guarded(uuid,text,text,text,text,text)',false),

      -- S03 pauses v1 dispatch and exposes only the server-secret-gated v2 transport.
      ('anon','public.claim_notification_jobs(text,integer,integer)',false),
      ('authenticated','public.claim_notification_jobs(text,integer,integer)',false),
      ('anon','public.complete_notification_job(text,uuid,uuid,text)',false),
      ('authenticated','public.complete_notification_job(text,uuid,uuid,text)',false),
      ('anon','public.release_notification_job(text,uuid,uuid,text,boolean,integer)',false),
      ('authenticated','public.release_notification_job(text,uuid,uuid,text,boolean,integer)',false),
      ('anon','public.claim_notification_jobs_v2(text,integer,integer)',true),
      ('authenticated','public.claim_notification_jobs_v2(text,integer,integer)',false),
      ('anon','public.lock_notification_request_v2(text,uuid,uuid,text,text,text)',true),
      ('authenticated','public.lock_notification_request_v2(text,uuid,uuid,text,text,text)',false),
      ('anon','public.complete_notification_job_v2(text,uuid,uuid,text,text)',true),
      ('authenticated','public.complete_notification_job_v2(text,uuid,uuid,text,text)',false),
      ('anon','public.release_notification_job_v2(text,uuid,uuid,text,boolean,integer,boolean)',true),
      ('authenticated','public.release_notification_job_v2(text,uuid,uuid,text,boolean,integer,boolean)',false),
      ('anon','public.maintain_notification_jobs(text)',true),
      ('authenticated','public.maintain_notification_jobs(text)',false),

      -- Authorization/quota helpers remain non-RPC implementation details.
      ('anon','public.notification_dispatch_authorized(text)',false),
      ('authenticated','public.notification_dispatch_authorized(text)',false),
      ('anon','public.public_booking_gate_authorized(text)',false),
      ('authenticated','public.public_booking_gate_authorized(text)',false),
      ('anon','public.consume_public_booking_rate(text,text,text,integer,integer)',false),
      ('authenticated','public.consume_public_booking_rate(text,text,text,integer,integer)',false),
      ('anon','public.enforce_public_booking_rate(text,text,text,uuid)',false),
      ('authenticated','public.enforce_public_booking_rate(text,text,text,uuid)',false),
      ('anon','public.prune_public_booking_rate_counters()',false),
      ('authenticated','public.prune_public_booking_rate_counters()',false)
    ) as expected(role_name, signature, allowed)
  loop
    v_oid := to_regprocedure(r.signature)::oid;
    if v_oid is null then
      raise exception 'S08 post-S04 ACL regression references missing function: %', r.signature;
    end if;

    v_actual := has_function_privilege(r.role_name, v_oid, 'EXECUTE');
    if v_actual is distinct from r.allowed then
      raise exception 'unexpected post-S04 EXECUTE privilege for % on %: expected %, got %',
        r.role_name, r.signature, r.allowed, v_actual;
    end if;
  end loop;
end
$$;
