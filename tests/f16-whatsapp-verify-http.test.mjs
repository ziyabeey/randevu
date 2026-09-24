import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../worker/app.ts';
import { issueWhatsappPhoneProof, verifyWhatsappPhoneProof } from '../worker/whatsapp-verify.ts';
import { derivePublicBookingIntentV2 } from '../shared/public-booking-intent.ts';

const gateSecret = 'g'.repeat(48);
const proofSecret = 'p'.repeat(48);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_BOOKING_GATE_SECRET: gateSecret,
  PHONE_VERIFICATION_PROOF_SECRET: proofSecret,
  TWILLO_ID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TWILLO_SECRET_API: 'test-auth-token-1234567890',
  TWILIO_VERIFY_SERVICE_SID: 'VAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rpc(data) {
  return json({ ok: true, data });
}

test('F16-02 public WhatsApp OTP start is an explicit public mutation and reaches Twilio Verify', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      const wire = JSON.parse(String(init.body));
      assert.equal(wire.p_action, 'business');
      assert.equal(wire.p_args.p_slug, 'salon-a');
      assert.match(wire.p_actor_hash, /^[0-9a-f]{64}$/);
      assert.match(wire.p_network_hash, /^[0-9a-f]{64}$/);
      return rpc([{ name: 'Salon A', slug: 'salon-a' }]);
    }
    if (url.endsWith('/Verifications')) {
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get('To'), '+905551602001');
      assert.equal(form.get('Channel'), 'whatsapp');
      return json({
        sid: 'VEcccccccccccccccccccccccccccccccc',
        status: 'pending',
      }, 201);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/public/verify/whatsapp/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
      body: JSON.stringify({ slug: 'salon-a', phone: '0555 160 20 01' }),
    }, env);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      channel: 'whatsapp',
      expiresInSeconds: 600,
      retryAfterSeconds: 30,
    });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 approved WhatsApp OTP returns a slug-and-phone-bound booking proof', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      return rpc([{ name: 'Salon A', slug: 'salon-a' }]);
    }
    if (url.endsWith('/VerificationCheck')) {
      const form = new URLSearchParams(String(init.body));
      assert.equal(form.get('To'), '+905551602001');
      assert.equal(form.get('Code'), '123456');
      return json({ status: 'approved' });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/public/verify/whatsapp/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
      body: JSON.stringify({ slug: 'salon-a', phone: '05551602001', code: '123456' }),
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.channel, 'whatsapp');
    assert.equal(body.expiresInSeconds, 600);
    assert.ok(typeof body.phoneVerificationToken === 'string' && body.phoneVerificationToken.length > 40);
    assert.equal(await verifyWhatsappPhoneProof(
      proofSecret,
      body.phoneVerificationToken,
      'salon-a',
      '+905551602001',
    ), true);
    assert.equal(await verifyWhatsappPhoneProof(
      gateSecret,
      body.phoneVerificationToken,
      'salon-a',
      '+905551602001',
    ), false, 'phone proofs must not be signed with the public abuse gate secret');
    assert.equal(await verifyWhatsappPhoneProof(
      proofSecret,
      body.phoneVerificationToken,
      'salon-a',
      '+905551602002',
    ), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 single public booking fails closed before provider or DB work without WhatsApp proof', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('booking without proof must not reach upstream');
  };

  try {
    const response = await app.request('http://localhost/api/public/business/salon-a/book', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'f16-wa-no-proof-0001',
      },
      body: JSON.stringify({
        customerName: 'Deniz Örnek',
        customerPhone: '05551602001',
        customerEmail: null,
        notes: null,
        serviceId: '10000000-0000-4000-8000-000000000001',
        staffId: '10000000-0000-4000-8000-000000000002',
        startsAt: '2026-10-01T09:00:00.000Z',
        managementToken: 'M'.repeat(48),
        recoveryId: '10000000-0000-4000-8000-000000000003',
        recoverySecret: 'R'.repeat(48),
      }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PHONE_VERIFICATION_REQUIRED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 group public booking with a valid v2 intent still fails closed without WhatsApp proof', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('group booking without proof must not reach upstream');
  };
  const recoveryId = '10000000-0000-4000-8000-000000000003';
  const recoverySecret = Buffer.alloc(32, 7).toString('base64url');
  const intent = await derivePublicBookingIntentV2(recoveryId, Math.floor(Date.now() / 1000) + 300, recoverySecret);
  assert.ok(intent);

  try {
    const response = await app.request('http://localhost/api/public/business/salon-a/group-book', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': intent.idempotencyKey,
      },
      body: JSON.stringify({
        customerName: 'Deniz Örnek',
        customerPhone: '05551602001',
        customerEmail: null,
        notes: null,
        startsAt: '2026-10-01T09:00:00.000Z',
        lines: [{ serviceId: '10000000-0000-4000-8000-000000000001', staffId: '10000000-0000-4000-8000-000000000002' }],
        managementToken: Buffer.alloc(32, 9).toString('base64url'),
        recoveryId,
        recoverySecret,
      }),
    }, env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error?.code, 'PHONE_VERIFICATION_REQUIRED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 booking rejects proofs for another slug, another phone, an expired window or a missing key', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('booking with an invalid proof must not reach upstream');
  };
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ['another slug', await issueWhatsappPhoneProof(proofSecret, 'salon-b', '05551602001'), env],
    ['another phone', await issueWhatsappPhoneProof(proofSecret, 'salon-a', '05551602002'), env],
    ['expired', await issueWhatsappPhoneProof(proofSecret, 'salon-a', '05551602001', now - 601), env],
    ['gate-secret signature', await issueWhatsappPhoneProof(gateSecret, 'salon-a', '05551602001'), env],
    ['tampered', `${(await issueWhatsappPhoneProof(proofSecret, 'salon-a', '05551602001')).slice(0, -2)}AA`, env],
    ['missing Worker key', await issueWhatsappPhoneProof(proofSecret, 'salon-a', '05551602001'),
      { ...env, PHONE_VERIFICATION_PROOF_SECRET: undefined }],
  ];

  try {
    for (const [label, phoneVerificationToken, bookingEnv] of cases) {
      assert.ok(phoneVerificationToken, label);
      const response = await app.request('http://localhost/api/public/business/salon-a/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'f16-wa-bad-proof-0001' },
        body: JSON.stringify({
          customerName: 'Deniz Örnek',
          customerPhone: '05551602001',
          customerEmail: null,
          notes: null,
          phoneVerificationToken,
          serviceId: '10000000-0000-4000-8000-000000000001',
          staffId: '10000000-0000-4000-8000-000000000002',
          startsAt: '2026-10-01T09:00:00.000Z',
          managementToken: 'M'.repeat(48),
          recoveryId: '10000000-0000-4000-8000-000000000003',
          recoverySecret: 'R'.repeat(48),
        }),
      }, bookingEnv);
      assert.equal(response.status, 403, label);
      assert.equal((await response.json()).error?.code, 'PHONE_VERIFICATION_REQUIRED', label);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 OTP endpoints refuse to send or check codes when the proof key is not configured', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unconfigured proof key must not reach the public gate or Twilio');
  };
  const unconfigured = { ...env, PHONE_VERIFICATION_PROOF_SECRET: 'too-short' };
  try {
    for (const [path, body] of [
      ['/api/public/verify/whatsapp/start', { slug: 'salon-a', phone: '05551602001' }],
      ['/api/public/verify/whatsapp/check', { slug: 'salon-a', phone: '05551602001', code: '123456' }],
    ]) {
      const response = await app.request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
        body: JSON.stringify(body),
      }, unconfigured);
      assert.equal(response.status, 503, path);
      assert.equal((await response.json()).error?.code, 'WHATSAPP_OTP_UNAVAILABLE', path);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 a pending or rejected WhatsApp check never issues a proof', async () => {
  const original = globalThis.fetch;
  for (const provider of [
    () => json({ status: 'pending' }),
    () => json({ code: 20404, message: 'provider detail must stay hidden' }, 404),
  ]) {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/rest/v1/rpc/execute_public_operation')) return rpc([{ name: 'Salon A', slug: 'salon-a' }]);
      if (url.endsWith('/VerificationCheck')) return provider();
      throw new Error(`unexpected fetch ${url}`);
    };
    try {
      const response = await app.request('http://localhost/api/public/verify/whatsapp/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
        body: JSON.stringify({ slug: 'salon-a', phone: '05551602001', code: '000000' }),
      }, env);
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error?.code, 'WHATSAPP_OTP_INVALID');
      assert.equal('phoneVerificationToken' in body, false);
      assert.doesNotMatch(JSON.stringify(body), /provider detail|20404/);
    } finally {
      globalThis.fetch = original;
    }
  }
});
