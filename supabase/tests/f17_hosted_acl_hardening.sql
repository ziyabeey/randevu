-- F17-01 hosted Supabase ACL acceptance.
-- The bootstrap mirrors Supabase's permissive function defaults; the hardening
-- migration must leave only the intended application RPC surface executable.

do $$
declare
  r record;
  v_oid oid;
  v_actual boolean;
  v_config text[];
begin
  for r in
    select * from (values
      -- authenticated-only operator/member RPCs
      ('authenticated','public.is_active_member(uuid)',true),
      ('anon','public.is_active_member(uuid)',false),
      ('authenticated','public.current_membership_role(uuid)',true),
      ('anon','public.current_membership_role(uuid)',false),
      ('authenticated','public.can_manage_business(uuid)',true),
      ('anon','public.can_manage_business(uuid)',false),
      ('authenticated','public.create_business_with_owner(text,text,text)',true),
      ('anon','public.create_business_with_owner(text,text,text)',false),
      ('authenticated','public.replace_business_hours(uuid,smallint,jsonb)',true),
      ('anon','public.replace_business_hours(uuid,smallint,jsonb)',false),
      ('authenticated','public.replace_staff_hours(uuid,uuid,smallint,jsonb)',true),
      ('anon','public.replace_staff_hours(uuid,uuid,smallint,jsonb)',false),
      ('authenticated','public.create_availability_block_local(uuid,uuid,date,time without time zone,time without time zone,text)',true),
      ('anon','public.create_availability_block_local(uuid,uuid,date,time without time zone,time without time zone,text)',false),
      ('authenticated','public.delete_availability_block(uuid,uuid)',true),
      ('anon','public.delete_availability_block(uuid,uuid)',false),
      ('authenticated','public.compute_availability_slots(uuid,uuid,date,uuid,integer)',true),
      ('anon','public.compute_availability_slots(uuid,uuid,date,uuid,integer)',false),
      ('authenticated','public.create_appointment(uuid,text,text,uuid,uuid,timestamp with time zone,text,text,text)',true),
      ('anon','public.create_appointment(uuid,text,text,uuid,uuid,timestamp with time zone,text,text,text)',false),
      ('authenticated','public.compute_reschedule_slots(uuid,uuid,date,uuid,integer)',true),
      ('anon','public.compute_reschedule_slots(uuid,uuid,date,uuid,integer)',false),
      ('authenticated','public.reschedule_appointment(uuid,uuid,text,uuid,timestamp with time zone)',true),
      ('anon','public.reschedule_appointment(uuid,uuid,text,uuid,timestamp with time zone)',false),
      ('authenticated','public.set_appointment_status(uuid,uuid,text,text,text)',true),
      ('anon','public.set_appointment_status(uuid,uuid,text,text,text)',false),
      ('authenticated','public.update_public_booking_settings(uuid,boolean,integer,integer,integer)',true),
      ('anon','public.update_public_booking_settings(uuid,boolean,integer,integer,integer)',false),
      ('authenticated','public.get_calendar_appointments(uuid,date,integer,uuid)',true),
      ('anon','public.get_calendar_appointments(uuid,date,integer,uuid)',false),

      -- token-scoped customer management stays anonymous only
      ('anon','public.get_public_managed_appointment(text)',true),
      ('authenticated','public.get_public_managed_appointment(text)',false),
      ('anon','public.compute_public_management_slots(text,date,uuid)',true),
      ('authenticated','public.compute_public_management_slots(text,date,uuid)',false),
      ('anon','public.reschedule_public_managed_appointment(text,text,uuid,timestamp with time zone)',true),
      ('authenticated','public.reschedule_public_managed_appointment(text,text,uuid,timestamp with time zone)',false),
      ('anon','public.cancel_public_managed_appointment(text,text,text)',true),
      ('authenticated','public.cancel_public_managed_appointment(text,text,text)',false),

      -- server-gated public booking stays anonymous only
      ('anon','public.get_public_booking_business_guarded(text,text,text,text)',true),
      ('authenticated','public.get_public_booking_business_guarded(text,text,text,text)',false),
      ('anon','public.get_public_booking_services_guarded(text,text,text,text)',true),
      ('authenticated','public.get_public_booking_services_guarded(text,text,text,text)',false),
      ('anon','public.get_public_booking_staff_guarded(text,uuid,text,text,text)',true),
      ('authenticated','public.get_public_booking_staff_guarded(text,uuid,text,text,text)',false),
      ('anon','public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text)',true),
      ('authenticated','public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text)',false),
      ('anon','public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text,text,text,text)',true),
      ('authenticated','public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text,text,text,text)',false),
      ('anon','public.recover_public_appointment_guarded(uuid,text,text,text,text,text)',true),
      ('authenticated','public.recover_public_appointment_guarded(uuid,text,text,text,text,text)',false),

      -- notification dispatcher is server-secret gated and anonymous transport only
      ('anon','public.claim_notification_jobs(text,integer,integer)',true),
      ('authenticated','public.claim_notification_jobs(text,integer,integer)',false),
      ('anon','public.complete_notification_job(text,uuid,uuid,text)',true),
      ('authenticated','public.complete_notification_job(text,uuid,uuid,text)',false),
      ('anon','public.release_notification_job(text,uuid,uuid,text,boolean,integer)',true),
      ('authenticated','public.release_notification_job(text,uuid,uuid,text,boolean,integer)',false),
      ('anon','public.maintain_notification_jobs(text)',true),
      ('authenticated','public.maintain_notification_jobs(text)',false),

      -- implementation/internal helpers must never be direct API RPCs
      ('anon','public.claim_booking_command(uuid,text,text,text,uuid)',false),
      ('authenticated','public.claim_booking_command(uuid,text,text,text,uuid)',false),
      ('anon','public.compute_availability_slots_internal(uuid,uuid,date,uuid,integer,uuid)',false),
      ('authenticated','public.compute_availability_slots_internal(uuid,uuid,date,uuid,integer,uuid)',false),
      ('anon','public.management_token_hash(text)',false),
      ('authenticated','public.management_token_hash(text)',false),
      ('anon','public.notification_dispatch_authorized(text)',false),
      ('authenticated','public.notification_dispatch_authorized(text)',false),
      ('anon','public.public_booking_gate_authorized(text)',false),
      ('authenticated','public.public_booking_gate_authorized(text)',false),
      ('anon','public.consume_public_booking_rate(text,text,text,integer,integer)',false),
      ('authenticated','public.consume_public_booking_rate(text,text,text,integer,integer)',false),
      ('anon','public.enforce_public_booking_rate(text,text,text,uuid)',false),
      ('authenticated','public.enforce_public_booking_rate(text,text,text,uuid)',false),
      ('anon','public.prune_public_booking_rate_counters()',false),
      ('authenticated','public.prune_public_booking_rate_counters()',false),
      ('anon','public.handle_new_user()',false),
      ('authenticated','public.handle_new_user()',false),
      ('anon','public.validate_business_timezone()',false),
      ('authenticated','public.validate_business_timezone()',false),
      ('anon','public.ensure_public_booking_settings()',false),
      ('authenticated','public.ensure_public_booking_settings()',false),
      ('anon','public.enqueue_public_booking_confirmation()',false),
      ('authenticated','public.enqueue_public_booking_confirmation()',false),

      -- legacy two-step provisioning and raw public implementations stay closed
      ('anon','public.provision_public_management_token(uuid,text,text)',false),
      ('authenticated','public.provision_public_management_token(uuid,text,text)',false),
      ('anon','public.get_public_booking_business(text)',false),
      ('authenticated','public.get_public_booking_business(text)',false),
      ('anon','public.get_public_booking_services(text)',false),
      ('authenticated','public.get_public_booking_services(text)',false),
      ('anon','public.get_public_booking_staff(text,uuid)',false),
      ('authenticated','public.get_public_booking_staff(text,uuid)',false),
      ('anon','public.compute_public_booking_slots(text,uuid,date,uuid)',false),
      ('authenticated','public.compute_public_booking_slots(text,uuid,date,uuid)',false),
      ('anon','public.create_public_appointment(text,text,text,uuid,uuid,timestamp with time zone,text,text,text)',false),
      ('authenticated','public.create_public_appointment(text,text,text,uuid,uuid,timestamp with time zone,text,text,text)',false),
      ('anon','public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)',false),
      ('authenticated','public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamp with time zone,text,uuid,text,text,text,smallint,text,text,text)',false),
      ('anon','public.recover_public_appointment(uuid,text,text)',false),
      ('authenticated','public.recover_public_appointment(uuid,text,text)',false)
    ) as expected(role_name, signature, allowed)
  loop
    v_oid := to_regprocedure(r.signature)::oid;
    if v_oid is null then
      raise exception 'ACL acceptance references missing function: %', r.signature;
    end if;
    v_actual := has_function_privilege(r.role_name, v_oid, 'EXECUTE');
    if v_actual is distinct from r.allowed then
      raise exception 'unexpected EXECUTE privilege for % on %: expected %, got %',
        r.role_name, r.signature, r.allowed, v_actual;
    end if;
  end loop;

  select p.proconfig into v_config
  from pg_proc p
  where p.oid = 'public.touch_updated_at()'::regprocedure;
  if v_config is null or not ('search_path=public' = any(v_config)) then
    raise exception 'touch_updated_at search_path is not pinned to public: %', v_config;
  end if;
end
$$;

-- The future default must be deny-by-default for API roles too, otherwise a new
-- function can silently become a PostgREST RPC on hosted Supabase.
create function public.f17_acl_probe()
returns boolean
language sql
as $$ select true $$;

do $$
begin
  if has_function_privilege('anon', 'public.f17_acl_probe()'::regprocedure, 'EXECUTE') then
    raise exception 'future public functions still auto-grant EXECUTE to anon';
  end if;
  if has_function_privilege('authenticated', 'public.f17_acl_probe()'::regprocedure, 'EXECUTE') then
    raise exception 'future public functions still auto-grant EXECUTE to authenticated';
  end if;
end
$$;

drop function public.f17_acl_probe();
