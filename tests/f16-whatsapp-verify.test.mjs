import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkWhatsappVerification,
  issueWhatsappPhoneProof,
  normalizeWhatsappPhone,
  phoneProofSecret,
  startWhatsappVerification,
  twilioVerifyConfigured,
  verifyWhatsappPhoneProof,
} from '../worker/whatsapp-verify.ts';

const env = {
  TWILLO_ID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TWILLO_SECRET_API: 'test-auth-token-1234567890',
  TWILIO_VERIFY_SERVICE_SID: 'VAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  PHONE_VERIFICATION_PROOF_SECRET: 'p'.repeat(48),
};

test('F16-02 WhatsApp Verify config uses the connected Twilio secret aliases', () => {
  assert.ok(twilioVerifyConfigured(env));
  assert.equal(normalizeWhatsappPhone('0555 160 20 01'), '+905551602001');
  assert.equal(normalizeWhatsappPhone('+90 555 160 20 01'), '+905551602001');
  assert.equal(normalizeWhatsappPhone('+44 7700 900123'), null);
});

test('F16-02 starts Twilio Verify explicitly on the whatsapp channel', async () => {
  let request = null;
  const result = await startWhatsappVerification(env, '05551602001', async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      sid: 'VEcccccccccccccccccccccccccccccccc',
      status: 'pending',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });

  assert.deepEqual(result, {
    status: 'pending',
    verificationSid: 'VEcccccccccccccccccccccccccccccccc',
  });
  assert.equal(request.url, 'https://verify.twilio.com/v2/Services/VAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/Verifications');
  const body = new URLSearchParams(String(request.init.body));
  assert.equal(body.get('To'), '+905551602001');
  assert.equal(body.get('Channel'), 'whatsapp');
  assert.match(new Headers(request.init.headers).get('Authorization') ?? '', /^Basic /);
});

test('F16-02 checks the OTP through Twilio Verify and accepts only approved status', async () => {
  const approved = await checkWhatsappVerification(env, '5551602001', '123456', async (url, init) => {
    assert.equal(String(url), 'https://verify.twilio.com/v2/Services/VAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/VerificationCheck');
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get('To'), '+905551602001');
    assert.equal(body.get('Code'), '123456');
    return new Response(JSON.stringify({ status: 'approved' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.deepEqual(approved, { status: 'approved' });

  const pending = await checkWhatsappVerification(env, '5551602001', '000000', async () =>
    new Response(JSON.stringify({ status: 'pending' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  assert.deepEqual(pending, { status: 'pending' });
});

test('F16-02 WhatsApp proof is bound to slug, normalized phone and ten-minute lifetime', async () => {
  const now = 2_000_000_000;
  const token = await issueWhatsappPhoneProof(env.PHONE_VERIFICATION_PROOF_SECRET, 'salon-a', '05551602001', now);
  assert.ok(token);
  assert.equal(await verifyWhatsappPhoneProof(env.PHONE_VERIFICATION_PROOF_SECRET, token, 'salon-a', '+905551602001', now + 30), true);
  assert.equal(await verifyWhatsappPhoneProof(env.PHONE_VERIFICATION_PROOF_SECRET, token, 'salon-b', '+905551602001', now + 30), false);
  assert.equal(await verifyWhatsappPhoneProof(env.PHONE_VERIFICATION_PROOF_SECRET, token, 'salon-a', '+905551602002', now + 30), false);
  assert.equal(await verifyWhatsappPhoneProof(env.PHONE_VERIFICATION_PROOF_SECRET, token, 'salon-a', '+905551602001', now + 601), false);
  assert.equal(await verifyWhatsappPhoneProof('q'.repeat(48), token, 'salon-a', '+905551602001', now + 30), false);
  assert.equal(await issueWhatsappPhoneProof('short', 'salon-a', '05551602001', now), null);
});

test('F16-02 proof key configuration requires a dedicated high-entropy secret', () => {
  assert.equal(phoneProofSecret({}), null);
  assert.equal(phoneProofSecret({ PHONE_VERIFICATION_PROOF_SECRET: 'x'.repeat(42) }), null);
  assert.equal(phoneProofSecret({ PHONE_VERIFICATION_PROOF_SECRET: ` ${'x'.repeat(43)} ` }), 'x'.repeat(43));
  assert.equal(phoneProofSecret({ PUBLIC_BOOKING_GATE_SECRET: 'g'.repeat(48) }), null, 'the abuse gate secret is never reused');
});

test('F16-02 provider failures stay sanitized and expose retryability only', async () => {
  const result = await startWhatsappVerification(env, '05551602001', async () =>
    new Response(JSON.stringify({ code: 60203, message: 'provider detail' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    }));
  assert.equal(result.status, 'failed');
  assert.equal(result.retryable, true);
  assert.equal(result.errorClass, 'twilio_verify_60203');
  assert.equal(result.retryAfterSeconds, 60);
});
