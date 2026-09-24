import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20260924070000_f16_notification_lifecycle.sql', import.meta.url),
  'utf8',
);
const dispatcher = await readFile(new URL('../worker/notifications.ts', import.meta.url), 'utf8');
const netgsm = await readFile(new URL('../worker/netgsm.ts', import.meta.url), 'utf8');
const entry = await readFile(new URL('../worker/entry.ts', import.meta.url), 'utf8');

test('F16-02 reuses the canonical notification queue instead of creating a second scheduler', () => {
  assert.match(migration, /appointment_notification_jobs/);
  assert.doesNotMatch(migration, /create table if not exists public\.[a-z0-9_]*notification[a-z0-9_]*queue/i);
  assert.match(dispatcher, /claim_notification_jobs_v3/);
  assert.match(dispatcher, /lock_notification_request_v3/);
  assert.match(dispatcher, /release_notification_job_v2/);
  assert.match(dispatcher, /complete_notification_job_v2/);
});

test('F16-02 NetGSM ambiguous sends cannot be reclaimed or blindly replayed', () => {
  assert.match(migration, /netgsm_ambiguous_lease_expired/);
  assert.match(migration, /j\.provider='netgsm'[\s\S]*?j\.first_provider_attempt_at is not null[\s\S]*?j\.delivery_certainty='ambiguous'/);
  assert.match(migration, /and not \([\s\S]*?j\.provider='netgsm'[\s\S]*?j\.delivery_certainty='ambiguous'[\s\S]*?\)/);
  assert.match(netgsm, /NetGSM does not document referansID as an idempotency guarantee/);
  assert.match(netgsm, /retryable:\s*false,[\s\S]*?definitelyRejected:\s*false/);
});

test('F16-02 SMS is provider-length bounded before the send boundary', () => {
  assert.match(netgsm, /sms\/rest\/v2\/length/);
  assert.match(netgsm, /const MAX_SMS_PARTS = 6/);
  assert.match(netgsm, /if \(parts > MAX_SMS_PARTS\)/);
  assert.match(netgsm, /netgsm_segment_limit_exceeded/);
});

test('F16-02 operator jobs remain tenant-scoped and public recovery is optional', () => {
  assert.match(migration, /alter column recovery_id drop not null/);
  assert.match(migration, /primary key \(business_id,group_id\)/);
  assert.match(migration, /references public\.appointment_groups\(business_id,id\)/);
  assert.match(migration, /not public\.is_active_member\(p_business_id\)/);
  assert.match(migration, /left join public\.public_booking_recoveries r/);
});


test('F16-02 reconciles NetGSM delivery from the existing scheduled notification entry', () => {
  assert.match(migration, /claim_notification_delivery_checks/);
  assert.match(migration, /record_notification_delivery_status/);
  assert.match(netgsm, /sms\/rest\/v2\/report/);
  assert.match(dispatcher, /queryNetgsmDeliveryReport/);
  assert.match(dispatcher, /claim_notification_delivery_checks/);
  assert.match(dispatcher, /record_notification_delivery_status/);
  assert.match(entry, /context\.waitUntil\(reconcileNotificationDeliveryBatch\(env\)\)/);
  assert.equal((entry.match(/scheduled\(/g) ?? []).length, 1);
});
