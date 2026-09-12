import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchNotificationBatch } from '../worker/notifications.ts';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const dispatchSecret = 'sssssssssssssssssssssssssssssssssssssssssss';
const managementToken = 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';
const recoveryId = '8b000000-0000-4000-8000-000000000103';

const baseEnv = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  NOTIFICATION_DISPATCH_SECRET: dispatchSecret,
  RESEND_API_KEY: 're_test_key',
  NOTIFICATION_FROM_EMAIL: 'Randevu <first@example.test>',
  PUBLIC_APP_ORIGIN: 'https://first.example.test',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function encryptedMaterial() {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(Buffer.from(encryptionKey, 'base64url')),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = new Uint8Array(12);
  iv.fill(9);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`public-booking-recovery:v1|${recoveryId}`),
    },
    key,
    new TextEncoder().encode(managementToken),
  );
  return {
    ciphertext: Buffer.from(encrypted).toString('base64url'),
    iv: Buffer.from(iv).toString('base64url'),
  };
}

async function row(attemptCount = 1, overrides = {}) {
  const encrypted = await encryptedMaterial();
  return {
    job_id: '9b000000-0000-4000-8000-000000000103',
    lease_token: attemptCount === 1
      ? 'aa000000-0000-4000-8000-000000000103'
      : 'aa000000-0000-4000-8000-000000000104',
    event_id: 'bb000000-0000-4000-8000-000000000103',
    event_version: 1,
    template_version: 1,
    appointment_id: 'ab000000-0000-4000-8000-000000000103',
    recovery_id: recoveryId,
    recipient: 'notify@example.test',
    provider: 'resend',
    provider_idempotency_key: 'public-booking-confirmation/bb000000-0000-4000-8000-000000000103',
    attempt_count: attemptCount,
    retry_until: '2026-09-18T07:05:00.000Z',
    business_name_snapshot: 'İlk İşletme',
    customer_name_snapshot: 'S03 Müşteri',
    starts_at_snapshot: '2026-09-15T07:05:00.000Z',
    timezone_snapshot: 'Europe/Istanbul',
    service_name_snapshot: 'S03 Hizmeti',
    staff_name_snapshot: 'İlk Personel',
    price_minor_snapshot: 210000,
    currency_snapshot: 'TRY',
    sender_snapshot: null,
    origin_snapshot: null,
    request_fingerprint: null,
    first_provider_attempt_at: null,
    provider_idempotency_expires_at: null,
    delivery_certainty: 'unattempted',
    management_token_ciphertext: encrypted.ciphertext,
    management_token_iv: encrypted.iv,
    key_version: 1,
    ...overrides,
  };
}

test('S03 accepted-response-loss retry keeps byte-identical provider request after runtime config change', async () => {
  const first = await row(1);
  const second = await row(2, {
    delivery_certainty: 'ambiguous',
    first_provider_attempt_at: '2026-09-12T07:05:00.000Z',
    provider_idempotency_expires_at: '2026-09-13T07:05:00.000Z',
  });

  let round = 0;
  let storedLock = null;
  const providerBodies = [];
  const providerKeys = [];
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rpc/claim_notification_jobs_v2')) {
      round += 1;
      if (round === 2 && storedLock) {
        second.sender_snapshot = storedLock.p_sender;
        second.origin_snapshot = storedLock.p_origin;
        second.request_fingerprint = storedLock.p_request_fingerprint;
      }
      return json([round === 1 ? first : second]);
    }
    if (url.endsWith('/rpc/lock_notification_request_v2')) {
      const body = JSON.parse(String(init.body));
      if (!storedLock) storedLock = body;
      else {
        assert.equal(body.p_sender, storedLock.p_sender);
        assert.equal(body.p_origin, storedLock.p_origin);
        assert.equal(body.p_request_fingerprint, storedLock.p_request_fingerprint);
      }
      return json(true);
    }
    if (url === 'https://api.resend.com/emails') {
      providerBodies.push(String(init.body));
      providerKeys.push(new Headers(init.headers).get('Idempotency-Key'));
      if (providerBodies.length === 1) throw new Error('response lost after provider acceptance');
      return json({ id: 'resend-s03-same-request' });
    }
    if (url.endsWith('/rpc/release_notification_job_v2')) return json('retry_wait');
    if (url.endsWith('/rpc/complete_notification_job_v2')) return json(true);
    throw new Error(`unexpected fetch ${url}`);
  };

  const firstSummary = await dispatchNotificationBatch(baseEnv, fakeFetch);
  assert.equal(firstSummary.retrying, 1);

  const secondSummary = await dispatchNotificationBatch({
    ...baseEnv,
    NOTIFICATION_FROM_EMAIL: 'Randevu <changed@example.test>',
    PUBLIC_APP_ORIGIN: 'https://changed.example.test',
  }, fakeFetch);
  assert.equal(secondSummary.sent, 1);

  assert.deepEqual(providerKeys, [first.provider_idempotency_key, first.provider_idempotency_key]);
  assert.equal(providerBodies.length, 2);
  assert.equal(providerBodies[1], providerBodies[0]);
});

test('S03 mismatched stored request fingerprint is terminal before provider HTTP', async () => {
  const mismatched = await row(2, {
    sender_snapshot: baseEnv.NOTIFICATION_FROM_EMAIL,
    origin_snapshot: baseEnv.PUBLIC_APP_ORIGIN,
    request_fingerprint: 'f'.repeat(64),
    first_provider_attempt_at: '2026-09-12T07:05:00.000Z',
    provider_idempotency_expires_at: '2026-09-13T07:05:00.000Z',
    delivery_certainty: 'ambiguous',
  });
  let providerCalls = 0;
  let release = null;
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rpc/claim_notification_jobs_v2')) return json([mismatched]);
    if (url.endsWith('/rpc/release_notification_job_v2')) {
      release = JSON.parse(String(init.body));
      return json('failed_terminal');
    }
    if (url === 'https://api.resend.com/emails') {
      providerCalls += 1;
      return json({ id: 'must-not-send' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const summary = await dispatchNotificationBatch(baseEnv, fakeFetch);
  assert.equal(summary.failedTerminal, 1);
  assert.equal(providerCalls, 0);
  assert.equal(release.p_error_class, 'notification_request_mismatch');
  assert.equal(release.p_retryable, false);
});
