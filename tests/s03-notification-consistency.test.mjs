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

function base64UrlToBytes(value) {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

async function encryptedMaterial() {
  const key = await crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(encryptionKey),
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

async function row(overrides = {}) {
  const encrypted = await encryptedMaterial();
  return {
    job_id: '9b000000-0000-4000-8000-000000000103',
    lease_token: 'aa000000-0000-4000-8000-000000000103',
    appointment_id: 'ab000000-0000-4000-8000-000000000103',
    recovery_id: recoveryId,
    recipient: 'notify@example.test',
    provider: 'resend',
    provider_idempotency_key: 'public-booking-confirmation/ab000000-0000-4000-8000-000000000103',
    attempt_count: 1,
    retry_until: '2026-09-18T07:05:00.000Z',
    business_name: 'İlk İşletme',
    customer_name: 'S03 Müşteri',
    starts_at: '2026-09-15T07:05:00.000Z',
    timezone: 'Europe/Istanbul',
    service_name: 'S03 Hizmeti',
    staff_name: 'İlk Personel',
    price_minor: 210000,
    currency: 'TRY',
    management_token_ciphertext: encrypted.ciphertext,
    management_token_iv: encrypted.iv,
    key_version: 1,
    ...overrides,
  };
}

test('S03 accepted-response-loss retry keeps byte-identical provider request after live data and runtime config change', async () => {
  const first = await row();
  const second = await row({
    lease_token: 'aa000000-0000-4000-8000-000000000104',
    attempt_count: 2,
    business_name: 'Sonradan Değişen İşletme',
    starts_at: '2026-09-16T12:30:00.000Z',
    staff_name: 'Sonradan Değişen Personel',
  });

  let round = 0;
  const providerBodies = [];
  const providerKeys = [];
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rpc/claim_notification_jobs')) {
      round += 1;
      return json([round === 1 ? first : second]);
    }
    if (url === 'https://api.resend.com/emails') {
      providerBodies.push(String(init.body));
      providerKeys.push(new Headers(init.headers).get('Idempotency-Key'));
      if (providerBodies.length === 1) throw new Error('response lost after provider acceptance');
      return json({ id: 'resend-s03-same-request' });
    }
    if (url.endsWith('/rpc/release_notification_job')) return json('retry_wait');
    if (url.endsWith('/rpc/complete_notification_job')) return json(true);
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
  assert.equal(
    providerBodies[1],
    providerBodies[0],
    'the same idempotency key must never be retried with different sender/origin/rendered content',
  );
});
