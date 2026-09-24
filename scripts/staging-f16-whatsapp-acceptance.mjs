// F16-02 hosted acceptance: a real Twilio Verify WhatsApp OTP on a verified
// recipient. A person must read the code from WhatsApp, so this runs from an
// operator terminal against an already deployed staging Worker:
//
//   STAGING_APP_ORIGIN=https://<staging-worker> \
//   TWILIO_TEST_RECIPIENT=+905xxxxxxxxx \
//   node scripts/staging-f16-whatsapp-acceptance.mjs
//
// It never prints the phone number, the OTP code or the proof token.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { normalizeWhatsappPhone } from '../worker/whatsapp-verify.ts';

const origin = (process.env.STAGING_APP_ORIGIN ?? '').replace(/\/$/, '');
const slug = process.env.F16_ACCEPTANCE_SLUG ?? 'staging-salon-a';
const recipient = normalizeWhatsappPhone(process.env.TWILIO_TEST_RECIPIENT ?? '');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) throw new Error('STAGING_APP_ORIGIN must be the https staging origin');
if (!recipient) throw new Error('TWILIO_TEST_RECIPIENT must be a verified Turkish mobile number');
const otherPhone = recipient.endsWith('9') ? `${recipient.slice(0, -1)}8` : `${recipient.slice(0, -1)}9`;

async function post(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': `f16-wa-accept-${Date.now()}` },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}

// A syntactically complete single-booking request with a non-v2 key and a
// nonexistent service/staff: the Worker checks the phone proof before the
// intent and the booking RPC, so a rejected proof answers
// PHONE_VERIFICATION_REQUIRED and an accepted proof moves on to a non-phone
// error. No appointment can be created by this probe.
function probeBooking(phone, phoneVerificationToken) {
  return post(`/api/public/business/${slug}/book`, {
    customerName: 'F16-02 Acceptance',
    customerPhone: phone,
    customerEmail: null,
    notes: null,
    phoneVerificationToken,
    serviceId: '00000000-0000-4000-8000-000000000000',
    staffId: '00000000-0000-4000-8000-000000000000',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    managementToken: 'M'.repeat(43),
    recoveryId: '00000000-0000-4000-8000-000000000000',
    recoverySecret: 'R'.repeat(43),
  });
}

const unverified = await probeBooking(recipient, undefined);
if (unverified.status !== 403 || unverified.data?.error?.code !== 'PHONE_VERIFICATION_REQUIRED') {
  throw new Error(`Unverified public booking was not rejected (HTTP ${unverified.status})`);
}
console.log('F16-02: unverified public booking is rejected with PHONE_VERIFICATION_REQUIRED.');

const started = await post('/api/public/verify/whatsapp/start', { slug, phone: recipient });
if (started.status !== 202 || started.data?.channel !== 'whatsapp') {
  throw new Error(`WhatsApp OTP start failed (HTTP ${started.status}, ${started.data?.error?.code ?? 'no code'})`);
}
console.log('F16-02: Twilio Verify accepted a WhatsApp verification for the verified recipient.');

const prompt = createInterface({ input: stdin, output: stdout });
const code = (await prompt.question('WhatsApp code received on the verified recipient: ')).trim();
prompt.close();
if (!/^\d{4,10}$/.test(code)) throw new Error('The WhatsApp code must be 4-10 digits');

const checked = await post('/api/public/verify/whatsapp/check', { slug, phone: recipient, code });
const token = checked.data?.phoneVerificationToken;
if (checked.status !== 200 || typeof token !== 'string' || token.length < 40) {
  throw new Error(`WhatsApp OTP check did not issue a proof (HTTP ${checked.status}, ${checked.data?.error?.code ?? 'no code'})`);
}
console.log(`F16-02: Twilio Verify approved the code; proof issued for ${checked.data.expiresInSeconds}s.`);

const reused = await post('/api/public/verify/whatsapp/check', { slug, phone: recipient, code });
if (reused.status === 200) throw new Error('An approved WhatsApp code was accepted twice');
console.log(`F16-02: reusing the approved code is refused (HTTP ${reused.status}).`);

const foreign = await probeBooking(otherPhone, token);
if (foreign.status !== 403 || foreign.data?.error?.code !== 'PHONE_VERIFICATION_REQUIRED') {
  throw new Error(`The proof was accepted for another phone (HTTP ${foreign.status})`);
}
console.log('F16-02: the proof is rejected for another phone number.');

const accepted = await probeBooking(recipient, token);
if (accepted.data?.error?.code === 'PHONE_VERIFICATION_REQUIRED') {
  throw new Error('The hosted Worker rejected a freshly approved WhatsApp proof');
}
console.log(`F16-02: the hosted Worker accepted the proof and stopped at the next gate (HTTP ${accepted.status}, ${accepted.data?.error?.code ?? 'no code'}).`);
console.log(`F16-02 hosted WhatsApp OTP acceptance passed on ${new URL(origin).host} for slug ${slug} at ${new Date().toISOString()}.`);
