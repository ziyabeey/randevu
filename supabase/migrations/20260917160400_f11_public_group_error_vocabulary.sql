begin;

-- F11-03 gave the group surface an optimistic-concurrency contract, but the
-- public error envelope still carried F11-01's allow-list. Every group-specific
-- code therefore collapsed to PUBLIC_OPERATION_UNAVAILABLE before it left the
-- database, so the Worker's BOOKING_GROUP_VERSION_CONFLICT / GROUP_MANAGEMENT_
-- REQUIRED branches were unreachable from the /m#token surface: a customer who
-- lost a concurrency race got a 503 "try again", and retrying with the same
-- stale version could never succeed.
--
-- Only codes that are (a) reachable through compute_public_group_management_slots,
-- reschedule_public_managed_group or cancel_public_managed_group, (b) actionable
-- by the client, and (c) fixed literals with no interpolated row data are added.
-- Internal-consistency codes (BOOKING_GROUP_NOT_FOUND, BOOKING_GROUP_EMPTY,
-- BOOKING_GROUP_LEGACY_USE_APPOINTMENT_ENDPOINT, IDEMPOTENCY_RESULT_MISSING)
-- stay masked: a resolved capability token already proves the group exists, so
-- reaching them means the server is inconsistent and retry is the right advice.
-- Unknown text keeps sanitizing to PUBLIC_OPERATION_UNAVAILABLE.
create or replace function public.public_operation_error(p_message text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('ok',false,'error',jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','PUBLIC_BOOKING_DISABLED','IDEMPOTENCY_CONFLICT',
      'IDEMPOTENCY_IN_PROGRESS','APPOINTMENT_CONFLICT','SLOT_UNAVAILABLE',
      'GROUP_SLOT_UNAVAILABLE','GROUP_LINE_LIMIT_EXCEEDED','GROUP_SLOT_BUDGET_EXCEEDED',
      'MIXED_CURRENCY','DATE_OUT_OF_RANGE',
      'PUBLIC_CONTACT_REQUIRED','INVALID_CUSTOMER_NAME','INVALID_CUSTOMER_PHONE',
      'INVALID_CUSTOMER_EMAIL','NOTES_TOO_LONG','INVALID_START','INVALID_DATE',
      'INVALID_GROUP_LINES','INVALID_BOOKING_RECOVERY_BOOTSTRAP','INVALID_IDEMPOTENCY_KEY',
      'BOOKING_CLIENT_UPDATE_REQUIRED','BOOKING_INTENT_CLOSED','BOOKING_INTENT_DEADLINE_EXPIRED',
      'MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN','APPOINTMENT_NOT_MANAGEABLE',
      'REASON_TOO_LONG','SERVICE_NOT_FOUND','STAFF_NOT_ELIGIBLE',
      'AUTH_REQUIRED','INVALID_BUSINESS_NAME','INVALID_BUSINESS_SLUG','BUSINESS_SLUG_TAKEN',
      'INVALID_PUBLIC_OPERATION',
      -- F11-03 group management vocabulary.
      'MANAGEMENT_GROUP_REQUIRED','BOOKING_GROUP_MUTATION_REQUIRED',
      'BOOKING_GROUP_VERSION_CONFLICT','INVALID_GROUP_VERSION',
      'BOOKING_GROUP_NOT_RESCHEDULABLE','BOOKING_GROUP_NOT_CANCELLABLE',
      'CANCELLATION_REASON_TOO_LONG'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

revoke all on function public.public_operation_error(text)
  from public, anon, authenticated;

commit;
