import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const booking = await readFile(new URL('../src/BookingPage.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/phase5.css', import.meta.url), 'utf8');
const worker = await readFile(new URL('../worker/f11-group-management-http.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260921023000_f13_group_lifecycle.sql', import.meta.url), 'utf8');
const browser = await readFile(new URL('../scripts/browser-f11-group-consumers.mjs', import.meta.url), 'utf8');
const productionBrowser = await readFile(new URL('../scripts/browser-f13-booking-production.mjs', import.meta.url), 'utf8');
const browserSmoke = await readFile(new URL('../scripts/browser-smoke.sh', import.meta.url), 'utf8');

test('F13-03 operator composer keeps the required field order and uses the atomic group engine', () => {
  const time = booking.indexOf("<strong>{t('Zaman')}</strong>");
  const customer = booking.indexOf("<strong>{t('Müşteri')}</strong>");
  const lines = booking.indexOf("<strong>{t('Hizmet / personel satırları')}</strong>");
  const note = booking.indexOf("<strong>{t('Not ve oluştur')}</strong>");
  assert.ok(time >= 0 && time < customer && customer < lines && lines < note);
  assert.ok(booking.includes("'/api/availability/group-slots'"));
  assert.match(booking, /api\('\/api\/bookings\/groups'/);
  assert.match(booking, /'Idempotency-Key': createKey/);
  assert.match(booking, /lines: createLines\.map/);
  const createStart = booking.indexOf("await api('/api/bookings/groups'");
  const createEnd = booking.indexOf("      });", createStart);
  assert.ok(createStart >= 0 && createEnd > createStart);
  assert.doesNotMatch(booking.slice(createStart, createEnd), /customerId/);
});

test('F13-03 close-time stays adjacent while F14-04 owns the live ticket connection point', () => {
  assert.match(booking, /closeOpen \? t\('Kapat'\) : t\('Saat kapat'\)/);
  assert.match(booking, /api\('\/api\/availability\/blocks'/);
  // F16-03 turned the former upcoming photo placeholder into the live private photo tab.
  assert.match(booking, /role="tab" aria-selected=\{detailTab === 'photos'\}.*setDetailTab\('photos'\)\}>\{t\('Fotoğraf'\)\}<\/button>/);
  assert.match(booking, /<AppointmentPhotos/);
  assert.match(booking, /openTicketForBooking/);
  assert.match(booking, /\/api\/tickets\/from-booking-group/);
  assert.match(booking, /Idempotency-Key/);
  assert.match(booking, /\/app\/mobile\/tickets\?ticketId=/);
  const detailStart = booking.indexOf('booking-detail-tabs');
  const detailEnd = booking.indexOf('{rescheduleTarget', detailStart);
  const detailSurface = booking.slice(detailStart, detailEnd);
  assert.doesNotMatch(detailSurface, /F14|F16-03|backend|\bFaz\b|\bRPC\b|\btenant\b/i);
  assert.doesNotMatch(booking, /api\([^\n]*photo/i);
  assert.match(css, /\.booking-close-panel/);
  assert.match(css, /\.booking-detail-tabs/);
});

test('F13-03 native lifecycle is one CAS/idempotent group mutation, never N client line writes', () => {
  assert.match(worker, /\/bookings\/groups\/:groupId\/status/);
  assert.match(worker, /set_appointment_group_status/);
  assert.match(worker, /p_expected_version: body\.expectedVersion/);
  assert.match(migration, /'group_status'/);
  assert.match(migration, /claim_booking_command/);
  assert.match(migration, /app\.f11_group_status_batch_id/);
  assert.match(migration, /set status=p_status/);
  assert.match(migration, /version=g\.version\+1/);
  assert.match(migration, /INVALID_GROUP_STATUS_TRANSITION/);
  assert.match(migration, /BOOKING_GROUP_PARTIAL_STATUS/);
});

test('F13-03 real Chrome acceptance covers multi-service create, stale slots, close-time and detail lifecycle', () => {
  assert.match(browser, /operator composer creates a two-service reservation through one atomic group command/);
  assert.match(browser, /operator composer ignores stale group-slot responses after draft changes/);
  assert.match(browser, /guarded close-time access next to booking creation/);
  assert.match(browser, /truthful future tabs and native CAS lifecycle actions/);
});

test('F13-03 production-entry acceptance is wired through the real main route and lazy BookingPage chunk', () => {
  assert.match(productionBrowser, /src\/main\.tsx/);
  assert.match(productionBrowser, /production \/app\/bookings did not request BookingPage lazy chunk/);
  assert.match(productionBrowser, /RANDEVU YÖNETİMİ/);
  assert.match(browserSmoke, /browser-f13-booking-production\.mjs/);
});
