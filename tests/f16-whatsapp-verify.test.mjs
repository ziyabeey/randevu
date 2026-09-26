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

// G16-T1/T2 coordinator-review regressions. All responses and credentials here
// are synthetic; Fetch is injected and no request leaves the test process.
const privateMarker = 'synthetic-private-marker';
const unexpectedResponses = [
  ['plain text', `${privateMarker}: rejected`],
  ['HTML', `<html>${privateMarker}</html>`],
  ['missing code', JSON.stringify({ description: privateMarker })],
  ['arbitrary code', JSON.stringify({ code: privateMarker })],
  ['numeric phone as code', JSON.stringify({ code: 905551602001 })],
  ['unknown short code', JSON.stringify({ code: '99', description: privateMarker })],
  ['object code', JSON.stringify({ code: { detail: privateMarker } })],
  ['array', JSON.stringify([{ code: '00', detail: privateMarker }])],
  ['null', 'null'],
];
for (const [label, body] of unexpectedResponses) {
  test(`G16-T1 ${label} never enters transport diagnostics`, async () => {
    let calls = 0;
    const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async () => {
      calls += 1;
      return new Response(body, { status: 502, headers: { 'Retry-After': '17' } });
    });
    assert.equal(calls, 1, 'the actual helper must reach the injected provider boundary');
    assert.deepEqual(result, {
      status: 'failed', errorClass: 'netgsm_whatsapp_http_502',
      retryable: true, retryAfterSeconds: 17,
    });
    assert.equal(JSON.stringify(result).includes(privateMarker), false);
  });
}

for (const code of ['30', '60', '70', '80', '100']) {
  test(`G16-T1 documented provider failure ${code} keeps its safe classification`, async () => {
    for (const value of [code, Number(code)]) {
      const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async () =>
        new Response(JSON.stringify({ code: value, description: privateMarker }), { status: 200 }));
      assert.deepEqual(result, {
        status: 'failed', errorClass: `netgsm_whatsapp_${code}`,
        retryable: code === '100', retryAfterSeconds: undefined,
      });
    }
  });
}

test('G16-T1 successful HTTP alone and numeric zero cannot authorize sent', async () => {
  for (const body of [JSON.stringify({ code: 0 }), 'OK', JSON.stringify({ description: privateMarker })]) {
    const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async () =>
      new Response(body, { status: 200 }));
    assert.deepEqual(result, {
      status: 'failed', errorClass: 'netgsm_whatsapp_http_200',
      retryable: false, retryAfterSeconds: undefined,
    });
  }
});

test('G16-T1 exact 00 success and plain documented responses remain compatible', async () => {
  for (const body of ['00', JSON.stringify({ code: '00', jobid: privateMarker })]) {
    const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async () =>
      new Response(body, { status: 200 }));
    assert.deepEqual(result, { status: 'sent', providerCode: '00' });
  }
  const rejected = await sendWhatsappVerificationCode(env, '05551602001', '123456', async () =>
    new Response('30', { status: 200 }));
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.errorClass, 'netgsm_whatsapp_30');
});

for (const status of [302, 307, 308, 503]) {
  test(`G16-T1/T2 HTTP ${status} cannot claim success through code 00`, async () => {
    let request;
    let calls = 0;
    const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async (url, init) => {
      calls += 1;
      request = new Request(url, init);
      return new Response(JSON.stringify({ code: '00', description: privateMarker }), {
        status, headers: { Location: 'https://redirect.invalid/otp' },
      });
    });
    assert.equal(calls, 1);
    // Assert outside injected Fetch so a swallowed assertion cannot pass a test.
    assert.equal(request.redirect, 'error', 'OTP transport must forbid redirects');
    assert.equal(request.url, 'https://whatsappapi.netgsm.com.tr/v1/otp');
    assert.deepEqual(result, {
      status: 'failed', errorClass: `netgsm_whatsapp_http_${status}`,
      retryable: status >= 500, retryAfterSeconds: undefined,
    });
  });
}

test('G16-T2 Fetch redirect rejection and network details stay private', async () => {
  let request;
  const result = await sendWhatsappVerificationCode(env, '05551602001', '123456', async (url, init) => {
    request = new Request(url, init);
    throw new TypeError(privateMarker);
  });
  assert.equal(request.redirect, 'error');
  assert.deepEqual(result, {
    status: 'failed', errorClass: 'netgsm_whatsapp_send_network_error', retryable: true,
  });
});
