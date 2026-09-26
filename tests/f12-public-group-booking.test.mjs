import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const booking = await readFile(new URL('../src/PublicBookingPage.tsx', import.meta.url), 'utf8');
const selection = await readFile(new URL('../src/PublicMultiServiceSelection.tsx', import.meta.url), 'utf8');
const salon = await readFile(new URL('../src/PublicSalonPage.tsx', import.meta.url), 'utf8');
const entry = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const appRouter = await readFile(new URL('../src/AppRouter.tsx', import.meta.url), 'utf8');
const workspaceShell = await readFile(new URL('../src/WorkspaceShell.tsx', import.meta.url), 'utf8');
const browserEntry = await readFile(new URL('./browser/f12-public-group-booking.tsx', import.meta.url), 'utf8');
const browserRunner = await readFile(new URL('../scripts/browser-f12-public-group-booking.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/public-booking.css', import.meta.url), 'utf8');
const notificationStatus = await readFile(new URL('../src/PublicNotificationStatus.tsx', import.meta.url), 'utf8');

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
  assert.match(booking, /validAppointmentStatus/);
  assert.match(booking, /validGroupStatus/);
  assert.match(booking, /const aggregateStatus = statuses\.size === 1/);
  assert.match(booking, /function validTimeZone/);
  assert.match(booking, /!validTimeZone\(value\.timezone\)/);
  assert.match(booking, /groupMatchesSelection/);
  assert.match(booking, /created\.startsAt !== planned\.startsAt/);
  assert.match(booking, /created\.endsAt !== planned\.endsAt/);
  assert.match(booking, /created\.priceType !== planned\.priceType/);
  assert.match(booking, /created\.priceMinMinor !== planned\.priceMinMinor/);
  assert.match(booking, /created\.priceMaxMinor !== planned\.priceMaxMinor/);
  assert.match(booking, /line\.staffId === null/);
  assert.match(booking, /result\.management\?\.url !== `\/m#\$\{managementToken\}`/);
  assert.match(booking, /estimateMinMinor/);
  assert.match(booking, /estimateMaxMinor/);
  assert.match(booking, /Kesin tahsilat tutarı değildir\./);
  assert.match(booking, /Kayıt durumu:/);
  assert.match(booking, /<PublicNotificationStatus notification=\{confirmation\.notification\} \/>/);
  assert.doesNotMatch(booking, /Bu ekran SMS veya e-posta teslimini doğrulamaz\./);
  assert.match(notificationStatus, /Bildirim durumu:/);
  assert.match(notificationStatus, /Gelen kutusuna teslim edildiği doğrulanmaz\./);
  assert.match(booking, /RANDEVU İPTAL EDİLDİ/);
  assert.match(booking, /RANDEVU PLANI KISMEN DEĞİŞTİ/);
  assert.match(booking, /Randevu ayrıntılarını aç/);
  assert.match(booking, /t\('Durum: \{status\}', \{ status: appointmentStatusLabel\(line\.status\) \}\)/);
  assert.match(booking, /case 'completed': return \{ active: false, tone: 'neutral'/);
  assert.match(booking, /case 'cancelled': return \{ active: false, tone: 'attention'/);
  assert.match(booking, /className=\{`public-result-mark is-\$\{outcome\.tone\}`\}/);
  assert.match(booking, /className=\{`public-result-status is-\$\{outcome\.tone\}`\}/);
});

