import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchNotificationBatch } from '../worker/notifications.ts';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const dispatchSecret = 'sssssssssssssssssssssssssssssssssssssssssss';
const managementToken = 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';
const recoveryId = '8d000000-0000-4000-8000-000000000011';
const providerEndpoint = 'https://api.resend.com/emails';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  NOTIFICATION_DISPATCH_SECRET: dispatchSecret,
  RESEND_API_KEY: 're_test_key',
  NOTIFICATION_FROM_EMAIL: 'Randevu <randevu@example.test>',
  PUBLIC_APP_ORIGIN: 'https://app.example.test',
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
  iv.fill(11);
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`public-booking-recovery:v1|${recoveryId}`),
  }, key, new TextEncoder().encode(managementToken));
  return {
    ciphertext: Buffer.from(encrypted).toString('base64url'),
    iv: Buffer.from(iv).toString('base64url'),
  };
}

async function claimRow(overrides = {}) {
  const encrypted = await encryptedMaterial();
  return {
    job_id: '9d000000-0000-4000-8000-000000000011',
    lease_token: 'ad000000-0000-4000-8000-000000000011',
    event_id: 'bd000000-0000-4000-8000-000000000011',
    event_version: 1,
    template_version: 2,
    appointment_id: 'cd000000-0000-4000-8000-000000000011',
    recovery_id: recoveryId,
    recipient: 'group-notify@example.test',
    provider: 'resend',
    provider_idempotency_key: 'public-booking-confirmation/bd000000-0000-4000-8000-000000000011',
    attempt_count: 1,
    retry_until: '2026-09-20T08:00:00.000Z',
    business_name_snapshot: 'F11 Salon',
    customer_name_snapshot: 'F11 Müşteri',
    starts_at_snapshot: '2026-09-21T08:00:00.000Z',
    timezone_snapshot: 'Europe/Istanbul',
    service_name_snapshot: 'Grup hizmetleri',
    staff_name_snapshot: 'Grup personeli',
    price_minor_snapshot: 0,
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

function rangeLine(overrides = {}) {
  return {
    lineOrdinal: 1,
    serviceName: 'Renk Paketi',
    staffName: 'Ayşe',
    startsAt: '2026-09-21T08:00:00.000Z',
    endsAt: '2026-09-21T08:45:00.000Z',
    priceType: 'range',
    priceMinMinor: 12_000,
    priceMaxMinor: 18_000,
    ...overrides,
  };
}

function oneRangeSummary(overrides = {}) {
  return {
    groupId: 'dd000000-0000-4000-8000-000000000011',
    lineCount: 1,
    currency: 'TRY',
    estimateMinMinor: 12_000,
    estimateMaxMinor: 18_000,
    lines: [rangeLine()],
    ...overrides,
  };
}

function sendGate() {
  return {
    server_time: new Date().toISOString(),
    send_before: new Date(Date.now() + 30_000).toISOString(),
    receipt_token: 'ed000000-0000-4000-8000-000000000011',
  };
}

async function dispatchWithSnapshot(snapshot) {
  const row = await claimRow();
  const calls = [];
  const providerBodies = [];
  const releases = [];
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rpc/claim_notification_jobs_v2')) return json([row]);
    if (url.endsWith('/rpc/get_notification_group_snapshot')) return json(snapshot);
    if (url.endsWith('/rpc/lock_notification_request_v2')) return json(sendGate());
    if (url === providerEndpoint) {
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), row.provider_idempotency_key);
      providerBodies.push(JSON.parse(String(init.body)));
      return json({ id: 'resend-f11-group-success' });
    }
    if (url.endsWith('/rpc/complete_notification_job_v2')) return json(true);
    if (url.endsWith('/rpc/release_notification_job_v2')) {
      releases.push(JSON.parse(String(init.body)));
      return json('retry_wait');
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const summary = await dispatchNotificationBatch(env, fakeFetch);
  return { calls, providerBodies, releases, row, summary };
}

test('F11 group notification dispatcher', async (t) => {
  await t.test('template 2 sends one RANGE line once with its bounded estimate', async () => {
    const result = await dispatchWithSnapshot(oneRangeSummary());

    assert.deepEqual(result.summary, {
      status: 'ok', claimed: 1, sent: 1, retrying: 0, failedTerminal: 0, leaseErrors: 0,
    });
    assert.equal(result.calls.filter((url) => url.endsWith('/rpc/get_notification_group_snapshot')).length, 1);
    assert.equal(result.calls.filter((url) => url === providerEndpoint).length, 1);
    assert.equal(result.providerBodies.length, 1);
    const body = result.providerBodies[0];
    const min = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(120);
    const max = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(180);
    assert.match(body.text, /F11 Salon randevunuz oluşturuldu\./);
    assert.doesNotMatch(body.text, /çoklu hizmet randevunuz/);
    assert.ok(body.text.includes('1. Renk Paketi · Ayşe'));
    assert.ok(body.text.includes(`Tahmini ücret: ${min} – ${max}`));
    assert.ok(body.html.includes(min));
    assert.ok(body.html.includes(max));
    assert.equal(result.releases.length, 0);
  });

  await t.test('template 2 retains the multi-line summary', async () => {
    const second = rangeLine({
      lineOrdinal: 2,
      serviceName: 'Kesim',
      staffName: 'Berk',
      startsAt: '2026-09-21T08:45:00.000Z',
      endsAt: '2026-09-21T09:15:00.000Z',
      priceType: 'fixed',
      priceMinMinor: 10_000,
      priceMaxMinor: 10_000,
    });
    const result = await dispatchWithSnapshot(oneRangeSummary({
      lineCount: 2,
      estimateMinMinor: 22_000,
      estimateMaxMinor: 28_000,
      lines: [rangeLine(), second],
    }));

    assert.equal(result.summary.sent, 1);
    assert.equal(result.calls.filter((url) => url === providerEndpoint).length, 1);
    const body = result.providerBodies[0];
    assert.match(body.text, /F11 Salon çoklu hizmet randevunuz oluşturuldu\./);
    assert.ok(body.text.includes('1. Renk Paketi · Ayşe'));
    assert.ok(body.text.includes('2. Kesim · Berk'));
  });

  await t.test('invalid or unbounded summaries never reach the provider', async () => {
    for (const snapshot of [
      null,
      oneRangeSummary({ lineCount: 0, lines: [] }),
      oneRangeSummary({ estimateMaxMinor: 1_000_000_001 }),
      oneRangeSummary({ lines: [rangeLine({ priceMaxMinor: 1_000_000_001 })] }),
    ]) {
      const result = await dispatchWithSnapshot(snapshot);
      assert.equal(result.calls.filter((url) => url === providerEndpoint).length, 0);
      assert.equal(result.calls.some((url) => url.endsWith('/rpc/lock_notification_request_v2')), false);
      assert.equal(result.summary.sent, 0);
      assert.equal(result.summary.retrying, 1);
      assert.equal(result.releases.length, 1);
      assert.equal(result.releases[0].p_error_class, 'notification_group_snapshot_unavailable');
      assert.equal(result.releases[0].p_retryable, true);
    }
  });
});
