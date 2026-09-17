import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const component = await readFile(new URL('../src/PublicMultiServiceSelection.tsx', import.meta.url), 'utf8');
const salon = await readFile(new URL('../src/PublicSalonPage.tsx', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/public-multi-service.css', import.meta.url), 'utf8');

test('F12-04 public selection consumes the real group-slot endpoint without advancing into group create', () => {
  assert.match(component, /\/api\/public\/business\/\$\{encodeURIComponent\(slug\)\}\/group-slots/);
  assert.match(component, /method:\s*'POST'/);
  assert.match(component, /csrf:\s*'skip'/);
  assert.match(component, /JSON\.stringify\(\{ date, lines \}\)/);
  assert.doesNotMatch(component, /group-book|\/bookings\/groups/);
  assert.doesNotMatch(component, /customerName|customerPhone|customerEmail|managementToken|recoverySecret/);
});

test('F12-04 keeps stale catalog, staff and slot responses from overwriting newer selection', () => {
  assert.match(component, /catalogGeneration/);
  assert.match(component, /staffGeneration/);
  assert.match(component, /slotGeneration/);
  assert.match(component, /new AbortController\(\)/);
  assert.match(component, /slotController\.current\?\.abort\(\)/);
  assert.match(component, /generation !== slotGeneration\.current/);
  assert.match(component, /setBusy\(false\)/);
  assert.match(component, /matchesRequestedLines\(slot, lines\)/);
});

test('F12-04 exposes an explicit handoff state and server-authoritative estimate copy', () => {
  assert.match(component, /export type PublicMultiServiceSelectionState/);
  assert.match(component, /date:\s*string;/);
  assert.match(component, /lines:\s*PublicMultiServiceLineSelection\[\];/);
  assert.match(component, /slot:\s*PublicGroupSlot;/);
  assert.match(component, /estimateMinMinor/);
  assert.match(component, /estimateMaxMinor/);
  assert.match(component, /Kesin tahsilat tutarı değildir\./);
  assert.doesNotMatch(component, /F12-0[1-9]|faz|tenant|RPC/i);
});

test('F12-04 is mounted only on the public salon surface and preserves the legacy booking engine', () => {
  assert.match(salon, /import PublicMultiServiceSelection from '\.\/PublicMultiServiceSelection';/);
  assert.match(salon, /<PublicMultiServiceSelection slug=\{slug\} \/>/);
  assert.match(salon, /<PublicBookingPage slug=\{slug\} \/>/);
});

test('F12-04 mobile controls retain 44px touch targets and narrow layouts', () => {
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /@media \(max-width:\s*760px\)/);
  assert.match(css, /@media \(max-width:\s*430px\)/);
  assert.match(css, /:focus-visible/);
});
