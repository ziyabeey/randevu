import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const booking = await readFile(new URL('../src/BookingPage.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/phase5.css', import.meta.url), 'utf8');

test('F16-02 booking composer exposes bounded transactional notification preferences', () => {
  assert.match(booking, /const \[notificationEmail, setNotificationEmail\] = useState\(true\)/);
  assert.match(booking, /const \[notificationSms, setNotificationSms\] = useState\(false\)/);
  assert.match(booking, /const \[reminderMinutes, setReminderMinutes\] = useState\('1440'\)/);

  assert.match(booking, /notifications:\s*\{\s*emailEnabled:\s*notificationEmail,\s*smsEnabled:\s*notificationSms,/s);
  assert.match(booking, /reminderMinutesBefore:\s*reminderMinutes === 'none' \? null : Number\(reminderMinutes\)/);

  assert.match(booking, /aria-label="Randevu bildirim tercihleri"/);
  assert.match(booking, />E-posta<\/strong>/);
  assert.match(booking, />SMS<\/strong>/);
  assert.match(booking, />Hatırlatma<\/span>/);
  assert.match(booking, /<option value="1440">24 saat önce<\/option>/);
  assert.match(booking, /<option value="none">Kapalı<\/option>/);

  assert.doesNotMatch(booking, /SMS<\/strong><small>F16-02 ile açılacak/);
  assert.match(booking, /SMS seçeneği yalnız işlemsel randevu mesajları içindir/);
  assert.match(booking, /recurrenceFrequency === 'none'/);
  assert.match(booking, /Tekrarlayan seriler için bildirim tercihleri G16 ortak entegrasyonunda bağlanacak/);
});

test('F16-02 preference changes rotate booking idempotency identity', () => {
  assert.match(booking, /setNotificationEmail\(event\.target\.checked\);\s*setCreateKey\(commandKey\(\)\)/);
  assert.match(booking, /setNotificationSms\(event\.target\.checked\);\s*setCreateKey\(commandKey\(\)\)/);
  assert.match(booking, /setReminderMinutes\(event\.target\.value\);\s*setCreateKey\(commandKey\(\)\)/);
});

test('F16-02 notification controls collapse to one column on mobile', () => {
  assert.match(css, /\.booking-notification-options\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\) minmax\(10rem,.8fr\)/);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.booking-notification-options,[\s\S]*?grid-template-columns:\s*1fr/);
});
