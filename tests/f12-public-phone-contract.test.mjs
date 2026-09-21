import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../worker/app.ts';
import { derivePublicBookingIntentV2 } from '../shared/public-booking-intent.ts';

const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'publishable-test-key',
  PUBLIC_APP_ORIGIN: 'http://localhost',
  COOKIE_SECURE: 'false',
};
const recoveryId = '70000000-0000-4000-8000-000000000051';
const canonicalSecret = (byte) => Buffer.alloc(32, byte).toString('base64url');
const recoverySecret = canonicalSecret(7);
const managementToken = canonicalSecret(8);
const serviceId = '83000000-0000-4000-8000-000000000051';
const staffId = '84000000-0000-4000-8000-000000000051';

function publicHeaders(idempotencyKey) {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    'CF-Connecting-IP': '203.0.113.51',
  };
}

await test('F12-05 phone contract rejects email-only legacy public create before any upstream call', async (t) => {
  let upstreamCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    upstreamCalls += 1;
    throw new Error('email-only legacy create must fail before upstream');
  });

  const response = await app.request('http://localhost/api/public/business/test-salon/book', {
    method: 'POST',
    headers: publicHeaders('f12-phone-legacy-0001'),
    body: JSON.stringify({
      customerName: 'Email Only',
      customerPhone: null,
      customerEmail: 'email-only@example.test',
      notes: null,
      serviceId,
      staffId,
      startsAt: '2026-10-20T10:00:00+03:00',
      managementToken,
      recoveryId,
      recoverySecret,
    }),
  }, env);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'PUBLIC_CONTACT_REQUIRED',
      message: 'Telefon bilgisi zorunlu. E-posta isteğe bağlıdır.',
    },
  });
  assert.equal(upstreamCalls, 0);
});

await test('F12-05 phone contract rejects email-only group public create before proof/abuse/database calls', async (t) => {
  const intent = await derivePublicBookingIntentV2(
    recoveryId,
    Math.floor(Date.now() / 1000) + 120,
    recoverySecret,
  );
  assert.ok(intent);

  let upstreamCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    upstreamCalls += 1;
    throw new Error('email-only group create must fail before upstream');
  });

  const response = await app.request('http://localhost/api/public/business/test-salon/group-book', {
    method: 'POST',
    headers: publicHeaders(intent.idempotencyKey),
    body: JSON.stringify({
      customerName: 'Email Only',
      customerPhone: null,
      customerEmail: 'email-only@example.test',
      notes: null,
      lines: [{ serviceId, staffId }],
      startsAt: '2026-10-20T10:00:00+03:00',
      managementToken,
      recoveryId,
      recoverySecret,
    }),
  }, env);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'PUBLIC_CONTACT_REQUIRED',
      message: 'Telefon bilgisi zorunlu. E-posta isteğe bağlıdır.',
    },
  });
  assert.equal(upstreamCalls, 0);
});
