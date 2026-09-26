import test from 'node:test';
import assert from 'node:assert/strict';
import bookingRecovery from '../worker/public-booking-recovery.ts';
import publicBooking from '../worker/public-booking.ts';
import { issueWhatsappPhoneProof } from '../worker/whatsapp-verify.ts';
import {
  derivePublicBookingIntentV2,
  isCanonicalPublicBookingSecret,
  looksLikePublicBookingIntentV2,
  parsePublicBookingIntentV2Key,
  verifyPublicBookingIntentV2,
} from '../shared/public-booking-intent.ts';

const recoveryId = '8c000000-0000-4000-8000-000000000207';
const recoverySecret = 'A'.repeat(43);
const managementToken = Buffer.alloc(32, 1).toString('base64url');
const encryptionKey = 'A'.repeat(43);
const gateSecret = 'g'.repeat(43);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  MANAGEMENT_LINK_ENCRYPTION_KEY_V1: encryptionKey,
  PUBLIC_BOOKING_GATE_SECRET: gateSecret,
  COOKIE_SECURE: 'false',
};

const publishedInformation = {
  kvkk_notice_text: 'Test işletmesi aydınlatma metni.',
  kvkk_notice_url: 'https://example.test/kvkk',
  privacy_policy_url: 'https://example.test/privacy',
  booking_terms_text: 'Test işletmesi randevu koşulları.',
  booking_terms_url: 'https://example.test/terms',
};

function rpc(data) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function post(path, body, headers = {}, testEnv = env) {
  return bookingRecovery.request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.207',
      ...headers,
    },
    body: JSON.stringify(body),
  }, testEnv);
}

await test('S07 canonical v2 intent matches the fixed cross-runtime vector', async () => {
  const expectedSecretHash = '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a';
  const expectedKey = 'pub2_1790000000_b8b99f15340658f0c76387b36c46931170676b2964e9dde9314cb1be613f5f81';
  const derived = await derivePublicBookingIntentV2(recoveryId, 1790000000, recoverySecret);
  assert.deepEqual(derived, {
    deadlineEpochSeconds: 1790000000,
    secretHash: expectedSecretHash,
    idempotencyKey: expectedKey,
  });
  assert.deepEqual(await verifyPublicBookingIntentV2(expectedKey, recoveryId, recoverySecret), derived);
  assert.deepEqual(parsePublicBookingIntentV2Key(expectedKey), {
    deadlineEpochSeconds: 1790000000,
    binding: expectedKey.slice(16),
  });
});

await test('S07 canonical parser rejects encoding, UUID, case, whitespace and namespace aliases', async () => {
  const expectedKey = 'pub2_1790000000_b8b99f15340658f0c76387b36c46931170676b2964e9dde9314cb1be613f5f81';
  assert.equal(isCanonicalPublicBookingSecret(recoverySecret), true);
  for (const secret of [
    'A'.repeat(42),
    'A'.repeat(44),
    `${'A'.repeat(42)}=`,
    `${'A'.repeat(42)}B`,
    `${'A'.repeat(42)}+`,
  ]) assert.equal(isCanonicalPublicBookingSecret(secret), false, secret);

  for (const key of [
    expectedKey.toUpperCase(),
    ` ${expectedKey}`,
    `${expectedKey} `,
    `${expectedKey}\n`,
    expectedKey.replace('1790000000', '0179000000'),
    expectedKey.replace('pub2_', 'pub2_1790000000_'),
  ]) {
    assert.equal(parsePublicBookingIntentV2Key(key), null, key);
    assert.equal(await verifyPublicBookingIntentV2(key, recoveryId, recoverySecret), null, key);
  }
  assert.equal(await verifyPublicBookingIntentV2(expectedKey, recoveryId.toUpperCase(), recoverySecret), null);
  assert.equal(await verifyPublicBookingIntentV2(expectedKey, `${recoveryId}\n`, recoverySecret), null);
  assert.equal(await verifyPublicBookingIntentV2(expectedKey, recoveryId, `${'A'.repeat(42)}B`), null);
  assert.equal(await verifyPublicBookingIntentV2(expectedKey.replace(/.$/, '0'), recoveryId, recoverySecret), null);
  for (const alias of ['pub2_bad', 'PUB2_bad', ' pub2_bad', '\tPuB2_bad']) {
    assert.equal(looksLikePublicBookingIntentV2(alias), true);
  }
});

