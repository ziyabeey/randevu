begin;

-- F17-01 live-staging hardening.
-- Hosted Supabase gives new functions in public explicit EXECUTE privileges to
-- anon/authenticated via postgres schema defaults. PostgreSQL also has a global
-- hard-wired PUBLIC EXECUTE default for functions. A schema-scoped revoke cannot
-- cancel that global default, so close both layers before explicitly exposing
-- only the application RPC surface each role needs.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Start from a closed application RPC surface. Keep this list explicit so we do
-- not touch btree_gist/extension support functions that also live in public.
revoke execute on function public.is_active_member(uuid) from public, anon, authenticated;
revoke execute on function public.current_membership_role(uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_business(uuid) from public, anon, authenticated;
revoke execute on function public.create_business_with_owner(text,text,text) from public, anon, authenticated;

revoke execute on function public.replace_business_hours(uuid,smallint,jsonb) from public, anon, authenticated;
revoke execute on function public.replace_staff_hours(uuid,uuid,smallint,jsonb) from public, anon, authenticated;
revoke execute on function public.create_availability_block_local(uuid,uuid,date,time,time,text) from public, anon, authenticated;
revoke execute on function public.delete_availability_block(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.compute_availability_slots(uuid,uuid,date,uuid,integer) from public, anon, authenticated;
revoke execute on function public.compute_availability_slots_internal(uuid,uuid,date,uuid,integer,uuid) from public, anon, authenticated;

revoke execute on function public.create_appointment(uuid,text,text,uuid,uuid,timestamptz,text,text,text) from public, anon, authenticated;
revoke execute on function public.claim_booking_command(uuid,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.compute_reschedule_slots(uuid,uuid,date,uuid,integer) from public, anon, authenticated;
revoke execute on function public.reschedule_appointment(uuid,uuid,text,uuid,timestamptz) from public, anon, authenticated;
revoke execute on function public.set_appointment_status(uuid,uuid,text,text,text) from public, anon, authenticated;

revoke execute on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer) from public, anon, authenticated;
revoke execute on function public.get_calendar_appointments(uuid,date,integer,uuid) from public, anon, authenticated;

revoke execute on function public.management_token_hash(text) from public, anon, authenticated;
revoke execute on function public.provision_public_management_token(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_managed_appointment(text) from public, anon, authenticated;
revoke execute on function public.compute_public_management_slots(text,date,uuid) from public, anon, authenticated;
revoke execute on function public.reschedule_public_managed_appointment(text,text,uuid,timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_public_managed_appointment(text,text,text) from public, anon, authenticated;

revoke execute on function public.get_public_booking_business(text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_services(text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_staff(text,uuid) from public, anon, authenticated;
revoke execute on function public.compute_public_booking_slots(text,uuid,date,uuid) from public, anon, authenticated;
revoke execute on function public.create_public_appointment(text,text,text,uuid,uuid,timestamptz,text,text,text) from public, anon, authenticated;
revoke execute on function public.create_public_appointment_with_recovery(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text) from public, anon, authenticated;
revoke execute on function public.recover_public_appointment(uuid,text,text) from public, anon, authenticated;

revoke execute on function public.public_booking_gate_authorized(text) from public, anon, authenticated;
revoke execute on function public.consume_public_booking_rate(text,text,text,integer,integer) from public, anon, authenticated;
revoke execute on function public.enforce_public_booking_rate(text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.prune_public_booking_rate_counters() from public, anon, authenticated;
revoke execute on function public.get_public_booking_business_guarded(text,text,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_services_guarded(text,text,text,text) from public, anon, authenticated;
revoke execute on function public.get_public_booking_staff_guarded(text,uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.recover_public_appointment_guarded(uuid,text,text,text,text,text) from public, anon, authenticated;

revoke execute on function public.notification_dispatch_authorized(text) from public, anon, authenticated;
revoke execute on function public.claim_notification_jobs(text,integer,integer) from public, anon, authenticated;
revoke execute on function public.complete_notification_job(text,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.release_notification_job(text,uuid,uuid,text,boolean,integer) from public, anon, authenticated;
revoke execute on function public.maintain_notification_jobs(text) from public, anon, authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.validate_business_timezone() from public, anon, authenticated;
revoke execute on function public.ensure_public_booking_settings() from public, anon, authenticated;
revoke execute on function public.enqueue_public_booking_confirmation() from public, anon, authenticated;

-- Trigger helper is invoker-rights, but it should not be an exposed RPC and its
-- search path should be fixed to avoid hosted-Supabase linter ambiguity.
alter function public.touch_updated_at() set search_path = public;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Authenticated operator/member surface. Each function performs its own
-- membership/role checks and is called by the Worker with the user's JWT.
grant execute on function public.is_active_member(uuid) to authenticated;
grant execute on function public.current_membership_role(uuid) to authenticated;
grant execute on function public.can_manage_business(uuid) to authenticated;
grant execute on function public.create_business_with_owner(text,text,text) to authenticated;
grant execute on function public.replace_business_hours(uuid,smallint,jsonb) to authenticated;
grant execute on function public.replace_staff_hours(uuid,uuid,smallint,jsonb) to authenticated;
grant execute on function public.create_availability_block_local(uuid,uuid,date,time,time,text) to authenticated;
grant execute on function public.delete_availability_block(uuid,uuid) to authenticated;
grant execute on function public.compute_availability_slots(uuid,uuid,date,uuid,integer) to authenticated;
grant execute on function public.create_appointment(uuid,text,text,uuid,uuid,timestamptz,text,text,text) to authenticated;
grant execute on function public.compute_reschedule_slots(uuid,uuid,date,uuid,integer) to authenticated;
grant execute on function public.reschedule_appointment(uuid,uuid,text,uuid,timestamptz) to authenticated;
grant execute on function public.set_appointment_status(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.update_public_booking_settings(uuid,boolean,integer,integer,integer) to authenticated;
grant execute on function public.get_calendar_appointments(uuid,date,integer,uuid) to authenticated;

-- Anonymous capability surface. Authorization is carried by the opaque
-- management bearer itself; no direct table access is granted.
grant execute on function public.get_public_managed_appointment(text) to anon;
grant execute on function public.compute_public_management_slots(text,date,uuid) to anon;
grant execute on function public.reschedule_public_managed_appointment(text,text,uuid,timestamptz) to anon;
grant execute on function public.cancel_public_managed_appointment(text,text,text) to anon;

-- Public booking Worker surface. These remain anonymous PostgREST calls, but the
-- server-only gate secret and derived actor/network proofs are mandatory.
grant execute on function public.get_public_booking_business_guarded(text,text,text,text) to anon;
grant execute on function public.get_public_booking_services_guarded(text,text,text,text) to anon;
grant execute on function public.get_public_booking_staff_guarded(text,uuid,text,text,text) to anon;
grant execute on function public.compute_public_booking_slots_guarded(text,uuid,date,uuid,text,text,text) to anon;
grant execute on function public.create_public_appointment_with_recovery_guarded(text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text) to anon;
grant execute on function public.recover_public_appointment_guarded(uuid,text,text,text,text,text) to anon;

-- Notification dispatcher uses the anon PostgREST transport plus a separate
-- server-only dispatch secret. Helper authorization functions stay internal.
grant execute on function public.claim_notification_jobs(text,integer,integer) to anon;
grant execute on function public.complete_notification_job(text,uuid,uuid,text) to anon;
grant execute on function public.release_notification_job(text,uuid,uuid,text,boolean,integer) to anon;
grant execute on function public.maintain_notification_jobs(text) to anon;

commit;
