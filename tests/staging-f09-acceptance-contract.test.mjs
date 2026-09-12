import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/staging-f09-acceptance.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('F09 live acceptance command is wired to the dedicated staging script', () => {
  assert.equal(pkg.scripts['staging:f09-acceptance'], 'node scripts/staging-f09-acceptance.mjs');
});

test('F09 live acceptance keeps recovery, idempotency and capability negative cases', () => {
  assert.match(script, /createBookingAndDropResult/);
  assert.match(script, /\/api\/public\/booking\/recover/);
  assert.match(script, /Safe duplicate booking retry did not resolve the original appointment/);
  assert.match(script, /IDEMPOTENCY_CONFLICT/);
  assert.match(script, /\/api\/manage\/view/);
  assert.match(script, /MANAGEMENT_NOT_FOUND/);
  assert.match(script, /BOOKING_RECOVERY_NOT_FOUND/);
  assert.match(script, /set expires_at = now\(\) - interval '1 minute'/);
});

test('F09 live acceptance proves provider receipt authority and real Resend delivery', () => {
  assert.match(script, /rpc\/complete_notification_job/);
  assert.match(script, /NOTIFICATION_DISPATCH_UNAUTHORIZED/);
  assert.match(script, /appointment_notification_jobs/);
  assert.match(script, /state === 'sent'/);
  assert.match(script, /https:\/\/api\.resend\.com\/emails\/\$\{encodeURIComponent\(providerMessageId\)\}/);
  assert.match(script, /lastEvent === 'delivered'/);
  assert.match(script, /delivered\+f0905\$\{runLabel\}@resend\.dev/);
  assert.match(script, /rendered\.includes\(`\$\{origin\}\/m#`\)/);
});

test('F09 live acceptance never depends on a personal inbox', () => {
  assert.doesNotMatch(script, /gmail\.com|hotmail\.com|outlook\.com|yahoo\.com/i);
  assert.match(script, /delivered\+f0905/);
});