await test('S07 v2 create verifies the exact proof and sends the immutable key/hash', async () => {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const intent = await derivePublicBookingIntentV2(recoveryId, deadline, recoverySecret);
  assert.ok(intent);
  const booking = {
    customerName: 'S07 Customer',
    customerPhone: '+90 555 207 00 01',
    // F16-02: public create requires the slug+phone-bound WhatsApp proof.
    phoneVerificationToken: await issueWhatsappPhoneProof(gateSecret, 's07-salon', '+90 555 207 00 01'),
    customerEmail: 's07@example.test',
    notes: null,
    serviceId: '6c000000-0000-4000-8000-000000000207',
    staffId: '7c000000-0000-4000-8000-000000000207',
    startsAt: '2026-09-20T09:00:00.000Z',
    managementToken,
    recoveryId,
    recoverySecret,
  };
  const realFetch = globalThis.fetch;
  let encrypted;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const wire = JSON.parse(String(init.body));
    if (wire.p_action === 'profile') return rpc([publishedInformation]);
    assert.equal(wire.p_action, 'book');
    assert.equal(wire.p_args.p_idempotency_key, intent.idempotencyKey);
    assert.equal(wire.p_args.p_recovery_id, recoveryId);
    assert.equal(wire.p_args.p_recovery_secret_hash, intent.secretHash);
    assert.ok(!String(init.body).includes(recoverySecret));
    assert.ok(!String(init.body).includes(managementToken));
    encrypted = wire.p_args;
    return rpc([{
      appointment_id: '9c000000-0000-4000-8000-000000000207',
      status: 'scheduled',
      starts_at: booking.startsAt,
      ends_at: '2026-09-20T09:30:00.000Z',
      timezone: 'Europe/Istanbul',
      service_name: 'S07 Service',
      staff_name: 'S07 Staff',
      price_minor: 20700,
      currency: 'TRY',
      recovery_expires_at: '2026-09-23T09:00:00.000Z',
    }]);
  };
  try {
    const response = await post('/business/s07-salon/book', booking, {
      'Idempotency-Key': intent.idempotencyKey,
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).management.url, `/m#${managementToken}`);
    assert.equal(calls, 2);

    for (const badKey of [intent.idempotencyKey.toUpperCase(), `${intent.idempotencyKey}x`]) {
      const rejected = await post('/business/s07-salon/book', booking, { 'Idempotency-Key': badKey });
      assert.equal(rejected.status, 400);
    }
    const nonCanonicalToken = { ...booking, managementToken: 'm'.repeat(44) };
    const tokenRejected = await post('/business/s07-salon/book', nonCanonicalToken, {
      'Idempotency-Key': intent.idempotencyKey,
    });
    assert.equal(tokenRejected.status, 400);

    const lateIntent = await derivePublicBookingIntentV2(recoveryId, Math.floor(Date.now() / 1000) + 600, recoverySecret);
    const late = await post('/business/s07-salon/book', booking, {
      'Idempotency-Key': lateIntent.idempotencyKey,
    });
    assert.equal(late.status, 400);
    assert.equal(calls, 2, 'invalid v2 attempts reached the gate or database');
    assert.ok(encrypted);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S07 resolve exposes only its explicit terminal envelope', async (t) => {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const intent = await derivePublicBookingIntentV2(recoveryId, deadline, recoverySecret);
  const encryptedArgs = {};
  const key = await crypto.subtle.importKey(
    'raw', Buffer.alloc(32), { name: 'AES-GCM' }, false, ['encrypt'],
  );
  const iv = new Uint8Array(12);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`public-booking-recovery:v1|${recoveryId}`),
  }, key, new TextEncoder().encode(managementToken)));
  encryptedArgs.ciphertext = Buffer.from(ciphertext).toString('base64url');
  encryptedArgs.iv = Buffer.from(iv).toString('base64url');

  const baseRow = {
    recovery_id: recoveryId,
    appointment_id: '9c000000-0000-4000-8000-000000000207',
    business_name: 'S07 Salon',
    status: 'scheduled',
    starts_at: '2026-09-20T09:00:00.000Z',
    ends_at: '2026-09-20T09:30:00.000Z',
    timezone: 'Europe/Istanbul',
    service_name: 'S07 Service',
    staff_name: 'S07 Staff',
    price_minor: 20700,
    currency: 'TRY',
    management_token_ciphertext: encryptedArgs.ciphertext,
    management_token_iv: encryptedArgs.iv,
    key_version: 1,
    recovery_expires_at: '2026-09-23T09:00:00.000Z',
  };
  const request = { recoveryId, idempotencyKey: intent.idempotencyKey, recoverySecret };
  const realFetch = globalThis.fetch;

  try {
    await t.test('committed decrypts the existing capability', async () => {
      globalThis.fetch = async (_input, init) => {
        const wire = JSON.parse(String(init.body));
        assert.equal(wire.p_action, 'resolve');
        assert.equal(wire.p_args.p_recovery_secret_hash, intent.secretHash);
        assert.ok(!String(init.body).includes(recoverySecret));
        return rpc([{ resolution: 'committed', ...baseRow }]);
      };
      const response = await post('/booking/resolve', request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        resolution: 'committed',
        recoveryId,
        appointment: {
          appointment_id: baseRow.appointment_id,
          business_name: baseRow.business_name,
          status: baseRow.status,
          starts_at: baseRow.starts_at,
          ends_at: baseRow.ends_at,
          timezone: baseRow.timezone,
          service_name: baseRow.service_name,
          staff_name: baseRow.staff_name,
          price_minor: baseRow.price_minor,
          currency: baseRow.currency,
        },
        notification: { channel: 'email', status: 'unknown' },
        management: { url: `/m#${managementToken}` },
        recovery: { expiresAt: baseRow.recovery_expires_at },
      });
    });

    for (const resolution of ['exists_nolink', 'closed_absent']) {
      await t.test(`${resolution} never reflects upstream snapshots or ciphertext`, async () => {
        globalThis.fetch = async () => rpc([{ resolution, ...baseRow }]);
        const response = await post('/booking/resolve', request, {}, {
          ...env,
          MANAGEMENT_LINK_ENCRYPTION_KEY_V1: undefined,
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { resolution, recoveryId });
      });
    }

    await t.test('decrypt failure preserves verified existence without a link', async () => {
      globalThis.fetch = async () => rpc([{
        resolution: 'committed',
        ...baseRow,
        management_token_ciphertext: 'not-canonical-ciphertext',
      }]);
      const response = await post('/booking/resolve', request);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { resolution: 'exists_nolink', recoveryId });
    });

    await t.test('ambiguous transport and upstream failures stay nonterminal without retrying', async () => {
      const cases = [
        {
          name: 'transport status zero',
          response: () => { throw new Error('connection dropped after commit'); },
        },
        {
          name: 'upstream 503',
          response: () => new Response(JSON.stringify({ message: 'temporarily unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
        },
        {
          name: 'malformed success envelope',
          response: () => rpc({ resolution: 'closed_absent', recovery_id: recoveryId }),
        },
        {
          name: 'malformed success body',
          response: () => new Response('{', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        },
      ];

      for (const item of cases) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls += 1;
          return item.response();
        };
        const response = await post('/booking/resolve', request);
        const body = await response.json();
        assert.equal(response.status, 503, item.name);
        assert.equal(body.error.code, 'BOOKING_RESULT_UNKNOWN', item.name);
        assert.equal(body.resolution, undefined, item.name);
        assert.equal(calls, 1, `${item.name} retried the RPC`);
      }
    });

    await t.test('rate limiting preserves Retry-After without retrying', async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({
          ok: false,
          error: { message: 'PUBLIC_BOOKING_RATE_LIMITED:17' },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const response = await post('/booking/resolve', request);
      const body = await response.json();
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('Retry-After'), '17');
      assert.equal(body.error.code, 'PUBLIC_BOOKING_RATE_LIMITED');
      assert.equal(body.resolution, undefined);
      assert.equal(calls, 1);
    });

    await t.test('untrusted result shapes never become terminal success', async () => {
      const cases = [
        {
          name: 'mismatched recovery id',
          row: { resolution: 'closed_absent', recovery_id: '8c000000-0000-4000-8000-000000000208' },
          status: 404,
          code: 'BOOKING_RECOVERY_NOT_FOUND',
        },
        {
          name: 'unknown resolution',
          row: { resolution: 'pending', recovery_id: recoveryId },
          status: 404,
          code: 'BOOKING_RECOVERY_NOT_FOUND',
        },
        {
          name: 'malformed committed row',
          row: { resolution: 'committed', ...baseRow, appointment_id: null },
          status: 503,
          code: 'BOOKING_RESULT_UNKNOWN',
        },
      ];

      for (const item of cases) {
        let calls = 0;
        globalThis.fetch = async () => {
          calls += 1;
          return rpc([item.row]);
        };
        const response = await post('/booking/resolve', request);
        const body = await response.json();
        assert.equal(response.status, item.status, item.name);
        assert.equal(body.error.code, item.code, item.name);
        assert.equal(body.resolution, undefined, item.name);
        assert.equal(calls, 1, `${item.name} retried the RPC`);
      }
    });

    await t.test('wrong binding and excessive future deadline stay generic and make no RPC', async () => {
      let calls = 0;
      globalThis.fetch = async () => { calls += 1; return rpc([]); };
      const wrong = await post('/booking/resolve', {
        ...request,
        idempotencyKey: intent.idempotencyKey.replace(/.$/, intent.idempotencyKey.endsWith('0') ? '1' : '0'),
      });
      assert.equal(wrong.status, 404);
      const whitespaceAlias = await post('/booking/resolve', {
        ...request,
        idempotencyKey: ` ${intent.idempotencyKey}`,
      });
      assert.equal(whitespaceAlias.status, 404);
      const future = await derivePublicBookingIntentV2(
        recoveryId, Math.floor(Date.now() / 1000) + 600, recoverySecret,
      );
      const tooEarly = await post('/booking/resolve', { ...request, idempotencyKey: future.idempotencyKey });
      assert.equal(tooEarly.status, 404);
      assert.equal(calls, 0);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('S07 public catalog returns a fresh five-minute server clock sample', async () => {
  const realFetch = globalThis.fetch;
  const before = Math.floor(Date.now() / 1000);
  globalThis.fetch = async (_input, init) => {
    const action = JSON.parse(String(init.body)).p_action;
    if (action === 'business') return rpc([{
      name: 'S07 Salon', slug: 's07-salon', timezone: 'Europe/Istanbul',
      local_date: '2026-09-13', max_date: '2026-10-13', step_minutes: 15,
      min_notice_minutes: 0, horizon_days: 30,
    }]);
    if (action === 'services') return rpc([]);
    throw new Error(`unexpected action ${action}`);
  };
  try {
    const response = await publicBooking.request('http://localhost/business/s07-salon', {
      headers: { 'CF-Connecting-IP': '203.0.113.207' },
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.bookingClock.submitWindowSeconds, 300);
    assert.ok(Number.isInteger(body.bookingClock.serverNowEpochSeconds));
    assert.ok(body.bookingClock.serverNowEpochSeconds >= before);
    assert.ok(body.bookingClock.serverNowEpochSeconds <= Math.floor(Date.now() / 1000));
  } finally {
    globalThis.fetch = realFetch;
  }
});
