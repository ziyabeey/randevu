import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const booking = await readFile(new URL('../src/PublicBookingPage.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/public-booking.css', import.meta.url), 'utf8');

test('F16-02 public booking exposes WhatsApp OTP start and check before create', () => {
  assert.match(booking, /\/api\/public\/verify\/whatsapp\/start/);
  assert.match(booking, /\/api\/public\/verify\/whatsapp\/check/);
  assert.match(booking, /WhatsApp kodu gönder/);
  assert.match(booking, /Kodu doğrula/);
  assert.match(booking, /WhatsApp doğrulandı/);
  assert.match(booking, /autoComplete="one-time-code"/);
  assert.match(booking, /inputMode="numeric"/);
});

test('F16-02 OTP code validation accepts real digit codes (regression: double-escaped regex)', () => {
  const guard = booking.match(/if \(!phone \|\| !(\/[^/]+\/)\.test\(otpCode\.trim\(\)\)\)/);
  assert.ok(guard, 'OTP check guard is missing');
  const pattern = new Function(`return ${guard[1]};`)();
  assert.equal(pattern.test('123456'), true);
  assert.equal(pattern.test('1234'), true);
  assert.equal(pattern.test('12a456'), false);
  assert.equal(pattern.test('123'), false);
  const sanitizer = booking.match(/setOtpCode\(event\.target\.value\.replace\((\/[^/]+\/g), ''\)\)/);
  assert.ok(sanitizer, 'OTP input sanitizer is missing');
  assert.equal('12 34-56'.replace(new Function(`return ${sanitizer[1]};`)(), ''), '123456');
});

test('F16-02 changing the phone invalidates the previous OTP proof', () => {
  assert.match(booking, /function changeCustomerPhone\(value: string\)/);
  assert.match(booking, /if \(value !== verifiedPhone\)/);
  assert.match(booking, /setVerifiedPhone\(''\)/);
  assert.match(booking, /setPhoneVerificationToken\(''\)/);
  assert.match(booking, /setOtpCode\(''\)/);
  assert.match(booking, /setOtpSent\(false\)/);
});

test('F16-02 both public create shapes carry the phone proof and refuse unverified phone', () => {
  assert.match(booking, /phoneVerificationToken,/);
  assert.ok((booking.match(/phoneVerificationToken,/g) ?? []).length >= 2);
  assert.match(booking, /if \(!phoneVerificationToken \|\| verifiedPhone !== customerPhone\)/);
  // The submit stays reachable so an unverified submit explains itself through the
  // associated role=alert contact error instead of a silently disabled button.
  assert.match(booking, /setContactError\('Telefon numarasını WhatsApp koduyla doğrulayın\.'\)/);
  assert.doesNotMatch(booking, /disabled=\{[^}]*!phoneVerificationToken[^}]*\}/);
});

test('F16-02 WhatsApp OTP controls remain usable on narrow mobile widths', () => {
  assert.match(css, /\.public-otp-controls\s*\{/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.public-otp-controls \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.public-otp-ok/);
});
