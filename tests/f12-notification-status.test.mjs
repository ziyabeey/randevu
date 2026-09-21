import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { customerNotificationStatus } from '../shared/customer-notification-status.ts';

test('F12 notification status vocabulary is bounded and strips untrusted extras', () => {
  assert.deepEqual(
    customerNotificationStatus({
      channel: 'email', status: 'accepted',
      recipient: 'secret@example.test', provider: 'resend',
      provider_message_id: 'hidden', last_error_class: 'hidden', lease_token: 'hidden',
    }),
    { channel: 'email', status: 'accepted' },
  );
  assert.deepEqual(customerNotificationStatus({ channel: 'sms', status: 'accepted' }), { channel: 'email', status: 'unknown' });
  assert.deepEqual(customerNotificationStatus({ channel: 'email', status: 'delivered' }), { channel: 'email', status: 'unknown' });
  assert.deepEqual(customerNotificationStatus(null), { channel: 'email', status: 'unknown' });
});

test('F12 C04/C05 workers expose normalized notification status', () => {
  const recovery = readFileSync(new URL('../worker/public-booking-recovery.ts', import.meta.url), 'utf8');
  const group = readFileSync(new URL('../worker/f11-group-http.ts', import.meta.url), 'utf8');
  const manage = readFileSync(new URL('../worker/customer-manage.ts', import.meta.url), 'utf8');
  assert.match(recovery, /notification: customerNotificationStatus\(/);
  assert.match(group, /notification: customerNotificationStatus\(/);
  assert.match(manage, /customerNotificationStatus\(appointment\.notification_status\)/);
});
