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
  zernioWhatsappConfigured,
} from '../worker/whatsapp-verify.ts';

const env = {
  ZERNIO_API_KEY: `sk_${'a'.repeat(64)}`,
  ZERNIO_WHATSAPP_ACCOUNT_ID: '0123456789abcdef01234567',
  ZERNIO_WHATSAPP_TEMPLATE_NAME: 'randevu_phone_verification',
  ZERNIO_WHATSAPP_TEMPLATE_LANGUAGE: 'tr',
  PUBLIC_BOOKING_GATE_SECRET: 'g'.repeat(48),
};

test('F16-02 Zernio WhatsApp config is strict and phone normalization stays Turkey-mobile bounded', () => {
  assert.ok(zernioWhatsappConfigured(env));
  assert.equal(zernioWhatsappConfigured({ ...env, ZERNIO_API_KEY: 'bad' }), null);
  assert.equal(zernioWhatsappConfigured({ ...env, ZERNIO_WHATSAPP_ACCOUNT_ID: 'short' }), null);
  assert.equal(normalizeWhatsappPhone('0555 160 20 01'), '+905551602001');
  assert.equal(normalizeWhatsappPhone('+90 555 160 20 01'), '+905551602001');
  assert.equal(normalizeWhatsappPhone('+44 7700 900123'), null);
});

test('F16-02 sends the app-issued OTP through the Zernio WhatsApp template transport', async () => {
  let request = null;
  const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      success: true,
      data: {
        messageId: 'msg_123',
        conversationId: 'conv_456',
        participantId: '905551602001',
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });

  assert.deepEqual(result, {
    status: 'sent',
    providerMessageId: 'msg_123',
    conversationId: 'conv_456',
  });
  assert.equal(request.url, 'https://zernio.com/api/v1/inbox/conversations');
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get('Authorization'), env.ZERNIO_API_KEY ? `Bearer ${env.ZERNIO_API_KEY}` : null);
  const body = JSON.parse(String(request.init.body));
  assert.deepEqual(body, {
    accountId: env.ZERNIO_WHATSAPP_ACCOUNT_ID,
    participantId: '905551602001',
    templateName: env.ZERNIO_WHATSAPP_TEMPLATE_NAME,
    templateLanguage: 'tr',
    templateParams: ['123456'],
  });
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
    new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'provider detail must not escape' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    }));
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.errorClass, 'zernio_whatsapp_RATE_LIMITED');
  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(JSON.stringify(result).includes('provider detail'), false);
});
