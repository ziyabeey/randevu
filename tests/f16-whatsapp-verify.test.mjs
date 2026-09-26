import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateWhatsappOtpCode,
  issueWhatsappOtpChallenge,
  issueWhatsappPhoneProof,
  normalizeWhatsappPhone,
  sendWhatsappVerificationCode,
  verifyWhatsappOtpChallenge,
  verifyWhatsappPhoneProof,
  netgsmWhatsappConfigured,
} from '../worker/whatsapp-verify.ts';

const env = {
  NETGSM_USERCODE: '8503030303',
  NETGSM_PASSWORD: 'netgsm-test-password',
  PUBLIC_BOOKING_GATE_SECRET: 'g'.repeat(48),
};

test('F16-02 Netgsm WhatsApp config is strict and phone normalization stays Turkey-mobile bounded', () => {
  assert.ok(netgsmWhatsappConfigured(env));
  assert.equal(netgsmWhatsappConfigured({ ...env, NETGSM_USERCODE: 'bad' }), null);
  assert.equal(netgsmWhatsappConfigured({ ...env, NETGSM_PASSWORD: '' }), null);
  assert.equal(normalizeWhatsappPhone('0555 160 20 01'), '+905551602001');
  assert.equal(normalizeWhatsappPhone('+90 555 160 20 01'), '+905551602001');
  assert.equal(normalizeWhatsappPhone('+44 7700 900123'), null);
});

test('F16-02 sends the app-issued OTP through the Netgsm WhatsApp OTP transport', async () => {
  let request = null;
  const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ code: '00', description: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert.deepEqual(result, { status: 'sent', providerCode: '00' });
  assert.equal(request.url, 'https://whatsappapi.netgsm.com.tr/v1/otp');
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get('Authorization'), `Basic ${Buffer.from(`${env.NETGSM_USERCODE}:${env.NETGSM_PASSWORD}`).toString('base64')}`);
  assert.deepEqual(JSON.parse(String(request.init.body)), { to: '+905551602001', code: '123456' });
});

test('F16-02 OTP challenge is HMAC-bound to slug, phone, code and ten-minute lifetime', async () => {
  const now = 2_000_000_000;
  const token = await issueWhatsappOtpChallenge(
    env.PUBLIC_BOOKING_GATE_SECRET,
    'salon-a',
    '05551602001',
    '123456',
    now,
  );
  assert.ok(token);
  assert.equal(await verifyWhatsappOtpChallenge(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602001', '123456', now + 30), true);
  assert.equal(await verifyWhatsappOtpChallenge(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602001', '654321', now + 30), false);
  assert.equal(await verifyWhatsappOtpChallenge(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-b', '+905551602001', '123456', now + 30), false);
  assert.equal(await verifyWhatsappOtpChallenge(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602002', '123456', now + 30), false);
  assert.equal(await verifyWhatsappOtpChallenge(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602001', '123456', now + 601), false);
});

test('F16-02 generated OTP is always six numeric digits', () => {
  for (let index = 0; index < 100; index += 1) assert.match(generateWhatsappOtpCode(), /^\d{6}$/);
});

test('F16-02 WhatsApp proof is bound to slug, normalized phone and ten-minute lifetime', async () => {
  const now = 2_000_000_000;
  const token = await issueWhatsappPhoneProof(env.PUBLIC_BOOKING_GATE_SECRET, 'salon-a', '05551602001', now);
  assert.ok(token);
  assert.equal(await verifyWhatsappPhoneProof(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602001', now + 30), true);
  assert.equal(await verifyWhatsappPhoneProof(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-b', '+905551602001', now + 30), false);
  assert.equal(await verifyWhatsappPhoneProof(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602002', now + 30), false);
  assert.equal(await verifyWhatsappPhoneProof(env.PUBLIC_BOOKING_GATE_SECRET, token, 'salon-a', '+905551602001', now + 601), false);
});

test('F16-02 provider failures stay sanitized and expose retryability only', async () => {
  const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async () =>
    new Response(JSON.stringify({ code: '100', description: 'provider detail must not escape' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    }));
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.errorClass, 'netgsm_whatsapp_100');
  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(JSON.stringify(result).includes('provider detail'), false);
});
