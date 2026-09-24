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
  assert.match(booking, /verificationChallenge/);
  assert.match(booking, /otpCode\.length !== 6/);
});

test('F16-02 changing the phone invalidates the previous OTP proof', () => {
  assert.match(booking, /function changeCustomerPhone\(value: string\)/);
  assert.match(booking, /if \(value !== verifiedPhone\)/);
  assert.match(booking, /setVerifiedPhone\(''\)/);
  assert.match(booking, /setPhoneVerificationToken\(''\)/);
  assert.match(booking, /setVerificationChallenge\(''\)/);
  assert.match(booking, /setOtpCode\(''\)/);
  assert.match(booking, /setOtpSent\(false\)/);
});

test('F16-02 both public create shapes carry the phone proof and refuse unverified phone', () => {
  assert.match(booking, /phoneVerificationToken,/);
  assert.ok((booking.match(/phoneVerificationToken,/g) ?? []).length >= 2);
  assert.match(booking, /if \(!phoneVerificationToken \|\| verifiedPhone !== customerPhone\)/);
  assert.match(booking, /disabled=\{busy \|\| Boolean\(blockingRecord\)[^}]*!phoneVerificationToken[^}]*verifiedPhone !== customerPhoneValue\.trim\(\)\}/s);
});

test('F16-02 WhatsApp OTP controls remain usable on narrow mobile widths', () => {
  assert.match(css, /\.public-otp-controls\s*\{/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.public-otp-controls \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.public-otp-ok/);
});
