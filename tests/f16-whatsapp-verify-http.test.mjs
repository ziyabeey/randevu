import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../worker/app.ts';
import { issueWhatsappOtpChallenge, verifyWhatsappPhoneProof } from '../worker/whatsapp-verify.ts';

const gateSecret = 'g'.repeat(48);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_BOOKING_GATE_SECRET: gateSecret,
  ZERNIO_API_KEY: `sk_${'a'.repeat(64)}`,
  ZERNIO_WHATSAPP_ACCOUNT_ID: '0123456789abcdef01234567',
  ZERNIO_WHATSAPP_TEMPLATE_NAME: 'randevu_phone_verification',
  ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE: 'tr',
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

test('F16-02 public WhatsApp OTP start is an explicit public mutation and reaches Zernio transport', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      const wire = JSON.parse(String(init.body));
      assert.equal(wire.p_action, 'phone_verify');
      assert.equal(wire.p_args.p_slug, 'salon-a');
      assert.match(wire.p_actor_hash, /^[0-9a-f]{64}$/);
      assert.match(wire.p_network_hash, /^[0-9a-f]{64}$/);
      return rpc([{ name: 'Salon A', slug: 'salon-a' }]);
    }
    if (url === 'https://zernio.com/api/v1/inbox/conversations') {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Authorization'), `Bearer ${env.ZERNIO_API_KEY}`);
      const wire = JSON.parse(String(init.body));
      assert.equal(wire.accountId, env.ZERNIO_WHATSAPP_ACCOUNT_ID);
      assert.equal(wire.participantId, '905551602001');
      assert.equal(wire.templateName, env.ZERNIO_WHATSAPP_TEMPLATE_NAME);
      assert.equal(wire.templateLanguage, 'tr');
      assert.equal(wire.templateParams.length, 1);
      assert.match(wire.templateParams[0], /^\d{6}$/);
      return json({
        success: true,
        data: { messageId: 'msg_123', conversationId: 'conv_456', participantId: wire.participantId },
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
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.channel, 'whatsapp');
    assert.equal(body.expiresInSeconds, 600);
    assert.equal(body.retryAfterSeconds, 30);
    assert.ok(typeof body.verificationChallenge === 'string' && body.verificationChallenge.length > 80);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('F16-02 approved app-issued WhatsApp OTP returns a slug-and-phone-bound booking proof', async () => {
  const original = globalThis.fetch;
  const verificationChallenge = await issueWhatsappOtpChallenge(gateSecret, 'salon-a', '05551602001', '123456');
  assert.ok(verificationChallenge);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      return rpc([{ name: 'Salon A', slug: 'salon-a' }]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await app.request('http://localhost/api/public/verify/whatsapp/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
      body: JSON.stringify({ slug: 'salon-a', phone: '05551602001', code: '123456', verificationChallenge }),
    }, env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.channel, 'whatsapp');
    assert.equal(body.expiresInSeconds, 600);
    assert.ok(typeof body.phoneVerificationToken === 'string' && body.phoneVerificationToken.length > 40);
    assert.equal(await verifyWhatsappPhoneProof(
      gateSecret,
      body.phoneVerificationToken,
      'salon-a',
      '+905551602001',
    ), true);
    assert.equal(await verifyWhatsappPhoneProof(
      gateSecret,
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

test('F16-02 group public booking also fails closed without WhatsApp proof', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('group booking without proof must not reach upstream');
  };

  try {
    const response = await app.request('http://localhost/api/public/business/salon-a/group-book', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'not-v2-but-valid',
      },
      body: JSON.stringify({
        customerName: 'Deniz Örnek',
        customerPhone: '05551602001',
        customerEmail: null,
        notes: null,
        startsAt: '2026-10-01T09:00:00.000Z',
        lines: [{ serviceId: '10000000-0000-4000-8000-000000000001', staffId: '10000000-0000-4000-8000-000000000002' }],
        managementToken: 'M'.repeat(48),
        recoveryId: '10000000-0000-4000-8000-000000000003',
        recoverySecret: 'R'.repeat(48),
      }),
    }, env);
    // Group booking validates its durable v2 intent before provider work, but the
    // WhatsApp proof must still prevent any upstream mutation.
    assert.ok([400, 403].includes(response.status));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
