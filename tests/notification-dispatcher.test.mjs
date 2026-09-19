import test from 'node:test';
import assert from 'node:assert/strict';
import { base64UrlToBytes, bytesToBase64Url } from '../shared/base64.ts';
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

async function claimRow(attemptCount = 1, overrides = {}) {
  const encrypted = await encryptedMaterial(managementToken, recoveryId);
  return {
    job_id: '9b000000-0000-4000-8000-000000000003',
    lease_token: attemptCount === 1
      ? 'aa000000-0000-4000-8000-000000000001'
      : 'aa000000-0000-4000-8000-000000000002',
    event_id: 'bb000000-0000-4000-8000-000000000003',
    event_version: 1,
    template_version: 1,
    appointment_id: 'ab000000-0000-4000-8000-000000000003',
    recovery_id: recoveryId,
    recipient: 'notify@example.test',
    provider: 'resend',
    provider_idempotency_key: 'public-booking-confirmation/bb000000-0000-4000-8000-000000000003',
    attempt_count: attemptCount,
    retry_until: '2026-09-18T07:05:00.000Z',
    business_name_snapshot: 'Notification Test',
    customer_name_snapshot: 'Notify Müşteri',
    starts_at_snapshot: '2026-09-15T07:05:00.000Z',
    timezone_snapshot: 'Europe/Istanbul',
    service_name_snapshot: 'Notification Hizmeti',
    staff_name_snapshot: 'Notification Ayşe',
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

test('F09-03/S03 notification dispatcher contract', async (t) => {
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

  await t.test('locks exact request before provider acceptance and completes with its fingerprint', async () => {
    const row = await claimRow(1);
    const calls = [];
    let lockedFingerprint = '';
    const fakeFetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/rpc/claim_notification_jobs_v2')) return json([row]);
      if (url.endsWith('/rpc/lock_notification_request_v2')) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.p_dispatch_secret, dispatchSecret);
        assert.equal(body.p_job_id, row.job_id);
        assert.equal(body.p_lease_token, row.lease_token);
        assert.equal(body.p_sender, env.NOTIFICATION_FROM_EMAIL);
        assert.equal(body.p_origin, env.PUBLIC_APP_ORIGIN);
        assert.match(body.p_request_fingerprint, /^[0-9a-f]{64}$/);
        lockedFingerprint = body.p_request_fingerprint;
        return json(sendGate());
      }
      if (url === 'https://api.resend.com/emails') {
        assert.equal(new Headers(init.headers).get('Idempotency-Key'), row.provider_idempotency_key);
        const body = JSON.parse(String(init.body));
        assert.equal(body.to[0], row.recipient);
        assert.match(body.text, /https:\/\/app\.example\.test\/m#iiii/);
        assert.match(body.html, /Randevumu yönet/);
        assert.equal(body.tags.find((tag) => tag.name === 'notification_event')?.value, row.event_id);
        return json({ id: 'resend-message-success' });
      }
      if (url.endsWith('/rpc/complete_notification_job_v2')) {
        const body = JSON.parse(String(init.body));
        assert.equal(body.p_dispatch_secret, dispatchSecret);
        assert.equal(body.p_job_id, row.job_id);
        assert.equal(body.p_receipt_token, sendGate().receipt_token);
        assert.equal(body.p_provider_message_id, 'resend-message-success');
        assert.equal(body.p_request_fingerprint, lockedFingerprint);
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

  await t.test('accepted-response-loss retries with the exact frozen request and provider key', async () => {
    const first = await claimRow(1);
    const second = await claimRow(2, {
      delivery_certainty: 'ambiguous',
      first_provider_attempt_at: '2026-09-12T07:05:00.000Z',
      provider_idempotency_expires_at: '2026-09-13T07:05:00.000Z',
    });
    let dispatchRound = 0;
    const providerKeys = [];
    const providerBodies = [];
    const releaseBodies = [];
    let persistedLock = null;

    const fakeFetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/rpc/claim_notification_jobs_v2')) {
        dispatchRound += 1;
        if (dispatchRound === 2 && persistedLock) {
          second.sender_snapshot = persistedLock.p_sender;
          second.origin_snapshot = persistedLock.p_origin;
          second.request_fingerprint = persistedLock.p_request_fingerprint;
        }
        return json([dispatchRound === 1 ? first : second]);
      }
      if (url.endsWith('/rpc/lock_notification_request_v2')) {
        const body = JSON.parse(String(init.body));
        if (!persistedLock) persistedLock = body;
        else {
          assert.equal(body.p_sender, persistedLock.p_sender);
          assert.equal(body.p_origin, persistedLock.p_origin);
          assert.equal(body.p_request_fingerprint, persistedLock.p_request_fingerprint);
        }
        return json(sendGate());
      }
      if (url === 'https://api.resend.com/emails') {
        providerKeys.push(new Headers(init.headers).get('Idempotency-Key'));
        providerBodies.push(String(init.body));
        if (providerKeys.length === 1) {
          throw new Error('response lost after provider acceptance');
        }
        return json({ id: 'resend-same-id-after-retry' });
      }
      if (url.endsWith('/rpc/release_notification_job_v2')) {
        releaseBodies.push(JSON.parse(String(init.body)));
        return json('retry_wait');
      }
      if (url.endsWith('/rpc/complete_notification_job_v2')) return json(true);
      throw new Error(`unexpected fetch ${url}`);
    };

    const firstSummary = await dispatchNotificationBatch(env, fakeFetch);
    assert.equal(firstSummary.retrying, 1);
    assert.equal(releaseBodies[0].p_error_class, 'resend_network_error');
    assert.equal(releaseBodies[0].p_retryable, true);
    assert.equal(releaseBodies[0].p_definitely_rejected, false);

    const secondSummary = await dispatchNotificationBatch({
      ...env,
      NOTIFICATION_FROM_EMAIL: 'Randevu <changed@example.test>',
      PUBLIC_APP_ORIGIN: 'https://changed.example.test',
    }, fakeFetch);
    assert.equal(secondSummary.sent, 1);
    assert.deepEqual(providerKeys, [first.provider_idempotency_key, first.provider_idempotency_key]);
    assert.equal(providerBodies[1], providerBodies[0]);
  });

  await t.test('non-retryable provider validation error is recorded as definitely rejected', async () => {
    const row = await claimRow(1);
    let releaseBody = null;
    const fakeFetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith('/rpc/claim_notification_jobs_v2')) return json([row]);
      if (url.endsWith('/rpc/lock_notification_request_v2')) return json(sendGate());
      if (url === 'https://api.resend.com/emails') {
        return json({ name: 'validation_error' }, 400);
      }
      if (url.endsWith('/rpc/release_notification_job_v2')) {
        releaseBody = JSON.parse(String(init.body));
        return json('failed_terminal');
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const summary = await dispatchNotificationBatch(env, fakeFetch);
    assert.equal(summary.failedTerminal, 1);
    assert.equal(releaseBody.p_retryable, false);
    assert.equal(releaseBody.p_definitely_rejected, true);
    assert.equal(releaseBody.p_error_class, 'resend_validation_error');
  });
});

function sendGate() {
  return { server_time: new Date().toISOString(), send_before: new Date(Date.now() + 30_000).toISOString(), receipt_token: 'cc000000-0000-4000-8000-000000000103' };
}
