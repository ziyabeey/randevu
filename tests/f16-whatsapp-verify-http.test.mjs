import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../worker/app.ts';
import {
  issueWhatsappOtpChallenge,
  verifyWhatsappPhoneProof,
  whatsappOtpChallengeUseKey,
  whatsappPhoneRateKey,
} from '../worker/whatsapp-verify.ts';

const gateSecret = 'g'.repeat(48);
const env = {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  COOKIE_SECURE: 'false',
  PUBLIC_BOOKING_GATE_SECRET: gateSecret,
  NETGSM_USERCODE: '8503030303',
  NETGSM_PASSWORD: 'netgsm-test-password',
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

test('F16-02 public WhatsApp OTP start is an explicit public mutation and reaches Netgsm transport', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const phoneKeys = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      const wire = JSON.parse(String(init.body));
      assert.equal(wire.p_action, 'phone_verify');
      assert.equal(wire.p_args.p_slug, 'salon-a');
      assert.equal(wire.p_args.p_phase, 'start');
      assert.match(wire.p_args.p_phone_key, /^[0-9a-f]{64}$/);
      assert.ok(!JSON.stringify(wire).includes('5551602001'), 'the phone number reached the rate RPC');
      phoneKeys.push(wire.p_args.p_phone_key);
      assert.match(wire.p_actor_hash, /^[0-9a-f]{64}$/);
      assert.match(wire.p_network_hash, /^[0-9a-f]{64}$/);
      return rpc([{ name: 'Salon A', slug: 'salon-a' }]);
    }
    if (url === 'https://whatsappapi.netgsm.com.tr/v1/otp') {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Authorization'), `Basic ${Buffer.from(`${env.NETGSM_USERCODE}:${env.NETGSM_PASSWORD}`).toString('base64')}`);
      const wire = JSON.parse(String(init.body));
      assert.equal(wire.to, '+905551602001');
      assert.match(wire.code, /^\d{6}$/);
      assert.deepEqual(Object.keys(wire).sort(), ['code', 'to']);
      return json({ code: '00', description: 'success' }, 200);
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
    assert.deepEqual(phoneKeys, [await whatsappPhoneRateKey(gateSecret, '+90 555 160 20 01')]);
  } finally { globalThis.fetch = original; }
});

test('F16-02 approved app-issued WhatsApp OTP returns a slug-and-phone-bound booking proof', async () => {
  const original = globalThis.fetch;
  const verificationChallenge = await issueWhatsappOtpChallenge(gateSecret, 'salon-a', '05551602001', '123456');
  assert.ok(verificationChallenge);
  const phoneKey = await whatsappPhoneRateKey(gateSecret, '05551602001');
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      // R1-B1: every code check spends the per-phone check budget, and a
      // matched code consumes its challenge in the same call.
      const wire = JSON.parse(String(init.body));
      assert.equal(wire.p_args.p_phase, 'check');
      assert.equal(wire.p_args.p_phone_key, phoneKey);
      assert.equal(wire.p_args.p_challenge_key, await whatsappOtpChallengeUseKey(verificationChallenge));
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

async function checkWith(dbResponse, code) {
  const original = globalThis.fetch;
  const verificationChallenge = await issueWhatsappOtpChallenge(gateSecret, 'salon-a', '05551602001', '123456');
  const wires = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/rest/v1/rpc/execute_public_operation')) {
      wires.push(JSON.parse(String(init.body)));
      return dbResponse;
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const response = await app.request('http://localhost/api/public/verify/whatsapp/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.45' },
      body: JSON.stringify({ slug: 'salon-a', phone: '05551602001', code, verificationChallenge }),
    }, env);
    return { response, body: await response.json(), wires, verificationChallenge };
  } finally {
    globalThis.fetch = original;
  }
}

test('F16-02 a wrong OTP spends the per-phone check budget and yields no proof', async () => {
  const { response, body, wires } = await checkWith(rpc([{ name: 'Salon A', slug: 'salon-a' }]), '654321');
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'WHATSAPP_OTP_INVALID');
  assert.equal(body.phoneVerificationToken, undefined);
  // The guess reached the budget before its outcome was revealed, and it
  // cannot consume the challenge.
  assert.equal(wires.length, 1);
  assert.equal(wires[0].p_args.p_phase, 'check');
  assert.equal(wires[0].p_args.p_phone_key, await whatsappPhoneRateKey(gateSecret, '05551602001'));
  assert.equal('p_challenge_key' in wires[0].p_args, false);
});

test('F16-02 a replayed verified challenge is refused without a second proof', async () => {
  const { response, body, wires, verificationChallenge } = await checkWith(
    json({ ok: false, error: { message: 'WHATSAPP_OTP_CHALLENGE_USED' } }),
    '123456',
  );
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'WHATSAPP_OTP_INVALID');
  assert.equal(body.phoneVerificationToken, undefined);
  assert.equal(wires[0].p_args.p_challenge_key, await whatsappOtpChallengeUseKey(verificationChallenge));
});

test('F16-02 a correct OTP past the per-phone budget is rate limited without a proof', async () => {
  const { response, body } = await checkWith(
    json({ ok: false, error: { message: 'PUBLIC_BOOKING_RATE_LIMITED:120' } }),
    '123456',
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '120');
  assert.equal(body.phoneVerificationToken, undefined);
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