test('F12-05 resolves uncertain submissions without issuing a second create', () => {
  assert.match(booking, /markPublicBookingUnresolved/);
  assert.match(booking, /\/api\/public\/booking\/resolve/);
  assert.match(booking, /groupPlan: isGroupMode \? multiServiceSelection! : undefined/);
  assert.match(booking, /await resolveStoredResult\(unresolved, true\)/);
  assert.match(booking, /resolveStoredResult\(blockingRecord\)/);
  assert.match(booking, /bookingKind: isGroupMode \? 'group' : 'single'/);
  assert.match(booking, /const expectsGroup = record\.bookingKind === 'group'/);
  assert.match(booking, /const expectedGroupPlan = expectsGroup \? record\.groupPlan : undefined/);
  assert.match(booking, /expectsGroup !== \(result\.group !== undefined\)/);
  assert.match(booking, /!groupMatchesSelection\(result\.group, expectedGroupPlan\)/);
  assert.match(booking, /resolution === 'closed_absent'/);
  assert.match(booking, /if \(expectsGroup\) onPlanNeedsRefresh\?\.\(\)/);
  assert.match(selection, /availabilityRefreshToken/);
  assert.match(selection, /if \(date && lines\.length\) void loadSlots\(\)/);
});

test('F12-05 exposes associated contact errors and non-color result cues', () => {
  assert.match(booking, /if \(!customerPhone\)/);
  assert.doesNotMatch(booking, /!customerPhone && !customerEmail/);
  // F16-02: the phone stays required and is proven by a WhatsApp code.
  assert.match(booking, /Telefon WhatsApp koduyla doğrulanır\. E-posta isteğe bağlıdır\./);
  assert.match(booking, /aria-required="true"/);
  assert.match(booking, /id="public-contact-help"/);
  assert.match(booking, /id="public-contact-error"/);
  assert.match(booking, /aria-invalid=\{Boolean\(contactError\)\}/);
  assert.match(booking, /role="alert"/);
  assert.match(booking, /public-result-status/);
  assert.match(css, /\.public-field-error/);
  assert.match(css, /\.public-primary:focus-visible/);
  assert.match(css, /\.public-result-status\.is-active/);
  assert.match(css, /\.public-result-status\.is-neutral/);
  assert.match(css, /\.public-result-status\.is-attention/);
  assert.match(css, /\.public-result-mark\.is-active/);
  assert.match(css, /\.public-result-mark\.is-neutral/);
  assert.match(css, /\.public-result-mark\.is-attention/);
});

test('F12-05 keeps one booking-state owner and lazy-loads private/operator page implementations', () => {
  assert.match(salon, /onResultVisibilityChange=\{setBookingResultVisible\}/);
  assert.match(salon, /!bookingResultVisible/);
  assert.equal((salon.match(/<PublicBookingPage/g) ?? []).length, 1);
  assert.match(salon, /onAvailabilityChange=\{setGroupPlannerAvailable\}/);
  assert.match(salon, /groupMode=\{groupPlannerAvailable\}/);
  assert.match(booking, /const isGroupMode = groupMode;/);
  assert.match(appRouter, /lazy\(\(\) => import\('\.\/PublicSalonPage'\)\)/);
  assert.match(appRouter, /lazy\(\(\) => import\('\.\/ManageAppointmentPage'\)\)/);
  assert.match(workspaceShell, /lazy\(\(\) => import\('\.\/CalendarPage'\)\)/);
  assert.doesNotMatch(entry, /^import (?:App|CalendarPage|CustomersPage|BookingPage|PublicSalonPage|ManageAppointmentPage) from/m);
  assert.match(browserEntry, /import '\.\.\/\.\.\/src\/main';/);
  assert.match(browserRunner, /PublicSalonPage-\.\*\\\.js/);
  assert.match(browserRunner, /ManageAppointmentPage-\.\*\\\.js/);
});

test('F12-05 browser acceptance names scenarios and exercises the full recovery matrix', () => {
  assert.match(browserRunner, /async function runScenario/);
  assert.match(browserRunner, /production loading state/);
  assert.match(browserRunner, /confirmed active lifecycle outcome/);
  assert.match(browserRunner, /no-show attention lifecycle outcome/);
  assert.match(browserRunner, /const mutationKinds = \['service', 'end', 'price-type', 'price-min', 'price-max'\]/);
  assert.match(browserRunner, /for \(const phase of \['create', 'automatic', 'manual'\]\)/);
  assert.match(browserRunner, /runRejectedPlanMutation/);
});
