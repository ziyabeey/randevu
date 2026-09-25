import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchNotificationBatch } from '../worker/notifications.ts';

const encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const dispatchSecret = 'sssssssssssssssssssssssssssssssssssssssssss';
const managementToken = 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii';
const recoveryId = '8d000000-0000-4000-8000-000000000111';
const providerEndpoint = 'https://api.resend.com/emails';
const MAX_GROUP_AMOUNT_MINOR = 1_000_000_000;

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
  iv.fill(7);
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
    job_id: '9d000000-0000-4000-8000-000000000111',
    lease_token: 'ad000000-0000-4000-8000-000000000111',
    event_id: 'bd000000-0000-4000-8000-000000000111',
    event_version: 1,
    template_version: 2,
    appointment_id: 'cd000000-0000-4000-8000-000000000111',
    recovery_id: recoveryId,
    recipient: 'm11-notify@example.test',
    provider: 'resend',
    provider_idempotency_key: 'public-booking-confirmation/bd000000-0000-4000-8000-000000000111',
    attempt_count: 1,
    retry_until: '2026-09-30T08:00:00.000Z',
    business_name_snapshot: 'M11 Salon',
    customer_name_snapshot: 'M11 Müşteri',
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

function line(overrides = {}) {
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

function summary(overrides = {}) {
  return {
    groupId: 'dd000000-0000-4000-8000-000000000111',
    lineCount: 1,
    currency: 'TRY',
    estimateMinMinor: 12_000,
    estimateMaxMinor: 18_000,
    lines: [line()],
    ...overrides,
  };
}

function sendGate() {
  return {
    server_time: new Date().toISOString(),
    send_before: new Date(Date.now() + 30_000).toISOString(),
    receipt_token: 'ed000000-0000-4000-8000-000000000111',
  };
}

async function dispatchWithSnapshot(snapshot, { rowOverrides = {} } = {}) {
  const row = await claimRow(rowOverrides);
  const calls = [];
  const providerBodies = [];
  const lockBodies = [];
  const releases = [];
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rpc/claim_notification_jobs_v2')) return json([row]);
    if (url.endsWith('/rpc/get_notification_group_snapshot')) return json(snapshot);
    if (url.endsWith('/rpc/lock_notification_request_v2')) {
      lockBodies.push(JSON.parse(String(init.body)));
      return json(sendGate());
    }
    if (url === providerEndpoint) {
      assert.equal(new Headers(init.headers).get('Idempotency-Key'), row.provider_idempotency_key);
      providerBodies.push(JSON.parse(String(init.body)));
      return json({ id: 'resend-m11-validation-success' });
    }
    if (url.endsWith('/rpc/complete_notification_job_v2')) return json(true);
    if (url.endsWith('/rpc/release_notification_job_v2')) {
      releases.push(JSON.parse(String(init.body)));
      return json('retry_wait');
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const dispatchSummary = await dispatchNotificationBatch(env, fakeFetch);
  return { row, calls, providerBodies, lockBodies, releases, summary: dispatchSummary };
}

test('N1 one-line range render is bounded and singular', async () => {
  const result = await dispatchWithSnapshot(summary());
  assert.equal(result.summary.sent, 1);
  assert.equal(result.providerBodies.length, 1);
  assert.equal(result.lockBodies.length, 1);
  const body = result.providerBodies[0];
  const min = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(120);
  const max = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(180);
  assert.match(body.text, /M11 Salon randevunuz oluşturuldu\./);
  assert.doesNotMatch(body.text, /çoklu hizmet randevunuz/);
  assert.ok(body.text.includes('1. Renk Paketi · Ayşe'));
  assert.ok(body.text.includes(`Tahmini ücret: ${min} – ${max}`));
  assert.ok(body.html.includes(min));
  assert.ok(body.html.includes(max));
});

test('N2 multi-line render preserves order and fixed/range semantics', async () => {
  const second = line({
    lineOrdinal: 2,
    serviceName: 'Kesim',
    staffName: 'Berk',
    startsAt: '2026-09-21T08:45:00.000Z',
    endsAt: '2026-09-21T09:15:00.000Z',
    priceType: 'fixed',
    priceMinMinor: 10_000,
    priceMaxMinor: 10_000,
  });
  const result = await dispatchWithSnapshot(summary({
    lineCount: 2,
    estimateMinMinor: 22_000,
    estimateMaxMinor: 28_000,
    lines: [line(), second],
  }));
  assert.equal(result.summary.sent, 1);
  const text = result.providerBodies[0].text;
  assert.match(text, /M11 Salon çoklu hizmet randevunuz oluşturuldu\./);
  assert.ok(text.indexOf('1. Renk Paketi · Ayşe') < text.indexOf('2. Kesim · Berk'));
  const fixed = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(100);
  assert.ok(text.includes(fixed));
});

test('N3 invalid summary matrix fails before lock and provider send', async () => {
  const invalid = [
    null,
    summary({ lineCount: 0, lines: [] }),
    summary({ lineCount: 11 }),
    summary({ lineCount: 2, lines: [line()] }),
    summary({ lines: [line({ lineOrdinal: 2 })] }),
    summary({ currency: 'try' }),
    summary({ estimateMinMinor: -1 }),
    summary({ estimateMinMinor: 20_000, estimateMaxMinor: 10_000 }),
    summary({ estimateMaxMinor: MAX_GROUP_AMOUNT_MINOR + 1 }),
    summary({ lines: [line({ priceType: 'floating' })] }),
    summary({ lines: [line({ priceMinMinor: -1 })] }),
    summary({ lines: [line({ priceMinMinor: 20_000, priceMaxMinor: 10_000 })] }),
    summary({ lines: [line({ priceMaxMinor: MAX_GROUP_AMOUNT_MINOR + 1 })] }),
  ];
  for (const snapshot of invalid) {
    const result = await dispatchWithSnapshot(snapshot);
    assert.equal(result.calls.filter((url) => url === providerEndpoint).length, 0);
    assert.equal(result.lockBodies.length, 0);
    assert.equal(result.summary.sent, 0);
    assert.equal(result.summary.retrying, 1);
    assert.equal(result.releases.length, 1);
    assert.equal(result.releases[0].p_error_class, 'notification_group_snapshot_unavailable');
    assert.equal(result.releases[0].p_retryable, true);
  }
});

test('N4 text stays readable while HTML escapes untrusted snapshot fields', async () => {
  const unsafeSummary = summary({
    lines: [line({ serviceName: '<img src=x onerror=alert(1)>', staffName: 'A&B <script>x</script>' })],
  });
  const result = await dispatchWithSnapshot(unsafeSummary, {
    rowOverrides: {
      business_name_snapshot: '<b>M11 Salon</b>',
      customer_name_snapshot: '<script>alert(1)</script>',
    },
  });
  const body = result.providerBodies[0];
  assert.ok(body.text.includes('<img src=x onerror=alert(1)>'));
  assert.ok(body.text.includes('<script>alert(1)</script>'));
  assert.doesNotMatch(body.html, /<script>|<img src=x/i);
  assert.ok(body.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(body.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(body.html.includes('https://app.example.test/m#'));
});

test('N5 timezone snapshot renders the frozen Istanbul local time', async () => {
  const result = await dispatchWithSnapshot(summary());
  const text = result.providerBodies[0].text;
  assert.ok(text.includes('21 Eylül 2026 11:00'));
});

test('N6 request fingerprint is stable for identical input and changes with rendered body', async () => {
  const first = await dispatchWithSnapshot(summary());
  const second = await dispatchWithSnapshot(summary());
  const changed = await dispatchWithSnapshot(summary({
    lines: [line({ serviceName: 'Renk Paketi V2' })],
  }));
  const a = first.lockBodies[0].p_request_fingerprint;
  const b = second.lockBodies[0].p_request_fingerprint;
  const c = changed.lockBodies[0].p_request_fingerprint;
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
