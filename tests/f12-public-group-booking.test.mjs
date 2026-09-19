import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const booking = await readFile(new URL('../src/PublicBookingPage.tsx', import.meta.url), 'utf8');
const selection = await readFile(new URL('../src/PublicMultiServiceSelection.tsx', import.meta.url), 'utf8');
const salon = await readFile(new URL('../src/PublicSalonPage.tsx', import.meta.url), 'utf8');
const entry = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/public-booking.css', import.meta.url), 'utf8');

test('F12-05 consumes the accepted group create contract with the durable v2 intent', () => {
  assert.match(booking, /isGroupMode \? 'group-book' : 'book'/);
  assert.match(booking, /lines: multiServiceSelection!\.lines/);
  assert.match(booking, /startsAt: multiServiceSelection!\.slot\.startsAt/);
  assert.match(booking, /derivePublicBookingIntentV2/);
  assert.match(booking, /acquirePublicBookingIntent/);
  assert.match(booking, /requestFingerprint: await sha256Hex\(JSON\.stringify\(payload\)\)/);
  assert.match(booking, /'Idempotency-Key': pending\.idempotencyKey/);
  assert.match(booking, /managementToken, recoveryId: pending\.recoveryId, recoverySecret: pending\.recoverySecret/);
  assert.doesNotMatch(booking, /supabase|execute_public_operation|create_appointment_group/i);
});

test('F12-05 validates ordered group results, range estimates and the exact management capability', () => {
  assert.match(booking, /validGroupConfirmation/);
  assert.match(booking, /groupMatchesSelection/);
  assert.match(booking, /result\.management\?\.url !== `\/m#\$\{managementToken\}`/);
  assert.match(booking, /estimateMinMinor/);
  assert.match(booking, /estimateMaxMinor/);
  assert.match(booking, /Kesin tahsilat tutarı değildir\./);
  assert.match(booking, /Kayıt durumu:/);
  assert.match(booking, /Mesaj durumu:/);
  assert.match(booking, /Bu ekran SMS veya e-posta teslimini doğrulamaz\./);
});

test('F12-05 resolves uncertain submissions without issuing a second create', () => {
  assert.match(booking, /markPublicBookingUnresolved/);
  assert.match(booking, /\/api\/public\/booking\/resolve/);
  assert.match(booking, /if \(unresolved && isRecoverableRecord\(unresolved\)\) await resolveStoredResult\(unresolved, true\)/);
  assert.match(booking, /resolution === 'closed_absent'/);
  assert.match(booking, /if \(isGroupMode\) onPlanNeedsRefresh\?\.\(\)/);
  assert.match(selection, /availabilityRefreshToken/);
  assert.match(selection, /if \(date && lines\.length\) void loadSlots\(\)/);
});

test('F12-05 exposes associated contact errors and non-color result cues', () => {
  assert.match(booking, /id="public-contact-help"/);
  assert.match(booking, /id="public-contact-error"/);
  assert.match(booking, /aria-invalid=\{Boolean\(contactError\)\}/);
  assert.match(booking, /role="alert"/);
  assert.match(booking, /public-result-status/);
  assert.match(css, /\.public-field-error/);
  assert.match(css, /\.public-primary:focus-visible/);
});

test('F12-05 keeps one booking-state owner and lazy-loads private/operator page implementations', () => {
  assert.match(salon, /onResultVisibilityChange=\{setBookingResultVisible\}/);
  assert.match(salon, /!bookingResultVisible/);
  assert.equal((salon.match(/<PublicBookingPage/g) ?? []).length, 1);
  assert.match(entry, /lazy\(\(\) => import\('\.\/PublicSalonPage'\)\)/);
  assert.match(entry, /lazy\(\(\) => import\('\.\/ManageAppointmentPage'\)\)/);
  assert.match(entry, /lazy\(\(\) => import\('\.\/CalendarPage'\)\)/);
  assert.doesNotMatch(entry, /^import (?:App|CalendarPage|CustomersPage|BookingPage) from/m);
});
