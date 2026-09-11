import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchNotificationBatch } from '../worker/notifications.ts';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const dispatchSecret = 'sssssssssssssssssssssssssssssssssssssssssss';
const managementToken = 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';
const recoveryId = '8b000000-0000-4000-8000-000000000003';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  NOTIFICATION_DISPATCH_SECRET: dispatchSecret,
  RESEND_API_KEY: 're_test_key',
  NOTIFICATION_FROM_EMAIL: 'Randevu <randevu@example.test>',
  PUBLIC_APP_ORIGIN: 'https://app.example.test',
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function encryptedMaterial(token, id) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(encryptionKey),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = new Uint8Array(12);
  iv.fill(7);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`public-booking-recovery:v1|${id}`),
    },
    key,
    new TextEncoder().encode(token),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
  };
}

async function claimRow(attemptCount = 1) {
  const encrypted = await encryptedMaterial(managementToken, recoveryId);
  return {
    job_id: '9b000000-0000-4000-8000-000000000003',
    lease_token: attemptCount === 1
      ? 'aa000000-0000-4000-8000-000000000001'
      : 'aa000000-0000-4000-8000-000000000002',
    appointment_id: 'ab000000-0000-4000-8000-000000000003',
    recovery_id: recoveryId,
    recipient: 'notify@example.test',
    provider: 'resend',
    provider_idempotency_key: 'public-booking-confirmation/ab000000-0000-4000-8000-000000000003',
    attempt_count: attemptCount,
    retry_until: '2026-09-18T07:05:00.000Z',
    business_name: 'Notification Test',
    customer_name: 'Notify Müşteri',
    starts_at: '2026-09-15T07:05:00.000Z',
    timezone: 'Europe/Istanbul',
    service_name: 'Notification Hizmeti',
    staff_name: 'Notification Ayşe',
    price_minor: 210000,
    currency: 'TRY',
    management_token_ciphertext: encrypted.ciphertext,
    management_token_iv: encrypted.iv,
    key_version: 1,
  };
}

test('F09-03 notification dispatcher contract', async (t) => {
  await t.test('does not claim jobs when dispatcher configuration is incomplete', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls += 1;
      return json([]);
    };
    const summary = await dispatchNotificationBatch({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    }, fakeFetch);
    assert.equal(summary.status, 'disabled');
    assert.equal(summary.claimed, 0);
    assert.equal(calls, 0);
  });

  await t.test('rejects insecure non-local public app origins before claiming jobs', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls += 1;
      return json([]);
    };
    const summary = await dispatchNotificationBatch({
      ...env,
      PUBLIC_APP_ORIGIN: 'http://app.example.test',
    }, fakeFetch);
    assert.equal(summary.status, 'disabled');
    assert.equal(calls, 0);
  });

  await t.test('successful provider acceptance writes receipt only through completion RPC', async () => {
    const row = await claimRow(1);
    const calls = [];
    const fakeFetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/rpc/claim_notification_jobs')) return json([row]);
      if (url === 'https://api.resend.com/emails') {
        assert.equal(new Headers(init.headers).get('Idempotency-Key'), row.provider_idempotency_key);
        const body = JSON.parse(String(init.body));
        assert.equal(body.to[0], row.recipient);
        assert.match(body.text, /https:\/\/app\.example\.test\/m#iiii/);
        assert.match(body.html, /Randevumu yönet/);
        return json({ id: 'resend-message-success' });
      }
      if (url.endsWith('/rpc/complete_notification_job')) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.p_dispatch_secret, dispatchSecret);
        assert.equal(body.p_job_id, row.job_id);
        assert.equal(body.p_lease_token, row.lease_token);
        assert.equal(body.p_provider_message_id, 'resend-message-success');
        return json(true);
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const summary = await dispatchNotificationBatch(env, fakeFetch);
    assert.deepEqual(summary, {
      status: 'ok', claimed: 1, sent: 1, retrying: 0, failedTerminal: 0, leaseErrors: 0,
    });
    const supabaseBodies = calls
      .filter((call) => call.url.startsWith(env.SUPABASE_URL))
      .map((call) => String(call.init.body ?? ''))
      .join('\n');
    assert.ok(!supabaseBodies.includes(managementToken), 'plaintext management token leaked to Supabase dispatcher RPC');
  });

  await t.test('accepted-response-loss retries with the same provider idempotency key', async () => {
    const first = await claimRow(1);
    const second = await claimRow(2);
    let dispatchRound = 0;
    const providerKeys = [];
    const releaseBodies = [];

    const fakeFetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/rpc/claim_notification_jobs')) {
        dispatchRound += 1;
        return json([dispatchRound === 1 ? first : second]);
      }
      if (url === 'https://api.resend.com/emails') {
        providerKeys.push(new Headers(init.headers).get('Idempotency-Key'));
        if (providerKeys.length === 1) {
          // Simulates the provider accepting the request but the HTTP response
          // disappearing before our Worker can persist the provider message id.
          throw new Error('response lost after provider acceptance');
        }
        return json({ id: 'resend-same-id-after-retry' });
      }
      if (url.endsWith('/rpc/release_notification_job')) {
        releaseBodies.push(JSON.parse(String(init.body)));
        return json('retry_wait');
      }
      if (url.endsWith('/rpc/complete_notification_job')) return json(true);
      throw new Error(`unexpected fetch ${url}`);
    };

    const firstSummary = await dispatchNotificationBatch(env, fakeFetch);
    assert.equal(firstSummary.retrying, 1);
    assert.equal(releaseBodies[0].p_error_class, 'resend_network_error');
    assert.equal(releaseBodies[0].p_retryable, true);

    const secondSummary = await dispatchNotificationBatch(env, fakeFetch);
    assert.equal(secondSummary.sent, 1);
    assert.deepEqual(providerKeys, [first.provider_idempotency_key, first.provider_idempotency_key]);
  });

  await t.test('non-retryable provider validation error becomes terminal', async () => {
    const row = await claimRow(1);
    let releaseBody = null;
    const fakeFetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/rpc/claim_notification_jobs')) return json([row]);
      if (url === 'https://api.resend.com/emails') {
        return json({ name: 'validation_error' }, 400);
      }
      if (url.endsWith('/rpc/release_notification_job')) {
        releaseBody = JSON.parse(String(init.body));
        return json('failed_terminal');
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const summary = await dispatchNotificationBatch(env, fakeFetch);
    assert.equal(summary.failedTerminal, 1);
    assert.equal(releaseBody.p_retryable, false);
    assert.equal(releaseBody.p_error_class, 'resend_validation_error');
  });
});
